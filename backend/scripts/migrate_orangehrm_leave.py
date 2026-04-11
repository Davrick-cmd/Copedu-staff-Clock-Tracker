#!/usr/bin/env python3
"""
Import leave history from an OrangeHRM / MySQL dump (e.g. hr_leave.sql) into the HR Suite SQLite DB.

Usage (from backend folder):
  python scripts/migrate_orangehrm_leave.py --sql "../old hrms/hr_leave.sql" --dry-run
  python scripts/migrate_orangehrm_leave.py --sql "../old hrms/hr_leave.sql" --apply --import-users
  # Optional: also overwrite passwords when merging into existing emails (default: keep HR Suite password):
  #   ... --apply --import-users --apply-ohrm-passwords-to-merged

Balances (28.5 days in Orange vs 21 in HR Suite defaults):
  The dump's `ohrm_leave_entitlement` rows are imported into `leave_balances` so each employee keeps
  OrangeHRM allocated/used/remaining (not the seeded default_days). This runs automatically on --apply
  unless you pass --skip-entitlements.

  If your Orange dump is for calendar year 2025 but the app uses 2026, map last year's entitlements
  into the new year, e.g.:
    python scripts/migrate_orangehrm_leave.py --sql "../old hrms/hr_leave.sql" --apply --only-entitlements \\
      --sqlite-year 2026 --ohrm-entitlement-from-year 2025

  Re-run entitlement-only any time after refreshing the MySQL dump:
    ... --apply --only-entitlements --sqlite-year 2026 --ohrm-entitlement-from-year 2025

Without --import-users, leave rows only attach to users that already exist in SQLite (email /
employee_id / AD username must match). With --import-users, staff are created from hs_hr_employee
first so historical leave can map to everyone.

Login for imported users:
  Email: work email, other email, or ohrm.emp{number}@migration.local
  Password: When `ohrm_user.user_password` is a bcrypt hash ($2y$ / $2a$ / $2b$ from OrangeHRM), it is
  stored as-is (normalized for Python) so staff can use their OrangeHRM password. Otherwise new accounts
  get OrangeHRM_Migrate_2026!. Merged accounts (matched by email) keep their existing password unless you
  pass --apply-ohrm-passwords-to-merged.

Matching staff to app users (first match wins):
  0) users.id == mig-user-ohrm-{emp_number} (stable id from --import-users)
  1) hs_hr_employee.emp_work_email -> users.email (case-insensitive)
  2) hs_hr_employee.emp_oth_email -> users.email
  3) hs_hr_employee.employee_id -> users.employee_id
  4) ohrm_user.user_name -> users.ad_username (case-insensitive)

OrangeHRM ohrm_leave.status (day rows):
  -1 REJECTED, 0 CANCELLED, 1 PENDING, 2 SCHEDULED, 3 TAKEN, 4 WEEKEND, 5 HOLIDAY
"""
from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
from collections import defaultdict
from typing import Callable
from datetime import datetime
from pathlib import Path

# backend/ on sys.path for auth_jwt
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from auth_jwt import hash_password, new_id  # noqa: E402

# Fallback when Orange has no usable bcrypt hash for that employee.
MIGRATION_DEFAULT_PASSWORD = "OrangeHRM_Migrate_2026!"


def _usable_ohrm_bcrypt_hash(raw: str | None) -> str | None:
    """Return a hash string bcrypt can verify, or None."""
    if not raw:
        return None
    s = mysql_str(raw) if raw else ""
    s = (s or "").strip()
    if len(s) < 59 or not s.startswith("$2"):
        return None
    if s.startswith("$2y$") or s.startswith("$2a$"):
        return "$2b$" + s[4:]
    return s
MIG_USER_PREFIX = "mig-user-ohrm-"
SYNTH_EMAIL_DOMAIN = "migration.local"


def _db_path() -> str:
    raw = os.environ.get("DATABASE_URL", "sqlite:///./copedu.db").replace("sqlite:///", "")
    if os.path.isabs(raw):
        return raw
    return str(_BACKEND / raw)


def iter_mysql_tuple_bodies(blob: str):
    """Yield inner string of each top-level ( ... ) tuple in a VALUES clause."""
    i = 0
    n = len(blob)
    while i < n:
        if blob[i] != "(":
            i += 1
            continue
        depth = 1
        start = i + 1
        i += 1
        in_q = False
        while i < n:
            c = blob[i]
            if in_q:
                if c == "\\" and i + 1 < n:
                    i += 2
                    continue
                if c == "'" and i + 1 < n and blob[i + 1] == "'":
                    i += 2
                elif c == "'":
                    in_q = False
                    i += 1
                else:
                    i += 1
                continue
            if c == "'":
                in_q = True
                i += 1
                continue
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    yield blob[start:i]
                    i += 1
                    break
            i += 1
        else:
            break


