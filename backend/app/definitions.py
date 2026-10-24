"""Checks and cleans workflow steps sent by the editor.

Nothing the user types is trusted: only known step types, known setting names and
simple values (text, numbers, lists of text) are accepted. No code can be saved.
"""
import re

from .engine import OPS, validate_definition

ID_RE = re.compile(r"^[A-Za-z0-9_]{1,40}$")
METRIC_FIELDS = ["invalid_rows", "missing_values", "duplicate_rows", "invalid_values", "rows_loaded", "rows_after_cleaning"]
TRANSFORMS = ["trim_text", "drop_duplicates", "drop_missing", "drop_invalid_numbers"]
KEYS = {
    "trigger": {"kind"}, "load_csv": {"file"}, "validate": {"required_columns", "numeric_columns", "fail_on_errors"},
    "condition": {"field", "op", "value", "on_true", "on_false"}, "transform": {"operations", "numeric_columns"},
    "notify": {"to", "message"}, "report": set(), "end": set(),
}


def _text(v, limit):
    return isinstance(v, str) and len(v.strip()) <= limit


def _strlist(v, where, errs):
    if not isinstance(v, list) or len(v) > 20 or not all(_text(x, 60) for x in v):
        errs.append(f"{where}: column lists must have at most 20 short names")
        return []
    return [x.strip() for x in v if x.strip()]


def _clean_config(t, cfg, where, errs):
    out = {}
    if t == "trigger":
        out["kind"] = cfg.get("kind", "manual")
        if out["kind"] not in ("manual", "upload"):
            errs.append(f"{where}: trigger kind must be manual or upload")
    elif t == "load_csv":
        f = cfg.get("file", "")
        if not _text(f, 100) or not f.lower().endswith(".csv") or "/" in f or "\\" in f:
            errs.append(f"{where}: choose a CSV file from the list")
        out["file"] = f
    elif t == "validate":
        out["required_columns"] = _strlist(cfg.get("required_columns", []), where, errs)
        out["numeric_columns"] = _strlist(cfg.get("numeric_columns", []), where, errs)
        out["fail_on_errors"] = cfg.get("fail_on_errors", False) is True
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
        out["numeric_columns"] = _strlist(cfg.get("numeric_columns", []), where, errs)
        if "drop_invalid_numbers" in ops and not out["numeric_columns"]:
            errs.append(f"{where}: name the number columns to check")
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
        steps.append(step)
    if errs:
        return None, errs
    defn = {"steps": steps}
    return (defn, []) if not (e := validate_definition(defn)) else (None, e)
