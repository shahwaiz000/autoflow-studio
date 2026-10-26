import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["DATA_DIR"] = _tmp
os.environ["AUTH_ENABLED"] = "false"  # test_auth.py switches it on for its own tests
os.environ["REMOVE_LEGACY_DEMO"] = "false"  # the tests keep their own generic fixture files and workflows
os.environ["SCHEDULER_ENABLED"] = "false"  # tests call run_due() themselves

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.config import settings  # noqa: E402
from tests.fixture_files import add_test_workflows, make_test_files  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from app.database import SessionLocal
    with TestClient(app) as c:
        make_test_files(settings.samples_dir)  # generic files for the validate/clean/report tests; startup removes the old ones
        with SessionLocal() as db:
            add_test_workflows(db)
        yield c
