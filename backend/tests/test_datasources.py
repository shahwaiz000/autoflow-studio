"""Data Sources: listing, previews, deleting uploads, and path safety."""
import io

import pytest

CSV = b"name,amount\nAnna,10\nBen,20\nCara,30\n"


def upload(client, name="report one.csv", data=CSV):
    r = client.post("/api/uploads", files={"file": (name, io.BytesIO(data), "text/csv")})
    assert r.status_code == 201, r.text
    return r.json()


def stored_name(client, original):
    d = client.get("/api/datasources").json()
    return next(f for f in d["uploads"] if f["original_name"] == original)["name"]


def test_samples_are_listed_with_rows_columns_and_the_workflows_that_use_them(client):
    d = client.get("/api/datasources").json()
    names = {f["name"] for f in d["samples"]}
    assert {"invoices.csv", "employees.csv", "customers.csv", "sales_orders.csv"} <= names
    inv = next(f for f in d["samples"] if f["name"] == "invoices.csv")
    assert inv["rows"] > 0 and "invoice_id" in inv["columns"] and inv["readable"] and inv["size_bytes"] > 0
    assert "Invoice Processing" in inv["used_by"]


def test_an_upload_keeps_its_original_name_and_links_to_its_run(client):
    ex = upload(client, "my sales.csv")
    f = next(x for x in client.get("/api/datasources").json()["uploads"] if x["original_name"] == "my sales.csv")
    assert f["rows"] == 3 and f["columns"] == ["name", "amount"] and f["execution_id"] == ex["id"]
    assert f["name"].endswith(".csv") and "sales" not in f["name"]  # stored under a random name


def test_preview_shows_the_first_rows_as_text(client):
    upload(client, "preview me.csv")
    name = stored_name(client, "preview me.csv")
    p = client.get(f"/api/datasources/uploads/{name}/preview", params={"rows": 2}).json()
    assert p["columns"] == ["name", "amount"] and p["rows"] == [["Anna", "10"], ["Ben", "20"]]


def test_long_cells_are_cut_short_in_previews(client):
    upload(client, "long cell.csv", b"note\n" + b"x" * 500 + b"\n")
    p = client.get(f"/api/datasources/uploads/{stored_name(client, 'long cell.csv')}/preview").json()
    assert len(p["rows"][0][0]) == 80


def test_preview_row_limit_is_validated(client):
    assert client.get("/api/datasources/samples/invoices.csv/preview", params={"rows": 0}).status_code == 422
    assert client.get("/api/datasources/samples/invoices.csv/preview", params={"rows": 500}).status_code == 422


@pytest.mark.parametrize("source,name", [
    ("samples", "nope.csv"), ("secrets", "invoices.csv"), ("samples", "invoices.txt"),
    ("samples", "..%2Fconfig.csv"), ("samples", "a%5Cb.csv"), ("uploads", "..%2Fsamples%2Finvoices.csv")])
def test_bad_names_and_folders_are_refused(client, source, name):
    assert client.get(f"/api/datasources/{source}/{name}/preview").status_code == 404
    assert client.delete(f"/api/datasources/{source}/{name}").status_code in (404, 409)


def test_samples_cannot_be_deleted(client):
    assert client.delete("/api/datasources/samples/invoices.csv").status_code == 409
    assert client.get("/api/datasources/samples/invoices.csv/preview").status_code == 200


def test_deleting_an_upload_removes_the_file_but_keeps_run_history(client):
    ex = upload(client, "delete me.csv")
    name = stored_name(client, "delete me.csv")
    assert client.delete(f"/api/datasources/uploads/{name}").status_code == 200
    assert all(f["name"] != name for f in client.get("/api/datasources").json()["uploads"])
    assert client.get(f"/api/datasources/uploads/{name}/preview").status_code == 404
    assert client.delete(f"/api/datasources/uploads/{name}").status_code == 404
    assert client.get(f"/api/executions/{ex['id']}").json()["status"] == "success"


def test_a_file_that_is_not_a_table_is_reported_not_crashed(client):
    from app.config import settings
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    (settings.uploads_dir / "broken_file.csv").write_bytes(b"\x00\x01\x02")
    f = next(x for x in client.get("/api/datasources").json()["uploads"] if x["name"] == "broken_file.csv")
    assert f["readable"] is False and f["original_name"] is None  # older or unknown files are still shown
    assert client.get("/api/datasources/uploads/broken_file.csv/preview").json()["readable"] is False
    assert client.delete("/api/datasources/uploads/broken_file.csv").status_code == 200
