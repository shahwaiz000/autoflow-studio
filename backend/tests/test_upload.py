import io

import app.main as main

MESSY = (b"id,name,amount\n1, Ann ,10.5\n2,Bob,abc\n2,Bob,abc\n3,,7\n4,Cy,\n")


def _post(client, content, name="data.csv", **form):
    return client.post("/api/uploads", files={"file": (name, io.BytesIO(content), "text/csv")}, data=form)


def test_upload_cleans_and_reports(client):
    r = _post(client, MESSY, required_columns="id,name,amount", numeric_columns="amount")
    assert r.status_code == 201
    body = r.json()
    m = body["metrics"]
    assert body["status"] == "success" and body["trigger_type"] == "upload"
    assert m["rows_loaded"] == 5 and m["duplicate_rows"] == 1
    assert m["invalid_rows"] == 2 and m["invalid_values"] == 2  # missing name/amount; 'abc' twice
    assert m["rows_after_cleaning"] == 2  # duplicates and rows with gaps removed
    assert m["missing_by_column"] == {"name": 1, "amount": 1}
    out = client.get(f"/api/executions/{body['id']}/download/processed")
    assert out.status_code == 200 and "Ann" in out.text and " Ann " not in out.text


def test_keep_missing_option_keeps_incomplete_rows(client):
    m = _post(client, MESSY, missing_values="keep").json()["metrics"]
    assert m["rows_after_cleaning"] == 4


def test_missing_required_column_fails_clearly(client):
    body = _post(client, MESSY, required_columns="invoice_id").json()
    assert body["status"] == "failed" and "invoice_id" in body["error_message"]


def test_rejects_wrong_type_empty_and_garbage(client):
    assert _post(client, b"x", name="notes.txt").status_code == 400
    assert _post(client, b"   \n").status_code == 400
    assert _post(client, b"a,b\n").json()["status"] == "failed"  # header only
    assert _post(client, b"\x00\x01\x02\xff\xfe").json()["status"] == "failed"


def test_rejects_oversized_file(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 10)
    assert _post(client, MESSY).status_code == 413


def test_path_in_filename_is_not_used(client):
    body = _post(client, MESSY, name="../../evil.csv").json()
    assert "evil.csv" in body["steps"][0]["name"] and "/" not in body["steps"][0]["name"]


def test_download_unknown_file_is_404(client):
    assert client.get("/api/executions/1/download/processed").status_code == 404
    assert client.get("/api/executions/1/download/passwd").status_code == 404


def test_remove_non_numbers_option(client):
    m = _post(client, MESSY, numeric_columns="amount", invalid_numbers="remove", missing_values="keep").json()["metrics"]
    assert m["rows_after_cleaning"] == 3  # the two 'abc' rows are gone; empty cells are kept
    m = _post(client, MESSY, numeric_columns="amount", invalid_numbers="remove").json()["metrics"]
    assert m["rows_after_cleaning"] == 1
    assert _post(client, MESSY, invalid_numbers="maybe").status_code == 400
