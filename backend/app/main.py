import csv
import io
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import analytics, assistant, auth, datasources, reconcile, review, runqueue, schedules, tables
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .engine import required_inputs, run_workflow
from .models import AuditEvent, Execution, ExecutionException, Schedule, User, Workflow, iso, utcnow
from .definitions import clean_definition
from .seed import seed
from .templates import TEMPLATES

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    with SessionLocal() as db:
        left = runqueue.recover_interrupted(db)
        if left:
            logging.getLogger("autoflow").warning("Marked %s interrupted run(s) as failed", left)
    # Whoever starts a background worker is the one who stops it (matters when the app is started twice, as in tests)
    own_queue = own_scheduler = None
    if not (runqueue.runner and runqueue.runner.running):
        own_queue = runqueue.runner = runqueue.RunQueue(SessionLocal)
        own_queue.start()
    if settings.scheduler_enabled and not (schedules.scheduler and schedules.scheduler.running):
        own_scheduler = schedules.scheduler = schedules.Scheduler(SessionLocal, settings.scheduler_tick_seconds)
        own_scheduler.start()
    yield
    if own_scheduler:
        own_scheduler.stop()
        if schedules.scheduler is own_scheduler:
            schedules.scheduler = None
    if own_queue:
        own_queue.stop()
        if runqueue.runner is own_queue:
            runqueue.runner = None


app = FastAPI(title="AutoFlow Studio API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"])


def _err(status: int, code: str, message: str):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


