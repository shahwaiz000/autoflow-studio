"""Idempotent seed data. Everything here is FICTIONAL.

Workflows and sample CSVs are upserted by name/filename. Historical executions
are generated once and flagged is_demo=True so the UI can label them as demo data.
"""
import random
from datetime import timedelta

import pandas as pd
from sqlalchemy.orm import Session

from .config import settings
from .models import Execution, ExecutionStep, Workflow, utcnow


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
    rnd = random.Random(7)
    vendors = ["Northwind Supplies", "Blue Harbor Ltd", "Orchid Logistics", "Summit Paper Co", "Kestrel IT"]
    inv = pd.DataFrame({
        "invoice_id": [f"INV-{1000 + i}" for i in range(60)],
        "vendor": [rnd.choice(vendors) for _ in range(60)],
        "amount": [round(rnd.uniform(80, 4200), 2) for _ in range(60)],
        "due_date": [f"2026-{rnd.randint(9, 12):02d}-{rnd.randint(1, 28):02d}" for _ in range(60)],
    })
    inv.loc[[4, 17, 31, 44], "amount"] = None
    inv.loc[[9, 23], "vendor"] = None
    inv.to_csv(d / "invoices.csv", index=False)
    emp = pd.DataFrame({
        "employee_id": [f"E{200 + i}" for i in range(25)],
        "name": [f"Employee {i + 1}" for i in range(25)],
        "department": [rnd.choice(["Finance", "Operations", "Support", "Sales"]) for _ in range(25)],
        "start_date": [f"2026-10-{rnd.randint(1, 28):02d}" for _ in range(25)],
    })
    emp.to_csv(d / "employees.csv", index=False)
    cust = pd.DataFrame({
        "customer_id": [f"C{300 + i}" for i in range(40)],
        "name": [f" Customer {i + 1} " for i in range(40)],
        "email": [f"customer{i + 1}@example.com" for i in range(40)],
    })
    cust.loc[[3, 11, 26], "email"] = None
    cust = pd.concat([cust, cust.iloc[[0, 1, 2]]], ignore_index=True)  # duplicates
    cust.to_csv(d / "customers.csv", index=False)
    sales = pd.DataFrame({
        "order_id": [f"SO-{5000 + i}" for i in range(80)],
        "region": [rnd.choice(["North", "South", "East", "West"]) for _ in range(80)],
        "revenue": [round(rnd.uniform(200, 9000), 2) for _ in range(80)],
        "units": [rnd.randint(1, 40) for _ in range(80)],
    })
    sales.to_csv(d / "sales_orders.csv", index=False)

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


