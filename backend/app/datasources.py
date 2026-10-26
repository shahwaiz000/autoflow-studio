"""Data Sources: the CSV files workflows can read (built-in samples and your uploads)."""
import re
from pathlib import Path

import pandas as pd
from sqlalchemy.orm import Session

from .config import settings
from .models import DataFile, Workflow, iso
from datetime import datetime, timezone

SOURCES = ("samples", "uploads")
NAME_OK = re.compile(r"^[A-Za-z0-9_.-]{1,100}\.csv$")
PREVIEW_MAX = 50
_cache: dict[tuple, dict] = {}


def folder(source: str) -> Path:
    return settings.samples_dir if source == "samples" else settings.uploads_dir


def safe_path(source: str, name: str) -> Path | None:
    """Only a plain file name inside the right folder is ever opened."""
    if source not in SOURCES or not NAME_OK.match(name) or Path(name).name != name:
        return None
    p = folder(source) / name
    return p if p.is_file() else None


def _facts(path: Path) -> dict:
    st = path.stat()
    key = (str(path), st.st_mtime_ns, st.st_size)
    if key not in _cache:
        try:
            df = pd.read_csv(path)
            info = {"rows": int(len(df)), "columns": [str(c) for c in df.columns], "readable": len(df) > 0}  # a header with no rows cannot run
        except Exception:
            info = {"rows": None, "columns": [], "readable": False}
        _cache.clear() if len(_cache) > 200 else None
        _cache[key] = info
    return {**_cache[key], "size_bytes": st.st_size, "modified_at": iso(datetime.fromtimestamp(st.st_mtime, timezone.utc).replace(tzinfo=None))}


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
        for p in sorted(d.glob("*.csv")) if d.exists() else []:
            f = {"name": p.name, "source": source, **_facts(p), "used_by": used.get((source, p.name), [])}
            if source == "uploads":
                rec = recorded.get(p.name)
                f.update(original_name=rec.original_name if rec else None,
                         uploaded_at=iso(rec.created_at) if rec else None,
                         execution_id=rec.execution_id if rec else None)
            out[source].append(f)
    out["uploads"].sort(key=lambda f: f["modified_at"] or "", reverse=True)
    return out


def preview(source: str, name: str, rows: int = 10) -> dict | None:
    path = safe_path(source, name)
    if not path:
        return None
    rows = max(1, min(rows, PREVIEW_MAX))
    try:
        df = pd.read_csv(path, nrows=rows, dtype=str, keep_default_na=False)
    except Exception:
        return {"name": name, "readable": False, "columns": [], "rows": []}
    return {"name": name, "readable": len(df) > 0, "columns": [str(c) for c in df.columns],
            "rows": [[str(v)[:80] for v in r] for r in df.values.tolist()]}


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
