# User Management Spec (All Roles) - AI Implementation Brief

## Goal

Design and implement a robust, secure, and consistent user management system for all roles:
- `admin`
- `hr`
- `manager`
- `hod`
- `employee`

This spec is intended to be given to another AI to implement safely.

---

## 1) Current Pain Points

1. Role consistency gap:
   - User creation supports `manager`/`hod`.
   - Role update endpoint appears to allow only `admin/hr/employee`.
2. Registration risk:
   - Public registration endpoint can assign high-privilege roles.
3. Access policy drift:
   - Frontend route guards and backend endpoint guards are not fully aligned.
4. Supervisor chain quality:
   - Manager assignment and approvals can become inconsistent over time.
5. Missing governance UX:
   - Limited policy controls for who can create/activate/deactivate/assign roles.

---

## 2) Target Role Governance Policy

### Admin
- Full platform governance.
- Can create/update/deactivate users across all roles.
- Can assign/reassign roles and supervisors.

### HR
- Operational people management.
- Can create employee/manager/hod accounts.
- Cannot create or promote to `admin`.
- Can manage profile data and supervisor links.

### Manager
- Team-level workflow role.
- No global user administration.
- Can act in assigned approval workflows.

### HOD
- Department-level workflow role.
- No global user administration.
- Can act in assigned approval workflows.

### Employee
- Self-service only.
- No user administration.

---

## 3) Required Backend Changes

## A. Lock down registration
- Keep public `POST /auth/register` disabled in production OR bootstrap-only:
  - allow only when user count is zero, and force role to `admin` for first setup OR
  - fully disable and allow user creation only via authenticated admin/hr endpoint.

Acceptance:
- No unauthenticated path can create privileged users post-bootstrap.

## B. Unify role validation
- Define one backend role constant set and reuse everywhere:
  - create user
  - patch role
  - bulk import
  - filters and workflow logic

Acceptance:
- Same role set validated in all endpoints.

## C. Role transition rules
- Introduce explicit transition matrix:
  - admin -> any
  - hr -> employee/manager/hod only
  - manager/hod/employee -> none

Acceptance:
- Invalid promotions rejected with clear API error messages.

## D. Secure settings and sensitive data exposure
- Restrict `GET /settings` to admin.
- Return redacted values for secrets where needed.

Acceptance:
- Non-admin requests to settings receive 403.

## E. User lifecycle controls
- Ensure clear operations with audit logs:
  - create user
  - update role
  - activate/deactivate
  - assign/remove supervisor
  - reset password/local credentials where applicable

Acceptance:
- All changes produce audit entries with actor, target, timestamp, and before/after.

---

## 4) Required Frontend Changes

1. Role-aware UI controls in Admin/HR user pages:
   - Hide disallowed actions by current actor role.
2. Consistent role dropdown options:
   - Admin sees all roles.
   - HR sees only employee/manager/hod.
3. Confirmation prompts for high-risk changes:
   - role changes
   - deactivation
   - supervisor reassignment.
4. Route guard alignment:
   - ensure admin/HR visibility matches backend permissions.

Acceptance:
- No UI path offers action that backend will reject by policy.

---

## 5) Data and Migration Requirements

1. Add migration-safe role normalization script:
   - detect invalid role values,
   - map or quarantine bad rows.
2. Validate manager/supervisor references:
   - prevent self-supervision,
   - prevent broken foreign references.
3. Optional: maintain historical role change table for compliance.

Acceptance:
- Existing DB upgrades cleanly without data loss.

---

## 6) Security Requirements

1. Add login protection:
   - per-IP and per-identifier rate limiting,
   - temporary lockout after repeated failures.
2. Avoid sensitive secret leakage in APIs/logs.
3. Keep principle of least privilege in all endpoints.

Acceptance:
- Brute-force attempts are throttled and logged.

---

## 7) API Contract Targets

Implement/adjust endpoints to enforce policy:
- `POST /users` (admin/hr constrained by role policy)
- `PATCH /users/{uid}/role` (admin-only or policy-based admin/hr matrix)
- `PATCH /users/{uid}/active`
- `PATCH /users/{uid}/supervisor`
- `GET /users` with safe field projection by caller role
- secure `GET /settings`

Optional:
- `GET /roles/policy` to let frontend render exact allowed operations per actor role.

---

## 8) Test Plan (Must Be Implemented)

### Backend tests
- unauthenticated cannot create privileged users
- hr cannot create/promote admin
- admin can assign manager/hod/employee/hr/admin as policy permits
- role update rejects unknown roles
- settings endpoint is admin-only
- deactivate/reactivate flows keep audit trace

### Frontend tests
- role dropdown options change by actor role
- blocked actions hidden/disabled
- route guards consistent with backend

### Integration tests
- create -> assign supervisor -> submit leave -> approve flow still works
- role changes reflect immediately in permissions

---

## 9) Deliverables Expected from Another AI

1. Backend code changes with centralized role constants and policy checks.
2. Frontend user-management UI updates aligned to policy.
3. DB migration script(s) and rollout notes.
4. Automated tests and a short verification checklist.
5. Risk notes and rollback instructions.

---

## 10) Implementation Constraints

- Do not break existing employee attendance/leave/appraisal flows.
- Keep endpoints backward-compatible where possible.
- Prefer additive changes and deprecate risky behavior gradually.
- Include explicit error messages for rejected role actions.

---

## 11) Ready-to-Paste Prompt for Another AI

"Implement the user management spec in `docs/AI_USER_MANAGEMENT_SPEC.md` for this React + FastAPI + SQLite project. Start by centralizing role policy, locking down registration/settings access, and aligning frontend role UX with backend authorization. Provide migration-safe changes, tests, and a deployment checklist."

