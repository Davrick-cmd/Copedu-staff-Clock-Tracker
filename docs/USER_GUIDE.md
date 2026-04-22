# CopeDu HR Suite User Guide

This guide helps teams use the system confidently, from Employee self-service to HR operations and Admin controls.

---

## 1) Employee Guide

### Login and Home
- Sign in with your company account (email/password or AD username, based on your setup).
- After login, your dashboard shows attendance, leave summary, and notifications.

### Attendance
- Use **Clock in** when you start work and **Clock out** when you finish.
- If you forget to clock out, HR can still review your attendance logs.
- You can check your own records under attendance/history pages.

### Leave Request
- Open **My Leave** and click **New request**.
- Select leave type, dates, and reason.
- Submit to send it to your supervisor for approval.
- You can cancel or edit requests only when they are still in editable states (draft/returned).

### Leave Status and Notifications
- You receive in-app notifications (bell) when leave is approved/rejected/returned.
- You also receive email notifications when leave email settings are enabled.
- Use **Clear all** or **Mark all read** to manage notification clutter.

### Profile and Records
- You can view your own profile information and leave balances.
- Sensitive fields (like payroll notes) are not shown to employees.

---

## 2) HR Guide

### Employee Records
- Open **Employee records** to manage workforce data.
- Use **Edit record** to update profile details (department, supervisor, job title, etc.).
- You can now **activate/deactivate** employee accounts from edit modal.
- Inactive users are visible with a clear **Inactive** status badge.

### Attendance and Dashboards
- HR dashboards provide summary-first KPIs and charts.
- Use attendance pages for lateness, absences, and trend analysis.
- Drill down from dashboard cards to full detail pages.

### Leave Operations
- HR can request entitlement updates, assign leave types, and manage leave setup.
- Entitlement changes are not applied directly; they enter approval workflow.
- The required approver is the requester’s supervisor (anti-fraud guard).

### Leave Workflow and Email Behavior
- Leave request flow:
  1. Employee submits leave -> supervisor notified.
  2. Supervisor approves -> final approval happens.
  3. Employee and HR are notified (in-app + email when configured).
- HR gets notifications but only approves when HR is the assigned supervisor in chain.

### Reports
- Use reports with date filters and type filters.
- Export only the currently selected report scope (CSV/XLSX).
- Ensure filters (type/date/department/users) are set before download.

---

## 3) Admin Guide

### System Report
- Admin sees **System report** for:
  - Health status
  - Uptime
  - DB size
  - Login activity

### Settings
- All settings sections use explicit **Save** buttons.
- Leave email settings are managed in Admin settings and applied by backend logic.

### Data Maintenance (Safe Cleanup)
- Use **Data maintenance** in Admin settings to clean old:
  - Notifications
  - Audit logs
- Safety controls include:
  - Minimum retention days
  - Confirmation phrase requirement
  - Archive-before-delete behavior

### User and Access Governance
- Admin controls roles and account status.
- Use least privilege:
  - Admin for platform governance
  - HR for day-to-day people operations

---

## 4) Recommended Daily Routine

### Employees
- Clock in/out on time.
- Submit leave early with clear reasons.
- Check notifications regularly.

### HR
- Review pending workflow items.
- Keep employee records accurate (supervisor/department/hire data).
- Monitor attendance and leave dashboards daily.

### Admin
- Review system report and login trends.
- Validate settings after any infrastructure change.
- Run maintenance cleanup periodically with retention policy.

---

## 5) Troubleshooting Quick Reference

### Cannot login
- Confirm backend service is running.
- Confirm API path from frontend points to `/api`.
- Verify user account is active.

### Leave emails not arriving
- Check SMTP host/port/from credentials in settings/backend env.
- Confirm DNS/network can reach SMTP server.
- Confirm leave email toggle is enabled (or SMTP auto-detection is valid).

### Dashboard values show zero
- Confirm backend API is reachable.
- Verify role permissions for requested endpoints.
- Refresh browser after backend restart.

---

## 6) Go-Live Checklist (Operational)

- Roles and access tested (Employee, HR, Admin).
- Leave workflow tested end-to-end with emails.
- Employee records validated (active status, supervisor, department).
- Reports and exports validated for selected filters.
- Backup strategy confirmed for `copedu.db`.