def split_mysql_fields(inner: str) -> list[str | None]:
    parts: list[str | None] = []
    buf: list[str] = []
    i = 0
    in_q = False
    while i < len(inner):
        c = inner[i]
        if in_q:
            if c == "\\" and i + 1 < len(inner):
                buf.append(inner[i + 1])
                i += 2
                continue
            if c == "'" and i + 1 < len(inner) and inner[i + 1] == "'":
                buf.append("'")
                i += 2
            elif c == "'":
                in_q = False
                i += 1
            else:
                buf.append(c)
                i += 1
            continue
        if c == "'":
            in_q = True
            i += 1
            continue
        if c == ",":
            token = "".join(buf).strip()
            if token.upper() == "NULL" or token == "":
                parts.append(None)
            else:
                parts.append(token)
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    token = "".join(buf).strip()
    if token.upper() == "NULL" or token == "":
        parts.append(None)
    else:
        parts.append(token)
    return parts


def parse_insert_line(line: str, table: str) -> list[list[str | None]]:
    needle = f"INSERT INTO `{table}` VALUES "
    if needle not in line:
        return []
    idx = line.index(needle) + len(needle)
    blob = line[idx:].strip()
    if blob.endswith(";"):
        blob = blob[:-1].strip()
    rows = []
    for body in iter_mysql_tuple_bodies(blob):
        rows.append(split_mysql_fields(body))
    return rows


def parse_float(x: str | None, default: float = 0.0) -> float:
    if x is None:
        return default
    try:
        return float(x)
    except ValueError:
        return default


def parse_int(x: str | None) -> int | None:
    if x is None:
        return None
    try:
        return int(x)
    except ValueError:
        return None


def norm_email(s: str | None) -> str | None:
    if not s:
        return None
    s = str(s).strip().strip("'\"").strip().lower()
    if not s or "@" not in s:
        return None
    return s


def mysql_str(s: str | None) -> str:
    if s is None:
        return ""
    t = str(s).strip()
    if len(t) >= 2 and t[0] == "'" and t[-1] == "'":
        t = t[1:-1].replace("''", "'")
    return t.strip()


def full_name_from_emp(d: dict) -> str:
    fn = mysql_str(d.get("emp_firstname"))
    ln = mysql_str(d.get("emp_lastname"))
    name = f"{fn} {ln}".strip()
    return name or f"Employee {d.get('emp_number')}"


def pick_unique_email(
    emp_no: int,
    work_raw: str | None,
    oth_raw: str | None,
    reserved: set[str],
) -> str:
    for candidate in (norm_email(work_raw), norm_email(oth_raw)):
        if candidate and candidate not in reserved:
            reserved.add(candidate)
            return candidate
    base = f"ohrm.emp{emp_no}@migrated.{SYNTH_EMAIL_DOMAIN}"
    if base not in reserved:
        reserved.add(base)
        return base
    i = 1
    while True:
        alt = f"ohrm.emp{emp_no}.{i}@migrated.{SYNTH_EMAIL_DOMAIN}"
        if alt not in reserved:
            reserved.add(alt)
            return alt
        i += 1


def aggregate_request_status(statuses: set[int]) -> str:
    s = set(statuses)
    s.discard(4)
    s.discard(5)
    if not s:
        return "skip"
    if -1 in s:
        return "rejected"
    if 1 in s:
        return "pending_hr"
    if s <= {0}:
        return "cancelled"
    if 2 in s or 3 in s:
        return "approved"
    return "approved"


def _default_branch_id(cur) -> str | None:
    cur.execute("SELECT id FROM branches ORDER BY id LIMIT 1")
    row = cur.fetchone()
    return row[0] if row else None


def _ad_username_available(cur, ad: str, exclude_user_id: str | None) -> bool:
    if not ad:
        return False
    ad = ad.strip().lower()
    if exclude_user_id:
        cur.execute(
            "SELECT id FROM users WHERE LOWER(TRIM(ad_username)) = ? AND id != ?",
            (ad, exclude_user_id),
        )
    else:
        cur.execute("SELECT id FROM users WHERE LOWER(TRIM(ad_username)) = ?", (ad,))
    return cur.fetchone() is None


