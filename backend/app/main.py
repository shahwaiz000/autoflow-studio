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

from . import analytics, assistant
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .engine import run_workflow
from .models import Execution, Workflow
from .definitions import clean_definition
from .seed import WORKFLOWS, seed
from .templates import TEMPLATES

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    yield


app = FastAPI(title="AutoFlow Studio API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"])


def _err(status: int, code: str, message: str):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


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
    return {**wf.to_dict(with_definition=definition), "built_in": wf.name in BUILT_IN}


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
        runs = [e for e in w.executions if e.status != "running"]
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


@app.post("/api/workflows/{wid}/run", status_code=201)
def run(wid: int, db: Session = Depends(get_db)):
    wf = _get_workflow(db, wid)
    if not wf.enabled:
        raise HTTPException(409, f"Workflow '{wf.name}' is disabled. Enable it before running")
    return run_workflow(db, wf, "manual").to_dict(with_steps=True)


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
DOWNLOADS = {"processed": "processed.csv", "summary": "summary.csv"}


def _split(text: str) -> list[str]:
    return [p.strip() for p in text.split(",") if p.strip()]


@app.post("/api/uploads", status_code=201)
async def upload_csv(file: UploadFile = File(...), required_columns: str = Form(""),
                     numeric_columns: str = Form(""), missing_values: str = Form("remove"),
                     invalid_numbers: str = Form("keep"),
                     db: Session = Depends(get_db)):
    original = Path(file.filename or "upload.csv").name[:100]
    if not original.lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv files are supported")
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
    stored = f"{uuid.uuid4().hex}.csv"  # random name: the original name is never used on disk
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
    return {**ex.to_dict(with_steps=True), "metrics": getattr(ex, "result_metrics", {})}


@app.get("/api/executions/{eid}/download/{kind}")
def download(eid: int, kind: str, db: Session = Depends(get_db)):
    if kind not in DOWNLOADS or not db.get(Execution, eid):
        raise HTTPException(404, "File not found")
    path = settings.reports_dir / f"execution_{eid}_{DOWNLOADS[kind]}"
    if not path.is_file():
        raise HTTPException(404, "This execution did not produce that file")
    return FileResponse(path, media_type="text/csv", filename=path.name)


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