WORKFLOWS = [
    dict(name="Invoice Processing", category="Finance",
         description="Load invoices, check required fields, alert finance when rows are incomplete, then summarize.",
         definition={"start": "t", "steps": [
             _s("t", "trigger", "Manual trigger", kind="manual"),
             _s("load", "load_csv", "Load invoices", file="invoices.csv"),
             _s("val", "validate", "Validate invoice data", required_columns=["invoice_id", "vendor", "amount"]),
             _s("cond", "condition", "Any invalid rows?", field="invalid_rows", op=">", value=0,
                on_true="notify", on_false="report"),
             _s("notify", "notify", "Alert finance team", next="report", to="finance@example.com",
                message="Some invoices have missing fields"),
             _s("report", "report", "Generate summary report"),
             _s("end", "end", "Done")]}),
    dict(name="Strict Invoice Audit", category="Finance",
         description="Same invoice file, but any missing value stops the run. Fails on the sample data by design.",
         definition={"steps": [
             _s("t", "trigger", "Manual trigger"),
             _s("load", "load_csv", "Load invoices", file="invoices.csv"),
             _s("val", "validate", "Strict validation", required_columns=["invoice_id", "vendor", "amount"],
                fail_on_errors=True, retries=1),
             _s("report", "report", "Generate audit report"), _s("end", "end", "Done")]}),
    dict(name="Employee Onboarding", category="HR",
         description="Validate the new-hire list and notify IT to prepare accounts.",
         definition={"steps": [
             _s("t", "trigger", "Manual trigger"),
             _s("load", "load_csv", "Load new hires", file="employees.csv"),
             _s("val", "validate", "Validate hire records", required_columns=["employee_id", "name", "department"],
                fail_on_errors=True),
             _s("notify", "notify", "Notify IT", to="it@example.com", message="New hires ready for setup"),
             _s("end", "end", "Done")]}),
    dict(name="Customer Data Cleanup", category="Data",
         description="Remove duplicate and incomplete customer records and trim text fields.",
         definition={"steps": [
             _s("t", "trigger", "Manual trigger"),
             _s("load", "load_csv", "Load customers", file="customers.csv"),
             _s("tr", "transform", "Clean data", operations=["trim_text", "drop_duplicates", "drop_missing"]),
             _s("report", "report", "Generate cleanup report"), _s("end", "end", "Done")]}),
    dict(name="Sales Report Generation", category="Sales",
         description="Summarize sales orders into a statistics report.",
         definition={"steps": [
             _s("t", "trigger", "Manual trigger"),
             _s("load", "load_csv", "Load sales orders", file="sales_orders.csv"),
             _s("val", "validate", "Validate orders", required_columns=["order_id", "revenue"]),
             _s("report", "report", "Generate sales report"), _s("end", "end", "Done")]}),
    dict(name="CSV Upload Cleaner", category="Data",
         description="Cleans a CSV file. Use the Upload CSV page to run it on your own file. The Run button here uses a built-in sample file.",
         definition={"steps": [
             _s("t", "trigger", "File received", kind="upload"),
             _s("load", "load_csv", "Load CSV file", file="customers.csv"),
             _s("val", "validate", "Check columns, missing values and duplicates", required_columns=["customer_id"]),
             _s("tr", "transform", "Clean data", operations=["trim_text", "drop_duplicates", "drop_missing"]),
             _s("report", "report", "Generate report"), _s("end", "end", "Done")]}),
    dict(name="Legacy Vendor Sync", category="Operations", enabled=False,
         description="Disabled example. Enable it to see a run that fails on a missing file.",
         definition={"steps": [
             _s("t", "trigger", "Manual trigger"),
             _s("load", "load_csv", "Load vendor export", file="vendor_export.csv"),
             _s("end", "end", "Done")]}),
]

FAILURES = ["Missing required columns: vendor", "Timeout while loading file",
            "CSV file 'export.csv' was not found in the samples folder",
            "rows have missing values (fail_on_errors is enabled)"]


def seed(db: Session) -> None:
    make_samples()
    for w in WORKFLOWS:
        row = db.query(Workflow).filter_by(name=w["name"]).first()
        if row is None:
            db.add(Workflow(name=w["name"], category=w["category"], description=w["description"],
                            definition=w["definition"], enabled=w.get("enabled", True)))
    db.commit()
    if db.query(Execution).filter_by(is_demo=True).count() == 0:
        _seed_history(db)


def _seed_history(db: Session) -> None:
    rnd = random.Random(42)
    wfs = [w for w in db.query(Workflow).all() if w.enabled]
    now = utcnow()
    for i in range(110):
        wf = rnd.choice(wfs)
        start = now - timedelta(days=rnd.randint(0, 13), hours=rnd.randint(0, 23), minutes=rnd.randint(0, 59))
        failed = rnd.random() < 0.12
        dur = round(rnd.uniform(20, 280), 1)
        ex = Execution(workflow=wf, trigger_type=rnd.choice(["manual", "schedule", "schedule"]),
                       status="failed" if failed else "success", started_at=start,
                       finished_at=start + timedelta(seconds=dur), duration_seconds=dur, is_demo=True,
                       error_message=rnd.choice(FAILURES) if failed else None)
        steps = wf.definition["steps"]
        stop = rnd.randint(1, len(steps) - 1) if failed else len(steps)
        for pos, st in enumerate(steps[:stop], 1):
            last_bad = failed and pos == stop
            ex.steps.append(ExecutionStep(
                position=pos, step_id=st["id"], step_type=st["type"], name=st["name"],
                status="failed" if last_bad else "success", message=ex.error_message if last_bad else "Completed (seeded demo)",
                duration_ms=rnd.randint(20, 900)))
        db.add(ex)
    db.commit()
