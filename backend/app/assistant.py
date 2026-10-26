"""Built-in assistant. It uses plain rules, NOT an AI language model.

It turns a plain-English reconciliation request into a workflow made only of the engine's own
step types, explains existing workflows, and summarizes failures. It is free,
runs offline and never executes anything: every proposal passes through
`clean_definition`, the same check that guards the workflow editor.

Keeping it behind these three functions means a language model (for example a
local one) could replace `propose` later without changing the API or the UI.
"""
import csv
import re
from collections import defaultdict

from sqlalchemy.orm import Session

from .analytics import _finished, _reason
from .config import settings
from .definitions import clean_definition
from .models import Execution, Workflow

PROVIDER = "rules"

DATASETS = [
    dict(label="Courier collections", noun="collection", file="courier_collections.csv", category="Finance", alert_to="finance@example.com",
         words=r"courier|cod|collections?|waybills?|parcels?|deliver\w*", required=["waybill", "courier", "cod_amount"], numeric=["cod_amount"]),
    dict(label="Bank deposits", noun="deposit", file="bank_deposits.csv", category="Finance", alert_to="finance@example.com",
         words=r"bank|deposits?|settlements?|remittances?", required=["reference", "amount"], numeric=[]),
]
PAIR = dict(left=DATASETS[0], right=DATASETS[1], left_key="waybill", right_key="reference", left_amount="cod_amount", right_amount="amount")

LIMITS = [
    "It follows rules and keywords. It is not an AI language model and does not understand every sentence.",
    "It builds one kind of workflow: courier collections reconciled against bank deposits, using the sample files. For your own files use the COD Reconciliation template.",
    "Notifications are recorded in the run log only. Nothing is emailed or sent.",
    "The assistant does not set schedules. Save the workflow, then add a schedule on the Schedules page.",
]

EMAIL = re.compile(r"[A-Za-z0-9._%+-]{1,40}@[A-Za-z0-9.-]{1,60}\.[A-Za-z]{2,10}")


def _has(text: str, pattern: str) -> bool:
    return re.search(rf"\b(?:{pattern})\b", text) is not None


def _columns(file: str) -> list[str]:
    path = settings.samples_dir / file
    try:
        with path.open(newline="", encoding="utf-8") as f:
            return next(csv.reader(f), [])
    except OSError:
        return []


def info() -> dict:
    return {
        "provider": PROVIDER, "uses_ai_model": False, "limits": LIMITS,
        "datasets": [{"label": d["label"], "file": d["file"], "columns": _columns(d["file"])} for d in DATASETS],
    }


def _unique_name(db: Session, name: str) -> str:
    taken = {n for (n,) in db.query(Workflow.name).all()}
    candidate, n = name, 1
    while candidate in taken:
        n += 1
        candidate = f"{name} ({n})"
    return candidate


RECONCILE = r"reconcil\w*|compare|comparing|match|matching|cross-?check|versus|vs"


