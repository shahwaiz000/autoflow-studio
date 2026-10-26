"""Workflow execution engine.

A workflow definition is plain JSON: {"start": "<step id>", "steps": [...]}.
Only whitelisted step types run, and conditions use a fixed operator table,
so no user-supplied code is ever evaluated.
"""
import logging
import time
from pathlib import Path

import pandas as pd
from sqlalchemy.orm import Session

from .config import settings
from .models import Execution, ExecutionStep, Workflow, utcnow

log = logging.getLogger("autoflow.engine")

OPS = {
    ">": lambda a, b: a > b, ">=": lambda a, b: a >= b, "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b, "==": lambda a, b: a == b, "!=": lambda a, b: a != b,
}
MAX_STEPS = 50          # guards against accidental loops
MAX_CSV_BYTES = 5_000_000
MAX_ROWS = 50_000


class StepError(Exception):
    """A step failed in a way the user should see."""


class Context:
    def __init__(self):
        self.df: pd.DataFrame | None = None
        self.metrics: dict = {"invalid_rows": 0, "missing_values": 0}
        self.details: dict = {}
        self.execution_id: int | None = None


def h_trigger(cfg, ctx):
    return f"Trigger fired ({cfg.get('kind', 'manual')})"


def h_load_csv(cfg, ctx):
    name = Path(str(cfg.get("file", ""))).name  # file name only: no path traversal
    folder = settings.uploads_dir if cfg.get("source") == "uploads" else settings.samples_dir
    path = folder / name
    if not name.lower().endswith(".csv") or not path.is_file():
        raise StepError(f"CSV file '{name}' was not found")
    if path.stat().st_size > MAX_CSV_BYTES:
        raise StepError(f"The file is larger than the {MAX_CSV_BYTES // 1_000_000} MB limit")
    try:
        df = pd.read_csv(path)
    except Exception:
        raise StepError("The file could not be read as a CSV table. Check that it is a plain comma-separated file")
    if df.empty:
        raise StepError("The file has a header but no data rows")
    if len(df) > MAX_ROWS:
        raise StepError(f"The file has more than {MAX_ROWS:,} rows, which is over the limit")
    ctx.df = df
    ctx.metrics["rows_loaded"] = len(df)
    ctx.details["columns"] = [str(c) for c in df.columns]
    return f"Loaded {len(df)} rows and {len(df.columns)} columns"


def _need_df(ctx):
    if ctx.df is None:
        raise StepError("No data loaded. Add a 'Load CSV' step before this one")
    return ctx.df


def h_validate(cfg, ctx):
    df = _need_df(ctx)
    required = cfg.get("required_columns", [])
    numeric = cfg.get("numeric_columns", [])
    missing_cols = [c for c in required + numeric if c not in df.columns]
    if missing_cols:
        raise StepError(f"Missing required columns: {', '.join(dict.fromkeys(missing_cols))}")
    cols = required or list(df.columns)
    bad = df[cols].isna().any(axis=1)
    ctx.metrics["invalid_rows"] = int(bad.sum())
    ctx.metrics["missing_values"] = int(df[cols].isna().sum().sum())
    ctx.metrics["duplicate_rows"] = int(df.duplicated().sum())
    ctx.details["missing_by_column"] = {str(c): int(n) for c, n in df[cols].isna().sum().items() if n}
    not_numbers = 0
    for c in numeric:  # text where a number is expected (empty cells are counted as missing instead)
        converted = pd.to_numeric(df[c], errors="coerce")
        not_numbers += int((df[c].notna() & converted.isna()).sum())
    ctx.metrics["invalid_values"] = not_numbers
    msg = (f"{ctx.metrics['invalid_rows']} of {len(df)} rows have missing values, "
           f"{ctx.metrics['duplicate_rows']} duplicate rows, {not_numbers} non-numeric values")
    if cfg.get("fail_on_errors") and ctx.metrics["invalid_rows"] > 0:
        raise StepError(msg + " (fail_on_errors is enabled)")
    return msg


def h_condition(cfg, ctx):
    op = cfg.get("op")
    if op not in OPS:
        raise StepError(f"Unsupported operator '{op}'")
    field = cfg.get("field")
    if field not in ctx.metrics:
        raise StepError(f"Unknown field '{field}'. Available: {', '.join(ctx.metrics)}")
    result = OPS[op](ctx.metrics[field], cfg.get("value"))
    nxt = cfg.get("on_true") if result else cfg.get("on_false")
    return f"{field} {op} {cfg.get('value')} is {result}", nxt


def h_transform(cfg, ctx):
    df = _need_df(ctx)
    before = len(df)
    ops = cfg.get("operations", [])
    for op in ops:
        if op == "drop_duplicates":
            df = df.drop_duplicates()
        elif op == "drop_missing":
            df = df.dropna()
        elif op == "drop_invalid_numbers":
            for c in cfg.get("numeric_columns", []):
                if c not in df.columns:
                    raise StepError(f"Missing required columns: {c}")
                ok = df[c].isna() | pd.to_numeric(df[c], errors="coerce").notna()  # empty cells are handled elsewhere
                df = df[ok]
        elif op == "trim_text":
            df = df.copy()
            for c in df.select_dtypes(include=["object", "string"]).columns:
                df[c] = df[c].str.strip()
        else:
            raise StepError(f"Unsupported transform '{op}'")
    ctx.df = df
    ctx.metrics["rows_after_cleaning"] = len(df)
    return f"Applied {', '.join(ops) or 'no operations'}: {before} -> {len(df)} rows"


