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

from . import reconcile, tables
from .config import settings
from .models import Execution, ExecutionException, ExecutionInput, ExecutionResult, ExecutionStep, Workflow, utcnow

log = logging.getLogger("autoflow.engine")

OPS = {
    ">": lambda a, b: a > b, ">=": lambda a, b: a >= b, "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b, "==": lambda a, b: a == b, "!=": lambda a, b: a != b,
}
MAX_STEPS = 50          # guards against accidental loops
MAX_CSV_BYTES = tables.MAX_BYTES
MAX_ROWS = tables.MAX_ROWS


class StepError(Exception):
    """A step failed in a way the user should see."""


class Context:
    def __init__(self):
        self.df: pd.DataFrame | None = None       # the table the next step works on by default
        self.frames: dict[str, pd.DataFrame] = {}  # every loaded table, by name
        self.current: str = "main"
        self.inputs: dict[str, dict] = {}          # files chosen for this run: name -> {source, file}
        self.exceptions: pd.DataFrame | None = None  # what the Compare steps found
        self.metrics: dict = {"invalid_rows": 0, "missing_values": 0}
        self.details: dict = {}
        self.execution_id: int | None = None


def h_trigger(cfg, ctx):
    return f"Trigger fired ({cfg.get('kind', 'manual')})"


def h_load_csv(cfg, ctx):
    """Load a CSV or Excel file into a named table. The file is either fixed in the workflow or chosen when the run starts."""
    table = cfg.get("table") or "main"
    if cfg.get("input"):
        chosen = ctx.inputs.get(cfg["input"])
        if not chosen:
            raise StepError(f"No file was chosen for '{cfg['input']}'. Choose one when you run the workflow")
        source, name = chosen["source"], chosen["file"]
    else:
        source, name = ("uploads" if cfg.get("source") == "uploads" else "samples"), str(cfg.get("file", ""))
    name = Path(name).name  # file name only: no path traversal
    folder = settings.uploads_dir if source == "uploads" else settings.samples_dir
    path = folder / name
    if not tables.is_supported(name) or not path.is_file():
        raise StepError(f"File '{name}' was not found. Check Data Sources")
    try:
        df = tables.read_table(path, sheet=cfg.get("sheet") or None)
    except tables.TableError as e:
        raise StepError(str(e))
    if df.empty:
        raise StepError("The file has a header but no data rows")
    ctx.frames[table] = df
    ctx.df, ctx.current = df, table
    ctx.metrics["rows_loaded"] = len(df)
    ctx.details["columns"] = [str(c) for c in df.columns]
    ctx.details.setdefault("tables", {})[table] = {"file": name, "rows": len(df), "columns": len(df.columns)}
    return f"Loaded {len(df)} rows and {len(df.columns)} columns from {name} into table '{table}'"


def _need_df(ctx, cfg=None):
    """The table a step works on: the one it names, or the one loaded most recently."""
    name = (cfg or {}).get("table")
    if name:
        if name not in ctx.frames:
            raise StepError(f"Table '{name}' has not been loaded. Add a Load step for it first")
        return ctx.frames[name]
    if ctx.df is None:
        raise StepError("No data loaded. Add a 'Load file' step before this one")
    return ctx.df


def _put(ctx, cfg, df):
    name = cfg.get("table") or ctx.current
    ctx.frames[name] = df
    ctx.df, ctx.current = df, name


def h_validate(cfg, ctx):
    df = _need_df(ctx, cfg)
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


def _columns_exist(df, cols):
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise StepError(f"Missing required columns: {', '.join(dict.fromkeys(missing))}")