def _propose_reconcile(db: Session, request: str, text: str, base: dict) -> dict:
    """A request to compare two sources. Only the courier-versus-bank pair is known, so say so plainly otherwise."""
    left_hit = _has(text, PAIR["left"]["words"])
    right_hit = _has(text, PAIR["right"]["words"])
    if not (left_hit and right_hit):
        return {**base, "message": "I can build a reconciliation for one pair of sample files: courier collections against bank deposits. "
                "Mention both, for example: \"Reconcile courier collections with bank deposits and alert finance if anything does not match.\" "
                "For your own two files, use the template 'COD Reconciliation' and choose your files when you run it."}
    wants_alert = _has(text, r"alert|notif\w*|warn|tell|inform|e-?mail|message|let me know|flag|ping")
    L, R = PAIR["left"], PAIR["right"]
    tol = 0.01
    m = re.search(r"\b(?:within|tolerance of|up to|allow\w*)\s+(\d{1,4}(?:\.\d{1,2})?)\b", text)
    if m:
        tol = float(m.group(1))
    recipient = next(iter(EMAIL.findall(request)), None) or L["alert_to"]
    blocks = [
        ("trigger", "Start", {}, "Every workflow needs a start. It begins when you click Run."),
        ("load_csv", "Courier collections", {"file": L["file"], "table": "courier"}, f"You mentioned courier collections, so I chose {L['file']}."),
        ("load_csv", "Bank deposits", {"file": R["file"], "table": "bank"}, f"You mentioned bank deposits, so I chose {R['file']}."),
        ("compare", "Match collections to deposits",
         {"left": "courier", "right": "bank", "left_key": PAIR["left_key"], "right_key": PAIR["right_key"],
          "left_amount": PAIR["left_amount"], "right_amount": PAIR["right_amount"], "tolerance": tol},
         f"Matches each waybill to its bank reference and compares the amounts, allowing a difference of {tol:g}. "
         "Everything that does not agree is listed with a reason."),
    ]
    if wants_alert:
        blocks += [("condition", "Any exceptions?", {"field": "exceptions", "op": ">", "value": 0},
                    "You want an alert only when something does not match, so this step checks if there are any exceptions."),
                   ("notify", f"Alert {recipient.split('@')[0]}", {"to": recipient, "message": "Collections and deposits do not fully match"},
                    f"Sends the alert to {recipient} (recorded in the run log; nothing is emailed).")]
    blocks += [("report", "Excel report", {"table": "courier"}, "Writes an Excel workbook that includes an Exceptions sheet."),
               ("end", "Done", {}, "Marks the end of the workflow.")]
    ids = [f"s{i}" for i in range(1, len(blocks) + 1)]
    steps, notes = [], []
    for i, (typ, name, cfg, why) in enumerate(blocks):
        step = {"id": ids[i], "type": typ, "name": name, "config": dict(cfg)}
        if typ == "condition":
            step["config"]["on_true"], step["config"]["on_false"] = ids[i + 1], ids[i + 2]
        if typ == "notify":
            step["next"] = ids[i + 1]
        steps.append(step)
        notes.append({"step": name, "why": why})
    definition, errors = clean_definition(steps)
    if errors:
        return {**base, "message": "I built a draft that did not pass the safety check: " + "; ".join(errors)}
    warnings = ["Matching is one row to one row on the waybill number. Many-to-one matching (one deposit for many parcels) is not supported."]
    if _has(text, r"every|daily|weekly|monthly|hourly|schedule\w*"):
        warnings.append("The assistant does not set schedules. Save the workflow, then add a schedule on the Schedules page.")
    return {
        "status": "ok", "request": request, "provider": PROVIDER, "uses_ai_model": False,
        "name": _unique_name(db, "COD reconciliation" + (" and alert" if wants_alert else "")), "category": "Finance",
        "description": f"Built by the assistant from: \"{request.strip()[:300]}\"",
        "dataset": {"label": "Courier collections and bank deposits", "file": f"{L['file']} + {R['file']}", "columns": _columns(L["file"])},
        "steps": definition["steps"], "reasons": notes, "warnings": warnings,
    }


def propose(db: Session, request: str) -> dict:
    text = " ".join(request.lower().split())
    base = {"status": "needs_detail", "request": request, "provider": PROVIDER, "uses_ai_model": False,
            "steps": [], "reasons": [], "warnings": []}
    if _has(text, RECONCILE):
        return _propose_reconcile(db, request, text, base)
    return {**base, "message": "I build reconciliation workflows. Describe what to compare, for example: "
            "\"Reconcile courier collections with bank deposits and alert finance if anything does not match.\" "
            "For your own two files, use the template 'COD Reconciliation' and choose your files when you run it."}


# ---------- Explain a workflow ----------

OP_WORDS = {">": "is more than", ">=": "is at least", "<": "is less than", "<=": "is at most", "==": "equals", "!=": "is not"}
TRANSFORM_WORDS = {"trim_text": "trims extra spaces", "drop_duplicates": "removes duplicate rows",
                   "drop_missing": "removes rows with empty cells", "drop_invalid_numbers": "removes rows where a number column holds text",
                   "normalize_amounts": "turns amounts written as text into numbers", "parse_dates": "makes dates one format (YYYY-MM-DD)",
                   "standardize_text": "tidies text (trim, single spaces, capitals)"}
