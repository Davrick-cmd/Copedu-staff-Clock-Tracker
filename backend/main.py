"""
CopeDu Staff Clock Tracker - Local API (SQLite).
Auth: JWT. All data in SQLite.
"""
import csv
import io
import ipaddress
import ipaddress
import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timedelta, time, timezone

logger = logging.getLogger(__name__)

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None
from fastapi import FastAPI, HTTPException, Depends, Header, Query, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from database import cursor, init_db, row_to_dict, get_conn
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
    safe = (username or "").replace("\\", "\\5c").replace("*", "\\2a").replace("(", "\\28").replace(")", "\\29").replace("\x00", "\\00")
    search_filter = f"({username_attr}={safe})"
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
    safe = (username or "").replace("\\", "\\5c").replace("*", "\\2a").replace("(", "\\28").replace(")", "\\29").replace("\x00", "\\00")
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


# ---------- Startup ----------
@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- Auth routes ----------
# Placeholder hash for LDAP-only users (they never log in with password locally)
LDAP_ONLY_PASSWORD_PLACEHOLDER = hash_password("LDAP_ONLY_NO_PASSWORD")

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
    # Path 1: Looks like email -> try find by email first
    if looks_like_email:
        with cursor() as c:
            c.execute("SELECT * FROM users WHERE LOWER(email) = ? AND is_active = 1", (email_lower,))
            row = c.fetchone()
        if row:
            user = row_to_dict(row)
            if user.get("ad_username"):
                # AD user (created from AD): verify with LDAP using domain password
                cfg = _get_ldap_config()
                if not cfg.get("ldap_enabled"):
                    raise HTTPException(status_code=503, detail="AD login is not configured. Contact your administrator.")
                ok, err = _ldap_authenticate(normalized_ad, password)
                if not ok:
                    if err:
                        raise HTTPException(status_code=503, detail=err)
                    raise HTTPException(status_code=401, detail="Invalid username or password")
                logger.info("Login: AD user by email -> success")
            else:
                # App user (email/password): verify stored password
                if not verify_password(password, user["password_hash"]):
                    raise HTTPException(status_code=401, detail="Invalid username or password")
                logger.info("Login: app user by email -> success")
    # Path 2: Try AD (username or UPN, or email not found)
    if user is None:
        cfg = _get_ldap_config()
        if not cfg.get("ldap_enabled"):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        ok, err = _ldap_authenticate(normalized_ad, password)
        if not ok:
            if err:
                raise HTTPException(status_code=503, detail=err)
            raise HTTPException(status_code=401, detail="Invalid username or password")
        with cursor() as c:
            c.execute("SELECT * FROM users WHERE LOWER(ad_username) = LOWER(?) AND is_active = 1", (normalized_ad,))
            row = c.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="No account linked to this username. Ask an admin to add you.")
        user = row_to_dict(row)
        logger.info("Login: AD user by username -> success")
    token = create_access_token({"sub": user["id"]})
    profile = {k: v for k, v in user.items() if k != "password_hash"}
    return {
        "access_token": token,
        "token_type": "bearer",
        "session": {"user": {"id": user["id"], "email": user.get("email") or user.get("ad_username") or ""}},
        "profile": profile,
    }


@app.get("/auth/me")
def auth_me(user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute(
            "SELECT u.*, b.name as branch_name, b.code as branch_code FROM users u LEFT JOIN branches b ON u.branch_id = b.id WHERE u.id = ?",
            (user_id,),
        )
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    user = row_to_dict(row)
    profile = {k: v for k, v in user.items() if k != "password_hash"}
    if "branch_name" in profile:
        profile["branches"] = {"name": profile.pop("branch_name", None), "code": profile.pop("branch_code", None)}
    return {"session": {"user": {"id": user["id"], "email": user["email"]}}, "profile": profile}


@app.post("/auth/register")
def register(req: RegisterRequest):
    if not re.match(r"[^@]+@[^@]+\.[^@]+", req.email):
        raise HTTPException(status_code=400, detail="Invalid email")
    if req.role not in ("admin", "hr", "employee"):
        req.role = "employee"
    uid = new_id()
    with cursor() as c:
        c.execute(
            "INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)",
            (uid, req.email.strip().lower(), hash_password(req.password), req.full_name.strip(), req.role),
        )
    token = create_access_token({"sub": uid})
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (uid,))
        row = c.fetchone()
    profile = row_to_dict(row)
    if profile:
        profile.pop("password_hash", None)
    return {"access_token": token, "token_type": "bearer", "session": {"user": {"id": uid, "email": req.email}}, "profile": profile}