def h_transform(cfg, ctx):
    df = _need_df(ctx, cfg)
    before = len(df)
    ops = cfg.get("operations", [])
    fixed = unreadable = 0
    for op in ops:
        if op == "drop_duplicates":
            df = df.drop_duplicates()
        elif op == "drop_missing":
            df = df.dropna()
        elif op == "drop_invalid_numbers":
            _columns_exist(df, cfg.get("numeric_columns", []))
            for c in cfg.get("numeric_columns", []):
                ok = df[c].isna() | pd.to_numeric(df[c], errors="coerce").notna()  # empty cells are handled elsewhere
                df = df[ok]
        elif op == "trim_text":
            df = df.copy()
            for c in df.select_dtypes(include=["object", "string"]).columns:
                df[c] = df[c].str.strip()
        elif op == "normalize_amounts":
            cols = cfg.get("amount_columns", [])
            _columns_exist(df, cols)
            df = df.copy()
            for c in cols:
                df[c], n, bad = tables.normalize_amounts(df[c])
                fixed, unreadable = fixed + n, unreadable + bad
        elif op == "parse_dates":
            cols = cfg.get("date_columns", [])
            _columns_exist(df, cols)
            df = df.copy()
            for c in cols:
                df[c], n, bad = tables.parse_dates(df[c], dayfirst=cfg.get("dayfirst", True) is not False)
                fixed, unreadable = fixed + n, unreadable + bad
        elif op == "standardize_text":
            cols = cfg.get("text_columns", [])
            _columns_exist(df, cols)
            df = df.copy()
            for c in cols:
                df[c], n = tables.standardize_text(df[c])
                fixed += n
        else:
            raise StepError(f"Unsupported transform '{op}'")
    _put(ctx, cfg, df)
    ctx.metrics["rows_after_cleaning"] = len(df)
    ctx.metrics["values_fixed"] = ctx.metrics.get("values_fixed", 0) + fixed
    ctx.metrics["values_unreadable"] = ctx.metrics.get("values_unreadable", 0) + unreadable
    msg = f"Applied {', '.join(ops) or 'no operations'}: {before} -> {len(df)} rows"
    if fixed or unreadable:
        msg += f". {fixed} values were reformatted"
        if unreadable:
            msg += f", {unreadable} could not be read and were left empty"
    return msg


def h_compare(cfg, ctx):
    """Match two loaded tables on a key (and optionally an amount) and list what does not agree."""
    for side in ("left", "right"):
        name = cfg.get(side)
        if name not in ctx.frames:
            raise StepError(f"Table '{name}' has not been loaded. Add a Load step for it before the Compare step")
    left, right = ctx.frames[cfg["left"]], ctx.frames[cfg["right"]]
    cols = [(cfg["left"], left, cfg["left_key"]), (cfg["right"], right, cfg["right_key"])]
    if cfg.get("left_amount") and cfg.get("right_amount"):
        cols += [(cfg["left"], left, cfg["left_amount"]), (cfg["right"], right, cfg["right_amount"])]
    for name, df, col in cols:
        if col not in df.columns:
            raise StepError(f"Missing required columns: '{col}' is not in table '{name}'. Columns there: {', '.join(map(str, df.columns))}")
    out, metrics, details = reconcile.compare(left, right, cfg)
    ctx.metrics.update(metrics)
    ctx.details.setdefault("comparisons", []).append(details)
    ctx.exceptions = out if ctx.exceptions is None else pd.concat([ctx.exceptions, out], ignore_index=True)
    return reconcile.summary_line(metrics, cfg["left"], cfg["right"])


def h_notify(cfg, ctx):
    # v0.1: notifications are recorded in the log only (nothing is sent externally).
    return f"Notification recorded for {cfg.get('to', 'team')}: {cfg.get('message', '')}"


def profile(df: pd.DataFrame) -> pd.DataFrame:
    """One row per column: what it holds, what is missing, and totals for number columns."""
    rows = []
    for c in df.columns:
        col = df[c]
        numeric = pd.to_numeric(col, errors="coerce")
        is_num = bool(col.notna().any()) and bool(numeric.notna().sum() == col.notna().sum())
        rows.append({
            "column": c, "type": "number" if is_num else "text", "filled": int(col.notna().sum()),
            "missing": int(col.isna().sum()), "unique_values": int(col.nunique(dropna=True)),
            "total": round(float(numeric.sum()), 2) if is_num else "", "smallest": float(numeric.min()) if is_num else "",
            "largest": float(numeric.max()) if is_num else "",
            "average": round(float(numeric.mean()), 2) if is_num else "",
            "most_common": "" if is_num or col.dropna().empty else str(col.value_counts().index[0])[:60],
        })
    return pd.DataFrame(rows)


