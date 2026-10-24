import copy

GOOD = {"name": "My Sales Check", "description": "demo", "category": "Sales", "steps": [
    {"id": "s1", "type": "trigger", "name": "Start", "config": {"kind": "manual"}},
    {"id": "s2", "type": "load_csv", "name": "Load", "config": {"file": "sales_orders.csv"}},
    {"id": "s3", "type": "validate", "name": "Check", "config": {"required_columns": ["order_id"], "numeric_columns": ["revenue"]}},
    {"id": "s4", "type": "condition", "name": "Any bad rows?", "config": {"field": "invalid_rows", "op": ">", "value": 0, "on_true": "s5", "on_false": "s6"}},
    {"id": "s5", "type": "notify", "name": "Tell team", "next": "s6", "config": {"to": "team", "message": "Bad rows found"}},
    {"id": "s6", "type": "report", "name": "Report", "config": {}},
    {"id": "s7", "type": "end", "name": "Done", "config": {}},
]}


def _body(**changes):
    b = copy.deepcopy(GOOD)
    b.update(changes)
    return b


def test_create_then_run_custom_workflow(client):
    r = client.post("/api/workflows", json=GOOD)
    assert r.status_code == 201 and r.json()["built_in"] is False
    run = client.post(f"/api/workflows/{r.json()['id']}/run").json()
    assert run["status"] == "success" and len(run["steps"]) == 6  # the notify step was skipped by the condition


def test_duplicate_name_is_rejected(client):
    assert client.post("/api/workflows", json=_body(name="Invoice Processing")).status_code == 409


def test_bad_definitions_are_rejected_with_clear_messages(client):
    def with_step(i, **ch):
        b = copy.deepcopy(GOOD)
        b["name"] = f"bad {i}"
        b["steps"][i].update(ch)
        return b
    assert client.post("/api/workflows", json=with_step(1, type="python_exec")).status_code == 422
    assert client.post("/api/workflows", json=with_step(1, config={"file": "../../etc/passwd.csv"})).status_code == 422
    assert client.post("/api/workflows", json=with_step(1, config={"file": "a.csv", "source": "uploads"})).status_code == 422
    assert client.post("/api/workflows", json=with_step(3, config={"field": "os.system", "op": ">", "value": 1, "on_true": "s5", "on_false": "s6"})).status_code == 422
    r = client.post("/api/workflows", json=with_step(3, config={"field": "invalid_rows", "op": ">", "value": 1, "on_true": "nope", "on_false": "s6"}))
    assert r.status_code == 422 and "unknown step" in r.json()["error"]["message"]
    assert client.post("/api/workflows", json=_body(name="x", steps=[])).status_code == 422
    assert client.post("/api/workflows", json=_body(name="y", steps=GOOD["steps"] * 5)).status_code == 422


def test_update_and_protect_built_in_workflows(client):
    wid = client.post("/api/workflows", json=_body(name="To Edit")).json()["id"]
    r = client.put(f"/api/workflows/{wid}", json=_body(name="Edited", description="new"))
    assert r.status_code == 200 and r.json()["name"] == "Edited"
    built = client.get("/api/workflows", params={"search": "Employee Onboarding"}).json()[0]
    assert built["built_in"] is True
    full = client.get(f"/api/workflows/{built['id']}").json()
    renamed = {"name": "Other name", "steps": full["definition"]["steps"]}
    assert client.put(f"/api/workflows/{built['id']}", json=renamed).status_code == 409
    same = {"name": built["name"], "steps": full["definition"]["steps"]}
    assert client.put(f"/api/workflows/{built['id']}", json=same).status_code == 200  # seeded steps still pass the checks
    assert client.delete(f"/api/workflows/{built['id']}").status_code == 409


def test_delete_rules(client):
    a = client.post("/api/workflows", json=_body(name="Delete Me")).json()["id"]
    assert client.delete(f"/api/workflows/{a}").status_code == 200
    b = client.post("/api/workflows", json=_body(name="Has History")).json()["id"]
    client.post(f"/api/workflows/{b}/run")
    assert client.delete(f"/api/workflows/{b}").status_code == 409


def test_every_seeded_workflow_passes_the_editor_checks(client):
    for w in client.get("/api/workflows").json():
        full = client.get(f"/api/workflows/{w['id']}").json()
        r = client.put(f"/api/workflows/{w['id']}", json={"name": w["name"], "steps": full["definition"]["steps"]})
        assert r.status_code == 200, (w["name"], r.text)


def test_sample_files_list(client):
    assert "invoices.csv" in client.get("/api/samples").json()