# ---------- Attendance ----------
@app.get("/attendance/today")
def attendance_today(user_id: str = Depends(get_current_user_id)):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with cursor() as c:
        c.execute(
            "SELECT * FROM attendance_logs WHERE user_id = ? AND date(clock_in_at) = ? ORDER BY clock_in_at DESC LIMIT 1",
            (user_id, today),
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
    out_now = datetime.utcnow()
    in_dt = _parse_iso(row.get("clock_in_at"))
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
    total_days = last_day
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
    work_days = total_days
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
        dept = s.get("department") or "—"
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
    trend_attendance = "—"
    trend_absence = "—"
    trend_late = "—"
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
    department: str | None = None


@app.post("/users")
def create_user(req: CreateUserRequest, current_user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if req.role not in ("admin", "hr", "employee"):
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
    with cursor() as c:
        if ad_user:
            c.execute(
                "INSERT INTO users (id, email, password_hash, full_name, role, ad_username, department) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (uid, email_val, password_hash, req.full_name.strip(), req.role, ad_user, dept),
            )
        else:
            c.execute(
                "INSERT INTO users (id, email, password_hash, full_name, role, department) VALUES (?, ?, ?, ?, ?, ?)",
                (uid, email_val, password_hash, req.full_name.strip(), req.role, dept),
            )
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (uid,))
        row = c.fetchone()
    d = row_to_dict(row)
    if d:
        d.pop("password_hash", None)
        d["branches"] = {"name": None, "code": None}
    return d


@app.get("/users/lookup-ad")
def lookup_ad_user(
    username: str = Query(..., min_length=1),
    current_user_id: str = Depends(get_current_user_id),
):
    """Look up a user in Active Directory by sAMAccountName. Returns full_name and email for pre-filling the create-user form. Admin only."""
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
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
        raise HTTPException(status_code=400, detail="CSV must have columns: username, role")
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
                    "INSERT INTO users (id, email, password_hash, full_name, role, ad_username, department) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (uid, email, LDAP_ONLY_PASSWORD_PLACEHOLDER, full_name, role, username, department),
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
            SELECT u.*, b.name as branch_name, b.code as branch_code FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id ORDER BY u.full_name
        """)
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d.pop("password_hash", None)
            d["branches"] = {"name": d.pop("branch_name", None), "code": d.pop("branch_code", None)}
            out.append(d)
    return out


@app.get("/users/me/profile")
def get_user_profile(user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    d = row_to_dict(row)
    d.pop("password_hash", None)
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


@app.patch("/users/{uid}/active")
def set_user_active(uid: str, req: ActiveUpdate, current_user_id: str = Depends(get_current_user_id)):
    is_active = req.is_active
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (current_user_id,))
        r = c.fetchone()
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?", (1 if is_active else 0, datetime.utcnow().isoformat(), uid))
    with cursor() as c:
        c.execute("SELECT * FROM users WHERE id = ?", (uid,))
        return row_to_dict(c.fetchone())


# ---------- Announcements ----------
@app.get("/announcements")
def list_announcements(expired: bool = False, _: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("""
            SELECT an.*, u.full_name as creator_name FROM announcements an
            LEFT JOIN users u ON an.created_by = u.id ORDER BY an.published_at DESC
        """)
        rows = c.fetchall()
    out = []
    for row in rows:
        d = row_to_dict(row)
        if d:
            d["users"] = {"full_name": d.pop("creator_name", None)}
            if not expired and d.get("expires_at"):
                if d["expires_at"] < datetime.utcnow().isoformat():
                    continue
            out.append(d)
    return out


class AnnouncementCreate(BaseModel):
    title: str
    body: str
    created_by: str | None = None
    priority: str = "normal"


@app.post("/announcements")
def create_announcement(req: AnnouncementCreate, user_id: str = Depends(get_current_user_id)):
    with cursor() as c:
        c.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        r = c.fetchone()
    if not r or r[0] not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Forbidden")
    aid = new_id()
    now = datetime.utcnow().isoformat() + "Z"
    with cursor() as c:
        c.execute(
            "INSERT INTO announcements (id, title, body, created_by, priority, published_at) VALUES (?, ?, ?, ?, ?, ?)",
            (aid, req.title, req.body, user_id, req.priority, now),
        )
    with cursor() as c:
        c.execute("SELECT an.*, u.full_name as creator_name FROM announcements an LEFT JOIN users u ON an.created_by = u.id WHERE an.id = ?", (aid,))
        row = c.fetchone()
    d = row_to_dict(row)
    if d:
        d["users"] = {"full_name": d.pop("creator_name", None)}
    return d


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
    if not r or r[0] != "admin":
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
    if not r or r[0] != "admin":
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
    if not r or r[0] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    with cursor() as c:
        c.execute("DELETE FROM branches WHERE id = ?", (bid,))
    return {"ok": True}


# ---------- Audit ----------
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
