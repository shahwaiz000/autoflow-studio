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
    assert {x["file"] for x in d["datasets"]} == {"courier_collections.csv", "bank_deposits.csv"}
    assert any("Nothing is emailed" in x for x in d["limits"])
    assert all(x["columns"] for x in d["datasets"])  # read from the real sample files


def test_alert_request_builds_a_reconciliation_that_runs(client):
    p = propose(client, "Reconcile courier collections with bank deposits and alert finance if anything does not match")
    assert p["status"] == "ok" and types(p) == ["trigger", "load_csv", "load_csv", "compare", "condition", "notify", "report", "end"]
    run = save_and_run(client, p)
    assert run["status"] == "success" and run["result"]["metrics"]["exceptions"] == 7
    assert "Alert finance" in [s["name"] for s in run["steps"]]


def test_without_an_alert_request_there_is_no_alert_step(client):
    p = propose(client, "Compare the courier collections against the bank deposits")
    assert p["status"] == "ok" and "notify" not in types(p) and "condition" not in types(p)


def test_tolerance_and_recipient_are_taken_from_the_request(client):
    p = propose(client, "Reconcile courier cod with bank deposits allowing 5 and email ops@example.com when there are differences")
    compare = next(s for s in p["steps"] if s["type"] == "compare")
    assert compare["config"]["tolerance"] == 5.0
    assert next(s for s in p["steps"] if s["type"] == "notify")["config"]["to"] == "ops@example.com"


def test_schedule_wishes_are_reported_not_hidden(client):
    p = propose(client, "Every Monday reconcile courier collections with bank deposits")
    assert "Schedules page" in " ".join(p["warnings"])


def test_requests_that_are_not_reconciliations_ask_for_detail(client):
    for text in ["Check the invoices and send a Slack message", "make me a sandwich"]:
        p = propose(client, text)
        assert p["status"] == "needs_detail" and p["steps"] == [] and "reconcil" in p["message"].lower()
    p = propose(client, "Reconcile my SAP ledger with the bank")
    assert p["status"] == "needs_detail" and "COD Reconciliation" in p["message"]


def test_proposals_get_unique_names(client):
    text = "Reconcile courier collections with bank deposits"
    first = propose(client, text)
    save_and_run(client, first)
    assert propose(client, text)["name"] != first["name"]


def test_request_is_validated(client):
    assert client.post("/api/assistant/propose", json={"request": ""}).status_code == 422
    assert client.post("/api/assistant/propose", json={"request": "x" * 501}).status_code == 422
    assert client.post("/api/assistant/propose", json={}).status_code == 422


def test_explain_describes_each_step_and_gives_ideas(client):
    wfs = client.get("/api/workflows").json()
    wf = next(w for w in wfs if w["name"] == "COD Reconciliation")
    d = client.get(f"/api/assistant/explain/{wf['id']}").json()
    assert len(d["steps"]) == wf["step_count"] and d["summary"].startswith("COD Reconciliation has")
    assert all(s["text"] for s in d["steps"])
    assert any("Matches the rows of 'courier' to 'bank'" in s["text"] for s in d["steps"])
    assert any("choose a file when you run" in s["text"] for s in d["steps"])
    assert client.get("/api/assistant/explain/99999").status_code == 404


def test_explain_suggests_missing_pieces(client):
    steps = [{"id": "s1", "type": "trigger", "name": "Start", "config": {}},
             {"id": "s2", "type": "load_csv", "name": "Load", "config": {"file": "invoices.csv"}}]
    wf = client.post("/api/workflows", json={"name": "Bare workflow", "steps": steps}).json()
    d = client.get(f"/api/assistant/explain/{wf['id']}").json()
    joined = " ".join(d["suggestions"])
    assert "Check step" in joined and "Report step" in joined and "End step" in joined


def test_failure_insights_match_the_dashboard_numbers(client):
    t = client.get("/api/dashboard").json()["totals"]
    f = client.get("/api/assistant/failures", params={"days": 14}).json()
    assert f["total_failed"] >= 0 and f["total_runs"] <= t["runs"]
    assert sum(i["count"] for i in f["items"]) == f["total_failed"]
    assert [i["count"] for i in f["items"]] == sorted((i["count"] for i in f["items"]), reverse=True)
    assert all(i["advice"] and i["workflows"] for i in f["items"])
    assert str(f["total_failed"]) in f["headline"] or f["total_failed"] == 0


def test_failure_insights_reject_bad_parameters(client):
    assert client.get("/api/assistant/failures", params={"source": "everything"}).status_code == 422
    assert client.get("/api/assistant/failures", params={"days": 0}).status_code == 422
