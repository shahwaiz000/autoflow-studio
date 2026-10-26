"""Ready-made workflow templates. All of them use the fictional sample CSV files."""


def _s(id, type, name, next=None, retries=0, **config):
    d = {"id": id, "type": type, "name": name, "config": config}
    if next:
        d["next"] = next
    if retries:
        d["retries"] = retries
    return d


TEMPLATES = [
    dict(key="messy-file-tidy", name="Tidy a Messy Payments File", category="Data",
         description="Choose any payments file when you run it. Amounts like \"SAR 1,234.50\" become numbers, dates become one format, names are tidied, and you get an Excel report.",
         tags=["Choose file at run time", "Excel report", "Data tidy-up"],
         note="Pick messy_payments.csv (a fictional sample) or your own file with the columns payment_id, payer, amount and paid_on. Rows the tidy-up cannot read are reported, not hidden.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "Payments file", input="payments", table="payments"),
                _s("s3", "transform", "Tidy amounts, dates and names", operations=["trim_text", "normalize_amounts", "parse_dates", "standardize_text"],
                   amount_columns=["amount"], date_columns=["paid_on"], text_columns=["payment_id", "payer"], dayfirst=True),
                _s("s4", "validate", "Check required columns", required_columns=["payment_id", "payer", "amount", "paid_on"], numeric_columns=["amount"]),
                _s("s5", "report", "Excel report"), _s("s6", "end", "Done")]),
    dict(key="invoice-alert", name="Invoice Check with Alert", category="Finance",
         description="Checks invoices for missing fields and alerts the finance team only when problems are found.",
         tags=["Branching", "Validation"], note="Takes the alert path on the sample data.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "Load invoices", file="invoices.csv"),
                _s("s3", "validate", "Check invoice data", required_columns=["invoice_id", "vendor", "amount"], numeric_columns=["amount"]),
                _s("s4", "condition", "Any problem rows?", field="invalid_rows", op=">", value=0, on_true="s5", on_false="s6"),
                _s("s5", "notify", "Alert finance team", next="s6", to="finance@example.com", message="Some invoices have missing fields"),
                _s("s6", "report", "Generate report"), _s("s7", "end", "Done")]),
    dict(key="customer-cleanup", name="Customer List Cleanup", category="Data",
         description="Trims spaces, removes duplicate customers and rows with empty cells, then writes a report.",
         tags=["Data cleaning"], note="Cleans 43 sample rows down to 37.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "Load customers", file="customers.csv"),
                _s("s3", "validate", "Check customer data", required_columns=["customer_id", "email"]),
                _s("s4", "transform", "Clean data", operations=["trim_text", "drop_duplicates", "drop_missing"]),
                _s("s5", "report", "Generate cleanup report"), _s("s6", "end", "Done")]),
    dict(key="sales-summary", name="Sales Summary Report", category="Sales",
         description="Validates sales orders, checks that revenue is numeric, and writes summary statistics.",
         tags=["Reporting", "Validation"], note="Runs cleanly on the sample data.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "Load sales orders", file="sales_orders.csv"),
                _s("s3", "validate", "Check orders", required_columns=["order_id", "region", "revenue"], numeric_columns=["revenue", "units"]),
                _s("s4", "report", "Generate sales report"), _s("s5", "end", "Done")]),
    dict(key="new-hire-gate", name="New Hire Data Gate", category="HR",
         description="Stops the run if any new-hire record is incomplete, otherwise notifies IT to set up accounts.",
         tags=["Strict check", "Notification"], note="Passes on the sample data.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "Load new hires", file="employees.csv"),
                _s("s3", "validate", "Strict hire check", required_columns=["employee_id", "name", "department"], fail_on_errors=True),
                _s("s4", "notify", "Notify IT", to="it@example.com", message="New hires are ready for account setup"),
                _s("s5", "end", "Done")]),
    dict(key="strict-gate-retry", name="Strict Gate with Retry", category="Operations",
         description="Fails when any invoice row is incomplete. The check is tried twice before the run is marked failed.",
         tags=["Retries", "Failure handling"], note="Fails on purpose with the sample data, so you can study the failure log.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "Load invoices", file="invoices.csv"),
                _s("s3", "validate", "Strict invoice check", retries=1, required_columns=["invoice_id", "vendor", "amount"], fail_on_errors=True),
                _s("s4", "report", "Generate report"), _s("s5", "end", "Done")]),
]
