"""Reviewing exceptions: a person approves or rejects each one, and every decision is written to the audit trail.

Approve  = the difference is understood and accepted (for example a known bank fee).
Reject   = it is a real problem that needs follow-up. A note saying why is required.
Pending  = nobody has decided yet. Re-opening a decision puts it back here.
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import AuditEvent, ExecutionException, utcnow

DECISIONS = ("approved", "rejected", "pending")
NOTE_MAX = 300


def decide(db: Session, execution_id: int, ids: list[int], decision: str, note: str, actor: str) -> int:
    """Apply one decision to several exceptions of one run. Returns how many actually changed."""
    note = " ".join(note.split())[:NOTE_MAX]
    if decision == "rejected" and not note:
        raise ValueError("Please write a short note saying why this is rejected")
    rows = db.query(ExecutionException).filter(ExecutionException.execution_id == execution_id,
                                               ExecutionException.id.in_(set(ids))).all()
    if len({r.id for r in rows}) != len(set(ids)):
        raise LookupError("Some of those exceptions do not belong to this run")
    changed = 0
    for r in rows:
        before = r.decision or "pending"
        if before == decision:
            continue
        r.decision = None if decision == "pending" else decision
        r.decided_by = None if decision == "pending" else actor
        r.decided_at = None if decision == "pending" else utcnow()
        r.note = None if decision == "pending" else note or None
        action = "reopened" if decision == "pending" else decision
        detail = f"{before} -> {decision}" + (f". Note: {note}" if note else "")
        db.add(AuditEvent(actor=actor, action=action, execution_id=execution_id, exception_id=r.id, key=r.key or "", detail=detail[:400]))
        changed += 1
    db.commit()
    return changed


def counts(db: Session, execution_id: int) -> dict:
    out = {"pending": 0, "approved": 0, "rejected": 0}
    for d, n in db.query(ExecutionException.decision, func.count()).filter_by(execution_id=execution_id).group_by(ExecutionException.decision):
        out[d or "pending"] += n
    return out
