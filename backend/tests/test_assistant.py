"""The assistant must only offer workflows the engine can really run."""
from app.definitions import clean_definition


def propose(client, text):
    r = client.post("/api/assistant/propose", json={"request": text})
    assert r.status_code == 200
    return r.json()


def save_and_run(client, p):
    body = {"name": p["name"], "description": p["description"], "category": p["category"], "steps": p["steps"]}
    saved = client.post("/api/workflows", json=body)
    assert saved.status_code == 201, saved.text
    run = client.post(f"/api/workflows/{saved.json()['id']}/run")
    assert run.status_code == 201
    return run.json()


def types(p):
    return [s["type"] for s in p["steps"]]


def test_info_is_honest_about_not_being_an_ai_model(client):
    d = client.get("/api/assistant/info").json()
    assert d["provider"] == "rules" and d["uses_ai_model"] is False
    assert {x["file"] for x in d["datasets"]} == {"invoices.csv", "employees.csv", "customers.csv", "sales_orders.csv"}
    assert any("Nothing is emailed" in x for x in d["limits"])
    assert all(x["columns"] for x in d["datasets"])  # read from the real sample files


def test_alert_request_builds_a_branching_workflow_that_runs(client):
    p = propose(client, "Check invoices and alert finance if any are incomplete")
    assert p["status"] == "ok" and p["uses_ai_model"] is False
    assert types(p) == ["trigger", "load_csv", "validate", "condition", "notify", "report", "end"]
    assert p["steps"][1]["config"]["file"] == "invoices.csv"
    assert clean_definition(p["steps"])[1] == []  # passes the same safety check as the editor
    assert len(p["reasons"]) == len(p["steps"])
    run = save_and_run(client, p)
    assert run["status"] == "success"
    assert any(s["step_id"] == p["steps"][4]["id"] for s in run["steps"])  # the sample data has gaps, so the alert ran


def test_strict_request_stops_the_run_on_bad_data(client):
    p = propose(client, "Stop the run if any invoice row is incomplete")
    validate = next(s for s in p["steps"] if s["type"] == "validate")
    assert validate["config"]["fail_on_errors"] is True and "condition" not in types(p)
    run = save_and_run(client, p)
    assert run["status"] == "failed" and "fail_on_errors" in run["error_message"]


def test_cleanup_request_adds_a_cleaning_step_that_removes_rows(client):
    p = propose(client, "Clean the customer list: remove duplicates and extra spaces")
    t = next(s for s in p["steps"] if s["type"] == "transform")
    assert {"trim_text", "drop_duplicates"} <= set(t["config"]["operations"])
    assert p["category"] == "Data" and p["steps"][1]["config"]["file"] == "customers.csv"
    run = save_and_run(client, p)
    assert run["status"] == "success"
    log = next(s for s in run["steps"] if s["step_type"] == "transform")
    assert "43 -> " in log["message"]  # 43 sample rows go down


def test_numeric_columns_are_checked_for_sales_data(client):
    p = propose(client, "Summarize the sales orders")
    v = next(s for s in p["steps"] if s["type"] == "validate")
    assert v["config"]["numeric_columns"] == ["revenue", "units"] and p["name"].startswith("Sales orders")
    assert save_and_run(client, p)["status"] == "success"


def test_threshold_and_recipient_are_taken_from_the_request(client):
    p = propose(client, "Alert ops@example.com when more than 3 invoices are missing fields")
    c = next(s for s in p["steps"] if s["type"] == "condition")
    n = next(s for s in p["steps"] if s["type"] == "notify")
    assert (c["config"]["op"], c["config"]["value"]) == (">", 3) and n["config"]["to"] == "ops@example.com"


def test_unsupported_wishes_are_reported_not_hidden(client):
    p = propose(client, "Every Monday check the invoices and send a Slack message")
    text = " ".join(p["warnings"])
    assert "Scheduling is not built yet" in text and "Only CSV files are supported" in text


def test_stop_and_alert_conflict_is_explained(client):
    p = propose(client, "Stop and alert me if any invoice is incomplete")
    assert "condition" in types(p) and any("cannot send an alert" in w for w in p["warnings"])


def test_unknown_request_asks_for_detail_instead_of_guessing(client):
    p = propose(client, "make me a sandwich")
    assert p["status"] == "needs_detail" and p["steps"] == [] and "invoices" in p["message"]


def test_proposals_get_unique_names(client):
    first = propose(client, "Clean the customer list")
    save_and_run(client, first)
    second = propose(client, "Clean the customer list")
    assert second["name"] != first["name"]


def test_request_is_validated(client):
    assert client.post("/api/assistant/propose", json={"request": ""}).status_code == 422
    assert client.post("/api/assistant/propose", json={"request": "x" * 501}).status_code == 422
    assert client.post("/api/assistant/propose", json={}).status_code == 422


def test_explain_describes_each_step_and_gives_ideas(client):
    wfs = client.get("/api/workflows").json()
    wf = next(w for w in wfs if w["name"] == "Invoice Processing")
    d = client.get(f"/api/assistant/explain/{wf['id']}").json()
    assert len(d["steps"]) == wf["step_count"] and d["summary"].startswith("Invoice Processing has")
    assert all(s["text"] for s in d["steps"]) and d["history"]["runs"] > 0
    assert client.get("/api/assistant/explain/99999").status_code == 404


def test_explain_suggests_missing_pieces(client):
    steps = [{"id": "s1", "type": "trigger", "name": "Start", "config": {}},
             {"id": "s2", "type": "load_csv", "name": "Load", "config": {"file": "invoices.csv"}}]
    wf = client.post("/api/workflows", json={"name": "Bare workflow", "steps": steps}).json()
    d = client.get(f"/api/assistant/explain/{wf['id']}").json()
    joined = " ".join(d["suggestions"])
    assert "Check step" in joined and "Report step" in joined and "End step" in joined


def test_failure_insights_match_the_analytics_numbers(client):
    a = client.get("/api/analytics", params={"days": 14}).json()["totals"]
    f = client.get("/api/assistant/failures", params={"days": 14}).json()
    assert f["total_failed"] == a["failed"] and f["total_runs"] == a["executions"]
    assert sum(i["count"] for i in f["items"]) == f["total_failed"]
    assert [i["count"] for i in f["items"]] == sorted((i["count"] for i in f["items"]), reverse=True)
    assert all(i["advice"] and i["workflows"] for i in f["items"])
    assert str(f["total_failed"]) in f["headline"]


def test_failure_insights_reject_bad_parameters(client):
    assert client.get("/api/assistant/failures", params={"source": "everything"}).status_code == 422
    assert client.get("/api/assistant/failures", params={"days": 0}).status_code == 422
