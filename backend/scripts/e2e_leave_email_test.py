from datetime import datetime, timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from database import cursor
from main import (
    LeaveActionBody,
    LeaveRequestCreate,
    approve_leave_request,
    create_leave_request,
    submit_leave_request,
)


def pick_employee_and_supervisor():
    with cursor() as c:
        c.execute(
            """
            SELECT e.id, e.full_name, e.email, s.id, s.full_name, s.email
            FROM users e
            JOIN users s ON s.id = e.manager_id
            WHERE e.is_active = 1
              AND s.is_active = 1
              AND TRIM(COALESCE(e.email, '')) != ''
              AND TRIM(COALESCE(s.email, '')) != ''
              AND e.role IN ('employee','manager','hod','hr','admin')
            ORDER BY e.full_name COLLATE NOCASE
            LIMIT 1
            """
        )
        row = c.fetchone()
    if not row:
        return None
    return {
        "employee_id": str(row[0]),
        "employee_name": row[1],
        "employee_email": row[2],
        "supervisor_id": str(row[3]),
        "supervisor_name": row[4],
        "supervisor_email": row[5],
    }


def pick_leave_type():
    with cursor() as c:
        c.execute(
            """
            SELECT id, name
            FROM leave_types
            WHERE is_active = 1
            ORDER BY CASE WHEN UPPER(TRIM(code)) = 'ANNUAL' THEN 0 ELSE 1 END, name
            LIMIT 1
            """
        )
        row = c.fetchone()
    if not row:
        return None
    return {"id": str(row[0]), "name": row[1]}


def main():
    actor = pick_employee_and_supervisor()
    if not actor:
        raise RuntimeError("No eligible employee/supervisor pair found (both need active accounts with emails).")
    leave_type = pick_leave_type()
    if not leave_type:
        raise RuntimeError("No active leave type found.")

    start = (datetime.utcnow().date() + timedelta(days=2)).isoformat()
    end = (datetime.utcnow().date() + timedelta(days=3)).isoformat()
    reason = f"E2E EMAIL TEST {datetime.utcnow().isoformat()}"

    draft = create_leave_request(
        LeaveRequestCreate(
            leave_type_id=leave_type["id"],
            start_date=start,
            end_date=end,
            reason=reason,
        ),
        user_id=actor["employee_id"],
    )
    rid = draft["id"]
    print(f"created_draft={rid}")

    submitted = submit_leave_request(rid, user_id=actor["employee_id"])
    print(f"submitted_status={submitted.get('status')} current_approver_id={submitted.get('current_approver_id')}")

    approver_id = submitted.get("current_approver_id")
    if not approver_id:
        raise RuntimeError("Request auto-approved/no approver; cannot continue supervisor approval test.")

    step = 1
    current = submitted
    while (current.get("status") or "").startswith("pending_") and step <= 10:
        approver_id = current.get("current_approver_id")
        if not approver_id:
            break
        current = approve_leave_request(
            rid,
            LeaveActionBody(comment=f"Approved during SMTP E2E test (step {step})"),
            user_id=approver_id,
        )
        print(
            f"approval_step={step} approver={approver_id} "
            f"status={current.get('status')} next_approver={current.get('current_approver_id')}"
        )
        step += 1

    approved = current
    print(f"final_status={approved.get('status')} final_decision_by={approved.get('final_decision_by')}")

    print("---- context ----")
    print(f"employee={actor['employee_name']} <{actor['employee_email']}>")
    print(f"supervisor={actor['supervisor_name']} <{actor['supervisor_email']}>")
    print(f"leave_type={leave_type['name']} dates={start}..{end}")
    print("E2E workflow executed. Emails should be sent to supervisor (request), employee (approved), and HR/Admin (approved notice).")


if __name__ == "__main__":
    main()
