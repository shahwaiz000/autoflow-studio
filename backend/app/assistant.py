"""Built-in assistant. It uses plain rules, NOT an AI language model.

It turns a plain-English request into a workflow made only of the engine's own
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
    dict(label="Invoices", noun="invoice", file="invoices.csv", category="Finance", alert_to="finance@example.com",
         words=r"invoices?|bills?|vendors?|payables?|payments?", required=["invoice_id", "vendor", "amount"], numeric=["amount"]),
    dict(label="New hires", noun="new-hire", file="employees.csv", category="HR", alert_to="hr@example.com",
         words=r"employees?|hires?|hiring|onboarding|staff|hr|joiners?", required=["employee_id", "name", "department"], numeric=[]),
    dict(label="Customers", noun="customer", file="customers.csv", category="Data", alert_to="support@example.com",
         words=r"customers?|clients?|contacts?|mailing list|email list", required=["customer_id", "email"], numeric=[]),
    dict(label="Sales orders", noun="sales order", file="sales_orders.csv", category="Sales", alert_to="sales@example.com",
         words=r"sales|orders?|revenue|regions?", required=["order_id", "region", "revenue"], numeric=["revenue", "units"]),
]

LIMITS = [
    "It follows rules and keywords. It is not an AI language model and does not understand every sentence.",
    "It can only build workflows from the four sample CSV files and the built-in step types.",
    "Notifications are recorded in the run log only. Nothing is emailed or sent.",
    "Scheduling is not built yet, so workflows run when you click Run.",
]

PROBLEM = r"missing|incomplete|problems?|errors?|issues?|invalid|empty|blank|wrong|bad|broken"
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


def _pick_dataset(text: str):
    hits = []
    for d in DATASETS:
        found = [m.start() for m in re.finditer(rf"\b(?:{d['words']})\b", text)]
        if found:
            hits.append((-len(found), found[0], d))
    hits.sort(key=lambda h: (h[0], h[1]))
    return (hits[0][2], [h[2] for h in hits[1:]]) if hits else (None, [])


def _unique_name(db: Session, name: str) -> str:
    taken = {n for (n,) in db.query(Workflow.name).all()}
    candidate, n = name, 1
    while candidate in taken:
        n += 1
        candidate = f"{name} ({n})"
    return candidate


def propose(db: Session, request: str) -> dict:
    text = " ".join(request.lower().split())
    ds, others = _pick_dataset(text)
    base = {"status": "needs_detail", "request": request, "provider": PROVIDER, "uses_ai_model": False,
            "steps": [], "reasons": [], "warnings": []}
    if ds is None:
        return {**base, "message": "I could not tell which data you want to work with. Mention one of: "
                + ", ".join(d["label"].lower() for d in DATASETS) + ". For example: \"Check invoices and alert finance if any are incomplete.\""}

    warnings = []
    if others:
        warnings.append(f"A workflow uses one file, so I used {ds['file']}. I ignored: " + ", ".join(o["file"] for o in others) + ".")
    if _has(text, r"every|daily|weekly|monthly|hourly|each (?:day|week|month|morning)|schedule\w*|at \d{1,2}(?::\d{2})? ?(?:am|pm)"):
        warnings.append("Scheduling is not built yet. This workflow runs when you click Run.")
    if _has(text, r"slack|sms|whatsapp|teams|telegram|database|sql|sap|api|excel|xlsx|sharepoint|google sheets?|pdf"):
        warnings.append("Only CSV files are supported, so I used a sample CSV. Other systems are not connected.")

    wants_alert = _has(text, r"alert|notif\w*|warn|tell|inform|e-?mail|message|let me know|remind|flag|ping")
    only_on_problem = wants_alert and _has(text, PROBLEM) and _has(text, r"only|if|when|whenever|unless|once|any")
    strict = _has(text, r"strict|stop|fail|block|reject|halt|abort|must be complete")
    wants_clean = _has(text, r"clean\w*|tidy|dedup\w*|duplicates?|trim|remove|fix|normali[sz]e|spaces")
    wants_retry = _has(text, r"retry|retries|try again|again")
    recipient = next(iter(EMAIL.findall(request)), None) or ds["alert_to"]

    threshold, op = 0, ">"
    m = re.search(r"\b(more than|over|above|greater than|exceed\w*|at least)\s+(\d{1,6})\b", text)
    if m and only_on_problem:
        threshold, op = int(m.group(2)), ">=" if m.group(1) == "at least" else ">"

    wants_check = _has(text, r"check|validate|verif\w*|audit|inspect|review|find")
    if strict and only_on_problem:
        strict = False
        warnings.append("You asked both to stop and to alert. A run that stops cannot send an alert afterwards, "
                        "so I kept the alert and did not stop the run.")

    load_why = f"You mentioned {ds['label'].lower()}, so I chose the sample file {ds['file']}."
    if wants_retry:
        load_why += " You asked to try again, so loading is retried up to 2 times."
    blocks = [("trigger", "Start", {}, "Every workflow needs a start. It begins when you click Run.", 0),
              ("load_csv", f"Load {ds['label'].lower()}", {"file": ds["file"]}, load_why, 2 if wants_retry else 0)]
    vcfg = {"required_columns": ds["required"], "numeric_columns": ds["numeric"], "fail_on_errors": bool(strict)}
    why = "A check step makes sure the file has the columns " + ", ".join(ds["required"]) + " and finds empty cells."
    if ds["numeric"]:
        why += " It also checks that " + ", ".join(ds["numeric"]) + " hold numbers."
    if strict:
        why += " You asked to stop on problems, so the run fails when any row is incomplete."
    blocks.append(("validate", f"Check {ds['noun']} data", vcfg, why, 0))

    if wants_clean:
        ops = []
        if _has(text, r"trim|spaces|tidy|clean\w*|normali[sz]e"):
            ops.append("trim_text")
        if _has(text, r"dedup\w*|duplicates?|clean\w*|tidy"):
            ops.append("drop_duplicates")
        if _has(text, r"empty|blank|missing|incomplete|clean\w*|tidy"):
            ops.append("drop_missing")
        if ds["numeric"] and _has(text, r"invalid|non-?numeric|not numbers?|text in"):
            ops.append("drop_invalid_numbers")
        defaulted = not ops
        if defaulted:
            ops = ["trim_text", "drop_duplicates", "drop_missing"]
        cfg = {"operations": ops, "numeric_columns": ds["numeric"] if "drop_invalid_numbers" in ops else []}
        why = "You asked to clean the data, so this step applies: " + ", ".join(o.replace("_", " ") for o in ops) + "."
        if defaulted:
            why += " You did not name specific fixes, so I used the usual three."
        blocks.append(("transform", "Clean data", cfg, why, 0))

    if only_on_problem:
        blocks.append(("condition", "Any problem rows?", {"field": "invalid_rows", "op": op, "value": threshold},
                       f"You want an alert only when there are problems, so this step checks if problem rows are {op} {threshold}.", 0))
        blocks.append(("notify", f"Alert {recipient.split('@')[0]}", {"to": recipient, "message": f"Some {ds['label'].lower()} have problems"},
                       f"Sends the alert to {recipient} (recorded in the run log; nothing is emailed).", 0))
    elif wants_alert:
        blocks.append(("notify", f"Notify {recipient.split('@')[0]}", {"to": recipient, "message": f"{ds['label']} check finished"},
                       f"You asked for a notification, so one goes to {recipient} (recorded in the run log; nothing is emailed).", 0))

    blocks.append(("report", "Generate report", {}, "Writes a summary and the processed data, so every run leaves a result you can download.", 0))
    blocks.append(("end", "Done", {}, "Marks the end of the workflow.", 0))

    ids = [f"s{i}" for i in range(1, len(blocks) + 1)]
    steps, notes = [], []
    for i, (typ, name, cfg, why, retries) in enumerate(blocks):
        step = {"id": ids[i], "type": typ, "name": name, "config": dict(cfg)}
        if retries:
            step["retries"] = retries
        if typ == "condition":  # true -> the alert, false -> skip it to the step after the alert
            step["config"]["on_true"], step["config"]["on_false"] = ids[i + 1], ids[i + 2]
        if typ == "notify" and only_on_problem:
            step["next"] = ids[i + 1]
        steps.append(step)
        notes.append({"step": name, "why": why})

    definition, errors = clean_definition(steps)
    if errors:  # should never happen; if it does, say so instead of offering a broken workflow
        return {**base, "message": "I built a draft that did not pass the safety check: " + "; ".join(errors)}

    actions = []
    if strict:
        actions.append("strict check")
    elif wants_check or wants_alert:
        actions.append("check")
    if wants_clean:
        actions.append("cleanup")
    if wants_alert:
        actions.append("alert")
    if not actions:
        actions.append("summary")
    name = _unique_name(db, f"{ds['label']} {' and '.join(actions)}")
    return {
        "status": "ok", "request": request, "provider": PROVIDER, "uses_ai_model": False,
        "name": name, "category": ds["category"],
        "description": f"Built by the assistant from: \"{request.strip()[:300]}\"",
        "dataset": {"label": ds["label"], "file": ds["file"], "columns": _columns(ds["file"])},
        "steps": definition["steps"], "reasons": notes, "warnings": warnings,
    }


# ---------- Explain a workflow ----------

OP_WORDS = {">": "is more than", ">=": "is at least", "<": "is less than", "<=": "is at most", "==": "equals", "!=": "is not"}
TRANSFORM_WORDS = {"trim_text": "trims extra spaces", "drop_duplicates": "removes duplicate rows",
                   "drop_missing": "removes rows with empty cells", "drop_invalid_numbers": "removes rows where a number column holds text"}
FIELD_WORDS = {"invalid_rows": "problem rows", "missing_values": "empty cells", "duplicate_rows": "duplicate rows",
               "invalid_values": "non-numeric values", "rows_loaded": "rows loaded", "rows_after_cleaning": "rows left after cleaning"}


def _describe(step: dict, names: dict) -> str:
    t, c = step["type"], step.get("config", {})
    if t == "trigger":
        return "Starts the workflow when a file is uploaded." if c.get("kind") == "upload" else "Starts the workflow when you click Run."
    if t == "load_csv":
        return f"Reads the file {c.get('file', '?')} into a table."
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

    done = db.query(Execution).filter(Execution.workflow_id == wf.id, Execution.status != "running").order_by(Execution.started_at.desc()).all()
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
