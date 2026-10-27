from app.definitions import clean_definition
from app.templates import TEMPLATES


def test_every_template_passes_the_same_checks_as_the_editor():
    keys = [t["key"] for t in TEMPLATES]
    assert len(keys) == len(set(keys)) == 3
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
        pick = {"courier": "courier_collections.csv", "bank": "bank_deposits.csv", "payments": "messy_payments.csv",
                "system": "pos_system_orders.csv", "pos": "pos_collections.csv"}
        files = {i["name"]: {"source": "samples", "file": pick[i["name"]]} for i in wf.json()["inputs"]}  # slots the template asks for
        outcomes[t["key"]] = client.post(f"/api/workflows/{wf.json()['id']}/run", json={"inputs": files} if files else None).json()
    tidy = outcomes["messy-file-tidy"]
    assert tidy["status"] == "success" and tidy["inputs"][0]["file"] == "messy_payments.csv"
    msg = next(s for s in tidy["steps"] if s["step_id"] == "s3")["message"]
    assert "reformatted" in msg and "could not be read" in msg  # the sample really is messy, and the run says so
    cod = outcomes["cod-reconciliation"]
    assert cod["status"] == "success"
    assert "Alert finance team" in [s["name"] for s in cod["steps"]]
    assert cod["result"]["metrics"]["matched_rows"] == 55 and cod["result"]["metrics"]["exceptions"] == 7
    pos = outcomes["pos-reconciliation"]
    assert pos["status"] == "success" and pos["result"]["metrics"]["matched_rows"] == 53 and pos["result"]["metrics"]["exceptions"] == 10


def test_using_a_template_twice_gives_unique_names(client):
    a = client.post("/api/templates/cod-reconciliation/use").json()["name"]
    b = client.post("/api/templates/cod-reconciliation/use").json()["name"]
    assert a != b and "copy" in b


def test_unknown_template_is_404(client):
    assert client.post("/api/templates/nope/use").status_code == 404
