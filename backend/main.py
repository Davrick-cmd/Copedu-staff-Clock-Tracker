"""
CopeDu Staff Clock Tracker - Local API (SQLite).
Auth: JWT. All data in SQLite.
"""
import csv
import html
import io
import ipaddress
import json
import logging
import os
import re
import smtplib
import sqlite3
import ssl
import threading
import time as _time
from datetime import date, datetime, timedelta, time, timezone
from email.message import EmailMessage

logger = logging.getLogger(__name__)

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None
from fastapi import FastAPI, HTTPException, Depends, Header, Query, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from database import cursor, init_db, row_to_dict, get_conn, DB_PATH
from auth_jwt import (
    hash_password,
    verify_password,
    create_access_token,
    decode_token,
    new_id,
)

# LDAP (optional): bind DN + search by sAMAccountName, then verify user password
def _get_ldap_config():
    out = {}
    with cursor() as c:
        c.execute("""
            SELECT key, value FROM settings WHERE key IN (
                'ldap_enabled', 'ldap_url', 'ldap_bind_dn', 'ldap_bind_password',
                'ldap_search_base', 'ldap_username_attribute', 'ldap_email_attribute', 'ldap_name_attribute'
            )
        """)
        for row in c.fetchall() or []:
            k, v = row[0], row[1]
            if isinstance(v, str) and v and v[0] == '"':
                try:
                    v = json.loads(v)
                except Exception:
                    pass
            out[k] = v
    out.setdefault("ldap_url", os.getenv("LDAP_URL", "") or os.getenv("LDAP_URI", ""))
    out.setdefault("ldap_bind_dn", os.getenv("LDAP_BIND_DN", ""))
    out.setdefault("ldap_bind_password", os.getenv("LDAP_BIND_PASSWORD", ""))
    out.setdefault("ldap_search_base", os.getenv("LDAP_SEARCH_BASE", ""))
    # Enable LDAP if explicitly set, or when URL + bind credentials are present
    explicit = os.getenv("LDAP_ENABLED", "").lower() in ("1", "true", "yes")
    has_config = bool((out.get("ldap_url") or "").strip() and (out.get("ldap_bind_dn") or "").strip() and (out.get("ldap_bind_password") or "").strip() and (out.get("ldap_search_base") or "").strip())
    out.setdefault("ldap_enabled", explicit or has_config)
    out.setdefault("ldap_username_attribute", os.getenv("LDAP_USERNAME_ATTRIBUTE", "sAMAccountName"))
    out.setdefault("ldap_email_attribute", os.getenv("LDAP_EMAIL_ATTRIBUTE", "mail"))
    out.setdefault("ldap_name_attribute", os.getenv("LDAP_NAME_ATTRIBUTE", "displayName"))
    out.setdefault("ldap_email_domain", os.getenv("LDAP_EMAIL_DOMAIN", "copeduplc.rw").strip() or "copeduplc.rw")
    return out


def _escape_ldap_filter(value: str) -> str:
    return (value or "").replace("\\", "\\5c").replace("*", "\\2a").replace("(", "\\28").replace(")", "\\29").replace("\x00", "\\00")


def _ldap_search_and_user_bind(search_filter: str, password: str) -> tuple:
    """
    Service-account search (exactly one entry), then verify password by binding as that user.
    Returns (True, None) on success; (False, None) on wrong password / not found; (False, error_msg) on config/connection error.
    """
    if not search_filter or not password:
        return False, None
    cfg = _get_ldap_config()
    if not cfg.get("ldap_enabled"):
        return False, None
    url = (cfg.get("ldap_url") or "").strip()
    bind_dn = (cfg.get("ldap_bind_dn") or "").strip()
    bind_password = (cfg.get("ldap_bind_password") or "").strip()
    search_base = (cfg.get("ldap_search_base") or "").strip()
    username_attr = (cfg.get("ldap_username_attribute") or "sAMAccountName").strip()
    if not url or not bind_dn or not bind_password or not search_base:
        return False, "LDAP not configured (LDAP_URL, LDAP_BIND_DN, LDAP_BIND_PASSWORD, LDAP_SEARCH_BASE required)"
    try:
        from ldap3 import Server, Connection, ALL, SUBTREE
    except ImportError:
        return False, "LDAP support not installed"
    bases_to_try = [search_base]
    if "dc=" in search_base.lower():
        parts = [p for p in search_base.split(",") if p.strip().lower().startswith("dc=")]
        if parts:
            domain_root = ",".join(parts)
            if domain_root != search_base and domain_root not in bases_to_try:
                bases_to_try.append(domain_root)
    try:
        server = Server(url, get_info=ALL, connect_timeout=15)
        for base in bases_to_try:
            try:
                conn = Connection(server, user=bind_dn, password=bind_password, auto_bind=True, receive_timeout=15)
                conn.search(base, search_filter, search_scope=SUBTREE, attributes=[username_attr])
                if conn.entries and len(conn.entries) == 1:
                    user_dn = str(conn.entries[0].entry_dn)
                    conn.unbind()
                    user_conn = Connection(server, user=user_dn, password=password, auto_bind=True, receive_timeout=15)
                    user_conn.unbind()
                    return True, None
                if conn.entries and len(conn.entries) > 1:
                    conn.unbind()
                    logger.warning("LDAP auth: multiple entries for filter=%s", search_filter)
                    break
                conn.unbind()
            except Exception as e:
                logger.warning("LDAP auth base=%r: %s", base, e)
        return False, None
    except Exception as e:
        err_msg = str(e)
        if "timeout" in err_msg.lower() or "timed out" in err_msg.lower():
            return False, "Connection to AD timed out. Check that the AD server is reachable from this machine."
        if "config" in err_msg.lower() or "bind" in err_msg.lower() or "connect" in err_msg.lower():
            return False, err_msg
        return False, None


def _ldap_authenticate(username: str, password: str):
    """
    Bind with service account, search for user by sAMAccountName, verify by binding with user DN + password.
    Returns (True, None) on success; (False, None) on auth failure; (False, error_msg) on config/connection error.
    """
    if not username or not password:
        return False, None
    cfg = _get_ldap_config()
    if not cfg.get("ldap_enabled"):
        return False, None
    username_attr = (cfg.get("ldap_username_attribute") or "sAMAccountName").strip()
    safe = _escape_ldap_filter(username)
    search_filter = f"({username_attr}={safe})"
    return _ldap_search_and_user_bind(search_filter, password)


def _ldap_authenticate_by_mail_or_upn(mail_or_upn: str, password: str):
    """Verify AD password when the user signs in with their work email or UPN (matches mail / userPrincipalName)."""
    if not mail_or_upn or not password:
        return False, None
    if not _get_ldap_config().get("ldap_enabled"):
        return False, None
    safe = _escape_ldap_filter(mail_or_upn.strip())
    search_filter = f"(|(mail={safe})(userPrincipalName={safe}))"
    return _ldap_search_and_user_bind(search_filter, password)


def _ldap_lookup_user(username: str):
    """
    Look up a user in AD by sAMAccountName (no password).
    Returns (dict with full_name, email, None) on success, (None, None) if not found, (None, error_msg) on config/connection error.
    """
    if not (username or "").strip():
        return None, None
    cfg = _get_ldap_config()
    if not cfg.get("ldap_enabled"):
        return None, "LDAP is not enabled"
    url = (cfg.get("ldap_url") or "").strip()
    bind_dn = (cfg.get("ldap_bind_dn") or "").strip()
    bind_password = (cfg.get("ldap_bind_password") or "").strip()
    search_base = (cfg.get("ldap_search_base") or "").strip()
    username_attr = (cfg.get("ldap_username_attribute") or "sAMAccountName").strip()
    name_attr = (cfg.get("ldap_name_attribute") or "displayName").strip()
    email_attr = (cfg.get("ldap_email_attribute") or "mail").strip()
    if not url or not bind_dn or not bind_password or not search_base:
        return None, "LDAP not configured (URL, BIND_DN, BIND_PASSWORD, SEARCH_BASE required)"
    try:
        from ldap3 import Server, Connection, ALL, SUBTREE
    except ImportError:
        return None, "LDAP support not installed (ldap3)"
    safe = _escape_ldap_filter(username)
    search_filter = f"({username_attr}={safe})"
    attrs = [username_attr, name_attr, email_attr]

    def _search(base):
        server = Server(url, get_info=ALL, connect_timeout=15)
        conn = Connection(server, user=bind_dn, password=bind_password, auto_bind=True, receive_timeout=15)
        conn.search(base, search_filter, search_scope=SUBTREE, attributes=attrs)
        return conn

    def _entry_attr(entry, attr_name):
        # AD/ldap3 may return attributes with different casing; match case-insensitively
        for candidate in [attr_name, attr_name.lower(), attr_name.upper()]:
            try:
                v = getattr(entry, candidate, None)
                if v is not None:
                    if isinstance(v, list) and v:
                        v = v[0]
                    return (str(v) or "").strip() or None
            except (AttributeError, TypeError):
                pass
        d = getattr(entry, "entry_attributes_as_dict", None) or {}
        for k, v in d.items():
            if k.lower() == attr_name.lower():
                if isinstance(v, list) and v:
                    return (str(v[0]) or "").strip() or None
                return (str(v) or "").strip() or None
        return None

    bases_to_try = [search_base]
    # If base is an OU, also try domain root (users are often in CN=Users or nested OUs)
    if "dc=" in search_base.lower():
        parts = [p for p in search_base.split(",") if p.strip().lower().startswith("dc=")]
        if parts:
            domain_root = ",".join(parts)
            if domain_root != search_base and domain_root not in bases_to_try:
                bases_to_try.append(domain_root)
    try:
        logger.info("LDAP lookup username=%r base=%r filter=%s", username, search_base, search_filter)
        last_error = None
        for base in bases_to_try:
            try:
                conn = _search(base)
                n = len(conn.entries) if conn.entries else 0
                logger.info("LDAP lookup base=%r returned %s entries", base, n)
                if n == 1:
                    entry = conn.entries[0]
                    full_name = _entry_attr(entry, name_attr)
                    email = _entry_attr(entry, email_attr)
                    conn.unbind()
                    return {"full_name": full_name, "email": email}, None
                if n > 1:
                    conn.unbind()
                    logger.warning("LDAP lookup: multiple entries for username=%r", username)
                    return None, None
                conn.unbind()
            except Exception as e:
                last_error = str(e)
                logger.warning("LDAP lookup base=%r error: %s", base, last_error)
        if last_error:
            return None, last_error
        return None, None
    except Exception as e:
        err = str(e)
        logger.exception("LDAP lookup failed for username=%r: %s", username, err)
        return None, err


# Load .env from backend folder first, then from current working directory
_backend_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_backend_dir, ".env"))
load_dotenv()
# Local storage for HR document uploads (relative to backend folder)
UPLOAD_DIR = os.path.join(_backend_dir, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
# Ensure login/LDAP logs show in uvicorn output
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
app = FastAPI(title="CopeDu Staff Clock Tracker API")
APP_STARTED_AT = datetime.utcnow()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Pydantic models ----------
class LoginRequest(BaseModel):
    """Single login: identifier = email OR AD username (app figures it out)."""
    identifier: str = ""
    password: str = ""


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    role: str = "employee"


class ClockInRequest(BaseModel):
    branch_id: str | None = None


class ClockOutRequest(BaseModel):
    log_id: str


# ---------- Auth dependency ----------
def get_current_user_id(authorization: str | None = Header(default=None, alias="Authorization")):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload["sub"]


def _auto_clock_out_loop():
    """Background loop: run auto clock-out every 10 minutes."""
    _time.sleep(60)  # wait 1 min after startup before first run
    while True:
        try:
            _run_auto_clock_out_over_max_hours()
        except Exception as e:
            logger.warning("Auto clock-out loop error: %s", e)
        _time.sleep(600)  # 10 minutes


def _apply_annual_leave_days_from_env():
    """If HR_SUITE_ANNUAL_LEAVE_DAYS is set (e.g. 28.5), set annual policy and current-year balances (overrides DB defaults)."""
    raw = (os.getenv("HR_SUITE_ANNUAL_LEAVE_DAYS") or "").strip()
    if not raw:
        return
    try:
        d = float(raw)
    except ValueError:
        logger.warning("HR_SUITE_ANNUAL_LEAVE_DAYS is not a valid number: %r", raw)
        return
    y = datetime.utcnow().year
    now = datetime.utcnow().isoformat()
    try:
        with cursor() as c:
            c.execute("SELECT id FROM leave_types WHERE UPPER(code) = 'ANNUAL' LIMIT 1")
            r = c.fetchone()
            if not r:
                return
            lt_id = r[0]
            c.execute(
                "UPDATE leave_types SET default_days = ?, updated_at = ? WHERE id = ?",
                (d, now, lt_id),
            )
            c.execute(
                """
                UPDATE leave_balances
                SET allocated_days = ?,
                    remaining_days = MAX(0, ? - COALESCE(used_days, 0)),
                    updated_at = ?
                WHERE leave_type_id = ? AND year = ?
                """,
                (d, d, now, lt_id, y),
            )
        logger.info("Applied HR_SUITE_ANNUAL_LEAVE_DAYS=%s for annual leave (year %s)", d, y)
    except Exception as e:
        logger.warning("HR_SUITE_ANNUAL_LEAVE_DAYS apply failed: %s", e)


# ---------- Startup ----------
@app.on_event("startup")
def startup():
    init_db()
    _apply_annual_leave_days_from_env()
    from auth_jwt import SECRET_KEY
    if SECRET_KEY == "change-me-in-production-use-env":
        logger.warning("SECRET_KEY is still the default. Set SECRET_KEY in environment for production.")
    # Auto clock-out sessions that already exceed max work hours, then run periodically
    try:
        _run_auto_clock_out_over_max_hours()
    except Exception as e:
        logger.warning("Startup auto clock-out check failed: %s", e)
    t = threading.Thread(target=_auto_clock_out_loop, daemon=True)
    t.start()
    # Materialize per-user leave_balances for current year so staff are not all showing the same policy fallback.
    try:
        y = datetime.utcnow().year
        with cursor() as c:
            c.execute(
                """
                SELECT u.id FROM users u
                WHERE u.is_active = 1
                  AND u.id NOT IN (SELECT DISTINCT user_id FROM leave_balances WHERE year = ?)
                """,
                (y,),
            )
            uids = [r[0] for r in c.fetchall()]
        for uid in uids:
            _ensure_leave_balance_rows_for_user(uid, y)
        if uids:
            logger.info("Leave: backfilled balance rows for %s users (year %s)", len(uids), y)
    except Exception as e:
        logger.warning("Leave balance startup backfill failed: %s", e)
    try:
        n = _purge_expired_recognitions()
        if n:
            logger.info("Recognitions: purged %s expired post(s) (5 working-day retention)", n)
    except Exception as e:
        logger.warning("Recognition retention purge on startup failed: %s", e)


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- Auth routes ----------
# Placeholder hash for LDAP-only users (they never log in with password locally)
LDAP_ONLY_PASSWORD_PLACEHOLDER = hash_password("LDAP_ONLY_NO_PASSWORD")


SENSITIVE_EMPLOYEE_FIELDS = ("net_salary", "is_married")


def _strip_sensitive_employee_fields(d: dict) -> None:
    """Net salary and marital status are visible to HR and Admin only (not on self-service profile for other roles)."""
    role = (d.get("role") or "").strip().lower()
    if role in ("admin", "hr"):
        return
    for k in SENSITIVE_EMPLOYEE_FIELDS:
        d.pop(k, None)


def _session_profile_for_user_id(user_id: str) -> dict | None:
    """Session profile: user row plus branch names and supervisor (manager) display name."""
    with cursor() as c:
        c.execute(
            """
            SELECT u.*, b.name AS branch_name, b.code AS branch_code, m.full_name AS supervisor_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN users m ON u.manager_id = m.id
            WHERE u.id = ?
            """,
            (user_id,),
        )
        row = c.fetchone()
    if not row:
        return None
    user = row_to_dict(row)
    profile = {k: v for k, v in user.items() if k != "password_hash"}
    if "branch_name" in profile:
        profile["branches"] = {"name": profile.pop("branch_name", None), "code": profile.pop("branch_code", None)}
    _strip_sensitive_employee_fields(profile)
    return profile


def _normalize_ad_username(value: str) -> str:
    """Accept sAMAccountName (dmuganga) or UPN (dmuganga@copeduplc.rw); return part used for LDAP/DB."""
    s = (value or "").strip()
    if "@" in s:
        s = s.split("@")[0].strip()
    return s


@app.post("/auth/login")
def login(req: LoginRequest):
    """Single login: identifier can be email (app user) or AD username / UPN (domain user)."""
    identifier = (req.identifier or "").strip()
    password = (req.password or "").strip()
    if not identifier or not password:
        raise HTTPException(status_code=400, detail="Email/username and password are required")
    normalized_ad = _normalize_ad_username(identifier)
    looks_like_email = bool(re.match(r"[^@]+@[^@]+\.[^@]+", identifier))
    email_lower = identifier.lower() if looks_like_email else ""
    logger.info("Login: identifier=%r normalized_ad=%r looks_like_email=%s", identifier, normalized_ad, looks_like_email)
    user = None
    login_method = "unknown"
    # Path 1: Looks like email -> find app user, then AD password (if enabled) and/or local hash
    if looks_like_email:
        with cursor() as c:
            c.execute("SELECT * FROM users WHERE LOWER(email) = ? AND is_active = 1", (email_lower,))
            row = c.fetchone()
        if row:
            user = row_to_dict(row)
            cfg = _get_ldap_config()
            ldap_enabled = bool(cfg.get("ldap_enabled"))
            ldap_ok = False
            last_ldap_err = None

            def _record_ldap(ok: bool, err):
                nonlocal last_ldap_err
                if err:
                    last_ldap_err = err
                return ok

            if ldap_enabled:
                ad_u = (user.get("ad_username") or "").strip()
                if ad_u:
                    ok, err = _ldap_authenticate(ad_u, password)
                    if _record_ldap(ok, err):
                        ldap_ok = True
                if not ldap_ok:
                    ok, err = _ldap_authenticate_by_mail_or_upn(email_lower, password)
                    if _record_ldap(ok, err):
                        ldap_ok = True
                if not ldap_ok and normalized_ad:
                    if not ad_u or normalized_ad.lower() != ad_u.lower():
                        ok, err = _ldap_authenticate(normalized_ad, password)
                        if _record_ldap(ok, err):
                            ldap_ok = True

            local_ok = verify_password(password, user["password_hash"])
            if ldap_ok:
                logger.info("Login: email identifier -> AD success")
                login_method = "ad_email_or_upn"
            elif local_ok:
                logger.info("Login: email identifier -> local password success")
                login_method = "local_email"
            else:
                if last_ldap_err:
                    raise HTTPException(status_code=503, detail=last_ldap_err)
                raise HTTPException(status_code=401, detail="Invalid username or password")
    # Path 2a: Local auth only — email not found in Path 1, or identifier is not an email (e.g. AD username / login name)
    if user is None:
        cfg = _get_ldap_config()
        if not cfg.get("ldap_enabled"):
            ident_lower = (identifier or "").strip().lower()
            with cursor() as c:
                c.execute(
                    "SELECT * FROM users WHERE is_active = 1 AND ("
                    "LOWER(COALESCE(ad_username,'')) = LOWER(?) OR LOWER(email) = ?"
                    ")",
                    (normalized_ad, ident_lower),
                )
                row = c.fetchone()
            if not row:
                if looks_like_email:
                    raise HTTPException(
                        status_code=401,
                        detail="No account for this email. Create the first user with POST /auth/register (see README), or ask HR/Admin to add you.",
                    )
                raise HTTPException(
                    status_code=401,
                    detail="Unknown login. Use your full work email, or ask HR to set your profile login name (AD username). First admin: register with your email and role admin.",
                )
            loc = row_to_dict(row)
            if not verify_password(password, loc.get("password_hash") or ""):
                raise HTTPException(status_code=401, detail="Invalid username or password")
            user = loc
            logger.info("Login: local DB match (email or ad_username) -> success")
            login_method = "local_identifier"
        else:
            # Path 2b: LDAP — username / UPN / unknown email in DB - try AD, then match linked account
            last_err = None
            ok = False
            if looks_like_email:
                ok, err = _ldap_authenticate_by_mail_or_upn(email_lower, password)
                if err:
                    last_err = err
            if not ok:
                ok, err = _ldap_authenticate(normalized_ad, password)
                if err:
                    last_err = err
            if not ok:
                if last_err:
                    raise HTTPException(status_code=503, detail=last_err)
                raise HTTPException(status_code=401, detail="Invalid username or password")
            with cursor() as c:
                c.execute("SELECT * FROM users WHERE LOWER(ad_username) = LOWER(?) AND is_active = 1", (normalized_ad,))
                row = c.fetchone()
            if not row and looks_like_email:
                with cursor() as c:
                    c.execute("SELECT * FROM users WHERE LOWER(email) = ? AND is_active = 1", (email_lower,))
                    row = c.fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="No account linked to this username. Ask an admin to add you.")
            user = row_to_dict(row)
            logger.info("Login: AD user by username / mail lookup -> success")
            login_method = "ad_username_or_mail"
    token = create_access_token({"sub": user["id"]})
    profile = _session_profile_for_user_id(user["id"])
    if not profile:
        raise HTTPException(status_code=401, detail="User not found")
    _audit_log(
        "auth_login_success",
        "auth",
        user.get("id"),
        user.get("id"),
        {
            "identifier": identifier,
            "login_method": login_method,
        },
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "session": {"user": {"id": user["id"], "email": user.get("email") or user.get("ad_username") or ""}},
        "profile": profile,
    }


@app.get("/auth/me")
def auth_me(user_id: str = Depends(get_current_user_id)):
    profile = _session_profile_for_user_id(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "session": {
            "user": {
                "id": profile["id"],
                "email": profile.get("email") or profile.get("ad_username") or "",
            },
        },
        "profile": profile,
    }


@app.post("/auth/register")
def register(req: RegisterRequest):
    if not re.match(r"[^@]+@[^@]+\.[^@]+", req.email):
        raise HTTPException(status_code=400, detail="Invalid email")
    if req.role not in ("admin", "hr", "employee", "manager", "hod"):
        req.role = "employee"
    uid = new_id()
    with cursor() as c:
        c.execute(
            "INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)",
            (uid, req.email.strip().lower(), hash_password(req.password), req.full_name.strip(), req.role),
        )
    token = create_access_token({"sub": uid})
    profile = _session_profile_for_user_id(uid)
    if not profile:
        raise HTTPException(status_code=500, detail="Could not load profile")
    return {"access_token": token, "token_type": "bearer", "session": {"user": {"id": uid, "email": req.email}}, "profile": profile}


# ---------- Attendance ----------
@app.get("/attendance/today")
def attendance_today(user_id: str = Depends(get_current_user_id)):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with cursor() as c:
        # Prefer today's log by date (substr works with ISO strings)
        c.execute(
            "SELECT * FROM attendance_logs WHERE user_id = ? AND substr(clock_in_at, 1, 10) = ? ORDER BY clock_in_at DESC LIMIT 1",
            (user_id, today),
        )
        row = c.fetchone()
        # If no match (e.g. timezone boundary), return current open session so clock-out always has a log_id
        if not row:
            c.execute(
                "SELECT * FROM attendance_logs WHERE user_id = ? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1",
                (user_id,),
            )
            row = c.fetchone()
    return row_to_dict(row)


def _get_late_threshold_minutes():
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("late_threshold_minutes",))
        row = c.fetchone()
    if row and row[0]:
        try:
            return int(row[0]) if isinstance(row[0], int) else int(str(row[0]).strip('"'))
        except (ValueError, TypeError):
            pass
    return 15


def _get_lunch_deduction_minutes():
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("lunch_deduction_minutes",))
        row = c.fetchone()
    if row and row[0] is not None:
        try:
            return int(row[0]) if isinstance(row[0], int) else int(str(row[0]).strip('"'))
        except (ValueError, TypeError):
            pass
    return 60


def _get_max_work_hours_auto_clock_out():
    """Max hours clocked in before system auto-clocks out (e.g. 10 for 9am–6pm + 1h buffer)."""
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("max_work_hours_auto_clock_out",))
        row = c.fetchone()
    if row and row[0] is not None:
        try:
            return max(1, min(24, int(row[0]) if isinstance(row[0], int) else int(str(row[0]).strip('"'))))
        except (ValueError, TypeError):
            pass
    return 10


def _run_auto_clock_out_over_max_hours():
    """Find any open attendance sessions that have exceeded max work hours and auto clock-out."""
    max_hours = _get_max_work_hours_auto_clock_out()
    lunch_deduction = _get_lunch_deduction_minutes()
    now_utc = datetime.now(timezone.utc)
    max_minutes = max_hours * 60
    with cursor() as c:
        c.execute("SELECT id, clock_in_at FROM attendance_logs WHERE clock_out_at IS NULL")
        rows = c.fetchall()
    for row in rows or []:
        log_id = row[0]
        clock_in_str = row[1]
        if not clock_in_str:
            continue
        in_dt = _parse_iso(clock_in_str)
        if in_dt.tzinfo is None:
            in_dt = in_dt.replace(tzinfo=timezone.utc)
        elapsed_hours = (now_utc - in_dt).total_seconds() / 3600
        if elapsed_hours < max_hours:
            continue
        # Auto clock-out at exactly clock_in + max_hours (cap recorded shift)
        out_dt = in_dt + timedelta(hours=max_hours)
        out_iso = out_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        total_minutes = max(0, max_minutes - lunch_deduction)
        try:
            with cursor() as c:
                c.execute(
                    "UPDATE attendance_logs SET clock_out_at = ?, total_minutes = ?, updated_at = ? WHERE id = ?",
                    (out_iso, total_minutes, out_iso, log_id),
                )
            logger.info("Auto clock-out: log_id=%s exceeded %s hours", log_id, max_hours)
        except Exception as e:
            logger.warning("Auto clock-out failed for log_id=%s: %s", log_id, e)


def _get_work_start_time():
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("work_start_time",))
        row = c.fetchone()
    if row and row[0]:
        s = str(row[0]).strip('"')
        parts = s.split(":")
        if len(parts) >= 2:
            try:
                return int(parts[0]), int(parts[1])
            except (ValueError, TypeError):
                pass
    return 9, 0


def _get_timezone():
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("timezone",))
        row = c.fetchone()
    if row and row[0]:
        return str(row[0]).strip('"')
    return "Africa/Kigali"


def _late_minutes(clock_in_at: str | None, work_start_h: int, work_start_m: int, tz_name: str) -> int:
    """Minutes after work_start when they clocked in (0 if on time or absent). clock_in_at is ISO UTC."""
    if not clock_in_at:
        return 0
    try:
        dt_utc = datetime.fromisoformat(clock_in_at.replace("Z", "+00:00"))
        if ZoneInfo:
            local_tz = ZoneInfo(tz_name)
            local_dt = dt_utc.astimezone(local_tz)
        else:
            local_dt = dt_utc
        from datetime import time as dt_time
        work_start = dt_time(work_start_h, work_start_m, 0)
        clock_time = local_dt.time()
        # minutes from midnight for each
        clock_mins = local_dt.hour * 60 + local_dt.minute
        start_mins = work_start.hour * 60 + work_start.minute
        return max(0, clock_mins - start_mins)
    except Exception:
        return 0


@app.get("/settings/work-hours")
def get_work_hours(_: str = Depends(get_current_user_id)):
    """Return work hours and timezone for frontend (Kigali 9am-6pm)."""
    with cursor() as c:
        c.execute("SELECT key, value FROM settings WHERE key IN ('work_start_time', 'work_end_time', 'timezone', 'late_threshold_minutes', 'lunch_deduction_minutes')")
        rows = c.fetchall()
    out = {"work_start": "09:00", "work_end": "18:00", "timezone": "Africa/Kigali", "late_threshold_minutes": 15, "lunch_deduction_minutes": 60}
    for row in rows:
        k, v = row[0], row[1]
        val = str(v).strip('"') if v else None
        if k == "work_start_time" and val:
            out["work_start"] = val
        elif k == "work_end_time" and val:
            out["work_end"] = val
        elif k == "timezone" and val:
            out["timezone"] = val
        elif k == "late_threshold_minutes":
            try:
                out["late_threshold_minutes"] = int(v) if isinstance(v, int) else int(str(v).strip('"'))
            except (ValueError, TypeError):
                pass
        elif k == "lunch_deduction_minutes":
            try:
                out["lunch_deduction_minutes"] = int(v) if isinstance(v, int) else int(str(v).strip('"'))
            except (ValueError, TypeError):
                pass
    return out


def _get_clock_in_allowed_ip_ranges():
    """Return list of allowed IP ranges (CIDR or prefix). Empty = no restriction."""
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("clock_in_allowed_ip_ranges",))
        row = c.fetchone()
    if not row or not row[0]:
        return []
    try:
        raw = row[0]
        if isinstance(raw, str) and raw.startswith("["):
            arr = json.loads(raw)
        else:
            arr = []
        return arr if isinstance(arr, list) else []
    except Exception:
        return []


def _ip_in_ranges(ip_str: str, ranges: list) -> bool:
    if not ip_str or not ranges:
        return True
    try:
        ip = ipaddress.ip_address(ip_str.strip())
    except ValueError:
        return False
    for r in ranges:
        if not r or not isinstance(r, str):
            continue
        r = r.strip()
        if "/" in r:
            try:
                net = ipaddress.ip_network(r, strict=False)
                if ip in net:
                    return True
            except ValueError:
                continue
        elif r.endswith("."):
            if ip_str.startswith(r):
                return True
        else:
            if ip_str == r:
                return True
    return False


def _get_clock_in_same_ip_minutes():
    """Within this many minutes, same IP cannot be used by a different user (anti pass-the-phone). 0 = disabled."""
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("clock_in_same_ip_minutes",))
        row = c.fetchone()
    if not row or row[0] is None:
        return 0
    try:
        v = row[0]
        return int(v) if isinstance(v, int) else int(str(v).strip('"'))
    except (ValueError, TypeError):
        return 0


@app.post("/attendance/clock-in")
def clock_in(req: ClockInRequest, request: Request, user_id: str = Depends(get_current_user_id)):
    """Clock-in: user_id is always from the auth token. Request body must not specify who clocks in (prevents buddy-punching)."""
    now_utc = datetime.utcnow()
    now_iso = now_utc.isoformat() + "Z"
    log_id = new_id()
    client_ip = request.client.host if request.client else None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip() or client_ip
    user_agent = request.headers.get("user-agent") or None
    # Anti-cheat: restrict clock-in to office IP ranges (if configured)
    allowed_ranges = _get_clock_in_allowed_ip_ranges()
    if allowed_ranges and not _ip_in_ranges(client_ip or "", allowed_ranges):
        logger.warning("Clock-in rejected: IP %s not in allowed ranges", client_ip)
        _audit_log(
            "attendance_clockin_blocked",
            "attendance_logs",
            user_id,
            None,
            {
                "reason": "ip_not_allowed",
                "client_ip": client_ip,
                "allowed_ranges": allowed_ranges,
            },
        )
        raise HTTPException(
            status_code=403,
            detail="Clock-in is only allowed from the office network. Connect to office Wi-Fi or network.",
        )
    # Anti-cheat: same IP used by another user recently (prevents pass-the-phone)
    same_ip_min = _get_clock_in_same_ip_minutes()
    if same_ip_min > 0 and client_ip:
        cutoff = (now_utc - timedelta(minutes=same_ip_min)).strftime("%Y-%m-%dT%H:%M:%S")
        with cursor() as c:
            c.execute(
                "SELECT user_id FROM attendance_logs WHERE client_ip = ? AND clock_in_at >= ? AND user_id != ? LIMIT 1",
                (client_ip, cutoff, user_id),
            )
            if c.fetchone():
                logger.warning("Clock-in rejected: IP %s recently used by another user", client_ip)
                _audit_log(
                    "attendance_clockin_blocked",
                    "attendance_logs",
                    user_id,
                    None,
                    {
                        "reason": "same_ip_cooldown",
                        "client_ip": client_ip,
                        "cooldown_minutes": same_ip_min,
                    },
                )
                raise HTTPException(
                    status_code=403,
                    detail="This network address was used by another user recently. Clock in from your own device or wait a few minutes.",
                )
    threshold_min = _get_late_threshold_minutes()
    work_h, work_m = _get_work_start_time()
    tz_name = _get_timezone()
    status = "present"
    if ZoneInfo and tz_name:
        try:
            tz = ZoneInfo(tz_name)
            now_local = now_utc.replace(tzinfo=timezone.utc).astimezone(tz)
            late_cutoff = now_local.replace(hour=work_h, minute=work_m, second=0, microsecond=0) + timedelta(minutes=threshold_min)
            if now_local > late_cutoff:
                status = "late"
        except Exception:
            start_of_day = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
            late_cutoff = start_of_day + timedelta(minutes=threshold_min)
            status = "late" if now_utc > late_cutoff else "present"
    else:
        start_of_day = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        late_cutoff = start_of_day + timedelta(minutes=threshold_min)
        status = "late" if now_utc > late_cutoff else "present"
    today_str = now_utc.strftime("%Y-%m-%d")
    with cursor() as c:
        c.execute(
            "SELECT id FROM attendance_logs WHERE user_id = ? AND substr(clock_in_at, 1, 10) = ? LIMIT 1",
            (user_id, today_str),
        )
        if c.fetchone():
            raise HTTPException(status_code=400, detail="Already clocked in today")
    with cursor() as c:
        try:
            c.execute(
                "INSERT INTO attendance_logs (id, user_id, branch_id, clock_in_at, status, client_ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (log_id, user_id, req.branch_id or None, now_iso, status, client_ip, user_agent),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Already clocked in today")
    with cursor() as c:
        c.execute("SELECT * FROM attendance_logs WHERE id = ?", (log_id,))
        return row_to_dict(c.fetchone())


def _parse_iso(s):
    if not s:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.utcnow()


@app.post("/attendance/clock-out")
def clock_out(req: ClockOutRequest, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM attendance_logs WHERE id = ?", (req.log_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Log not found")
    row = dict(row)
    if str(row.get("user_id")) != str(user_id):
        raise HTTPException(status_code=403, detail="You can only clock out your own session")
    out_now = datetime.now(timezone.utc)
    in_dt = _parse_iso(row.get("clock_in_at"))
    if in_dt.tzinfo is None:
        in_dt = in_dt.replace(tzinfo=timezone.utc)
    raw_minutes = int((out_now - in_dt).total_seconds() / 60)
    lunch_deduction = _get_lunch_deduction_minutes()
    total_minutes = max(0, raw_minutes - lunch_deduction)
    out_iso = out_now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    with cursor() as c:
        c.execute(
            "UPDATE attendance_logs SET clock_out_at = ?, total_minutes = ?, updated_at = ? WHERE id = ?",
            (out_iso, total_minutes, out_iso, req.log_id),
        )
    with cursor() as c:
        c.execute("SELECT * FROM attendance_logs WHERE id = ?", (req.log_id,))
        return row_to_dict(c.fetchone())