def h_report(cfg, ctx):
    """Write the cleaned data, a column-by-column summary, and one Excel workbook with both plus the run facts."""
    from .analytics import safe_cell
    df = _need_df(ctx, cfg)
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    base = settings.reports_dir / f"execution_{ctx.execution_id}"
    prof = profile(df)
    prof.to_csv(f"{base}_summary.csv", index=False)
    df.to_csv(f"{base}_processed.csv", index=False)
    facts = [("Rows in the report", len(df)), ("Columns", len(df.columns)),
             *[(k.replace("_", " ").capitalize(), v) for k, v in ctx.metrics.items() if isinstance(v, (int, float))]]
    safe = df.head(MAX_ROWS).copy()
    for c in safe.select_dtypes(include=["object", "string"]).columns:
        safe[c] = safe[c].map(lambda v: safe_cell(v) if isinstance(v, str) else v)  # text must never become an Excel formula
    with pd.ExcelWriter(f"{base}_report.xlsx", engine="openpyxl") as xw:
        pd.DataFrame(facts, columns=["What", "Value"]).to_excel(xw, sheet_name="Summary", index=False)
        prof.to_excel(xw, sheet_name="Columns", index=False)
        safe.to_excel(xw, sheet_name="Data", index=False)
        if ctx.exceptions is not None and len(ctx.exceptions):
            ex_out = ctx.exceptions.head(reconcile.MAX_EXCEPTIONS).copy()
            ex_out["kind"] = ex_out["kind"].map(reconcile.KINDS)
            for c in ("key", "reason"):
                ex_out[c] = ex_out[c].map(lambda v: safe_cell(v) if isinstance(v, str) else v)
            ex_out.columns = ["Type", "Key", "Row in first table", "Row in second table", "First amount", "Second amount", "Difference", "Reason"]
            ex_out.to_excel(xw, sheet_name="Exceptions", index=False)
        for ws in xw.book.worksheets:
            ws.freeze_panes = "A2"
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = min(40, max(10, max(len(str(c.value or "")) for c in col[:200]) + 2))
    ctx.metrics.setdefault("rows_after_cleaning", len(df))
    return f"Report written for {len(df)} rows: summary, cleaned data and an Excel workbook"


def h_end(cfg, ctx):
    return "Workflow completed"


HANDLERS = {
    "trigger": h_trigger, "load_csv": h_load_csv, "validate": h_validate,
    "condition": h_condition, "transform": h_transform, "compare": h_compare, "notify": h_notify,
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


def required_inputs(defn: dict) -> list[dict]:
    """Files a workflow asks for when it is run: [{name, label}] taken from its Load steps."""
    out = []
    for s in defn.get("steps", []):
        if s.get("type") == "load_csv" and s.get("config", {}).get("input"):
            out.append({"name": s["config"]["input"], "label": s.get("name", s["config"]["input"])})
    return out


def create_execution(db: Session, workflow: Workflow, trigger_type: str = "manual", status: str = "running",
                     inputs: dict[str, dict] | None = None) -> Execution:
    ex = Execution(workflow=workflow, trigger_type=trigger_type, status=status, started_at=utcnow())
    for name, f in (inputs or {}).items():
        ex.inputs.append(ExecutionInput(name=name, source=f["source"], file=f["file"]))
    db.add(ex)
    db.commit()
    return ex


def run_workflow(db: Session, workflow: Workflow, trigger_type: str = "manual", definition: dict | None = None,
                 inputs: dict[str, dict] | None = None) -> Execution:
    """Run now, inside the caller's thread."""
    return execute(db, create_execution(db, workflow, trigger_type, inputs=inputs), definition)


def execute(db: Session, ex: Execution, definition: dict | None = None) -> Execution:
    """Run the steps of an execution that already exists (used directly by the background queue)."""
    workflow = ex.workflow
    ex.status, ex.started_at = "running", utcnow()
    db.commit()
    defn = definition or workflow.definition
    ctx = Context()
    ctx.execution_id = ex.id
    ctx.inputs = {i.name: {"source": i.source, "file": i.file} for i in ex.inputs}
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
    _save_results(db, ex, ctx)
    ex.finished_at = utcnow()
    ex.duration_seconds = round(time.perf_counter() - t0, 3)
    db.commit()
    log.info("Execution %s of '%s' finished: %s", ex.id, workflow.name, ex.status)
    return ex


def _plain(v):
    """Make numbers from pandas/numpy safe to store as JSON."""
    if isinstance(v, dict):
        return {str(k): _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if hasattr(v, "item"):
        v = v.item()
    return None if isinstance(v, float) and v != v else v


def _int(v):
    v = _plain(v)
    return None if v is None else int(v)


def _save_results(db, ex, ctx):
    """Keep the run's numbers and every exception with the run, so they can be looked at later."""
    saved = ctx.exceptions.head(reconcile.MAX_EXCEPTIONS) if ctx.exceptions is not None else None
    details = _plain(ctx.details)
    if saved is not None and len(ctx.exceptions) > len(saved):
        details["exceptions_saved"] = len(saved)  # the counts still cover every row
    ex.result = ExecutionResult(metrics=_plain(ctx.metrics), details=details)
    if saved is not None:
        for r in saved.itertuples(index=False):
            ex.exceptions.append(ExecutionException(
                kind=r.kind, key=str(r.key)[:120], left_row=_int(r.left_row), right_row=_int(r.right_row),
                left_amount=_plain(r.left_amount), right_amount=_plain(r.right_amount), difference=_plain(r.difference),
                reason=r.reason))
    db.commit()


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
