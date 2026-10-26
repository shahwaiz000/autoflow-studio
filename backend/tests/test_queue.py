"""Background runs: queued first, then run by the worker, with honest handling of restarts and overload."""
import time

import pytest

from app import runqueue
from app.database import SessionLocal
from app.models import Execution, Workflow, utcnow


def wf_id(client, name="Invoice Processing"):
    return next(w["id"] for w in client.get("/api/workflows").json() if w["name"] == name)


def wait_for(client, eid, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        ex = client.get(f"/api/executions/{eid}").json()
        if ex["status"] not in ("queued", "running"):
            return ex
        time.sleep(0.05)
    raise AssertionError("the run never finished")


def test_background_run_returns_at_once_then_finishes(client):
    r = client.post(f"/api/workflows/{wf_id(client)}/run", params={"background": "true"})
    assert r.status_code == 202 and r.json()["status"] in ("queued", "running") and r.json()["steps"] == []
    done = wait_for(client, r.json()["id"])
    assert done["status"] == "success" and len(done["steps"]) > 3 and done["trigger_type"] == "manual"


def test_normal_run_still_waits_for_the_result(client):
    r = client.post(f"/api/workflows/{wf_id(client)}/run")
    assert r.status_code == 201 and r.json()["status"] == "success"


def test_a_queued_run_is_visible_as_queued_until_the_worker_picks_it_up():
    q = runqueue.RunQueue(SessionLocal)  # worker not started yet
    with SessionLocal() as db:
        wf = db.query(Workflow).filter_by(name="Invoice Processing").first()
        ex = q.submit(db, wf)
        assert ex.status == "queued" and q.waiting == 1
        eid = ex.id
    q.start()
    end = time.time() + 10
    while q.waiting or q.current:
        assert time.time() < end
        time.sleep(0.05)
    q.stop()
    with SessionLocal() as db:
        assert db.get(Execution, eid).status == "success"


def test_runs_go_one_after_another_in_order():
    q = runqueue.RunQueue(SessionLocal)
    with SessionLocal() as db:
        wf = db.query(Workflow).filter_by(name="Invoice Processing").first()
        ids = [q.submit(db, wf).id for _ in range(3)]
    q.start()
    end = time.time() + 15
    while q.finished_count < 3:
        assert time.time() < end
        time.sleep(0.05)
    q.stop()
    with SessionLocal() as db:
        runs = [db.get(Execution, i) for i in ids]
        assert [r.status for r in runs] == ["success"] * 3
        assert runs[0].started_at <= runs[1].started_at <= runs[2].started_at


def test_a_full_queue_says_so(client):
    q = runqueue.RunQueue(SessionLocal, max_waiting=2)
    with SessionLocal() as db:
        wf = db.query(Workflow).filter_by(name="Invoice Processing").first()
        q.submit(db, wf); q.submit(db, wf)
        with pytest.raises(runqueue.QueueFull):
            q.submit(db, wf)
        q._q.get_nowait(); q._q.get_nowait()
        for e in db.query(Execution).filter_by(status="queued").all():  # tidy up so later tests see a clean list
            e.status, e.finished_at, e.error_message = "failed", utcnow(), "test cleanup"
        db.commit()


def test_a_disabled_workflow_cannot_be_queued(client):
    wid = client.post("/api/workflows", json={"name": "Queue disabled test", "steps": [
        {"id": "s1", "type": "trigger", "name": "Start", "config": {}}]}).json()["id"]
    client.patch(f"/api/workflows/{wid}", json={"enabled": False})
    assert client.post(f"/api/workflows/{wid}/run", params={"background": "true"}).status_code == 409


def test_a_failing_background_run_is_recorded_as_failed(client):
    steps = [{"id": "s1", "type": "trigger", "name": "Start", "config": {}},
             {"id": "s2", "type": "load_csv", "name": "Load", "config": {"file": "invoices.csv"}},
             {"id": "s3", "type": "validate", "name": "Check", "config": {"fail_on_errors": True}}]
    wid = client.post("/api/workflows", json={"name": "Queue fail test", "steps": steps}).json()["id"]
    r = client.post(f"/api/workflows/{wid}/run", params={"background": "true"})
    done = wait_for(client, r.json()["id"])
    assert done["status"] == "failed" and "fail_on_errors" in done["error_message"]


def test_runs_left_over_from_a_restart_are_marked_failed_not_busy_forever(client):
    with SessionLocal() as db:
        wf = db.query(Workflow).filter_by(name="Invoice Processing").first()
        a = Execution(workflow=wf, status="queued"); b = Execution(workflow=wf, status="running")
        db.add_all([a, b]); db.commit()
        ids = (a.id, b.id)
        assert runqueue.recover_interrupted(db) >= 2
    for i in ids:
        ex = client.get(f"/api/executions/{i}").json()
        assert ex["status"] == "failed" and "backend was restarted" in ex["error_message"]


def test_queue_status_endpoint(client):
    s = client.get("/api/queue/status").json()
    assert s["running"] is True and s["waiting"] >= 0 and "restarts" in s["note"]
