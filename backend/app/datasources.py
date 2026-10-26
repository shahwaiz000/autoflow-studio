"""Data Sources: the CSV files workflows can read (built-in samples and your uploads)."""
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from . import tables
from .config import settings
from .models import DataFile, Workflow, iso
from datetime import datetime, timezone

SOURCES = ("samples", "uploads")
PREVIEW_MAX = 50
_cache: dict[tuple, dict] = {}


def folder(source: str) -> Path:
    return settings.samples_dir if source == "samples" else settings.uploads_dir


def safe_path(source: str, name: str) -> Path | None:
    """Only a plain file name inside the right folder is ever opened."""
    if source not in SOURCES or not tables.is_supported(name):
        return None
    p = folder(source) / name
    return p if p.is_file() else None


def _facts(path: Path) -> dict:
    st = path.stat()
    key = (str(path), st.st_mtime_ns, st.st_size)
    if key not in _cache:
        try:
            sheets = tables.sheet_names(path)
            df = tables.read_table(path)
            info = {"rows": int(len(df)), "columns": [str(c) for c in df.columns], "readable": len(df) > 0,  # a header with no rows cannot run
                    "sheets": sheets}
        except tables.TableError:
            info = {"rows": None, "columns": [], "readable": False, "sheets": []}
        if len(_cache) > 200:
            _cache.clear()
        _cache[key] = info
    return {**_cache[key], "size_bytes": st.st_size,
            "modified_at": iso(datetime.fromtimestamp(st.st_mtime, timezone.utc).replace(tzinfo=None))}


def _used_by(db: Session) -> dict[tuple[str, str], list[str]]:
    used: dict[tuple[str, str], list[str]] = {}
    for wf in db.query(Workflow).all():
        for step in wf.definition.get("steps", []):
            if step.get("type") == "load_csv":
                cfg = step.get("config", {})
                src = "uploads" if cfg.get("source") == "uploads" else "samples"
                names = used.setdefault((src, str(cfg.get("file", ""))), [])
                if wf.name not in names:
                    names.append(wf.name)
    return used


def catalog(db: Session) -> dict:
    used = _used_by(db)
    recorded = {d.stored_name: d for d in db.query(DataFile).all()}
    out = {"samples": [], "uploads": []}
    for source in SOURCES:
        d = folder(source)
        for p in sorted(x for x in d.iterdir() if tables.is_supported(x.name)) if d.exists() else []:
            f = {"name": p.name, "source": source, **_facts(p), "used_by": used.get((source, p.name), [])}
            if source == "uploads":
                rec = recorded.get(p.name)
                f.update(original_name=rec.original_name if rec else None,
                         uploaded_at=iso(rec.created_at) if rec else None,
                         execution_id=rec.execution_id if rec else None)
            out[source].append(f)
    out["uploads"].sort(key=lambda f: f["modified_at"] or "", reverse=True)
    return out


def preview(source: str, name: str, rows: int = 10, sheet: str | None = None) -> dict | None:
    path = safe_path(source, name)
    if not path:
        return None
    rows = max(1, min(rows, PREVIEW_MAX))
    try:
        df = tables.read_table(path, sheet=sheet, nrows=rows, as_text=True)
    except tables.TableError as e:
        return {"name": name, "readable": False, "columns": [], "rows": [], "message": str(e)}
    return {"name": name, "readable": len(df) > 0, "columns": [str(c) for c in df.columns],
            "rows": [[str(v)[:80] for v in r] for r in df.values.tolist()]}


def store_upload(db: Session, original: str, data: bytes) -> dict:
    """Save a CSV or Excel file under a random name so workflows can use it. Raises TableError with a plain message."""
    name = Path(original or "upload.csv").name[:100]
    ext = Path(name).suffix.lower()
    if ext not in tables.EXTS:
        raise tables.TableError("Only .csv and .xlsx files are supported")
    if len(data) > tables.MAX_BYTES:
        raise tables.TableError(f"The file is larger than the {tables.MAX_BYTES // 1_000_000} MB limit")
    if not data.strip():
        raise tables.TableError("The file is empty")
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    path = settings.uploads_dir / stored
    path.write_bytes(data)
    try:
        df = tables.read_table(path)
        if df.empty:
            raise tables.TableError("The file has a header but no data rows")
    except tables.TableError:
        path.unlink(missing_ok=True)  # never keep a file nothing can read
        raise
    remember_upload(db, stored, name, None)
    return {"name": stored, "original_name": name}


def remember_upload(db: Session, stored: str, original: str, execution_id: int | None):
    db.add(DataFile(stored_name=stored, original_name=original, execution_id=execution_id))
    db.commit()


def delete_upload(db: Session, name: str) -> bool:
    path = safe_path("uploads", name)
    if not path:
        return False
    path.unlink()
    db.query(DataFile).filter_by(stored_name=name).delete()
    db.commit()
    return True
