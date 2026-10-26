"""Dashboard numbers, computed from stored reconciliation results (not hardcoded)."""
import re
from collections import Counter
from datetime import timedelta

from sqlalchemy.orm import Session

from .models import Execution, Workflow, utcnow


def _reason(msg: str | None) -> str:
    text = (msg or "Unknown").split("failed: ")[-1]
    return re.sub(r"\d+", "N", text)[:70]


def _reconciliation(e: Execution) -> dict | None:
    """The first comparison of a run, or None when the run did not reconcile anything."""
    comps = ((e.result.details if e.result else None) or {}).get("comparisons") or []
    return comps[0] if comps else None


def _at_risk(m: dict) -> float:
    return round(float(m.get("amount_difference") or 0) + float(m.get("unmatched_amount") or 0), 2)


def dashboard(db: Session, days: int = 30) -> dict:
    """What a finance team wants to see: how the latest reconciliation went, how it is trending, what is wrong."""
    execs = db.query(Execution).order_by(Execution.started_at.desc()).all()
    done = [e for e in execs if e.status in ("success", "failed")]
    recon = [e for e in done if e.status == "success" and _reconciliation(e)]
    today = utcnow().date()
    trend = {today - timedelta(days=i): {"runs": 0, "matched": 0, "exceptions": 0} for i in range(days - 1, -1, -1)}
    for e in recon:
        d = trend.get(e.started_at.date())
        if d is not None:
            m = e.result.metrics
            d["runs"] += 1
            d["matched"] += int(m.get("matched_rows") or 0)
            d["exceptions"] += int(m.get("exceptions") or 0)
    latest = None
    if recon:
        e = recon[0]
        m, c = e.result.metrics, _reconciliation(e)
        rows = int(c.get("left_rows") or 0)
        latest = {"execution_id": e.id, "workflow": e.workflow.name, "started_at": e.started_at.isoformat(),
                  "left": c.get("left"), "right": c.get("right"), "rows": rows,
                  "matched_rows": int(m.get("matched_rows") or 0), "exceptions": int(m.get("exceptions") or 0),
                  "match_rate": round(100 * int(m.get("matched_rows") or 0) / rows, 1) if rows else None,
                  "amount_at_risk": _at_risk(m), "by_kind": c.get("counts", {})}
    since = utcnow() - timedelta(days=days)
    kinds = Counter()
    for e in recon:
        if e.started_at >= since:
            kinds.update({k: n for k, n in (_reconciliation(e).get("counts") or {}).items() if n})
    # Only a failure that happened after the latest good reconciliation is still worth a warning.
    failed = [e for e in done if e.status == "failed" and (not recon or e.started_at > recon[0].started_at)]
    return {
        "days": days,
        "totals": {"reconciliations": len(recon), "runs": len(done), "failed": sum(e.status == "failed" for e in done),
                   "running": sum(e.status in ("running", "queued") for e in execs),
                   "workflows": db.query(Workflow).count()},
        "latest": latest,
        "trend": [{"date": d.isoformat(), **v} for d, v in trend.items()],
        "exceptions_by_kind": dict(kinds),
        "recent": [e.to_dict() for e in execs[:6]],
        "last_failure": {"execution_id": failed[0].id, "workflow": failed[0].workflow.name,
                         "reason": failed[0].error_message} if failed else None,
    }


def _finished(db: Session, days: int, source: str) -> list[Execution]:
    q = db.query(Execution).filter(Execution.started_at >= utcnow() - timedelta(days=days),
                                   Execution.status.notin_(("running", "queued")))
    if source != "all":
        q = q.filter(Execution.is_demo.is_(source == "demo"))
    return q.order_by(Execution.started_at.desc()).all()


def safe_cell(value) -> str:
    """Stop spreadsheet programs from treating text as a formula (CSV injection)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text
