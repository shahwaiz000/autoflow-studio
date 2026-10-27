"""Idempotent seed data. Everything here is FICTIONAL.

The built-in workflow and the sample CSVs are created if missing. Old demo data from earlier versions is removed.
"""
import random

import pandas as pd
from sqlalchemy.orm import Session

from .config import settings
from .models import Execution, Schedule, Workflow
from .templates import TEMPLATES


def _s(id, type, name, next=None, retries=0, **config):
    d = {"id": id, "type": type, "name": name, "config": config}
    if next:
        d["next"] = next
    if retries:
        d["retries"] = retries
    return d


def make_samples() -> None:
    d = settings.samples_dir
    d.mkdir(parents=True, exist_ok=True)
    # A deliberately messy export (fictional): mixed amount formats, mixed date formats, untidy names.
    r2 = random.Random(11)
    payers = ["northwind supplies", "BLUE HARBOR LTD", "  Orchid  Logistics ", "Summit Paper Co", "kestrel it"]
    def amount(i: int) -> str:
        v = round(r2.uniform(50, 9000), 2)
        style = i % 6
        return [f"{v:,.2f}", f"SAR {v:,.2f}", f"{v:,.2f} SAR", str(v), f"({v:,.2f})", "pending"][style]
    def pay_date(i: int) -> str:
        day, month = r2.randint(1, 28), r2.randint(8, 10)
        return [f"{day:02d}/{month:02d}/2026", f"2026-{month:02d}-{day:02d}", f"{day}-{month}-2026", "soon"][i % 4]
    pd.DataFrame({
        "payment_id": [f" pay-{2000 + i} " if i % 5 == 0 else f"PAY-{2000 + i}" for i in range(36)],
        "payer": [r2.choice(payers) for _ in range(36)],
        "amount": [amount(i) for i in range(36)],
        "paid_on": [pay_date(i) for i in range(36)],
    }).to_csv(d / "messy_payments.csv", index=False)

    # Fictional cash-on-delivery reconciliation pair. The differences are planted on purpose, so the
    # right answer is known: 55 rows match and 7 do not (3 missing in the bank file, 2 amount differences,
    # 1 only in the bank file, 1 duplicate in the courier file). A few keys are written untidily and still match.
    r3 = random.Random(21)
    waybills = [f"WB-{70001 + i}" for i in range(60)]
    amounts = [round(r3.uniform(40, 1800), 2) for _ in range(60)]
    couriers = ["Falcon Express", "Desert Wind Couriers", "Red Sea Delivery"]
    courier = pd.DataFrame({
        "waybill": waybills,
        "delivered_on": [f"2026-10-{1 + i % 25:02d}" for i in range(60)],
        "courier": [r3.choice(couriers) for _ in range(60)],
        "cod_amount": amounts,
    })
    courier = pd.concat([courier, courier.iloc[[5]]], ignore_index=True)  # the same waybill entered twice
    skip = {7, 23, 41}                      # collected, but never deposited
    short = {12: -15.00, 30: 0.50}          # deposited with the wrong amount
    bank_rows = []
    for i, (wb, amt) in enumerate(zip(waybills, amounts)):
        if i in skip:
            continue
        paid = round(amt + short.get(i, 0), 2)
        ref = wb.lower() if i % 17 == 3 else (f" {wb} " if i % 19 == 4 else wb)  # untidy but still the same waybill
        bank_rows.append({"reference": ref, "deposit_date": f"2026-10-{2 + i % 25:02d}",
                          "amount": f"SAR {paid:,.2f}" if i % 11 == 2 else paid})
    bank_rows.append({"reference": "WB-79999", "deposit_date": "2026-10-27", "amount": 120.00})  # deposited, nobody collected it
    _make_pos_samples(d)
    courier.to_csv(d / "courier_collections.csv", index=False)
    pd.DataFrame(bank_rows).to_csv(d / "bank_deposits.csv", index=False)


