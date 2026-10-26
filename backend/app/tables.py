"""Reading data files (CSV and Excel .xlsx) and cleaning messy values.

Everything that opens a user's file goes through here, so the size, row and
zip-bomb limits are applied in one place."""
import re
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

EXTS = (".csv", ".xlsx")
MAX_BYTES = 5_000_000
MAX_ROWS = 50_000
MAX_UNZIPPED = 50_000_000  # an .xlsx is a zip file; refuse ones that unpack to something huge
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
TABLE_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")


class TableError(Exception):
    """A file problem the user can understand and fix."""


def is_supported(name: str) -> bool:
    return bool(NAME_RE.match(name)) and name.lower().endswith(EXTS) and Path(name).name == name


def _check_xlsx(path: Path):
    try:
        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
                raise TableError("This Excel file is too large when opened")
    except zipfile.BadZipFile:
        raise TableError("This is not a real .xlsx file. Save it again as Excel Workbook (.xlsx)")


def sheet_names(path: Path) -> list[str]:
    if path.suffix.lower() != ".xlsx":
        return []
    _check_xlsx(path)
    try:
        with pd.ExcelFile(path, engine="openpyxl") as x:
            return [str(s) for s in x.sheet_names]
    except Exception:
        raise TableError("The Excel file could not be opened")


def read_table(path: Path, sheet: str | None = None, nrows: int | None = None, as_text: bool = False) -> pd.DataFrame:
    """Read a CSV or the chosen sheet of an .xlsx into a table. Raises TableError with a plain message."""
    if path.stat().st_size > MAX_BYTES:
        raise TableError(f"The file is larger than the {MAX_BYTES // 1_000_000} MB limit")
    kw = {"dtype": str, "keep_default_na": False} if as_text else {}
    try:
        if path.suffix.lower() == ".xlsx":
            _check_xlsx(path)
            names = sheet_names(path)
            if sheet and sheet not in names:
                raise TableError(f"The sheet '{sheet}' was not found. Sheets in this file: {', '.join(names)}")
            df = pd.read_excel(path, sheet_name=sheet or 0, nrows=nrows, engine="openpyxl", **kw)
        else:
            df = pd.read_csv(path, nrows=nrows, **kw)
    except TableError:
        raise
    except Exception:
        raise TableError("The file could not be read as a table. Check that it is a plain CSV or a normal .xlsx file")
    df.columns = [str(c).strip() for c in df.columns]
    if nrows is None and len(df) > MAX_ROWS:
        raise TableError(f"The file has more than {MAX_ROWS:,} rows, which is over the limit")
    return df


# ---- cleaning messy values -------------------------------------------------

def to_amount(value):
    """'SAR 1,234.50' -> 1234.5, '(500.00)' -> -500, '1.234,50' -> 1234.5. Unreadable text -> NaN."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return np.nan
    if isinstance(value, (int, float, np.integer, np.floating)) and not isinstance(value, bool):
        return float(value)
    s = str(value).strip()
    if not s:
        return np.nan
    negative = (s.startswith("(") and s.endswith(")")) or s.startswith("-") or s.endswith("-")
    core = re.sub(r"[^\d.,]", "", s)
    if not re.search(r"\d", core):
        return np.nan
    if "," in core and "." in core:  # the one that comes last is the decimal mark
        dec = "," if core.rfind(",") > core.rfind(".") else "."
        thou = "." if dec == "," else ","
        core = core.replace(thou, "").replace(dec, ".")
    elif "," in core:
        parts = core.split(",")
        core = core.replace(",", "") if len(parts) > 2 or len(parts[-1]) == 3 else ".".join(parts)
    elif core.count(".") > 1:
        core = core.replace(".", "")
    try:
        n = float(core)
    except ValueError:
        return np.nan
    return -n if negative else n


def normalize_amounts(series: pd.Series) -> tuple[pd.Series, int, int]:
    """Returns (numbers, how many text cells were converted, how many could not be read)."""
    out = series.map(to_amount)
    texts = series.map(lambda v: isinstance(v, str) and v.strip() != "")
    converted = int((texts & out.notna()).sum())
    unreadable = int((texts & out.isna()).sum())
    return out.astype(float), converted, unreadable


ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_dates(series: pd.Series, dayfirst: bool = True) -> tuple[pd.Series, int, int]:
    """Turn every readable date into YYYY-MM-DD. Dates already written that way are never reinterpreted
    (2026-10-06 is 6 October whatever the day-first setting); other text follows the day-first choice."""
    present = series.notna() & (series.astype(str).str.strip() != "")
    text = series.map(lambda v: v.strip() if isinstance(v, str) else v)
    is_iso = text.map(lambda v: isinstance(v, str) and bool(ISO_DATE.fullmatch(v)))
    parsed = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
    if (present & is_iso).any():
        parsed[present & is_iso] = pd.to_datetime(text[present & is_iso], format="%Y-%m-%d", errors="coerce")
    rest = present & ~is_iso
    if rest.any():
        parsed[rest] = pd.to_datetime(text[rest], errors="coerce", dayfirst=dayfirst, format="mixed")
    out = parsed.dt.strftime("%Y-%m-%d")
    changed = int((present & parsed.notna() & ~is_iso).sum())
    unreadable = int((present & parsed.isna()).sum())
    return out.where(parsed.notna(), np.nan), changed, unreadable


def standardize_text(series: pd.Series) -> tuple[pd.Series, int]:
    def fix(v):
        return re.sub(r"\s+", " ", v).strip().upper() if isinstance(v, str) else v
    out = series.map(fix)
    changed = int(((series != out) & series.notna()).sum())
    return out, changed
