"""Email alerts: real sending when set up, honest log-only when not, and safe either way."""
import itertools
import smtplib

import pytest

from app import emailer
from app.config import settings

COUNTER = itertools.count(1)


class FakeSMTP:
    """Stands in for the mail server. Records what would have been sent."""
    sent: list = []
    calls: list = []
    fail_login = False
    fail_connect = False

    def __init__(self, host, port, timeout=None, **kw):
        if FakeSMTP.fail_connect:
            raise ConnectionRefusedError("nope")
        FakeSMTP.calls.append(("connect", host, port))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        FakeSMTP.calls.append(("starttls",))

    def login(self, user, password):
        FakeSMTP.calls.append(("login", user, password))
        if FakeSMTP.fail_login:
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)


@pytest.fixture()
def mail(monkeypatch):
    FakeSMTP.sent, FakeSMTP.calls, FakeSMTP.fail_login, FakeSMTP.fail_connect = [], [], False, False
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    for k, v in dict(smtp_host="smtp.test.invalid", smtp_port=587, smtp_security="starttls", smtp_username="alerts@mycompany.sa",
                     smtp_password="s3cret-password", smtp_from="alerts@mycompany.sa", alert_allowed_domains="").items():
        monkeypatch.setattr(settings, k, v)
    emailer._recent.clear()
    return FakeSMTP


def not_set_up(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "smtp_from", "")


def alert_run(client, to, message="Collections and deposits do not fully match"):
    steps = [{"id": "s1", "type": "trigger", "name": "Start", "config": {}},
             {"id": "s2", "type": "load_csv", "name": "Courier", "config": {"file": "courier_collections.csv", "table": "courier"}},
             {"id": "s3", "type": "load_csv", "name": "Bank", "config": {"file": "bank_deposits.csv", "table": "bank"}},
             {"id": "s4", "type": "compare", "name": "Match", "config": {"left": "courier", "right": "bank", "left_key": "waybill", "right_key": "reference",
                                                                       "left_amount": "cod_amount", "right_amount": "amount", "tolerance": 0.01}},
             {"id": "s5", "type": "notify", "name": "Alert", "config": {"to": to, "message": message}},
             {"id": "s6", "type": "end", "name": "Done", "config": {}}]
    wf = client.post("/api/workflows", json={"name": f"Alert test {next(COUNTER)}", "steps": steps})
    assert wf.status_code == 201, wf.text
    return client.post(f"/api/workflows/{wf.json()['id']}/run").json()


def alert_message(run):
    return next(s for s in run["steps"] if s["step_id"] == "s5")["message"]


def test_email_status_never_shows_the_password(client, mail):
    s = client.get("/api/email/status").json()
    assert s["configured"] is True and s["sender"] == "alerts@mycompany.sa"
    assert "s3cret" not in str(s) and "password" not in str(s).lower()


def test_without_setup_the_alert_is_logged_and_says_it_was_not_emailed(client, monkeypatch):
    not_set_up(monkeypatch)
    assert client.get("/api/email/status").json()["configured"] is False
    run = alert_run(client, "boss@mycompany.sa")
    assert run["status"] == "success" and "not emailed: email is not set up" in alert_message(run)


def test_a_name_instead_of_an_address_is_only_logged(client, mail):
    run = alert_run(client, "finance team")
    assert run["status"] == "success" and "not emailed" in alert_message(run) and mail.sent == []


def test_placeholder_addresses_are_never_emailed(client, mail):
    run = alert_run(client, "finance@example.com")
    assert "placeholder" in alert_message(run) and mail.sent == []