OPEN_PATHS = ("/api/health", "/api/auth/")
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    if not settings.auth_enabled or not path.startswith("/api/") or request.method == "OPTIONS":
        return await call_next(request)
    if request.method not in SAFE_METHODS:  # a page on another site must not be able to act for the person
        origin = request.headers.get("origin")
        allowed = settings.cors_origins.split(",")
        if origin and origin not in allowed and origin.split("://")[-1] != request.headers.get("host"):
            return _err(403, "bad_origin", "This request came from an unknown website")
    if any(path.startswith(p) for p in OPEN_PATHS):
        return await call_next(request)
    with SessionLocal() as db:
        user = auth.user_for(db, request.cookies.get(auth.COOKIE))
    if not user:
        return _err(401, "not_logged_in", "Please log in")
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return _err(exc.status_code, "http_error", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return _err(422, "validation_error", "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()))


class WorkflowPatch(BaseModel):
    enabled: bool


BUILT_IN = {"COD Reconciliation"}  # the one workflow every installation starts with


class WorkflowIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field("", max_length=500)
    category: str = Field("General", max_length=60)
    steps: list[dict] = Field(min_length=1, max_length=30)


def _wf_dict(wf: Workflow, definition: bool = False) -> dict:
    return {**wf.to_dict(with_definition=definition), "built_in": wf.name in BUILT_IN,
            "inputs": required_inputs(wf.definition)}


def _get_workflow(db: Session, wid: int) -> Workflow:
    wf = db.get(Workflow, wid)
    if not wf:
        raise HTTPException(404, f"Workflow {wid} not found")
    return wf


@app.get("/api/health")
def health():
    return {"status": "ok", "version": app.version}


@app.get("/api/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    return analytics.dashboard(db)


@app.get("/api/workflows")
def list_workflows(search: str = "", enabled: bool | None = None, db: Session = Depends(get_db)):
    q = db.query(Workflow)
    if search:
        like = f"%{search}%"
        q = q.filter(Workflow.name.ilike(like) | Workflow.description.ilike(like) | Workflow.category.ilike(like))
    if enabled is not None:
        q = q.filter(Workflow.enabled == enabled)
    out = []
    for w in q.order_by(Workflow.name).all():
        d = _wf_dict(w)
        runs = [e for e in w.executions if e.status not in ("running", "queued")]
        d["run_count"] = len(runs)
        d["last_status"] = max(runs, key=lambda e: e.started_at).status if runs else None
        out.append(d)
    return out


@app.get("/api/workflows/{wid}")
def get_workflow(wid: int, db: Session = Depends(get_db)):
    return _wf_dict(_get_workflow(db, wid), True)


@app.patch("/api/workflows/{wid}")
def patch_workflow(wid: int, body: WorkflowPatch, db: Session = Depends(get_db)):
    wf = _get_workflow(db, wid)
    wf.enabled = body.enabled
    db.commit()
    return wf.to_dict()


class FileChoice(BaseModel):
    source: str = Field(pattern="^(samples|uploads)$")
    file: str = Field(max_length=100)


class RunIn(BaseModel):
    inputs: dict[str, FileChoice] = Field(default_factory=dict, max_length=10)


def _resolve_inputs(wf: Workflow, body: RunIn | None) -> dict[str, dict]:
    """The files chosen for this run. Every file slot the workflow asks for must be filled with a file that exists."""
    need = required_inputs(wf.definition)
    given = body.inputs if body else {}
    unknown = set(given) - {n["name"] for n in need}
    if unknown:
        raise HTTPException(422, f"This workflow does not ask for: {', '.join(sorted(unknown))}")
    out = {}
    for n in need:
        c = given.get(n["name"])
        if not c:
            raise HTTPException(422, f"Choose a file for '{n['label']}'")
        if not datasources.safe_path(c.source, c.file):
            raise HTTPException(422, f"The file '{c.file}' for '{n['label']}' was not found in Data Sources")
        out[n["name"]] = {"source": c.source, "file": c.file}
    return out


@app.post("/api/workflows/{wid}/run", status_code=201)
def run(wid: int, response: Response, body: RunIn | None = None, background: bool = Query(False),
        db: Session = Depends(get_db)):
    """Run now and wait for the result, or (background=true) queue it and return straight away.
    If the workflow asks for files at run time, send them as {"inputs": {"name": {"source": ..., "file": ...}}}."""
    wf = _get_workflow(db, wid)
    if not wf.enabled:
        raise HTTPException(409, f"Workflow '{wf.name}' is disabled. Enable it before running")
    inputs = _resolve_inputs(wf, body)
    if background:
        if not runqueue.runner or not runqueue.runner.running:
            raise HTTPException(503, "The background queue is not running. Restart the backend")
        try:
            ex = runqueue.runner.submit(db, wf, "manual", inputs)
        except runqueue.QueueFull as e:
            raise HTTPException(429, str(e))
        response.status_code = 202
        return ex.to_dict()  # the run as it was queued; the worker may already be adding steps
    return run_workflow(db, wf, "manual", inputs=inputs).to_dict(with_steps=True)


@app.get("/api/queue/status")
def queue_status():
    r = runqueue.runner
    return r.status() if r else {"running": False, "waiting": 0, "current_execution_id": None,
                                 "finished_since_start": 0, "max_waiting": runqueue.MAX_WAITING, "note": "The queue is not running."}


@app.get("/api/executions")
def list_executions(status: str | None = None, workflow_id: int | None = None,
                    limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    q = db.query(Execution)
    if status:
        q = q.filter(Execution.status == status)
    if workflow_id:
        q = q.filter(Execution.workflow_id == workflow_id)
    return [e.to_dict() for e in q.order_by(Execution.started_at.desc()).limit(limit).all()]


@app.get("/api/executions/{eid}")
def get_execution(eid: int, db: Session = Depends(get_db)):
    ex = db.get(Execution, eid)
    if not ex:
        raise HTTPException(404, f"Execution {eid} not found")
    return ex.to_dict(with_steps=True)


DOWNLOADS = {"processed": "processed.csv", "summary": "summary.csv", "report": "report.xlsx"}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _exceptions_csv(db: Session, eid: int) -> Response:
    rows = db.query(ExecutionException).filter_by(execution_id=eid).order_by(ExecutionException.id).all()
    if not rows:
        raise HTTPException(404, "This execution has no exceptions")
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["type", "key", "row_in_first_table", "row_in_second_table", "first_amount", "second_amount", "difference", "reason", "decision", "decided_by", "note"])
    for r in rows:  # text can come from the user's files, so it is neutralised for Excel
        w.writerow([reconcile.KINDS[r.kind], analytics.safe_cell(r.key), r.left_row, r.right_row, r.left_amount, r.right_amount,
                    r.difference, analytics.safe_cell(r.reason), r.decision or "", r.decided_by or "", analytics.safe_cell(r.note or "")])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="execution_{eid}_exceptions.csv"'})


EXCEPTION_KINDS = "^(" + "|".join(reconcile.KINDS) + ")$"


@app.get("/api/executions/{eid}/exceptions")
def list_exceptions(eid: int, kind: str | None = Query(None, pattern=EXCEPTION_KINDS), decision: str | None = Query(None, pattern="^(pending|approved|rejected)$"),
                    limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    """Everything a reconciliation run found that does not agree, worst problems first."""
    if not db.get(Execution, eid):
        raise HTTPException(404, f"Execution {eid} not found")
    q = db.query(ExecutionException).filter_by(execution_id=eid)
    by_kind = {k: n for k, n in db.query(ExecutionException.kind, func.count()).filter_by(execution_id=eid).group_by(ExecutionException.kind)}
    if kind:
        q = q.filter_by(kind=kind)
    if decision == "pending":
        q = q.filter(ExecutionException.decision.is_(None))
    elif decision:
        q = q.filter_by(decision=decision)
    total = q.count()
    items = q.order_by(ExecutionException.id).offset(offset).limit(limit).all()
    return {"total": total, "by_kind": by_kind, "by_decision": review.counts(db, eid), "labels": reconcile.KINDS, "items": [i.to_dict() for i in items]}


class DecideIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    decision: str = Field(pattern="^(approved|rejected|pending)$")
    note: str = Field("", max_length=300)


def _actor(request: Request, db: Session) -> str:
    user = auth.user_for(db, request.cookies.get(auth.COOKIE)) if settings.auth_enabled else None
    return user.username if user else "local user"


@app.post("/api/executions/{eid}/exceptions/decide")
def decide_exceptions(eid: int, body: DecideIn, request: Request, db: Session = Depends(get_db)):
    """Approve, reject or re-open exceptions. Every change is added to the audit trail."""
    if not db.get(Execution, eid):
        raise HTTPException(404, f"Execution {eid} not found")
    try:
        changed = review.decide(db, eid, body.ids, body.decision, body.note, _actor(request, db))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"changed": changed, "by_decision": review.counts(db, eid)}


@app.get("/api/audit")
def audit_trail(execution_id: int | None = None, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    """Who decided what and when, newest first. Read only: there is no way to edit or delete an entry."""
    q = db.query(AuditEvent)
    if execution_id is not None:
        q = q.filter_by(execution_id=execution_id)
    total = q.count()
    items = q.order_by(AuditEvent.id.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [i.to_dict() for i in items]}


@app.get("/api/executions/{eid}/download/{kind}")
def download(eid: int, kind: str, db: Session = Depends(get_db)):
    if kind == "exceptions" and db.get(Execution, eid):
        return _exceptions_csv(db, eid)
    if kind not in DOWNLOADS or not db.get(Execution, eid):
        raise HTTPException(404, "File not found")
    path = settings.reports_dir / f"execution_{eid}_{DOWNLOADS[kind]}"
    if not path.is_file():
        raise HTTPException(404, "This execution did not produce that file")
    return FileResponse(path, media_type=XLSX if kind == "report" else "text/csv", filename=path.name)


SOURCE = "^(all|live|demo)$"


@app.get("/api/samples")
def list_samples():
    d = settings.samples_dir
    return sorted(p.name for p in d.glob("*.csv")) if d.exists() else []


def _name_taken(db: Session, name: str, except_id: int | None = None) -> bool:
    q = db.query(Workflow).filter(Workflow.name == name)
    return (q.filter(Workflow.id != except_id) if except_id else q).first() is not None


@app.post("/api/workflows", status_code=201)
def create_workflow(body: WorkflowIn, db: Session = Depends(get_db)):
    name = body.name.strip()
    definition, errs = clean_definition(body.steps)
    if errs:
        raise HTTPException(422, "; ".join(errs))
    if not name or _name_taken(db, name):
        raise HTTPException(409, "A workflow with this name already exists. Choose a different name")
    wf = Workflow(name=name, description=body.description.strip(), category=body.category.strip() or "General",
                  definition=definition)
    db.add(wf)
    db.commit()
    return _wf_dict(wf, True)


@app.put("/api/workflows/{wid}")
def update_workflow(wid: int, body: WorkflowIn, db: Session = Depends(get_db)):
    wf = _get_workflow(db, wid)
    name = body.name.strip()
    definition, errs = clean_definition(body.steps)
    if errs:
        raise HTTPException(422, "; ".join(errs))
    if wf.name in BUILT_IN and name != wf.name:
        raise HTTPException(409, "This is a built-in workflow, so its name cannot be changed. You can still edit its steps")
    if not name or _name_taken(db, name, wid):
        raise HTTPException(409, "A workflow with this name already exists. Choose a different name")
    wf.name, wf.description, wf.category = name, body.description.strip(), body.category.strip() or "General"
    wf.definition = definition
    db.commit()
    return _wf_dict(wf, True)


@app.delete("/api/workflows/{wid}")
def delete_workflow(wid: int, with_history: bool = False, db: Session = Depends(get_db)):
    """Delete your own workflow. If it has runs, they are only erased when with_history=true is asked for explicitly."""
    wf = _get_workflow(db, wid)
    if wf.name in BUILT_IN:
        raise HTTPException(409, "Built-in workflows cannot be deleted. You can disable them instead")
    runs = db.query(Execution).filter_by(workflow_id=wid).all()
    if runs and not with_history:
        raise HTTPException(409, f"This workflow has {len(runs)} runs in its history, so it cannot be deleted by itself. "
                                 "Choose 'Delete with its history' to erase the runs as well, or disable it instead")
    ids = [e.id for e in runs]
    if ids and db.query(AuditEvent).filter(AuditEvent.execution_id.in_(ids)).count():
        raise HTTPException(409, "Someone approved or rejected exceptions from its runs. Those decisions belong to the audit trail, "
                                 "so the workflow and its runs are kept. Disable it instead")
    for e in runs:
        db.delete(e)  # steps, inputs, results and exceptions go with it
    db.query(Schedule).filter_by(workflow_id=wid).delete()
    db.delete(wf)
    db.commit()
    for eid in ids:  # the report files of those runs
        for f in settings.reports_dir.glob(f"execution_{eid}_*"):
            f.unlink(missing_ok=True)
    return {"deleted": True, "runs_deleted": len(ids)}


@app.get("/api/templates")
def list_templates():
    return [{**t, "step_count": len(t["steps"])} for t in TEMPLATES]


@app.post("/api/templates/{key}/use", status_code=201)
def use_template(key: str, db: Session = Depends(get_db)):
    t = next((t for t in TEMPLATES if t["key"] == key), None)
    if not t:
        raise HTTPException(404, "Template not found")
    definition, errs = clean_definition(t["steps"])
    if errs:  # a broken built-in template is a bug on our side, not the user's
        raise HTTPException(500, "Template is invalid: " + "; ".join(errs))
    name, n = t["name"], 1
    while _name_taken(db, name):
        n += 1
        name = f"{t['name']} (copy {n})"
    wf = Workflow(name=name, description=t["description"], category=t["category"], definition=definition)
    db.add(wf)
    db.commit()
    return _wf_dict(wf, True)


class AssistantIn(BaseModel):
    request: str = Field(min_length=3, max_length=500)


@app.get("/api/assistant/info")
def assistant_info():
    return assistant.info()


@app.post("/api/assistant/propose")
def assistant_propose(body: AssistantIn, db: Session = Depends(get_db)):
    return assistant.propose(db, body.request.strip())


@app.get("/api/assistant/explain/{wid}")
def assistant_explain(wid: int, db: Session = Depends(get_db)):
    return assistant.explain(db, _get_workflow(db, wid))


@app.get("/api/assistant/failures")
def assistant_failures(days: int = Query(14, ge=1, le=365), source: str = Query("all", pattern=SOURCE),
                       db: Session = Depends(get_db)):
    return assistant.failures(db, days, source)


class ScheduleIn(BaseModel):
    workflow_id: int
    kind: str
    interval_minutes: int | None = None
    time_of_day: str | None = Field(None, max_length=5)
    weekday: int | None = None
    tz_offset_minutes: int = 0


class SchedulePatch(BaseModel):
    enabled: bool


def _get_schedule(db: Session, sid: int) -> Schedule:
    s = db.get(Schedule, sid)
    if not s:
        raise HTTPException(404, f"Schedule {sid} not found")
    return s


def _sched_dict(s: Schedule) -> dict:
    return {**s.to_dict(), "summary": schedules.describe(s)}


@app.get("/api/schedules/status")
def schedules_status(db: Session = Depends(get_db)):
    sch = schedules.scheduler
    return {"running": bool(sch and sch.running), "checks_every_seconds": settings.scheduler_tick_seconds,
            "last_check": iso(sch.last_tick) if sch else None,
            "active": db.query(Schedule).filter_by(enabled=True).count(),
            "note": "Schedules only run while the backend is running."}


@app.get("/api/schedules")
def list_schedules(db: Session = Depends(get_db)):
    rows = db.query(Schedule).order_by(Schedule.id).all()
    return [_sched_dict(s) for s in rows]


@app.post("/api/schedules", status_code=201)
def create_schedule(body: ScheduleIn, db: Session = Depends(get_db)):
    wf = _get_workflow(db, body.workflow_id)
    errs = schedules.check(body.kind, body.interval_minutes, body.time_of_day, body.weekday, body.tz_offset_minutes)
    if errs:
        raise HTTPException(422, "; ".join(errs))
    s = schedules.create(db, wf, body.kind, body.interval_minutes, body.time_of_day, body.weekday, body.tz_offset_minutes)
    return _sched_dict(s)


@app.patch("/api/schedules/{sid}")
def patch_schedule(sid: int, body: SchedulePatch, db: Session = Depends(get_db)):
    s = _get_schedule(db, sid)
    s.enabled = body.enabled
    if body.enabled:  # start counting from now, so old missed times do not fire
        s.next_run_at = schedules.next_run(s, utcnow())
    db.commit()
    return _sched_dict(s)


@app.delete("/api/schedules/{sid}")
def delete_schedule(sid: int, db: Session = Depends(get_db)):
    db.delete(_get_schedule(db, sid))
    db.commit()
    return {"deleted": True}


@app.post("/api/schedules/run-due")
def schedules_run_due(db: Session = Depends(get_db)):
    """Run anything that is due right now (the background thread does this on its own)."""
    return {"ran": schedules.run_due(db)}


@app.get("/api/datasources")
def list_datasources(db: Session = Depends(get_db)):
    return datasources.catalog(db)


@app.post("/api/datasources/uploads", status_code=201)
async def add_datasource(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Add a CSV or Excel file to Data Sources without running anything, so it can be chosen when a workflow runs."""
    data = await file.read(tables.MAX_BYTES + 1)
    try:
        saved = datasources.store_upload(db, file.filename or "upload.csv", data)
    except tables.TableError as e:
        raise HTTPException(400, str(e))
    return next(f for f in datasources.catalog(db)["uploads"] if f["name"] == saved["name"])


@app.get("/api/datasources/{source}/{name}/preview")
def preview_datasource(source: str, name: str, rows: int = Query(10, ge=1, le=datasources.PREVIEW_MAX),
                       sheet: str | None = Query(None, max_length=60)):
    d = datasources.preview(source, name, rows, sheet)
    if d is None:
        raise HTTPException(404, "File not found")
    return d


@app.delete("/api/datasources/{source}/{name}")
def delete_datasource(source: str, name: str, db: Session = Depends(get_db)):
    if source == "samples":
        raise HTTPException(409, "Built-in sample files cannot be deleted")
    if not datasources.delete_upload(db, name):
        raise HTTPException(404, "File not found")
    return {"deleted": True}


class Credentials(BaseModel):
    username: str = Field(max_length=40)
    password: str = Field(max_length=auth.MAX_PASSWORD)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=auth.MAX_PASSWORD)
    new_password: str = Field(max_length=auth.MAX_PASSWORD)


def _set_cookie(resp: JSONResponse, token: str):
    resp.set_cookie(auth.COOKIE, token, max_age=settings.session_days * 86400, httponly=True,
                    samesite="lax", secure=settings.auth_cookie_secure, path="/")


@app.get("/api/auth/status")
def auth_status(request: Request, db: Session = Depends(get_db)):
    user = auth.user_for(db, request.cookies.get(auth.COOKIE)) if settings.auth_enabled else None
    return {"auth_enabled": settings.auth_enabled, "needs_setup": settings.auth_enabled and db.query(User).count() == 0,
            "user": {"username": user.username} if user else None}


@app.post("/api/auth/setup", status_code=201)
def auth_setup(body: Credentials, db: Session = Depends(get_db)):
    if not settings.auth_enabled:
        raise HTTPException(409, "Login is turned off for this server")
    if db.query(User).count():
        raise HTTPException(409, "An account already exists. Please log in")
    problem = auth.check_username(body.username) or auth.check_password_rules(body.password)
    if problem:
        raise HTTPException(422, problem)
    user = User(username=body.username, password_hash=auth.hash_password(body.password))
    db.add(user)
    db.commit()
    resp = JSONResponse(status_code=201, content={"user": {"username": user.username}})
    _set_cookie(resp, auth.start_session(db, user))
    return resp


@app.post("/api/auth/login")
def auth_login(body: Credentials, db: Session = Depends(get_db)):
    if auth.locked(body.username):
        raise HTTPException(429, "Too many wrong attempts. Wait 10 minutes and try again")
    user = auth.login_ok(db, body.username, body.password)
    if not user:
        auth.record_fail(body.username)
        raise HTTPException(401, "Wrong username or password")
    auth.clear_fails(body.username)
    resp = JSONResponse(content={"user": {"username": user.username}})
    _set_cookie(resp, auth.start_session(db, user))
    return resp


@app.post("/api/auth/logout")
def auth_logout(request: Request, db: Session = Depends(get_db)):
    auth.end_session(db, request.cookies.get(auth.COOKIE))
    resp = JSONResponse(content={"logged_out": True})
    resp.delete_cookie(auth.COOKIE, path="/")
    return resp


@app.post("/api/auth/password")
def auth_password(body: PasswordChange, request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(auth.COOKIE)
    user = auth.user_for(db, token)
    if not user:
        raise HTTPException(401, "Please log in")
    if not auth.verify_password(body.current_password, user.password_hash):
        raise HTTPException(403, "Your current password is wrong")
    problem = auth.check_password_rules(body.new_password)
    if problem:
        raise HTTPException(422, problem)
    user.password_hash = auth.hash_password(body.new_password)
    db.commit()
    auth.end_other_sessions(db, user, token)  # other devices must log in again
    return {"changed": True}
