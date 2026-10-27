"""Checks and cleans workflow steps sent by the editor.

Nothing the user types is trusted: only known step types, known setting names and
simple values (text, numbers, lists of text) are accepted. No code can be saved.
"""
import re

from . import tables
from .engine import OPS, validate_definition

ID_RE = re.compile(r"^[A-Za-z0-9_]{1,40}$")
METRIC_FIELDS = ["invalid_rows", "missing_values", "duplicate_rows", "invalid_values", "rows_loaded", "rows_after_cleaning",
                 "values_fixed", "values_unreadable", "matched_rows", "missing_in_right", "missing_in_left",
                 "amount_mismatches", "duplicate_keys", "unreadable_amounts", "exceptions", "amount_difference", "unmatched_amount"]
TRANSFORMS = ["trim_text", "drop_duplicates", "drop_missing", "drop_invalid_numbers",
              "normalize_amounts", "parse_dates", "standardize_text"]
# which column list each cleaning option needs
NEEDS = {"drop_invalid_numbers": "numeric_columns", "normalize_amounts": "amount_columns",
         "parse_dates": "date_columns", "standardize_text": "text_columns"}
KEYS = {
    "trigger": {"kind"}, "load_csv": {"file", "source", "input", "table", "sheet"},
    "validate": {"required_columns", "numeric_columns", "fail_on_errors", "table"},
    "condition": {"field", "op", "value", "on_true", "on_false"},
    "transform": {"operations", "numeric_columns", "amount_columns", "date_columns", "text_columns", "dayfirst", "table"},
    "compare": {"left", "right", "left_key", "right_key", "left_amount", "right_amount", "tolerance", "group_by"},
    "notify": {"to", "message"}, "report": {"table"}, "end": set(),
}


def _text(v, limit):
    return isinstance(v, str) and len(v.strip()) <= limit


def _strlist(v, where, errs):
    if not isinstance(v, list) or len(v) > 20 or not all(_text(x, 60) for x in v):
        errs.append(f"{where}: column lists must have at most 20 short names")
        return []
    return [x.strip() for x in v if x.strip()]


def _table_ref(cfg, out, where, errs):
    """A step may name the table it works on; if it does not, it uses the one loaded last."""
    if cfg.get("table"):
        if not isinstance(cfg["table"], str) or not tables.TABLE_RE.match(cfg["table"]):
            errs.append(f"{where}: the table name is not valid")
        out["table"] = cfg["table"]


def _clean_config(t, cfg, where, errs):
    out = {}
    if t == "trigger":
        out["kind"] = cfg.get("kind", "manual")
        if out["kind"] not in ("manual", "upload", "schedule"):
            errs.append(f"{where}: trigger kind must be manual, upload or schedule")
    elif t == "load_csv":
        out["table"] = cfg.get("table") or "main"
        if not isinstance(out["table"], str) or not tables.TABLE_RE.match(out["table"]):
            errs.append(f"{where}: the table name must be lowercase letters, numbers or underscore, starting with a letter")
        if cfg.get("input"):  # the file is chosen when the workflow runs
            if not isinstance(cfg["input"], str) or not tables.TABLE_RE.match(cfg["input"]):
                errs.append(f"{where}: the run-time file name must be lowercase letters, numbers or underscore")
            out["input"] = cfg["input"]
        else:
            f = cfg.get("file", "")
            if not isinstance(f, str) or not tables.is_supported(f):
                errs.append(f"{where}: choose a CSV or Excel (.xlsx) file from the list")
            out["file"] = f
            if cfg.get("source", "samples") not in ("samples", "uploads"):
                errs.append(f"{where}: the file must come from the sample files or your uploads")
            out["source"] = cfg.get("source", "samples")
        if cfg.get("sheet"):
            if not _text(cfg["sheet"], 60):
                errs.append(f"{where}: the sheet name is too long")
            out["sheet"] = cfg["sheet"].strip()
    elif t == "validate":
        out["required_columns"] = _strlist(cfg.get("required_columns", []), where, errs)
        out["numeric_columns"] = _strlist(cfg.get("numeric_columns", []), where, errs)
        out["fail_on_errors"] = cfg.get("fail_on_errors", False) is True
        _table_ref(cfg, out, where, errs)
    elif t == "condition":
        if cfg.get("field") not in METRIC_FIELDS:
            errs.append(f"{where}: choose a value to check")
        if cfg.get("op") not in OPS:
            errs.append(f"{where}: choose a comparison")
        v = cfg.get("value")
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            errs.append(f"{where}: the number to compare with must be a number")
        for k, label in (("on_true", "true"), ("on_false", "false")):
            if not isinstance(cfg.get(k), str) or not cfg.get(k):
                errs.append(f"{where}: choose where to go when the condition is {label}")
        out = {k: cfg.get(k) for k in KEYS["condition"]}
    elif t == "transform":
        ops = cfg.get("operations", [])
        if not isinstance(ops, list) or not all(o in TRANSFORMS for o in ops):
            errs.append(f"{where}: unknown cleaning option")
            ops = []
        out["operations"] = ops
        for key in ("numeric_columns", "amount_columns", "date_columns", "text_columns"):
            out[key] = _strlist(cfg.get(key, []), where, errs)
        for op in ops:
            if op in NEEDS and not out[NEEDS[op]]:
                errs.append(f"{where}: name the columns for '{op.replace('_', ' ')}'")
        if "dayfirst" in cfg:
            out["dayfirst"] = cfg["dayfirst"] is not False
        _table_ref(cfg, out, where, errs)
    elif t == "report":
        _table_ref(cfg, out, where, errs)
    elif t == "compare":
        for k in ("left", "right"):
            if not isinstance(cfg.get(k), str) or not tables.TABLE_RE.match(cfg.get(k, "")):
                errs.append(f"{where}: choose the {'first' if k == 'left' else 'second'} table")
            out[k] = cfg.get(k)
        if out["left"] and out["left"] == out["right"]:
            errs.append(f"{where}: choose two different tables")
        for k, label in (("left_key", "first"), ("right_key", "second")):
            if not _text(cfg.get(k), 60) or not str(cfg.get(k, "")).strip():
                errs.append(f"{where}: name the column that identifies each row in the {label} table")
            out[k] = str(cfg.get(k, "")).strip()
        la, ra = str(cfg.get("left_amount") or "").strip(), str(cfg.get("right_amount") or "").strip()
        if bool(la) != bool(ra):
            errs.append(f"{where}: name the amount column in both tables, or in neither")
        elif la and not (_text(la, 60) and _text(ra, 60)):
            errs.append(f"{where}: amount column names are too long")
        elif la:
            out["left_amount"], out["right_amount"] = la, ra
        tol = cfg.get("tolerance", 0.01)
        if isinstance(tol, bool) or not isinstance(tol, (int, float)) or not 0 <= tol <= 1_000_000:
            errs.append(f"{where}: the allowed difference must be a number from 0 up")
        out["tolerance"] = tol
        group = str(cfg.get("group_by") or "").strip()
        if group and not _text(group, 60):
            errs.append(f"{where}: the column to group by is too long")
        elif group:
            out["group_by"] = group
    elif t == "notify":
        out = {"to": cfg.get("to", ""), "message": cfg.get("message", "")}
        if not _text(out["to"], 120) or not _text(out["message"], 300):
            errs.append(f"{where}: recipient or message is too long")
    return out


