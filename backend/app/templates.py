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
    dict(key="cod-reconciliation", name="COD Reconciliation", category="Finance",
         description="Choose a courier collections file and a bank deposits file when you run it. Every waybill is matched to its bank reference and the amounts are compared. Anything that does not agree is listed as an exception with a reason.",
         tags=["Reconciliation", "Choose files at run time", "Exceptions", "Excel report"],
         note="Pick courier_collections.csv and bank_deposits.csv (fictional samples with planted differences) or your own files. Columns needed: waybill and cod_amount; reference and amount. The alert goes to finance@example.com, a placeholder that is never emailed: open the workflow in the Builder and change it to a real address to get emails.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "Courier collections", input="courier", table="courier"),
                _s("s3", "load_csv", "Bank deposits", input="bank", table="bank"),
                _s("s4", "compare", "Match collections to deposits", left="courier", right="bank", left_key="waybill", right_key="reference",
                   left_amount="cod_amount", right_amount="amount", tolerance=0.01),
                _s("s5", "condition", "Any exceptions?", field="exceptions", op=">", value=0, on_true="s6", on_false="s7"),
                _s("s6", "notify", "Alert finance team", next="s7", to="finance@example.com", message="Collections and deposits do not fully match"),
                _s("s7", "report", "Excel report", table="courier"), _s("s8", "end", "Done")]),
    dict(key="pos-reconciliation", name="POS Collection Reconciliation", category="Finance",
         description="Choose the orders closed in your system and the POS collection records from the drivers when you run it. Every order is matched to its POS payment and the amounts are compared. Differences are listed with the exact amount, and each driver gets a summary.",
         tags=["Reconciliation", "Choose files at run time", "Exceptions", "By driver", "Excel report"],
         note="Pick pos_system_orders.csv and pos_collections.csv (fictional samples with planted differences) or your own files. Columns needed: order_id, amount and driver in both files. The difference is the system amount minus the POS amount, so a positive number means the system recorded more than the POS collected. The alert goes to finance@example.com, a placeholder that is never emailed: open the workflow in the Builder and change it to get emails.",
         steps=[_s("s1", "trigger", "Start"),
                _s("s2", "load_csv", "System orders", input="system", table="system"),
                _s("s3", "load_csv", "POS collections", input="pos", table="pos"),
                _s("s4", "compare", "Match orders to POS payments", left="system", right="pos", left_key="order_id", right_key="order_id",
                   left_amount="amount", right_amount="amount", tolerance=0, group_by="driver"),
                _s("s5", "condition", "Any exceptions?", field="exceptions", op=">", value=0, on_true="s6", on_false="s7"),
                _s("s6", "notify", "Alert finance team", next="s7", to="finance@example.com", message="System orders and POS collections do not fully match"),
                _s("s7", "report", "Excel report", table="system"), _s("s8", "end", "Done")]),
]