def import_orange_users(
    cur,
    employees: dict[int, dict],
    ohrm_users: dict[int, str],
    ohrm_password_hashes: dict[int, str],
    dry_run: bool,
    apply_ohrm_password_to_merged: bool = False,
) -> tuple[int, int, int, int, int]:
    """Create or merge users from Orange hs_hr_employee. Returns (merged, created, skipped, pwd_ohrm_new, pwd_ohrm_merged)."""
    cur.execute("SELECT LOWER(TRIM(email)) FROM users WHERE email IS NOT NULL AND TRIM(email) != ''")
    db_emails = {r[0] for r in cur.fetchall() if r[0]}

    now = datetime.utcnow().isoformat()
    branch_id = _default_branch_id(cur)
    pwd_fallback = hash_password(MIGRATION_DEFAULT_PASSWORD)

    merged = created = skipped = pwd_ohrm_new = pwd_ohrm_merged = 0
    claimed_merge: dict[str, int] = {}
    reserved_new: set[str] = set()

    for emp_no, emp in sorted(employees.items()):
        mig_id = f"{MIG_USER_PREFIX}{emp_no}"
        cur.execute("SELECT id FROM users WHERE id = ?", (mig_id,))
        if cur.fetchone():
            skipped += 1
            continue

        work_raw, oth_raw = emp.get("work_email"), emp.get("oth_email")
        chosen_email: str | None = None
        mode: str | None = None

        for candidate in (norm_email(work_raw), norm_email(oth_raw)):
            if not candidate:
                continue
            if candidate in db_emails:
                prev = claimed_merge.get(candidate)
                if prev is None or prev == emp_no:
                    claimed_merge[candidate] = emp_no
                    chosen_email, mode = candidate, "merge"
                    break
                continue
            if candidate not in reserved_new:
                reserved_new.add(candidate)
                chosen_email, mode = candidate, "new"
                break

        if not chosen_email:
            chosen_email = pick_unique_email(emp_no, None, None, reserved_new)
            mode = "new"

        fn = full_name_from_emp(emp)
        emp_id_val = (emp.get("employee_id") or "").strip() or None
        ad_raw = ohrm_users.get(emp_no)
        ad_candidate = mysql_str(ad_raw).strip().lower() if ad_raw else None
        if ad_candidate and not _ad_username_available(cur, ad_candidate, None):
            ad_candidate = None

        ohrm_pwd = _usable_ohrm_bcrypt_hash(ohrm_password_hashes.get(emp_no))

        if dry_run:
            if mode == "merge":
                merged += 1
                if apply_ohrm_password_to_merged and ohrm_pwd:
                    pwd_ohrm_merged += 1
            else:
                created += 1
                if ohrm_pwd:
                    pwd_ohrm_new += 1
            continue

        if mode == "merge":
            cur.execute("SELECT id FROM users WHERE LOWER(TRIM(email)) = ?", (chosen_email,))
            row = cur.fetchone()
            if row:
                uid = row[0]
                if apply_ohrm_password_to_merged and ohrm_pwd:
                    cur.execute(
                        "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                        (ohrm_pwd, now, uid),
                    )
                    pwd_ohrm_merged += 1
                if emp_id_val:
                    cur.execute(
                        """
                        UPDATE users SET
                          employee_id = CASE WHEN TRIM(COALESCE(employee_id,'')) = '' THEN ? ELSE employee_id END,
                          updated_at = ?
                        WHERE id = ?
                        """,
                        (emp_id_val, now, uid),
                    )
                else:
                    cur.execute("UPDATE users SET updated_at = ? WHERE id = ?", (now, uid))
                if ad_candidate and _ad_username_available(cur, ad_candidate, uid):
                    cur.execute(
                        "UPDATE users SET ad_username = COALESCE(ad_username, ?), updated_at = ? WHERE id = ?",
                        (ad_candidate, now, uid),
                    )
                merged += 1
                continue
            mode = "new"

        if mode == "new":
            insert_pwd = ohrm_pwd if ohrm_pwd else pwd_fallback
            if ohrm_pwd:
                pwd_ohrm_new += 1
            try:
                cur.execute(
                    """
                    INSERT INTO users (
                        id, email, password_hash, full_name, role, branch_id, employee_id,
                        is_active, created_at, updated_at, ad_username
                    ) VALUES (?, ?, ?, ?, 'employee', ?, ?, 1, ?, ?, ?)
                    """,
                    (
                        mig_id,
                        chosen_email,
                        insert_pwd,
                        fn,
                        branch_id,
                        emp_id_val,
                        now,
                        now,
                        ad_candidate,
                    ),
                )
                created += 1
            except sqlite3.IntegrityError:
                skipped += 1

    return merged, created, skipped, pwd_ohrm_new, pwd_ohrm_merged


