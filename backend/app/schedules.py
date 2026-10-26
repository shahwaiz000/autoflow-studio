"""Scheduling: run a workflow every N minutes, daily, or weekly.

A small background thread checks the schedules table every few seconds and runs
whatever is due. No extra packages. Honest limits: it only runs while the backend
is running, and a run that was missed while the backend was off is run once on
start-up, not repeated."""
import logging
import threading
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .engine import required_inputs, run_workflow
from .models import Schedule, Workflow, utcnow

log = logging.getLogger("autoflow.scheduler")

KINDS = ("interval", "daily", "weekly")
MIN_INTERVAL, MAX_INTERVAL = 5, 7 * 24 * 60
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def parse_time(text: str | None) -> tuple[int, int]:
    try:
        h, m = (text or "").split(":")
        h, m = int(h), int(m)
    except ValueError:
        raise ValueError("Time must look like 08:30")
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("Time must look like 08:30")
    return h, m


def check(kind: str, interval_minutes, time_of_day, weekday, tz_offset_minutes) -> list[str]:
    errs: list[str] = []
    if kind not in KINDS:
        return ["Choose how often: every N minutes, daily, or weekly"]
    if not -840 <= tz_offset_minutes <= 840:
        errs.append("Time zone offset is out of range")
    if kind == "interval":
        if interval_minutes is None or not MIN_INTERVAL <= interval_minutes <= MAX_INTERVAL:
            errs.append(f"Repeat every {MIN_INTERVAL} to {MAX_INTERVAL} minutes")
    else:
        try:
            parse_time(time_of_day)
        except ValueError as e:
            errs.append(str(e))
        if kind == "weekly" and (weekday is None or not 0 <= weekday <= 6):
            errs.append("Choose a day of the week")
    return errs


def next_run(s: Schedule, after: datetime) -> datetime:
    """Next run strictly after `after` (naive UTC)."""
    if s.kind == "interval":
        return after + timedelta(minutes=s.interval_minutes or MIN_INTERVAL)
    h, m = parse_time(s.time_of_day)
    local = after + timedelta(minutes=s.tz_offset_minutes)  # the person's wall clock
    cand = local.replace(hour=h, minute=m, second=0, microsecond=0)
    if s.kind == "weekly":
        cand += timedelta(days=(s.weekday - cand.weekday()) % 7)
    step = timedelta(days=1 if s.kind == "daily" else 7)
    while cand <= local:
        cand += step
    return cand - timedelta(minutes=s.tz_offset_minutes)


def describe(s: Schedule) -> str:
    if s.kind == "interval":
        n = s.interval_minutes or 0
        return f"Every {n} minutes" if n < 60 or n % 60 else f"Every {n // 60} hour{'s' if n > 60 else ''}"
    sign = "+" if s.tz_offset_minutes >= 0 else "-"
    z = abs(s.tz_offset_minutes)
    tz = f"UTC{sign}{z // 60}" + (f":{z % 60:02d}" if z % 60 else "")
    if s.kind == "daily":
        return f"Every day at {s.time_of_day} ({tz})"
    return f"Every {DAYS[s.weekday]} at {s.time_of_day} ({tz})"


def create(db: Session, wf: Workflow, kind, interval_minutes, time_of_day, weekday, tz_offset_minutes, now=None) -> Schedule:
    s = Schedule(workflow=wf, kind=kind, tz_offset_minutes=tz_offset_minutes,
                 interval_minutes=interval_minutes if kind == "interval" else None,
                 time_of_day=time_of_day if kind != "interval" else None,
                 weekday=weekday if kind == "weekly" else None)
    s.next_run_at = next_run(s, now or utcnow())
    db.add(s)
    db.commit()
    return s


def run_due(db: Session, now: datetime | None = None) -> list[dict]:
    """Run every enabled schedule whose time has come. Returns what happened."""
    now = now or utcnow()
    done = []
    due = db.query(Schedule).filter(Schedule.enabled.is_(True), Schedule.next_run_at <= now).all()
    for s in due:
        wf = s.workflow
        s.last_run_at = now
        if not wf.enabled:
            s.last_status = "Skipped: the workflow is disabled"
        elif required_inputs(wf.definition):  # nobody is there to choose the files
            s.last_status = "Skipped: this workflow needs files chosen when it runs"
        else:
            try:
                ex = run_workflow(db, wf, "schedule")
                s.last_execution_id = ex.id
                s.last_status = "Success" if ex.status == "success" else f"Failed: {ex.error_message or 'see the run'}"[:200]
            except Exception as e:  # one broken schedule must not stop the others
                log.exception("Schedule %s failed", s.id)
                s.last_status = f"Error: {e}"[:200]
        s.next_run_at = next_run(s, now)  # run once, never a pile of missed runs
        db.commit()
        done.append({"schedule_id": s.id, "workflow": wf.name, "status": s.last_status,
                     "execution_id": s.last_execution_id})
    return done


class Scheduler:
    def __init__(self, session_factory, tick_seconds: int):
        self.session_factory, self.tick = session_factory, tick_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_tick: datetime | None = None

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self):
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="autoflow-scheduler", daemon=True)
        self._thread.start()
        log.info("Scheduler started (checks every %s seconds)", self.tick)

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self):
        while not self._stop.is_set():
            try:
                with self.session_factory() as db:
                    run_due(db)
                self.last_tick = utcnow()
            except Exception:
                log.exception("Scheduler tick failed")
            self._stop.wait(self.tick)


scheduler: Scheduler | None = None
