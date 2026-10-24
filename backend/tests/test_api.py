def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_dashboard_values_are_consistent(client):
    d = client.get("/api/dashboard").json()
    t = d["totals"]
    assert t["successful"] + t["failed"] + t["running"] == t["executions"]
    assert d["data_source"]["demo_executions"] > 0
    assert len(d["trend"]) == 14


def test_run_workflow_persists_execution(client):
    wid = next(w["id"] for w in client.get("/api/workflows", params={"search": "Sales Report"}).json())
    r = client.post(f"/api/workflows/{wid}/run")
    assert r.status_code == 201 and r.json()["status"] == "success"
    detail = client.get(f"/api/executions/{r.json()['id']}").json()
    assert len(detail["steps"]) == 5 and detail["is_demo"] is False


def test_disabled_workflow_cannot_run_until_enabled(client):
    wf = next(w for w in client.get("/api/workflows", params={"enabled": False}).json())
    assert client.post(f"/api/workflows/{wf['id']}/run").status_code == 409
    assert client.patch(f"/api/workflows/{wf['id']}", json={"enabled": True}).json()["enabled"] is True


def test_errors_use_consistent_shape(client):
    r = client.get("/api/executions/99999")
    assert r.status_code == 404 and r.json()["error"]["code"] == "http_error"
    r = client.patch("/api/workflows/1", json={"enabled": "maybe"})
    assert r.status_code == 422 and "error" in r.json()


def test_workflow_search_and_filters(client):
    assert all("Invoice" in w["name"] for w in client.get("/api/workflows", params={"search": "Invoice"}).json())
    assert client.get("/api/executions", params={"status": "failed", "limit": 5}).status_code == 200
