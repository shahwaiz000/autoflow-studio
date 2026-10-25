from app.definitions import clean_definition
from app.templates import TEMPLATES


def test_every_template_passes_the_same_checks_as_the_editor():
    keys = [t["key"] for t in TEMPLATES]
    assert len(keys) == len(set(keys)) >= 5
    for t in TEMPLATES:
        definition, errors = clean_definition(t["steps"])
        assert errors == [], (t["key"], errors)


def test_using_every_template_creates_a_runnable_workflow(client):
    listed = client.get("/api/templates").json()
    assert len(listed) == len(TEMPLATES) and all(t["step_count"] > 2 for t in listed)
    outcomes = {}
    for t in listed:
        wf = client.post(f"/api/templates/{t['key']}/use")
        assert wf.status_code == 201 and wf.json()["built_in"] is False
        outcomes[t["key"]] = client.post(f"/api/workflows/{wf.json()['id']}/run").json()
    assert outcomes["invoice-alert"]["status"] == "success"
    assert "Alert finance team" in [s["name"] for s in outcomes["invoice-alert"]["steps"]]
    assert outcomes["customer-cleanup"]["status"] == "success"
    assert outcomes["sales-summary"]["status"] == "success"
    assert outcomes["new-hire-gate"]["status"] == "success"
    failed = outcomes["strict-gate-retry"]  # this one is meant to fail, after a retry
    assert failed["status"] == "failed" and max(s["attempts"] for s in failed["steps"]) == 2


def test_using_a_template_twice_gives_unique_names(client):
    a = client.post("/api/templates/sales-summary/use").json()["name"]
    b = client.post("/api/templates/sales-summary/use").json()["name"]
    assert a != b and "copy" in b


def test_unknown_template_is_404(client):
    assert client.post("/api/templates/nope/use").status_code == 404
