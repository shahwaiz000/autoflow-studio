import logging
import uuid
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import analytics, assistant, auth, datasources, runqueue, schedules, tables
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .engine import required_inputs, run_workflow
from .models import Execution, Schedule, User, Workflow, iso, utcnow
from .definitions import clean_definition
from .seed import WORKFLOWS, seed
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


BUILT_IN = {w["name"] for w in WORKFLOWS}


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


MAX_UPLOAD_BYTES = 5_000_000
UPLOAD_WORKFLOW = "CSV Upload Cleaner"
DOWNLOADS = {"processed": "processed.csv", "summary": "summary.csv", "report": "report.xlsx"}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _split(text: str) -> list[str]:
    return [p.strip() for p in text.split(",") if p.strip()]


@app.post("/api/uploads", status_code=201)
async def upload_csv(file: UploadFile = File(...), required_columns: str = Form(""),
                     numeric_columns: str = Form(""), missing_values: str = Form("remove"),
                     invalid_numbers: str = Form("keep"),
                     db: Session = Depends(get_db)):
    original = Path(file.filename or "upload.csv").name[:100]
    ext = Path(original).suffix.lower()
    if ext not in tables.EXTS:
        raise HTTPException(400, "Only .csv and .xlsx files are supported")
    if missing_values not in ("remove", "keep"):
        raise HTTPException(400, "missing_values must be 'remove' or 'keep'")
    if invalid_numbers not in ("remove", "keep"):
        raise HTTPException(400, "invalid_numbers must be 'remove' or 'keep'")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"The file is larger than the {MAX_UPLOAD_BYTES // 1_000_000} MB limit")
    if not data.strip():
        raise HTTPException(400, "The file is empty")
    wf = db.query(Workflow).filter_by(name=UPLOAD_WORKFLOW).first()
    if not wf:
        raise HTTPException(500, "The upload workflow is missing. Restart the backend to re-create it")
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"  # random name: the original name is never used on disk
    (settings.uploads_dir / stored).write_bytes(data)
    numeric = _split(numeric_columns)
    ops = ["trim_text", "drop_duplicates"]
    if invalid_numbers == "remove" and numeric:
        ops.append("drop_invalid_numbers")
    if missing_values == "remove":
        ops.append("drop_missing")
    definition = {"steps": [
        {"id": "t", "type": "trigger", "name": f"File received: {original}", "config": {"kind": "upload"}},
        {"id": "load", "type": "load_csv", "name": "Load CSV file", "config": {"file": stored, "source": "uploads"}},
        {"id": "val", "type": "validate", "name": "Check columns, missing values and duplicates",
         "config": {"required_columns": _split(required_columns), "numeric_columns": numeric}},
        {"id": "tr", "type": "transform", "name": "Clean data", "config": {"operations": ops, "numeric_columns": numeric}},
        {"id": "report", "type": "report", "name": "Generate report", "config": {}},
        {"id": "end", "type": "end", "name": "Done", "config": {}},
    ]}
    ex = run_workflow(db, wf, "upload", definition=definition)
    datasources.remember_upload(db, stored, original, ex.id)
    return {**ex.to_dict(with_steps=True), "metrics": getattr(ex, "result_metrics", {})}


@app.get("/api/executions/{eid}/download/{kind}")
def download(eid: int, kind: str, db: Session = Depends(get_db)):
    if kind not in DOWNLOADS or not db.get(Execution, eid):
        raise HTTPException(404, "File not found")
    path = settings.reports_dir / f"execution_{eid}_{DOWNLOADS[kind]}"
    if not path.is_file():
        raise HTTPException(404, "This execution did not produce that file")
    return FileResponse(path, media_type=XLSX if kind == "report" else "text/csv", filename=path.name)


SOURCE = "^(all|live|demo)$"


@app.get("/api/analytics")
def get_analytics(days: int = Query(14, ge=1, le=365), source: str = Query("all", pattern=SOURCE),
                  db: Session = Depends(get_db)):
    return analytics.report(db, days, source)


@app.get("/api/analytics/export")
def export_analytics(days: int = Query(14, ge=1, le=365), source: str = Query("all", pattern=SOURCE),
                     db: Session = Depends(get_db)):
    return Response(analytics.export_csv(db, days, source), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="autoflow_executions.csv"'})


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
def delete_workflow(wid: int, db: Session = Depends(get_db)):
    wf = _get_workflow(db, wid)
    if wf.name in BUILT_IN:
        raise HTTPException(409, "Built-in workflows cannot be deleted. You can disable them instead")
    if db.query(Execution).filter_by(workflow_id=wid).count():
        raise HTTPException(409, "This workflow has run history, so it cannot be deleted. Disable it instead")
    db.query(Schedule).filter_by(workflow_id=wid).delete()
    db.delete(wf)
    db.commit()
    return {"deleted": True}


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