FIELD_WORDS = {"matched_rows": "rows that matched", "missing_in_right": "rows missing in the second table",
               "missing_in_left": "rows missing in the first table", "amount_mismatches": "amount differences",
               "duplicate_keys": "duplicate keys", "unreadable_amounts": "unreadable amounts", "exceptions": "exceptions",
               "amount_difference": "total amount difference", "unmatched_amount": "unmatched amount",
               "values_fixed": "values reformatted", "values_unreadable": "values that could not be read",
               "invalid_rows": "problem rows", "missing_values": "empty cells", "duplicate_rows": "duplicate rows",
               "invalid_values": "non-numeric values", "rows_loaded": "rows loaded", "rows_after_cleaning": "rows left after cleaning"}


def _describe(step: dict, names: dict) -> str:
    t, c = step["type"], step.get("config", {})
    if t == "trigger":
        return "Starts the workflow when a file is uploaded." if c.get("kind") == "upload" else "Starts the workflow when you click Run."
    if t == "load_csv":
        table = c.get("table") or "main"
        if c.get("input"):
            return f"Asks you to choose a file when you run the workflow, and reads it into the table '{table}'."
        return f"Reads the file {c.get('file', '?')} into the table '{table}'."
    if t == "compare":
        s = (f"Matches the rows of '{c.get('left')}' to '{c.get('right')}' using {c.get('left_key')} and {c.get('right_key')}")
        if c.get("left_amount"):
            s += f", and checks that {c['left_amount']} and {c['right_amount']} agree within {c.get('tolerance', 0.01):g}"
        return s + ". Everything that does not agree becomes an exception with a reason."
    if t == "validate":
        parts = []
        if c.get("required_columns"):
            parts.append("checks that these columns exist and are filled in: " + ", ".join(c["required_columns"]))
        else:
            parts.append("checks every column for empty cells")
        if c.get("numeric_columns"):
            parts.append("checks that " + ", ".join(c["numeric_columns"]) + " hold numbers")
        parts.append("fails the run if any row is incomplete" if c.get("fail_on_errors") else "records the problems and carries on")
        return parts[0][0].upper() + parts[0][1:] + "; " + "; ".join(parts[1:]) + "."
    if t == "condition":
        field = FIELD_WORDS.get(c.get("field"), c.get("field"))
        return (f"Asks: {field} {OP_WORDS.get(c.get('op'), c.get('op'))} {c.get('value')}? "
                f"If yes, goes to '{names.get(c.get('on_true'), '?')}'; if no, goes to '{names.get(c.get('on_false'), '?')}'.")
    if t == "transform":
        ops = [TRANSFORM_WORDS.get(o, o) for o in c.get("operations", [])]
        return ("Cleans the data: " + ", ".join(ops) + ".") if ops else "Does not change the data (no cleaning options chosen)."
    if t == "notify":
        return f"Records a notification for {c.get('to') or 'the team'}: \"{c.get('message', '')}\". Nothing is actually sent."
    if t == "report":
        return "Writes a summary report and the processed data as downloadable files."
    return "Marks the end of the workflow."


