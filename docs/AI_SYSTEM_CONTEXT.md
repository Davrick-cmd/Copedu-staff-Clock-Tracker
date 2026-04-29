# Copedu HR Suite - AI Handover Context

## 1) Product Summary

Copedu HR Suite is a web-based HR platform used for:
- attendance (clock in/out, lateness/absence analytics),
- leave management (request, approval flow, balances, overview dashboards),
- employee records (profiles, reporting lines, employment data),
- announcements and recognition,
- appraisal and KPI workflows,
- admin settings and audit/governance tooling.

Branding in frontend constants:
- App display name: `Copedu HR Suite`
- Formal name: `Copedu Human Resource Suite`
- Support email: `hr@copeduplc.rw`
- Logo path: `/images/copedu-logo.jpeg`

## 2) Tech Stack and Architecture

- **Frontend:** React + Vite + Tailwind + Redux + React Router
- **Backend:** FastAPI (single large `main.py`)
- **Database:** SQLite (via custom cursor helpers in backend)
- **Auth:** JWT bearer token from backend; role-based route and endpoint checks
- **Email:** SMTP for leave and app notifications
- **Deployment:** Linux VM with systemd service (`clockin-backend`) and nginx serving frontend static files

Key directories:
- `src/` frontend pages/components/routes/services
- `backend/` FastAPI app and DB logic
- `docs/` operational and user documentation

## 3) Roles and Access Model (Current)

Roles used in app:
- `admin`
- `hr`
- `manager`
- `hod`
- `employee`

Role constants and routes are in `src/utils/constants.js` and `src/routes/index.jsx`.

## 4) Main Functional Flows

### Attendance
- Employee clocks in/out.
- HR/Admin dashboards summarize attendance and trends.

### Leave
- Employee submits leave request.
- Current production behavior: request goes to assigned supervisor and approval in `_act_on_leave(..., action="approve")` finalizes as `approved`.
- Notifications are sent:
  - email (if enabled),
  - in-app bell notification.

### Employee Records
- HR/Admin manage staff profile data, supervisor assignment, and status.

### Appraisal
- Separate multi-step workflow for KPIs/appraisals with manager/HOD/HR roles.

## 5) Important Files

Backend:
- `backend/main.py` - primary API and business logic (auth, users, leave, settings, appraisal, notifications)
- `backend/database.py` - DB helpers and schema support

Frontend:
- `src/routes/index.jsx` - route protection and role routing
- `src/services/api.js` - API client
- `src/pages/LoginPage.jsx` - login experience
- `src/pages/hr/HRLeaveDashboard.jsx` - leave dashboard summaries and actions
- `src/components/NotificationBell.jsx` - in-app notification rendering

Config and docs:
- `.env` (runtime config)
- `docs/USER_GUIDE.md`
- `docs/USER_CREATION_AND_AD_INTEGRATION.md`
- `docs/LDAP_CONFIG_FOR_OTHER_APP.md`

## 6) Recent Changes Already Applied

- Improved employee leave-approved email format (professional, structured details).
- Improved supervisor leave-approval-needed email format.
- Added richer employee in-app leave-approved notification body.
- Login page responsive fit improvements for smaller screens.
- Favicon switched to company logo.
- Login copy cleanup:
  - removed long policy footer line,
  - simplified username/email placeholder.
- HR leave dashboard adjusted:
  - removed `Awaiting HOD` and `Awaiting HR` cards,
  - added direct pending-review action links.

## 7) Known Risks / Weaknesses (Current)

1. `POST /auth/register` can create privileged roles if exposed publicly.
2. `GET /settings` currently appears accessible to any authenticated user.
3. Leave flow state naming suggests multi-step, but approve path finalizes immediately.
4. Role handling is inconsistent across create/update endpoints (`manager/hod` gaps).
5. Some route guards (e.g. HR reports) may not match intended admin access.
6. Brute-force login protections are not clearly implemented.

## 8) Deployment Model (Current Practice)

From Windows:
- build frontend with `npm run build`
- `scp` files/folders to VM (`administrator@10.10.10.116`)

On VM:
- backend path: `/opt/clock-in-out/backend/main.py`
- frontend static path: `/opt/clock-in-out/dist`
- backend service: `clockin-backend`
- nginx serves static build

Typical VM steps:
- replace files,
- restart backend service (if backend changed),
- replace `dist` and reload nginx (if frontend changed),
- validate with `nginx -t` and service status checks.

## 9) What Another AI Should Do First

1. Read `backend/main.py` auth/register/settings/user role endpoints.
2. Confirm role matrix end-to-end (backend + frontend route guards).
3. Verify leave workflow expectations (single-step vs multi-step policy).
4. Add/validate tests for:
   - auth and role boundaries,
   - leave submit/approve/reject/reschedule,
   - notification payload consistency.

## 10) Handover Prompt (Paste to Another AI)

"You are helping on Copedu HR Suite (React + FastAPI + SQLite). Read `docs/AI_SYSTEM_CONTEXT.md` and `docs/AI_USER_MANAGEMENT_SPEC.md` first. Then propose and implement safe, production-ready user management improvements with strict RBAC, consistent role handling, and migration-safe changes. Keep backward compatibility where possible and include verification steps."

