"""
SQLite database setup and helpers. Creates tables on first run.
"""
import os
import sqlite3
import json
from contextlib import contextmanager

DB_PATH = os.environ.get("DATABASE_URL", "sqlite:///./copedu.db").replace("sqlite:///", "")

def get_conn():
    return sqlite3.connect(DB_PATH)


@contextmanager
def cursor():
    conn = get_conn()
    conn.row_factory = sqlite3.Row
    try:
        c = conn.cursor()
        yield c
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create tables if they don't exist."""
    with cursor() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS branches (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                code TEXT UNIQUE NOT NULL,
                address TEXT,
                timezone TEXT DEFAULT 'UTC',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Seed default branches if none exist (so "Create user" can fetch them)
        c.execute("SELECT COUNT(*) FROM branches")
        if c.fetchone()[0] == 0:
            import uuid
            now = __import__("datetime").datetime.utcnow().isoformat()
            defaults = [
                ("HEAD OFFICE", "HO"),
                ("NYABUGOGO", "NYA"),
                ("CHIC", "CHIC"),
                ("Extra br", "EXTRA"),
                ("REMERA", "REM"),
                ("GISOZI", "GIS"),
                ("KIMIRONKO", "KIM"),
                ("SIEGE", "SIEGE"),
                ("KIGALI CITY MARKET", "KCM"),
                ("RWAMAGANA", "RWA"),
                ("BATSINDA", "BAT"),
                ("KABUGA", "KAB"),
                ("KICUKIRO_CENTER", "KIC"),
            ]
            for name, code in defaults:
                bid = "branch-" + uuid.uuid4().hex[:8]
                c.execute(
                    "INSERT INTO branches (id, name, code, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (bid, name, code, "", now, now),
                )
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin','hr','employee')),
                branch_id TEXT REFERENCES branches(id),
                employee_id TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS attendance_logs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                branch_id TEXT REFERENCES branches(id),
                clock_in_at TEXT NOT NULL,
                clock_out_at TEXT,
                total_minutes INTEGER,
                status TEXT DEFAULT 'present',
                notes TEXT,
                client_ip TEXT,
                user_agent TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Add columns if they don't exist (for existing DBs)
        for col in ("client_ip", "user_agent"):
            try:
                c.execute(f"ALTER TABLE attendance_logs ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass
        # One clock-in per user per calendar day. Use substr so ISO timestamps (2025-02-15T08:00:00.000Z) work.
        try:
            c.execute("DROP INDEX IF EXISTS idx_attendance_user_date")
        except Exception:
            pass
        c.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_user_date
            ON attendance_logs(user_id, substr(clock_in_at, 1, 10))
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS announcements (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                created_by TEXT REFERENCES users(id),
                priority TEXT DEFAULT 'normal',
                published_at TEXT DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT,
                deadline_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("PRAGMA table_info(announcements)")
        ann_cols = [row[1] for row in c.fetchall()]
        if "deadline_at" not in ann_cols:
            c.execute("ALTER TABLE announcements ADD COLUMN deadline_at TEXT")
        c.execute("""
            CREATE TABLE IF NOT EXISTS announcement_reads (
                announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id),
                acknowledged_at TEXT NOT NULL,
                PRIMARY KEY (announcement_id, user_id)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS hr_documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                file_path TEXT NOT NULL,
                uploaded_by TEXT REFERENCES users(id),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES users(id),
                action TEXT NOT NULL,
                resource TEXT,
                resource_id TEXT,
                details TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_by TEXT REFERENCES users(id),
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Default settings
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('late_threshold_minutes', '15')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('absent_mark_time', '\"09:00\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('company_name', '\"CopeDu Staff Clock Tracker\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('working_hours_per_day', '8')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('work_start_time', '\"09:00\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('work_end_time', '\"18:00\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', '\"Africa/Kigali\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('lunch_deduction_minutes', '60')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('clock_in_same_ip_minutes', '0')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('clock_in_allowed_ip_ranges', '[]')")
        # AD/LDAP: ensure users table has ad_username column (add if missing)
        # SQLite cannot add a UNIQUE column via ALTER; add column then create unique index
        c.execute("PRAGMA table_info(users)")
        user_cols = [row[1] for row in c.fetchall()]
        if "ad_username" not in user_cols:
            c.execute("ALTER TABLE users ADD COLUMN ad_username TEXT")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ad_username ON users(ad_username) WHERE ad_username IS NOT NULL")
        if "department" not in user_cols:
            c.execute("ALTER TABLE users ADD COLUMN department TEXT")
        # Recognitions: staff can recognize another staff (visible to all, with likes and comments)
        c.execute("""
            CREATE TABLE IF NOT EXISTS recognitions (
                id TEXT PRIMARY KEY,
                from_user_id TEXT NOT NULL REFERENCES users(id),
                to_user_id TEXT NOT NULL REFERENCES users(id),
                message TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS recognition_likes (
                recognition_id TEXT NOT NULL REFERENCES recognitions(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (recognition_id, user_id)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS recognition_comments (
                id TEXT PRIMARY KEY,
                recognition_id TEXT NOT NULL REFERENCES recognitions(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id),
                body TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # recognition_type for dropdown (Teamwork, Innovation, etc.); to_user_id becomes optional in logic
        c.execute("PRAGMA table_info(recognitions)")
        rec_cols = [row[1] for row in c.fetchall()]
        if "recognition_type" not in rec_cols:
            c.execute("ALTER TABLE recognitions ADD COLUMN recognition_type TEXT")


def row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    for k, v in list(d.items()):
        if isinstance(v, str) and v and v[0] in ('{', '['):
            try:
                d[k] = json.loads(v)
            except Exception:
                pass
    return d