def explain(db: Session, wf: Workflow) -> dict:
    steps = wf.definition.get("steps", [])
    names = {s["id"]: s.get("name", s["id"]) for s in steps}
    types = [s["type"] for s in steps]
    loaded = [s["config"].get("file") for s in steps if s["type"] == "load_csv"]
    summary = f"{wf.name} has {len(steps)} steps"
    if loaded:
        summary += f" and works on {loaded[0]}"
    summary += "."
    if "condition" in types:
        summary += " It can take different paths depending on what it finds in the data."

    ideas = []
    val = [s for s in steps if s["type"] == "validate"]
    if "load_csv" in types and not val:
        ideas.append("Add a Check step after loading the file, so bad data is caught early with a clear message.")
    for s in val:
        c = s.get("config", {})
        if not c.get("required_columns"):
            ideas.append(f"'{names[s['id']]}' has no required columns. List them so a missing column is reported by name.")
        if c.get("fail_on_errors") and s.get("retries"):
            ideas.append(f"'{names[s['id']]}' is strict and has retries. A retry reads the same file and gives the same answer, "
                         "so retries only help steps that can fail for a short time, such as loading a file.")
    if "report" not in types and "load_csv" in types:
        ideas.append("Add a Report step so each run leaves a summary you can download.")
    if "end" not in types:
        ideas.append("Add an End step so the final point of the workflow is clear.")
    if "notify" in types:
        ideas.append("Notifications are only recorded in the run log. Nothing is emailed yet.")
    if not wf.enabled:
        ideas.append("This workflow is disabled. Enable it on the Workflows page before you run it.")

    done = db.query(Execution).filter(Execution.workflow_id == wf.id, Execution.status.notin_(("running", "queued"))).order_by(Execution.started_at.desc()).all()
    failed = [e for e in done if e.status == "failed"]
    history = {"runs": len(done), "failed": len(failed),
               "success_rate": round(100 * (len(done) - len(failed)) / len(done), 1) if done else None,
               "last_error": failed[0].error_message if failed else None}
    if failed:
        ideas.append(f"{len(failed)} of {len(done)} runs failed. Open the Failure insights tab for advice on the common causes.")
    return {"workflow_id": wf.id, "name": wf.name, "summary": summary, "provider": PROVIDER,
            "steps": [{"id": s["id"], "name": s.get("name", s["id"]), "type": s["type"], "text": _describe(s, names)} for s in steps],
            "suggestions": ideas, "history": history}


# ---------- Failure insights ----------

ADVICE = [
    (r"missing required columns", "The file does not have the columns this workflow expects. Check the header row of the file, or change the required columns in the Check step."),
    (r"fail_on_errors", "A strict check stopped the run because some rows have empty cells. Fix those rows, or turn off 'stop on errors' and let a Condition decide what happens."),
    (r"was not found", "The CSV file could not be found. Choose an existing sample file in the Load step, or upload the file first."),
    (r"timeout|timed out", "Loading took too long. Try again, or use a smaller file."),
    (r"larger than|more than .* rows", "The file is over the size limit (5 MB or 50,000 rows). Split it into smaller files."),
    (r"could not be read", "The file is not a plain comma-separated CSV. Re-save it as CSV and try again."),
    (r"no data loaded", "A step needs data but nothing was loaded yet. Put a Load CSV step before it."),
    (r"invalid workflow definition|unknown field|unsupported", "The workflow itself has a problem. Open it in the Builder and fix the step named in the log."),
]


def _advice(reason: str) -> str:
    for pattern, text in ADVICE:
        if re.search(pattern, reason, re.I):
            return text
    return "Open the failed run in Executions and read the step log to see which step stopped it."


def failures(db: Session, days: int = 14, source: str = "all") -> dict:
    runs = _finished(db, days, source)
    failed = [e for e in runs if e.status == "failed"]
    groups: dict[str, dict] = defaultdict(lambda: {"count": 0, "workflows": defaultdict(int), "example": None})
    for e in failed:
        g = groups[_reason(e.error_message)]
        g["count"] += 1
        g["workflows"][e.workflow.name] += 1
        g["example"] = g["example"] or e.id
    items = [{"reason": r, "count": g["count"], "workflows": [w for w, _ in sorted(g["workflows"].items(), key=lambda x: -x[1])],
              "example_execution_id": g["example"], "advice": _advice(r)}
             for r, g in sorted(groups.items(), key=lambda kv: -kv[1]["count"])]
    if not failed:
        headline = f"No failed runs in the last {days} days ({len(runs)} finished runs)." if runs else f"No finished runs in the last {days} days."
    else:
        pct = round(100 * len(failed) / len(runs), 1)
        headline = f"{len(failed)} of {len(runs)} runs failed in the last {days} days ({pct}%). The most common cause: {items[0]['reason']}."
    return {"days": days, "source": source, "provider": PROVIDER, "total_runs": len(runs), "total_failed": len(failed),
            "headline": headline, "items": items}