@app.get("/attendance/history")
def attendance_history(
    from_date: str | None = None,
    to_date: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    with cursor() as c:
        c.execute("SELECT * FROM attendance_logs WHERE user_id = ? ORDER BY clock_in_at DESC", (user_id,))
        rows = c.fetchall()
    out = [row_to_dict(r) for r in rows]
    if from_date:
        out = [x for x in out if x and (x.get("clock_in_at") or "")[:10] >= from_date[:10]]
    if to_date:
        out = [x for x in out if x and (x.get("clock_in_at") or "")[:10] <= to_date[:10]]
    return out


@app.get("/attendance/all")
def attendance_all(
    from_date: str | None = None,
    to_date: str | None = None,
    branch_id: str | None = None,
    user_id_param: str | None = Query(None, alias="user_id"),
    current_user_id: str = Depends(get_current_user_id),
):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("""
            SELECT a.*, u.full_name as user_full_name, u.email as user_email, b.name as branch_name
            FROM attendance_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN branches b ON a.branch_id = b.id
            ORDER BY a.clock_in_at DESC
        """)
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["users"] = {"full_name": d.pop("user_full_name", None), "email": d.pop("user_email", None)}
            d["branches"] = {"name": d.pop("branch_name", None)}
            if from_date and (d.get("clock_in_at") or "")[:10] < from_date[:10]:
                continue
            if to_date and (d.get("clock_in_at") or "")[:10] > to_date[:10]:
                continue
            if branch_id and d.get("branch_id") != branch_id:
                continue
            if user_id_param and d.get("user_id") != user_id_param:
                continue
            out.append(d)
    return out


@app.get("/reports/late")
def report_late(
    from_date: str | None = None,
    to_date: str | None = None,
    branch_id: str | None = None,
    current_user_id: str = Depends(get_current_user_id),
):
    """List all late clock-ins in period (HR/Admin)."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("""
            SELECT a.*, u.full_name as user_full_name, u.email as user_email, b.name as branch_name
            FROM attendance_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN branches b ON a.branch_id = b.id
            WHERE a.status = 'late'
            ORDER BY a.clock_in_at DESC
        """)
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["users"] = {"full_name": d.pop("user_full_name", None), "email": d.pop("user_email", None)}
            d["branches"] = {"name": d.pop("branch_name", None)}
            if from_date and (d.get("clock_in_at") or "")[:10] < from_date[:10]:
                continue
            if to_date and (d.get("clock_in_at") or "")[:10] > to_date[:10]:
                continue
            if branch_id and d.get("branch_id") != branch_id:
                continue
            out.append(d)
    return out


@app.get("/reports/flagged")
def report_flagged(
    from_date: str | None = None,
    to_date: str | None = None,
    min_lates: int = 3,
    current_user_id: str = Depends(get_current_user_id),
):
    """Staff with at least min_lates late clock-ins in period (HR/Admin)."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    sql = "SELECT user_id, COUNT(*) as late_count FROM attendance_logs WHERE status = 'late'"
    params = []
    if from_date:
        sql += " AND date(clock_in_at) >= ?"
        params.append(from_date[:10])
    if to_date:
        sql += " AND date(clock_in_at) <= ?"
        params.append(to_date[:10])
    sql += " GROUP BY user_id"
    with cursor() as c:
        c.execute(sql, params)
        rows = c.fetchall()
    flagged = [(r[0], r[1]) for r in rows if r[1] >= min_lates]
    out = []
    with cursor() as c:
        for uid, late_count in flagged:
            c.execute("SELECT id, full_name, email FROM users WHERE id = ?", (uid,))
            u = c.fetchone()
            if u:
                out.append({"user_id": uid, "full_name": u[1], "email": u[2], "late_count": late_count})
    return out


def _get_employees_for_report(branch_id: str | None):
    """Active employees (role=employee), optionally by branch. Returns list of dicts with user_id, full_name, email, department."""
    with cursor() as c:
        if branch_id:
            c.execute(
                "SELECT id, full_name, email, department FROM users WHERE is_active = 1 AND role = 'employee' AND branch_id = ? ORDER BY full_name",
                (branch_id,),
            )
        else:
            c.execute(
                "SELECT id, full_name, email, department FROM users WHERE is_active = 1 AND role = 'employee' ORDER BY full_name",
            )
        rows = c.fetchall()
    return [{"user_id": r[0], "full_name": r[1], "email": r[2] or "", "department": r[3] if len(r) > 3 else None} for r in rows]


def _get_attendance_logs_for_date(date_str: str, branch_id: str | None):
    """All attendance logs for the given date (clock_in_at on that day). Optional branch filter. Includes user department."""
    date_only = date_str[:10]
    with cursor() as c:
        c.execute("""
            SELECT a.*, u.full_name as user_full_name, u.email as user_email, u.department as user_department
            FROM attendance_logs a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE date(a.clock_in_at) = ?
        """, (date_only,))
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            if branch_id and d.get("branch_id") != branch_id:
                continue
            d["users"] = {
                "full_name": d.pop("user_full_name", None),
                "email": d.pop("user_email", None),
                "department": d.pop("user_department", None),
            }
            out.append(d)
    return out


@app.get("/reports/daily-summary")
def report_daily_summary(
    date: str = Query(..., description="YYYY-MM-DD"),
    branch_id: str | None = None,
    current_user_id: str = Depends(get_current_user_id),
):
    """Daily attendance summary: total staff, present, absent, late; percentages; daily table with Department, Check-In, Check-Out, Status, Late Minutes (HR/Admin)."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    date_only = date[:10]
    employees = _get_employees_for_report(branch_id)
    total_staff = len(employees)
    logs = _get_attendance_logs_for_date(date_only, branch_id)
    present_ids = {log["user_id"] for log in logs}
    present_count = len(present_ids)
    absent_count = total_staff - present_count
    late_logs = [lg for lg in logs if (lg.get("status") or "").lower() == "late"]
    on_time_logs = [lg for lg in logs if (lg.get("status") or "").lower() != "late"]
    no_clock_out_logs = [lg for lg in logs if not lg.get("clock_out_at")]

    work_h, work_m = _get_work_start_time()
    tz_name = _get_timezone()

    def _fmt_t(t):
        if not t:
            return None
        s = (t if isinstance(t, str) else str(t))[:19]
        if len(s) >= 16:
            return s[11:16]  # HH:MM
        return s

    absent_users = [{"user_id": e["user_id"], "full_name": e.get("full_name"), "email": e.get("email") or "", "department": e.get("department")} for e in employees if e["user_id"] not in present_ids]
    late_users = [{"user_id": lg["user_id"], "full_name": lg.get("users", {}).get("full_name"), "email": lg.get("users", {}).get("email"), "clock_in_at": lg.get("clock_in_at"), "department": lg.get("users", {}).get("department")} for lg in late_logs]
    on_time_users = [{"user_id": lg["user_id"], "full_name": lg.get("users", {}).get("full_name"), "email": lg.get("users", {}).get("email"), "clock_in_at": lg.get("clock_in_at"), "department": lg.get("users", {}).get("department")} for lg in on_time_logs]
    no_clock_out_users = [{"user_id": lg["user_id"], "full_name": lg.get("users", {}).get("full_name"), "email": lg.get("users", {}).get("email"), "clock_in_at": lg.get("clock_in_at"), "department": lg.get("users", {}).get("department")} for lg in no_clock_out_logs]

    pct_present = round(present_count / total_staff * 100, 1) if total_staff else 0
    pct_absent = round(absent_count / total_staff * 100, 1) if total_staff else 0
    pct_late = round(len(late_logs) / total_staff * 100, 1) if total_staff else 0
    pct_on_time = round(len(on_time_logs) / present_count * 100, 1) if present_count else 0
    pct_no_clock_out = round(len(no_clock_out_logs) / present_count * 100, 1) if present_count else 0

    # Daily report table: Employee Name, Department, Check-In, Check-Out, Status (Present/Absent/Late), Late Minutes
    daily_table = []
    for e in employees:
        uid = e["user_id"]
        dept = e.get("department") or ""
        if uid not in present_ids:
            daily_table.append({
                "employee_name": e.get("full_name"),
                "department": dept,
                "check_in": None,
                "check_out": None,
                "status": "Absent",
                "late_minutes": 0,
            })
    log_by_uid = {lg["user_id"]: lg for lg in logs}
    for e in employees:
        uid = e["user_id"]
        if uid not in present_ids:
            continue
        lg = log_by_uid.get(uid)
        if not lg:
            continue
        u = lg.get("users") or {}
        status = "Late" if (lg.get("status") or "").lower() == "late" else "Present"
        late_mins = _late_minutes(lg.get("clock_in_at"), work_h, work_m, tz_name) if status == "Late" else 0
        daily_table.append({
            "employee_name": u.get("full_name"),
            "department": u.get("department") or "",
            "check_in": _fmt_t(lg.get("clock_in_at")),
            "check_out": _fmt_t(lg.get("clock_out_at")),
            "status": status,
            "late_minutes": late_mins,
        })

    # One row per staff with status for UI (includes department)
    staff_with_status = []
    for e in employees:
        uid = e["user_id"]
        if uid not in present_ids:
            staff_with_status.append({"user_id": uid, "full_name": e.get("full_name"), "email": e.get("email") or "", "department": e.get("department"), "status": "absent", "pct": pct_absent})
    for lg in logs:
        uid = lg["user_id"]
        u = lg.get("users") or {}
        if not lg.get("clock_out_at"):
            staff_with_status.append({"user_id": uid, "full_name": u.get("full_name"), "email": u.get("email") or "", "department": u.get("department"), "status": "no_clock_out", "pct": pct_no_clock_out})
        elif (lg.get("status") or "").lower() == "late":
            staff_with_status.append({"user_id": uid, "full_name": u.get("full_name"), "email": u.get("email") or "", "department": u.get("department"), "status": "late", "pct": pct_late})
        else:
            staff_with_status.append({"user_id": uid, "full_name": u.get("full_name"), "email": u.get("email") or "", "department": u.get("department"), "status": "on_time", "pct": pct_on_time})

    return {
        "date": date_only,
        "branch_id": branch_id,
        "total_staff": total_staff,
        "present": present_count,
        "absent": absent_count,
        "late": len(late_logs),
        "on_time": len(on_time_logs),
        "no_clock_out": len(no_clock_out_logs),
        "pct_present": pct_present,
        "pct_absent": pct_absent,
        "pct_late": pct_late,
        "pct_on_time": pct_on_time,
        "pct_no_clock_out": pct_no_clock_out,
        "summary": {
            "total_employees": total_staff,
            "present_count": present_count,
            "present_pct": pct_present,
            "absent_count": absent_count,
            "absent_pct": pct_absent,
            "late_count": len(late_logs),
            "late_pct": pct_late,
        },
        "daily_table": daily_table,
        "staff_with_status": staff_with_status,
        "users": {
            "absent": absent_users,
            "late": late_users,
            "on_time": on_time_users,
            "no_clock_out": no_clock_out_users,
        },
    }


@app.get("/reports/monthly-summary")
def report_monthly_summary(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    branch_id: str | None = None,
    current_user_id: str = Depends(get_current_user_id),
):
    """Monthly attendance: list of daily summaries for each day in the month, plus aggregate and user lists (HR/Admin)."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    import calendar
    last_day = calendar.monthrange(year, month)[1]
    total_days = last_day  # calendar days in month (Sundays still count toward month length)
    work_days = sum(1 for d in range(1, last_day + 1) if date(year, month, d).weekday() != 6)
    days = []
    all_absent = set()
    all_late = set()
    all_no_clock_out = set()
    employees = _get_employees_for_report(branch_id)
    # Per-staff counts for the month: uid -> { days_absent, days_late, days_on_time, days_no_clock_out }
    staff_days = {e["user_id"]: {"days_absent": 0, "days_late": 0, "days_on_time": 0, "days_no_clock_out": 0} for e in employees}
    sum_pct_late = 0.0
    sum_pct_on_time = 0.0
    sum_pct_absent = 0.0
    sum_pct_no_clock_out = 0.0
    for day in range(1, last_day + 1):
        if date(year, month, day).weekday() == 6:
            continue  # Sunday — not a working day; do not count absent/present or list in daily series
        date_str = f"{year}-{month:02d}-{day:02d}"
        total_staff = len(employees)
        logs = _get_attendance_logs_for_date(date_str, branch_id)
        present_ids = {log["user_id"] for log in logs}
        present_count = len(present_ids)
        absent_count = total_staff - present_count
        late_logs = [lg for lg in logs if (lg.get("status") or "").lower() == "late"]
        on_time_logs = [lg for lg in logs if (lg.get("status") or "").lower() != "late"]
        no_clock_out_logs = [lg for lg in logs if not lg.get("clock_out_at")]
        for e in employees:
            uid = e["user_id"]
            if uid not in present_ids:
                all_absent.add(uid)
                staff_days[uid]["days_absent"] += 1
            else:
                lg = next((x for x in logs if x["user_id"] == uid), None)
                if lg:
                    if not lg.get("clock_out_at"):
                        staff_days[uid]["days_no_clock_out"] += 1
                        all_no_clock_out.add(uid)
                    elif (lg.get("status") or "").lower() == "late":
                        staff_days[uid]["days_late"] += 1
                        all_late.add(uid)
                    else:
                        staff_days[uid]["days_on_time"] += 1
        for lg in no_clock_out_logs:
            all_no_clock_out.add(lg["user_id"])
        for lg in late_logs:
            all_late.add(lg["user_id"])
        pct_late = round(len(late_logs) / present_count * 100, 1) if present_count else 0
        pct_on_time = round(len(on_time_logs) / present_count * 100, 1) if present_count else 0
        pct_absent = round(absent_count / total_staff * 100, 1) if total_staff else 0
        pct_no_clock_out = round(len(no_clock_out_logs) / present_count * 100, 1) if present_count else 0
        sum_pct_late += pct_late
        sum_pct_on_time += pct_on_time
        sum_pct_absent += pct_absent
        sum_pct_no_clock_out += pct_no_clock_out
        days.append({
            "date": date_str,
            "total_staff": total_staff,
            "present": present_count,
            "absent": absent_count,
            "late": len(late_logs),
            "on_time": len(on_time_logs),
            "no_clock_out": len(no_clock_out_logs),
            "pct_late": pct_late,
            "pct_on_time": pct_on_time,
            "pct_absent": pct_absent,
            "pct_no_clock_out": pct_no_clock_out,
        })
    num_days = len(days)
    month_averages = {
        "avg_pct_late": round(sum_pct_late / num_days, 1) if num_days else 0,
        "avg_pct_on_time": round(sum_pct_on_time / num_days, 1) if num_days else 0,
        "avg_pct_absent": round(sum_pct_absent / num_days, 1) if num_days else 0,
        "avg_pct_no_clock_out": round(sum_pct_no_clock_out / num_days, 1) if num_days else 0,
    }
    staff_monthly = []
    for e in employees:
        uid = e["user_id"]
        d = staff_days.get(uid, {})
        da, dl, dot, dnco = d.get("days_absent", 0), d.get("days_late", 0), d.get("days_on_time", 0), d.get("days_no_clock_out", 0)
        present_days = dot + dl  # days they clocked in (on time or late)
        attendance_pct = round(present_days / work_days * 100, 1) if work_days else 0
        late_pct = round(dl / work_days * 100, 1) if work_days else 0
        staff_monthly.append({
            "user_id": uid,
            "employee_name": e.get("full_name"),
            "full_name": e.get("full_name"),
            "email": e.get("email") or "",
            "department": e.get("department") or "",
            "work_days": work_days,
            "present_days": present_days,
            "days_absent": da,
            "days_late": dl,
            "days_on_time": dot,
            "days_no_clock_out": dnco,
            "attendance_pct": attendance_pct,
            "pct_absent": round(da / work_days * 100, 1),
            "pct_late": late_pct,
            "pct_on_time": round(dot / work_days * 100, 1),
            "pct_no_clock_out": round(dnco / work_days * 100, 1),
        })
    # Department-level summary
    from collections import defaultdict
    dept_stats = defaultdict(lambda: {"attendance_pcts": [], "absence_pcts": [], "late_pcts": []})
    for s in staff_monthly:
        dept = s.get("department") or "-"
        dept_stats[dept]["attendance_pcts"].append(s["attendance_pct"])
        dept_stats[dept]["absence_pcts"].append(s["pct_absent"])
        dept_stats[dept]["late_pcts"].append(s["pct_late"])
    department_summary = []
    for dept, stats in sorted(dept_stats.items()):
        n = len(stats["attendance_pcts"])
        avg_att = round(sum(stats["attendance_pcts"]) / n, 1) if n else 0
        avg_abs = round(sum(stats["absence_pcts"]) / n, 1) if n else 0
        avg_late = round(sum(stats["late_pcts"]) / n, 1) if n else 0
        department_summary.append({
            "department": dept,
            "employee_count": n,
            "avg_attendance_pct": avg_att,
            "absence_pct": avg_abs,
            "late_pct": avg_late,
        })
    # Executive summary: overall % and trend vs previous month
    overall_attendance = round(sum(s["attendance_pct"] for s in staff_monthly) / len(staff_monthly), 1) if staff_monthly else 0
    overall_absence = round(sum(s["pct_absent"] for s in staff_monthly) / len(staff_monthly), 1) if staff_monthly else 0
    overall_late = round(sum(s["pct_late"] for s in staff_monthly) / len(staff_monthly), 1) if staff_monthly else 0
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    prev_avg_absent = month_averages["avg_pct_absent"]
    prev_avg_late = month_averages["avg_pct_late"]
    try:
        prev_last = calendar.monthrange(prev_year, prev_month)[1]
        prev_sum_abs, prev_sum_late, prev_n = 0.0, 0.0, 0
        for day in range(1, prev_last + 1):
            if date(prev_year, prev_month, day).weekday() == 6:
                continue
            date_str = f"{prev_year}-{prev_month:02d}-{day:02d}"
            logs_prev = _get_attendance_logs_for_date(date_str, branch_id)
            pres_prev = {lg["user_id"] for lg in logs_prev}
            abs_prev = len(employees) - len(pres_prev)
            late_prev = sum(1 for lg in logs_prev if (lg.get("status") or "").lower() == "late")
            prev_sum_abs += round(abs_prev / len(employees) * 100, 1) if employees else 0
            prev_sum_late += round(late_prev / len(employees) * 100, 1) if employees else 0
            prev_n += 1
        prev_avg_absent = round(prev_sum_abs / prev_n, 1) if prev_n else 0
        prev_avg_late = round(prev_sum_late / prev_n, 1) if prev_n else 0
    except Exception:
        pass
    trend_attendance = "-"
    trend_absence = "-"
    trend_late = "-"
    if prev_avg_absent is not None and prev_avg_late is not None:
        cur_abs = month_averages["avg_pct_absent"]
        cur_late = month_averages["avg_pct_late"]
        trend_absence = "↓" if cur_abs < prev_avg_absent else ("↑" if cur_abs > prev_avg_absent else "→")
        trend_late = "↓" if cur_late < prev_avg_late else ("↑" if cur_late > prev_avg_late else "→")
        prev_att = 100 - prev_avg_absent
        cur_att = 100 - cur_abs
        trend_attendance = "↑" if cur_att > prev_att else ("↓" if cur_att < prev_att else "→")
    executive_summary = {
        "overall_attendance_pct": overall_attendance,
        "overall_absence_pct": overall_absence,
        "overall_late_pct": overall_late,
        "trend_attendance": trend_attendance,
        "trend_absence": trend_absence,
        "trend_late": trend_late,
    }
    def user_list(user_ids, employees_by_id):
        return [{"user_id": uid, "full_name": employees_by_id.get(uid, {}).get("full_name"), "email": employees_by_id.get(uid, {}).get("email")} for uid in user_ids]
    by_id = {e["user_id"]: e for e in employees}
    with cursor() as c:
        for uid in all_late | all_absent | all_no_clock_out:
            if uid not in by_id:
                c.execute("SELECT id, full_name, email FROM users WHERE id = ?", (uid,))
                row = c.fetchone()
                if row:
                    by_id[uid] = {"user_id": row[0], "full_name": row[1], "email": row[2] or ""}
    return {
        "year": year,
        "month": month,
        "branch_id": branch_id,
        "total_days": total_days,
        "work_days": work_days,
        "days": days,
        "month_averages": month_averages,
        "executive_summary": executive_summary,
        "department_summary": department_summary,
        "staff_monthly": staff_monthly,
        "aggregate": {
            "unique_absent": user_list(list(all_absent), by_id),
            "unique_late": user_list(list(all_late), by_id),
            "unique_no_clock_out": user_list(list(all_no_clock_out), by_id),
        },
    }


# ---------- Users ----------
class CreateUserRequest(BaseModel):
    email: str | None = None
    password: str | None = None
    full_name: str
    role: str = "employee"
    ad_username: str | None = None
    branch_id: str | None = None
    department: str | None = None
    manager_id: str | None = None
    gender: str | None = None
    phone: str | None = None
    employee_id: str | None = None
    employee_code: str | None = None
    division: str | None = None
    job_title: str | None = None
    work_anniversary: str | None = None
    hr_notes: str | None = None


def _return_user_api_dict(uid: str) -> dict | None:
    with cursor() as c:
        c.execute(
            """
            SELECT u.*, b.name as branch_name, b.code as branch_code, m.full_name as supervisor_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN users m ON u.manager_id = m.id
            WHERE u.id = ?
            """,
            (uid,),
        )
        row = c.fetchone()
    if not row:
        return None
    d = row_to_dict(row)
    if d:
        d.pop("password_hash", None)
        d["branches"] = {"name": d.pop("branch_name", None), "code": d.pop("branch_code", None)}
        d["supervisor_name"] = d.pop("supervisor_name", None)
    return d


@app.post("/users")
def create_user(req: CreateUserRequest, current_user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if r[0] == "hr" and req.role in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="HR cannot create admin or HR accounts")
    if req.role not in ("admin", "hr", "employee", "manager", "hod"):
        req.role = "employee"
    ad_user = (req.ad_username or "").strip() or None
    email_val = (req.email or "").strip().lower() or None
    if ad_user:
        with cursor() as c:
            c.execute("SELECT id FROM users WHERE ad_username = ?", (ad_user,))
            if c.fetchone():
                raise HTTPException(status_code=400, detail="AD username already registered")
        # LDAP user: placeholder email if none given (username@domain), placeholder password
        if not email_val:
            domain = (_get_ldap_config().get("ldap_email_domain") or "copeduplc.rw").strip() or "copeduplc.rw"
            email_val = f"{ad_user}@{domain}"
        elif not re.match(r"[^@]+@[^@]+\.[^@]+", email_val):
            raise HTTPException(status_code=400, detail="Invalid email")
        password_hash = LDAP_ONLY_PASSWORD_PLACEHOLDER
    else:
        if not email_val or not re.match(r"[^@]+@[^@]+\.[^@]+", email_val):
            raise HTTPException(status_code=400, detail="Email required")
        if not (req.password or "").strip():
            raise HTTPException(status_code=400, detail="Password required")
        with cursor() as c:
            c.execute("SELECT id FROM users WHERE email = ?", (email_val,))
            if c.fetchone():
                raise HTTPException(status_code=400, detail="Email already registered")
        password_hash = hash_password(req.password)
    uid = new_id()
    dept = (req.department or "").strip() or None
    branch_id = (req.branch_id or "").strip() or None
    manager_id = (req.manager_id or "").strip() or None
    gender = (req.gender or "").strip() or None
    phone = (req.phone or "").strip() or None
    emp_id = (req.employee_id or "").strip() or None
    emp_code = (req.employee_code or "").strip() or None
    division = (req.division or "").strip() or None
    job_title = (req.job_title or "").strip() or None
    hr_notes = (req.hr_notes or "").strip() or None
    work_anniv = (req.work_anniversary or "").strip() or None
    if work_anniv:
        _parse_yyyy_mm_dd(work_anniv)
    else:
        work_anniv = None
    with cursor() as c:
        c.execute(
            """
            INSERT INTO users (
                id, email, password_hash, full_name, role, ad_username, branch_id, department, manager_id,
                gender, phone, employee_id, employee_code, division, job_title, work_anniversary, hr_notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                uid,
                email_val,
                password_hash,
                req.full_name.strip(),
                req.role,
                ad_user,
                branch_id,
                dept,
                manager_id,
                gender,
                phone,
                emp_id,
                emp_code,
                division,
                job_title,
                work_anniv,
                hr_notes,
            ),
        )
    out = _return_user_api_dict(uid)
    if not out:
        raise HTTPException(status_code=500, detail="Could not load new user")
    return out


@app.get("/users/lookup-ad")
def lookup_ad_user(
    username: str = Query(..., min_length=1),
    current_user_id: str = Depends(get_current_user_id),
):
    """Look up a user in Active Directory by sAMAccountName. Returns full_name and email for pre-filling the create-user form. Admin or HR."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    data, err = _ldap_lookup_user(username.strip())
    if err:
        logger.warning("AD lookup 503 for username=%r: %s", username, err)
        raise HTTPException(status_code=503, detail=err)
    if not data:
        raise HTTPException(status_code=404, detail="User not found in Active Directory")
    return data


@app.delete("/users/{uid}")
def delete_user(uid: str, current_user_id: str = Depends(get_current_user_id)):
    """Delete a user and their related data. Admin only. Cannot delete yourself or the last admin."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if uid == current_user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    with cursor() as c:
        c.execute("SELECT id, role FROM users WHERE id = ?", (uid,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        target_role = row[1]
        if target_role == "admin":
            c.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1")
            (admin_count,) = c.fetchone()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot delete the last admin account")
        c.execute("DELETE FROM attendance_logs WHERE user_id = ?", (uid,))
        c.execute("UPDATE audit_logs SET user_id = NULL WHERE user_id = ?", (uid,))
        c.execute("UPDATE announcements SET created_by = NULL WHERE created_by = ?", (uid,))
        c.execute("UPDATE hr_documents SET uploaded_by = NULL WHERE uploaded_by = ?", (uid,))
        c.execute("SELECT file_path FROM staff_documents WHERE user_id = ? OR uploaded_by = ?", (uid, uid))
        for (fp,) in c.fetchall() or []:
            if fp and "/" not in str(fp) and "\\" not in str(fp) and not str(fp).startswith(".."):
                p = os.path.join(UPLOAD_DIR, str(fp))
                try:
                    if os.path.isfile(p):
                        os.remove(p)
                except OSError:
                    pass
        c.execute("DELETE FROM staff_documents WHERE user_id = ? OR uploaded_by = ?", (uid, uid))
        c.execute("DELETE FROM notifications WHERE user_id = ?", (uid,))
        c.execute("UPDATE settings SET updated_by = NULL WHERE updated_by = ?", (uid,))
        c.execute("DELETE FROM users WHERE id = ?", (uid,))
    return {"ok": True}


@app.post("/users/bulk-import")
def bulk_import_users(
    file: UploadFile = File(...),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Import users from CSV. Required columns: username, role.
    Optional: full_name, email. Username = AD username (they will log in with LDAP).
    Admin only.
    """
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a CSV file")
    try:
        content = file.file.read()
        if isinstance(content, bytes):
            content = content.decode("utf-8-sig")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")
    domain = (_get_ldap_config().get("ldap_email_domain") or "copeduplc.rw").strip() or "copeduplc.rw"
    created = 0
    failed = []
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no headers")
    fieldnames = [f.strip().lower() for f in (reader.fieldnames or [])]
    if "username" not in fieldnames or "role" not in fieldnames:
        raise HTTPException(status_code=400, detail="CSV must have columns: username, role. Optional: full_name, email, department, branch")
    for row in reader:
        raw = {k.strip(): v.strip() if isinstance(v, str) else "" for k, v in row.items() if k}
        row_lower = {k.lower(): v for k, v in raw.items()}
        username = (row_lower.get("username") or "").strip()
        role = (row_lower.get("role") or "employee").strip().lower() or "employee"
        if role not in ("admin", "hr", "employee"):
            role = "employee"
        if not username:
            failed.append({"row": raw, "error": "username is empty"})
            continue
        full_name = (row_lower.get("full_name") or raw.get("full_name") or "").strip()
        email = (row_lower.get("email") or raw.get("email") or "").strip().lower()
        department = (row_lower.get("department") or raw.get("department") or "").strip() or None
        branch_id = None
        branch_val = (row_lower.get("branch") or raw.get("branch") or "").strip()
        if branch_val:
            with cursor() as c:
                c.execute("SELECT id FROM branches WHERE LOWER(TRIM(name)) = LOWER(?) OR LOWER(TRIM(code)) = LOWER(?) LIMIT 1", (branch_val, branch_val))
                row_b = c.fetchone()
                if row_b:
                    branch_id = row_b[0]
        if not full_name or not email:
            ad_data, _ = _ldap_lookup_user(username)
            if ad_data:
                if not full_name:
                    full_name = (ad_data.get("full_name") or "").strip() or username
                if not email:
                    email = (ad_data.get("email") or "").strip() or f"{username}@{domain}"
            else:
                if not full_name:
                    full_name = username
                if not email:
                    email = f"{username}@{domain}"
        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            email = f"{username}@{domain}"
        try:
            with cursor() as c:
                c.execute("SELECT id FROM users WHERE ad_username = ?", (username,))
                if c.fetchone():
                    failed.append({"row": raw, "error": "username already registered"})
                    continue
            uid = new_id()
            with cursor() as c:
                c.execute(
                    "INSERT INTO users (id, email, password_hash, full_name, role, ad_username, branch_id, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (uid, email, LDAP_ONLY_PASSWORD_PLACEHOLDER, full_name, role, username, branch_id, department),
                )
            created += 1
        except Exception as e:
            failed.append({"row": raw, "error": str(e)})
    return {"created": created, "failed": failed, "total_rows": created + len(failed)}


@app.get("/users")
def list_users(current_user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("""
            SELECT u.*, b.name as branch_name, b.code as branch_code, m.full_name as supervisor_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN users m ON u.manager_id = m.id
            ORDER BY u.full_name
        """)
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d.pop("password_hash", None)
            d["branches"] = {"name": d.pop("branch_name", None), "code": d.pop("branch_code", None)}
            d["supervisor_name"] = d.pop("supervisor_name", None)
            out.append(d)
    return out


@app.get("/users/mention-list")
def list_users_mention_list(_: str = Depends(get_current_user_id)):
    """Minimal user list for @mentions (recognition, comments). Any authenticated user can call."""
    with cursor() as c:
        c.execute("""
            SELECT id, full_name, email, is_active FROM users
            WHERE is_active = 1 ORDER BY full_name
        """)
        rows = c.fetchall()
    return [row_to_dict(r) for r in rows if row_to_dict(r)]


@app.get("/users/me/profile")
def get_user_profile(user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    d = row_to_dict(row)
    d.pop("password_hash", None)
    _strip_sensitive_employee_fields(d)
    return d


class RoleUpdate(BaseModel):
    role: str


@app.patch("/users/{uid}/role")
def set_user_role(uid: str, req: RoleUpdate, current_user_id: str = Depends(get_current_user_id)):
    role = req.role
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if role not in ("admin", "hr", "employee"):
        raise HTTPException(status_code=400, detail="Invalid role")
    with cursor() as c:
        c.execute("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", (role, datetime.utcnow().isoformat(), uid))
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (uid,))
        return row_to_dict(c.fetchone())


class ActiveUpdate(BaseModel):
    is_active: bool


class SupervisorUpdate(BaseModel):
    manager_id: str | None = None


@app.patch("/users/{uid}/supervisor")
def set_user_supervisor(uid: str, req: SupervisorUpdate, current_user_id: str = Depends(get_current_user_id)):
    """HR or Admin assigns the staff's supervisor (manager_id). Used for appraisal approval chain."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if req.manager_id is not None:
        with cursor() as c:
            c.execute("SELECT id FROM users WHERE id = ?", (req.manager_id,))
            if not c.fetchone():
                raise HTTPException(status_code=400, detail="Supervisor user not found")
    old_mid = None
    with cursor() as c:
        c.execute("SELECT manager_id FROM users WHERE id = ?", (uid,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        old_mid = row[0]
    with cursor() as c:
        c.execute(
            "UPDATE users SET manager_id = ?, updated_at = ? WHERE id = ?",
            (req.manager_id, datetime.utcnow().isoformat(), uid),
        )
    if not _norm_uid_compare(old_mid, req.manager_id):
        _repoint_workflows_after_staff_manager_change(uid, old_mid, current_user_id)
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (uid,))
        return row_to_dict(c.fetchone())


class DepartmentUpdate(BaseModel):
    department: str | None = None


@app.patch("/users/{uid}/department")
def set_user_department(uid: str, req: DepartmentUpdate, current_user_id: str = Depends(get_current_user_id)):
    """HR or Admin sets organizational department (used in attendance and leave reports)."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    raw = (req.department or "").strip()
    dept = raw if raw else None
    if dept and len(dept) > 200:
        raise HTTPException(status_code=400, detail="Department must be 200 characters or less")
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE id = ?", (uid,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
    with cursor() as c:
        c.execute(
            "UPDATE users SET department = ?, updated_at = ? WHERE id = ?",
            (dept, datetime.utcnow().isoformat(), uid),
        )
    with cursor() as c:
        c.execute(
            """
            SELECT u.*, b.name as branch_name, b.code as branch_code, m.full_name as supervisor_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN users m ON u.manager_id = m.id
            WHERE u.id = ?
            """,
            (uid,),
        )
        row = c.fetchone()
    d = row_to_dict(row)
    if d:
        d.pop("password_hash", None)
        d["branches"] = {"name": d.pop("branch_name", None), "code": d.pop("branch_code", None)}
        d["supervisor_name"] = d.pop("supervisor_name", None)
    return d


class SetPasswordBody(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=256)


@app.patch("/users/{uid}/password")
def set_user_password(uid: str, req: SetPasswordBody, current_user_id: str = Depends(get_current_user_id)):
    """Set local (bcrypt) password so the user can sign in with email + password as well as AD if configured."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can set user passwords")
    new_password = (req.new_password or "").strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE id = ?", (uid,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
    ph = hash_password(new_password)
    with cursor() as c:
        c.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (ph, datetime.utcnow().isoformat(), uid),
        )
    return {"ok": True, "user_id": uid}


class EmployeeRecordUpdate(BaseModel):
    full_name: str | None = None
    gender: str | None = None
    phone: str | None = None
    employee_id: str | None = None
    employee_code: str | None = None
    department: str | None = None
    division: str | None = None
    branch_id: str | None = None
    manager_id: str | None = None
    job_title: str | None = None
    work_anniversary: str | None = None
    hr_notes: str | None = None
    date_of_birth: str | None = None
    net_salary: float | None = None
    is_married: bool | None = None


ALLOWED_RECORD_FIELDS = frozenset({
    "full_name",
    "gender",
    "phone",
    "employee_id",
    "employee_code",
    "department",
    "division",
    "branch_id",
    "manager_id",
    "job_title",
    "work_anniversary",
    "hr_notes",
    "date_of_birth",
    "net_salary",
    "is_married",
})


def _compute_age_stats_for_overview() -> dict:
    """Age bands for active users with a valid date_of_birth (YYYY-MM-DD)."""
    buckets = {"18_24": 0, "25_34": 0, "35_44": 0, "45_54": 0, "55_plus": 0}
    labels = {"18_24": "18–24", "25_34": "25–34", "35_44": "35–44", "45_54": "45–54", "55_plus": "55+"}
    ages: list[int] = []
    unknown = 0
    today = date.today()
    try:
        with cursor() as c:
            c.execute("SELECT date_of_birth FROM users WHERE is_active = 1")
            rows = c.fetchall()
    except sqlite3.OperationalError:
        return {
            "buckets": buckets,
            "bucket_labels": labels,
            "chart_data": [{"band": labels[k], "key": k, "count": buckets[k]} for k in buckets],
            "min": None,
            "max": None,
            "avg": None,
            "known_count": 0,
            "unknown_count": 0,
        }
    for (dob_raw,) in rows:
        raw = (dob_raw or "").strip() if dob_raw else ""
        if not raw:
            unknown += 1
            continue
        try:
            b = datetime.strptime(raw[:10], "%Y-%m-%d").date()
        except ValueError:
            unknown += 1
            continue
        y = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
        if y < 16 or y > 100:
            unknown += 1
            continue
        ages.append(y)
        if y <= 24:
            buckets["18_24"] += 1
        elif y <= 34:
            buckets["25_34"] += 1
        elif y <= 44:
            buckets["35_44"] += 1
        elif y <= 54:
            buckets["45_54"] += 1
        else:
            buckets["55_plus"] += 1
    known = len(ages)
    return {
        "buckets": buckets,
        "bucket_labels": labels,
        "chart_data": [{"band": labels[k], "key": k, "count": buckets[k]} for k in buckets],
        "min": min(ages) if ages else None,
        "max": max(ages) if ages else None,
        "avg": round(sum(ages) / known, 1) if ages else None,
        "known_count": known,
        "unknown_count": unknown,
    }


def _upcoming_work_anniversaries(days: int = 30) -> list[dict]:
    today = datetime.utcnow().date()
    end = today + timedelta(days=days)
    out: list[dict] = []
    with cursor() as c:
        c.execute(
            """
            SELECT id, full_name, work_anniversary FROM users
            WHERE is_active = 1 AND work_anniversary IS NOT NULL AND TRIM(work_anniversary) != ''
            """
        )
        for row in c.fetchall():
            d = row_to_dict(row)
            wa = (d.get("work_anniversary") or "").strip()
            try:
                hire = datetime.strptime(wa[:10], "%Y-%m-%d").date()
            except ValueError:
                continue
            m, day = hire.month, hire.day
            try:
                next_a = datetime(today.year, m, day).date()
            except ValueError:
                next_a = datetime(today.year, 2, 28).date()
            if next_a < today:
                try:
                    next_a = datetime(today.year + 1, m, day).date()
                except ValueError:
                    next_a = datetime(today.year + 1, 2, 28).date()
            if today <= next_a <= end:
                years = today.year - hire.year
                if (today.month, today.day) < (hire.month, hire.day):
                    years -= 1
                out.append(
                    {
                        "user_id": d["id"],
                        "full_name": d.get("full_name"),
                        "work_anniversary": wa,
                        "next_celebration_date": next_a.isoformat(),
                        "years_of_service": max(0, years),
                    }
                )
    out.sort(key=lambda x: x["next_celebration_date"])
    return out[:40]


@app.get("/hr/organization-overview")
def hr_organization_overview(current_user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("SELECT COUNT(*) FROM users WHERE is_active = 1")
        active = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM users WHERE is_active = 0 OR is_active IS NULL")
        inactive = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM users")
        total_all_users = c.fetchone()[0]
    by_dept: list[dict] = []
    with cursor() as c:
        c.execute(
            """
            SELECT TRIM(COALESCE(department, '')) AS d, COUNT(*) AS n
            FROM users WHERE is_active = 1
            GROUP BY d ORDER BY n DESC, d COLLATE NOCASE
            """
        )
        for row in c.fetchall():
            label = row[0] if row[0] else "(Unassigned)"
            by_dept.append({"department": label, "count": row[1]})
    by_branch: list[dict] = []
    with cursor() as c:
        c.execute(
            """
            SELECT u.branch_id, b.name, b.code, COUNT(*) AS n
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            WHERE u.is_active = 1
            GROUP BY u.branch_id, b.name, b.code
            ORDER BY n DESC
            """
        )
        for row in c.fetchall():
            by_branch.append(
                {
                    "branch_id": row[0],
                    "branch_name": row[1],
                    "branch_code": row[2],
                    "count": row[3],
                }
            )
    gender_counts = {"female": 0, "male": 0, "other": 0, "prefer_not_say": 0, "unset": 0}
    with cursor() as c:
        c.execute("SELECT LOWER(TRIM(COALESCE(gender, ''))) FROM users WHERE is_active = 1")
        for (g,) in c.fetchall():
            if not g:
                gender_counts["unset"] += 1
            elif g in gender_counts:
                gender_counts[g] += 1
            else:
                gender_counts["other"] += 1
    age_stats = _compute_age_stats_for_overview()
    women = gender_counts.get("female", 0)
    men = gender_counts.get("male", 0)
    other_gender = (
        gender_counts.get("other", 0)
        + gender_counts.get("prefer_not_say", 0)
        + gender_counts.get("unset", 0)
    )
    return {
        "active_employees": active,
        "inactive_accounts": inactive,
        "total_users": total_all_users,
        "no_longer_active": inactive,
        "by_department": by_dept,
        "by_branch": by_branch,
        "gender_counts": gender_counts,
        "women_men": {
            "women": women,
            "men": men,
            "other_or_not_set": other_gender,
        },
        "age_stats": age_stats,
        "upcoming_anniversaries": _upcoming_work_anniversaries(30),
    }


@app.patch("/users/{uid}/record")
def patch_user_record(uid: str, req: EmployeeRecordUpdate, current_user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    raw = req.model_dump(exclude_unset=True)
    updates: dict = {}
    for k, v in raw.items():
        if k not in ALLOWED_RECORD_FIELDS:
            continue
        if isinstance(v, str):
            stripped = v.strip()
            updates[k] = None if stripped == "" else stripped
        else:
            updates[k] = v
    if "work_anniversary" in updates and updates["work_anniversary"] is not None:
        _parse_yyyy_mm_dd(updates["work_anniversary"])
    if "date_of_birth" in updates and updates["date_of_birth"] is not None:
        _parse_yyyy_mm_dd(updates["date_of_birth"])
    if "net_salary" in updates:
        ns = updates["net_salary"]
        if ns is not None:
            try:
                fv = float(ns)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid net salary")
            if fv < 0:
                raise HTTPException(status_code=400, detail="Net salary cannot be negative")
            updates["net_salary"] = fv
    if "is_married" in updates:
        im = updates["is_married"]
        if im is None:
            pass
        else:
            updates["is_married"] = 1 if bool(im) else 0
    if "branch_id" in updates:
        bid = updates["branch_id"]
        if bid is not None:
            with cursor() as c:
                c.execute("SELECT id FROM branches WHERE id = ?", (bid,))
                if not c.fetchone():
                    raise HTTPException(status_code=400, detail="Branch not found")
    if "manager_id" in updates:
        mid = updates["manager_id"]
        if mid is not None:
            if mid == uid:
                raise HTTPException(status_code=400, detail="Cannot assign self as supervisor")
            with cursor() as c:
                c.execute("SELECT id FROM users WHERE id = ?", (mid,))
                if not c.fetchone():
                    raise HTTPException(status_code=400, detail="Supervisor not found")
    if "full_name" in updates:
        fn = updates["full_name"]
        if fn is None or (isinstance(fn, str) and not fn.strip()):
            raise HTTPException(status_code=400, detail="Full name cannot be empty")
        if isinstance(fn, str):
            updates["full_name"] = fn.strip()
    if "department" in updates and updates["department"] is not None and len(updates["department"]) > 200:
        raise HTTPException(status_code=400, detail="Department must be 200 characters or less")
    if not updates:
        out = _return_user_api_dict(uid)
        if not out:
            raise HTTPException(status_code=404, detail="User not found")
        return out
    old_manager_for_repoint = None
    if "manager_id" in updates:
        with cursor() as c:
            c.execute("SELECT manager_id FROM users WHERE id = ?", (uid,))
            r0 = c.fetchone()
            old_manager_for_repoint = r0[0] if r0 else None
    sets = []
    params: list = []
    for k, v in updates.items():
        sets.append(f"{k} = ?")
        params.append(v)
    params.append(datetime.utcnow().isoformat())
    params.append(uid)
    with cursor() as c:
        c.execute(f"UPDATE users SET {', '.join(sets)}, updated_at = ? WHERE id = ?", tuple(params))
        if c.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    if "manager_id" in updates and not _norm_uid_compare(old_manager_for_repoint, updates.get("manager_id")):
        _repoint_workflows_after_staff_manager_change(uid, old_manager_for_repoint, current_user_id)
    out = _return_user_api_dict(uid)
    if not out:
        raise HTTPException(status_code=404, detail="User not found")
    return out


@app.patch("/users/{uid}/active")
def set_user_active(uid: str, req: ActiveUpdate, current_user_id: str = Depends(get_current_user_id)):
    is_active = req.is_active
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not is_active and _norm_uid_compare(uid, current_user_id):
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    with cursor() as c:
        c.execute("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?", (1 if is_active else 0, datetime.utcnow().isoformat(), uid))
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (uid,))
        return row_to_dict(c.fetchone())


# ---------- Announcements ----------
def _get_total_staff_count():
    """Count active users (staff who can see announcements)."""
    with cursor() as c:
        c.execute("SELECT COUNT(*) FROM users WHERE is_active = 1")
        return c.fetchone()[0]


@app.get("/announcements")
def list_announcements(expired: bool = False, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("""
            SELECT an.*, u.full_name as creator_name FROM announcements an
            LEFT JOIN users u ON an.created_by = u.id ORDER BY an.published_at DESC
        """)
        rows = c.fetchall()
    total_staff = _get_total_staff_count()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["users"] = {"full_name": d.pop("creator_name", None)}
            if not expired and d.get("expires_at"):
                if d["expires_at"] < datetime.utcnow().isoformat():
                    continue
            aid = d.get("id")
            with cursor() as c:
                c.execute("SELECT COUNT(*) FROM announcement_reads WHERE announcement_id = ?", (aid,))
                d["acknowledged_count"] = c.fetchone()[0]
                c.execute("SELECT 1 FROM announcement_reads WHERE announcement_id = ? AND user_id = ?", (aid, user_id))
                d["acknowledged_by_me"] = c.fetchone() is not None
            d["total_staff"] = total_staff
            out.append(d)
    return out


class AnnouncementCreate(BaseModel):
    title: str
    body: str
    created_by: str | None = None
    priority: str = "normal"
    deadline_at: str | None = None


@app.post("/announcements")
def create_announcement(req: AnnouncementCreate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    aid = new_id()
    now = datetime.utcnow().isoformat() + "Z"
    deadline = (req.deadline_at or "").strip() or None
    with cursor() as c:
        c.execute(
            "INSERT INTO announcements (id, title, body, created_by, priority, published_at, deadline_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (aid, req.title, req.body, user_id, req.priority, now, deadline),
        )
    with cursor() as c:
        c.execute("SELECT an.*, u.full_name as creator_name FROM announcements an LEFT JOIN users u ON an.created_by = u.id WHERE an.id = ?", (aid,))
        row = c.fetchone()
    d = row_to_dict(row)
    if d:
        d["users"] = {"full_name": d.pop("creator_name", None)}
    return d


@app.post("/announcements/{aid}/acknowledge")
def acknowledge_announcement(aid: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT id FROM announcements WHERE id = ?", (aid,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Announcement not found")
    now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    with cursor() as c:
        c.execute(
            "INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, acknowledged_at) VALUES (?, ?, ?)",
            (aid, user_id, now_iso),
        )
    with cursor() as c:
        c.execute("SELECT COUNT(*) FROM announcement_reads WHERE announcement_id = ?", (aid,))
        count = c.fetchone()[0]
    total_staff = _get_total_staff_count()
    return {"acknowledged": True, "acknowledged_count": count, "total_staff": total_staff}


@app.get("/announcements/{aid}/read-receipts")
def list_announcement_read_receipts(aid: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("SELECT id FROM announcements WHERE id = ?", (aid,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Announcement not found")
        c.execute("""
            SELECT ar.user_id, ar.acknowledged_at, u.full_name, u.email
            FROM announcement_reads ar
            JOIN users u ON ar.user_id = u.id
            WHERE ar.announcement_id = ?
            ORDER BY ar.acknowledged_at DESC
        """, (aid,))
        rows = c.fetchall()
    return [row_to_dict(r) for r in rows]


@app.delete("/announcements/{aid}")
def delete_announcement(aid: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("DELETE FROM announcements WHERE id = ?", (aid,))
    return {"ok": True}


# ---------- Branches ----------
@app.get("/branches")
def list_branches(_: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM branches ORDER BY name")
        return [row_to_dict(r) for r in c.fetchall()]


class BranchCreate(BaseModel):
    name: str
    code: str
    address: str | None = None


@app.post("/branches")
def create_branch(req: BranchCreate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    bid = new_id()
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute("INSERT INTO branches (id, name, code, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", (bid, req.name, req.code, req.address or "", now, now))
    with cursor() as c:
        c.execute("SELECT * FROM branches WHERE id = ?", (bid,))
        return row_to_dict(c.fetchone())


class BranchUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    address: str | None = None


@app.patch("/branches/{bid}")
def update_branch(bid: str, req: BranchUpdate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        if req.name is not None:
            c.execute("UPDATE branches SET name = ?, updated_at = ? WHERE id = ?", (req.name, datetime.utcnow().isoformat(), bid))
        if req.code is not None:
            c.execute("UPDATE branches SET code = ?, updated_at = ? WHERE id = ?", (req.code, datetime.utcnow().isoformat(), bid))
        if req.address is not None:
            c.execute("UPDATE branches SET address = ?, updated_at = ? WHERE id = ?", (req.address, datetime.utcnow().isoformat(), bid))
    with cursor() as c:
        c.execute("SELECT * FROM branches WHERE id = ?", (bid,))
        return row_to_dict(c.fetchone())


@app.delete("/branches/{bid}")
def delete_branch(bid: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("DELETE FROM branches WHERE id = ?", (bid,))
    return {"ok": True}


# ---------- Recognitions ----------
# Posts use created_at (UTC). Retention = five inclusive Mon–Fri days from that calendar date (weekend posts count from next Mon).
RECOGNITION_RETENTION_WORKING_DAYS = 5
RECOGNITION_TYPES = ["Teamwork", "Innovation", "Customer focus", "Going the extra mile", "Leadership", "Support", "Other"]


def _parse_recognition_created_utc_date(created_at_iso: str) -> date:
    """UTC calendar date for a recognition row's created_at ISO string."""
    raw = (created_at_iso or "").strip()
    if not raw:
        return datetime.now(timezone.utc).date()
    try:
        if raw.endswith("Z"):
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date()
    except ValueError:
        if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
            try:
                return date.fromisoformat(raw[:10])
            except ValueError:
                pass
        return datetime.now(timezone.utc).date()


def _recognition_retention_end_date(post_utc_date: date) -> date:
    """Last calendar day the post is kept: the Nth working day (Mon–Fri), inclusive, from post_utc_date."""
    n = RECOGNITION_RETENTION_WORKING_DAYS
    wd_count = 0
    cur = post_utc_date
    while True:
        if cur.weekday() < 5:
            wd_count += 1
            if wd_count >= n:
                return cur
        cur += timedelta(days=1)


def _recognition_retention_expired(created_at_iso: str, today_utc: date) -> bool:
    last_kept = _recognition_retention_end_date(_parse_recognition_created_utc_date(created_at_iso))
    return today_utc > last_kept


def _purge_expired_recognitions() -> int:
    """Delete recognitions past working-day retention; CASCADE removes likes/comments.
    Also removes old recognition @mention bell rows (no FK to recognitions)."""
    today_utc = datetime.now(timezone.utc).date()
    try:
        with cursor() as c:
            c.execute("SELECT id, created_at FROM recognitions")
            rows = c.fetchall()
            to_delete = [row[0] for row in rows if _recognition_retention_expired(row[1], today_utc)]
            for rid in to_delete:
                c.execute("DELETE FROM recognitions WHERE id = ?", (rid,))
            if to_delete:
                c.execute(
                    "DELETE FROM notifications WHERE kind = ? AND datetime(created_at) < datetime('now', '-14 days')",
                    ("recognition_mention",),
                )
        return len(to_delete)
    except Exception as e:
        logger.warning("Recognition retention purge failed: %s", e)
        return 0
# Same @token shape as the recognition UI (full name after @, optional spaces inside the name).
_RECOGNITION_MENTION_RE = re.compile(r"@([^\s@]+(?:\s+[^\s@]+)*)")


def _active_users_for_mention_match():
    with cursor() as c:
        c.execute("SELECT id, full_name, email FROM users WHERE is_active = 1")
        rows = c.fetchall()
    return [{"id": r[0], "full_name": (r[1] or "").strip(), "email": (r[2] or "").strip()} for r in rows]


def _user_id_for_recognition_mention(users: list[dict], mention_raw: str) -> str | None:
    """Match @mention text to a user: exact full_name (case-insensitive), else email prefix (like the frontend)."""
    m = (mention_raw or "").strip().lower()
    if not m:
        return None
    for u in users:
        fn = (u.get("full_name") or "").strip().lower()
        if fn and fn == m:
            return u["id"]
    for u in users:
        em = (u.get("email") or "").strip().lower()
        if em and em.startswith(m):
            return u["id"]
    return None


def _notify_recognition_mentions(actor_id: str, text: str, *, recognition_id: str, is_comment: bool):
    """Create in-app notifications for employees @tagged in a recognition post or comment."""
    if not (text or "").strip() or not (recognition_id or "").strip():
        return
    slugs = []
    for match in _RECOGNITION_MENTION_RE.finditer(text):
        s = (match.group(1) or "").strip()
        if s:
            slugs.append(s)
    if not slugs:
        return
    users = _active_users_for_mention_match()
    actor = (actor_id or "").strip()
    seen: set[str] = set()
    actor_name = _employee_display_name(actor) if actor else "Someone"
    title = "You were mentioned in a recognition comment" if is_comment else "You were mentioned in recognition"
    snippet = (text or "").replace("\n", " ").strip()
    if len(snippet) > 180:
        snippet = snippet[:177] + "..."
    link = "/employee"
    for slug in slugs:
        uid = _user_id_for_recognition_mention(users, slug)
        if not uid or uid == actor or uid in seen:
            continue
        seen.add(uid)
        body = f"{actor_name} tagged you. {snippet}"
        _insert_notification(uid, "recognition_mention", title, body, link)


class RecognitionCreate(BaseModel):
    recognition_type: str
    message: str


class RecognitionCommentCreate(BaseModel):
    body: str


@app.get("/recognitions/types")
def list_recognition_types(_: str = Depends(get_current_user_id)):
    _purge_expired_recognitions()
    return RECOGNITION_TYPES


@app.post("/recognitions")
def create_recognition(req: RecognitionCreate, from_user_id: str = Depends(get_current_user_id)):
    _purge_expired_recognitions()
    msg = (req.message or "").strip()
    if not msg or len(msg) > 2000:
        raise HTTPException(status_code=400, detail="Message required (max 2000 chars)")
    rtype = (req.recognition_type or "").strip() or "Other"
    if rtype not in RECOGNITION_TYPES:
        rtype = "Other"
    rid = new_id()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    with cursor() as c:
        c.execute(
            "INSERT INTO recognitions (id, from_user_id, to_user_id, message, recognition_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (rid, from_user_id, from_user_id, msg, rtype, now),
        )
    with cursor() as c:
        c.execute(
            """SELECT r.*, u1.full_name as from_name
               FROM recognitions r
               JOIN users u1 ON r.from_user_id = u1.id
               WHERE r.id = ?""",
            (rid,),
        )
        row = c.fetchone()
    d = row_to_dict(row)
    if d:
        d["to_name"] = None
        d["like_count"] = 0
        d["comment_count"] = 0
        d["liked_by_me"] = False
    try:
        _notify_recognition_mentions(from_user_id, msg, recognition_id=rid, is_comment=False)
    except Exception as ex:
        logger.warning("Recognition mention notify failed: %s", ex)
    return d


@app.get("/recognitions")
def list_recognitions(limit: int = 50, user_id: str = Depends(get_current_user_id)):
    _purge_expired_recognitions()
    with cursor() as c:
        c.execute(
            """SELECT r.*, u1.full_name as from_name, u2.full_name as to_name
               FROM recognitions r
               JOIN users u1 ON r.from_user_id = u1.id
               LEFT JOIN users u2 ON r.to_user_id = u2.id AND r.to_user_id != r.from_user_id
               ORDER BY r.created_at DESC LIMIT ?""",
            (min(limit, 100),),
        )
        rows = c.fetchall()
    recs = [row_to_dict(r) for r in rows]
    for rec in recs:
        rec.setdefault("recognition_type", "Other")
        rec.setdefault("to_name", None)
    with cursor() as c:
        for rec in recs:
            rid = rec.get("id")
            c.execute("SELECT COUNT(*) FROM recognition_likes WHERE recognition_id = ?", (rid,))
            rec["like_count"] = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM recognition_comments WHERE recognition_id = ?", (rid,))
            rec["comment_count"] = c.fetchone()[0]
            c.execute("SELECT 1 FROM recognition_likes WHERE recognition_id = ? AND user_id = ?", (rid, user_id))
            rec["liked_by_me"] = c.fetchone() is not None
    return recs


@app.post("/recognitions/{rid}/like")
def toggle_recognition_like(rid: str, user_id: str = Depends(get_current_user_id)):
    _purge_expired_recognitions()
    with cursor() as c:
        c.execute("SELECT id FROM recognitions WHERE id = ?", (rid,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Recognition not found")
        c.execute("SELECT 1 FROM recognition_likes WHERE recognition_id = ? AND user_id = ?", (rid, user_id))
        exists = c.fetchone()
        if exists:
            c.execute("DELETE FROM recognition_likes WHERE recognition_id = ? AND user_id = ?", (rid, user_id))
            liked = False
        else:
            c.execute("INSERT INTO recognition_likes (recognition_id, user_id, created_at) VALUES (?, ?, ?)", (rid, user_id, datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")))
            liked = True
        c.execute("SELECT COUNT(*) FROM recognition_likes WHERE recognition_id = ?", (rid,))
        count = c.fetchone()[0]
    return {"liked": liked, "like_count": count}


@app.get("/recognitions/{rid}/comments")
def list_recognition_comments(rid: str, _: str = Depends(get_current_user_id)):
    _purge_expired_recognitions()
    with cursor() as c:
        c.execute("SELECT id FROM recognitions WHERE id = ?", (rid,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Recognition not found")
        c.execute(
            """SELECT c.*, u.full_name as user_name
               FROM recognition_comments c
               JOIN users u ON c.user_id = u.id
               WHERE c.recognition_id = ?
               ORDER BY c.created_at ASC""",
            (rid,),
        )
        rows = c.fetchall()
    return [row_to_dict(r) for r in rows]


@app.post("/recognitions/{rid}/comments")
def create_recognition_comment(rid: str, req: RecognitionCommentCreate, user_id: str = Depends(get_current_user_id)):
    _purge_expired_recognitions()
    body = (req.body or "").strip()
    if not body or len(body) > 1000:
        raise HTTPException(status_code=400, detail="Comment required (max 1000 chars)")
    with cursor() as c:
        c.execute("SELECT id FROM recognitions WHERE id = ?", (rid,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Recognition not found")
    cid = new_id()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    with cursor() as c:
        c.execute(
            "INSERT INTO recognition_comments (id, recognition_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (cid, rid, user_id, body, now),
        )
    with cursor() as c:
        c.execute(
            """SELECT c.*, u.full_name as user_name FROM recognition_comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?""",
            (cid,),
        )
        row_out = c.fetchone()
    out = row_to_dict(row_out) if row_out else None
    try:
        _notify_recognition_mentions(user_id, body, recognition_id=rid, is_comment=True)
    except Exception as ex:
        logger.warning("Recognition comment mention notify failed: %s", ex)
    return out


@app.get("/reports/recognitions")
def report_recognitions(
    limit: int = 100,
    from_date: str | None = None,
    to_date: str | None = None,
    current_user_id: str = Depends(get_current_user_id),
):
    """Recognition report for HR/Admin: counts by type, recent recognitions."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    _purge_expired_recognitions()
    with cursor() as c:
        c.execute("SELECT COUNT(*) FROM recognitions")
        total_count = c.fetchone()[0]
        c.execute(
            """SELECT COALESCE(recognition_type, 'Other') as recognition_type, COUNT(*) as count
               FROM recognitions GROUP BY COALESCE(recognition_type, 'Other') ORDER BY count DESC"""
        )
        by_type = [{"recognition_type": row[0], "count": row[1]} for row in c.fetchall()]
        c.execute(
            """SELECT r.id, r.recognition_type, r.message, r.created_at, u.full_name as from_name
               FROM recognitions r JOIN users u ON r.from_user_id = u.id
               ORDER BY r.created_at DESC LIMIT ?""",
            (min(limit, 200),),
        )
        rows = c.fetchall()
    recent = []
    for row in rows:
        d = row_to_dict(row)
        if from_date and (d.get("created_at") or "")[:10] < from_date[:10]:
            continue
        if to_date and (d.get("created_at") or "")[:10] > to_date[:10]:
            continue
        with cursor() as c2:
            c2.execute("SELECT COUNT(*) FROM recognition_likes WHERE recognition_id = ?", (d["id"],))
            d["like_count"] = c2.fetchone()[0]
            c2.execute("SELECT COUNT(*) FROM recognition_comments WHERE recognition_id = ?", (d["id"],))
            d["comment_count"] = c2.fetchone()[0]
        recent.append(d)
    return {"total_count": total_count, "by_type": by_type, "recent": recent}


@app.get("/reports/appraisal-performance")
def report_appraisal_performance(
    cycle_id: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    current_user_id: str = Depends(get_current_user_id),
):
    """HR/Admin: KPI and appraisal pipeline for one appraisal cycle (defaults to active, else latest)."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")

    cy_id = (cycle_id or "").strip() or None
    td = to_date or datetime.utcnow().strftime("%Y-%m-%d")
    fd = from_date or (datetime.utcnow() - timedelta(days=180)).strftime("%Y-%m-%d")
    _parse_yyyy_mm_dd(fd)
    _parse_yyyy_mm_dd(td)
    if td < fd:
        raise HTTPException(status_code=400, detail="to_date cannot be before from_date")

    with cursor() as c:
        if cy_id:
            c.execute("SELECT * FROM appraisal_cycles WHERE id = ?", (cy_id,))
            crow = c.fetchone()
            if not crow:
                raise HTTPException(status_code=404, detail="Cycle not found")
        else:
            c.execute("SELECT * FROM appraisal_cycles WHERE status = 'active' ORDER BY created_at DESC LIMIT 1")
            crow = c.fetchone()
            if not crow:
                c.execute("SELECT * FROM appraisal_cycles ORDER BY year DESC, created_at DESC LIMIT 1")
                crow = c.fetchone()
        if not crow:
            return {
                "cycle": None,
                "cycles": [],
                "kpi_by_status": [],
                "kpi_by_staff": [],
                "appraisal_by_status": [],
                "appraisal_by_staff": [],
                "staff_in_scope": 0,
                "note": "No appraisal cycles yet. Create one under HR → Appraisal.",
            }
        cy_id = crow["id"]
        c.execute(
            """
            SELECT id, type, year, quarter, status, start_date, end_date
            FROM appraisal_cycles
            ORDER BY year DESC, created_at DESC
            LIMIT 36
            """
        )
        cycles = [row_to_dict(x) for x in c.fetchall()]
        cycle = row_to_dict(crow)

        c.execute(
            """
            SELECT status, COUNT(*) AS n
            FROM kpis
            WHERE cycle_id = ?
              AND substr(COALESCE(updated_at, created_at, ''), 1, 10) >= ?
              AND substr(COALESCE(updated_at, created_at, ''), 1, 10) <= ?
            GROUP BY status
            """,
            (cy_id, fd, td),
        )
        kpi_by_status = [{"status": row[0], "count": int(row[1] or 0)} for row in c.fetchall()]

        c.execute(
            """
            SELECT u.id AS user_id, u.full_name, u.email,
              COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS department,
              COALESCE(TRIM(u.role), '') AS role,
              COUNT(k.id) AS kpi_count,
              COALESCE(SUM(CASE WHEN k.status = 'draft' THEN 1 ELSE 0 END), 0) AS kpi_draft,
              COALESCE(SUM(CASE WHEN k.status = 'pending_supervisor' THEN 1 ELSE 0 END), 0) AS kpi_pending_supervisor,
              COALESCE(SUM(CASE WHEN k.status = 'returned' THEN 1 ELSE 0 END), 0) AS kpi_returned,
              COALESCE(SUM(CASE WHEN k.status = 'verified' THEN 1 ELSE 0 END), 0) AS kpi_verified,
              COALESCE(SUM(CASE WHEN k.status = 'approved' THEN 1 ELSE 0 END), 0) AS kpi_approved,
              COALESCE(SUM(CASE WHEN k.status = 'received' THEN 1 ELSE 0 END), 0) AS kpi_received,
              COALESCE(SUM(CASE WHEN k.status = 'acknowledged' THEN 1 ELSE 0 END), 0) AS kpi_acknowledged
            FROM users u
            LEFT JOIN kpis k
              ON k.user_id = u.id
             AND k.cycle_id = ?
             AND substr(COALESCE(k.updated_at, k.created_at, ''), 1, 10) >= ?
             AND substr(COALESCE(k.updated_at, k.created_at, ''), 1, 10) <= ?
            WHERE u.is_active = 1 AND COALESCE(TRIM(u.role), '') != 'admin'
            GROUP BY u.id
            ORDER BY u.full_name COLLATE NOCASE
            LIMIT 600
            """,
            (cy_id, fd, td),
        )
        kpi_by_staff = [row_to_dict(x) for x in c.fetchall()]

        c.execute(
            """
            SELECT status, COUNT(*) AS n
            FROM appraisals
            WHERE cycle_id = ?
              AND substr(COALESCE(updated_at, created_at, ''), 1, 10) >= ?
              AND substr(COALESCE(updated_at, created_at, ''), 1, 10) <= ?
            GROUP BY status
            """,
            (cy_id, fd, td),
        )
        appraisal_by_status = [{"status": row[0], "count": int(row[1] or 0)} for row in c.fetchall()]

        c.execute(
            """
            SELECT u.id AS user_id, u.full_name, u.email,
              COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS department,
              COALESCE(TRIM(u.role), '') AS role,
              COUNT(a.id) AS appraisal_count,
              COALESCE(SUM(CASE WHEN a.status = 'draft' THEN 1 ELSE 0 END), 0) AS ap_draft,
              COALESCE(SUM(CASE WHEN a.status = 'pending_supervisor' THEN 1 ELSE 0 END), 0) AS ap_pending_supervisor,
              COALESCE(SUM(CASE WHEN a.status = 'returned' THEN 1 ELSE 0 END), 0) AS ap_returned,
              COALESCE(SUM(CASE WHEN a.status = 'verified' THEN 1 ELSE 0 END), 0) AS ap_verified,
              COALESCE(SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END), 0) AS ap_approved,
              COALESCE(SUM(CASE WHEN a.status = 'received' THEN 1 ELSE 0 END), 0) AS ap_received,
              COALESCE(SUM(CASE WHEN a.status = 'acknowledged' THEN 1 ELSE 0 END), 0) AS ap_acknowledged
            FROM users u
            LEFT JOIN appraisals a
              ON a.user_id = u.id
             AND a.cycle_id = ?
             AND substr(COALESCE(a.updated_at, a.created_at, ''), 1, 10) >= ?
             AND substr(COALESCE(a.updated_at, a.created_at, ''), 1, 10) <= ?
            WHERE u.is_active = 1 AND COALESCE(TRIM(u.role), '') != 'admin'
            GROUP BY u.id
            ORDER BY u.full_name COLLATE NOCASE
            LIMIT 600
            """,
            (cy_id, fd, td),
        )
        appraisal_by_staff = [row_to_dict(x) for x in c.fetchall()]

        c.execute(
            """
            SELECT COUNT(*) FROM users u
            WHERE u.is_active = 1 AND COALESCE(TRIM(u.role), '') != 'admin'
            """
        )
        staff_in_scope = int((c.fetchone() or [0])[0] or 0)

    return {
        "cycle": cycle,
        "cycles": cycles,
        "kpi_by_status": kpi_by_status,
        "kpi_by_staff": kpi_by_staff,
        "appraisal_by_status": appraisal_by_status,
        "appraisal_by_staff": appraisal_by_staff,
        "staff_in_scope": staff_in_scope,
        "period": {"from_date": fd, "to_date": td},
        "note": "Per-employee rows include everyone in scope (active, non-admin); KPI/appraisal counts are for the selected cycle and selected date range (updated_at/created_at). draft = not submitted; pending_supervisor = in supervisor chain; verified = chain done pending HR approve on KPI; approved/received/acknowledged = HR pipeline and staff acknowledgement.",
    }


# ---------- Audit ----------
@app.get("/admin/system-report")
def admin_system_report(user_id: str = Depends(get_current_user_id)):
    _require_roles(user_id, ("admin",))
    now = datetime.utcnow()
    uptime_seconds = max(int((now - APP_STARTED_AT).total_seconds()), 0)
    db_size_bytes = 0
    try:
        db_size_bytes = int(os.path.getsize(os.path.abspath(DB_PATH)))
    except Exception:
        db_size_bytes = 0

    with cursor() as c:
        c.execute("SELECT COUNT(*) FROM users WHERE is_active = 1")
        users_active = int((c.fetchone() or [0])[0] or 0)
        c.execute("SELECT COUNT(*) FROM users WHERE is_active = 0")
        users_inactive = int((c.fetchone() or [0])[0] or 0)
        c.execute("SELECT COUNT(*) FROM attendance_logs WHERE clock_out_at IS NULL")
        open_attendance_sessions = int((c.fetchone() or [0])[0] or 0)

        c.execute(
            """
            SELECT COUNT(*) FROM audit_logs
            WHERE action = 'auth_login_success'
              AND substr(created_at, 1, 10) = ?
            """,
            (now.strftime("%Y-%m-%d"),),
        )
        logins_today = int((c.fetchone() or [0])[0] or 0)
        c.execute(
            """
            SELECT COUNT(*) FROM audit_logs
            WHERE action = 'auth_login_success'
              AND substr(created_at, 1, 10) >= ?
            """,
            ((now - timedelta(days=7)).strftime("%Y-%m-%d"),),
        )
        logins_last_7_days = int((c.fetchone() or [0])[0] or 0)
        c.execute(
            """
            SELECT al.id, al.user_id, al.action, al.details, al.created_at, u.full_name AS user_name, u.email AS user_email
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.action = 'auth_login_success'
            ORDER BY al.created_at DESC
            LIMIT 50
            """
        )
        recent_login_rows = [row_to_dict(r) for r in c.fetchall()]
        c.execute(
            """
            SELECT COUNT(*) FROM audit_logs
            WHERE action = 'attendance_clockin_blocked'
              AND substr(created_at, 1, 10) = ?
            """,
            (now.strftime("%Y-%m-%d"),),
        )
        blocked_today = int((c.fetchone() or [0])[0] or 0)
        c.execute(
            """
            SELECT COUNT(*) FROM audit_logs
            WHERE action = 'attendance_clockin_blocked'
              AND substr(created_at, 1, 10) >= ?
            """,
            ((now - timedelta(days=7)).strftime("%Y-%m-%d"),),
        )
        blocked_last_7_days = int((c.fetchone() or [0])[0] or 0)
        c.execute(
            """
            SELECT al.id, al.user_id, al.details, al.created_at, u.full_name AS user_name, u.email AS user_email
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.action = 'attendance_clockin_blocked'
            ORDER BY al.created_at DESC
            LIMIT 50
            """
        )
        recent_block_rows = [row_to_dict(r) for r in c.fetchall()]

    recent_logins = []
    for r in recent_login_rows:
        details = r.get("details")
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except Exception:
                details = {"raw": details}
        recent_logins.append(
            {
                "id": r.get("id"),
                "created_at": r.get("created_at"),
                "user": {
                    "id": r.get("user_id"),
                    "full_name": r.get("user_name"),
                    "email": r.get("user_email"),
                },
                "identifier": (details or {}).get("identifier"),
                "login_method": (details or {}).get("login_method"),
            }
        )

    recent_security_alerts = []
    for r in recent_block_rows:
        details = r.get("details")
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except Exception:
                details = {"raw": details}
        recent_security_alerts.append(
            {
                "id": r.get("id"),
                "created_at": r.get("created_at"),
                "user": {
                    "id": r.get("user_id"),
                    "full_name": r.get("user_name"),
                    "email": r.get("user_email"),
                },
                "reason": (details or {}).get("reason") or "blocked",
                "client_ip": (details or {}).get("client_ip"),
                "cooldown_minutes": (details or {}).get("cooldown_minutes"),
            }
        )

    return {
        "generated_at": now.isoformat(),
        "health": {"status": "ok", "db_reachable": True},
        "uptime": {"started_at": APP_STARTED_AT.isoformat(), "seconds": uptime_seconds},
        "system": {
            "users_active": users_active,
            "users_inactive": users_inactive,
            "open_attendance_sessions": open_attendance_sessions,
            "db_size_bytes": db_size_bytes,
        },
        "logins": {
            "today": logins_today,
            "last_7_days": logins_last_7_days,
            "recent": recent_logins,
        },
        "security": {
            "blocked_clockins_today": blocked_today,
            "blocked_clockins_last_7_days": blocked_last_7_days,
            "recent_blocked_clockins": recent_security_alerts,
        },
    }


@app.get("/audit")
def list_audit(limit: int = 100, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("""
            SELECT al.*, u.full_name as user_name, u.email as user_email FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id ORDER BY al.created_at DESC LIMIT ?
        """, (limit,))
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["users"] = {"full_name": d.pop("user_name", None), "email": d.pop("user_email", None)}
            out.append(d)
    return out


class AuditCreate(BaseModel):
    action: str
    resource: str | None = None
    resource_id: str | None = None
    details: dict | None = None


@app.post("/audit")
def create_audit(req: AuditCreate, user_id: str = Depends(get_current_user_id)):
    aid = new_id()
    details_str = json.dumps(req.details) if req.details else None
    with cursor() as c:
        c.execute(
            "INSERT INTO audit_logs (id, user_id, action, resource, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)",
            (aid, user_id, req.action, req.resource, req.resource_id, details_str),
        )
    with cursor() as c:
        c.execute("SELECT * FROM audit_logs WHERE id = ?", (aid,))
        return row_to_dict(c.fetchone())


# ---------- Settings ----------
@app.get("/settings")
def get_settings(_: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT key, value FROM settings")
        rows = c.fetchall()
    out = {}
    for row in rows:
        k, v = row[0], row[1]
        try:
            out[k] = json.loads(v) if isinstance(v, str) and v and v[0] in ("[", "{", '"') else v
        except Exception:
            out[k] = v
    return out


class SettingUpdate(BaseModel):
    key: str
    value: str


@app.patch("/settings")
def set_setting(req: SettingUpdate, user_id: str = Depends(get_current_user_id)):
    key, value = req.key, req.value
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute("INSERT OR REPLACE INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)", (key, value, user_id, now))
    return {"ok": True}


DEFAULT_DEPARTMENTS = [
    "IT Department",
    "Business Department",
    "Operation",
    "Human Resources",
    "CEO offices",
    "Executive Office",
    "Legal",
    "Risk & Compliance",
    "Finance",
    "Credit",
    "Audit",
]


def _department_options() -> list[str]:
    base = [str(x).strip() for x in DEFAULT_DEPARTMENTS if str(x or "").strip()]
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("custom_departments",))
        row = c.fetchone()
    custom: list[str] = []
    if row and row[0] is not None:
        raw = str(row[0]).strip()
        try:
            parsed = json.loads(raw) if raw else []
            if isinstance(parsed, list):
                custom = [str(x).strip() for x in parsed if str(x or "").strip()]
        except Exception:
            custom = []
    out: list[str] = []
    seen: set[str] = set()
    for name in base + custom:
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


class DepartmentCreate(BaseModel):
    name: str


@app.get("/departments/options")
def list_department_options(user_id: str = Depends(get_current_user_id)):
    _require_roles(user_id, ("admin", "hr"))
    return {"rows": _department_options()}


@app.post("/departments")
def create_department(req: DepartmentCreate, user_id: str = Depends(get_current_user_id)):
    _require_roles(user_id, ("admin", "hr"))
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Department name is required")
    rows = _department_options()
    if any((x or "").strip().casefold() == name.casefold() for x in rows):
        return {"ok": True, "rows": rows, "created": False}
    base_set = {str(x).strip().casefold() for x in DEFAULT_DEPARTMENTS if str(x or "").strip()}
    custom = [x for x in rows if x.casefold() not in base_set]
    custom.append(name)
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)",
            ("custom_departments", json.dumps(custom), user_id, now),
        )
    return {"ok": True, "rows": _department_options(), "created": True}


class AdminCleanupRequest(BaseModel):
    target: str = Field(..., description="One of: notifications, audit_logs")
    older_than_days: int = Field(..., ge=1, le=3650)
    confirm_text: str = Field(..., description="Safety confirmation phrase")


def _cleanup_rules(target: str) -> dict:
    t = (target or "").strip().lower()
    if t == "notifications":
        return {
            "target": "notifications",
            "table": "notifications",
            "created_at_col": "created_at",
            "min_days": 30,
            "confirm_text": "CLEAR NOTIFICATIONS",
        }
    if t == "audit_logs":
        return {
            "target": "audit_logs",
            "table": "audit_logs",
            "created_at_col": "created_at",
            "min_days": 90,
            "confirm_text": "CLEAR AUDIT",
        }
    raise HTTPException(status_code=400, detail="Unsupported cleanup target")


def _cleanup_candidate_count(table: str, created_at_col: str, older_than_days: int) -> int:
    with cursor() as c:
        c.execute(
            f"SELECT COUNT(*) FROM {table} WHERE datetime(COALESCE({created_at_col}, '')) < datetime('now', ?)",
            (f"-{int(older_than_days)} days",),
        )
        row = c.fetchone()
    return int(row[0] or 0) if row else 0


def _archive_cleanup_rows(target: str, older_than_days: int, actor_user_id: str, rows: list[dict]) -> str:
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    archive_dir = os.path.join(UPLOAD_DIR, "maintenance-archives")
    os.makedirs(archive_dir, exist_ok=True)
    filename = f"{target}-older-than-{older_than_days}d-{ts}.json"
    full_path = os.path.join(archive_dir, filename)
    payload = {
        "target": target,
        "older_than_days": int(older_than_days),
        "archived_at": datetime.utcnow().isoformat() + "Z",
        "archived_by_user_id": actor_user_id,
        "row_count": len(rows),
        "rows": rows,
    }
    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=True, indent=2)
    return f"maintenance-archives/{filename}"


@app.get("/admin/data-maintenance/summary")
def admin_data_maintenance_summary(
    notifications_days: int = Query(30, ge=1, le=3650),
    audit_days: int = Query(180, ge=1, le=3650),
    user_id: str = Depends(get_current_user_id),
):
    _require_roles(user_id, ("admin",))
    n_rules = _cleanup_rules("notifications")
    a_rules = _cleanup_rules("audit_logs")
    n_days = max(int(notifications_days), int(n_rules["min_days"]))
    a_days = max(int(audit_days), int(a_rules["min_days"]))
    return {
        "notifications": {
            "min_days": n_rules["min_days"],
            "effective_days": n_days,
            "confirm_text": n_rules["confirm_text"],
            "eligible_rows": _cleanup_candidate_count(n_rules["table"], n_rules["created_at_col"], n_days),
        },
        "audit_logs": {
            "min_days": a_rules["min_days"],
            "effective_days": a_days,
            "confirm_text": a_rules["confirm_text"],
            "eligible_rows": _cleanup_candidate_count(a_rules["table"], a_rules["created_at_col"], a_days),
        },
    }


@app.post("/admin/data-maintenance/cleanup")
def admin_data_maintenance_cleanup(req: AdminCleanupRequest, user_id: str = Depends(get_current_user_id)):
    _require_roles(user_id, ("admin",))
    rules = _cleanup_rules(req.target)
    days = int(req.older_than_days)
    if days < int(rules["min_days"]):
        raise HTTPException(status_code=400, detail=f"Minimum retention is {rules['min_days']} days")
    if (req.confirm_text or "").strip() != rules["confirm_text"]:
        raise HTTPException(status_code=400, detail=f"Type exact confirmation: {rules['confirm_text']}")

    table = rules["table"]
    created_col = rules["created_at_col"]
    with cursor() as c:
        c.execute(
            f"SELECT * FROM {table} WHERE datetime(COALESCE({created_col}, '')) < datetime('now', ?)",
            (f"-{days} days",),
        )
        rows = [row_to_dict(r) for r in c.fetchall()]
    rows = [r for r in rows if r]
    archive_rel_path = _archive_cleanup_rows(rules["target"], days, user_id, rows)

    deleted = 0
    with cursor() as c:
        c.execute(
            f"DELETE FROM {table} WHERE datetime(COALESCE({created_col}, '')) < datetime('now', ?)",
            (f"-{days} days",),
        )
        deleted = int(c.rowcount or 0)

    _audit_log(
        "admin_data_cleanup",
        table,
        user_id,
        None,
        {
            "target": rules["target"],
            "older_than_days": days,
            "deleted_rows": deleted,
            "archive_file": archive_rel_path,
        },
    )
    return {
        "ok": True,
        "target": rules["target"],
        "older_than_days": days,
        "deleted_rows": deleted,
        "archive_file": archive_rel_path,
    }


# ---------- Appraisal module ----------
def _appraisal_user_role(user_id: str) -> str:
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    return (r[0] or "employee") if r else "employee"


def _appraisal_require_roles(user_id: str, allowed: list):
    role = _appraisal_user_role(user_id)
    if role not in allowed:
        raise HTTPException(status_code=403, detail="Forbidden")
    return role


def _appraisal_active_cycle():
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE status = 'active' ORDER BY created_at DESC LIMIT 1")
        return row_to_dict(c.fetchone())


def _appraisal_log(ref_type: str, ref_id: str, action: str, from_user_id: str, from_role: str, to_role: str | None = None):
    with cursor() as c:
        c.execute(
            "INSERT INTO workflow_logs (id, reference_type, reference_id, action, from_user_id, from_role, to_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id(), ref_type, ref_id, action, from_user_id, from_role, to_role, datetime.utcnow().isoformat() + "Z"),
        )


class AppraisalCycleCreate(BaseModel):
    type: str  # annual | quarterly
    year: int
    quarter: str | None = None  # Q1-Q4 for quarterly
    start_date: str
    end_date: str
    status: str = "draft"


class AppraisalCycleUpdate(BaseModel):
    type: str | None = None
    year: int | None = None
    quarter: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str | None = None


@app.get("/appraisal/cycles")
def appraisal_list_cycles(user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles ORDER BY year DESC, quarter DESC, created_at DESC")
        rows = c.fetchall()
    return [row_to_dict(r) for r in rows if row_to_dict(r)]


@app.post("/appraisal/cycles")
def appraisal_create_cycle(req: AppraisalCycleCreate, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr"])
    if req.type not in ("annual", "quarterly"):
        raise HTTPException(status_code=400, detail="Type must be annual or quarterly")
    if req.type == "quarterly" and (not req.quarter or req.quarter not in ("Q1", "Q2", "Q3", "Q4")):
        raise HTTPException(status_code=400, detail="Quarter required for quarterly (Q1-Q4)")
    if req.status not in ("draft", "active", "closed"):
        req = req.model_copy(update={"status": "draft"})
    if req.status == "active":
        with cursor() as c:
            c.execute("SELECT id FROM appraisal_cycles WHERE status = 'active' LIMIT 1")
            if c.fetchone():
                raise HTTPException(status_code=400, detail="Only one active cycle allowed. Close the current active cycle first.")
    cid = new_id()
    with cursor() as c:
        c.execute(
            "INSERT INTO appraisal_cycles (id, type, year, quarter, start_date, end_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, req.type, req.year, req.quarter, req.start_date, req.end_date, getattr(req, "status", "draft"), datetime.utcnow().isoformat(), datetime.utcnow().isoformat()),
        )
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ?", (cid,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/cycles/{cycle_id}")
def appraisal_get_cycle(cycle_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ?", (cycle_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return row_to_dict(row)


@app.patch("/appraisal/cycles/{cycle_id}")
def appraisal_update_cycle(cycle_id: str, req: AppraisalCycleUpdate, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ?", (cycle_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Cycle not found")
    d = row_to_dict(row)
    updates = {}
    if req.type is not None:
        updates["type"] = req.type
    if req.year is not None:
        updates["year"] = req.year
    if req.quarter is not None:
        updates["quarter"] = req.quarter
    if req.start_date is not None:
        updates["start_date"] = req.start_date
    if req.end_date is not None:
        updates["end_date"] = req.end_date
    if req.status is not None:
        if req.status == "active":
            with cursor() as c:
                c.execute("SELECT id FROM appraisal_cycles WHERE status = 'active' AND id != ?", (cycle_id,))
                if c.fetchone():
                    raise HTTPException(status_code=400, detail="Only one active cycle allowed")
        updates["status"] = req.status
    if not updates:
        return d
    updates["updated_at"] = datetime.utcnow().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with cursor() as c:
        c.execute(f"UPDATE appraisal_cycles SET {set_clause} WHERE id = ?", (*updates.values(), cycle_id))
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ?", (cycle_id,))
        return row_to_dict(c.fetchone())


# KPIs
class KPICreate(BaseModel):
    cycle_id: str
    title: str
    description: str | None = None
    target: str | None = None
    weight: float | None = None


class KPIUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    target: str | None = None
    weight: float | None = None


@app.get("/appraisal/cycles/{cycle_id}/kpis")
def appraisal_list_kpis(cycle_id: str, user_id: str = Depends(get_current_user_id)):
    role = _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ?", (cycle_id,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Cycle not found")
    with cursor() as c:
        if role in ("admin", "hr"):
            c.execute("SELECT k.*, u.full_name as user_name FROM kpis k LEFT JOIN users u ON k.user_id = u.id WHERE k.cycle_id = ? ORDER BY u.full_name, k.created_at", (cycle_id,))
        else:
            c.execute("SELECT k.*, u.full_name as user_name FROM kpis k LEFT JOIN users u ON k.user_id = u.id WHERE k.cycle_id = ? AND k.user_id = ? ORDER BY k.created_at", (cycle_id, user_id))
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["user_name"] = d.pop("user_name", None)
            out.append(d)
    return out


@app.post("/appraisal/kpis")
def appraisal_create_kpi(req: KPICreate, user_id: str = Depends(get_current_user_id)):
    """Logged-in staff create their own KPIs for an open cycle; blocked when the calendar year is closed (reopen via HR/Admin cycle status)."""
    _appraisal_require_roles(user_id, ["admin", "hr", "employee", "manager", "hod"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ? AND status IN ('active', 'draft')", (req.cycle_id,))
        cy_row = c.fetchone()
    if not cy_row:
        raise HTTPException(status_code=400, detail="Cycle not found or not open for KPIs")
    cy_year = int(dict(cy_row).get("year") or 0)
    if _is_year_closed(cy_year):
        raise HTTPException(
            status_code=400,
            detail="This performance year is closed. HR or Admin can set a cycle for this year back to Draft or Active to allow new KPIs.",
        )
    kid = new_id()
    with cursor() as c:
        c.execute(
            "INSERT INTO kpis (id, user_id, cycle_id, title, description, target, weight, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
            (kid, user_id, req.cycle_id, req.title.strip(), (req.description or "").strip() or None, (req.target or "").strip() or None, req.weight, datetime.utcnow().isoformat(), datetime.utcnow().isoformat()),
        )
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kid,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/kpis/{kpi_id}")
def appraisal_get_kpi(kpi_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT k.*, u.full_name as user_name FROM kpis k LEFT JOIN users u ON k.user_id = u.id WHERE k.id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    d = row_to_dict(row)
    if d:
        d["user_name"] = d.pop("user_name", None)
    return d


@app.patch("/appraisal/kpis/{kpi_id}")
def appraisal_update_kpi(kpi_id: str, req: KPIUpdate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    r = dict(row)
    if str(r["user_id"]) != str(user_id):
        _appraisal_require_roles(user_id, ["admin", "hr"])
    status = r.get("status") or "draft"
    if status not in ("draft", "returned"):
        raise HTTPException(
            status_code=400,
            detail="KPIs can only be edited while Draft or Returned. After submission or approval, changes are not allowed.",
        )
    cy_year = _kpi_cycle_year(str(r.get("cycle_id") or ""))
    if _is_year_closed(cy_year):
        raise HTTPException(
            status_code=400,
            detail="This performance year is closed for KPI edits. HR or Admin must reopen a cycle for this year first.",
        )
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        return row_to_dict(row)
    updates["updated_at"] = datetime.utcnow().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with cursor() as c:
        c.execute(f"UPDATE kpis SET {set_clause} WHERE id = ?", (*updates.values(), kpi_id))
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/kpis/{kpi_id}/submit")
def appraisal_submit_kpi(kpi_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    r = dict(row)
    if str(r["user_id"]) != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if r.get("status") not in ("draft", "returned"):
        raise HTTPException(status_code=400, detail="KPI already submitted or beyond")
    cy_year = _kpi_cycle_year(str(r.get("cycle_id") or ""))
    if _is_year_closed(cy_year):
        raise HTTPException(
            status_code=400,
            detail="This performance year is closed. HR or Admin can reopen a cycle for this year before you submit KPIs.",
        )
    now = datetime.utcnow().isoformat()
    owner = str(r["user_id"])
    first = _get_staff_manager_id(owner)
    if not first:
        with cursor() as c:
            c.execute(
                "UPDATE kpis SET status = 'verified', current_approver_id = NULL, updated_at = ? WHERE id = ?",
                (now, kpi_id),
            )
        _appraisal_log("kpi", kpi_id, "submitted_no_supervisor", user_id, _appraisal_user_role(user_id), None)
    else:
        with cursor() as c:
            c.execute(
                "UPDATE kpis SET status = 'pending_supervisor', current_approver_id = ?, updated_at = ? WHERE id = ?",
                (first, now, kpi_id),
            )
        _appraisal_log("kpi", kpi_id, "submitted", user_id, _appraisal_user_role(user_id), "supervisor")
        try:
            _notify_manager_appraisal_submitted(first, owner, "KPI")
        except Exception as ex:
            logger.warning("KPI submit supervisor notify failed: %s", ex)
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        return row_to_dict(c.fetchone())


class ReturnComment(BaseModel):
    comment: str


class SupervisorReviewBody(BaseModel):
    """Required comment when a supervisor completes a review step (forwards in chain or finishes chain)."""
    comment: str = Field(..., min_length=1)


@app.post("/appraisal/kpis/{kpi_id}/return")
def appraisal_return_kpi(kpi_id: str, req: ReturnComment, user_id: str = Depends(get_current_user_id)):
    role = _appraisal_user_role(user_id)
    if role not in ("admin", "hr", "manager", "hod", "employee"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not (req.comment or req.comment.strip()):
        raise HTTPException(status_code=400, detail="Comment required when returning")
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    r = dict(row)
    status = r.get("status") or ""
    cur = (r.get("current_approver_id") or "").strip()
    if status == "pending_supervisor":
        if role not in ("admin", "hr") and str(user_id).strip() != cur:
            raise HTTPException(status_code=403, detail="Only the current supervisor in the chain can return this KPI now")
    elif status == "verified":
        if role not in ("hod", "admin", "hr"):
            raise HTTPException(status_code=403, detail="Only HOD or HR can return a KPI at this stage")
    else:
        raise HTTPException(status_code=400, detail="This KPI cannot be returned in its current status")
    with cursor() as c:
        c.execute(
            "UPDATE kpis SET status = 'returned', current_approver_id = NULL, updated_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), kpi_id),
        )
    wid = new_id()
    with cursor() as c:
        c.execute("INSERT INTO workflow_comments (id, reference_type, reference_id, from_user_id, from_role, comment, created_at) VALUES (?, 'kpi', ?, ?, ?, ?, ?)", (wid, kpi_id, user_id, role, req.comment.strip(), datetime.utcnow().isoformat() + "Z"))
    _appraisal_log("kpi", kpi_id, "returned", user_id, role, "staff")
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/kpis/{kpi_id}/verify")
def appraisal_verify_kpi(kpi_id: str, req: SupervisorReviewBody, user_id: str = Depends(get_current_user_id)):
    """Supervisor chain: direct manager first, then each manager's manager, each step requires a comment (same order as leave approvals)."""
    role = _appraisal_user_role(user_id)
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    r = dict(row)
    if (r.get("status") or "") != "pending_supervisor":
        raise HTTPException(status_code=400, detail="This KPI is not waiting on a supervisor review step")
    cur = (r.get("current_approver_id") or "").strip()
    owner = str(r["user_id"])
    if role not in ("admin", "hr") and str(user_id).strip() != cur:
        raise HTTPException(status_code=403, detail="Only the assigned supervisor can complete this review step")
    comment = (req.comment or "").strip()
    wid = new_id()
    now = datetime.utcnow().isoformat() + "Z"
    fr = role
    with cursor() as c:
        c.execute(
            "INSERT INTO workflow_comments (id, reference_type, reference_id, from_user_id, from_role, comment, created_at) VALUES (?, 'kpi', ?, ?, ?, ?, ?)",
            (wid, kpi_id, user_id, fr, comment, now),
        )
    next_id = _next_leave_approver_after_step(user_id, owner)
    if next_id:
        with cursor() as c:
            c.execute(
                "UPDATE kpis SET current_approver_id = ?, updated_at = ? WHERE id = ?",
                (next_id, datetime.utcnow().isoformat(), kpi_id),
            )
        _appraisal_log("kpi", kpi_id, "supervisor_step", user_id, fr, "next_supervisor")
        try:
            _notify_manager_appraisal_submitted(next_id, owner, "KPI (next reviewer)")
        except Exception as ex:
            logger.warning("KPI chain notify failed: %s", ex)
    else:
        with cursor() as c:
            c.execute(
                "UPDATE kpis SET status = 'verified', current_approver_id = NULL, updated_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), kpi_id),
            )
        _appraisal_log("kpi", kpi_id, "supervisor_chain_complete", user_id, fr, "hod")
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/kpis/{kpi_id}/approve")
def appraisal_approve_kpi(kpi_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod"])
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    if (row["status"] or "") != "verified":
        raise HTTPException(status_code=400, detail="Only verified KPIs can be approved")
    with cursor() as c:
        c.execute("UPDATE kpis SET status = 'approved', updated_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), kpi_id))
    _appraisal_log("kpi", kpi_id, "approved", user_id, _appraisal_user_role(user_id), "hr")
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/kpis/{kpi_id}/receive")
def appraisal_receive_kpi(kpi_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr"])
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    if (row["status"] or "") != "approved":
        raise HTTPException(status_code=400, detail="Only approved KPIs can be received")
    with cursor() as c:
        c.execute("UPDATE kpis SET status = 'received', updated_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), kpi_id))
    _appraisal_log("kpi", kpi_id, "received", user_id, _appraisal_user_role(user_id), "staff")
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/kpis/{kpi_id}/acknowledge")
def appraisal_acknowledge_kpi(kpi_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI not found")
    if str(row["user_id"]) != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if (row["status"] or "") != "received":
        raise HTTPException(status_code=400, detail="Only received KPIs can be acknowledged")
    with cursor() as c:
        c.execute("UPDATE kpis SET status = 'acknowledged', updated_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), kpi_id))
    aid = new_id()
    now = datetime.utcnow().isoformat() + "Z"
    with cursor() as c:
        c.execute("INSERT INTO acknowledgements (id, reference_type, reference_id, user_id, acknowledged_at, created_at) VALUES (?, 'kpi', ?, ?, ?, ?)", (aid, kpi_id, user_id, now, now))
    _appraisal_log("kpi", kpi_id, "acknowledged", user_id, _appraisal_user_role(user_id), None)
    with cursor() as c:
        c.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/kpis/{kpi_id}/workflow")
def appraisal_kpi_workflow(kpi_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM workflow_logs WHERE reference_type = 'kpi' AND reference_id = ? ORDER BY created_at", (kpi_id,))
        logs = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
        c.execute("SELECT * FROM workflow_comments WHERE reference_type = 'kpi' AND reference_id = ? ORDER BY created_at", (kpi_id,))
        comments = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    return {"logs": logs, "comments": comments}


# Appraisals (self-assessment)
class AppraisalCreate(BaseModel):
    cycle_id: str
    achievements: str | None = None
    challenges: str | None = None
    overall_comments: str | None = None


class AppraisalUpdate(BaseModel):
    achievements: str | None = None
    challenges: str | None = None
    overall_comments: str | None = None


class AppraisalKpiAssessment(BaseModel):
    kpi_id: str
    self_assessment: str | None = None


class AppraisalScoreUpdate(BaseModel):
    self_score: float | None = None
    self_comment: str | None = None
    supervisor_score: float | None = None
    supervisor_comment: str | None = None
    agreed_score: float | None = None
    hod_comment: str | None = None


@app.get("/appraisal/cycles/{cycle_id}/appraisals")
def appraisal_list_appraisals(cycle_id: str, user_id: str = Depends(get_current_user_id)):
    role = _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ?", (cycle_id,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Cycle not found")
    with cursor() as c:
        if role in ("admin", "hr"):
            c.execute("SELECT a.*, u.full_name as user_name FROM appraisals a LEFT JOIN users u ON a.user_id = u.id WHERE a.cycle_id = ? ORDER BY u.full_name", (cycle_id,))
        else:
            c.execute("SELECT a.*, u.full_name as user_name FROM appraisals a LEFT JOIN users u ON a.user_id = u.id WHERE a.cycle_id = ? AND a.user_id = ?", (cycle_id, user_id))
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["user_name"] = d.pop("user_name", None)
            out.append(d)
    return out


@app.post("/appraisal/appraisals")
def appraisal_create_appraisal(req: AppraisalCreate, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "employee", "manager", "hod"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE id = ? AND status IN ('active', 'draft')", (req.cycle_id,))
        cycle = c.fetchone()
    if not cycle:
        raise HTTPException(status_code=400, detail="Cycle not found or not open")
    with cursor() as c:
        c.execute("SELECT id FROM appraisals WHERE user_id = ? AND cycle_id = ?", (user_id, req.cycle_id))
        if c.fetchone():
            raise HTTPException(status_code=400, detail="Appraisal already exists for this cycle")
    aid = new_id()
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute(
            "INSERT INTO appraisals (id, user_id, cycle_id, status, achievements, challenges, overall_comments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (aid, user_id, req.cycle_id, "draft", req.achievements or "", req.challenges or "", req.overall_comments or "", now, now),
        )
    # Seed appraisal_scores from locked annual KPIs when cycle has a quarter (quarterly appraisal)
    cycle_year = cycle["year"]
    cycle_quarter = cycle.get("quarter")
    if cycle_quarter:
        with cursor() as c:
            c.execute("SELECT id FROM appraisal_annual_kpis WHERE user_id = ? AND year = ? AND status = 'locked'", (user_id, cycle_year))
            annual_row = c.fetchone()
        if annual_row:
            with cursor() as c:
                c.execute(
                    "SELECT i.id FROM appraisal_kpi_items i JOIN appraisal_kpi_titles t ON i.kpi_title_id = t.id WHERE t.annual_kpi_id = ? ORDER BY t.sort_order, t.created_at, i.sort_order, i.created_at",
                    (annual_row["id"],),
                )
                item_ids = [r["id"] for r in c.fetchall()]
            for kpi_item_id in item_ids:
                sid = new_id()
                with cursor() as c:
                    c.execute(
                        "INSERT INTO appraisal_scores (id, appraisal_id, kpi_item_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (sid, aid, kpi_item_id, now, now),
                    )
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (aid,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/appraisals/{appraisal_id}")
def appraisal_get_appraisal(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT a.*, u.full_name as user_name FROM appraisals a LEFT JOIN users u ON a.user_id = u.id WHERE a.id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    d = row_to_dict(row)
    if d:
        d["user_name"] = d.pop("user_name", None)
        with cursor() as c2:
            c2.execute("SELECT * FROM appraisal_kpi_assessments WHERE appraisal_id = ?", (appraisal_id,))
            d["assessments"] = [row_to_dict(r) for r in c2.fetchall() if row_to_dict(r)]
        with cursor() as c2:
            c2.execute(
                "SELECT s.*, i.description, i.weight, i.target FROM appraisal_scores s JOIN appraisal_kpi_items i ON s.kpi_item_id = i.id WHERE s.appraisal_id = ? ORDER BY i.sort_order, i.created_at",
                (appraisal_id,),
            )
            d["scores"] = [row_to_dict(r) for r in c2.fetchall() if row_to_dict(r)]
    return d


@app.patch("/appraisal/appraisals/{appraisal_id}/scores/{kpi_item_id}")
def appraisal_update_score(appraisal_id: str, kpi_item_id: str, req: AppraisalScoreUpdate, user_id: str = Depends(get_current_user_id)):
    role = _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT a.*, cy.status as cycle_status FROM appraisals a JOIN appraisal_cycles cy ON a.cycle_id = cy.id WHERE a.id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    if (row["cycle_status"] or "") != "active":
        raise HTTPException(status_code=400, detail="Scores can only be entered when cycle is Active")
    appr = dict(row)
    is_owner = str(row["user_id"]) == str(user_id)
    app_status = appr.get("status") or ""
    updates = {}
    if req.self_score is not None:
        if not is_owner and role not in ("admin", "hr"):
            raise HTTPException(status_code=403, detail="Only staff can set self score")
        if is_owner and role not in ("admin", "hr") and app_status not in ("draft", "returned"):
            raise HTTPException(status_code=400, detail="Self scores can only be edited while appraisal is draft or returned")
        updates["self_score"] = max(0, min(100, req.self_score))
    if req.self_comment is not None:
        if not is_owner and role not in ("admin", "hr"):
            raise HTTPException(status_code=403, detail="Only staff can set self comment")
        if is_owner and role not in ("admin", "hr") and app_status not in ("draft", "returned"):
            raise HTTPException(status_code=400, detail="Self comments can only be edited while appraisal is draft or returned")
        updates["self_comment"] = (req.self_comment or "").strip() or None
    if req.supervisor_score is not None:
        if is_owner and role not in ("admin", "hr"):
            raise HTTPException(status_code=403, detail="Only supervisor can set supervisor score")
        if not _can_edit_supervisor_appraisal_scores(user_id, role, appr):
            raise HTTPException(status_code=403, detail="Only the assigned supervisor (or HR/Admin) can set supervisor scores at this step")
        updates["supervisor_score"] = max(0, min(100, req.supervisor_score))
    if req.supervisor_comment is not None:
        if is_owner and role not in ("admin", "hr"):
            raise HTTPException(status_code=403, detail="Only supervisor can set supervisor comment")
        if not _can_edit_supervisor_appraisal_scores(user_id, role, appr):
            raise HTTPException(status_code=403, detail="Only the assigned supervisor (or HR/Admin) can set supervisor comments at this step")
        updates["supervisor_comment"] = (req.supervisor_comment or "").strip() or None
    if req.agreed_score is not None:
        if is_owner and role not in ("admin", "hr"):
            raise HTTPException(status_code=403, detail="Only supervisor can set agreed score")
        if not _can_edit_supervisor_appraisal_scores(user_id, role, appr):
            raise HTTPException(status_code=403, detail="Only the assigned supervisor (or HR/Admin) can set agreed scores at this step")
        updates["agreed_score"] = max(0, min(100, req.agreed_score))
    if req.hod_comment is not None:
        _appraisal_require_roles(user_id, ["admin", "hr", "hod"])
        updates["hod_comment"] = (req.hod_comment or "").strip() or None
    if not updates:
        with cursor() as c:
            c.execute("SELECT * FROM appraisal_scores WHERE appraisal_id = ? AND kpi_item_id = ?", (appraisal_id, kpi_item_id))
            r = c.fetchone()
        return row_to_dict(r) if r else None
    updates["updated_at"] = datetime.utcnow().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with cursor() as c:
        c.execute(f"UPDATE appraisal_scores SET {set_clause} WHERE appraisal_id = ? AND kpi_item_id = ?", (*updates.values(), appraisal_id, kpi_item_id))
    _appraisal_recalc_total(appraisal_id)
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_scores WHERE appraisal_id = ? AND kpi_item_id = ?", (appraisal_id, kpi_item_id))
        r = c.fetchone()
    return row_to_dict(r)


@app.patch("/appraisal/appraisals/{appraisal_id}")
def appraisal_update_appraisal(appraisal_id: str, req: AppraisalUpdate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    r = dict(row)
    if str(r["user_id"]) != str(user_id):
        _appraisal_require_roles(user_id, ["admin", "hr"])
    status = r.get("status") or "draft"
    if status not in ("draft", "returned"):
        raise HTTPException(status_code=400, detail="Cannot edit appraisal in current status")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        return row_to_dict(row)
    updates["updated_at"] = datetime.utcnow().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with cursor() as c:
        c.execute(f"UPDATE appraisals SET {set_clause} WHERE id = ?", (*updates.values(), appraisal_id))
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.put("/appraisal/appraisals/{appraisal_id}/assessments")
def appraisal_put_assessments(appraisal_id: str, assessments: list[AppraisalKpiAssessment], user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    if str(row["user_id"]) != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if (row["status"] or "") not in ("draft", "returned"):
        raise HTTPException(status_code=400, detail="Cannot edit assessments in current status")
    with cursor() as c:
        c.execute("DELETE FROM appraisal_kpi_assessments WHERE appraisal_id = ?", (appraisal_id,))
        for a in assessments:
            aid = new_id()
            c.execute("INSERT INTO appraisal_kpi_assessments (id, appraisal_id, kpi_id, self_assessment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", (aid, appraisal_id, a.kpi_id, (a.self_assessment or "").strip() or None, datetime.utcnow().isoformat(), datetime.utcnow().isoformat()))
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/appraisals/{appraisal_id}/submit")
def appraisal_submit_appraisal(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    if str(row["user_id"]) != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if (row["status"] or "") not in ("draft", "returned"):
        raise HTTPException(status_code=400, detail="Appraisal already submitted or beyond")
    now = datetime.utcnow().isoformat()
    owner_id = str(row["user_id"])
    first = _get_staff_manager_id(owner_id)
    if not first:
        with cursor() as c:
            c.execute(
                "UPDATE appraisals SET status = 'verified', current_approver_id = NULL, updated_at = ? WHERE id = ?",
                (now, appraisal_id),
            )
        _appraisal_log("appraisal", appraisal_id, "submitted_no_supervisor", user_id, _appraisal_user_role(user_id), None)
    else:
        with cursor() as c:
            c.execute(
                "UPDATE appraisals SET status = 'pending_supervisor', current_approver_id = ?, updated_at = ? WHERE id = ?",
                (first, now, appraisal_id),
            )
        _appraisal_log("appraisal", appraisal_id, "submitted", user_id, _appraisal_user_role(user_id), "supervisor")
        try:
            _notify_manager_appraisal_submitted(first, owner_id, "Appraisal")
        except Exception as ex:
            logger.warning("Appraisal submit supervisor notify failed: %s", ex)
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/appraisals/{appraisal_id}/return")
def appraisal_return_appraisal(appraisal_id: str, req: ReturnComment, user_id: str = Depends(get_current_user_id)):
    role = _appraisal_user_role(user_id)
    if role not in ("admin", "hr", "manager", "hod", "employee"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not (req.comment or req.comment.strip()):
        raise HTTPException(status_code=400, detail="Comment required when returning")
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    ar = dict(row)
    status = ar.get("status") or ""
    cur = (ar.get("current_approver_id") or "").strip()
    if status == "pending_supervisor":
        if role not in ("admin", "hr") and str(user_id).strip() != cur:
            raise HTTPException(status_code=403, detail="Only the current supervisor in the chain can return this appraisal now")
    elif status == "verified":
        if role not in ("hod", "admin", "hr"):
            raise HTTPException(status_code=403, detail="Only HOD or HR can return an appraisal at this stage")
    else:
        raise HTTPException(status_code=400, detail="This appraisal cannot be returned in its current status")
    with cursor() as c:
        c.execute(
            "UPDATE appraisals SET status = 'returned', current_approver_id = NULL, employee_agreed_scores_at = NULL, updated_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), appraisal_id),
        )
    wid = new_id()
    with cursor() as c:
        c.execute("INSERT INTO workflow_comments (id, reference_type, reference_id, from_user_id, from_role, comment, created_at) VALUES (?, 'appraisal', ?, ?, ?, ?, ?)", (wid, appraisal_id, user_id, role, req.comment.strip(), datetime.utcnow().isoformat() + "Z"))
    _appraisal_log("appraisal", appraisal_id, "returned", user_id, role, "staff")
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/appraisals/{appraisal_id}/verify")
def appraisal_verify_appraisal(appraisal_id: str, req: SupervisorReviewBody, user_id: str = Depends(get_current_user_id)):
    """Supervisor chain with comments at each level (same manager chain as leave)."""
    role = _appraisal_user_role(user_id)
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    r = dict(row)
    if (r.get("status") or "") != "pending_supervisor":
        raise HTTPException(status_code=400, detail="This appraisal is not waiting on a supervisor review step")
    cur = (r.get("current_approver_id") or "").strip()
    owner = str(r["user_id"])
    if role not in ("admin", "hr") and str(user_id).strip() != cur:
        raise HTTPException(status_code=403, detail="Only the assigned supervisor can complete this review step")
    comment = (req.comment or "").strip()
    wid = new_id()
    now = datetime.utcnow().isoformat() + "Z"
    with cursor() as c:
        c.execute(
            "INSERT INTO workflow_comments (id, reference_type, reference_id, from_user_id, from_role, comment, created_at) VALUES (?, 'appraisal', ?, ?, ?, ?, ?)",
            (wid, appraisal_id, user_id, role, comment, now),
        )
    next_id = _next_leave_approver_after_step(user_id, owner)
    if next_id:
        with cursor() as c:
            c.execute(
                "UPDATE appraisals SET current_approver_id = ?, updated_at = ? WHERE id = ?",
                (next_id, datetime.utcnow().isoformat(), appraisal_id),
            )
        _appraisal_log("appraisal", appraisal_id, "supervisor_step", user_id, role, "next_supervisor")
        try:
            _notify_manager_appraisal_submitted(next_id, owner, "Appraisal (next reviewer)")
        except Exception as ex:
            logger.warning("Appraisal chain notify failed: %s", ex)
    else:
        with cursor() as c:
            c.execute(
                "UPDATE appraisals SET status = 'verified', current_approver_id = NULL, updated_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), appraisal_id),
            )
        _appraisal_log("appraisal", appraisal_id, "supervisor_chain_complete", user_id, role, "hod")
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/appraisals/{appraisal_id}/approve")
def appraisal_approve_appraisal(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    if (row["status"] or "") != "verified":
        raise HTTPException(status_code=400, detail="Only verified appraisals can be approved")
    if _appraisal_needs_employee_score_agreement(appraisal_id):
        if not _appraisal_all_agreed_scores_filled(appraisal_id):
            raise HTTPException(
                status_code=400,
                detail="All KPI lines must have an agreed % (set by the supervisor) before HOD/HR can approve.",
            )
        if not dict(row).get("employee_agreed_scores_at"):
            raise HTTPException(
                status_code=400,
                detail="Employee must confirm agreement with the agreed scores (My Appraisals) before this appraisal can be approved.",
            )
    with cursor() as c:
        c.execute("UPDATE appraisals SET status = 'approved', updated_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), appraisal_id))
    _appraisal_log("appraisal", appraisal_id, "approved", user_id, _appraisal_user_role(user_id), "hr")
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/appraisals/{appraisal_id}/receive")
def appraisal_receive_appraisal(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    if (row["status"] or "") != "approved":
        raise HTTPException(status_code=400, detail="Only approved appraisals can be received")
    with cursor() as c:
        c.execute("UPDATE appraisals SET status = 'received', updated_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), appraisal_id))
    _appraisal_log("appraisal", appraisal_id, "received", user_id, _appraisal_user_role(user_id), "staff")
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/appraisals/{appraisal_id}/acknowledge")
def appraisal_acknowledge_appraisal(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    if str(row["user_id"]) != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if (row["status"] or "") != "received":
        raise HTTPException(status_code=400, detail="Only received appraisals can be acknowledged")
    with cursor() as c:
        c.execute("UPDATE appraisals SET status = 'acknowledged', updated_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), appraisal_id))
    aid = new_id()
    now = datetime.utcnow().isoformat() + "Z"
    with cursor() as c:
        c.execute("INSERT INTO acknowledgements (id, reference_type, reference_id, user_id, acknowledged_at, created_at) VALUES (?, 'appraisal', ?, ?, ?, ?)", (aid, appraisal_id, user_id, now, now))
    _appraisal_log("appraisal", appraisal_id, "acknowledged", user_id, _appraisal_user_role(user_id), None)
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/appraisals/{appraisal_id}/workflow")
def appraisal_appraisal_workflow(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM workflow_logs WHERE reference_type = 'appraisal' AND reference_id = ? ORDER BY created_at", (appraisal_id,))
        logs = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
        c.execute("SELECT * FROM workflow_comments WHERE reference_type = 'appraisal' AND reference_id = ? ORDER BY created_at", (appraisal_id,))
        comments = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    return {"logs": logs, "comments": comments}


def _appraisal_user_can_view_appraisal(user_id: str, role: str, appr: dict) -> bool:
    if role in ("admin", "hr"):
        return True
    if str(appr.get("user_id")) == str(user_id):
        return True
    if role == "hod":
        return True
    if role == "manager":
        with cursor() as c:
            c.execute("SELECT manager_id FROM users WHERE id = ?", (str(appr.get("user_id")),))
            r = c.fetchone()
        mid = (r[0] or "").strip() if r and r[0] else ""
        return mid == str(user_id).strip()
    return False


@app.post("/appraisal/appraisals/{appraisal_id}/confirm-agreed-scores")
def appraisal_confirm_agreed_scores(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    """Employee confirms they agree with supervisor-entered agreed % on each KPI line (required before HOD approval when scores exist)."""
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    appr = dict(row)
    if str(appr.get("user_id")) != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if (appr.get("status") or "") != "verified":
        raise HTTPException(status_code=400, detail="Appraisal must be supervisor-verified before you can confirm agreed scores")
    if not _appraisal_needs_employee_score_agreement(appraisal_id):
        raise HTTPException(status_code=400, detail="This appraisal has no scored KPI lines to confirm")
    if not _appraisal_all_agreed_scores_filled(appraisal_id):
        raise HTTPException(status_code=400, detail="Supervisor must enter agreed % on every KPI line before you can confirm")
    now = datetime.utcnow().isoformat() + "Z"
    with cursor() as c:
        c.execute("UPDATE appraisals SET employee_agreed_scores_at = ?, updated_at = ? WHERE id = ?", (now, datetime.utcnow().isoformat(), appraisal_id))
    _appraisal_log("appraisal", appraisal_id, "employee_confirmed_agreed_scores", user_id, "employee", None)
    with cursor() as c:
        c.execute("SELECT * FROM appraisals WHERE id = ?", (appraisal_id,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/appraisals/{appraisal_id}/agreed-summary")
def appraisal_agreed_summary(appraisal_id: str, user_id: str = Depends(get_current_user_id)):
    """HTML summary of agreed appraisal (for print / Save as PDF). Staff (own), manager, HOD, HR."""
    role = _appraisal_user_role(user_id)
    with cursor() as c:
        c.execute(
            "SELECT a.*, u.full_name as staff_name, u.email as staff_email, cy.year, cy.quarter, cy.type as cycle_type, cy.start_date as cycle_start, cy.end_date as cycle_end "
            "FROM appraisals a JOIN users u ON a.user_id = u.id JOIN appraisal_cycles cy ON a.cycle_id = cy.id WHERE a.id = ?",
            (appraisal_id,),
        )
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    appr = dict(row)
    if not _appraisal_user_can_view_appraisal(user_id, role, appr):
        raise HTTPException(status_code=403, detail="Forbidden")
    st = appr.get("status") or ""
    if st not in ("verified", "approved", "received", "acknowledged"):
        raise HTTPException(status_code=400, detail="Summary is available after supervisor verification and agreed scores are set")
    if _appraisal_needs_employee_score_agreement(appraisal_id) and not appr.get("employee_agreed_scores_at") and role not in ("admin", "hr", "hod"):
        raise HTTPException(status_code=400, detail="Employee must confirm agreed scores before downloading this summary")
    with cursor() as c:
        c.execute(
            "SELECT s.*, i.description, i.weight, i.target FROM appraisal_scores s "
            "JOIN appraisal_kpi_items i ON s.kpi_item_id = i.id WHERE s.appraisal_id = ? ORDER BY i.sort_order, i.created_at",
            (appraisal_id,),
        )
        scores = [dict(r) for r in c.fetchall()]
    period = f"{appr.get('year')}"
    if (appr.get("cycle_type") or "") == "quarterly" and appr.get("quarter"):
        period = f"{appr.get('year')} {appr.get('quarter')}"
    esc = html.escape
    rows_html = ""
    for s in scores:
        rows_html += (
            f"<tr><td>{esc(str(s.get('description') or ''))}</td>"
            f"<td>{esc(str(s.get('target') or ''))}</td>"
            f"<td>{s.get('weight') or ''}</td>"
            f"<td>{s.get('self_score') if s.get('self_score') is not None else '—'}</td>"
            f"<td>{s.get('supervisor_score') if s.get('supervisor_score') is not None else '—'}</td>"
            f"<td><strong>{s.get('agreed_score') if s.get('agreed_score') is not None else '—'}</strong></td>"
            f"<td>{s.get('weighted_score') if s.get('weighted_score') is not None else '—'}</td></tr>"
        )
    body = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Appraisal {esc(period)}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:900px;margin:24px;}}table{{border-collapse:collapse;width:100%;}}th,td{{border:1px solid #ccc;padding:8px;text-align:left;}}th{{background:#f5f5f5;}}</style></head><body>
<h1>Performance appraisal (agreed record)</h1>
<p><strong>Period:</strong> {esc(period)} &nbsp; <strong>Cycle:</strong> {esc(str(appr.get('cycle_start') or ''))} – {esc(str(appr.get('cycle_end') or ''))}</p>
<p><strong>Employee:</strong> {esc(str(appr.get('staff_name') or ''))} ({esc(str(appr.get('staff_email') or ''))})</p>
<p><strong>Status:</strong> {esc(st)} &nbsp; <strong>Total score:</strong> {appr.get('total_score') if appr.get('total_score') is not None else '—'} &nbsp; <strong>Rating:</strong> {esc(str(appr.get('rating') or '—'))}</p>
<p><strong>Achievements:</strong><br>{esc(str(appr.get('achievements') or '—'))}</p>
<p><strong>Challenges:</strong><br>{esc(str(appr.get('challenges') or '—'))}</p>
<p><strong>Overall comments:</strong><br>{esc(str(appr.get('overall_comments') or '—'))}</p>
<h2>KPI scores (agreed %)</h2>
<table><thead><tr><th>KPI</th><th>Target</th><th>Weight %</th><th>Self %</th><th>Supervisor %</th><th>Agreed %</th><th>Weighted</th></tr></thead><tbody>{rows_html or '<tr><td colspan="7">No score lines</td></tr>'}</tbody></table>
<p style="margin-top:48px;"><strong>Employee signature</strong> _________________________ &nbsp; Date _________</p>
<p><strong>Supervisor signature</strong> _________________________ &nbsp; Date _________</p>
<p style="font-size:12px;color:#666;">Generated from CopeDu Staff Clock Tracker. Print this page or use Print → Save as PDF.</p>
</body></html>"""

    return HTMLResponse(content=body)


# Dashboards
def _get_staff_manager_id(uid: str):
    uid_clean = (uid or "").strip()
    if not uid_clean:
        return None
    with cursor() as c:
        c.execute("SELECT manager_id FROM users WHERE id = ?", (uid_clean,))
        r = c.fetchone()
    if not r or r[0] is None:
        return None
    return (str(r[0]) or "").strip() or None


def _get_staff_department(uid: str):
    with cursor() as c:
        c.execute("SELECT department FROM users WHERE id = ?", (uid,))
        r = c.fetchone()
    return (r[0] or "").strip() if r else ""


def _get_hod_for_department(dept: str):
    if not dept:
        return None
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE role = 'hod' AND department = ? AND (is_active = 1 OR is_active IS NULL) LIMIT 1", (dept,))
        r = c.fetchone()
    return r[0] if r else None


@app.get("/appraisal/dashboard/staff")
def appraisal_dashboard_staff(user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    active = _appraisal_active_cycle()
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles WHERE status IN ('active', 'draft') ORDER BY year DESC, quarter DESC")
        cycles = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles ORDER BY year DESC, quarter DESC")
        all_cycles = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute("SELECT k.*, c.type as cycle_type, c.year, c.quarter FROM kpis k JOIN appraisal_cycles c ON k.cycle_id = c.id WHERE k.user_id = ? ORDER BY c.year DESC, c.quarter DESC, k.created_at", (user_id,))
        kpis = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute("SELECT a.*, c.type as cycle_type, c.year, c.quarter FROM appraisals a JOIN appraisal_cycles c ON a.cycle_id = c.id WHERE a.user_id = ? ORDER BY c.year DESC, c.quarter DESC", (user_id,))
        appraisals = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute("SELECT * FROM acknowledgements WHERE user_id = ? ORDER BY acknowledged_at DESC", (user_id,))
        acks = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    closed_years = list({c["year"] for c in all_cycles if (c.get("status") or "") == "closed"})
    return {"active_cycle": active, "cycles": cycles, "all_cycles": all_cycles, "closed_years": closed_years, "kpis": kpis, "appraisals": appraisals, "acknowledgements": acks}


@app.get("/appraisal/dashboard/manager")
def appraisal_dashboard_manager(user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "manager"])
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE manager_id = ?", (user_id,))
        reportee_ids = [r[0] for r in c.fetchall()]
    with cursor() as c:
        c.execute(
            """
            SELECT k.*, u.full_name as user_name, c.type as cycle_type, c.year, c.quarter,
                   c.start_date as cycle_start_date, c.end_date as cycle_end_date
            FROM kpis k
            JOIN users u ON k.user_id = u.id
            JOIN appraisal_cycles c ON k.cycle_id = c.id
            WHERE k.status = 'pending_supervisor'
              AND LOWER(TRIM(COALESCE(k.current_approver_id, ''))) = LOWER(?)
            ORDER BY k.updated_at
            """,
            (user_id,),
        )
        kpis = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute(
            """
            SELECT a.*, u.full_name as user_name, c.type as cycle_type, c.year, c.quarter,
                   c.start_date as cycle_start_date, c.end_date as cycle_end_date
            FROM appraisals a
            JOIN users u ON a.user_id = u.id
            JOIN appraisal_cycles c ON a.cycle_id = c.id
            WHERE a.status = 'pending_supervisor'
              AND LOWER(TRIM(COALESCE(a.current_approver_id, ''))) = LOWER(?)
            ORDER BY a.updated_at
            """,
            (user_id,),
        )
        appraisals = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    if not reportee_ids:
        returned_k, returned_a = [], []
    else:
        placeholders = ",".join("?" * len(reportee_ids))
        with cursor() as c:
            c.execute(
                f"SELECT k.*, u.full_name as user_name FROM kpis k JOIN users u ON k.user_id = u.id WHERE k.user_id IN ({placeholders}) AND k.status = 'returned'",
                reportee_ids,
            )
            returned_k = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
            c.execute(
                f"SELECT a.*, u.full_name as user_name FROM appraisals a JOIN users u ON a.user_id = u.id WHERE a.user_id IN ({placeholders}) AND a.status = 'returned'",
                reportee_ids,
            )
            returned_a = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    return {"kpis_pending_verify": kpis, "appraisals_pending_verify": appraisals, "returned_kpis": returned_k, "returned_appraisals": returned_a}


@app.get("/appraisal/dashboard/hod")
def appraisal_dashboard_hod(user_id: str = Depends(get_current_user_id)):
    """HOD sees their reporting line (``manager_id`` = HOD), not the whole organisation department."""
    _appraisal_require_roles(user_id, ["admin", "hr", "hod"])
    with cursor() as c:
        c.execute(
            "SELECT id FROM users WHERE (is_active = 1 OR is_active IS NULL) AND manager_id = ?",
            (user_id,),
        )
        team_user_ids = [x[0] for x in c.fetchall()]
    if not team_user_ids:
        empty = []
        return {
            "kpis_pending_approve": [],
            "appraisals_pending_approve": [],
            "team_overview": empty,
            "department_overview": empty,
        }
    placeholders = ",".join("?" * len(team_user_ids))
    with cursor() as c:
        c.execute(
            f"SELECT k.*, u.full_name as user_name FROM kpis k JOIN users u ON k.user_id = u.id "
            f"WHERE k.user_id IN ({placeholders}) AND k.status = 'verified' ORDER BY k.updated_at",
            team_user_ids,
        )
        kpis = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute(
            f"SELECT a.*, u.full_name as user_name, cy.year, cy.quarter, cy.type as cycle_type FROM appraisals a "
            f"JOIN users u ON a.user_id = u.id JOIN appraisal_cycles cy ON a.cycle_id = cy.id "
            f"WHERE a.user_id IN ({placeholders}) AND a.status = 'verified' ORDER BY a.updated_at",
            team_user_ids,
        )
        appraisals = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    overview = []
    with cursor() as c:
        for uid in team_user_ids:
            c.execute("SELECT full_name FROM users WHERE id = ?", (uid,))
            name_row = c.fetchone()
            c.execute("SELECT COUNT(*) FROM kpis WHERE user_id = ? AND status = 'acknowledged'", (uid,))
            k_count = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM appraisals WHERE user_id = ? AND status = 'acknowledged'", (uid,))
            a_count = c.fetchone()[0]
            overview.append({"user_id": uid, "full_name": name_row[0] if name_row else "", "kpis_acknowledged": k_count, "appraisals_acknowledged": a_count})
    return {
        "kpis_pending_approve": kpis,
        "appraisals_pending_approve": appraisals,
        "team_overview": overview,
        "department_overview": overview,
    }


@app.get("/appraisal/dashboard/hr")
def appraisal_dashboard_hr(user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles ORDER BY year DESC, quarter DESC")
        cycles = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute("SELECT k.*, u.full_name as user_name, u.department FROM kpis k JOIN users u ON k.user_id = u.id WHERE k.status IN ('approved', 'received', 'acknowledged') ORDER BY k.updated_at DESC")
        kpis = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute(
            "SELECT a.*, u.full_name as user_name, u.department, cy.year, cy.quarter, cy.type as cycle_type "
            "FROM appraisals a JOIN users u ON a.user_id = u.id JOIN appraisal_cycles cy ON a.cycle_id = cy.id "
            "WHERE a.status IN ('approved', 'received', 'acknowledged') ORDER BY a.updated_at DESC"
        )
        appraisals = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute(
            "SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a JOIN users u ON a.user_id = u.id WHERE a.status = 'approved_hod' ORDER BY a.year DESC, a.updated_at"
        )
        annual_ready_to_lock = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    for d in annual_ready_to_lock:
        d["user_name"] = d.pop("user_name", None)
    with cursor() as c:
        c.execute(
            "SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a JOIN users u ON a.user_id = u.id WHERE a.status = 'locked' ORDER BY a.year DESC, a.updated_at"
        )
        annual_kpis_locked = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    for d in annual_kpis_locked:
        d["user_name"] = d.pop("user_name", None)
    return {"cycles": cycles, "kpis": kpis, "appraisals": appraisals, "annual_kpis_ready_to_lock": annual_ready_to_lock, "annual_kpis_locked": annual_kpis_locked}


@app.get("/appraisal/export")
def appraisal_export(cycle_id: str | None = None, department: str | None = None, period_type: str | None = None, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_cycles ORDER BY year DESC, quarter DESC")
        all_cycles = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    cycles = all_cycles
    if cycle_id:
        cycles = [c for c in all_cycles if c.get("id") == cycle_id]
    if period_type:
        cycles = [c for c in cycles if (c.get("type") or "") == period_type]
    cycle_ids = [c["id"] for c in cycles]
    if not cycle_ids:
        return {"cycles": [], "kpis": [], "appraisals": []}
    ph = ",".join("?" * len(cycle_ids))
    with cursor() as c:
        c.execute(f"SELECT k.*, u.full_name as user_name, u.department FROM kpis k JOIN users u ON k.user_id = u.id WHERE k.cycle_id IN ({ph}) AND k.status = 'acknowledged'", cycle_ids)
        kpis = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    with cursor() as c:
        c.execute(f"SELECT a.*, u.full_name as user_name, u.department FROM appraisals a JOIN users u ON a.user_id = u.id WHERE a.cycle_id IN ({ph}) AND a.status = 'acknowledged'", cycle_ids)
        appraisals = [row_to_dict(r) for r in c.fetchall() if row_to_dict(r)]
    if department:
        kpis = [k for k in kpis if (k.get("department") or "") == department]
        appraisals = [a for a in appraisals if (a.get("department") or "") == department]
    return {"cycles": cycles, "kpis": kpis, "appraisals": appraisals}


# ---------- Appraisal: Annual KPIs + rating (single appraisal module) ----------
def _appraisal_rating_from_score(score: float | None) -> str:
    """Automatic rating from total score. No manual override."""
    if score is None:
        return ""
    if score >= 101:
        return "Excellent"
    if score >= 80:
        return "Very Good"
    if score >= 70:
        return "Good"
    if score >= 60:
        return "Average"
    return "Poor"


def _appraisal_annual_total_weight(annual_kpi_id: str) -> float:
    with cursor() as c:
        c.execute(
            "SELECT COALESCE(SUM(i.weight), 0) FROM appraisal_kpi_items i "
            "JOIN appraisal_kpi_titles t ON i.kpi_title_id = t.id WHERE t.annual_kpi_id = ?",
            (annual_kpi_id,),
        )
        r = c.fetchone()
    return float(r[0] or 0)


def _appraisal_recalc_total(appraisal_id: str):
    """Recalc weighted_score per appraisal_scores row, then appraisals.total_score and rating."""
    with cursor() as c:
        c.execute(
            "SELECT s.id, s.agreed_score, i.weight FROM appraisal_scores s "
            "JOIN appraisal_kpi_items i ON s.kpi_item_id = i.id WHERE s.appraisal_id = ?",
            (appraisal_id,),
        )
        rows = c.fetchall()
    total = 0.0
    now = datetime.utcnow().isoformat()
    for row in rows:
        agreed = row[1] if row[1] is not None else 0
        weight = float(row[2] or 0)
        weighted = weight * (agreed / 100.0) if agreed else 0
        total += weighted
        with cursor() as c:
            c.execute("UPDATE appraisal_scores SET weighted_score = ?, updated_at = ? WHERE id = ?", (weighted, now, row[0]))
    rating = _appraisal_rating_from_score(total)
    with cursor() as c:
        c.execute("UPDATE appraisals SET total_score = ?, rating = ?, updated_at = ? WHERE id = ?", (total, rating, now, appraisal_id))


def _appraisal_score_rows_list(appraisal_id: str) -> list[dict]:
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_scores WHERE appraisal_id = ?", (appraisal_id,))
        return [dict(r) for r in c.fetchall()]


def _appraisal_all_agreed_scores_filled(appraisal_id: str) -> bool:
    rows = _appraisal_score_rows_list(appraisal_id)
    if not rows:
        return False
    return all(r.get("agreed_score") is not None for r in rows)


def _appraisal_needs_employee_score_agreement(appraisal_id: str) -> bool:
    """True when quarterly score rows exist (employee must confirm agreed % before HOD approves)."""
    return len(_appraisal_score_rows_list(appraisal_id)) > 0


def _can_edit_supervisor_appraisal_scores(user_id: str, role: str, appr: dict) -> bool:
    if role in ("admin", "hr"):
        return True
    if role != "manager":
        return False
    if (appr.get("status") or "") != "pending_supervisor":
        return False
    cur = (appr.get("current_approver_id") or "").strip()
    return str(user_id).strip() == cur


# Annual KPIs: one set per user per year; workflow Supervisor -> HOD -> HR lock
def _annual_kpi_editable(status: str) -> bool:
    return (status or "") in ("draft", "returned_supervisor", "returned_hod")


def _is_year_closed(year: int) -> bool:
    """True if any appraisal cycle with this year has status 'closed' (no one can add KPIs for that year)."""
    with cursor() as c:
        c.execute("SELECT 1 FROM appraisal_cycles WHERE year = ? AND status = 'closed' LIMIT 1", (year,))
        return c.fetchone() is not None


def _kpi_cycle_year(cycle_id: str) -> int:
    with cursor() as c:
        c.execute("SELECT year FROM appraisal_cycles WHERE id = ?", ((cycle_id or "").strip(),))
        r = c.fetchone()
    return int(r[0] or 0) if r else 0


class AnnualKPICreate(BaseModel):
    year: int


class AnnualKPITitleCreate(BaseModel):
    name: str


class AnnualKPIItemCreate(BaseModel):
    description: str  # subtitle label
    weight: float  # percentage 0-100
    target: float  # target percentage 0-100


class AnnualKPIItemUpdate(BaseModel):
    description: str | None = None
    weight: float | None = None
    target: float | None = None


class ReturnCommentBody(BaseModel):
    comment: str


@app.get("/appraisal/annual-kpis")
def appraisal_list_annual_kpis(year: int | None = None, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    role = _appraisal_user_role(user_id)
    with cursor() as c:
        if role in ("admin", "hr"):
            if year:
                c.execute("SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a LEFT JOIN users u ON a.user_id = u.id WHERE a.year = ? ORDER BY a.year DESC, u.full_name", (year,))
            else:
                c.execute("SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.year DESC, u.full_name")
        elif year:
            c.execute("SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a LEFT JOIN users u ON a.user_id = u.id WHERE a.user_id = ? AND a.year = ?", (user_id, year))
        else:
            c.execute("SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a LEFT JOIN users u ON a.user_id = u.id WHERE a.user_id = ? ORDER BY a.year DESC", (user_id,))
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["user_name"] = d.pop("user_name", None)
            d["total_weight"] = _appraisal_annual_total_weight(d["id"])
            out.append(d)
    return out


@app.post("/appraisal/annual-kpis")
def appraisal_create_annual_kpi(req: AnnualKPICreate, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "employee", "manager", "hod"])
    if _is_year_closed(req.year):
        raise HTTPException(status_code=400, detail="This year is closed for appraisal. No new KPIs can be added.")
    with cursor() as c:
        c.execute("SELECT id FROM appraisal_annual_kpis WHERE user_id = ? AND year = ?", (user_id, req.year))
        if c.fetchone():
            raise HTTPException(status_code=400, detail="Annual KPIs already exist for this year")
    aid = new_id()
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute(
            "INSERT INTO appraisal_annual_kpis (id, user_id, year, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)",
            (aid, user_id, req.year, now, now),
        )
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (aid,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/annual-kpis/pending-approval")
def appraisal_list_annual_kpis_pending_approval(user_id: str = Depends(get_current_user_id)):
    """Annual KPIs where the current user is the pending approver (chain-based approval)."""
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    uid = (user_id or "").strip()
    with cursor() as c:
        c.execute(
            "SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a JOIN users u ON a.user_id = u.id WHERE LOWER(TRIM(COALESCE(a.pending_approver_id, ''))) = LOWER(?) AND a.status = 'submitted' ORDER BY a.updated_at",
            (uid,),
        )
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["user_name"] = d.pop("user_name", None)
            out.append(d)
    return out


@app.get("/appraisal/annual-kpis/{annual_kpi_id}")
def appraisal_get_annual_kpi(annual_kpi_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT a.*, u.full_name as user_name FROM appraisal_annual_kpis a LEFT JOIN users u ON a.user_id = u.id WHERE a.id = ?", (annual_kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annual KPI not found")
    d = row_to_dict(row)
    if d and str(d.get("user_id")) != str(user_id):
        _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager"])
    if d:
        d["user_name"] = d.pop("user_name", None)
        d["total_weight"] = _appraisal_annual_total_weight(annual_kpi_id)
    return d


@app.get("/appraisal/annual-kpis/{annual_kpi_id}/titles")
def appraisal_list_kpi_titles(annual_kpi_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Annual KPI not found")
        c.execute("SELECT * FROM appraisal_kpi_titles WHERE annual_kpi_id = ? ORDER BY sort_order, created_at", (annual_kpi_id,))
        rows = c.fetchall()
    return [row_to_dict(r) for r in rows if row_to_dict(r)]


@app.post("/appraisal/annual-kpis/{annual_kpi_id}/titles")
def appraisal_create_kpi_title(annual_kpi_id: str, req: AnnualKPITitleCreate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annual KPI not found")
    r = dict(row)
    if _is_year_closed(int(r.get("year") or 0)):
        raise HTTPException(status_code=400, detail="This year is closed for appraisal. No new KPIs can be added.")
    if str(r.get("user_id")) != str(user_id):
        _appraisal_require_roles(user_id, ["admin", "hr"])
    if not _annual_kpi_editable(r.get("status")):
        raise HTTPException(status_code=400, detail="Cannot edit KPIs in current status")
    tid = new_id()
    with cursor() as c:
        c.execute(
            "INSERT INTO appraisal_kpi_titles (id, annual_kpi_id, name, sort_order, created_at) VALUES (?, ?, ?, 0, ?)",
            (tid, annual_kpi_id, req.name.strip(), datetime.utcnow().isoformat()),
        )
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_kpi_titles WHERE id = ?", (tid,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/kpi-titles/{title_id}/items")
def appraisal_list_kpi_items(title_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr", "hod", "manager", "employee"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_kpi_items WHERE kpi_title_id = ? ORDER BY sort_order, created_at", (title_id,))
        rows = c.fetchall()
    return [row_to_dict(r) for r in rows if row_to_dict(r)]


@app.post("/appraisal/kpi-titles/{title_id}/items")
def appraisal_create_kpi_item(title_id: str, req: AnnualKPIItemCreate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT t.*, a.user_id, a.status, a.year FROM appraisal_kpi_titles t JOIN appraisal_annual_kpis a ON t.annual_kpi_id = a.id WHERE t.id = ?", (title_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI title not found")
    r = dict(row)
    if _is_year_closed(int(r.get("year") or 0)):
        raise HTTPException(status_code=400, detail="This year is closed for appraisal. No new KPIs can be added.")
    if str(r.get("user_id")) != str(user_id):
        _appraisal_require_roles(user_id, ["admin", "hr"])
    if not _annual_kpi_editable(r.get("status")):
        raise HTTPException(status_code=400, detail="Cannot edit KPIs in current status")
    iid = new_id()
    target_val = req.target if req.target is not None else 0
    with cursor() as c:
        c.execute(
            "INSERT INTO appraisal_kpi_items (id, kpi_title_id, description, weight, target, sort_order, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (iid, title_id, req.description.strip(), req.weight, str(target_val), datetime.utcnow().isoformat()),
        )
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_kpi_items WHERE id = ?", (iid,))
        return row_to_dict(c.fetchone())


@app.patch("/appraisal/kpi-items/{item_id}")
def appraisal_update_kpi_item(item_id: str, req: AnnualKPIItemUpdate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT i.*, a.user_id, a.status FROM appraisal_kpi_items i JOIN appraisal_kpi_titles t ON i.kpi_title_id = t.id JOIN appraisal_annual_kpis a ON t.annual_kpi_id = a.id WHERE i.id = ?", (item_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI item not found")
    r = dict(row)
    if str(r.get("user_id")) != str(user_id):
        _appraisal_require_roles(user_id, ["admin", "hr"])
    if not _annual_kpi_editable(r.get("status")):
        raise HTTPException(status_code=400, detail="Cannot edit KPIs in current status")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        with cursor() as c:
            c.execute("SELECT * FROM appraisal_kpi_items WHERE id = ?", (item_id,))
            return row_to_dict(c.fetchone())
    if "description" in updates:
        updates["description"] = updates["description"].strip()
    if "target" in updates and updates["target"] is not None:
        updates["target"] = str(updates["target"])
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with cursor() as c:
        c.execute(f"UPDATE appraisal_kpi_items SET {set_clause} WHERE id = ?", (*updates.values(), item_id))
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_kpi_items WHERE id = ?", (item_id,))
        return row_to_dict(c.fetchone())


@app.delete("/appraisal/kpi-items/{item_id}")
def appraisal_delete_kpi_item(item_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT i.*, a.user_id, a.status FROM appraisal_kpi_items i JOIN appraisal_kpi_titles t ON i.kpi_title_id = t.id JOIN appraisal_annual_kpis a ON t.annual_kpi_id = a.id WHERE i.id = ?", (item_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="KPI item not found")
    r = dict(row)
    if str(r.get("user_id")) != str(user_id):
        _appraisal_require_roles(user_id, ["admin", "hr"])
    if not _annual_kpi_editable(r.get("status")):
        raise HTTPException(status_code=400, detail="Cannot edit KPIs in current status")
    with cursor() as c:
        c.execute("DELETE FROM appraisal_kpi_items WHERE id = ?", (item_id,))
    return {"ok": True}


@app.post("/appraisal/annual-kpis/{annual_kpi_id}/submit")
def appraisal_submit_annual_kpi(annual_kpi_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annual KPI not found")
    if _is_year_closed(int(row.get("year") or 0)):
        raise HTTPException(status_code=400, detail="This year is closed for appraisal. No new KPIs can be added.")
    if str(row["user_id"]) != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if (row["status"] or "") not in ("draft", "returned_supervisor", "returned_hod"):
        raise HTTPException(status_code=400, detail="Cannot submit in current status")
    total = _appraisal_annual_total_weight(annual_kpi_id)
    if abs(total - 100.0) > 0.01:
        raise HTTPException(status_code=400, detail=f"Total KPI weight must equal 100%. Current: {total}%")
    owner_id = str((row["user_id"] or "")).strip()
    first_approver = _get_staff_manager_id(owner_id)
    if not first_approver:
        raise HTTPException(status_code=400, detail="No supervisor assigned. Ask HR to assign your supervisor before submitting.")
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute(
            "UPDATE appraisal_annual_kpis SET status = 'submitted', pending_approver_id = ?, updated_at = ? WHERE id = ?",
            (first_approver, now, annual_kpi_id),
        )
    _appraisal_log("annual_kpi", annual_kpi_id, "submitted", user_id, _appraisal_user_role(user_id), "supervisor")
    try:
        _notify_manager_appraisal_submitted(first_approver, owner_id, "Annual KPI plan")
    except Exception as ex:
        logger.warning("Annual KPI submit supervisor notify failed: %s", ex)
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/annual-kpis/{annual_kpi_id}/return")
def appraisal_return_annual_kpi(annual_kpi_id: str, req: ReturnCommentBody, user_id: str = Depends(get_current_user_id)):
    if not (req.comment or req.comment.strip()):
        raise HTTPException(status_code=400, detail="Comment required when returning")
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annual KPI not found")
    r = dict(row)
    status = r.get("status") or ""
    if status != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted KPIs can be returned")
    pending = (r.get("pending_approver_id") or "").strip()
    if pending.lower() != (user_id or "").strip().lower():
        raise HTTPException(status_code=403, detail="Only the current approver can return this KPI")
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute("UPDATE appraisal_annual_kpis SET status = 'returned_supervisor', pending_approver_id = NULL, updated_at = ? WHERE id = ?", (now, annual_kpi_id))
    wid = new_id()
    role = _appraisal_user_role(user_id)
    with cursor() as c:
        c.execute("INSERT INTO workflow_comments (id, reference_type, reference_id, from_user_id, from_role, comment, created_at) VALUES (?, 'annual_kpi', ?, ?, ?, ?, ?)", (wid, annual_kpi_id, user_id, role, req.comment.strip(), now))
    _appraisal_log("annual_kpi", annual_kpi_id, "returned", user_id, role, "staff")
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/annual-kpis/{annual_kpi_id}/approve")
def appraisal_approve_annual_kpi(annual_kpi_id: str, user_id: str = Depends(get_current_user_id)):
    """Single approve: only the current pending_approver can approve. Chain moves to approver's manager; if none, status becomes approved_hod (HR can lock)."""
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annual KPI not found")
    if (row["status"] or "") != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted KPIs can be approved")
    r = dict(row)
    pending = (r.get("pending_approver_id") or "").strip()
    if pending.lower() != (user_id or "").strip().lower():
        raise HTTPException(status_code=403, detail="Only the current approver can approve this KPI")
    next_approver = _get_staff_manager_id(user_id)
    now = datetime.utcnow().isoformat()
    if next_approver:
        with cursor() as c:
            c.execute("UPDATE appraisal_annual_kpis SET pending_approver_id = ?, updated_at = ? WHERE id = ?", (next_approver, now, annual_kpi_id))
        _appraisal_log("annual_kpi", annual_kpi_id, "approved_supervisor", user_id, _appraisal_user_role(user_id), "next_approver")
    else:
        with cursor() as c:
            c.execute("UPDATE appraisal_annual_kpis SET status = 'approved_hod', pending_approver_id = NULL, updated_at = ? WHERE id = ?", (now, annual_kpi_id))
        _appraisal_log("annual_kpi", annual_kpi_id, "approved_hod", user_id, _appraisal_user_role(user_id), "hr")
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        return row_to_dict(c.fetchone())


@app.post("/appraisal/annual-kpis/{annual_kpi_id}/lock")
def appraisal_lock_annual_kpi(annual_kpi_id: str, user_id: str = Depends(get_current_user_id)):
    _appraisal_require_roles(user_id, ["admin", "hr"])
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annual KPI not found")
    if (row["status"] or "") != "approved_hod":
        raise HTTPException(status_code=400, detail="Only HOD-approved KPIs can be locked by HR")
    with cursor() as c:
        c.execute("UPDATE appraisal_annual_kpis SET status = 'locked', updated_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), annual_kpi_id))
    _appraisal_log("annual_kpi", annual_kpi_id, "locked", user_id, _appraisal_user_role(user_id), None)
    with cursor() as c:
        c.execute("SELECT * FROM appraisal_annual_kpis WHERE id = ?", (annual_kpi_id,))
        return row_to_dict(c.fetchone())


@app.get("/appraisal/rating-scale")
def appraisal_rating_scale(_: str = Depends(get_current_user_id)):
    """Rating bands for appraisal total score (read-only)."""
    return [
        {"min": 101, "label": "Excellent"},
        {"min": 80, "label": "Very Good"},
        {"min": 70, "label": "Good"},
        {"min": 60, "label": "Average"},
        {"min": 0, "label": "Poor"},
    ]


# ---------- HR Documents ----------
@app.get("/hr-documents")
def list_hr_documents(_: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("""
            SELECT h.*, u.full_name as uploader_name FROM hr_documents h
            LEFT JOIN users u ON h.uploaded_by = u.id ORDER BY h.created_at DESC
        """)
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["users"] = {"full_name": d.pop("uploader_name", None)}
            out.append(d)
    return out


class HrDocumentCreate(BaseModel):
    title: str
    file_path: str
    uploaded_by: str | None = None


@app.post("/hr-documents")
def add_hr_document(req: HrDocumentCreate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    hid = new_id()
    with cursor() as c:
        c.execute("INSERT INTO hr_documents (id, title, file_path, uploaded_by) VALUES (?, ?, ?, ?)", (hid, req.title, req.file_path, user_id))
    with cursor() as c:
        c.execute("SELECT h.*, u.full_name as uploader_name FROM hr_documents h LEFT JOIN users u ON h.uploaded_by = u.id WHERE h.id = ?", (hid,))
        row = c.fetchone()
    d = row_to_dict(row)
    if d:
        d["users"] = {"full_name": d.pop("uploader_name", None)}
    return d


@app.post("/hr-documents/upload")
async def upload_hr_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    user_id: str = Depends(get_current_user_id),
):
    """Upload a file and store it in local storage. HR/Admin only."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not file.filename or not file.filename.strip():
        raise HTTPException(status_code=400, detail="No file selected")
    safe_name = re.sub(r"[^\w\-.]", "_", file.filename.strip())[:200]
    if not safe_name:
        safe_name = "document"
    hid = new_id()
    # Store relative path: filename only under uploads (no subdirs to avoid traversal)
    file_path = f"{hid}_{safe_name}"
    full_path = os.path.join(UPLOAD_DIR, file_path)
    try:
        contents = await file.read()
        with open(full_path, "wb") as f:
            f.write(contents)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")
    with cursor() as c:
        c.execute(
            "INSERT INTO hr_documents (id, title, file_path, uploaded_by) VALUES (?, ?, ?, ?)",
            (hid, title.strip() or file.filename, file_path, user_id),
        )
    with cursor() as c:
        c.execute(
            "SELECT h.*, u.full_name as uploader_name FROM hr_documents h LEFT JOIN users u ON h.uploaded_by = u.id WHERE h.id = ?",
            (hid,),
        )
        row = c.fetchone()
    d = row_to_dict(row)
    if d:
        d["users"] = {"full_name": d.pop("uploader_name", None)}
    return d


@app.get("/hr-documents/{document_id}/file")
def get_hr_document_file(document_id: str, user_id: str = Depends(get_current_user_id)):
    """Serve the file for an HR document. Any authenticated user can view."""
    with cursor() as c:
        c.execute("SELECT id, title, file_path FROM hr_documents WHERE id = ?", (document_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    file_path = row[2]
    # Prevent path traversal: only allow filename (no slashes)
    if "/" in file_path or "\\" in file_path or file_path.startswith(".."):
        raise HTTPException(status_code=400, detail="Invalid path")
    full_path = os.path.join(UPLOAD_DIR, file_path)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        full_path,
        filename=file_path.split("_", 1)[-1] if "_" in file_path else file_path,
        media_type="application/octet-stream",
    )


# ---------- In-app notifications (bell) ----------
@app.get("/notifications")
def list_notifications(limit: int = 40, user_id: str = Depends(get_current_user_id)):
    lim = max(1, min(limit, 100))
    with cursor() as c:
        c.execute(
            f"SELECT * FROM notifications WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT {lim}",
            (user_id,),
        )
        rows = c.fetchall()
    return [row_to_dict(r) for r in rows if row_to_dict(r)]


@app.get("/notifications/unread-count")
def notifications_unread_count(user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL",
            (user_id,),
        )
        (n,) = c.fetchone()
    return {"count": int(n or 0)}


@app.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, user_id: str = Depends(get_current_user_id)):
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute(
            "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?",
            (now, notification_id, user_id),
        )
        if c.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@app.post("/notifications/mark-all-read")
def mark_all_notifications_read(user_id: str = Depends(get_current_user_id)):
    now = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", (now, user_id))
    return {"ok": True}


@app.delete("/notifications")
def clear_all_notifications(user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("DELETE FROM notifications WHERE user_id = ?", (user_id,))
        deleted = int(c.rowcount or 0)
    return {"ok": True, "deleted": deleted}


# ---------- Staff documents (per employee: HR confidential or employee certificates) ----------
@app.get("/staff-documents")
def list_staff_documents(
    subject_user_id: str | None = Query(None, description="Employee whose folder to list (required for HR/Admin)"),
    user_id: str = Depends(get_current_user_id),
):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Unauthorized")
    role = (row[0] or "").strip().lower()
    sub = (subject_user_id or "").strip() or user_id
    if role not in ("admin", "hr"):
        if sub != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        kind_sql = "kind IN ('employee_certificate', 'signed_appraisal')"
        params = (sub,)
    else:
        if not (subject_user_id or "").strip():
            raise HTTPException(status_code=400, detail="Query parameter subject_user_id (user folder) is required")
        kind_sql = "1=1"
        params = (sub,)
    with cursor() as c:
        c.execute(
            f"""
            SELECT s.*, u.full_name as uploader_name
            FROM staff_documents s
            LEFT JOIN users u ON s.uploaded_by = u.id
            WHERE s.user_id = ? AND {kind_sql}
            ORDER BY datetime(s.created_at) DESC
            """,
            params,
        )
        rows = c.fetchall()
    out = []
    for r in rows:
        d = row_to_dict(r)
        if d:
            d["uploader_name"] = d.pop("uploader_name", None)
            out.append(d)
    return out


@app.post("/staff-documents/upload")
async def upload_staff_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    kind: str = Form(...),
    subject_user_id: str = Form(...),
    appraisal_id: str | None = Form(None),
    user_id: str = Depends(get_current_user_id),
):
    """kind = hr_confidential | employee_certificate | signed_appraisal (signed appraisal PDF/scan; optional appraisal_id links to quarterly appraisal)."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Unauthorized")
    role = (row[0] or "").strip().lower()
    sub = (subject_user_id or "").strip()
    if not sub:
        raise HTTPException(status_code=400, detail="subject_user_id required")
    k = (kind or "").strip().lower()
    if k not in ("hr_confidential", "employee_certificate", "signed_appraisal"):
        raise HTTPException(status_code=400, detail="Invalid kind")
    if k == "hr_confidential":
        if role not in ("admin", "hr"):
            raise HTTPException(status_code=403, detail="Only HR or Admin can upload confidential staff documents")
    elif k == "signed_appraisal":
        if sub != user_id:
            raise HTTPException(status_code=403, detail="You can only upload a signed appraisal to your own profile")
        aid = (appraisal_id or "").strip()
        if not aid:
            raise HTTPException(status_code=400, detail="appraisal_id is required for signed_appraisal uploads")
        with cursor() as c:
            c.execute("SELECT * FROM appraisals WHERE id = ?", (aid,))
            arow = c.fetchone()
        if not arow or str(dict(arow).get("user_id")) != str(user_id):
            raise HTTPException(status_code=400, detail="Appraisal not found or does not belong to you")
        ast = dict(arow).get("status") or ""
        if ast not in ("approved", "received", "acknowledged"):
            raise HTTPException(status_code=400, detail="Signed appraisal can be uploaded after HR has approved the appraisal")
    else:
        if sub != user_id:
            raise HTTPException(status_code=403, detail="You can only upload certificates to your own profile")
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE id = ?", (sub,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
    if not file.filename or not file.filename.strip():
        raise HTTPException(status_code=400, detail="No file selected")
    safe_name = re.sub(r"[^\w\-.]", "_", file.filename.strip())[:200]
    if not safe_name:
        safe_name = "document"
    hid = new_id()
    file_path = f"scd_{hid}_{safe_name}"
    full_path = os.path.join(UPLOAD_DIR, file_path)
    try:
        contents = await file.read()
        with open(full_path, "wb") as f:
            f.write(contents)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")
    with cursor() as c:
        c.execute(
            "INSERT INTO staff_documents (id, user_id, kind, title, file_path, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
            (hid, sub, k, (title or "").strip() or file.filename, file_path, user_id),
        )
    if k == "employee_certificate":
        try:
            _notify_hr_admins_staff_certificate(sub, (title or "").strip() or file.filename)
        except Exception as e:
            logger.warning("Certificate notification failed: %s", e)
    if k == "signed_appraisal":
        try:
            _notify_hr_admins_staff_certificate(sub, f"[Signed appraisal] {(title or '').strip() or file.filename}")
        except Exception as e:
            logger.warning("Signed appraisal notification failed: %s", e)
        aid = (appraisal_id or "").strip()
        if aid:
            with cursor() as c:
                c.execute(
                    "UPDATE appraisals SET signed_document_id = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                    (hid, datetime.utcnow().isoformat(), aid, sub),
                )
    with cursor() as c:
        c.execute(
            "SELECT s.*, u.full_name as uploader_name FROM staff_documents s LEFT JOIN users u ON s.uploaded_by = u.id WHERE s.id = ?",
            (hid,),
        )
        r = c.fetchone()
    d = row_to_dict(r)
    if d:
        d["uploader_name"] = d.pop("uploader_name", None)
    return d


@app.get("/staff-documents/{document_id}/file")
def get_staff_document_file(document_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        rrole = c.fetchone()
        c.execute("SELECT * FROM staff_documents WHERE id = ?", (document_id,))
        row = c.fetchone()
    if not row or not rrole:
        raise HTTPException(status_code=404, detail="Document not found")
    role = (rrole[0] or "").strip().lower()
    doc = row_to_dict(row)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    sub_uid = (doc.get("user_id") or "").strip()
    dk = (doc.get("kind") or "").strip().lower()
    if role in ("admin", "hr"):
        pass
    elif dk == "employee_certificate" and sub_uid == user_id:
        pass
    elif dk == "signed_appraisal" and sub_uid == user_id:
        pass
    else:
        raise HTTPException(status_code=403, detail="Forbidden")
    file_path = doc.get("file_path") or ""
    if "/" in file_path or "\\" in file_path or str(file_path).startswith(".."):
        raise HTTPException(status_code=400, detail="Invalid path")
    full_path = os.path.join(UPLOAD_DIR, file_path)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        full_path,
        filename=file_path.split("_", 1)[-1] if "_" in file_path else file_path,
        media_type="application/octet-stream",
    )


@app.delete("/staff-documents/{document_id}")
def delete_staff_document(document_id: str, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        rrole = c.fetchone()
        c.execute("SELECT * FROM staff_documents WHERE id = ?", (document_id,))
        row = c.fetchone()
    if not row or not rrole:
        raise HTTPException(status_code=404, detail="Document not found")
    role = (rrole[0] or "").strip().lower()
    doc = row_to_dict(row)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    dk = (doc.get("kind") or "").strip().lower()
    sub_uid = (doc.get("user_id") or "").strip()
    up = (doc.get("uploaded_by") or "").strip()
    if role in ("admin", "hr"):
        pass
    elif dk == "employee_certificate" and sub_uid == user_id and up == user_id:
        pass
    elif dk == "signed_appraisal" and sub_uid == user_id and up == user_id:
        pass
    else:
        raise HTTPException(status_code=403, detail="Forbidden")
    fp = doc.get("file_path") or ""
    if fp and "/" not in fp and "\\" not in fp and not str(fp).startswith(".."):
        full_path = os.path.join(UPLOAD_DIR, fp)
        try:
            if os.path.isfile(full_path):
                os.remove(full_path)
        except OSError:
            pass
    with cursor() as c:
        c.execute("DELETE FROM staff_documents WHERE id = ?", (document_id,))
    return {"ok": True}


# ---------- Leave module ----------
def _now_iso():
    return datetime.utcnow().isoformat()


def _get_user_profile_min(user_id: str):
    with cursor() as c:
        c.execute(
            "SELECT id, full_name, email, role, manager_id, department, is_active FROM users WHERE id = ?",
            (user_id,),
        )
        row = c.fetchone()
    return row_to_dict(row)


def _user_is_active_row(user: dict | None) -> bool:
    if not user:
        return False
    try:
        return int(user.get("is_active") or 0) == 1
    except (TypeError, ValueError):
        return False


def _first_leave_approver(requester_id: str) -> str | None:
    """OrangeHRM-style: first approver is the employee's direct supervisor (`manager_id`), any role."""
    user = _get_user_profile_min(requester_id)
    if not user or not _user_is_active_row(user):
        return None
    manager_id = (user.get("manager_id") or "").strip()
    if not manager_id:
        return None
    mgr = _get_user_profile_min(manager_id)
    if not mgr or not _user_is_active_row(mgr):
        return None
    return manager_id


def _next_leave_approver_after_step(approver_user_id: str, requester_user_id: str) -> str | None:
    """After a step approves, the next approver is this approver's supervisor (i.e. requester's supervisor-of-supervisor on the second hop)."""
    approver = _get_user_profile_min(approver_user_id)
    if not approver or not _user_is_active_row(approver):
        return None
    next_id = (approver.get("manager_id") or "").strip()
    if not next_id or next_id == requester_user_id:
        return None
    # Guard against circular reporting lines (A->B->C->A) causing endless forwarding loops.
    seen = {approver_user_id}
    walk = next_id
    for _ in range(25):
        if not walk:
            break
        if walk in seen:
            return None
        seen.add(walk)
        wprof = _get_user_profile_min(walk)
        if not wprof or not _user_is_active_row(wprof):
            break
        walk = (wprof.get("manager_id") or "").strip()
    nxt = _get_user_profile_min(next_id)
    if not nxt or not _user_is_active_row(nxt):
        return None
    return next_id


def _is_user_in_requester_supervisor_chain(requester_user_id: str, candidate_user_id: str) -> bool:
    """True when candidate appears in requester's active manager chain."""
    req = (requester_user_id or "").strip()
    cand = (candidate_user_id or "").strip()
    if not req or not cand or req == cand:
        return False
    seen = set()
    current = _get_staff_manager_id(req)
    for _ in range(30):
        if not current:
            return False
        if current == cand:
            return True
        if current in seen:
            return False
        seen.add(current)
        prof = _get_user_profile_min(current)
        if not prof or not _user_is_active_row(prof):
            return False
        current = (prof.get("manager_id") or "").strip()
    return False


def _require_roles(user_id: str, allowed_roles: tuple[str, ...]):
    profile = _get_user_profile_min(user_id)
    if not profile:
        raise HTTPException(status_code=401, detail="User not found")
    if profile.get("role") not in allowed_roles:
        raise HTTPException(status_code=403, detail="Forbidden")
    return profile


def _parse_yyyy_mm_dd(value: str):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(status_code=400, detail="Dates must be in YYYY-MM-DD format")


def _parse_hire_date(raw: str | None) -> date | None:
    s = (raw or "").strip()[:10]
    if len(s) < 10:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _completed_service_years(uid: str, as_of: date | None = None) -> int:
    """Full calendar years of service from work_anniversary (hire date) to as_of."""
    as_of = as_of or datetime.utcnow().date()
    with cursor() as c:
        c.execute("SELECT work_anniversary FROM users WHERE id = ?", (uid,))
        row = c.fetchone()
    hire = _parse_hire_date(row[0] if row else None)
    if not hire or hire > as_of:
        return 0
    y = as_of.year - hire.year
    if (as_of.month, as_of.day) < (hire.month, hire.day):
        y -= 1
    return max(0, y)


def _annual_entitlement_days(uid: str) -> float:
    """
    Annual leave: 18 days, +1 day per 3 completed years of service, max 21 (Rwanda-style ladder).
    Uses users.work_anniversary. If unset, entitlement is 18 days (0 years of service recorded).
    Overridden when HR_SUITE_ANNUAL_LEAVE_DAYS is set.
    """
    raw = (os.getenv("HR_SUITE_ANNUAL_LEAVE_DAYS") or "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    years = _completed_service_years(uid)
    return float(min(21, 18 + (years // 3)))


def _refresh_annual_balance_allocation(uid: str, year: int) -> None:
    """Overwrite this user's ANNUAL row with statutory entitlement minus used (see POST /leave/hr/recompute-statutory-annual)."""
    if not (uid or "").strip():
        return
    ent = _annual_entitlement_days(uid)
    with cursor() as c:
        c.execute(
            """
            SELECT lb.id, COALESCE(lb.used_days, 0) AS used_days
            FROM leave_balances lb
            JOIN leave_types lt ON lt.id = lb.leave_type_id AND UPPER(TRIM(lt.code)) = 'ANNUAL'
            WHERE lb.user_id = ? AND lb.year = ?
            LIMIT 1
            """,
            (uid, year),
        )
        row = c.fetchone()
    if not row:
        return
    bid, used = row[0], float(row[1] or 0)
    rem = max(ent - used, 0.0)
    now = _now_iso()
    with cursor() as c:
        c.execute(
            "UPDATE leave_balances SET allocated_days = ?, remaining_days = ?, updated_at = ? WHERE id = ?",
            (ent, rem, now, bid),
        )


def _refresh_all_annual_leave_balances_for_year(year: int) -> None:
    """Recompute ANNUAL allocated/remaining for every user with a row this year (overwrites imports). HR-only action."""
    raw = (os.getenv("HR_SUITE_ANNUAL_LEAVE_DAYS") or "").strip()
    now = _now_iso()
    if raw:
        try:
            d = float(raw)
        except ValueError:
            return
        with cursor() as c:
            c.execute(
                """
                UPDATE leave_balances
                SET allocated_days = ?,
                    remaining_days = MAX(0, ? - COALESCE(used_days, 0)),
                    updated_at = ?
                WHERE year = ? AND leave_type_id = (SELECT id FROM leave_types WHERE UPPER(TRIM(code)) = 'ANNUAL' LIMIT 1)
                """,
                (d, d, now, year),
            )
        return
    with cursor() as c:
        c.execute(
            """
            SELECT lb.id, lb.user_id, COALESCE(lb.used_days, 0) AS used_days
            FROM leave_balances lb
            JOIN leave_types lt ON lt.id = lb.leave_type_id AND UPPER(TRIM(lt.code)) = 'ANNUAL'
            WHERE lb.year = ?
            """,
            (year,),
        )
        rows = c.fetchall()
    for bid, uid, used in rows:
        ent = _annual_entitlement_days(uid)
        rem = max(ent - float(used or 0), 0.0)
        with cursor() as c:
            c.execute(
                "UPDATE leave_balances SET allocated_days = ?, remaining_days = ?, updated_at = ? WHERE id = ?",
                (ent, rem, now, bid),
            )


def _rollover_leave_balances_for_year(year: int) -> None:
    """
    Year-start allocation policy:
    - base entitlement for the target year (leave type defaults; ANNUAL uses statutory/env override)
    - plus carry-over from previous year's remaining days for the same user/type.
    Existing used_days in target year are preserved; remaining is recalculated from new allocation.
    """
    prev_year = int(year) - 1
    now = _now_iso()
    annual_override = None
    raw = (os.getenv("HR_SUITE_ANNUAL_LEAVE_DAYS") or "").strip()
    if raw:
        try:
            annual_override = float(raw)
        except ValueError:
            annual_override = None
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE is_active = 1")
        user_ids = [str(r[0]) for r in c.fetchall()]
        c.execute("SELECT id, code, default_days FROM leave_types WHERE is_active = 1")
        leave_types = [(str(r[0]), (r[1] or "").strip().upper(), float(r[2] or 0)) for r in c.fetchall()]
    for uid in user_ids:
        for lt_id, code, default_days in leave_types:
            base_alloc = default_days
            if code == "ANNUAL":
                base_alloc = annual_override if annual_override is not None else _annual_entitlement_days(uid)
            with cursor() as c:
                c.execute(
                    """
                    SELECT COALESCE(remaining_days, COALESCE(allocated_days, 0) - COALESCE(used_days, 0))
                    FROM leave_balances
                    WHERE user_id = ? AND leave_type_id = ? AND year = ?
                    LIMIT 1
                    """,
                    (uid, lt_id, prev_year),
                )
                prev = c.fetchone()
                c.execute(
                    """
                    SELECT id, COALESCE(used_days, 0) FROM leave_balances
                    WHERE user_id = ? AND leave_type_id = ? AND year = ?
                    LIMIT 1
                    """,
                    (uid, lt_id, year),
                )
                cur_row = c.fetchone()
            carry = max(float(prev[0] or 0), 0.0) if prev else 0.0
            new_alloc = max(base_alloc + carry, 0.0)
            if cur_row:
                bid, used_days = str(cur_row[0]), float(cur_row[1] or 0)
                new_remaining = max(new_alloc - used_days, 0.0)
                with cursor() as c:
                    c.execute(
                        "UPDATE leave_balances SET allocated_days = ?, remaining_days = ?, updated_at = ? WHERE id = ?",
                        (new_alloc, new_remaining, now, bid),
                    )
                continue
            with cursor() as c:
                c.execute(
                    """
                    INSERT INTO leave_balances (id, user_id, leave_type_id, year, allocated_days, used_days, remaining_days, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
                    """,
                    (new_id(), uid, lt_id, year, new_alloc, new_alloc, now, now),
                )


def _calculate_leave_days(start_date: str, end_date: str) -> float:
    sd = _parse_yyyy_mm_dd(start_date)
    ed = _parse_yyyy_mm_dd(end_date)
    if ed < sd:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")
    return float((ed - sd).days + 1)


def _leave_log(leave_request_id: str, action: str, from_user_id: str | None, from_role: str | None, to_user_id: str | None, to_role: str | None, comment: str | None = None):
    with cursor() as c:
        c.execute(
            """
            INSERT INTO leave_workflow_logs (id, leave_request_id, action, from_user_id, from_role, to_user_id, to_role, comment, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id(), leave_request_id, action, from_user_id, from_role, to_user_id, to_role, (comment or "").strip() or None, _now_iso()),
        )


def _audit_log(action: str, resource: str, actor_user_id: str | None, resource_id: str | None = None, details: dict | None = None) -> None:
    details_str = json.dumps(details) if details else None
    with cursor() as c:
        c.execute(
            "INSERT INTO audit_logs (id, user_id, action, resource, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)",
            (new_id(), actor_user_id, action, resource, resource_id, details_str),
        )


def _sync_leave_balance_for_approved(req_row: dict):
    year = int((req_row.get("start_date") or "")[:4] or datetime.utcnow().year)
    with cursor() as c:
        c.execute(
            """
            SELECT id, default_days, code FROM leave_types WHERE id = ?
            """,
            (req_row["leave_type_id"],),
        )
        lt = c.fetchone()
    default_days = float(lt[1]) if lt else 0.0
    if lt and (lt[2] or "").strip().upper() == "ANNUAL":
        default_days = _annual_entitlement_days(req_row["user_id"])
    with cursor() as c:
        c.execute(
            """
            SELECT id, allocated_days, used_days FROM leave_balances
            WHERE user_id = ? AND leave_type_id = ? AND year = ?
            """,
            (req_row["user_id"], req_row["leave_type_id"], year),
        )
        bal = c.fetchone()
    if not bal:
        bid = new_id()
        used = float(req_row.get("days_requested") or 0)
        with cursor() as c:
            c.execute(
                """
                INSERT INTO leave_balances (id, user_id, leave_type_id, year, allocated_days, used_days, remaining_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (bid, req_row["user_id"], req_row["leave_type_id"], year, default_days, used, max(default_days - used, 0), _now_iso(), _now_iso()),
            )
        return
    used_days = float(bal[2] or 0) + float(req_row.get("days_requested") or 0)
    allocated = float(bal[1] or 0)
    with cursor() as c:
        c.execute(
            "UPDATE leave_balances SET used_days = ?, remaining_days = ?, updated_at = ? WHERE id = ?",
            (used_days, max(allocated - used_days, 0), _now_iso(), bal[0]),
        )


def _apply_leave_balance_delta(user_id: str, leave_type_id: str, year: int, delta_days: float) -> None:
    """Adjust used/remaining days by a signed delta (positive adds used, negative reverses used)."""
    d = float(delta_days or 0)
    if abs(d) < 1e-9:
        return
    with cursor() as c:
        c.execute("SELECT id, default_days, code FROM leave_types WHERE id = ?", (leave_type_id,))
        lt = c.fetchone()
    default_days = float(lt[1]) if lt else 0.0
    if lt and (lt[2] or "").strip().upper() == "ANNUAL":
        default_days = _annual_entitlement_days(user_id)
    with cursor() as c:
        c.execute(
            """
            SELECT id, allocated_days, used_days FROM leave_balances
            WHERE user_id = ? AND leave_type_id = ? AND year = ?
            """,
            (user_id, leave_type_id, year),
        )
        bal = c.fetchone()
    if not bal:
        used_days = max(d, 0.0)
        with cursor() as c:
            c.execute(
                """
                INSERT INTO leave_balances (id, user_id, leave_type_id, year, allocated_days, used_days, remaining_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id(), user_id, leave_type_id, year, default_days, used_days, max(default_days - used_days, 0), _now_iso(), _now_iso()),
            )
        return
    allocated = float(bal[1] or 0)
    used_days = max(float(bal[2] or 0) + d, 0.0)
    with cursor() as c:
        c.execute(
            "UPDATE leave_balances SET used_days = ?, remaining_days = ?, updated_at = ? WHERE id = ?",
            (used_days, max(allocated - used_days, 0), _now_iso(), bal[0]),
        )


def _norm_uid_compare(a: str | None, b: str | None) -> bool:
    return (str(a or "").strip().lower()) == (str(b or "").strip().lower())


def _repoint_workflows_after_staff_manager_change(employee_id: str, old_manager_id: str | None, actor_user_id: str) -> None:
    """
    When an employee's direct supervisor changes, in-flight items that were waiting on the *previous*
    direct supervisor should wait on the new first approver (or auto-complete when no supervisor remains).
    """
    old_mid = (old_manager_id or "").strip()
    if not old_mid:
        return
    eid = (employee_id or "").strip()
    if not eid:
        return
    now = _now_iso()
    actor_role = (_get_user_profile_min(actor_user_id) or {}).get("role") or "hr"
    pending_leave = ("submitted", "pending_manager", "pending_hod", "pending_hr")
    with cursor() as c:
        c.execute(
            f"""
            SELECT id FROM leave_requests
            WHERE user_id = ?
              AND status IN ({",".join("?" * len(pending_leave))})
              AND LOWER(TRIM(COALESCE(current_approver_id, ''))) = LOWER(?)
            """,
            (eid, *pending_leave, old_mid),
        )
        leave_ids = [str(r[0]) for r in c.fetchall()]
    new_leave_first = _first_leave_approver(eid)
    for rid in leave_ids:
        if new_leave_first:
            with cursor() as c:
                c.execute(
                    "UPDATE leave_requests SET current_approver_id = ?, updated_at = ? WHERE id = ?",
                    (new_leave_first, now, rid),
                )
            _leave_log(rid, "supervisor_reassigned", actor_user_id, actor_role, new_leave_first, "supervisor", None)
            try:
                _notify_leave_approver(
                    rid,
                    new_leave_first,
                    "You are the current approver: a team member's supervisor was updated and this leave request was reassigned to you.",
                )
                _notify_leave_approver_inbox(rid, new_leave_first)
            except Exception as ex:
                logger.warning("Leave reassignment notify failed: %s", ex)
        else:
            with cursor() as c:
                c.execute(
                    """
                    UPDATE leave_requests
                    SET status = 'approved', current_approver_id = NULL, final_decision_by = ?, final_decision_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (actor_user_id, now, now, rid),
                )
            _leave_log(rid, "auto_approved_supervisor_removed", actor_user_id, actor_role, None, None, None)
            with cursor() as c:
                c.execute("SELECT * FROM leave_requests WHERE id = ?", (rid,))
                approved = row_to_dict(c.fetchone())
            if approved:
                _sync_leave_balance_for_approved(approved)
            try:
                _notify_leave_employee(
                    rid,
                    "Your leave request was approved (no active supervisor on file after an org update).",
                    "",
                )
                _notify_leave_hr_info(
                    "[Leave] Approved after supervisor change",
                    rid,
                    "A pending leave request was auto-approved because the employee has no active supervisor after HR/Admin updated reporting lines.",
                )
            except Exception as ex:
                logger.warning("Leave auto-approve after supervisor change notify failed: %s", ex)

    new_chain = _get_staff_manager_id(eid)
    with cursor() as c:
        c.execute(
            """
            SELECT id FROM kpis
            WHERE user_id = ? AND status = 'pending_supervisor'
              AND LOWER(TRIM(COALESCE(current_approver_id, ''))) = LOWER(?)
            """,
            (eid, old_mid),
        )
        kpi_ids = [str(r[0]) for r in c.fetchall()]
    for kid in kpi_ids:
        if new_chain:
            with cursor() as c:
                c.execute(
                    "UPDATE kpis SET current_approver_id = ?, updated_at = ? WHERE id = ?",
                    (new_chain, now, kid),
                )
            _appraisal_log("kpi", kid, "supervisor_reassigned", actor_user_id, actor_role, "supervisor")
            try:
                _notify_manager_appraisal_submitted(new_chain, eid, "KPI")
            except Exception as ex:
                logger.warning("KPI reassignment notify failed: %s", ex)
        else:
            with cursor() as c:
                c.execute(
                    "UPDATE kpis SET status = 'verified', current_approver_id = NULL, updated_at = ? WHERE id = ?",
                    (now, kid),
                )
            _appraisal_log("kpi", kid, "supervisor_removed_auto_verified", actor_user_id, actor_role, None)

    with cursor() as c:
        c.execute(
            """
            SELECT id FROM appraisals
            WHERE user_id = ? AND status = 'pending_supervisor'
              AND LOWER(TRIM(COALESCE(current_approver_id, ''))) = LOWER(?)
            """,
            (eid, old_mid),
        )
        appr_ids = [str(r[0]) for r in c.fetchall()]
    for aid in appr_ids:
        if new_chain:
            with cursor() as c:
                c.execute(
                    "UPDATE appraisals SET current_approver_id = ?, updated_at = ? WHERE id = ?",
                    (new_chain, now, aid),
                )
            _appraisal_log("appraisal", aid, "supervisor_reassigned", actor_user_id, actor_role, "supervisor")
            try:
                _notify_manager_appraisal_submitted(new_chain, eid, "Appraisal")
            except Exception as ex:
                logger.warning("Appraisal reassignment notify failed: %s", ex)
        else:
            with cursor() as c:
                c.execute(
                    "UPDATE appraisals SET status = 'verified', current_approver_id = NULL, updated_at = ? WHERE id = ?",
                    (now, aid),
                )
            _appraisal_log("appraisal", aid, "supervisor_removed_auto_verified", actor_user_id, actor_role, None)


def _setting_str(key: str) -> str:
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = c.fetchone()
    if not row or row[0] is None:
        return ""
    v = row[0]
    if isinstance(v, str) and len(v) >= 2 and v[0] == '"':
        try:
            s = json.loads(v)
            return str(s) if s is not None else ""
        except Exception:
            return v.strip('"')
    return str(v)


def _setting_bool(key: str) -> bool:
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = c.fetchone()
    if not row:
        return False
    v = str(row[0]).strip().lower().strip('"')
    return v in ("1", "true", "yes", "on")


def _leave_emails_enabled() -> bool:
    # Settings are the primary source so Admin Settings changes apply immediately.
    # Env remains a fallback for first-time boot or unmanaged deployments.
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("leave_email_enabled",))
        row = c.fetchone()
    if row and row[0] is not None and str(row[0]).strip() != "":
        v = str(row[0]).strip().lower().strip('"')
        return v in ("1", "true", "yes", "on")
    env = (os.environ.get("LEAVE_EMAIL_ENABLED") or "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    cfg = _get_smtp_config()
    return bool((cfg.get("host") or "").strip() and (cfg.get("from") or "").strip())


def _get_smtp_config() -> dict:
    # Settings first so values saved from Admin Settings are effective immediately.
    host = (_setting_str("smtp_host") or os.environ.get("SMTP_HOST") or "").strip()
    try:
        port = int(_setting_str("smtp_port") or os.environ.get("SMTP_PORT") or "587")
    except ValueError:
        port = 587
    user = (_setting_str("smtp_user") or os.environ.get("SMTP_USER") or "").strip()
    password = _setting_str("smtp_password") or os.environ.get("SMTP_PASSWORD")
    from_addr = (_setting_str("smtp_from") or os.environ.get("SMTP_FROM") or "").strip()
    if _setting_str("smtp_use_tls") != "":
        use_tls = _setting_bool("smtp_use_tls")
    else:
        env_tls = (os.environ.get("SMTP_USE_TLS") or "").strip().lower()
        use_tls = env_tls in ("1", "true", "yes", "on")
    return {"host": host, "port": port, "user": user, "password": password, "from": from_addr, "use_tls": use_tls}


def _user_email(uid: str) -> str | None:
    with cursor() as c:
        c.execute("SELECT email FROM users WHERE id = ?", (uid,))
        row = c.fetchone()
    e = (row[0] or "").strip() if row else ""
    return e if e and "@" in e else None


def _hr_notification_emails() -> list[str]:
    out = []
    with cursor() as c:
        c.execute(
            "SELECT email FROM users WHERE is_active = 1 AND role IN ('hr','admin') AND email IS NOT NULL AND TRIM(email) != ''"
        )
        for row in c.fetchall():
            e = (row[0] or "").strip()
            if "@" in e:
                out.append(e)
    return list(dict.fromkeys(out))


def _send_leave_email(to_addrs: list[str], subject: str, body: str) -> None:
    if not _leave_emails_enabled():
        return
    cfg = _get_smtp_config()
    if not cfg.get("host") or not cfg.get("from"):
        logger.warning("Leave email skipped: configure smtp_host and smtp_from (or SMTP_* env vars)")
        return
    recipients = [a.strip() for a in to_addrs if a and "@" in a]
    if not recipients:
        return
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = cfg["from"]
        msg["To"] = ", ".join(recipients)
        msg.set_content(body)
        if cfg["port"] == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=context, timeout=45) as smtp:
                if cfg["user"] and cfg["password"]:
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=45) as smtp:
                if cfg["use_tls"]:
                    smtp.starttls(context=ssl.create_default_context())
                if cfg["user"] and cfg["password"]:
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        logger.info("Leave email sent: %s -> %s", subject, recipients)
    except Exception as e:
        logger.warning("Leave email failed (%s): %s", subject, e)


def _leave_email_body(d: dict) -> list[str]:
    emp = d.get("employee_name") or "Employee"
    return [
        f"Employee: {emp}",
        f"Leave type: {d.get('leave_type_name') or '-'}",
        f"Dates: {d.get('start_date')} → {d.get('end_date')}",
        f"Days: {d.get('days_requested')}",
        f"Reason: {d.get('reason') or '-'}",
        "",
        "Open the HR Suite in your browser to view details and take action.",
    ]


def _leave_request_email_detail(req_id: str) -> dict | None:
    with cursor() as c:
        c.execute(
            """
            SELECT lr.*, u.full_name as employee_name, u.email as employee_email, lt.name as leave_type_name
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE lr.id = ?
            """,
            (req_id,),
        )
        row = c.fetchone()
    return row_to_dict(row) if row else None


def _notify_leave_approver(req_id: str, approver_id: str | None, intro: str):
    d = _leave_request_email_detail(req_id)
    if not d or not approver_id:
        return
    to = _user_email(approver_id)
    if not to:
        return
    emp = (d.get("employee_name") or "Employee").strip() or "Employee"
    leave_type = (d.get("leave_type_name") or "Leave").strip() or "Leave"
    days = float(d.get("days_requested") or 0)
    day_label = "day" if abs(days - 1.0) < 1e-9 else "days"
    lead = f"{emp} requested {leave_type} for {days:g} {day_label}. Login to approve."
    lines = [lead, "", intro, ""] + _leave_email_body(d)
    _send_leave_email([to], f"[Leave] Approval needed - {emp} ({leave_type}, {days:g} {day_label})", "\n".join(lines))


def _notify_leave_employee(req_id: str, title: str, extra: str = ""):
    d = _leave_request_email_detail(req_id)
    if not d:
        return
    to = d.get("employee_email") or _user_email(d.get("user_id") or "")
    if not to:
        return
    lines = [f"Dear {d.get('employee_name') or 'colleague'},", "", title, ""] + _leave_email_body(d)
    if extra:
        lines.extend(["", extra])
    _send_leave_email([to], f"[Leave] {title}", "\n".join(lines))


def _notify_leave_hr_info(subject: str, req_id: str, note: str):
    d = _leave_request_email_detail(req_id)
    if not d:
        return
    body = "\n".join([note, ""] + _leave_email_body(d))
    for em in _hr_notification_emails():
        _send_leave_email([em], subject, body)


def _send_app_email(to_addrs: list[str], subject: str, body: str) -> None:
    """Transactional email (certificates, appraisal) when SMTP is configured. Independent of leave_email_enabled."""
    cfg = _get_smtp_config()
    if not cfg.get("host") or not cfg.get("from"):
        return
    recipients = [a.strip() for a in to_addrs if a and "@" in a]
    if not recipients:
        return
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = cfg["from"]
        msg["To"] = ", ".join(recipients)
        msg.set_content(body)
        if cfg["port"] == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=context, timeout=45) as smtp:
                if cfg["user"] and cfg["password"]:
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=45) as smtp:
                if cfg["use_tls"]:
                    smtp.starttls(context=ssl.create_default_context())
                if cfg["user"] and cfg["password"]:
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        logger.info("App email sent: %s -> %s", subject, recipients)
    except Exception as e:
        logger.warning("App email failed (%s): %s", subject, e)


def _notification_emails_enabled() -> bool:
    """Feature flag for mirroring in-app notifications to user email.

    Priority:
    1) `NOTIFICATION_EMAIL_ENABLED` env (explicit override)
    2) `notification_email_enabled` setting (explicit override)
    3) fallback to leave email toggle so admins enabling SMTP for leave also get bell-email mirroring
    """
    env = (os.environ.get("NOTIFICATION_EMAIL_ENABLED") or "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    with cursor() as c:
        c.execute("SELECT value FROM settings WHERE key = ?", ("notification_email_enabled",))
        row = c.fetchone()
    if row and row[0] is not None and str(row[0]).strip() != "":
        v = str(row[0]).strip().lower().strip('"')
        return v in ("1", "true", "yes", "on")
    return _leave_emails_enabled()


def _notification_link_url(link: str | None) -> str | None:
    lk = (link or "").strip()
    if not lk:
        return None
    if lk.startswith("http://") or lk.startswith("https://"):
        return lk
    base = (
        os.environ.get("APP_WEB_URL")
        or os.environ.get("FRONTEND_BASE_URL")
        or _setting_str("app_web_url")
    ).strip().rstrip("/")
    if not base:
        return lk
    if not lk.startswith("/"):
        lk = f"/{lk}"
    return f"{base}{lk}"


def _insert_notification(recipient_id: str, kind: str, title: str, body: str | None, link: str | None):
    rid = (recipient_id or "").strip()
    if not rid:
        return
    nid = new_id()
    lk = (link or "").strip()[:500] or None
    with cursor() as c:
        c.execute(
            "INSERT INTO notifications (id, user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (nid, rid, (kind or "notice")[:80], (title or "Notice")[:500], body, lk, _now_iso()),
        )
    if _notification_emails_enabled():
        try:
            to = _user_email(rid)
            if to:
                parts = [(title or "Notification").strip()]
                b = (body or "").strip()
                if b:
                    parts.extend(["", b])
                full_link = _notification_link_url(lk)
                if full_link:
                    parts.extend(["", f"Open in HR Suite: {full_link}"])
                _send_app_email([to], f"[HR Suite] {(title or 'Notification').strip()}", "\n".join(parts))
        except Exception as ex:
            logger.warning("Notification email mirror failed (%s): %s", rid, ex)


def _employee_display_name(uid: str) -> str:
    u = _get_user_profile_min(uid) or {}
    return ((u.get("full_name") or u.get("email") or "Employee") or "").strip() or "Employee"


def _notify_leave_approver_inbox(req_id: str, approver_id: str | None):
    if not approver_id:
        return
    d = _leave_request_email_detail(req_id)
    emp = (d or {}).get("employee_name") or _employee_display_name((d or {}).get("user_id") or "")
    leave_type = (d or {}).get("leave_type_name") or "Leave"
    days = float((d or {}).get("days_requested") or 0)
    day_label = "day" if abs(days - 1.0) < 1e-9 else "days"
    title = f"{emp} requested {leave_type} for {days:g} {day_label}"
    sub = f"Dates: {(d or {}).get('start_date')} → {(d or {}).get('end_date')}. Login to approve."
    _insert_notification(approver_id, "leave_pending", title, sub, "/hr/leave")


def _notify_leave_employee_inbox(req_id: str, title: str, body: str | None = None):
    d = _leave_request_email_detail(req_id)
    if not d:
        return
    uid = (d.get("user_id") or "").strip()
    if not uid:
        return
    leave_type = (d.get("leave_type_name") or "Leave").strip() or "Leave"
    days = float(d.get("days_requested") or 0)
    day_label = "day" if abs(days - 1.0) < 1e-9 else "days"
    full_title = f"{title}: {leave_type} ({days:g} {day_label})"
    _insert_notification(uid, "leave_update", full_title, (body or "").strip() or None, "/employee/leave")


def _notify_leave_hr_inbox(req_id: str, title: str, body: str | None = None):
    d = _leave_request_email_detail(req_id)
    if not d:
        return
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE is_active = 1 AND role IN ('hr','admin')")
        recipients = [str(r[0]) for r in c.fetchall()]
    seen = set()
    for rid in recipients:
        if not rid or rid in seen:
            continue
        seen.add(rid)
        _insert_notification(rid, "leave_notice", title, (body or "").strip() or None, "/hr/leave")


def _notify_hr_admins_staff_certificate(staff_user_id: str, doc_title: str):
    staff_name = _employee_display_name(staff_user_id)
    title = f"New certificate: {staff_name}"
    body = f"{staff_name} uploaded a certificate: {doc_title or 'Document'}"
    link = "/hr/employees"
    with cursor() as c:
        c.execute("SELECT id FROM users WHERE is_active = 1 AND role IN ('hr','admin')")
        for (hid,) in c.fetchall():
            _insert_notification(hid, "staff_certificate", title, body, link)
    for em in _hr_notification_emails():
        _send_app_email([em], "[HR Suite] " + title, body + "\n\nReview under Employee records in the HR Suite.")


def _notify_manager_appraisal_submitted(manager_id: str | None, staff_id: str, work_label: str):
    if not manager_id:
        return
    staff_name = _employee_display_name(staff_id)
    title = f"{work_label} submitted: {staff_name}"
    body = f"{staff_name} submitted work for your review in Performance / Appraisal."
    _insert_notification(manager_id, "appraisal_pending", title, body, "/manager/appraisal")
    to = _user_email(manager_id)
    if to:
        _send_app_email([to], "[HR Suite] " + title, body + "\n\nOpen Appraisal (manager) in the HR Suite to continue.")


def _employee_leave_balance_display_year(uid: str, calendar_year: int | None = None) -> int:
    """
    Which `leave_balances.year` to show employees on Leave / dashboard.

    Orange imports often land on the entitlement policy year (e.g. 2025) while the clock shows 2026.
    Startup then backfills 2026 rows with statutory ANNUAL (~18), which would hide a 28.5 import on 2025.
    If the current year's ANNUAL row still matches the statutory template and an older year in-window
    has a higher ANNUAL allocation, use that older year. If there is no row for the current year, use
    the year with the highest ANNUAL allocation in the window.
    """
    cy = calendar_year or datetime.utcnow().year
    stat = _annual_entitlement_days(uid)
    lo = cy - 5
    with cursor() as c:
        c.execute(
            """
            SELECT lb.year, MAX(lb.allocated_days) AS mx
            FROM leave_balances lb
            JOIN leave_types lt ON lt.id = lb.leave_type_id AND UPPER(TRIM(lt.code)) = 'ANNUAL'
            WHERE lb.user_id = ? AND lb.year BETWEEN ? AND ?
            GROUP BY lb.year
            """,
            (uid, lo, cy),
        )
        per_year = {int(r[0]): float(r[1] or 0) for r in c.fetchall()}
    if not per_year:
        return cy
    cy_a = float(per_year.get(cy, -1.0))
    if cy not in per_year:
        return max(per_year.items(), key=lambda kv: (kv[1], kv[0]))[0]
    best_y, best_a = max(per_year.items(), key=lambda kv: (kv[1], kv[0]))
    # Allow small drift (e.g. 18.5 vs statutory 18) to still treat current year as "template" vs a richer import year.
    if best_y < cy and best_a > cy_a + 0.01 and abs(cy_a - stat) < 0.26:
        return best_y
    return cy


def _ensure_leave_balance_rows_for_user(uid: str, year: int) -> None:
    """
    Create missing leave_balances rows for this user/year (defaults / statutory for new ANNUAL rows only).
    Existing rows — including OrangeHRM imports — are not changed here.
    """
    if not (uid or "").strip():
        return
    annual_override = None
    raw = (os.getenv("HR_SUITE_ANNUAL_LEAVE_DAYS") or "").strip()
    if raw:
        try:
            annual_override = float(raw)
        except ValueError:
            pass
    with cursor() as c:
        c.execute("SELECT id, code, default_days FROM leave_types WHERE is_active = 1")
        types = [(r[0], (r[1] or "").strip().upper(), float(r[2] or 0)) for r in c.fetchall()]
    for lt_id, code, alloc in types:
        if code == "ANNUAL" and annual_override is not None:
            alloc = annual_override
        elif code == "ANNUAL":
            alloc = _annual_entitlement_days(uid)
        with cursor() as c:
            c.execute(
                "SELECT 1 FROM leave_balances WHERE user_id = ? AND leave_type_id = ? AND year = ? LIMIT 1",
                (uid, lt_id, year),
            )
            if c.fetchone():
                continue
        bid = new_id()
        with cursor() as c:
            c.execute(
                """
                INSERT INTO leave_balances (id, user_id, leave_type_id, year, allocated_days, used_days, remaining_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (bid, uid, lt_id, year, alloc, alloc, _now_iso(), _now_iso()),
            )


def _leave_balances_for_user(uid: str, year: int) -> list[dict]:
    """Return saved leave_balances from the DB (no statutory overwrite on read)."""
    with cursor() as c:
        c.execute(
            """
            SELECT lt.id as leave_type_id, lt.name as leave_name, lt.code as leave_code,
                COALESCE(lb.allocated_days, lt.default_days) as allocated_days,
                COALESCE(lb.used_days, 0) as used_days,
                COALESCE(lb.remaining_days, COALESCE(lb.allocated_days, lt.default_days) - COALESCE(lb.used_days, 0)) as remaining_days
            FROM leave_types lt
            LEFT JOIN leave_balances lb ON lb.leave_type_id = lt.id AND lb.user_id = ? AND lb.year = ?
            WHERE lt.is_active = 1
            ORDER BY lt.name
            """,
            (uid, year),
        )
        return [row_to_dict(r) for r in c.fetchall()]


class LeaveRequestCreate(BaseModel):
    leave_type_id: str
    start_date: str
    end_date: str
    reason: str | None = None


class LeaveRequestUpdate(BaseModel):
    leave_type_id: str
    start_date: str
    end_date: str
    reason: str | None = None


class LeaveRescheduleBody(BaseModel):
    start_date: str
    end_date: str
    reason: str | None = None
    leave_type_id: str | None = None


class LeaveAssignBody(BaseModel):
    """Supervisor/HR books leave for a staff member (appears in their My Leave as approved)."""

    staff_user_id: str
    leave_type_id: str
    start_date: str
    end_date: str
    reason: str | None = None


def _assert_can_assign_leave_for_staff(actor: dict, staff_id: str):
    role = (actor or {}).get("role") or ""
    aid = (actor or {}).get("id") or ""
    if role in ("admin", "hr"):
        return
    if role not in ("manager", "hod"):
        raise HTTPException(status_code=403, detail="Only a supervisor or HR can assign leave")
    with cursor() as c:
        c.execute(
            "SELECT id, manager_id, department, is_active FROM users WHERE id = ?",
            (staff_id,),
        )
        row = c.fetchone()
    if not row or not row[3]:
        raise HTTPException(status_code=404, detail="Staff member not found or inactive")
    if role == "manager":
        if (row[1] or "").strip() != aid:
            raise HTTPException(status_code=403, detail="You can only assign leave to your direct reports")
        return
    # hod: same rule as managers — direct reports only (manager_id), not whole department
    if role == "hod":
        if (row[1] or "").strip() != aid:
            raise HTTPException(status_code=403, detail="You can only assign leave to your direct reports")
        return


class LeaveActionBody(BaseModel):
    comment: str | None = None


class LeaveBalanceAdjustmentCreate(BaseModel):
    target_user_id: str
    leave_type_id: str
    year: int
    allocated_days: float
    reason: str | None = None


class LeaveTypeAssignCreate(BaseModel):
    target_user_id: str
    leave_type_id: str
    year: int
    allocated_days: float | None = None
    reason: str | None = None


class LeaveBalanceAdjustmentAction(BaseModel):
    comment: str | None = None


def _leave_balance_adjustment_row(adjustment_id: str) -> dict | None:
    with cursor() as c:
        c.execute(
            """
            SELECT a.*,
                   u.full_name AS target_user_name, u.email AS target_user_email, u.department AS target_user_department,
                   lt.name AS leave_type_name, lt.code AS leave_type_code,
                   rq.full_name AS requested_by_name, ap.full_name AS approved_by_name,
                   ca.full_name AS current_approver_name
            FROM leave_balance_adjustments a
            JOIN users u ON u.id = a.target_user_id
            JOIN leave_types lt ON lt.id = a.leave_type_id
            JOIN users rq ON rq.id = a.requested_by_user_id
            LEFT JOIN users ap ON ap.id = a.approved_by_user_id
            LEFT JOIN users ca ON ca.id = a.current_approver_id
            WHERE a.id = ?
            """,
            (adjustment_id,),
        )
        return row_to_dict(c.fetchone())


@app.get("/leave/types")
def list_leave_types(_: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM leave_types WHERE is_active = 1 ORDER BY name")
        return [row_to_dict(r) for r in c.fetchall()]


class LeaveTypeCreate(BaseModel):
    """HR/Admin: add a new leave type (code must be unique, letters/numbers/underscore)."""

    code: str
    name: str
    default_days: float = 0.0


@app.post("/leave/types")
def create_leave_type(body: LeaveTypeCreate, user_id: str = Depends(get_current_user_id)):
    _require_roles(user_id, ("admin", "hr"))
    raw_code = (body.code or "").strip().upper().replace(" ", "_").replace("-", "_")
    raw_code = "".join(ch for ch in raw_code if ch.isalnum() or ch == "_")
    if not raw_code or len(raw_code) > 40:
        raise HTTPException(status_code=400, detail="Invalid code: use letters, numbers, underscores (max 40).")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    try:
        dd = float(body.default_days or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="default_days must be a number")
    if dd < 0 or dd > 3660:
        raise HTTPException(status_code=400, detail="default_days out of range")
    lid = new_id()
    now = _now_iso()
    with cursor() as c:
        c.execute("SELECT id FROM leave_types WHERE UPPER(TRIM(code)) = UPPER(TRIM(?))", (raw_code,))
        if c.fetchone():
            raise HTTPException(status_code=400, detail="A leave type with this code already exists")
        c.execute(
            """
            INSERT INTO leave_types (id, code, name, default_days, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (lid, raw_code, name, dd, now, now),
        )
        c.execute("SELECT * FROM leave_types WHERE id = ?", (lid,))
        return row_to_dict(c.fetchone())


@app.delete("/leave/types/{leave_type_id}")
def delete_leave_type(leave_type_id: str, user_id: str = Depends(get_current_user_id)):
    _require_roles(user_id, ("admin",))
    with cursor() as c:
        c.execute("SELECT id, code, name FROM leave_types WHERE id = ? AND is_active = 1", (leave_type_id,))
        row = c.fetchone()
    lt = row_to_dict(row)
    if not lt:
        raise HTTPException(status_code=404, detail="Leave type not found")
    with cursor() as c:
        c.execute(
            "SELECT COUNT(*) FROM leave_requests WHERE leave_type_id = ? AND status IN ('submitted','pending_manager','pending_hod','pending_hr')",
            (leave_type_id,),
        )
        pending = int((c.fetchone() or [0])[0] or 0)
    if pending:
        raise HTTPException(status_code=400, detail="Cannot delete leave type with pending requests")
    with cursor() as c:
        c.execute(
            "UPDATE leave_types SET is_active = 0, updated_at = ? WHERE id = ?",
            (_now_iso(), leave_type_id),
        )
    _audit_log("leave_type_deleted", "leave_types", user_id, leave_type_id, {"code": lt.get("code"), "name": lt.get("name")})
    return {"ok": True, "id": leave_type_id}


@app.get("/leave/my-requests")
def list_my_leave_requests(user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute(
            """
            SELECT lr.*, lt.name as leave_type_name, creator.full_name as assigned_by_name
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            LEFT JOIN users creator ON creator.id = lr.created_by_user_id
            WHERE lr.user_id = ?
            ORDER BY lr.created_at DESC
            """,
            (user_id,),
        )
        return [row_to_dict(r) for r in c.fetchall()]


@app.post("/leave/requests")
def create_leave_request(req: LeaveRequestCreate, user_id: str = Depends(get_current_user_id)):
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    days_requested = _calculate_leave_days(req.start_date, req.end_date)
    with cursor() as c:
        c.execute("SELECT id FROM leave_types WHERE id = ? AND is_active = 1", (req.leave_type_id,))
        if not c.fetchone():
            raise HTTPException(status_code=400, detail="Invalid leave type")
    rid = new_id()
    with cursor() as c:
        c.execute(
            """
            INSERT INTO leave_requests (id, user_id, leave_type_id, start_date, end_date, days_requested, reason, status, created_at, updated_at, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)
            """,
            (rid, user_id, req.leave_type_id, req.start_date, req.end_date, days_requested, (req.reason or "").strip() or None, _now_iso(), _now_iso()),
        )
    _leave_log(rid, "created", user_id, current.get("role"), None, None, req.reason)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (rid,))
        return row_to_dict(c.fetchone())


@app.patch("/leave/requests/{leave_request_id}")
def update_leave_request(leave_request_id: str, body: LeaveRequestUpdate, user_id: str = Depends(get_current_user_id)):
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    role = (current.get("role") or "").strip().lower()
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        row = c.fetchone()
    req = row_to_dict(row)
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    is_owner = _norm_uid_compare(req.get("user_id"), user_id)
    is_hr_admin = role in ("hr", "admin")
    if not is_owner and not is_hr_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not is_hr_admin and req.get("status") not in ("draft", "returned"):
        raise HTTPException(status_code=400, detail="Only draft or returned requests can be edited")
    if req.get("status") in ("cancelled", "rejected"):
        raise HTTPException(status_code=400, detail="Cancelled or rejected requests cannot be edited")
    days_requested = _calculate_leave_days(body.start_date, body.end_date)
    with cursor() as c:
        c.execute("SELECT id FROM leave_types WHERE id = ? AND is_active = 1", (body.leave_type_id,))
        if not c.fetchone():
            raise HTTPException(status_code=400, detail="Invalid leave type")
    old_leave_type_id = req.get("leave_type_id")
    old_start = str(req.get("start_date") or "")
    old_days = float(req.get("days_requested") or 0)
    old_year = int(old_start[:4] or datetime.utcnow().year)
    old_status = (req.get("status") or "").strip().lower()
    new_year = int((body.start_date or "")[:4] or datetime.utcnow().year)
    with cursor() as c:
        c.execute(
            """
            UPDATE leave_requests
            SET leave_type_id = ?, start_date = ?, end_date = ?, days_requested = ?, reason = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                body.leave_type_id,
                body.start_date,
                body.end_date,
                days_requested,
                (body.reason or "").strip() or None,
                _now_iso(),
                leave_request_id,
            ),
        )
    if old_status == "approved":
        _apply_leave_balance_delta(req.get("user_id"), old_leave_type_id, old_year, -old_days)
        _apply_leave_balance_delta(req.get("user_id"), body.leave_type_id, new_year, float(days_requested))
    _leave_log(leave_request_id, "edited", user_id, role or None, None, None, body.reason)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        return row_to_dict(c.fetchone())


@app.post("/leave/assign")
def assign_leave_to_staff(body: LeaveAssignBody, user_id: str = Depends(get_current_user_id)):
    """Record approved leave for a team member (manager/HOD/HR/Admin). Shows on the employee's My Leave list."""
    actor = _get_user_profile_min(user_id)
    if not actor or not _user_is_active_row(actor):
        raise HTTPException(status_code=401, detail="User not found")
    staff_id = (body.staff_user_id or "").strip()
    if not staff_id:
        raise HTTPException(status_code=400, detail="staff_user_id is required")
    if staff_id == user_id:
        raise HTTPException(status_code=400, detail="Use the normal Apply flow for your own leave")
    _assert_can_assign_leave_for_staff(actor, staff_id)
    days_requested = _calculate_leave_days(body.start_date, body.end_date)
    with cursor() as c:
        c.execute("SELECT id FROM leave_types WHERE id = ? AND is_active = 1", (body.leave_type_id,))
        if not c.fetchone():
            raise HTTPException(status_code=400, detail="Invalid leave type")
    rid = new_id()
    now = _now_iso()
    reason = (body.reason or "").strip() or None
    with cursor() as c:
        c.execute(
            """
            INSERT INTO leave_requests (
                id, user_id, leave_type_id, start_date, end_date, days_requested, reason, status,
                current_approver_id, final_decision_by, final_decision_at, created_at, updated_at, created_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NULL, ?, ?, ?, ?, ?)
            """,
            (
                rid,
                staff_id,
                body.leave_type_id,
                body.start_date,
                body.end_date,
                days_requested,
                reason,
                user_id,
                now,
                now,
                now,
                user_id,
            ),
        )
    _leave_log(rid, "assigned", user_id, actor.get("role"), staff_id, "employee", reason)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (rid,))
        approved_row = row_to_dict(c.fetchone())
    _sync_leave_balance_for_approved(approved_row)
    extra = f"{body.start_date} → {body.end_date}"
    if reason:
        extra = f"{extra}. Note: {reason}"
    _notify_leave_employee(rid, "Leave was assigned to you by a supervisor.", extra)
    staff_prof = _get_user_profile_min(staff_id) or {}
    staff_nm = (staff_prof.get("full_name") or "Staff").strip() or "Staff"
    _notify_leave_hr_info(
        "[Leave] Assigned by supervisor",
        rid,
        f"{(actor.get('full_name') or actor.get('email') or 'Supervisor').strip()} assigned approved leave to {staff_nm} ({body.start_date} to {body.end_date}).",
    )
    with cursor() as c:
        c.execute(
            """
            SELECT lr.*, lt.name as leave_type_name, creator.full_name as assigned_by_name
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            LEFT JOIN users creator ON creator.id = lr.created_by_user_id
            WHERE lr.id = ?
            """,
            (rid,),
        )
        return row_to_dict(c.fetchone())


@app.post("/leave/requests/{leave_request_id}/submit")
def submit_leave_request(leave_request_id: str, user_id: str = Depends(get_current_user_id)):
    current = _get_user_profile_min(user_id)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        row = c.fetchone()
    req = row_to_dict(row)
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req["user_id"] != user_id and current.get("role") not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if req["status"] not in ("draft", "returned"):
        raise HTTPException(status_code=400, detail="Only draft or returned requests can be submitted")
    approver_id = _first_leave_approver(req["user_id"])
    if not approver_id:
        with cursor() as c:
            c.execute(
                "UPDATE leave_requests SET status = 'approved', current_approver_id = NULL, final_decision_by = ?, final_decision_at = ?, updated_at = ? WHERE id = ?",
                (user_id, _now_iso(), _now_iso(), leave_request_id),
            )
        _leave_log(leave_request_id, "auto_approved_no_approver", user_id, current.get("role"), None, None, None)
        with cursor() as c:
            c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
            approved = row_to_dict(c.fetchone())
        _sync_leave_balance_for_approved(approved)
        _notify_leave_employee(leave_request_id, "Your leave request was approved (no supervisor assigned in your profile).", "")
        _notify_leave_employee_inbox(leave_request_id, "Leave approved", "Your leave request was approved (no supervisor assigned).")
        _notify_leave_hr_info(
            "[Leave] Approved (auto)",
            leave_request_id,
            "A leave request was auto-approved (no active supervisor on file - set Manager / report-to in People).",
        )
        _notify_leave_hr_inbox(leave_request_id, "Leave approved (auto)", "No active supervisor was assigned, so the request auto-approved.")
        return approved
    approver_profile = _get_user_profile_min(approver_id)
    approver_role = (approver_profile or {}).get("role") or "supervisor"
    next_status = "pending_manager"
    with cursor() as c:
        c.execute(
            "UPDATE leave_requests SET status = ?, current_approver_id = ?, updated_at = ? WHERE id = ?",
            (next_status, approver_id, _now_iso(), leave_request_id),
        )
    _leave_log(leave_request_id, "submitted", user_id, current.get("role"), approver_id, approver_role, None)
    _notify_leave_approver(
        leave_request_id,
        approver_id,
        "You are the current approver: a team member submitted a leave request. Sign in to the HR Suite dashboard or Leave approvals to review it.",
    )
    _notify_leave_approver_inbox(leave_request_id, approver_id)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        return row_to_dict(c.fetchone())


@app.post("/leave/requests/{leave_request_id}/cancel")
def cancel_leave_request(leave_request_id: str, body: LeaveActionBody, user_id: str = Depends(get_current_user_id)):
    current = _get_user_profile_min(user_id)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        row = c.fetchone()
    req = row_to_dict(row)
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req["user_id"] != user_id and current.get("role") not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if req["status"] in ("approved", "rejected", "cancelled"):
        raise HTTPException(status_code=400, detail="Request cannot be cancelled in current status")
    with cursor() as c:
        c.execute(
            "UPDATE leave_requests SET status = 'cancelled', current_approver_id = NULL, updated_at = ? WHERE id = ?",
            (_now_iso(), leave_request_id),
        )
    _leave_log(leave_request_id, "cancelled", user_id, current.get("role"), None, None, body.comment)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        return row_to_dict(c.fetchone())


@app.post("/leave/requests/{leave_request_id}/reschedule")
def reschedule_approved_leave_request(
    leave_request_id: str,
    body: LeaveRescheduleBody,
    user_id: str = Depends(get_current_user_id),
):
    """Owner (or HR/Admin) asks to move an already-approved leave to new dates; resubmits into supervisor approval."""
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    role = (current.get("role") or "").strip().lower()
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        row = c.fetchone()
    req = row_to_dict(row)
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    is_owner = _norm_uid_compare(req.get("user_id"), user_id)
    if not is_owner and role not in ("hr", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if (req.get("status") or "").strip().lower() != "approved":
        raise HTTPException(status_code=400, detail="Only approved leave can be rescheduled")

    next_leave_type_id = (body.leave_type_id or req.get("leave_type_id") or "").strip()
    if not next_leave_type_id:
        raise HTTPException(status_code=400, detail="leave_type_id is required")
    with cursor() as c:
        c.execute("SELECT id FROM leave_types WHERE id = ? AND is_active = 1", (next_leave_type_id,))
        if not c.fetchone():
            raise HTTPException(status_code=400, detail="Invalid leave type")
    new_days = _calculate_leave_days(body.start_date, body.end_date)
    old_leave_type_id = req.get("leave_type_id")
    old_year = int(str(req.get("start_date") or "")[:4] or datetime.utcnow().year)
    old_days = float(req.get("days_requested") or 0)
    new_year = int(str(body.start_date or "")[:4] or datetime.utcnow().year)

    # Remove the already-approved balance impact before we re-submit.
    _apply_leave_balance_delta(req.get("user_id"), old_leave_type_id, old_year, -old_days)

    approver_id = _first_leave_approver(req.get("user_id") or "")
    now = _now_iso()
    if approver_id:
        with cursor() as c:
            c.execute(
                """
                UPDATE leave_requests
                SET leave_type_id = ?, start_date = ?, end_date = ?, days_requested = ?, reason = ?,
                    status = 'pending_manager', current_approver_id = ?, final_decision_by = NULL, final_decision_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (
                    next_leave_type_id,
                    body.start_date,
                    body.end_date,
                    new_days,
                    (body.reason or "").strip() or req.get("reason"),
                    approver_id,
                    now,
                    leave_request_id,
                ),
            )
        _leave_log(leave_request_id, "reschedule_submitted", user_id, role or None, approver_id, "supervisor", body.reason)
        _notify_leave_approver(
            leave_request_id,
            approver_id,
            "A staff member rescheduled an already-approved leave request. Sign in to review and approve the new dates.",
        )
        _notify_leave_approver_inbox(leave_request_id, approver_id)
        _notify_leave_employee_inbox(
            leave_request_id,
            "Reschedule submitted",
            "Your approved leave was changed and submitted again for supervisor approval.",
        )
    else:
        with cursor() as c:
            c.execute(
                """
                UPDATE leave_requests
                SET leave_type_id = ?, start_date = ?, end_date = ?, days_requested = ?, reason = ?,
                    status = 'approved', current_approver_id = NULL, final_decision_by = ?, final_decision_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    next_leave_type_id,
                    body.start_date,
                    body.end_date,
                    new_days,
                    (body.reason or "").strip() or req.get("reason"),
                    user_id,
                    now,
                    now,
                    leave_request_id,
                ),
            )
        _apply_leave_balance_delta(req.get("user_id"), next_leave_type_id, new_year, new_days)
        _leave_log(leave_request_id, "reschedule_auto_approved_no_approver", user_id, role or None, None, None, body.reason)
        _notify_leave_employee(leave_request_id, "Your leave reschedule was approved (no supervisor assigned).", "")
        _notify_leave_employee_inbox(leave_request_id, "Reschedule approved", "No supervisor is assigned, so the reschedule was auto-approved.")
        _notify_leave_hr_info(
            "[Leave] Reschedule approved (auto)",
            leave_request_id,
            "A rescheduled leave request was auto-approved because no active supervisor is assigned.",
        )
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        return row_to_dict(c.fetchone())


@app.get("/leave/pending")
def get_pending_leave_requests(user_id: str = Depends(get_current_user_id)):
    """Supervisor chain (OrangeHRM-style): inbox is only requests where you are the current approver."""
    y = datetime.utcnow().year
    with cursor() as c:
        c.execute(
            """
            SELECT lr.*, u.full_name as staff_name, u.email as staff_email, lt.name as leave_type_name
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE lr.current_approver_id = ?
            ORDER BY lr.created_at DESC
            """,
            (user_id,),
        )
        rows = [row_to_dict(r) for r in c.fetchall()]
    for d in rows:
        suid = d.get("user_id")
        if suid:
            _ensure_leave_balance_rows_for_user(suid, y)
            d["requester_balances"] = _leave_balances_for_user(suid, y)
        else:
            d["requester_balances"] = []
    return rows


def _act_on_leave(leave_request_id: str, user_id: str, action: str, body: LeaveActionBody):
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        row = c.fetchone()
    req = row_to_dict(row)
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.get("current_approver_id") != user_id:
        raise HTTPException(status_code=403, detail="You are not the current approver")
    if not _is_user_in_requester_supervisor_chain(req.get("user_id") or "", user_id):
        raise HTTPException(status_code=403, detail="Only supervisors in the employee's reporting line can approve or reject")
    if req.get("status") not in ("pending_manager", "pending_hod", "pending_hr"):
        raise HTTPException(status_code=400, detail="Leave request is not pending approval")
    comment = (body.comment or "").strip()
    if action in ("reject", "return") and not comment:
        raise HTTPException(status_code=400, detail="Comment is required for this action")
    if action == "approve":
        with cursor() as c:
            c.execute(
                """
                UPDATE leave_requests
                SET status = 'approved', current_approver_id = NULL, final_decision_by = ?, final_decision_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (user_id, _now_iso(), _now_iso(), leave_request_id),
            )
        _leave_log(leave_request_id, "approved", user_id, current.get("role"), None, None, comment or None)
        with cursor() as c:
            c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
            approved = row_to_dict(c.fetchone())
        _sync_leave_balance_for_approved(approved)
        extra = f"Approver note: {comment}" if comment else ""
        _notify_leave_employee(leave_request_id, "Your leave request was approved by your supervisor.", extra)
        _notify_leave_employee_inbox(leave_request_id, "Leave approved", extra or "Your leave request was approved by your supervisor.")
        _notify_leave_hr_info(
            "[Leave] Supervisor approval",
            leave_request_id,
            "A leave request was approved by the assigned supervisor.",
        )
        _notify_leave_hr_inbox(
            leave_request_id,
            "Leave approved by supervisor",
            "A leave request was approved by the assigned supervisor.",
        )
        return approved
    elif action == "reject":
        with cursor() as c:
            c.execute(
                """
                UPDATE leave_requests
                SET status = 'rejected', current_approver_id = NULL, final_decision_by = ?, final_decision_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (user_id, _now_iso(), _now_iso(), leave_request_id),
            )
        _leave_log(leave_request_id, "rejected", user_id, current.get("role"), req.get("user_id"), "employee", comment)
        _notify_leave_employee(leave_request_id, "Your leave request was rejected.", f"Comment: {comment}")
        _notify_leave_hr_info("[Leave] Rejected", leave_request_id, f"Rejected by workflow. Comment: {comment}")
        _notify_leave_employee_inbox(leave_request_id, "Leave rejected", f"Comment: {comment}")
        _notify_leave_hr_inbox(leave_request_id, "Leave rejected", f"Rejected by workflow. Comment: {comment}")
    elif action == "return":
        with cursor() as c:
            c.execute(
                "UPDATE leave_requests SET status = 'returned', current_approver_id = NULL, updated_at = ? WHERE id = ?",
                (_now_iso(), leave_request_id),
            )
        _leave_log(leave_request_id, "returned", user_id, current.get("role"), req.get("user_id"), "employee", comment)
        _notify_leave_employee(leave_request_id, "Your leave request was returned for changes.", f"Comment: {comment}")
        _notify_leave_hr_info("[Leave] Returned", leave_request_id, f"Returned to employee for changes. Comment: {comment}")
        _notify_leave_employee_inbox(leave_request_id, "Leave returned for changes", f"Comment: {comment}")
        _notify_leave_hr_inbox(leave_request_id, "Leave returned", f"Returned to employee for changes. Comment: {comment}")
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        return row_to_dict(c.fetchone())


@app.post("/leave/requests/{leave_request_id}/approve")
def approve_leave_request(leave_request_id: str, body: LeaveActionBody, user_id: str = Depends(get_current_user_id)):
    return _act_on_leave(leave_request_id, user_id, "approve", body)


@app.post("/leave/requests/{leave_request_id}/reject")
def reject_leave_request(leave_request_id: str, body: LeaveActionBody, user_id: str = Depends(get_current_user_id)):
    return _act_on_leave(leave_request_id, user_id, "reject", body)


@app.post("/leave/requests/{leave_request_id}/return")
def return_leave_request(leave_request_id: str, body: LeaveActionBody, user_id: str = Depends(get_current_user_id)):
    return _act_on_leave(leave_request_id, user_id, "return", body)


@app.post("/leave/requests/{leave_request_id}/remind-approver")
def remind_leave_approver(leave_request_id: str, user_id: str = Depends(get_current_user_id)):
    _require_roles(user_id, ("hr", "admin"))
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        row = c.fetchone()
    req = row_to_dict(row)
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if (req.get("status") or "").strip().lower() not in ("submitted", "pending_manager", "pending_hod", "pending_hr"):
        raise HTTPException(status_code=400, detail="Only pending requests can be reminded")
    approver_id = (req.get("current_approver_id") or "").strip()
    if not approver_id:
        raise HTTPException(status_code=400, detail="No current approver assigned")
    _notify_leave_approver(
        leave_request_id,
        approver_id,
        "Reminder from HR: a leave request is waiting for your approval. Please sign in and review it.",
    )
    _notify_leave_approver_inbox(leave_request_id, approver_id)
    _audit_log(
        "leave_approver_reminder_sent",
        "leave_requests",
        user_id,
        leave_request_id,
        {"approver_id": approver_id},
    )
    return {"ok": True, "leave_request_id": leave_request_id, "approver_id": approver_id}


@app.get("/leave/requests/{leave_request_id}/workflow")
def get_leave_workflow(leave_request_id: str, user_id: str = Depends(get_current_user_id)):
    current = _get_user_profile_min(user_id)
    with cursor() as c:
        c.execute("SELECT * FROM leave_requests WHERE id = ?", (leave_request_id,))
        row = c.fetchone()
    req = row_to_dict(row)
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.get("user_id") != user_id and current.get("role") not in ("admin", "hr", "manager", "hod"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute(
            """
            SELECT l.*, u.full_name as from_name, t.full_name as to_name
            FROM leave_workflow_logs l
            LEFT JOIN users u ON u.id = l.from_user_id
            LEFT JOIN users t ON t.id = l.to_user_id
            WHERE leave_request_id = ?
            ORDER BY created_at ASC
            """,
            (leave_request_id,),
        )
        logs = [row_to_dict(r) for r in c.fetchall()]
    return {"request": req, "logs": logs}


@app.get("/leave/reports/summary")
def leave_reports_summary(
    from_date: str | None = None,
    to_date: str | None = None,
    as_of: str | None = None,
    department: str | None = None,
    balance_year: int | None = None,
    user_id: str = Depends(get_current_user_id),
):
    """HR leave analytics: period uses calendar overlap (any leave touching the range). Department from user profile; blank → 'Unassigned'."""
    _require_roles(user_id, ("hr", "admin"))
    today = datetime.utcnow().strftime("%Y-%m-%d")
    fd = from_date or (datetime.utcnow() - timedelta(days=365)).strftime("%Y-%m-%d")
    td = to_date or today
    _parse_yyyy_mm_dd(fd)
    _parse_yyyy_mm_dd(td)
    if fd > td:
        raise HTTPException(status_code=400, detail="from_date must be on or before to_date")
    as_of_d = as_of or today
    _parse_yyyy_mm_dd(as_of_d)
    by = int(str(as_of_d)[:4])
    if balance_year is not None:
        if balance_year < 1990 or balance_year > 2100:
            raise HTTPException(status_code=400, detail="balance_year must be between 1990 and 2100")
        by = int(balance_year)

    dept_filter_lr = ""
    dept_params: list = []
    if department and str(department).strip():
        dept_filter_lr = " AND TRIM(COALESCE(u.department, '')) = TRIM(?) "
        dept_params = [department.strip()]

    dept_filter_u = ""
    if department and str(department).strip():
        dept_filter_u = " AND TRIM(COALESCE(u.department, '')) = TRIM(?) "

    overlap = "(lr.start_date <= ? AND lr.end_date >= ?)"
    overlap_params = [td, fd]

    dept_expr_u = "COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned')"
    dept_expr_plain = "COALESCE(NULLIF(TRIM(department), ''), 'Unassigned')"
    active_u = "u.is_active = 1 AND COALESCE(TRIM(u.role), '') != 'admin'"
    active_plain = "is_active = 1 AND COALESCE(TRIM(role), '') != 'admin'"

    with cursor() as c:
        c.execute(
            f"""
            SELECT lr.status, COUNT(*) AS count FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            WHERE {overlap}
            {dept_filter_lr}
            """,
            tuple(overlap_params + dept_params),
        )
        by_status = [row_to_dict(r) for r in c.fetchall()]

        c.execute(
            f"""
            SELECT u.full_name, u.email, {dept_expr_u} AS department,
                   COALESCE(b.name, '') AS branch_name,
                   COALESCE(TRIM(u.phone), '') AS phone,
                   COUNT(*) AS total_requests, SUM(lr.days_requested) AS total_days
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE {overlap}
            {dept_filter_lr}
            GROUP BY lr.user_id
            ORDER BY total_requests DESC
            LIMIT 30
            """,
            tuple(overlap_params + dept_params),
        )
        top_requesters = [row_to_dict(r) for r in c.fetchall()]

        c.execute(
            f"""
            SELECT u.full_name, u.email, {dept_expr_u} AS department,
                   COALESCE(b.name, '') AS branch_name,
                   COALESCE(TRIM(u.phone), '') AS phone,
                   SUM(CASE WHEN lr.status = 'approved' THEN lr.days_requested ELSE 0 END) AS approved_days,
                   SUM(CASE WHEN lr.status = 'approved' THEN 1 ELSE 0 END) AS approved_requests,
                   SUM(CASE WHEN lr.status IN ('submitted','pending_manager','pending_hod','pending_hr','returned')
                        THEN lr.days_requested ELSE 0 END) AS pending_days,
                   SUM(CASE WHEN lr.status IN ('submitted','pending_manager','pending_hod','pending_hr','returned')
                        THEN 1 ELSE 0 END) AS pending_requests,
                   COUNT(*) AS total_requests,
                   SUM(lr.days_requested) AS total_days
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE {overlap}
              AND {active_u}
            {dept_filter_lr}
            GROUP BY lr.user_id
            ORDER BY approved_days DESC, pending_days DESC, u.full_name COLLATE NOCASE
            LIMIT 400
            """,
            tuple(overlap_params + dept_params),
        )
        staff_leave_activity = [row_to_dict(r) for r in c.fetchall()]

        c.execute(
            f"""
            SELECT {dept_expr_u} AS department,
                   COUNT(*) AS total_requests,
                   SUM(lr.days_requested) AS total_days,
                   SUM(CASE WHEN lr.status = 'approved' THEN lr.days_requested ELSE 0 END) AS approved_days,
                   SUM(CASE WHEN lr.status = 'approved' THEN 1 ELSE 0 END) AS approved_requests,
                   SUM(CASE WHEN lr.status IN ('submitted','pending_manager','pending_hod','pending_hr','returned')
                        THEN lr.days_requested ELSE 0 END) AS pending_days,
                   SUM(CASE WHEN lr.status IN ('submitted','pending_manager','pending_hod','pending_hr','returned')
                        THEN 1 ELSE 0 END) AS pending_requests
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            WHERE {overlap}
            {dept_filter_lr}
            GROUP BY department
            """,
            tuple(overlap_params + dept_params),
        )
        req_by_dept = {row_to_dict(r)["department"]: row_to_dict(r) for r in c.fetchall()}

        c.execute(
            f"""
            SELECT {dept_expr_plain} AS department, COUNT(*) AS active_staff
            FROM users
            WHERE {active_plain}
            {dept_filter_u}
            GROUP BY department
            """,
            tuple(dept_params),
        )
        active_by_dept = {row_to_dict(r)["department"]: row_to_dict(r) for r in c.fetchall()}

        c.execute(
            f"""
            SELECT {dept_expr_u} AS department, COUNT(DISTINCT lr.user_id) AS on_leave
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            WHERE lr.status = 'approved'
              AND lr.start_date <= ? AND lr.end_date >= ?
              AND NOT EXISTS (
                  SELECT 1 FROM attendance_logs al
                  WHERE al.user_id = lr.user_id
                    AND substr(COALESCE(al.clock_in_at, ''), 1, 10) = ?
              )
              AND {active_u}
            {dept_filter_lr}
            GROUP BY department
            """,
            tuple([as_of_d, as_of_d, as_of_d] + dept_params),
        )
        on_leave_by_dept = {row_to_dict(r)["department"]: row_to_dict(r) for r in c.fetchall()}

        c.execute(
            f"""
            SELECT COUNT(DISTINCT lr.user_id) AS n
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            WHERE lr.status = 'approved'
              AND lr.start_date <= ? AND lr.end_date >= ?
              AND NOT EXISTS (
                  SELECT 1 FROM attendance_logs al
                  WHERE al.user_id = lr.user_id
                    AND substr(COALESCE(al.clock_in_at, ''), 1, 10) = ?
              )
              AND {active_u}
            {dept_filter_lr}
            """,
            tuple([as_of_d, as_of_d, as_of_d] + dept_params),
        )
        on_leave_total = int((c.fetchone() or [0])[0] or 0)

        c.execute(
            f"""
            SELECT lr.id, u.full_name, u.email, {dept_expr_u} AS department,
                   COALESCE(b.name, '') AS branch_name,
                   COALESCE(TRIM(u.phone), '') AS phone,
                   lr.start_date, lr.end_date, lr.days_requested, lt.name AS leave_type_name
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE lr.status = 'approved'
              AND lr.start_date <= ? AND lr.end_date >= ?
              AND NOT EXISTS (
                  SELECT 1 FROM attendance_logs al
                  WHERE al.user_id = lr.user_id
                    AND substr(COALESCE(al.clock_in_at, ''), 1, 10) = ?
              )
              AND {active_u}
            {dept_filter_lr}
            ORDER BY {dept_expr_u} COLLATE NOCASE, u.full_name COLLATE NOCASE
            LIMIT 200
            """,
            tuple([as_of_d, as_of_d, as_of_d] + dept_params),
        )
        on_leave_rows = [row_to_dict(r) for r in c.fetchall()]

        c.execute(
            f"""
            SELECT lr.id, u.full_name, u.email, {dept_expr_u} AS department,
                   COALESCE(b.name, '') AS branch_name,
                   COALESCE(TRIM(u.phone), '') AS phone,
                   lr.start_date, lr.end_date, lr.days_requested, lt.name AS leave_type_name,
                   lr.status, lr.final_decision_at
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE {overlap}
              AND lr.status = 'approved'
              AND {active_u}
            {dept_filter_lr}
            ORDER BY lr.final_decision_at DESC, u.full_name COLLATE NOCASE
            LIMIT 500
            """,
            tuple(overlap_params + dept_params),
        )
        approved_requests_rows = [row_to_dict(r) for r in c.fetchall()]

        c.execute(
            f"""
            SELECT lr.id, u.full_name, u.email, {dept_expr_u} AS department,
                   COALESCE(b.name, '') AS branch_name,
                   COALESCE(TRIM(u.phone), '') AS phone,
                   lr.start_date, lr.end_date, lr.days_requested, lt.name AS leave_type_name,
                   lr.status, lr.updated_at
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE {overlap}
              AND lr.status IN ('submitted','pending_manager','pending_hod','pending_hr','returned')
              AND {active_u}
            {dept_filter_lr}
            ORDER BY lr.updated_at DESC, u.full_name COLLATE NOCASE
            LIMIT 500
            """,
            tuple(overlap_params + dept_params),
        )
        pending_requests_rows = [row_to_dict(r) for r in c.fetchall()]

        c.execute(
            f"""
            SELECT COUNT(*) AS n FROM users u
            WHERE {active_u}
            {dept_filter_u}
            AND NOT EXISTS (
                SELECT 1 FROM leave_requests lr
                WHERE lr.user_id = u.id AND lr.status = 'approved'
                  AND lr.start_date <= ? AND lr.end_date >= ?
            )
            """,
            tuple(dept_params + [td, fd]),
        )
        no_leave_total = int((c.fetchone() or [0])[0] or 0)

        c.execute(
            f"""
            SELECT u.full_name, u.email, {dept_expr_u} AS department, u.role,
                   COALESCE(b.name, '') AS branch_name,
                   COALESCE(TRIM(u.phone), '') AS phone
            FROM users u
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE {active_u}
            {dept_filter_u}
            AND NOT EXISTS (
                SELECT 1 FROM leave_requests lr
                WHERE lr.user_id = u.id AND lr.status = 'approved'
                  AND lr.start_date <= ? AND lr.end_date >= ?
            )
            ORDER BY {dept_expr_u} COLLATE NOCASE, u.full_name COLLATE NOCASE
            LIMIT 400
            """,
            tuple(dept_params + [td, fd]),
        )
        no_leave_rows = [row_to_dict(r) for r in c.fetchall()]

        c.execute(
            f"""
            SELECT {dept_expr_u} AS department, COUNT(*) AS n
            FROM users u
            WHERE {active_u}
            {dept_filter_u}
            AND NOT EXISTS (
                SELECT 1 FROM leave_requests lr
                WHERE lr.user_id = u.id AND lr.status = 'approved'
                  AND lr.start_date <= ? AND lr.end_date >= ?
            )
            GROUP BY department
            """,
            tuple(dept_params + [td, fd]),
        )
        no_leave_by_dept = {}
        for r in c.fetchall():
            d = row_to_dict(r)
            no_leave_by_dept[d["department"]] = int(d.get("n") or 0)

        c.execute(
            f"""
            SELECT COUNT(*) AS n FROM users u
            WHERE {active_u}
            {dept_filter_u}
            """,
            tuple(dept_params),
        )
        staff_in_scope = int((c.fetchone() or [0])[0] or 0)

        c.execute(
            f"""
            SELECT u.id AS user_id, u.full_name, u.email, {dept_expr_u} AS department,
                   COALESCE(b.name, '') AS branch_name,
                   COALESCE(TRIM(u.phone), '') AS phone,
                   lt.name AS leave_type_name,
                   COALESCE(lb.allocated_days, lt.default_days) AS allocated_days,
                   COALESCE(lb.used_days, 0) AS used_days,
                   COALESCE(lb.remaining_days, COALESCE(lb.allocated_days, lt.default_days) - COALESCE(lb.used_days, 0)) AS remaining_days
            FROM users u
            JOIN leave_types lt ON lt.is_active = 1
            LEFT JOIN leave_balances lb
              ON lb.user_id = u.id AND lb.leave_type_id = lt.id AND lb.year = ?
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE {active_u}
            {dept_filter_u}
            ORDER BY u.full_name COLLATE NOCASE, lt.name COLLATE NOCASE
            LIMIT 8000
            """,
            (by,) + tuple(dept_params),
        )
        staff_leave_balance_rows = [row_to_dict(r) for r in c.fetchall()]

    totals_by_user: dict[str, dict] = {}
    for r in staff_leave_balance_rows:
        uid = str(r.get("user_id") or "")
        if not uid:
            continue
        rem = float(r.get("remaining_days") or 0)
        if uid not in totals_by_user:
            totals_by_user[uid] = {
                "user_id": uid,
                "full_name": r.get("full_name"),
                "email": r.get("email"),
                "department": r.get("department"),
                "branch_name": r.get("branch_name"),
                "phone": r.get("phone"),
                "total_remaining_days": 0.0,
            }
        totals_by_user[uid]["total_remaining_days"] = round(totals_by_user[uid]["total_remaining_days"] + rem, 2)
    staff_leave_balance_totals = sorted(
        totals_by_user.values(),
        key=lambda x: ((x.get("full_name") or "") or "").lower(),
    )

    all_depts = set(active_by_dept) | set(req_by_dept) | set(on_leave_by_dept) | set(no_leave_by_dept.keys())

    def dept_sort_key(d):
        return (0 if d == "Unassigned" else 1, (d or "").lower())

    department_breakdown = []
    for dept in sorted(all_depts, key=dept_sort_key):
        rb = req_by_dept.get(dept, {})
        ab = active_by_dept.get(dept, {})
        ob = on_leave_by_dept.get(dept, {})
        department_breakdown.append(
            {
                "department": dept,
                "active_staff": int(ab.get("active_staff") or 0),
                "on_leave_as_of": int(ob.get("on_leave") or 0),
                "requests_in_period": int(rb.get("total_requests") or 0),
                "total_days_in_period": round(float(rb.get("total_days") or 0), 2),
                "approved_days_in_period": round(float(rb.get("approved_days") or 0), 2),
                "approved_requests_in_period": int(rb.get("approved_requests") or 0),
                "pending_days_in_period": round(float(rb.get("pending_days") or 0), 2),
                "pending_requests_in_period": int(rb.get("pending_requests") or 0),
                "no_approved_leave_in_period": int(no_leave_by_dept.get(dept, 0)),
            }
        )

    total_requests = sum(int(r.get("count") or 0) for r in by_status)
    approved = next((int(r.get("count") or 0) for r in by_status if r.get("status") == "approved"), 0)
    rejected = next((int(r.get("count") or 0) for r in by_status if r.get("status") == "rejected"), 0)

    by_department_simple = [
        {
            "department": row["department"],
            "total_requests": row["requests_in_period"],
            "total_days": row["total_days_in_period"],
            "approved_days": row["approved_days_in_period"],
            "pending_days": row["pending_days_in_period"],
        }
        for row in department_breakdown
    ]

    approved_days_period_total = round(
        sum(float(r.get("approved_days_in_period") or 0) for r in department_breakdown), 2
    )
    pending_days_period_total = round(
        sum(float(r.get("pending_days_in_period") or 0) for r in department_breakdown), 2
    )
    pending_requests_period_total = sum(int(r.get("pending_requests_in_period") or 0) for r in department_breakdown)

    return {
        "period": {"from_date": fd, "to_date": td, "as_of": as_of_d, "balance_year": by},
        "note": "",
        "staff_in_scope": staff_in_scope,
        "on_leave_as_of_count": on_leave_total,
        "on_leave_as_of": on_leave_rows,
        "staff_leave_balance_rows": staff_leave_balance_rows,
        "staff_leave_balance_totals": staff_leave_balance_totals,
        "no_approved_leave_in_period_count": no_leave_total,
        "no_approved_leave_in_period": no_leave_rows,
        "total_requests": total_requests,
        "approved_count": approved,
        "rejected_count": rejected,
        "approval_rate_pct": round((approved / total_requests) * 100, 1) if total_requests else 0,
        "rejection_rate_pct": round((rejected / total_requests) * 100, 1) if total_requests else 0,
        "by_status": by_status,
        "by_department": by_department_simple,
        "department_breakdown": department_breakdown,
        "top_requesters": top_requesters,
        "staff_leave_activity": staff_leave_activity,
        "approved_requests_rows": approved_requests_rows,
        "pending_requests_rows": pending_requests_rows,
        "leave_totals_in_period": {
            "approved_days": approved_days_period_total,
            "pending_days": pending_days_period_total,
            "pending_requests": pending_requests_period_total,
        },
    }


@app.get("/leave/reports/workflow-analytics")
def leave_workflow_analytics(
    from_date: str | None = None,
    to_date: str | None = None,
    department: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Workflow-focused leave report for HR visibility:
    - decision cycle times (created -> final decision)
    - pending ageing buckets
    - action volume by reviewer
    - workflow action mix
    """
    _require_roles(user_id, ("hr", "admin"))
    td = to_date or datetime.utcnow().strftime("%Y-%m-%d")
    fd = from_date or (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
    _parse_yyyy_mm_dd(fd)
    _parse_yyyy_mm_dd(td)
    if td < fd:
        raise HTTPException(status_code=400, detail="to_date cannot be before from_date")

    dept_clause = ""
    params_common: list = [fd, td]
    if department and department.strip():
        dept_clause = " AND TRIM(COALESCE(u.department,'')) = TRIM(?) "
        params_common.append(department.strip())

    with cursor() as c:
        c.execute(
            f"""
            SELECT
                COUNT(*) AS decided_count,
                COALESCE(AVG((julianday(lr.final_decision_at) - julianday(lr.created_at)) * 24.0), 0) AS avg_hours,
                COALESCE(MIN((julianday(lr.final_decision_at) - julianday(lr.created_at)) * 24.0), 0) AS min_hours,
                COALESCE(MAX((julianday(lr.final_decision_at) - julianday(lr.created_at)) * 24.0), 0) AS max_hours
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            WHERE lr.status IN ('approved','rejected')
              AND lr.final_decision_at IS NOT NULL
              AND substr(COALESCE(lr.final_decision_at,''), 1, 10) >= ?
              AND substr(COALESCE(lr.final_decision_at,''), 1, 10) <= ?
              {dept_clause}
            """,
            tuple(params_common),
        )
        row = c.fetchone()
        decided = {
            "count": int((row[0] or 0) if row else 0),
            "avg_hours_to_decision": round(float((row[1] or 0) if row else 0), 2),
            "min_hours_to_decision": round(float((row[2] or 0) if row else 0), 2),
            "max_hours_to_decision": round(float((row[3] or 0) if row else 0), 2),
        }

    now_iso = datetime.utcnow().isoformat()
    with cursor() as c:
        c.execute(
            f"""
            SELECT
                SUM(CASE WHEN (julianday(?) - julianday(lr.created_at)) * 24.0 < 24 THEN 1 ELSE 0 END) AS lt_24h,
                SUM(CASE WHEN (julianday(?) - julianday(lr.created_at)) * 24.0 >= 24 AND (julianday(?) - julianday(lr.created_at)) * 24.0 < 72 THEN 1 ELSE 0 END) AS h24_72,
                SUM(CASE WHEN (julianday(?) - julianday(lr.created_at)) * 24.0 >= 72 AND (julianday(?) - julianday(lr.created_at)) * 24.0 < 168 THEN 1 ELSE 0 END) AS h72_168,
                SUM(CASE WHEN (julianday(?) - julianday(lr.created_at)) * 24.0 >= 168 THEN 1 ELSE 0 END) AS gte_168h,
                COUNT(*) AS pending_total
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            WHERE lr.status IN ('submitted','pending_manager','pending_hod','pending_hr','returned')
              AND substr(COALESCE(lr.created_at,''), 1, 10) >= ?
              AND substr(COALESCE(lr.created_at,''), 1, 10) <= ?
              {dept_clause}
            """,
            tuple([now_iso, now_iso, now_iso, now_iso, now_iso, now_iso, fd, td] + ([department.strip()] if department and department.strip() else [])),
        )
        pr = c.fetchone()
    pending_age = {
        "lt_24h": int((pr[0] or 0) if pr else 0),
        "h24_72": int((pr[1] or 0) if pr else 0),
        "h72_168": int((pr[2] or 0) if pr else 0),
        "gte_168h": int((pr[3] or 0) if pr else 0),
        "pending_total": int((pr[4] or 0) if pr else 0),
    }

    with cursor() as c:
        c.execute(
            f"""
            SELECT
                COALESCE(lwl.from_user_id, '') AS reviewer_id,
                COALESCE(u.full_name, '') AS reviewer_name,
                COALESCE(u.email, '') AS reviewer_email,
                COUNT(*) AS actions_count
            FROM leave_workflow_logs lwl
            LEFT JOIN users u ON u.id = lwl.from_user_id
            JOIN leave_requests lr ON lr.id = lwl.leave_request_id
            JOIN users req_u ON req_u.id = lr.user_id
            WHERE lwl.action IN ('approved_step','approved','rejected','returned')
              AND substr(COALESCE(lwl.created_at,''), 1, 10) >= ?
              AND substr(COALESCE(lwl.created_at,''), 1, 10) <= ?
              {(" AND TRIM(COALESCE(req_u.department,'')) = TRIM(?) " if department and department.strip() else "")}
            GROUP BY COALESCE(lwl.from_user_id, ''), COALESCE(u.full_name, ''), COALESCE(u.email, '')
            ORDER BY actions_count DESC, reviewer_name COLLATE NOCASE
            LIMIT 40
            """,
            tuple([fd, td] + ([department.strip()] if department and department.strip() else [])),
        )
        reviewer_volume = [
            {
                "reviewer_id": r[0],
                "reviewer_name": r[1] or "(system)",
                "reviewer_email": r[2] or "",
                "actions_count": int(r[3] or 0),
            }
            for r in c.fetchall()
        ]

    with cursor() as c:
        c.execute(
            f"""
            SELECT lwl.action, COUNT(*) AS n
            FROM leave_workflow_logs lwl
            JOIN leave_requests lr ON lr.id = lwl.leave_request_id
            JOIN users req_u ON req_u.id = lr.user_id
            WHERE substr(COALESCE(lwl.created_at,''), 1, 10) >= ?
              AND substr(COALESCE(lwl.created_at,''), 1, 10) <= ?
              {(" AND TRIM(COALESCE(req_u.department,'')) = TRIM(?) " if department and department.strip() else "")}
            GROUP BY lwl.action
            ORDER BY n DESC
            """,
            tuple([fd, td] + ([department.strip()] if department and department.strip() else [])),
        )
        action_mix = [{"action": r[0], "count": int(r[1] or 0)} for r in c.fetchall()]

    return {
        "period": {"from_date": fd, "to_date": td, "department": (department or "").strip() or None},
        "decision_cycle_time": decided,
        "pending_age_buckets": pending_age,
        "reviewer_action_volume": reviewer_volume,
        "workflow_action_mix": action_mix,
        "note": "Decision cycle time uses created_at to final_decision_at for approved/rejected requests. Pending ageing uses current UTC time against created_at.",
    }


@app.get("/leave/balances")
def leave_balances(
    year: int | None = None,
    target_user_id: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    cy = datetime.utcnow().year
    y = year if year is not None else cy
    if target_user_id and target_user_id != user_id and current.get("role") not in ("hr", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    # Single-user balance view
    if target_user_id or current.get("role") not in ("hr", "admin"):
        uid = target_user_id or user_id
        if year is None:
            y = _employee_leave_balance_display_year(uid, cy)
        _ensure_leave_balance_rows_for_user(uid, cy)
        _ensure_leave_balance_rows_for_user(uid, y)
        with cursor() as c:
            c.execute(
                """
                SELECT
                    lt.id as leave_type_id,
                    lt.code as leave_code,
                    lt.name as leave_name,
                    COALESCE(lb.allocated_days, lt.default_days) as allocated_days,
                    COALESCE(lb.used_days, 0) as used_days,
                    COALESCE(lb.remaining_days, COALESCE(lb.allocated_days, lt.default_days) - COALESCE(lb.used_days, 0)) as remaining_days
                FROM leave_types lt
                LEFT JOIN leave_balances lb
                  ON lb.leave_type_id = lt.id AND lb.user_id = ? AND lb.year = ?
                WHERE lt.is_active = 1
                ORDER BY lt.name
                """,
                (uid, y),
            )
            rows = [row_to_dict(r) for r in c.fetchall()]
        return {"year": y, "user_id": uid, "rows": rows}
    # HR/Admin all users summary — rows as stored (use POST /leave/hr/recompute-statutory-annual to apply formula)
    with cursor() as c:
        c.execute(
            """
            SELECT
                u.id as user_id,
                u.full_name,
                u.email,
                u.department,
                lt.id as leave_type_id,
                lt.name as leave_name,
                COALESCE(lb.allocated_days, lt.default_days) as allocated_days,
                COALESCE(lb.used_days, 0) as used_days,
                COALESCE(lb.remaining_days, COALESCE(lb.allocated_days, lt.default_days) - COALESCE(lb.used_days, 0)) as remaining_days
            FROM users u
            JOIN leave_types lt ON lt.is_active = 1
            LEFT JOIN leave_balances lb
              ON lb.user_id = u.id AND lb.leave_type_id = lt.id AND lb.year = ?
            WHERE u.is_active = 1
            ORDER BY u.full_name, lt.name
            """,
            (y,),
        )
        rows = [row_to_dict(r) for r in c.fetchall()]
    return {"year": y, "rows": rows}


@app.get("/leave/hr/balance-adjustments")
def leave_hr_balance_adjustments(
    status: str | None = None,
    limit: int = 200,
    user_id: str = Depends(get_current_user_id),
):
    _require_roles(user_id, ("hr", "admin"))
    limit = min(max(int(limit or 200), 1), 500)
    where = ["1=1"]
    params: list = []
    if status and status.strip():
        allowed = {"pending", "approved", "rejected", "cancelled"}
        parts = [s.strip().lower() for s in status.split(",") if s.strip()]
        parts = [p for p in parts if p in allowed]
        if parts:
            qs = ",".join("?" * len(parts))
            where.append(f"a.status IN ({qs})")
            params.extend(parts)
    where_sql = " AND ".join(where)
    with cursor() as c:
        c.execute(
            f"""
            SELECT a.*,
                   u.full_name AS target_user_name, u.email AS target_user_email, u.department AS target_user_department,
                   lt.name AS leave_type_name, lt.code AS leave_type_code,
                   rq.full_name AS requested_by_name, ap.full_name AS approved_by_name,
                   ca.full_name AS current_approver_name
            FROM leave_balance_adjustments a
            JOIN users u ON u.id = a.target_user_id
            JOIN leave_types lt ON lt.id = a.leave_type_id
            JOIN users rq ON rq.id = a.requested_by_user_id
            LEFT JOIN users ap ON ap.id = a.approved_by_user_id
            LEFT JOIN users ca ON ca.id = a.current_approver_id
            WHERE {where_sql}
            ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC
            LIMIT ?
            """,
            tuple(params + [limit]),
        )
        rows = [row_to_dict(r) for r in c.fetchall()]
    return {"rows": rows, "limit": limit}


@app.post("/leave/hr/balance-adjustments")
def leave_hr_create_balance_adjustment(
    body: LeaveBalanceAdjustmentCreate,
    user_id: str = Depends(get_current_user_id),
):
    current = _get_user_profile_min(user_id)
    if not current or current.get("role") not in ("hr", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    target_uid = (body.target_user_id or "").strip()
    if not target_uid:
        raise HTTPException(status_code=400, detail="target_user_id is required")
    if body.year < 1990 or body.year > 2100:
        raise HTTPException(status_code=400, detail="year out of range")
    try:
        alloc = float(body.allocated_days)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="allocated_days must be a number")
    if alloc < 0 or alloc > 3660:
        raise HTTPException(status_code=400, detail="allocated_days out of range")
    with cursor() as c:
        c.execute("SELECT id, is_active FROM users WHERE id = ?", (target_uid,))
        target = c.fetchone()
        if not target or not target[1]:
            raise HTTPException(status_code=404, detail="Target user not found or inactive")
        c.execute("SELECT id FROM leave_types WHERE id = ? AND is_active = 1", (body.leave_type_id,))
        if not c.fetchone():
            raise HTTPException(status_code=400, detail="Invalid leave type")
    approver_id = _first_leave_approver(user_id)
    if not approver_id:
        raise HTTPException(status_code=400, detail="Your profile must have an active supervisor to review this request")
    if _norm_uid_compare(approver_id, user_id):
        raise HTTPException(status_code=400, detail="Your supervisor cannot be your own account for this workflow")
    aid = new_id()
    now = _now_iso()
    with cursor() as c:
        c.execute(
            """
            INSERT INTO leave_balance_adjustments (
                id, target_user_id, leave_type_id, year, requested_allocated_days, reason, status,
                requested_by_user_id, current_approver_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
            """,
            (
                aid,
                target_uid,
                body.leave_type_id,
                int(body.year),
                alloc,
                (body.reason or "").strip() or None,
                user_id,
                approver_id,
                now,
                now,
            ),
        )
    requester_name = (current.get("full_name") or current.get("email") or "HR requester").strip() or "HR requester"
    target_profile = _get_user_profile_min(target_uid) or {}
    target_name = (target_profile.get("full_name") or target_profile.get("email") or "Employee").strip() or "Employee"
    _insert_notification(
        approver_id,
        "leave_adjustment_pending",
        f"Leave entitlement change to approve: {target_name}",
        f"{requester_name} requested a leave entitlement update that requires your approval.",
        "/hr/leave-balances",
    )
    _audit_log(
        "leave_balance_adjustment_requested",
        "leave_balance_adjustments",
        user_id,
        aid,
        {
            "target_user_id": target_uid,
            "leave_type_id": body.leave_type_id,
            "year": int(body.year),
            "requested_allocated_days": alloc,
            "reason": (body.reason or "").strip() or None,
            "current_approver_id": approver_id,
        },
    )
    return _leave_balance_adjustment_row(aid)


@app.post("/leave/hr/assign-type")
def leave_hr_assign_leave_type(
    body: LeaveTypeAssignCreate,
    user_id: str = Depends(get_current_user_id),
):
    target_uid = (body.target_user_id or "").strip()
    if not target_uid:
        raise HTTPException(status_code=400, detail="target_user_id is required")
    if body.year < 1990 or body.year > 2100:
        raise HTTPException(status_code=400, detail="year out of range")
    with cursor() as c:
        c.execute("SELECT default_days FROM leave_types WHERE id = ? AND is_active = 1", (body.leave_type_id,))
        row_lt = c.fetchone()
    if not row_lt:
        raise HTTPException(status_code=400, detail="Invalid leave type")
    with cursor() as c:
        c.execute(
            """
            SELECT allocated_days
            FROM leave_balances
            WHERE user_id = ? AND leave_type_id = ? AND year = ?
            """,
            (target_uid, body.leave_type_id, int(body.year)),
        )
        row_bal = c.fetchone()
    alloc = body.allocated_days
    if alloc is None:
        alloc = float((row_bal[0] if row_bal else row_lt[0]) or 0)
    reason = (body.reason or "").strip() or "Assign leave type to employee"
    req = LeaveBalanceAdjustmentCreate(
        target_user_id=target_uid,
        leave_type_id=body.leave_type_id,
        year=int(body.year),
        allocated_days=float(alloc),
        reason=reason,
    )
    return leave_hr_create_balance_adjustment(req, user_id=user_id)


@app.post("/leave/hr/balance-adjustments/{adjustment_id}/approve")
def leave_hr_approve_balance_adjustment(
    adjustment_id: str,
    body: LeaveBalanceAdjustmentAction,
    user_id: str = Depends(get_current_user_id),
):
    current = _get_user_profile_min(user_id)
    if not current or current.get("role") not in ("hr", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("SELECT * FROM leave_balance_adjustments WHERE id = ?", (adjustment_id,))
        row = c.fetchone()
    adj = row_to_dict(row)
    if not adj:
        raise HTTPException(status_code=404, detail="Adjustment request not found")
    if (adj.get("status") or "") != "pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be approved")
    assigned_approver = (adj.get("current_approver_id") or "").strip() or (_first_leave_approver(adj.get("requested_by_user_id") or "") or "")
    if not assigned_approver:
        raise HTTPException(status_code=400, detail="No supervisor is assigned to approve this request")
    if not adj.get("current_approver_id"):
        with cursor() as c:
            c.execute(
                "UPDATE leave_balance_adjustments SET current_approver_id = ?, updated_at = ? WHERE id = ?",
                (assigned_approver, _now_iso(), adjustment_id),
            )
    if not _norm_uid_compare(assigned_approver, user_id):
        raise HTTPException(status_code=403, detail="Only the assigned supervisor can approve this request")
    if _norm_uid_compare(adj.get("requested_by_user_id"), user_id):
        raise HTTPException(status_code=400, detail="Requester cannot approve their own request")
    target_uid = adj.get("target_user_id")
    lt_id = adj.get("leave_type_id")
    year = int(adj.get("year") or datetime.utcnow().year)
    requested_alloc = float(adj.get("requested_allocated_days") or 0)
    _ensure_leave_balance_rows_for_user(target_uid, year)
    with cursor() as c:
        c.execute(
            """
            SELECT id, used_days FROM leave_balances
            WHERE user_id = ? AND leave_type_id = ? AND year = ?
            """,
            (target_uid, lt_id, year),
        )
        bal = c.fetchone()
    used_days = float((bal[1] if bal else 0) or 0)
    now = _now_iso()
    if bal:
        with cursor() as c:
            c.execute(
                """
                UPDATE leave_balances
                SET allocated_days = ?, remaining_days = ?, updated_at = ?
                WHERE id = ?
                """,
                (requested_alloc, max(requested_alloc - used_days, 0), now, bal[0]),
            )
    else:
        with cursor() as c:
            c.execute(
                """
                INSERT INTO leave_balances (id, user_id, leave_type_id, year, allocated_days, used_days, remaining_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (new_id(), target_uid, lt_id, year, requested_alloc, requested_alloc, now, now),
            )
    with cursor() as c:
        c.execute(
            """
            UPDATE leave_balance_adjustments
            SET status = 'approved', current_approver_id = NULL, approved_by_user_id = ?, approved_at = ?, rejection_comment = NULL, updated_at = ?
            WHERE id = ?
            """,
            (user_id, now, now, adjustment_id),
        )
    _audit_log(
        "leave_balance_adjustment_approved",
        "leave_balance_adjustments",
        user_id,
        adjustment_id,
        {
            "target_user_id": target_uid,
            "leave_type_id": lt_id,
            "year": year,
            "requested_allocated_days": requested_alloc,
            "comment": (body.comment or "").strip() or None,
        },
    )
    if body.comment and body.comment.strip():
        _notify_leave_hr_info("[Leave] Balance adjustment approved", adjustment_id, body.comment.strip())
    return _leave_balance_adjustment_row(adjustment_id)


@app.post("/leave/hr/balance-adjustments/{adjustment_id}/reject")
def leave_hr_reject_balance_adjustment(
    adjustment_id: str,
    body: LeaveBalanceAdjustmentAction,
    user_id: str = Depends(get_current_user_id),
):
    current = _get_user_profile_min(user_id)
    if not current or current.get("role") not in ("hr", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    comment = (body.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail="Comment is required")
    with cursor() as c:
        c.execute("SELECT * FROM leave_balance_adjustments WHERE id = ?", (adjustment_id,))
        row = c.fetchone()
    adj = row_to_dict(row)
    if not adj:
        raise HTTPException(status_code=404, detail="Adjustment request not found")
    if (adj.get("status") or "") != "pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be rejected")
    assigned_approver = (adj.get("current_approver_id") or "").strip() or (_first_leave_approver(adj.get("requested_by_user_id") or "") or "")
    if not assigned_approver:
        raise HTTPException(status_code=400, detail="No supervisor is assigned to approve this request")
    if not adj.get("current_approver_id"):
        with cursor() as c:
            c.execute(
                "UPDATE leave_balance_adjustments SET current_approver_id = ?, updated_at = ? WHERE id = ?",
                (assigned_approver, _now_iso(), adjustment_id),
            )
    if not _norm_uid_compare(assigned_approver, user_id):
        raise HTTPException(status_code=403, detail="Only the assigned supervisor can reject this request")
    if _norm_uid_compare(adj.get("requested_by_user_id"), user_id):
        raise HTTPException(status_code=400, detail="Requester cannot reject their own request")
    now = _now_iso()
    with cursor() as c:
        c.execute(
            """
            UPDATE leave_balance_adjustments
            SET status = 'rejected', current_approver_id = NULL, approved_by_user_id = ?, approved_at = ?, rejection_comment = ?, updated_at = ?
            WHERE id = ?
            """,
            (user_id, now, comment, now, adjustment_id),
        )
    _audit_log(
        "leave_balance_adjustment_rejected",
        "leave_balance_adjustments",
        user_id,
        adjustment_id,
        {
            "target_user_id": adj.get("target_user_id"),
            "leave_type_id": adj.get("leave_type_id"),
            "year": adj.get("year"),
            "requested_allocated_days": adj.get("requested_allocated_days"),
            "comment": comment,
        },
    )
    return _leave_balance_adjustment_row(adjustment_id)


@app.post("/leave/hr/recompute-statutory-annual")
def leave_hr_recompute_statutory_annual(
    year: int | None = Query(None, description="Calendar year; defaults to current UTC year"),
    user_id: str = Depends(get_current_user_id),
):
    """
    Apply year-end rollover for all active users/leave types:
    target-year allocation = base entitlement + previous-year remaining carry-over.
    ANNUAL base uses statutory ladder (or `HR_SUITE_ANNUAL_LEAVE_DAYS` override); other types use default_days.
    """
    current = _get_user_profile_min(user_id)
    if not current or current.get("role") not in ("hr", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    y = year or datetime.utcnow().year
    _rollover_leave_balances_for_year(int(y))
    return {
        "ok": True,
        "year": y,
        "detail": "Year-end rollover applied: each leave type now uses current-year base entitlement plus carry-over from previous-year remaining days.",
    }


@app.get("/leave/my-dashboard")
def leave_my_dashboard(user_id: str = Depends(get_current_user_id)):
    """Employee-focused leave snapshot: balances from DB, pending requests, approver workload."""
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    cy = datetime.utcnow().year
    y = _employee_leave_balance_display_year(user_id, cy)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    _ensure_leave_balance_rows_for_user(user_id, cy)
    if y != cy:
        _ensure_leave_balance_rows_for_user(user_id, y)
    balances = _leave_balances_for_user(user_id, y)
    total_remaining = sum(float(r.get("remaining_days") or 0) for r in balances)
    with cursor() as c:
        c.execute(
            """
            SELECT COUNT(*) FROM leave_requests
            WHERE user_id = ? AND status IN ('draft','submitted','pending_manager','pending_hod','pending_hr','returned')
            """,
            (user_id,),
        )
        my_pending = c.fetchone()[0]
        c.execute(
            """
            SELECT COUNT(*) FROM leave_requests
            WHERE user_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?
            """,
            (user_id, today, today),
        )
        on_leave_today = c.fetchone()[0]
    approval_queue = 0
    pending_approvals_preview: list[dict] = []
    with cursor() as c:
        c.execute(
            """
            SELECT COUNT(*) FROM leave_requests lr
            WHERE lr.current_approver_id = ?
            """,
            (user_id,),
        )
        approval_queue = c.fetchone()[0] or 0
        if approval_queue:
            c.execute(
                """
                SELECT lr.id, u.full_name as staff_name, u.email as staff_email,
                       lr.start_date, lr.end_date, lr.days_requested, lt.name as leave_type_name
                FROM leave_requests lr
                JOIN users u ON u.id = lr.user_id
                JOIN leave_types lt ON lt.id = lr.leave_type_id
                WHERE lr.current_approver_id = ?
                ORDER BY lr.created_at ASC
                LIMIT 15
                """,
                (user_id,),
            )
            pending_approvals_preview = [row_to_dict(r) for r in c.fetchall()]
    return {
        "year": y,
        "calendar_year": cy,
        "balances_effective_year_note": (
            None
            if y == cy
            else f"Leave balances are shown for {y} because that year has your imported or higher annual allocation; "
            f"{cy} rows look like defaults only. HR can copy entitlements into {cy} or you can pick year on reports."
        ),
        "viewer": {"id": user_id, "full_name": current.get("full_name") or ""},
        "balances": balances,
        "total_remaining_days": round(total_remaining, 2),
        "my_pending_requests": my_pending,
        "on_leave_today": bool(on_leave_today),
        "approval_queue_count": approval_queue,
        "pending_approvals_preview": pending_approvals_preview,
    }


@app.get("/leave/colleagues-on-leave")
def leave_colleagues_on_leave(on_date: str | None = None, user_id: str = Depends(get_current_user_id)):
    """Approved leave for colleagues in the same department (excludes current user)."""
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    dept = (current.get("department") or "").strip()
    d = on_date or datetime.utcnow().strftime("%Y-%m-%d")
    _parse_yyyy_mm_dd(d)
    if not dept:
        return {"on_date": d, "count": 0, "rows": [], "department": None}
    with cursor() as c:
        c.execute(
            """
            SELECT lr.id, lr.user_id, u.full_name, u.email, u.department, lt.name as leave_type_name,
                   lr.start_date, lr.end_date, lr.days_requested
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE lr.status = 'approved' AND u.is_active = 1
              AND lr.start_date <= ? AND lr.end_date >= ?
              AND TRIM(COALESCE(u.department,'')) = TRIM(?)
              AND u.id != ?
            ORDER BY u.full_name COLLATE NOCASE
            LIMIT 100
            """,
            (d, d, dept, user_id),
        )
        rows = [row_to_dict(r) for r in c.fetchall()]
    return {"on_date": d, "count": len(rows), "rows": rows, "department": dept}


def _rolling_month_keys_ending_now(count: int = 12):
    """Oldest-first ISO 'YYYY-MM' keys for charting (UTC calendar months)."""
    d = datetime.utcnow().date()
    y, m = d.year, d.month
    keys = []
    for _ in range(count):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m < 1:
            m = 12
            y -= 1
    return list(reversed(keys))


@app.get("/leave/overview")
def leave_overview(
    from_date: str | None = None,
    to_date: str | None = None,
    on_date: str | None = None,
    department: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    """HR/Admin dashboard: pipeline, selected-date on-leave snapshot, and selected-range decision stats."""
    _require_roles(user_id, ("hr", "admin"))
    today = on_date or datetime.utcnow().strftime("%Y-%m-%d")
    _parse_yyyy_mm_dd(today)
    td = to_date or today
    fd = from_date or (datetime.strptime(td, "%Y-%m-%d") - timedelta(days=30)).strftime("%Y-%m-%d")
    _parse_yyyy_mm_dd(fd)
    _parse_yyyy_mm_dd(td)
    if td < fd:
        raise HTTPException(status_code=400, detail="to_date cannot be before from_date")
    dept = (department or "").strip()
    dept_clause = ""
    dept_param = []
    if dept:
        dept_clause = " AND TRIM(COALESCE(u.department,'')) = TRIM(?) "
        dept_param = [dept]
    with cursor() as c:
        c.execute(
            f"""
            SELECT status, COUNT(*) as n FROM leave_requests
            JOIN users u ON u.id = leave_requests.user_id
            WHERE status IN ('pending_manager','pending_hod','pending_hr')
              {dept_clause}
            GROUP BY status
            """,
            tuple(dept_param),
        )
        pipeline = {row[0]: row[1] for row in c.fetchall()}
        c.execute(
            f"""
            SELECT COUNT(*) FROM leave_requests
            JOIN users u ON u.id = leave_requests.user_id
            WHERE status IN ('pending_manager','pending_hod','pending_hr')
              {dept_clause}
            """,
            tuple(dept_param),
        )
        pending_total = c.fetchone()[0]
        c.execute(
            f"""
            SELECT COUNT(DISTINCT user_id) FROM leave_requests
            JOIN users u ON u.id = leave_requests.user_id
            WHERE status = 'approved' AND start_date <= ? AND end_date >= ?
              {dept_clause}
            """,
            tuple([today, today] + dept_param),
        )
        staff_on_leave_today = c.fetchone()[0]
        c.execute(
            f"""
            SELECT COUNT(*) FROM leave_requests
            JOIN users u ON u.id = leave_requests.user_id
            WHERE status = 'approved' AND final_decision_at IS NOT NULL
              AND substr(final_decision_at,1,10) >= ?
              AND substr(final_decision_at,1,10) <= ?
              {dept_clause}
            """,
            tuple([fd, td] + dept_param),
        )
        approved_this_month = c.fetchone()[0]
        c.execute(
            f"""
            SELECT COUNT(*) FROM leave_requests
            JOIN users u ON u.id = leave_requests.user_id
            WHERE status = 'rejected' AND final_decision_at IS NOT NULL
              AND substr(final_decision_at,1,10) >= ?
              AND substr(final_decision_at,1,10) <= ?
              {dept_clause}
            """,
            tuple([fd, td] + dept_param),
        )
        rejected_this_month = c.fetchone()[0]
        c.execute(
            f"""
            SELECT lr.id, u.full_name, u.email, lt.name as leave_type_name, lr.start_date, lr.end_date, lr.days_requested, lr.status
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE lr.status IN ('pending_manager','pending_hod','pending_hr')
              {dept_clause}
            ORDER BY lr.created_at DESC
            LIMIT 15
            """,
            tuple(dept_param),
        )
        recent_pending = [row_to_dict(r) for r in c.fetchall()]
        c.execute(
            f"""
            SELECT lr.id, lr.user_id, u.full_name, u.email, u.department, lt.name as leave_type_name,
                   lr.start_date, lr.end_date, lr.days_requested
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE lr.status = 'approved' AND u.is_active = 1
              AND lr.start_date <= ? AND lr.end_date >= ?
              {dept_clause}
            ORDER BY u.department COLLATE NOCASE, u.full_name COLLATE NOCASE
            LIMIT 80
            """,
            tuple([today, today] + dept_param),
        )
        on_leave_today_detail = [row_to_dict(r) for r in c.fetchall()]
        c.execute(
            """
            SELECT substr(final_decision_at, 1, 7) AS ym,
                   SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_n,
                   SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_n
            FROM leave_requests
            WHERE status IN ('approved', 'rejected')
              AND final_decision_at IS NOT NULL
              AND length(final_decision_at) >= 7
            GROUP BY substr(final_decision_at, 1, 7)
            """
        )
        agg = {
            row[0]: {"approved": int(row[1] or 0), "rejected": int(row[2] or 0)}
            for row in c.fetchall()
            if row[0]
        }
    monthly_decisions = []
    for mk in _rolling_month_keys_ending_now(12):
        bucket = agg.get(mk, {})
        short = datetime.strptime(mk + "-01", "%Y-%m-%d").strftime("%b %y")
        monthly_decisions.append(
            {
                "month": mk,
                "label": short,
                "approved": bucket.get("approved", 0),
                "rejected": bucket.get("rejected", 0),
            }
        )
    return {
        "period": {"from_date": fd, "to_date": td, "on_date": today, "department": dept or None},
        "pending_total": pending_total,
        "pipeline": pipeline,
        "staff_on_leave_today": staff_on_leave_today,
        "approved_this_month": approved_this_month,
        "rejected_this_month": rejected_this_month,
        "recent_pending": recent_pending,
        "on_leave_today_detail": on_leave_today_detail,
        "monthly_decisions": monthly_decisions,
    }


@app.get("/leave/filters")
def leave_hr_filters(user_id: str = Depends(get_current_user_id)):
    """Distinct departments from active users (for HR/Admin leave filters)."""
    _require_roles(user_id, ("hr", "admin"))
    with cursor() as c:
        c.execute(
            """
            SELECT DISTINCT TRIM(department) as d FROM users
            WHERE is_active = 1 AND department IS NOT NULL AND TRIM(department) != ''
            ORDER BY d COLLATE NOCASE
            """
        )
        departments = [r[0] for r in c.fetchall() if r[0]]
    return {"departments": departments}


@app.get("/leave/on-leave")
def leave_on_leave(
    on_date: str | None = None,
    department: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    """Approved leave overlapping a calendar day; optional department filter."""
    _require_roles(user_id, ("hr", "admin"))
    d = on_date or datetime.utcnow().strftime("%Y-%m-%d")
    _parse_yyyy_mm_dd(d)
    where = ["lr.status = 'approved'", "u.is_active = 1", "lr.start_date <= ?", "lr.end_date >= ?"]
    params: list = [d, d]
    if department and department.strip():
        where.append("TRIM(COALESCE(u.department,'')) = TRIM(?)")
        params.append(department.strip())
    where_sql = " AND ".join(where)
    with cursor() as c:
        c.execute(
            f"""
            SELECT lr.id, lr.user_id, u.full_name, u.email, u.department, lt.name as leave_type_name,
                   lr.start_date, lr.end_date, lr.days_requested
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE {where_sql}
            ORDER BY u.department COLLATE NOCASE, u.full_name COLLATE NOCASE
            LIMIT 500
            """,
            tuple(params),
        )
        rows = [row_to_dict(r) for r in c.fetchall()]
    return {"on_date": d, "count": len(rows), "rows": rows}


@app.get("/leave/org-requests")
def leave_org_requests(
    department: str | None = None,
    status: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 400,
    user_id: str = Depends(get_current_user_id),
):
    """All leave requests with optional department, status, and date-range overlap on leave period."""
    _require_roles(user_id, ("hr", "admin"))
    limit = min(max(int(limit or 400), 1), 800)
    where = ["1=1"]
    params: list = []
    if department and department.strip():
        where.append("TRIM(COALESCE(u.department,'')) = TRIM(?)")
        params.append(department.strip())
    if status and status.strip():
        parts = [s.strip() for s in status.split(",") if s.strip()]
        if parts:
            qs = ",".join("?" * len(parts))
            where.append(f"lr.status IN ({qs})")
            params.extend(parts)
    if from_date:
        _parse_yyyy_mm_dd(from_date)
        where.append("lr.end_date >= ?")
        params.append(from_date)
    if to_date:
        _parse_yyyy_mm_dd(to_date)
        where.append("lr.start_date <= ?")
        params.append(to_date)
    if not from_date and not to_date:
        ago = (datetime.utcnow() - timedelta(days=365)).strftime("%Y-%m-%d")
        where.append("substr(COALESCE(lr.created_at,''),1,10) >= ?")
        params.append(ago)
    where_sql = " AND ".join(where)
    with cursor() as c:
        c.execute(
            f"""
            SELECT lr.id, lr.user_id, lr.leave_type_id, lr.reason, u.full_name, u.email, u.department, lt.name as leave_type_name,
                   lr.start_date, lr.end_date, lr.days_requested, lr.status, lr.created_at
            FROM leave_requests lr
            JOIN users u ON u.id = lr.user_id
            JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE u.is_active = 1 AND {where_sql}
            ORDER BY lr.created_at DESC
            LIMIT ?
            """,
            tuple(params + [limit]),
        )
        rows = [row_to_dict(r) for r in c.fetchall()]
    return {"limit": limit, "rows": rows}


@app.get("/leave/team-balances")
def leave_team_balances(
    year: int | None = None,
    scope: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Team leave balances list used for supervisor booking and visibility.

    Default: manager and HOD -> users whose ``manager_id`` is the current user (your team only). HR/Admin ->
    active employees (preview, cap 250).

    Pass ``scope=direct_reports`` (or ``direct`` / ``my_team``) to force the direct-report list for any role.

    HOD only: pass ``scope=department`` to list everyone in your department (legacy wide view).
    """
    current = _get_user_profile_min(user_id)
    if not current:
        raise HTTPException(status_code=401, detail="User not found")
    role = current.get("role")
    if role not in ("manager", "hod", "hr", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    y = year or datetime.utcnow().year
    members = []
    sc = (scope or "").strip().lower()
    direct_only = sc in ("direct_reports", "direct", "my_team")
    hod_department = role == "hod" and sc in ("department", "dept")
    with cursor() as c:
        if direct_only:
            c.execute(
                """
                SELECT id, full_name, email, department FROM users
                WHERE is_active = 1 AND manager_id = ?
                ORDER BY full_name
                """,
                (user_id,),
            )
            members = c.fetchall()
        elif role == "manager":
            c.execute(
                """
                SELECT id, full_name, email, department FROM users
                WHERE is_active = 1 AND manager_id = ?
                ORDER BY full_name
                """,
                (user_id,),
            )
            members = c.fetchall()
        elif role == "hod":
            dept = (current.get("department") or "").strip()
            if hod_department and dept:
                c.execute(
                    """
                    SELECT id, full_name, email, department FROM users
                    WHERE is_active = 1 AND department = ? AND id != ?
                    ORDER BY full_name
                    """,
                    (dept, user_id),
                )
                members = c.fetchall()
            else:
                c.execute(
                    """
                    SELECT id, full_name, email, department FROM users
                    WHERE is_active = 1 AND manager_id = ?
                    ORDER BY full_name
                    """,
                    (user_id,),
                )
                members = c.fetchall()
        else:
            c.execute(
                """
                SELECT id, full_name, email, department FROM users
                WHERE is_active = 1 AND role = 'employee'
                ORDER BY full_name
                LIMIT 250
                """
            )
            members = c.fetchall()
    out = []
    for m in members:
        mid = m[0]
        _ensure_leave_balance_rows_for_user(mid, y)
        out.append(
            {
                "user_id": mid,
                "full_name": m[1],
                "email": m[2],
                "department": m[3],
                "balances": _leave_balances_for_user(mid, y),
            }
        )
    if direct_only or role == "manager":
        list_scope = "direct_reports"
    elif role == "hod":
        list_scope = "department" if hod_department and (current.get("department") or "").strip() else "direct_reports"
    else:
        list_scope = "all_employees"
    return {"year": y, "members": out, "list_scope": list_scope}