def clean_definition(raw_steps: list) -> tuple[dict | None, list[str]]:
    errs, steps = [], []
    for i, s in enumerate(raw_steps, 1):
        where = f"Step {i}"
        if not isinstance(s, dict) or s.get("type") not in KEYS:
            errs.append(f"{where}: unknown step type")
            continue
        t, cfg = s["type"], s.get("config") or {}
        if not isinstance(cfg, dict):
            errs.append(f"{where}: settings are not valid")
            continue
        if set(cfg) - KEYS[t]:
            errs.append(f"{where}: unsupported setting(s): {', '.join(sorted(set(cfg) - KEYS[t]))}")
            continue
        if not isinstance(s.get("id"), str) or not ID_RE.match(s["id"]):
            errs.append(f"{where}: invalid step id")
        if not _text(s.get("name"), 120) or not s.get("name", "").strip():
            errs.append(f"{where}: give the step a name (up to 120 characters)")
        retries = s.get("retries", 0)
        if isinstance(retries, bool) or retries not in (0, 1, 2, 3):
            errs.append(f"{where}: retries must be 0 to 3")
        step = {"id": s.get("id"), "type": t, "name": str(s.get("name", "")).strip(), "config": _clean_config(t, cfg, where, errs)}
        if retries:
            step["retries"] = retries
        if s.get("next"):
            step["next"] = s["next"]
        pos = s.get("pos")  # where the box sits in the builder; the engine ignores it
        if pos is not None:
            ok = (isinstance(pos, dict) and set(pos) == {"x", "y"} and
                  all(isinstance(v, (int, float)) and not isinstance(v, bool) and -10000 <= v <= 10000 for v in pos.values()))
            if ok:
                step["pos"] = {"x": round(pos["x"], 1), "y": round(pos["y"], 1)}
            else:
                errs.append(f"{where}: box position is not valid")
        steps.append(step)
    if errs:
        return None, errs
    errs += _check_tables(steps)
    if errs:
        return None, errs
    defn = {"steps": steps}
    return (defn, []) if not (e := validate_definition(defn)) else (None, e)


def _check_tables(steps: list[dict]) -> list[str]:
    errs, loaded, inputs = [], [], []
    for s in steps:
        if s["type"] == "load_csv":
            t = s["config"]["table"]
            if t in loaded:
                errs.append(f"Two Load steps use the table name '{t}'. Give each one its own name")
            loaded.append(t)
            if s["config"].get("input"):
                if s["config"]["input"] in inputs:
                    errs.append(f"Two Load steps ask for the run-time file '{s['config']['input']}'")
                inputs.append(s["config"]["input"])
    for s in steps:
        refs = [s["config"].get("table")] if s["type"] in ("validate", "transform", "report") else []
        if s["type"] == "compare":
            refs = [s["config"].get("left"), s["config"].get("right")]
        for t in refs:
            if t and t not in loaded:
                errs.append(f"Step '{s['name']}' uses the table '{t}', but no Load step creates it")
    return errs