def test_a_real_alert_is_sent_with_counts_and_a_link_but_no_file_contents(client, mail):
    run = alert_run(client, "boss@mycompany.sa, ops@mycompany.sa")
    assert run["status"] == "success" and alert_message(run).startswith("Email sent to boss@mycompany.sa, ops@mycompany.sa")
    assert len(mail.sent) == 1
    msg = mail.sent[0]
    body = msg.get_content()
    assert msg["Subject"] == "[AutoFlow Studio] " + run["workflow_name"] + ": 7 exceptions to review"
    assert msg["To"] == "boss@mycompany.sa, ops@mycompany.sa" and msg["From"] == "alerts@mycompany.sa"
    assert "Amount at risk: 2,103.41" in body and f"/executions/{run['id']}" in body and "do not fully match" in body
    assert "WB-70013" not in body and "WB-79999" not in body  # no row data leaves the app
    assert ("starttls",) in mail.calls and ("login", "alerts@mycompany.sa", "s3cret-password") in mail.calls


def test_placeholder_and_real_addresses_together_send_only_to_the_real_one(client, mail):
    run = alert_run(client, "boss@mycompany.sa, finance@example.com")
    assert mail.sent[0]["To"] == "boss@mycompany.sa" and "Not sent to placeholder finance@example.com" in alert_message(run)


def test_a_wrong_password_fails_the_run_with_a_clear_message_and_leaks_nothing(client, mail):
    mail.fail_login = True
    run = alert_run(client, "boss@mycompany.sa")
    assert run["status"] == "failed" and "app password" in run["error_message"]
    assert "s3cret" not in str(run) and mail.sent == []


def test_an_unreachable_server_fails_the_run_clearly(client, mail):
    mail.fail_connect = True
    run = alert_run(client, "boss@mycompany.sa")
    assert run["status"] == "failed" and "Could not send the email" in run["error_message"]


def test_the_allowed_domains_list_blocks_other_recipients(client, mail, monkeypatch):
    monkeypatch.setattr(settings, "alert_allowed_domains", "mycompany.sa")
    assert alert_run(client, "boss@mycompany.sa")["status"] == "success"
    run = alert_run(client, "someone@gmail.com")
    assert run["status"] == "failed" and "not in the list of allowed domains" in run["error_message"] and len(mail.sent) == 1


def test_at_most_five_recipients(client, mail):
    run = alert_run(client, ", ".join(f"p{i}@mycompany.sa" for i in range(6)))
    assert run["status"] == "failed" and "at most 5" in run["error_message"] and mail.sent == []


def test_line_breaks_cannot_be_used_to_inject_headers():
    assert emailer.clean_line("Hello\r\nBcc: victim@x.com") == "Hello Bcc: victim@x.com"
    to, _ = emailer.split_recipients("a@mycompany.sa\r\nb@mycompany.sa")
    assert to == ["a@mycompany.sa", "b@mycompany.sa"]  # a line break just separates two addresses; it can never start a new header


def test_the_test_button_needs_setup_and_a_real_address(client, monkeypatch):
    not_set_up(monkeypatch)
    assert client.post("/api/email/test", json={"to": "me@mycompany.sa"}).status_code == 409


def test_the_test_button_sends_one_email(client, mail):
    assert client.post("/api/email/test", json={"to": "me@example.org"}).status_code == 422
    assert client.post("/api/email/test", json={"to": "a@mycompany.sa, b@mycompany.sa"}).status_code == 422
    r = client.post("/api/email/test", json={"to": "me@mycompany.sa"})
    assert r.status_code == 200 and r.json() == {"sent_to": "me@mycompany.sa"}
    assert len(mail.sent) == 1 and mail.sent[0]["Subject"] == "[AutoFlow Studio] Test email"


def test_the_test_button_is_rate_limited(client, mail):
    codes = [client.post("/api/email/test", json={"to": "me@mycompany.sa"}).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429, 429]


def test_test_button_failure_is_reported_not_crashed(client, mail):
    mail.fail_login = True
    r = client.post("/api/email/test", json={"to": "me@mycompany.sa"})
    assert r.status_code == 502 and "app password" in r.json()["error"]["message"] and "s3cret" not in r.text