def h_notify(cfg, ctx):
    # v0.1: notifications are recorded in the log only (nothing is sent externally).
    return f"Notification recorded for {cfg.get('to', 'team')}: {cfg.get('message', '')}"


def h_report(cfg, ctx):
    df = _need_df(ctx)
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    out = settings.reports_dir / f"execution_{ctx.execution_id}_summary.csv"
    df.describe(include="all").transpose().to_csv(out)
    df.to_csv(settings.reports_dir / f"execution_{ctx.execution_id}_processed.csv", index=False)
    ctx.metrics.setdefault("rows_after_cleaning", len(df))
    return f"Summary report and processed data written for {len(df)} rows"


def h_end(cfg, ctx):
    return "Workflow completed"


HANDLERS = {
    "trigger": h_trigger, "load_csv": h_load_csv, "validate": h_validate,
    "condition": h_condition, "transform": h_transform, "notify": h_notify,
    "report": h_report, "end": h_end,
}


def validate_definition(defn: dict) -> list[str]:
    """Return a list of problems; empty means the definition is runnable."""
    errors, steps = [], defn.get("steps")
    if not isinstance(steps, list) or not steps:
        return ["Workflow has no steps"]
    ids = [s.get("id") for s in steps]
    if len(set(ids)) != len(ids):
        errors.append("Step ids must be unique")
    for s in steps:
        if s.get("type") not in HANDLERS:
            errors.append(f"Step '{s.get('id')}' has unsupported type '{s.get('type')}'")
        targets = [s.get("next"), s.get("config", {}).get("on_true"), s.get("config", {}).get("on_false")]
        for tgt in targets:
            if tgt and tgt not in ids:
                errors.append(f"Step '{s.get('id')}' points to unknown step '{tgt}'")
    return errors


def create_execution(db: Session, workflow: Workflow, trigger_type: str = "manual", status: str = "running") -> Execution:
    ex = Execution(workflow=workflow, trigger_type=trigger_type, status=status, started_at=utcnow())
    db.add(ex)
    db.commit()
    return ex


def run_workflow(db: Session, workflow: Workflow, trigger_type: str = "manual", definition: dict | None = None) -> Execution:
    """Run now, inside the caller's thread."""
    return execute(db, create_execution(db, workflow, trigger_type), definition)


def execute(db: Session, ex: Execution, definition: dict | None = None) -> Execution:
    """Run the steps of an execution that already exists (used directly by the background queue)."""
    workflow = ex.workflow
    ex.status, ex.started_at = "running", utcnow()
    db.commit()
    defn = definition or workflow.definition
    ctx = Context()
    ctx.execution_id = ex.id
    t0 = time.perf_counter()
    try:
        problems = validate_definition(defn)
        if problems:
            raise StepError("Invalid workflow definition: " + "; ".join(problems))
        by_id = {s["id"]: s for s in defn["steps"]}
        order = [s["id"] for s in defn["steps"]]
        current, pos = defn.get("start", order[0]), 0
        while current:
            pos += 1
            if pos > MAX_STEPS:
                raise StepError(f"Stopped after {MAX_STEPS} steps (possible loop)")
            step = by_id[current]
            nxt = _run_step(db, ex, step, pos, ctx)
            if step["type"] == "end":
                break
            if nxt is None:
                i = order.index(current)
                nxt = step.get("next") or (order[i + 1] if i + 1 < len(order) else None)
            current = nxt
        ex.status = "success"
    except StepError as e:
        ex.status, ex.error_message = "failed", str(e)
    except Exception as e:  # unexpected bug: record it, never crash the API
        log.exception("Unexpected engine error")
        ex.status, ex.error_message = "failed", f"Unexpected error: {type(e).__name__}"
    ex.result_metrics = {**ctx.metrics, **ctx.details}
    ex.finished_at = utcnow()
    ex.duration_seconds = round(time.perf_counter() - t0, 3)
    db.commit()
    log.info("Execution %s of '%s' finished: %s", ex.id, workflow.name, ex.status)
    return ex


def _run_step(db, ex, step, pos, ctx):
    handler = HANDLERS[step["type"]]
    retries = int(step.get("retries", 0))
    attempts, nxt, t0 = 0, None, time.perf_counter()
    while True:
        attempts += 1
        try:
            result = handler(step.get("config", {}), ctx)
            msg, nxt = result if isinstance(result, tuple) else (result, None)
            status = "success"
            break
        except StepError as e:
            if attempts > retries:
                msg, status = str(e), "failed"
                break
    db.add(ExecutionStep(
        execution_id=ex.id, position=pos, step_id=step["id"], step_type=step["type"],
        name=step.get("name", step["id"]), status=status, attempts=attempts, message=msg,
        duration_ms=int((time.perf_counter() - t0) * 1000)))
    db.commit()
    if status == "failed":
        raise StepError(f"Step '{step.get('name', step['id'])}' failed: {msg}")
    return nxt
