"""Reconciliation: compare two tables and list everything that does not agree.

Matching is one row to one row, on a key column (for example a waybill number or an
invoice number). Keys are compared ignoring capitals, extra spaces and the ".0" that
Excel adds to numbers. When both sides have an amount column, matched rows must also
agree on the amount within a tolerance. Every row that is left over gets a plain-English
reason, so a person can review it."""
import re

import numpy as np
import pandas as pd

from .tables import to_amount

KINDS = {
    "amount_mismatch": "Amount differs",
    "missing_in_right": "Missing in the second table",
    "missing_in_left": "Missing in the first table",
    "unreadable_amount": "Amount missing or unreadable",
    "duplicate": "Duplicate key",
    "missing_key": "No key",
}
ORDER = list(KINDS)
MAX_EXCEPTIONS = 5000  # saved with the run; the counts always cover every row


def clean_key(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    s = re.sub(r"\s+", " ", str(v)).strip().upper()
    if re.fullmatch(r"\d+\.0", s):  # Excel stores 1001 as 1001.0 when the column has gaps
        s = s[:-2]
    return s or None


def _prepare(df: pd.DataFrame, key_col: str, amount_col: str | None) -> pd.DataFrame:
    d = pd.DataFrame({"row": df.index + 2, "raw": df[key_col], "key": df[key_col].map(clean_key)})  # row 1 is the header
    if amount_col:
        raw = df[amount_col]
        d["amount"] = raw.map(to_amount)
        d["amount_text"] = raw.map(lambda v: isinstance(v, str) and v.strip() != "")
    return d


def _money(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), 2)


def compare(left: pd.DataFrame, right: pd.DataFrame, cfg: dict) -> tuple[pd.DataFrame, dict, dict]:
    """Returns (exceptions table, metrics for conditions, details for the run page)."""
    return compare_full(left, right, cfg)[:3]


def _group_of(frame: pd.DataFrame, col: str, row):
    """The value of the grouping column on a 1-based sheet row (row 1 is the header), or None."""
    if row is None or pd.isna(row) or col not in frame.columns:
        return None
    v = frame.iloc[int(row) - 2][col]
    return None if pd.isna(v) or not str(v).strip() else " ".join(str(v).split())


def by_group(out: pd.DataFrame, left: pd.DataFrame, right: pd.DataFrame, col: str) -> list[dict]:
    """Exceptions and money at stake for each value of one column (for example each driver).
    The value comes from the first table; rows that exist only in the second table use the second table's column."""
    rows: dict[str, dict] = {}
    for r in out.itertuples():
        g = _group_of(left, col, r.left_row) or _group_of(right, col, r.right_row) or "Unknown"
        e = rows.setdefault(g, {"group": g, "exceptions": 0, "net_difference": 0.0, "no_partner": 0.0, "at_risk": 0.0})
        e["exceptions"] += 1
        if r.kind == "amount_mismatch" and r.difference is not None and not pd.isna(r.difference):
            e["net_difference"] += float(r.difference)
            e["at_risk"] += abs(float(r.difference))
        elif r.kind == "missing_in_right" and r.left_amount is not None and not pd.isna(r.left_amount):
            e["no_partner"] += abs(float(r.left_amount)); e["at_risk"] += abs(float(r.left_amount))
        elif r.kind == "missing_in_left" and r.right_amount is not None and not pd.isna(r.right_amount):
            e["no_partner"] += abs(float(r.right_amount)); e["at_risk"] += abs(float(r.right_amount))
    totals = left[col].map(lambda v: None if pd.isna(v) else " ".join(str(v).split())).value_counts().to_dict() if col in left.columns else {}
    out_rows = []
    for e in rows.values():
        out_rows.append({"group": e["group"], "rows": int(totals.get(e["group"], 0)), "exceptions": e["exceptions"],
                         "net_difference": round(e["net_difference"], 2), "no_partner": round(e["no_partner"], 2), "at_risk": round(e["at_risk"], 2)})
    return sorted(out_rows, key=lambda x: (-x["at_risk"], x["group"]))


