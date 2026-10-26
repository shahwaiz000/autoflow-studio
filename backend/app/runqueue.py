"""Background run queue: start a run, get an answer straight away, and watch it finish.

One worker thread runs the queued workflows one after another (this keeps SQLite simple and
the order fair). The queue lives in memory, so a restart cannot continue a waiting run;
on start-up, anything left "queued" or "running" is marked failed with a clear reason."""
import logging
import queue
import threading

from sqlalchemy.orm import Session

from .engine import create_execution, execute
from .models import Execution, Workflow, iso, utcnow

log = logging.getLogger("autoflow.queue")
MAX_WAITING = 50


class QueueFull(Exception):
    pass


class RunQueue:
    def __init__(self, session_factory, max_waiting: int = MAX_WAITING):
        self.session_factory = session_factory
        self._q: queue.Queue = queue.Queue(maxsize=max_waiting)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.current: int | None = None  # execution id being run right now
        self.finished_count = 0

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    @property
    def waiting(self) -> int:
        return self._q.qsize()

    def submit(self, db: Session, wf: Workflow, trigger_type: str = "manual") -> Execution:
        """Record the run as 'queued' and hand it to the worker. The steps are read when the run starts."""
        if self._q.full():
            raise QueueFull(f"{MAX_WAITING} runs are already waiting. Try again in a moment")
        ex = create_execution(db, wf, trigger_type, status="queued")
        self._q.put_nowait(ex.id)
        return ex

    def start(self):
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="autoflow-queue", daemon=True)
        self._thread.start()
        log.info("Run queue started")

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self):
        while not self._stop.is_set():
            try:
                eid = self._q.get(timeout=0.5)
            except queue.Empty:
                continue
            self.run_one(eid)

    def run_one(self, eid: int):
        self.current = eid
        try:
            with self.session_factory() as db:
                ex = db.get(Execution, eid)
                if ex is not None and ex.status == "queued":
                    execute(db, ex)
        except Exception:  # the worker must survive any one bad run
            log.exception("Queued run %s crashed", eid)
            with self.session_factory() as db:
                ex = db.get(Execution, eid)
                if ex is not None and ex.status in ("queued", "running"):
                    ex.status, ex.error_message, ex.finished_at = "failed", "Unexpected error while running in the background", utcnow()
                    db.commit()
        finally:
            self.current = None
            self.finished_count += 1

    def status(self) -> dict:
        return {"running": self.running, "waiting": self.waiting, "current_execution_id": self.current,
                "finished_since_start": self.finished_count, "max_waiting": MAX_WAITING,
                "note": "Waiting runs are lost if the backend restarts. They are then marked as failed."}


def recover_interrupted(db: Session) -> int:
    """Runs left over from a previous backend session can never finish. Say so instead of showing them as busy forever."""
    stale = db.query(Execution).filter(Execution.status.in_(("queued", "running"))).all()
    for ex in stale:
        ex.status, ex.finished_at = "failed", utcnow()
        ex.error_message = "Interrupted: the backend was restarted before this run finished"
    db.commit()
    return len(stale)


runner: RunQueue | None = None
