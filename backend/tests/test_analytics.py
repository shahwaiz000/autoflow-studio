from app.analytics import safe_cell


def _run_cod(client):
    wf = next(w for w in client.get("/api/workflows").json() if w["name"] == "COD Reconciliation")
    body = {"inputs": {"courier": {"source": "samples", "file": "courier_collections.csv"},
                       "bank": {"source": "samples", "file": "bank_deposits.csv"}}}
    return client.post(f"/api/workflows/{wf['id']}/run", json=body).json()


def test_dashboard_is_empty_of_reconciliations_before_any_run(client):
    d = client.get("/api/dashboard").json()
    assert d["latest"] is None or d["totals"]["reconciliations"] > 0
    assert len(d["trend"]) == 30


def test_dashboard_reports_the_latest_reconciliation_from_real_results(client):
    ex = _run_cod(client)
    d = client.get("/api/dashboard").json()
    latest = d["latest"]
    assert latest["execution_id"] == ex["id"]
    assert latest["matched_rows"] == 55 and latest["exceptions"] == 7
    assert latest["amount_at_risk"] == 2103.41  # 15.50 of differences + 2087.91 unmatched
    assert d["exceptions_by_kind"]["missing_in_right"] >= 3
    assert d["trend"][-1]["exceptions"] >= 7
    assert d["totals"]["reconciliations"] >= 1


def test_no_made_up_history_ships_with_the_product(client):
    runs = client.get("/api/executions").json()
    items = runs["items"] if isinstance(runs, dict) else runs
    assert not any(e.get("is_demo") for e in items)


def test_csv_injection_is_neutralised():
    assert safe_cell("=1+1") == "'=1+1" and safe_cell("@SUM(A1)") == "'@SUM(A1)"
    assert safe_cell("Normal text") == "Normal text" and safe_cell(None) == ""
