"""Schedules: next-run maths, creating, running what is due, and the safety rules."""
from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models import Schedule, utcnow
from app import schedules


def wf_id(client, name="Invoice Processing"):
    return next(w["id"] for w in client.get("/api/workflows").json() if w["name"] == name)


def make(client, **kw):
    body = {"workflow_id": wf_id(client), "kind": "interval", "interval_minutes": 30}
    body.update(kw)
    return client.post("/api/schedules", json=body)


def test_interval_schedule_is_created_with_a_next_run(client):
    r = make(client)
    assert r.status_code == 201
    d = r.json()
    assert d["summary"] == "Every 30 minutes" and d["next_run_at"] and d["last_run_at"] is None
    assert d["workflow_name"] == "Invoice Processing"


def test_daily_time_uses_the_persons_clock():
    s = Schedule(kind="daily", time_of_day="08:30", tz_offset_minutes=180)  # Jeddah
    after = datetime(2026, 10, 26, 4, 0)  # 07:00 in Jeddah, so 08:30 is still today
    assert schedules.next_run(s, after) == datetime(2026, 10, 26, 5, 30)  # 05:30 UTC
    after = datetime(2026, 10, 26, 6, 0)  # 09:00 in Jeddah, so tomorrow
    assert schedules.next_run(s, after) == datetime(2026, 10, 27, 5, 30)


def test_weekly_next_run_lands_on_the_right_weekday():
    s = Schedule(kind="weekly", weekday=0, time_of_day="09:00", tz_offset_minutes=0)  # Monday
    after = datetime(2026, 10, 26, 10, 0)  # a Monday, already past 09:00
    nxt = schedules.next_run(s, after)
    assert nxt == datetime(2026, 11, 2, 9, 0) and nxt.weekday() == 0
    assert schedules.next_run(s, datetime(2026, 10, 28, 12, 0)) == datetime(2026, 11, 2, 9, 0)


def test_next_run_is_always_after_now_even_exactly_on_time():
    s = Schedule(kind="daily", time_of_day="08:00", tz_offset_minutes=0)
    assert schedules.next_run(s, datetime(2026, 10, 26, 8, 0)) == datetime(2026, 10, 27, 8, 0)


def test_descriptions_are_plain_words():
    assert schedules.describe(Schedule(kind="interval", interval_minutes=120)) == "Every 2 hours"
    assert schedules.describe(Schedule(kind="interval", interval_minutes=90)) == "Every 90 minutes"
    assert schedules.describe(Schedule(kind="daily", time_of_day="08:30", tz_offset_minutes=180)) == "Every day at 08:30 (UTC+3)"
    assert schedules.describe(Schedule(kind="weekly", weekday=0, time_of_day="09:00", tz_offset_minutes=0)) == "Every Monday at 09:00 (UTC+0)"


def test_bad_schedules_are_rejected_with_a_reason(client):
    assert make(client, interval_minutes=1).status_code == 422
    assert make(client, interval_minutes=None).status_code == 422
    assert make(client, kind="hourly").status_code == 422
    assert make(client, kind="daily", time_of_day="25:00").status_code == 422
    assert make(client, kind="daily", time_of_day=None).status_code == 422
    assert make(client, kind="weekly", time_of_day="09:00", weekday=9).status_code == 422
    assert make(client, tz_offset_minutes=5000).status_code == 422
    assert make(client, workflow_id=99999).status_code == 404


def test_due_schedule_runs_the_workflow_as_a_scheduled_run(client):
    sid = make(client, interval_minutes=10).json()["id"]
    with SessionLocal() as db:
        assert schedules.run_due(db, utcnow()) == [] or all(x["schedule_id"] != sid for x in schedules.run_due(db, utcnow()))
        ran = schedules.run_due(db, utcnow() + timedelta(minutes=11))
    mine = [x for x in ran if x["schedule_id"] == sid]
    assert len(mine) == 1 and mine[0]["status"] == "Success"
    ex = client.get(f"/api/executions/{mine[0]['execution_id']}").json()
    assert ex["trigger_type"] == "schedule" and ex["status"] == "success" and ex["is_demo"] is False
    d = next(s for s in client.get("/api/schedules").json() if s["id"] == sid)
    assert d["last_execution_id"] == ex["id"] and d["last_status"] == "Success"


