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
    assert client.post("/api/workflows", json=with_step(1, config={"file": "a.csv", "source": "elsewhere"})).status_code == 422  # only samples or uploads
    assert client.post("/api/workflows", json=with_step(3, config={"field": "os.system", "op": ">", "value": 1, "on_true": "s5", "on_false": "s6"})).status_code == 422
    r = client.post("/api/workflows", json=with_step(3, config={"field": "invalid_rows", "op": ">", "value": 1, "on_true": "nope", "on_false": "s6"}))
    assert r.status_code == 422 and "unknown step" in r.json()["error"]["message"]
    assert client.post("/api/workflows", json=_body(name="x", steps=[])).status_code == 422
    assert client.post("/api/workflows", json=_body(name="y", steps=GOOD["steps"] * 5)).status_code == 422


def test_update_and_protect_built_in_workflows(client):
    wid = client.post("/api/workflows", json=_body(name="To Edit")).json()["id"]
    r = client.put(f"/api/workflows/{wid}", json=_body(name="Edited", description="new"))
    assert r.status_code == 200 and r.json()["name"] == "Edited"
    built = client.get("/api/workflows", params={"search": "COD Reconciliation"}).json()[0]
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


def test_box_positions_are_saved_and_checked(client):
    body = _body(name="With Positions")
    for i, st in enumerate(body["steps"]):
        st["pos"] = {"x": 10.26 * i, "y": 100 * i}
    wid = client.post("/api/workflows", json=body).json()["id"]
    saved = client.get(f"/api/workflows/{wid}").json()["definition"]["steps"]
    assert saved[1]["pos"] == {"x": 10.3, "y": 100}
    assert client.post("/api/workflows/%d/run" % wid).json()["status"] == "success"  # positions do not affect running
    for bad in ({"x": "a", "y": 1}, {"x": 1}, {"x": 99999, "y": 0}, [1, 2]):
        b = _body(name="Bad Pos")
        b["steps"][0]["pos"] = bad
        assert client.post("/api/workflows", json=b).status_code == 422


def test_delete_with_history_erases_runs_and_files_but_never_audited_ones(client):
    from app.config import settings
    body = lambda n: _body(name=n)
    a = client.post("/api/workflows", json=body("Erase me")).json()["id"]
    ex = client.post(f"/api/workflows/{a}/run").json()
    client.post(f"/api/workflows/{a}/run")
    assert client.delete(f"/api/workflows/{a}").status_code == 409  # by default history protects it
    assert client.get(f"/api/workflows/{a}").status_code == 200
    r = client.delete(f"/api/workflows/{a}", params={"with_history": "true"})
    assert r.status_code == 200 and r.json() == {"deleted": True, "runs_deleted": 2}
    assert client.get(f"/api/workflows/{a}").status_code == 404 and client.get(f"/api/executions/{ex['id']}").status_code == 404
    assert not list(settings.reports_dir.glob(f"execution_{ex['id']}_*"))
    # the built-in one can never be erased, with or without history
    cod = next(w for w in client.get("/api/workflows").json() if w["name"] == "COD Reconciliation")
    assert client.delete(f"/api/workflows/{cod['id']}", params={"with_history": "true"}).status_code == 409


def test_a_workflow_whose_runs_were_reviewed_cannot_be_erased(client):
    wf = client.post("/api/workflows/%d/run" % next(w["id"] for w in client.get("/api/workflows").json() if w["name"] == "COD Reconciliation"),
                     json={"inputs": {"courier": {"source": "samples", "file": "courier_collections.csv"}, "bank": {"source": "samples", "file": "bank_deposits.csv"}}}).json()
    copy = client.post("/api/templates/cod-reconciliation/use").json()
    run = client.post(f"/api/workflows/{copy['id']}/run", json={"inputs": {"courier": {"source": "samples", "file": "courier_collections.csv"}, "bank": {"source": "samples", "file": "bank_deposits.csv"}}}).json()
    first = client.get(f"/api/executions/{run['id']}/exceptions").json()["items"][0]["id"]
    client.post(f"/api/executions/{run['id']}/exceptions/decide", json={"ids": [first], "decision": "approved", "note": "ok"})
    r = client.delete(f"/api/workflows/{copy['id']}", params={"with_history": "true"})
    assert r.status_code == 409 and "audit trail" in r.json()["error"]["message"]
    assert client.get(f"/api/executions/{run['id']}").status_code == 200