def compare_full(left: pd.DataFrame, right: pd.DataFrame, cfg: dict) -> tuple[pd.DataFrame, dict, dict, pd.DataFrame]:
    """Like compare, and also returns the pairs that matched (key, rows and amounts) for the report."""
    lname, rname = cfg["left"], cfg["right"]
    tol = float(cfg.get("tolerance", 0.01))
    la_col, ra_col = cfg.get("left_amount"), cfg.get("right_amount")
    use_amount = bool(la_col and ra_col)
    L = _prepare(left, cfg["left_key"], la_col if use_amount else None)
    R = _prepare(right, cfg["right_key"], ra_col if use_amount else None)
    exc: list[dict] = []

    def add(kind, key, lrow=None, rrow=None, la=None, ra=None, reason=""):
        diff = None if la is None or ra is None else round(la - ra, 2)
        exc.append({"kind": kind, "key": key, "left_row": lrow, "right_row": rrow,
                    "left_amount": la, "right_amount": ra, "difference": diff, "reason": reason})

    sides = []
    for name, d, who in ((lname, L, "left"), (rname, R, "right")):
        for r in d[d["key"].isna()].itertuples():
            add("missing_key", "", r.row if who == "left" else None, r.row if who == "right" else None,
                reason=f"Row {r.row} in '{name}' has no key, so it cannot be matched")
        d = d[d["key"].notna()]
        first = d.drop_duplicates("key").set_index("key")["row"].to_dict()
        for r in d[d.duplicated("key", keep="first")].itertuples():
            amt = _money(getattr(r, "amount", None)) if use_amount else None
            add("duplicate", str(r.raw).strip(), r.row if who == "left" else None, r.row if who == "right" else None,
                la=amt if who == "left" else None, ra=amt if who == "right" else None,
                reason=f"'{str(r.raw).strip()}' appears more than once in '{name}'. Row {first[r.key]} was used for matching, row {r.row} is the extra")
        sides.append(d.drop_duplicates("key", keep="first"))
    Lu, Ru = sides

    merged = Lu.merge(Ru, on="key", how="outer", suffixes=("_l", "_r"), indicator="origin")
    matched = 0
    matched_amount = 0.0
    pairs: list[dict] = []
    for r in merged.itertuples():
        key = str(r.raw_l if isinstance(r.raw_l, str) or not pd.isna(r.raw_l) else r.raw_r).strip()
        if r.origin == "left_only":
            amt = _money(r.amount_l) if use_amount else None
            add("missing_in_right", key, int(r.row_l), None, la=amt,
                reason=f"'{key}' is in '{lname}' (row {int(r.row_l)}) but not in '{rname}'")
        elif r.origin == "right_only":
            amt = _money(r.amount_r) if use_amount else None
            add("missing_in_left", key, None, int(r.row_r), ra=amt,
                reason=f"'{key}' is in '{rname}' (row {int(r.row_r)}) but not in '{lname}'")
        else:
            lrow, rrow = int(r.row_l), int(r.row_r)
            if use_amount:
                la, ra = r.amount_l, r.amount_r
                if pd.isna(la) or pd.isna(ra):
                    bad = [f"'{lname}'" for v in [la] if pd.isna(v)] + [f"'{rname}'" for v in [ra] if pd.isna(v)]
                    add("unreadable_amount", key, lrow, rrow, _money(la), _money(ra),
                        f"'{key}' matches, but the amount is empty or unreadable in {' and '.join(bad)}")
                    continue
                diff = la - ra
                if abs(diff) > tol + 1e-9:
                    add("amount_mismatch", key, lrow, rrow, _money(la), _money(ra),
                        f"'{key}' is in both, but the amounts differ: {la:,.2f} in '{lname}' vs {ra:,.2f} in '{rname}' (difference {diff:+,.2f})")
                    continue
                matched_amount += float(la)
            matched += 1
            pairs.append({"key": key, "left_row": lrow, "right_row": rrow,
                          "left_amount": _money(r.amount_l) if use_amount else None, "right_amount": _money(r.amount_r) if use_amount else None})

    out = pd.DataFrame(exc, columns=["kind", "key", "left_row", "right_row", "left_amount", "right_amount", "difference", "reason"])
    if len(out):
        out["_o"] = out["kind"].map(ORDER.index)
        out = out.sort_values(["_o", "key"], kind="stable").drop(columns="_o").reset_index(drop=True)
    counts = {k: int((out["kind"] == k).sum()) for k in ORDER}
    mism = out[out["kind"] == "amount_mismatch"]
    gone_r = out[out["kind"] == "missing_in_right"]["left_amount"].dropna()
    gone_l = out[out["kind"] == "missing_in_left"]["right_amount"].dropna()
    metrics = {
        "matched_rows": matched, "missing_in_right": counts["missing_in_right"], "missing_in_left": counts["missing_in_left"],
        "amount_mismatches": counts["amount_mismatch"], "duplicate_keys": counts["duplicate"],
        "unreadable_amounts": counts["unreadable_amount"], "exceptions": len(out),
        "amount_difference": round(float(mism["difference"].abs().sum()), 2) if len(mism) else 0.0,
        "unmatched_amount": round(float(gone_r.abs().sum() + gone_l.abs().sum()), 2),
    }
    details = {"left": lname, "right": rname, "left_key": cfg["left_key"], "right_key": cfg["right_key"],
               "left_rows": int(len(left)), "right_rows": int(len(right)), "tolerance": tol if use_amount else None,
               "amounts_compared": use_amount, "counts": counts, "matched_amount": round(matched_amount, 2) if use_amount else None,
               "unmatched_left_amount": round(float(gone_r.sum()), 2) if use_amount else None,
               "unmatched_right_amount": round(float(gone_l.sum()), 2) if use_amount else None,
               "net_difference": round(float(mism["difference"].sum()), 2) if len(mism) else 0.0}
    group_col = str(cfg.get("group_by") or "").strip()
    if group_col:
        details["group_by"] = {"column": group_col, "rows": by_group(out, left, right, group_col)}
    matched_df = pd.DataFrame(pairs, columns=["key", "left_row", "right_row", "left_amount", "right_amount"])
    return out, metrics, details, matched_df


def summary_line(m: dict, lname: str, rname: str) -> str:
    total = m["matched_rows"] + m["missing_in_right"] + m["amount_mismatches"] + m["unreadable_amounts"]
    parts = [f"{m['missing_in_right']} only in '{lname}'", f"{m['missing_in_left']} only in '{rname}'",
             f"{m['amount_mismatches']} amount differences", f"{m['unreadable_amounts']} unreadable amounts",
             f"{m['duplicate_keys']} duplicates"]
    shown = ", ".join(p for p in parts if not p.startswith("0 "))
    return (f"Matched {m['matched_rows']} of {total} rows from '{lname}'. "
            + (f"{m['exceptions']} exceptions: {shown}." if m["exceptions"] else "No exceptions."))
