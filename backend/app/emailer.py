"""Real email alerts, sent through the person's own email account (SMTP).

The login details live only in the private .env file or environment variables. They are never stored in the
database, never returned by the API and never written to the log. If email is not set up, alerts are recorded
in the run log only, and the run says so plainly.
"""
import re
import smtplib
import ssl
import time
from email.message import EmailMessage

from .config import settings

EMAIL = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,24}$")
PLACEHOLDER_DOMAINS = {"example.com", "example.org", "example.net"}
MAX_RECIPIENTS = 5


class EmailError(Exception):
    """A problem worth telling the person about, in plain words."""


def configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from and EMAIL.match(settings.smtp_from))


def status() -> dict:
    allowed = [d.strip().lower() for d in settings.alert_allowed_domains.split(",") if d.strip()]
    return {"configured": configured(), "host": settings.smtp_host or None, "port": settings.smtp_port,
            "sender": settings.smtp_from or None, "security": settings.smtp_security,
            "allowed_domains": allowed}


def split_recipients(text: str) -> tuple[list[str], list[str]]:
    """Split what was typed into real-looking addresses and everything else (like the word 'team')."""
    parts = [p.strip() for p in re.split(r"[,;\s]+", text or "") if p.strip()]
    good = [p for p in parts if EMAIL.match(p)]
    return list(dict.fromkeys(good)), [p for p in parts if not EMAIL.match(p)]


def is_placeholder(addr: str) -> bool:
    return addr.rsplit("@", 1)[-1].lower() in PLACEHOLDER_DOMAINS


def check_allowed(addrs: list[str]) -> None:
    allowed = status()["allowed_domains"]
    if allowed:
        bad = [a for a in addrs if a.rsplit("@", 1)[-1].lower() not in allowed]
        if bad:
            raise EmailError(f"Not sent: {', '.join(bad)} is not in the list of allowed domains ({', '.join(allowed)})")


def clean_line(text: str, limit: int = 150) -> str:
    """One safe line for a subject: no line breaks (they could inject extra email headers) and no control characters."""
    return re.sub(r"[\x00-\x1f\x7f]+", " ", text or "").strip()[:limit]


def send(to: list[str], subject: str, body: str) -> None:
    if not configured():
        raise EmailError("Email is not set up yet")
    if not to or len(to) > MAX_RECIPIENTS:
        raise EmailError(f"An alert goes to 1 to {MAX_RECIPIENTS} addresses")
    check_allowed(to)
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, ", ".join(to), clean_line(subject)
    msg.set_content(body[:5000])
    try:
        if settings.smtp_security == "ssl":
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
        with server:
            if settings.smtp_security == "starttls":
                server.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise EmailError("The email server refused the username or password. For Gmail, use an app password, not your normal one") from None
    except smtplib.SMTPRecipientsRefused:
        raise EmailError("The email server refused the recipient address") from None
    except (smtplib.SMTPException, OSError) as e:
        raise EmailError(f"Could not send the email: {type(e).__name__}. Check the host, port and security settings") from None


_recent: list[float] = []


def allow_test() -> bool:
    """At most 5 test emails per minute, so the button cannot be used to flood someone."""
    now = time.time()
    _recent[:] = [t for t in _recent if now - t < 60]
    if len(_recent) >= 5:
        return False
    _recent.append(now)
    return True
