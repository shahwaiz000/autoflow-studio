"""Dashboard metrics, computed from stored executions (not hardcoded)."""
import csv
import io
import re
from collections import Counter, defaultdict
from datetime import timedelta

from sqlalchemy.orm import Session

from .models import Execution, Workflow, utcnow


def _reason(msg: str | None) -> str:
    text = (msg or "Unknown").split("failed: ")[-1]
    return re.sub(r"\d+", "N", text)[:70]


def dashboard(db: Session, days: int = 14) -> dict:
    execs = db.query(Execution).order_by(Execution.started_at.desc()).all()
    done = [e for e in execs if e.status in ("success", "failed")]
    ok = [e for e in done if e.status == "success"]
    durations = [e.duration_seconds for e in done if e.duration_seconds is not None]
    today = utcnow().date()
    trend = {today - timedelta(days=i): {"success": 0, "failed": 0} for i in range(days - 1, -1, -1)}
    for e in done:
        d = e.started_at.date()
        if d in trend:
            trend[d][e.status] += 1
    per_wf = defaultdict(lambda: {"runs": 0, "failed": 0, "total_duration": 0.0})
    for e in done:
        p = per_wf[e.workflow.name]
        p["runs"] += 1
        p["failed"] += e.status == "failed"
        p["total_duration"] += e.duration_seconds or 0
    reasons = Counter(_reason(e.error_message) for e in done if e.status == "failed")
    return {
        "totals": {
            "workflows": db.query(Workflow).count(),
            "enabled_workflows": db.query(Workflow).filter_by(enabled=True).count(),
            "executions": len(execs), "successful": len(ok),
            "failed": len(done) - len(ok),
            "running": sum(e.status in ("running", "queued") for e in execs),
            "success_rate": round(100 * len(ok) / len(done), 1) if done else None,
            "avg_duration_seconds": round(sum(durations) / len(durations), 1) if durations else None,
        },
        "data_source": {"demo_executions": sum(e.is_demo for e in execs),
                        "live_executions": sum(not e.is_demo for e in execs)},
        "trend": [{"date": d.isoformat(), **v} for d, v in trend.items()],
        "recent": [e.to_dict() for e in execs[:6]],
        "workflow_performance": sorted(
            [{"workflow": n, "runs": p["runs"], "failed": p["failed"],
              "avg_duration_seconds": round(p["total_duration"] / p["runs"], 1)} for n, p in per_wf.items()],
            key=lambda x: -x["runs"]),
        "failure_reasons": [{"reason": r, "count": c} for r, c in reasons.most_common(5)],
    }


def _finished(db: Session, days: int, source: str) -> list[Execution]:
    q = db.query(Execution).filter(Execution.started_at >= utcnow() - timedelta(days=days),
                                   Execution.status.notin_(("running", "queued")))
    if source != "all":
        q = q.filter(Execution.is_demo.is_(source == "demo"))
    return q.order_by(Execution.started_at.desc()).all()


def report(db: Session, days: int = 14, source: str = "all") -> dict:
    execs = _finished(db, days, source)
    ok = [e for e in execs if e.status == "success"]
    durs = [e.duration_seconds for e in execs if e.duration_seconds is not None]
    today = utcnow().date()
    daily = {today - timedelta(days=i): {"success": 0, "failed": 0, "durs": []} for i in range(days - 1, -1, -1)}
    for e in execs:
        d = daily.get(e.started_at.date())
        if d is not None:
            d[e.status] += 1
            if e.duration_seconds is not None:
                d["durs"].append(e.duration_seconds)
    per_wf = defaultdict(lambda: {"runs": 0, "failed": 0, "dur": 0.0})
    for e in execs:
        p = per_wf[e.workflow.name]
        p["runs"] += 1
        p["failed"] += e.status == "failed"
        p["dur"] += e.duration_seconds or 0
    return {
        "days": days, "source": source,
        "totals": {"executions": len(execs), "successful": len(ok), "failed": len(execs) - len(ok),
                   "success_rate": round(100 * len(ok) / len(execs), 1) if execs else None,
                   "avg_duration_seconds": round(sum(durs) / len(durs), 1) if durs else None},
        "daily": [{"date": d.isoformat(), "success": v["success"], "failed": v["failed"],
                   "avg_duration_seconds": round(sum(v["durs"]) / len(v["durs"]), 1) if v["durs"] else None}
                  for d, v in daily.items()],
        "workflows": sorted(
            [{"workflow": n, "runs": p["runs"], "failed": p["failed"],
              "success_rate": round(100 * (p["runs"] - p["failed"]) / p["runs"], 1),
              "avg_duration_seconds": round(p["dur"] / p["runs"], 1)} for n, p in per_wf.items()],
            key=lambda x: -x["runs"]),
        "failure_reasons": [{"reason": r, "count": c} for r, c in
                            Counter(_reason(e.error_message) for e in execs if e.status == "failed").most_common(8)],
        "triggers": [{"trigger": t, "count": c} for t, c in Counter(e.trigger_type for e in execs).most_common()],
    }


def safe_cell(value) -> str:
    """Stop spreadsheet programs from treating text as a formula (CSV injection)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def export_csv(db: Session, days: int = 14, source: str = "all") -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["execution_id", "workflow", "status", "trigger", "started_at_utc", "duration_seconds", "error", "demo_data"])
    for e in _finished(db, days, source):
        w.writerow([e.id, safe_cell(e.workflow.name), e.status, e.trigger_type, e.started_at.isoformat(),
                    e.duration_seconds, safe_cell(e.error_message), "yes" if e.is_demo else "no"])
    return out.getvalue()
