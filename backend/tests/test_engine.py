from app.database import SessionLocal
from app.engine import run_workflow, validate_definition
from app.models import Workflow
from app.seed import seed


def _wf(db, name):
    return db.query(Workflow).filter_by(name=name).one()


def test_branching_workflow_succeeds_and_takes_notify_branch(client):
    with SessionLocal() as db:
        ex = run_workflow(db, _wf(db, "Invoice Processing"))
        ids = [s.step_id for s in ex.steps]
        assert ex.status == "success"
        assert "notify" in ids and ids[-1] == "end"


def test_strict_validation_fails_with_clear_error_and_retry(client):
    with SessionLocal() as db:
        ex = run_workflow(db, _wf(db, "Strict Invoice Audit"))
        assert ex.status == "failed"
        assert "missing values" in ex.error_message
        failed = [s for s in ex.steps if s.status == "failed"][0]
        assert failed.attempts == 2  # 1 try + 1 retry


def test_transform_cleans_data(client):
    with SessionLocal() as db:
        ex = run_workflow(db, _wf(db, "Customer Data Cleanup"))
        assert ex.status == "success"
        assert "43 -> 37" in [s for s in ex.steps if s.step_type == "transform"][0].message


def test_path_traversal_is_blocked(client):
    with SessionLocal() as db:
        wf = _wf(db, "Legacy Vendor Sync")
        trick = {"steps": [{"id": "l", "type": "load_csv", "name": "x", "config": {"file": "../../etc/passwd"}}]}
        ex = run_workflow(db, wf, definition=trick)  # override: the saved workflow is left unchanged
        assert ex.status == "failed" and "not found" in ex.error_message


def test_unsupported_step_type_rejected():
    errs = validate_definition({"steps": [{"id": "a", "type": "python_exec", "config": {}}]})
    assert any("unsupported type" in e for e in errs)


def test_seed_is_idempotent(client):
    with SessionLocal() as db:
        before = db.query(Workflow).count()
        seed(db)
        seed(db)
        assert db.query(Workflow).count() == before
