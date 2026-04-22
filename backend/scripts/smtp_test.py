import json
import os
import smtplib
import sqlite3
import ssl
from email.message import EmailMessage


def _unquote(v):
    if isinstance(v, str) and v.startswith('"'):
        try:
            return json.loads(v)
        except Exception:
            return v.strip('"')
    return v


def main():
    db = "backend/copedu.db" if os.path.exists("backend/copedu.db") else "copedu.db"
    conn = sqlite3.connect(db)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT key, value FROM settings
        WHERE key IN ('smtp_host','smtp_port','smtp_user','smtp_password','smtp_from','smtp_use_tls','leave_email_enabled')
        """
    )
    kv = {k: v for k, v in cur.fetchall()}
    conn.close()

    host = str(_unquote(kv.get("smtp_host", "")) or "").strip()
    port = int(str(_unquote(kv.get("smtp_port", "587")) or "587"))
    user = str(_unquote(kv.get("smtp_user", "")) or "").strip()
    password = str(_unquote(kv.get("smtp_password", "")) or "")
    from_addr = str(_unquote(kv.get("smtp_from", "")) or "").strip()
    use_tls = str(kv.get("smtp_use_tls", "true")).strip().lower().strip('"') in ("1", "true", "yes", "on")
    enabled = str(kv.get("leave_email_enabled", "false")).strip().lower().strip('"') in ("1", "true", "yes", "on")
    recipient = from_addr or user

    print(f"using_db={db}")
    print(f"leave_email_enabled={enabled}")
    print(f"smtp_host={host} smtp_port={port} smtp_user={user} smtp_from={from_addr} smtp_use_tls={use_tls}")
    print(f"test_recipient={recipient}")

    if not host or not from_addr or not recipient:
        raise RuntimeError("Missing smtp_host/smtp_from/recipient in settings")

    msg = EmailMessage()
    msg["Subject"] = "HR Suite SMTP Test"
    msg["From"] = from_addr
    msg["To"] = recipient
    msg.set_content("This is a live SMTP test email from HR Suite.")

    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=45)
    else:
        smtp = smtplib.SMTP(host, port, timeout=45)
        if use_tls:
            smtp.starttls(context=ssl.create_default_context())
    if user and password:
        smtp.login(user, password)
    smtp.send_message(msg)
    smtp.quit()
    print("SMTP test sent successfully")


if __name__ == "__main__":
    main()