def ensure_leave_type(cur, name: str, oh_lt_id: int) -> str:
    """Return SQLite leave_types.id for Orange leave type name."""
    key = name.strip().lower()
    # Map common OrangeHRM names to existing seeded types
    aliases = {
        "annual leave": "ANNUAL",
        "sick leave": "SICK",
        "maternity/paternity leave": "MATERNITY_PATERNITY",
        "maternity leave": "MATERNITY_PATERNITY",
        "paternity leave": "PATERNITY",
        "paternity": "PATERNITY",
        "circumstantial leave": "COMPASSIONATE",
        "compassionate leave": "COMPASSIONATE",
        "unpaid leave": "UNPAID",
    }
    code = aliases.get(key)
    if code:
        cur.execute("SELECT id FROM leave_types WHERE UPPER(code) = UPPER(?)", (code,))
        row = cur.fetchone()
        if row:
            return row[0]
    cur.execute("SELECT id FROM leave_types WHERE LOWER(name) = ?", (key,))
    row = cur.fetchone()
    if row:
        return row[0]
    slug = re.sub(r"[^a-z0-9]+", "_", key).strip("_")[:20] or "CUSTOM"
    lid = f"leave-type-ohrm-{oh_lt_id}"
    now = datetime.utcnow().isoformat()
    cur.execute(
        "INSERT OR IGNORE INTO leave_types (id, code, name, default_days, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?)",
        (lid, f"OHRM_{oh_lt_id}", name[:50], now, now),
    )
    cur.execute("SELECT id FROM leave_types WHERE id = ?", (lid,))
    r = cur.fetchone()
    if r:
        return r[0]
    cur.execute("SELECT id FROM leave_types WHERE LOWER(name) = ?", (key,))
    return cur.fetchone()[0]


