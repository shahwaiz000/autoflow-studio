"""Phase 3: approving and rejecting exceptions, with an audit trail nobody can edit."""
import pytest

from app.database import SessionLocal
from app.models import AuditEvent


@pytest.fixture()
def run(client):
    wf = next(w for w in client.get("/api/workflows").json() if w["name"] == "COD Reconciliation")
    body = {"inputs": {"courier": {"source": "samples", "file": "courier_collections.csv"},
                       "bank": {"source": "samples", "file": "bank_deposits.csv"}}}
    return client.post(f"/api/workflows/{wf['id']}/run", json=body).json()


def exceptions(client, eid, **params):
    return client.get(f"/api/executions/{eid}/exceptions", params={"limit": 500, **params}).json()


def decide(client, eid, ids, decision, note=""):
    return client.post(f"/api/executions/{eid}/exceptions/decide", json={"ids": ids, "decision": decision, "note": note})


def test_everything_starts_pending(client, run):
    d = exceptions(client, run["id"])
    assert d["by_decision"] == {"pending": 7, "approved": 0, "rejected": 0}
    assert all(i["decision"] is None for i in d["items"])


def test_approving_records_who_when_and_the_note(client, run):
    first = exceptions(client, run["id"])["items"][0]
    r = decide(client, run["id"], [first["id"]], "approved", "  Known bank   fee  ")
    assert r.status_code == 200 and r.json()["changed"] == 1 and r.json()["by_decision"]["approved"] == 1
    item = next(i for i in exceptions(client, run["id"])["items"] if i["id"] == first["id"])
    assert item["decision"] == "approved" and item["decided_by"] == "local user" and item["decided_at"]
    assert item["note"] == "Known bank fee"  # extra spaces tidied
    assert [i["id"] for i in exceptions(client, run["id"], decision="approved")["items"]] == [first["id"]]
    assert len(exceptions(client, run["id"], decision="pending")["items"]) == 6


def test_rejecting_needs_a_note(client, run):
    ids = [i["id"] for i in exceptions(client, run["id"])["items"][:2]]
    r = decide(client, run["id"], ids, "rejected", "   ")
    assert r.status_code == 422 and "note" in r.json()["error"]["message"]
    assert exceptions(client, run["id"])["by_decision"]["rejected"] == 0  # nothing half-applied
    assert decide(client, run["id"], ids, "rejected", "Courier must resend the cash").json()["changed"] == 2


def test_several_can_be_decided_at_once_and_reopened(client, run):
    ids = [i["id"] for i in exceptions(client, run["id"])["items"]]
    assert decide(client, run["id"], ids, "approved").json()["by_decision"]["approved"] == 7
    assert decide(client, run["id"], ids[:3], "pending").json()["changed"] == 3
    d = exceptions(client, run["id"])
    assert d["by_decision"] == {"pending": 3, "approved": 4, "rejected": 0}
    reopened = next(i for i in d["items"] if i["id"] == ids[0])
    assert reopened["decision"] is None and reopened["decided_by"] is None and reopened["note"] is None


def test_deciding_the_same_thing_twice_changes_nothing_and_adds_no_audit_row(client, run):
    ids = [exceptions(client, run["id"])["items"][0]["id"]]
    decide(client, run["id"], ids, "approved", "ok")
    before = client.get("/api/audit", params={"execution_id": run["id"]}).json()["total"]
    assert decide(client, run["id"], ids, "approved", "ok").json()["changed"] == 0
    assert client.get("/api/audit", params={"execution_id": run["id"]}).json()["total"] == before


def test_every_decision_is_in_the_audit_trail_newest_first(client, run):
    ids = [i["id"] for i in exceptions(client, run["id"])["items"][:2]]
    decide(client, run["id"], ids[:1], "approved", "Explained")
    decide(client, run["id"], ids[1:], "rejected", "Needs follow-up")
    decide(client, run["id"], ids[:1], "pending")
    a = client.get("/api/audit", params={"execution_id": run["id"]}).json()
    assert a["total"] == 3
    assert [e["action"] for e in a["items"]] == ["reopened", "rejected", "approved"]
    top = a["items"][1]
    assert top["actor"] == "local user" and top["key"] and "Needs follow-up" in top["detail"] and "pending -> rejected" in top["detail"]


def test_exceptions_from_another_run_cannot_be_decided_here(client, run):
    other = next(w for w in client.get("/api/workflows").json() if w["name"] == "Sales Report Generation")
    ex = client.post(f"/api/workflows/{other['id']}/run").json()
    mine = exceptions(client, run["id"])["items"][0]["id"]
    assert decide(client, ex["id"], [mine], "approved").status_code == 404
    assert decide(client, 99999, [mine], "approved").status_code == 404


def test_bad_requests_are_refused(client, run):
    assert decide(client, run["id"], [], "approved").status_code == 422
    assert decide(client, run["id"], [1], "maybe").status_code == 422
    assert decide(client, run["id"], [1], "approved", "x" * 301).status_code == 422
    assert client.get(f"/api/executions/{run['id']}/exceptions", params={"decision": "later"}).status_code == 422


def test_the_audit_trail_cannot_be_edited_or_deleted(client, run):
    ids = [exceptions(client, run["id"])["items"][0]["id"]]
    decide(client, run["id"], ids, "approved", "ok")
    assert client.delete("/api/audit").status_code in (404, 405)
    assert client.put("/api/audit", json={}).status_code in (404, 405)
    with SessionLocal() as db:
        row = db.query(AuditEvent).first()
        row.detail = "tampered"
        with pytest.raises(ValueError):
            db.commit()
        db.rollback()
        db.delete(db.query(AuditEvent).first())
        with pytest.raises(ValueError):
            db.commit()
        db.rollback()


def test_the_csv_download_carries_the_decisions(client, run):
    first = exceptions(client, run["id"])["items"][0]
    decide(client, run["id"], [first["id"]], "rejected", "=HYPERLINK(\"x\")")
    text = client.get(f"/api/executions/{run['id']}/download/exceptions").text
    assert "rejected" in text and "'=HYPERLINK" in text  # a note that looks like a formula is neutralised


def test_the_overview_counts_what_is_still_to_review(client, run):
    d = client.get("/api/dashboard").json()["latest"]
    assert d["execution_id"] == run["id"] and d["review"] == {"pending": 7, "approved": 0, "rejected": 0}
    ids = [i["id"] for i in exceptions(client, run["id"])["items"][:3]]
    decide(client, run["id"], ids, "approved")
    assert client.get("/api/dashboard").json()["latest"]["review"]["pending"] == 4
