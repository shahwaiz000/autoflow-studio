from app.analytics import safe_cell


def test_source_filter_separates_demo_from_live(client):
    allr = client.get("/api/analytics", params={"days": 30}).json()["totals"]["executions"]
    demo = client.get("/api/analytics", params={"days": 30, "source": "demo"}).json()["totals"]["executions"]
    live = client.get("/api/analytics", params={"days": 30, "source": "live"}).json()["totals"]["executions"]
    assert demo > 0 and demo + live == allr


def test_analytics_numbers_add_up(client):
    d = client.get("/api/analytics", params={"days": 14, "source": "demo"}).json()
    assert d["totals"]["successful"] + d["totals"]["failed"] == d["totals"]["executions"]
    assert len(d["daily"]) == 14
    assert sum(w["runs"] for w in d["workflows"]) == d["totals"]["executions"]


def test_bad_parameters_are_rejected(client):
    assert client.get("/api/analytics", params={"source": "everything"}).status_code == 422
    assert client.get("/api/analytics", params={"days": 0}).status_code == 422


def test_export_has_header_and_rows(client):
    r = client.get("/api/analytics/export", params={"days": 30, "source": "demo"})
    lines = r.text.strip().splitlines()
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert lines[0].startswith("execution_id,workflow,status") and len(lines) > 10


def test_csv_injection_is_neutralised():
    assert safe_cell("=1+1") == "'=1+1" and safe_cell("@SUM(A1)") == "'@SUM(A1)"
    assert safe_cell("Normal text") == "Normal text" and safe_cell(None) == ""