def test_missed_runs_are_not_piled_up(client):
    sid = make(client, interval_minutes=5).json()["id"]
    with SessionLocal() as db:
        late = utcnow() + timedelta(days=3)  # backend was off for three days
        ran = [x for x in schedules.run_due(db, late) if x["schedule_id"] == sid]
        again = [x for x in schedules.run_due(db, late) if x["schedule_id"] == sid]
    assert len(ran) == 1 and again == []


def test_disabled_schedule_does_not_run_and_enabling_restarts_the_clock(client):
    sid = make(client, interval_minutes=5).json()["id"]
    assert client.patch(f"/api/schedules/{sid}", json={"enabled": False}).json()["enabled"] is False
    with SessionLocal() as db:
        assert not [x for x in schedules.run_due(db, utcnow() + timedelta(hours=1)) if x["schedule_id"] == sid]
    back = client.patch(f"/api/schedules/{sid}", json={"enabled": True}).json()
    assert datetime.fromisoformat(back["next_run_at"].rstrip("Z")) > utcnow()


def test_disabled_workflow_is_skipped_and_says_so(client):
    wid = client.post("/api/workflows", json={"name": "Sched skip test", "steps": [
        {"id": "s1", "type": "trigger", "name": "Start", "config": {}}]}).json()["id"]
    sid = make(client, workflow_id=wid, interval_minutes=5).json()["id"]
    client.patch(f"/api/workflows/{wid}", json={"enabled": False})
    with SessionLocal() as db:
        ran = [x for x in schedules.run_due(db, utcnow() + timedelta(minutes=6)) if x["schedule_id"] == sid]
    assert ran[0]["status"].startswith("Skipped") and ran[0]["execution_id"] is None


def test_failed_scheduled_run_is_reported(client):
    steps = [{"id": "s1", "type": "trigger", "name": "Start", "config": {}},
             {"id": "s2", "type": "load_csv", "name": "Load", "config": {"file": "invoices.csv"}},
             {"id": "s3", "type": "validate", "name": "Check", "config": {"fail_on_errors": True}}]
    wid = client.post("/api/workflows", json={"name": "Sched fail test", "steps": steps}).json()["id"]
    sid = make(client, workflow_id=wid, interval_minutes=5).json()["id"]
    with SessionLocal() as db:
        ran = [x for x in schedules.run_due(db, utcnow() + timedelta(minutes=6)) if x["schedule_id"] == sid]
    assert ran[0]["status"].startswith("Failed")


def test_run_due_endpoint_and_status(client):
    assert client.post("/api/schedules/run-due").status_code == 200
    st = client.get("/api/schedules/status").json()
    assert st["running"] is False and "backend is running" in st["note"]  # the test app runs without the thread
    assert st["active"] >= 1


def test_deleting_a_schedule_and_a_workflow_with_schedules(client):
    wid = client.post("/api/workflows", json={"name": "Sched delete test", "steps": [
        {"id": "s1", "type": "trigger", "name": "Start", "config": {}}]}).json()["id"]
    sid = make(client, workflow_id=wid).json()["id"]
    assert client.delete(f"/api/schedules/{sid}").status_code == 200
    assert client.delete(f"/api/schedules/{sid}").status_code == 404
    make(client, workflow_id=wid)
    assert client.delete(f"/api/workflows/{wid}").status_code == 200  # its schedules go with it
    assert all(s["workflow_id"] != wid for s in client.get("/api/schedules").json())


def test_scheduler_thread_starts_and_stops():
    sch = schedules.Scheduler(SessionLocal, 1)
    sch.start()
    assert sch.running
    sch.stop()
    assert not sch.running