def apply_orange_entitlements(
    cur,
    entitlement_rows: list,
    leave_types_oh: dict[int, str],
    resolve_user: Callable[[int], str | None],
    sqlite_year: int,
    ohrm_from_year: int | None,
) -> tuple[int, int]:
    """
    Import ohrm_leave_entitlement into leave_balances (OrangeHRM is source of truth for allocated/used).

    ohrm_from_year: if set, only rows whose from_date calendar year equals this (e.g. 2025 live dump);
    balances are stored under sqlite_year (e.g. 2026) for cutover to the new system year.
    If None, only rows whose from_date year equals sqlite_year are imported.
    """
    agg: dict[tuple[int, int], dict[str, float]] = defaultdict(lambda: {"no": 0.0, "used": 0.0})
    for r in entitlement_rows:
        if len(r) < 11:
            continue
        if parse_int(r[10]) == 1:
            continue
        emp = parse_int(r[1])
        no = parse_float(r[2])
        du = parse_float(r[3])
        oh_lt = parse_int(r[4])
        fd = mysql_str(r[5]) if r[5] else ""
        fd_y = int(fd[:4]) if len(fd) >= 4 and fd[:4].isdigit() else None
        match_year = ohrm_from_year if ohrm_from_year is not None else sqlite_year
        if fd_y is None or fd_y != match_year:
            continue
        if emp is None or oh_lt is None:
            continue
        key = (emp, oh_lt)
        agg[key]["no"] += no
        agg[key]["used"] += du

    updated = 0
    unmatched = 0
    now = datetime.utcnow().isoformat()
    for (emp, oh_lt), v in sorted(agg.items()):
        uid = resolve_user(emp)
        if not uid:
            unmatched += 1
            continue
        lt_name = leave_types_oh.get(oh_lt, f"Type {oh_lt}")
        new_lt_id = ensure_leave_type(cur, lt_name, oh_lt)
        alloc = float(v["no"])
        used = float(v["used"])
        rem = max(alloc - used, 0.0)
        cur.execute(
            "SELECT id FROM leave_balances WHERE user_id = ? AND leave_type_id = ? AND year = ?",
            (uid, new_lt_id, sqlite_year),
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                "UPDATE leave_balances SET allocated_days = ?, used_days = ?, remaining_days = ?, updated_at = ? WHERE id = ?",
                (alloc, used, rem, now, row[0]),
            )
        else:
            bid = new_id()
            cur.execute(
                """
                INSERT INTO leave_balances (id, user_id, leave_type_id, year, allocated_days, used_days, remaining_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (bid, uid, new_lt_id, sqlite_year, alloc, used, rem, now, now),
            )
        updated += 1
    return updated, unmatched


def main():
    ap = argparse.ArgumentParser(description="Migrate OrangeHRM leave from MySQL dump to SQLite HR Suite")
    ap.add_argument("--sql", required=True, help="Path to hr_leave.sql (OrangeHRM dump)")
    ap.add_argument("--db", default=None, help="SQLite file (default: DATABASE_URL / copedu.db in backend)")
    ap.add_argument("--dry-run", action="store_true", help="Parse and report only; no DB writes")
    ap.add_argument("--apply", action="store_true", help="Write to SQLite")
    ap.add_argument(
        "--import-users",
        action="store_true",
        help="Create/merge users from hs_hr_employee (+ ohrm_user) before importing leave (recommended)",
    )
    ap.add_argument(
        "--apply-ohrm-passwords-to-merged",
        action="store_true",
        help="When merging into an existing user (matched by email), overwrite password_hash with OrangeHRM bcrypt if present. "
        "Default: merged users keep their current HR Suite password; only new mig-* accounts get Orange hashes.",
    )
    ap.add_argument(
        "--skip-entitlements",
        action="store_true",
        help="Do not import ohrm_leave_entitlement (balances stay defaults unless leave history created rows).",
    )
    ap.add_argument(
        "--only-entitlements",
        action="store_true",
        help="Only apply OrangeHRM leave entitlements to leave_balances (skip leave request history import). Requires --apply.",
    )
    ap.add_argument(
        "--sqlite-year",
        type=int,
        default=None,
        help="Calendar year stored in leave_balances.year (default: current UTC year).",
    )
    ap.add_argument(
        "--ohrm-entitlement-from-year",
        type=int,
        default=None,
        help="Read OrangeHRM entitlement rows whose from_date falls in this year (e.g. 2025). "
        "Use with --sqlite-year 2026 to copy last year's live balances into the new app year.",
    )
    args = ap.parse_args()
    if args.only_entitlements and not args.apply:
        print("--only-entitlements requires --apply")
        sys.exit(1)
    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply")
        sys.exit(1)

    sql_path = Path(args.sql).resolve()
    if not sql_path.is_file():
        print(f"SQL file not found: {sql_path}")
        sys.exit(1)

    db_file = args.db or _db_path()
    if not args.dry_run and not Path(db_file).is_file():
        print(f"SQLite DB not found: {db_file} (start backend once to create it)")
        sys.exit(1)

    print(f"Reading {sql_path} (this may take a minute)...")
    leave_requests: dict[int, tuple[int, str, int]] = {}
    leave_rows: list[tuple] = []
    leave_types_oh: dict[int, str] = {}
    employees: dict[int, dict] = {}
    ohrm_users: dict[int, str] = {}
    ohrm_password_hashes: dict[int, str] = {}
    entitlement_rows: list = []

    insert_tables = (
        "ohrm_leave_type",
        "ohrm_leave_request",
        "ohrm_leave",
        "ohrm_leave_entitlement",
        "hs_hr_employee",
        "ohrm_user",
    )
    counts = defaultdict(int)

    buf = None
    with open(sql_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "INSERT INTO `" in line:
                if buf:
                    _process_buffer(
                        buf,
                        insert_tables,
                        leave_types_oh,
                        leave_requests,
                        leave_rows,
                        entitlement_rows,
                        employees,
                        ohrm_users,
                        ohrm_password_hashes,
                        counts,
                    )
                buf = line.rstrip("\n")
            elif buf is not None:
                buf += line.rstrip("\n")
            if buf and buf.rstrip().endswith(";"):
                _process_buffer(
                    buf,
                    insert_tables,
                    leave_types_oh,
                    leave_requests,
                    leave_rows,
                    entitlement_rows,
                    employees,
                    ohrm_users,
                    ohrm_password_hashes,
                    counts,
                )
                buf = None

    if buf:
        _process_buffer(
            buf,
            insert_tables,
            leave_types_oh,
            leave_requests,
            leave_rows,
            entitlement_rows,
            employees,
            ohrm_users,
            ohrm_password_hashes,
            counts,
        )

    by_request: dict[int, list] = defaultdict(list)
    for row in leave_rows:
        _id, date_s, lh, ld, status_s, req_id, lt_id, emp_no, st, et, dur = row
        req_i = parse_int(str(req_id) if req_id is not None else None)
        if req_i is None:
            continue
        st_i = parse_int(str(status_s) if status_s is not None else None)
        if st_i is None:
            continue
        ds = str(date_s).strip("'\"")[:10] if date_s else None
        if not ds:
            continue
        by_request[req_i].append(
            {
                "date": ds,
                "length_days": parse_float(str(ld) if ld is not None else None),
                "status": st_i,
            }
        )

    print(
        f"Parsed: leave_types={len(leave_types_oh)}, requests={len(leave_requests)}, "
        f"leave_days={len(leave_rows)}, entitlements={len(entitlement_rows)}, "
        f"employees={len(employees)}, ohrm_users={len(ohrm_users)}"
    )

    if args.dry_run:
        print("--dry-run: no database changes.")
        missing_req = [rid for rid in leave_requests if rid not in by_request]
        print(f"Requests with no day rows: {len(missing_req)}")
        if Path(db_file).is_file():
            ro_uri = Path(db_file).resolve().as_uri() + "?mode=ro"
            conn = sqlite3.connect(ro_uri, uri=True)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            user_by_email: dict[str, str] = {}
            user_by_emp_id: dict[str, str] = {}
            user_by_ad: dict[str, str] = {}
            cur.execute("SELECT id, email, employee_id, ad_username FROM users WHERE is_active = 1")
            for r in cur.fetchall():
                e = norm_email(r["email"])
                if e:
                    user_by_email.setdefault(e, r["id"])
                if r["employee_id"]:
                    user_by_emp_id.setdefault(str(r["employee_id"]).strip().lower(), r["id"])
                if r["ad_username"]:
                    user_by_ad.setdefault(str(r["ad_username"]).strip().lower(), r["id"])

            def resolve_user_dr(emp_number: int) -> str | None:
                mig_uid = f"{MIG_USER_PREFIX}{emp_number}"
                cur.execute("SELECT id FROM users WHERE id = ?", (mig_uid,))
                if cur.fetchone():
                    return mig_uid
                emp = employees.get(emp_number)
                if not emp:
                    return None
                we = norm_email(emp.get("work_email"))
                oe = norm_email(emp.get("oth_email"))
                eid = emp.get("employee_id")
                if we and we in user_by_email:
                    return user_by_email[we]
                if oe and oe in user_by_email:
                    return user_by_email[oe]
                if eid and str(eid).strip().lower() in user_by_emp_id:
                    return user_by_emp_id[str(eid).strip().lower()]
                ad = ohrm_users.get(emp_number)
                if ad and ad in user_by_ad:
                    return user_by_ad[ad]
                return None

            matchable = 0
            for _rid, (_lt, _da, emp_no) in leave_requests.items():
                if resolve_user_dr(emp_no):
                    matchable += 1
            print(f"Leave requests whose employee maps to an app user (estimate): {matchable} / {len(leave_requests)}")
            if args.import_users:
                m, c, s, pn, pm = import_orange_users(
                    cur,
                    employees,
                    ohrm_users,
                    ohrm_password_hashes,
                    dry_run=True,
                    apply_ohrm_password_to_merged=args.apply_ohrm_passwords_to_merged,
                )
                print(
                    f"--import-users (dry-run): merge into existing emails={m}, new mig accounts={c}, already have mig id={s}; "
                    f"Orange bcrypt on new={pn}, on merged={pm} (merged only with --apply-ohrm-passwords-to-merged)"
                )
                matchable2 = sum(1 for _rid, (_lt, _da, emp_no) in leave_requests.items() if emp_no in employees)
                print(
                    f"Leave requests with employee row in Orange dump: {matchable2} / {len(leave_requests)} "
                    f"(after --apply --import-users, almost all should import if day rows exist)"
                )
            conn.close()
        else:
            print(f"(Optional) Place SQLite DB at {db_file} to see employee match estimate.")
        return

    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    if args.import_users:
        mr, cr, sr, pn, pm = import_orange_users(
            cur,
            employees,
            ohrm_users,
            ohrm_password_hashes,
            dry_run=False,
            apply_ohrm_password_to_merged=args.apply_ohrm_passwords_to_merged,
        )
        conn.commit()
        print(f"Imported users: merged_into_existing={mr}, created_mig_accounts={cr}, skipped_existing_mig_id={sr}")
        print(
            f"Passwords from OrangeHRM (bcrypt): {pn} new mig-* account(s); {pm} merged account(s) updated "
            f"({'--apply-ohrm-passwords-to-merged was set' if args.apply_ohrm_passwords_to_merged else 'merged unchanged unless flag set'})"
        )
        fb = cr - pn
        if fb > 0:
            print(f"New accounts without Orange bcrypt hash (fallback password): {fb} → {MIGRATION_DEFAULT_PASSWORD}")
        print("Users should change password after first login if policy requires (Admin can reset from Users).")

    user_by_email: dict[str, str] = {}
    user_by_emp_id: dict[str, str] = {}
    user_by_ad: dict[str, str] = {}
    cur.execute("SELECT id, email, employee_id, ad_username FROM users WHERE is_active = 1")
    for r in cur.fetchall():
        e = norm_email(r["email"])
        if e:
            user_by_email.setdefault(e, r["id"])
        if r["employee_id"]:
            user_by_emp_id.setdefault(str(r["employee_id"]).strip().lower(), r["id"])
        if r["ad_username"]:
            user_by_ad.setdefault(str(r["ad_username"]).strip().lower(), r["id"])

    mig_uid_by_emp: dict[int, str] = {}
    cur.execute("SELECT id FROM users WHERE id LIKE ?", (f"{MIG_USER_PREFIX}%",))
    for (uid,) in cur.fetchall():
        try:
            mig_uid_by_emp[int(str(uid).split("-")[-1])] = str(uid)
        except ValueError:
            pass

    def resolve_user(emp_number: int) -> str | None:
        if emp_number in mig_uid_by_emp:
            return mig_uid_by_emp[emp_number]
        emp = employees.get(emp_number)
        if not emp:
            return None
        we = norm_email(emp.get("work_email"))
        oe = norm_email(emp.get("oth_email"))
        eid = emp.get("employee_id")
        if isinstance(eid, str):
            eid = eid.strip()
        if we and we in user_by_email:
            return user_by_email[we]
        if oe and oe in user_by_email:
            return user_by_email[oe]
        if eid and str(eid).strip().lower() in user_by_emp_id:
            return user_by_emp_id[str(eid).strip().lower()]
        ad = ohrm_users.get(emp_number)
        if ad and ad in user_by_ad:
            return user_by_ad[ad]
        return None

    sqlite_year = args.sqlite_year if args.sqlite_year is not None else datetime.utcnow().year
    ohrm_from = args.ohrm_entitlement_from_year

    imported = 0
    skipped = 0
    unmatched = 0
    now = datetime.utcnow().isoformat()

    if not args.only_entitlements:
        for req_id, (oh_lt_id, date_applied, emp_number) in sorted(leave_requests.items()):
            days = by_request.get(req_id, [])
            if not days:
                skipped += 1
                continue
            statuses = {d["status"] for d in days}
            overall = aggregate_request_status(statuses)
            if overall == "skip":
                skipped += 1
                continue

            uid = resolve_user(emp_number)
            if not uid:
                unmatched += 1
                continue

            # date range from meaningful days (exclude weekend/holiday-only spans)
            usable = [d for d in days if d["status"] not in (4, 5)]
            if not usable:
                skipped += 1
                continue
            dates = sorted(d["date"] for d in usable)
            start_date, end_date = dates[0], dates[-1]
            days_requested = sum(d["length_days"] for d in days if d["status"] in (2, 3))
            if days_requested <= 0:
                days_requested = float((datetime.strptime(end_date, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days + 1)

            lt_name = leave_types_oh.get(oh_lt_id, f"Type {oh_lt_id}")
            new_lt_id = ensure_leave_type(cur, lt_name, oh_lt_id)

            mig_id = f"mig-ohrm-{req_id}"
            cur.execute("SELECT id FROM leave_requests WHERE id = ?", (mig_id,))
            if cur.fetchone():
                continue

            if overall == "approved":
                status = "approved"
                current_approver = None
                final_by = None
                final_at = now
            elif overall == "rejected":
                status = "rejected"
                current_approver = None
                final_by = None
                final_at = now
            elif overall == "cancelled":
                status = "cancelled"
                current_approver = None
                final_by = None
                final_at = None
            else:
                status = "pending_hr"
                current_approver = None
                final_by = None
                final_at = None

            cur.execute(
                """
                INSERT INTO leave_requests (
                    id, user_id, leave_type_id, start_date, end_date, days_requested, reason,
                    status, current_approver_id, final_decision_by, final_decision_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    mig_id,
                    uid,
                    new_lt_id,
                    start_date,
                    end_date,
                    days_requested,
                    f"Migrated from OrangeHRM leave_request_id={req_id}",
                    status,
                    current_approver,
                    final_by,
                    final_at,
                    f"{date_applied}T12:00:00",
                    now,
                ),
            )
            cur.execute(
                """
                INSERT INTO leave_workflow_logs (id, leave_request_id, action, from_user_id, from_role, to_user_id, to_role, comment, created_at)
                VALUES (?, ?, ?, NULL, 'system', NULL, NULL, ?, ?)
                """,
                (new_id(), mig_id, "migrated", f"OrangeHRM aggregate_status={overall}", now),
            )

            if status == "approved":
                year = int(start_date[:4])
                cur.execute(
                    "SELECT default_days FROM leave_types WHERE id = ?",
                    (new_lt_id,),
                )
                row = cur.fetchone()
                default_days = float(row[0] or 0) if row else 0.0
                cur.execute(
                    """
                    SELECT id, allocated_days, used_days FROM leave_balances
                    WHERE user_id = ? AND leave_type_id = ? AND year = ?
                    """,
                    (uid, new_lt_id, year),
                )
                bal = cur.fetchone()
                if not bal:
                    bid = new_id()
                    used = float(days_requested)
                    cur.execute(
                        """
                        INSERT INTO leave_balances (id, user_id, leave_type_id, year, allocated_days, used_days, remaining_days, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (bid, uid, new_lt_id, year, default_days, used, max(default_days - used, 0), now, now),
                    )
                else:
                    used_days = float(bal[2] or 0) + float(days_requested)
                    allocated = float(bal[1] or 0)
                    cur.execute(
                        "UPDATE leave_balances SET used_days = ?, remaining_days = ?, updated_at = ? WHERE id = ?",
                        (used_days, max(allocated - used_days, 0), now, bal[0]),
                    )

            imported += 1

    if not args.skip_entitlements:
        if entitlement_rows:
            eu, eu_un = apply_orange_entitlements(
                cur, entitlement_rows, leave_types_oh, resolve_user, sqlite_year, ohrm_from
            )
            if eu == 0 and ohrm_from is None and sqlite_year > 2020:
                eu2, eu_un2 = apply_orange_entitlements(
                    cur, entitlement_rows, leave_types_oh, resolve_user, sqlite_year, sqlite_year - 1
                )
                if eu2 > 0:
                    print(
                        f"Entitlements: no rows matched Orange from_date year {sqlite_year}; "
                        f"retried with from_date year {sqlite_year - 1} → wrote {eu2} balance row(s), unmatched={eu_un2}"
                    )
                    eu, eu_un = eu2, eu_un2
            print(
                f"OrangeHRM entitlements → leave_balances: rows_written={eu}, unmatched_employee={eu_un} "
                f"(sqlite year={sqlite_year}; filter Orange from_date year={ohrm_from if ohrm_from is not None else sqlite_year})"
            )
        else:
            print("No ohrm_leave_entitlement rows in dump; entitlement import skipped.")

    conn.commit()
    conn.close()
    if args.only_entitlements:
        print("Done (--only-entitlements).")
    else:
        print(f"Done. imported={imported}, skipped_no_days_or_weekend_only={skipped}, unmatched_employee={unmatched}")


def _process_buffer(
    buf,
    insert_tables,
    leave_types_oh,
    leave_requests,
    leave_rows,
    entitlement_rows,
    employees,
    ohrm_users,
    ohrm_password_hashes,
    counts,
):
    if not buf or "INSERT INTO `" not in buf:
        return
    for t in insert_tables:
        needle = f"INSERT INTO `{t}` VALUES "
        if needle not in buf:
            continue
        rows = parse_insert_line(buf, t)
        counts[t] += len(rows)
        if t == "ohrm_leave_type":
            for r in rows:
                if len(r) >= 2:
                    tid = parse_int(r[0])
                    name = r[1]
                    if tid is not None and name:
                        leave_types_oh[tid] = str(name)
        elif t == "ohrm_leave_request":
            for r in rows:
                if len(r) >= 4:
                    rid = parse_int(r[0])
                    lt = parse_int(r[1])
                    d_applied = r[2]
                    emp = parse_int(r[3])
                    if rid is not None and lt is not None and emp is not None and d_applied:
                        leave_requests[rid] = (lt, str(d_applied).strip("'\"")[:10], emp)
        elif t == "ohrm_leave":
            for r in rows:
                if len(r) >= 11:
                    leave_rows.append(tuple(r[:11]))
        elif t == "ohrm_leave_entitlement":
            for r in rows:
                if len(r) >= 11:
                    entitlement_rows.append(r)
        elif t == "hs_hr_employee":
            for r in rows:
                if len(r) < 35:
                    continue
                emp_no = parse_int(r[0])
                if emp_no is None:
                    continue
                employees[emp_no] = {
                    "emp_number": emp_no,
                    "employee_id": mysql_str(r[1]) or None,
                    "emp_lastname": r[2],
                    "emp_firstname": r[3],
                    "work_email": r[31],
                    "oth_email": r[34],
                }
        elif t == "ohrm_user":
            for r in rows:
                if len(r) < 5:
                    continue
                emp_no = parse_int(r[2])
                uname = r[3]
                pwd_raw = r[4]
                deleted = parse_int(r[5]) if len(r) > 5 else 0
                status = parse_int(r[6]) if len(r) > 6 else 1
                if emp_no is None or not uname:
                    continue
                if deleted == 1 or status == 0:
                    continue
                ohrm_users[emp_no] = mysql_str(uname).strip().lower()
                pv = mysql_str(pwd_raw) if pwd_raw else ""
                if pv.strip():
                    ohrm_password_hashes[emp_no] = pv.strip()
        return


if __name__ == "__main__":
    main()
