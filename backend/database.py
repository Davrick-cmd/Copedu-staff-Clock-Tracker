"""
SQLite database setup and helpers.

`init_db()` runs migrations idempotently (CREATE IF NOT EXISTS, pragma checks, selective ALTER).
Application code should use `cursor()` / `get_conn()` from this module rather than opening ad-hoc connections.
"""
import os
import sqlite3
import json
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.environ.get("DATABASE_URL", "sqlite:///./copedu.db").replace("sqlite:///", "")

# Catalogue for Rwanda workplaces (Law N° 66/2018 and common HR practice). Approximate statutory-style
# defaults; 0 = on-request / policy only. HR can edit in Admin → Leave types. Override annual with
# HR_SUITE_ANNUAL_LEAVE_DAYS in the backend environment (e.g. 28.5) if company policy exceeds the baseline.
RW_LEAVE_TYPE_DEFAULTS = [
    (
        "ANNUAL",
        "Annual leave (Rwanda: 18 days + 1 day per 3 years of service, max 21; set hire date on employee record)",
        18,
    ),
    ("SICK", "Sick leave – short term (medical certificate if absence > 2 days)", 15),
    (
        "SICK_LONG",
        "Sick leave – extended / medical review (unpaid or partial per policy)",
        0,
    ),
    (
        "MATERNITY_PATERNITY",
        "Maternity leave (up to 14 weeks paid – calendar day pool, Law 66/2018)",
        98,
    ),
    ("PATERNITY", "Paternity leave", 7),
    ("COMPASSIONATE", "Compassionate / bereavement leave", 5),
    ("FAMILY", "Family responsibility leave", 3),
    ("MARRIAGE", "Marriage leave", 3),
    ("ADOPTION", "Adoption leave", 30),
    ("STUDY", "Study or examination leave", 5),
    ("PUBLIC_DUTY", "Public duty / civic obligation", 0),
    ("EMERGENCY", "Emergency leave (disaster, exceptional events)", 0),
    ("HAJJ", "Hajj leave (where applicable)", 0),
    ("SPECIAL", "Special leave (discretionary / ministerial)", 0),
    ("UNPAID", "Unpaid leave", 0),
    ("DAY_OFF_IN_LIEU", "Day off in lieu (balance usually from HR or OrangeHRM import)", 0),
]


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
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_work_hours_auto_clock_out', '10')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('leave_email_enabled', 'false')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_host', '\"\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_port', '\"587\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_user', '\"\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_password', '\"\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_from', '\"\"')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_use_tls', 'true')")
        # AD/LDAP: ensure users table has ad_username column (add if missing)
        # SQLite cannot add a UNIQUE column via ALTER; add column then create unique index
        c.execute("PRAGMA table_info(users)")
        user_cols = [row[1] for row in c.fetchall()]
        if "ad_username" not in user_cols:
            c.execute("ALTER TABLE users ADD COLUMN ad_username TEXT")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ad_username ON users(ad_username) WHERE ad_username IS NOT NULL")
        if "department" not in user_cols:
            c.execute("ALTER TABLE users ADD COLUMN department TEXT")
        if "manager_id" not in user_cols:
            c.execute("ALTER TABLE users ADD COLUMN manager_id TEXT REFERENCES users(id)")
        # Allow manager and hod roles: SQLite cannot ALTER CHECK, so recreate users table once
        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        users_sql = c.fetchone()
        needs_role_migration = users_sql and isinstance(users_sql[0], str) and "CHECK(role IN" in users_sql[0] and "'hod'" not in users_sql[0]
        if needs_role_migration:
            c.execute("PRAGMA table_info(users)")
            ucols = [r[1] for r in c.fetchall()]
            c.execute("""
                CREATE TABLE users_appraisal_new (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('admin','hr','employee','manager','hod')),
                    branch_id TEXT,
                    employee_id TEXT,
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    ad_username TEXT,
                    department TEXT,
                    manager_id TEXT
                )
            """)
            c.execute("""
                INSERT INTO users_appraisal_new
                (id, email, password_hash, full_name, role, branch_id, employee_id, is_active, created_at, updated_at, ad_username, department, manager_id)
                SELECT id, email, password_hash, full_name, role, branch_id, employee_id, is_active, created_at, updated_at, ad_username, department, manager_id
                FROM users
            """)
            c.execute("DROP TABLE users")
            c.execute("ALTER TABLE users_appraisal_new RENAME TO users")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ad_username ON users(ad_username) WHERE ad_username IS NOT NULL")
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

        # ---------- Appraisal module ----------
        c.execute("""
            CREATE TABLE IF NOT EXISTS appraisal_cycles (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL CHECK(type IN ('annual','quarterly')),
                year INTEGER NOT NULL,
                quarter TEXT CHECK(quarter IN ('Q1','Q2','Q3','Q4')),
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS kpis (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                cycle_id TEXT NOT NULL REFERENCES appraisal_cycles(id),
                title TEXT NOT NULL,
                description TEXT,
                target TEXT,
                weight REAL,
                status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_supervisor','returned','verified','approved','received','acknowledged')),
                current_approver_id TEXT REFERENCES users(id),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS appraisals (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                cycle_id TEXT NOT NULL REFERENCES appraisal_cycles(id),
                status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_supervisor','returned','verified','approved','received','acknowledged')),
                current_approver_id TEXT REFERENCES users(id),
                achievements TEXT,
                challenges TEXT,
                overall_comments TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS appraisal_kpi_assessments (
                id TEXT PRIMARY KEY,
                appraisal_id TEXT NOT NULL REFERENCES appraisals(id) ON DELETE CASCADE,
                kpi_id TEXT NOT NULL REFERENCES kpis(id),
                self_assessment TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(appraisal_id, kpi_id)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS workflow_comments (
                id TEXT PRIMARY KEY,
                reference_type TEXT NOT NULL CHECK(reference_type IN ('kpi','appraisal')),
                reference_id TEXT NOT NULL,
                from_user_id TEXT NOT NULL REFERENCES users(id),
                from_role TEXT NOT NULL,
                comment TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS workflow_logs (
                id TEXT PRIMARY KEY,
                reference_type TEXT NOT NULL CHECK(reference_type IN ('kpi','appraisal')),
                reference_id TEXT NOT NULL,
                action TEXT NOT NULL,
                from_user_id TEXT REFERENCES users(id),
                from_role TEXT NOT NULL,
                to_role TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS acknowledgements (
                id TEXT PRIMARY KEY,
                reference_type TEXT NOT NULL CHECK(reference_type IN ('kpi','appraisal')),
                reference_id TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(id),
                acknowledged_at TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_kpis_user_cycle ON kpis(user_id, cycle_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_appraisals_user_cycle ON appraisals(user_id, cycle_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_workflow_ref ON workflow_logs(reference_type, reference_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_workflow_comments_ref ON workflow_comments(reference_type, reference_id)")

        # Appraisals: total_score and rating (for quarterly calculated score/rating)
        c.execute("PRAGMA table_info(appraisals)")
        app_cols = [row[1] for row in c.fetchall()]
        if "total_score" not in app_cols:
            c.execute("ALTER TABLE appraisals ADD COLUMN total_score REAL")
        if "rating" not in app_cols:
            c.execute("ALTER TABLE appraisals ADD COLUMN rating TEXT")
        if "employee_agreed_scores_at" not in app_cols:
            c.execute("ALTER TABLE appraisals ADD COLUMN employee_agreed_scores_at TEXT")
        if "signed_document_id" not in app_cols:
            c.execute("ALTER TABLE appraisals ADD COLUMN signed_document_id TEXT")

        # KPI / quarterly appraisal: supervisor chain (like leave) instead of role-only verify
        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='kpis'")
        kpi_sql_row = c.fetchone()
        kpi_sql = (kpi_sql_row[0] or "") if kpi_sql_row else ""
        if kpi_sql and "pending_supervisor" not in kpi_sql:
            c.execute("PRAGMA foreign_keys=OFF")
            c.execute("""
                CREATE TABLE kpis_supervisor_mig (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    cycle_id TEXT NOT NULL REFERENCES appraisal_cycles(id),
                    title TEXT NOT NULL,
                    description TEXT,
                    target TEXT,
                    weight REAL,
                    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_supervisor','returned','verified','approved','received','acknowledged')),
                    current_approver_id TEXT REFERENCES users(id),
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            c.execute("""
                INSERT INTO kpis_supervisor_mig (
                    id, user_id, cycle_id, title, description, target, weight, status, current_approver_id, created_at, updated_at
                )
                SELECT k.id, k.user_id, k.cycle_id, k.title, k.description, k.target, k.weight,
                    CASE
                        WHEN k.status = 'submitted' AND (SELECT manager_id FROM users u WHERE u.id = k.user_id) IS NOT NULL
                            THEN 'pending_supervisor'
                        WHEN k.status = 'submitted' THEN 'verified'
                        ELSE k.status
                    END,
                    CASE
                        WHEN k.status = 'submitted' AND (SELECT manager_id FROM users u WHERE u.id = k.user_id) IS NOT NULL
                            THEN (SELECT manager_id FROM users u WHERE u.id = k.user_id)
                        ELSE NULL
                    END,
                    k.created_at, k.updated_at
                FROM kpis k
            """)
            c.execute("DROP TABLE kpis")
            c.execute("ALTER TABLE kpis_supervisor_mig RENAME TO kpis")
            c.execute("CREATE INDEX IF NOT EXISTS idx_kpis_user_cycle ON kpis(user_id, cycle_id)")
            c.execute("PRAGMA foreign_keys=ON")

        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='appraisals'")
        appr_sql_row = c.fetchone()
        appr_sql = (appr_sql_row[0] or "") if appr_sql_row else ""
        if appr_sql and "pending_supervisor" not in appr_sql:
            c.execute("PRAGMA foreign_keys=OFF")
            c.execute("ALTER TABLE appraisals RENAME TO appraisals_supervisor_old")
            c.execute("""
                CREATE TABLE appraisals (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    cycle_id TEXT NOT NULL REFERENCES appraisal_cycles(id),
                    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_supervisor','returned','verified','approved','received','acknowledged')),
                    current_approver_id TEXT REFERENCES users(id),
                    achievements TEXT,
                    challenges TEXT,
                    overall_comments TEXT,
                    total_score REAL,
                    rating TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            c.execute("""
                INSERT INTO appraisals (
                    id, user_id, cycle_id, status, current_approver_id, achievements, challenges, overall_comments,
                    total_score, rating, created_at, updated_at
                )
                SELECT a.id, a.user_id, a.cycle_id,
                    CASE
                        WHEN a.status = 'submitted' AND (SELECT manager_id FROM users u WHERE u.id = a.user_id) IS NOT NULL
                            THEN 'pending_supervisor'
                        WHEN a.status = 'submitted' THEN 'verified'
                        ELSE a.status
                    END,
                    CASE
                        WHEN a.status = 'submitted' AND (SELECT manager_id FROM users u WHERE u.id = a.user_id) IS NOT NULL
                            THEN (SELECT manager_id FROM users u WHERE u.id = a.user_id)
                        ELSE NULL
                    END,
                    a.achievements, a.challenges, a.overall_comments,
                    a.total_score, a.rating, a.created_at, a.updated_at
                FROM appraisals_supervisor_old a
            """)
            c.execute("DROP TABLE appraisals_supervisor_old")
            c.execute("CREATE INDEX IF NOT EXISTS idx_appraisals_user_cycle ON appraisals(user_id, cycle_id)")
            c.execute("PRAGMA foreign_keys=ON")

        # ---------- Annual KPI (once per year, approved then locked; reused for quarterly appraisals) ----------
        c.execute("""
            CREATE TABLE IF NOT EXISTS appraisal_annual_kpis (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                year INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','returned_supervisor','approved_supervisor','returned_hod','approved_hod','locked')),
                pending_approver_id TEXT REFERENCES users(id),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, year)
            )
        """)
        c.execute("PRAGMA table_info(appraisal_annual_kpis)")
        aak_cols = [row[1] for row in c.fetchall()]
        if "pending_approver_id" not in aak_cols:
            c.execute("ALTER TABLE appraisal_annual_kpis ADD COLUMN pending_approver_id TEXT REFERENCES users(id)")
        # Backfill: submitted annual KPIs with no pending_approver_id get owner's manager as first approver
        c.execute("""
            UPDATE appraisal_annual_kpis SET pending_approver_id = (SELECT manager_id FROM users WHERE users.id = appraisal_annual_kpis.user_id)
            WHERE status = 'submitted' AND (pending_approver_id IS NULL OR pending_approver_id = '')
            AND user_id IN (SELECT id FROM users WHERE manager_id IS NOT NULL AND manager_id != '')
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS appraisal_kpi_titles (
                id TEXT PRIMARY KEY,
                annual_kpi_id TEXT NOT NULL REFERENCES appraisal_annual_kpis(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS appraisal_kpi_items (
                id TEXT PRIMARY KEY,
                kpi_title_id TEXT NOT NULL REFERENCES appraisal_kpi_titles(id) ON DELETE CASCADE,
                description TEXT NOT NULL,
                weight REAL NOT NULL,
                target TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS appraisal_scores (
                id TEXT PRIMARY KEY,
                appraisal_id TEXT NOT NULL REFERENCES appraisals(id) ON DELETE CASCADE,
                kpi_item_id TEXT NOT NULL REFERENCES appraisal_kpi_items(id) ON DELETE CASCADE,
                self_score REAL,
                self_comment TEXT,
                supervisor_score REAL,
                supervisor_comment TEXT,
                agreed_score REAL,
                hod_comment TEXT,
                weighted_score REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(appraisal_id, kpi_item_id)
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_annual_kpis_user_year ON appraisal_annual_kpis(user_id, year)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_kpi_titles_annual ON appraisal_kpi_titles(annual_kpi_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_kpi_items_title ON appraisal_kpi_items(kpi_title_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_appraisal_scores_appraisal ON appraisal_scores(appraisal_id)")

        # ---------- Leave module ----------
        c.execute("""
            CREATE TABLE IF NOT EXISTS leave_types (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                default_days INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS leave_balances (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
                year INTEGER NOT NULL,
                allocated_days REAL NOT NULL DEFAULT 0,
                used_days REAL NOT NULL DEFAULT 0,
                remaining_days REAL NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, leave_type_id, year)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS leave_requests (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                days_requested REAL NOT NULL DEFAULT 0,
                reason TEXT,
                status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
                    'draft','submitted','pending_manager','pending_hod','pending_hr','approved','rejected','returned','cancelled'
                )),
                current_approver_id TEXT REFERENCES users(id),
                final_decision_by TEXT REFERENCES users(id),
                final_decision_at TEXT,
                created_by_user_id TEXT REFERENCES users(id),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        try:
            c.execute("ALTER TABLE leave_requests ADD COLUMN created_by_user_id TEXT REFERENCES users(id)")
        except sqlite3.OperationalError:
            pass
        c.execute("""
            CREATE TABLE IF NOT EXISTS leave_workflow_logs (
                id TEXT PRIMARY KEY,
                leave_request_id TEXT NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
                action TEXT NOT NULL,
                from_user_id TEXT REFERENCES users(id),
                from_role TEXT,
                to_user_id TEXT REFERENCES users(id),
                to_role TEXT,
                comment TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS leave_balance_adjustments (
                id TEXT PRIMARY KEY,
                target_user_id TEXT NOT NULL REFERENCES users(id),
                leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
                year INTEGER NOT NULL,
                requested_allocated_days REAL NOT NULL DEFAULT 0,
                reason TEXT,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
                requested_by_user_id TEXT NOT NULL REFERENCES users(id),
                current_approver_id TEXT REFERENCES users(id),
                approved_by_user_id TEXT REFERENCES users(id),
                approved_at TEXT,
                rejection_comment TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("PRAGMA table_info(leave_balance_adjustments)")
        _adj_cols = [row[1] for row in c.fetchall()]
        if "current_approver_id" not in _adj_cols:
            try:
                c.execute("ALTER TABLE leave_balance_adjustments ADD COLUMN current_approver_id TEXT REFERENCES users(id)")
            except sqlite3.OperationalError:
                pass
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_requests_approver ON leave_requests(current_approver_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_logs_request ON leave_workflow_logs(leave_request_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_adj_status ON leave_balance_adjustments(status)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_adj_target ON leave_balance_adjustments(target_user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_adj_requested_by ON leave_balance_adjustments(requested_by_user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_leave_adj_approver ON leave_balance_adjustments(current_approver_id)")
        # Seed leave types (Rwanda-oriented catalogue; INSERT OR IGNORE preserves existing codes on upgrade)
        for code, name, days in RW_LEAVE_TYPE_DEFAULTS:
            c.execute(
                "INSERT OR IGNORE INTO leave_types (id, code, name, default_days) VALUES (?, ?, ?, ?)",
                ("leave-type-" + code.lower().replace("/", "_"), code, name, days),
            )
        c.execute(
            "UPDATE leave_types SET default_days = 5, updated_at = datetime('now') WHERE UPPER(TRIM(code)) = 'STUDY' AND COALESCE(default_days, 0) = 0"
        )
        # Baseline annual days (Rwanda law commonly cited as 18 working days/year); override via HR_SUITE_ANNUAL_LEAVE_DAYS
        _annual_days = 18.0
        c.execute(
            "UPDATE leave_types SET default_days = ?, updated_at = datetime('now') WHERE UPPER(code) = 'ANNUAL'",
            (_annual_days,),
        )
        _cy = datetime.utcnow().year
        c.execute(
            """
            UPDATE leave_balances
            SET allocated_days = ?,
                remaining_days = MAX(0, ? - COALESCE(used_days, 0)),
                updated_at = datetime('now')
            WHERE leave_type_id = (SELECT id FROM leave_types WHERE UPPER(code) = 'ANNUAL' LIMIT 1)
              AND year = ?
              AND ABS(COALESCE(allocated_days, 0) - 21) < 0.01
            """,
            (_annual_days, _annual_days, _cy),
        )

        # Widen workflow reference_type to include 'annual_kpi' (SQLite: recreate tables)
        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_comments'")
        wc_sql = c.fetchone()
        if wc_sql and "annual_kpi" not in (wc_sql[0] or ""):
            c.execute("""
                CREATE TABLE IF NOT EXISTS workflow_comments_new (
                    id TEXT PRIMARY KEY,
                    reference_type TEXT NOT NULL CHECK(reference_type IN ('kpi','appraisal','annual_kpi')),
                    reference_id TEXT NOT NULL,
                    from_user_id TEXT NOT NULL REFERENCES users(id),
                    from_role TEXT NOT NULL,
                    comment TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            c.execute("INSERT INTO workflow_comments_new SELECT * FROM workflow_comments")
            c.execute("DROP TABLE workflow_comments")
            c.execute("ALTER TABLE workflow_comments_new RENAME TO workflow_comments")
            c.execute("CREATE INDEX IF NOT EXISTS idx_workflow_comments_ref ON workflow_comments(reference_type, reference_id)")
        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_logs'")
        wl_sql = c.fetchone()
        if wl_sql and "annual_kpi" not in (wl_sql[0] or ""):
            c.execute("""
                CREATE TABLE IF NOT EXISTS workflow_logs_new (
                    id TEXT PRIMARY KEY,
                    reference_type TEXT NOT NULL CHECK(reference_type IN ('kpi','appraisal','annual_kpi')),
                    reference_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    from_user_id TEXT REFERENCES users(id),
                    from_role TEXT NOT NULL,
                    to_role TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            c.execute("INSERT INTO workflow_logs_new SELECT * FROM workflow_logs")
            c.execute("DROP TABLE workflow_logs")
            c.execute("ALTER TABLE workflow_logs_new RENAME TO workflow_logs")
            c.execute("CREATE INDEX IF NOT EXISTS idx_workflow_ref ON workflow_logs(reference_type, reference_id)")

        # ---------- Remove Performance Contract tables (replaced by single Appraisal module) ----------
        for t in ("quarterly_appraisal_scores", "quarterly_appraisals", "performance_contract_kpi_items", "performance_contract_categories", "performance_contracts"):
            c.execute(f"DROP TABLE IF EXISTS {t}")

        # HR profile fields (editable by HR/Admin; visible to employee on dashboard)
        c.execute("PRAGMA table_info(users)")
        _user_cols = [row[1] for row in c.fetchall()]
        for col, sql in [
            ("gender", "ALTER TABLE users ADD COLUMN gender TEXT"),
            ("phone", "ALTER TABLE users ADD COLUMN phone TEXT"),
            ("employee_code", "ALTER TABLE users ADD COLUMN employee_code TEXT"),
            ("job_title", "ALTER TABLE users ADD COLUMN job_title TEXT"),
            ("division", "ALTER TABLE users ADD COLUMN division TEXT"),
            ("work_anniversary", "ALTER TABLE users ADD COLUMN work_anniversary TEXT"),
            ("hr_notes", "ALTER TABLE users ADD COLUMN hr_notes TEXT"),
            ("date_of_birth", "ALTER TABLE users ADD COLUMN date_of_birth TEXT"),
            ("net_salary", "ALTER TABLE users ADD COLUMN net_salary REAL"),
            ("is_married", "ALTER TABLE users ADD COLUMN is_married INTEGER"),
        ]:
            if col not in _user_cols:
                try:
                    c.execute(sql)
                except sqlite3.OperationalError:
                    pass

        c.execute("""
            CREATE TABLE IF NOT EXISTS staff_documents (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL CHECK(kind IN ('hr_confidential','employee_certificate')),
                title TEXT NOT NULL,
                file_path TEXT NOT NULL,
                uploaded_by TEXT NOT NULL REFERENCES users(id),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_staff_documents_user ON staff_documents(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_staff_documents_kind ON staff_documents(kind)")

        c.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                link TEXT,
                read_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at)")


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