def _make_pos_samples(d) -> None:
    """Fictional POS collection pair: orders closed in the system, and what the drivers' POS machines actually collected.
    The problems are planted, so the right answer is known: 53 of 60 orders match and 10 rows are exceptions
    (2 orders with no POS payment, 5 wrong amounts, 2 POS payments with no order, 1 payment swiped twice)."""
    r = random.Random(31)
    drivers = [f"DRV-{101 + i}" for i in range(5)]
    n = 60
    order_ids = [f"ORD-{50001 + i}" for i in range(n)]
    amounts = [round(r.choice([r.uniform(25, 400), r.uniform(400, 900)]), 2) for _ in range(n)]
    system = pd.DataFrame({
        "order_id": order_ids,
        "closed_on": [f"2026-10-{1 + i % 25:02d}" for i in range(n)],
        "driver": [drivers[i % 5] for i in range(n)],
        "amount": amounts,
    })
    skip = {9, 33}                                                          # order closed, no POS payment
    wrong = {4: -18.00, 15: 10.00, 27: -90.00, 38: -0.50, 52: 5.00}         # POS collected a different amount
    rows = []
    for i, (oid, amt) in enumerate(zip(order_ids, amounts)):
        if i in skip:
            continue
        paid = round(amt + wrong.get(i, 0), 2)
        ref = oid.lower() if i % 13 == 3 else (f" {oid} " if i % 17 == 5 else oid)  # untidy, still the same order
        rows.append({"pos_ref": f"TXN-{90001 + i}", "order_id": ref, "driver": drivers[i % 5], "terminal": f"POS-{1 + i % 5}",
                     "collected_at": f"2026-10-{1 + i % 25:02d}", "amount": f"SAR {paid:,.2f}" if i % 11 == 2 else paid})
    rows.append({**rows[19], "pos_ref": "TXN-90999"})                       # the same payment swiped and recorded twice
    rows.append({"pos_ref": "TXN-91001", "order_id": "ORD-59901", "driver": drivers[0], "terminal": "POS-1", "collected_at": "2026-10-26", "amount": 140.00})
    rows.append({"pos_ref": "TXN-91002", "order_id": "ORD-59902", "driver": drivers[2], "terminal": "POS-3", "collected_at": "2026-10-27", "amount": 75.50})
    system.to_csv(d / "pos_system_orders.csv", index=False)
    pd.DataFrame(rows).to_csv(d / "pos_collections.csv", index=False)


def _cod_workflow() -> dict:
    t = next(t for t in TEMPLATES if t["key"] == "cod-reconciliation")
    return dict(name=t["name"], category=t["category"], description=t["description"], definition={"steps": t["steps"]})


# Workflows and sample files that older versions created. They were demo material that has nothing to do with
# reconciliation. They are removed only when nobody has really used them.
LEGACY_WORKFLOWS = ["Invoice Processing", "Strict Invoice Audit", "Employee Onboarding", "Customer Data Cleanup",
                    "Sales Report Generation", "CSV Upload Cleaner", "Legacy Vendor Sync"]
LEGACY_FILES = ["invoices.csv", "employees.csv", "customers.csv", "sales_orders.csv"]


def remove_legacy_demo(db: Session) -> None:
    """Delete the randomly generated demo history and the old demo workflows nobody really used."""
    for ex in db.query(Execution).filter_by(is_demo=True).all():
        db.delete(ex)
    db.flush()
    for name in LEGACY_WORKFLOWS:
        wf = db.query(Workflow).filter_by(name=name).first()
        if wf and not db.query(Execution).filter_by(workflow_id=wf.id).count() and not db.query(Schedule).filter_by(workflow_id=wf.id).count():
            db.delete(wf)
    db.commit()
    used = {step.get("config", {}).get("file") for wf in db.query(Workflow).all() for step in wf.definition.get("steps", [])}
    for f in LEGACY_FILES:
        if f not in used:
            (settings.samples_dir / f).unlink(missing_ok=True)


def seed(db: Session) -> None:
    make_samples()
    w = _cod_workflow()
    if db.query(Workflow).filter_by(name=w["name"]).first() is None:
        db.add(Workflow(name=w["name"], category=w["category"], description=w["description"], definition=w["definition"], enabled=True))
        db.commit()
    if settings.remove_legacy_demo:
        remove_legacy_demo(db)
