# User Creation, AD/LDAP Integration, Storage & Roles

This document describes how users are created, how admins fetch users from Active Directory (AD), how they are stored, and how roles/rights are assigned — so you can reuse this pattern in another app.

---

## 1. Where users are created

### Frontend
- **Page:** `src/pages/admin/AdminUsers.jsx`
- **Route:** Admin → Users (admin-only).
- Admin can:
  - **Add user (single):** Form with AD username (optional), Full name, Email, Password, Role, Branch, Department, Manager (supervisor).
  - **Fetch from AD:** Enter AD username → click "Fetch from AD" → calls backend to look up user in AD and pre-fills Full name and Email.
  - **Bulk import:** Upload CSV with columns `username`, `role`; optional: `full_name`, `email`, `department`, `branch`. Username = AD sAMAccountName; backend can lookup AD for missing name/email.

### Backend API
- **Single create:** `POST /users` (admin only).
- **AD lookup (for create form):** `GET /users/lookup-ad?username=<sAMAccountName>` (admin only). Returns `{ full_name, email }`.
- **Bulk import:** `POST /users/bulk-import` with CSV file (admin only). Each row: `username` (AD), `role`; optional `full_name`, `email`, `department`, `branch`. Backend uses same AD lookup when name/email missing.

---

## 2. How admins fetch users from AD

### LDAP config (backend)
Config comes from **environment variables** (and optionally DB settings). Used for both **login** and **lookup**.

| Env / Setting | Purpose |
|---------------|---------|
| `LDAP_URL` or `LDAP_URI` | AD/LDAP server URL (e.g. `ldap://dc.example.com`) |
| `LDAP_BIND_DN` | Service account DN for binding (e.g. `CN=svc_ldap,OU=Service,DC=copeduplc,DC=rw`) |
| `LDAP_BIND_PASSWORD` | Service account password |
| `LDAP_SEARCH_BASE` | Search base (e.g. `OU=Users,DC=copeduplc,DC=rw` or `DC=copeduplc,DC=rw`) |
| `LDAP_USERNAME_ATTRIBUTE` | Attribute for username (default `sAMAccountName`) |
| `LDAP_NAME_ATTRIBUTE` | Attribute for display name (default `displayName`) |
| `LDAP_EMAIL_ATTRIBUTE` | Attribute for email (default `mail`) |
| `LDAP_EMAIL_DOMAIN` | Default email domain if `mail` is empty (e.g. `copeduplc.rw`) |
| `LDAP_ENABLED` | Optional: `1` / `true` / `yes` to force enable |

### Lookup flow (no password)
- **Backend:** `backend/main.py` — `_ldap_lookup_user(username)` and endpoint `GET /users/lookup-ad?username=...`.
- Uses **ldap3** (Python): connect to AD with service account, search by `(sAMAccountName=<username>)`, return **displayName** and **mail** (with fallbacks for attribute casing).
- Search is done under `LDAP_SEARCH_BASE`; if that’s an OU, domain root is also tried.
- **Admin UI:** User types AD username → "Fetch from AD" → `api.lookupADUser(adUsername)` → backend runs `_ldap_lookup_user` → response fills Full name and Email in the form.

### Code references (backend)
- LDAP config: `_get_ldap_config()` in `main.py` (reads env + optional DB settings).
- Lookup: `_ldap_lookup_user(username)` in `main.py` (returns `(dict with full_name, email, None)` or `(None, error_msg)`).
- Endpoint: `@app.get("/users/lookup-ad")` → calls `_ldap_lookup_user(username)`; 404 if not found, 503 if LDAP error.

### Frontend API
```js
// src/services/api.js
export async function lookupADUser(username) {
  const { data } = await api.get('/users/lookup-ad', { params: { username: (username || '').trim() } });
  return data;  // { full_name, email }
}
```

---

## 3. How users are stored

### Database: `users` table (SQLite)
Defined in `backend/database.py`. Core columns:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID (internal ID). |
| `email` | TEXT UNIQUE NOT NULL | Login identifier for non-AD; for AD users often `username@domain`. |
| `password_hash` | TEXT NOT NULL | Bcrypt hash. For AD-only users: a **placeholder hash** (they never log in with local password). |
| `full_name` | TEXT NOT NULL | Display name. |
| `role` | TEXT NOT NULL | One of: `admin`, `hr`, `employee`, `manager`, `hod`. |
| `branch_id` | TEXT FK | Optional link to `branches`. |
| `employee_id` | TEXT | Optional employee code. |
| `is_active` | INTEGER | 1 = active, 0 = deactivated. |
| `ad_username` | TEXT UNIQUE (nullable) | AD sAMAccountName. If set, user logs in via LDAP with domain password. |
| `department` | TEXT | Optional. |
| `manager_id` | TEXT FK → users(id) | Supervisor for approval chain (appraisal). |
| `created_at` / `updated_at` | TEXT | ISO timestamps. |

- **Local-only user:** `ad_username` = NULL; `email` and `password` required; login with email + password.
- **AD user:** `ad_username` set; `email` can be from AD or `username@domain`; `password_hash` = placeholder; login with AD username (or UPN/email) + **domain password** (verified via LDAP bind).

### Create user payload (single)
- **With AD:** `full_name`, `role`, `ad_username`; optional `email`, `branch_id`, `department`, `manager_id`. Backend rejects if `ad_username` already exists.
- **Without AD:** `full_name`, `role`, `email`, `password`; optional `branch_id`, `department`, `manager_id`. Backend hashes password and rejects if email exists.

Backend: `POST /users` with body per `CreateUserRequest` in `main.py` (email, password, full_name, role, ad_username, branch_id, department, manager_id).

---

## 4. How rights and roles are assigned

### Roles
- **Stored in:** `users.role`.
- **Allowed values:** `admin`, `hr`, `employee`, `manager`, `hod`.
- **Who can set:** Only **admin** (for role change and user create). HR can manage supervisor and see users, but role change is admin-only in this app.

### Assigning role
- **At create:** Include `role` in `POST /users` (default `employee`). Valid: `admin`, `hr`, `employee`, `manager`, `hod`.
- **After create:** `PATCH /users/{uid}/role` with body `{ "role": "admin" | "hr" | "employee" }`. Admin only. (Note: in code, `set_user_role` only allows admin/hr/employee; manager/hod can be set at create or by extending this endpoint.)

### Supervisor (manager_id)
- **Purpose:** Approval chain (e.g. appraisal: employee → manager → HOD). Stored in `users.manager_id` (FK to `users.id`).
- **Who can set:** Admin or HR.
- **API:** `PATCH /users/{uid}/supervisor` with body `{ "manager_id": "<user_id>" | null }`.

### Active / Deactivate
- **API:** `PATCH /users/{uid}/active` with body `{ "is_active": true | false }`. Admin only. Used to disable login without deleting the user.

### Listing users (who can see)
- **API:** `GET /users`. Allowed for **admin** and **hr**. Response includes `supervisor_name` (join on `manager_id`) and branch info.

---

## 5. API summary (for your other app)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users/lookup-ad?username=<sAMAccountName>` | Admin (JWT) | Fetch from AD: returns `{ full_name, email }`. |
| POST | `/users` | Admin | Create user. Body: full_name, role [, email, password \| ad_username [, branch_id, department, manager_id ]]. |
| POST | `/users/bulk-import` | Admin | CSV: username, role [, full_name, email, department, branch ]. |
| GET | `/users` | Admin, HR | List users (with branch, supervisor_name). |
| PATCH | `/users/{uid}/role` | Admin | Set role: `{ "role": "admin" \| "hr" \| "employee" }`. |
| PATCH | `/users/{uid}/supervisor` | Admin, HR | Set supervisor: `{ "manager_id": "<id>" \| null }`. |
| PATCH | `/users/{uid}/active` | Admin | Activate/deactivate: `{ "is_active": true \| false }`. |

---

## 6. Login (how AD users sign in)

- **Single endpoint:** `POST /auth/login` with `identifier` + `password`.
- **Identifier** can be: email, or AD username (sAMAccountName), or UPN (e.g. `user@copeduplc.rw`). Backend normalizes and finds user by `email` or `ad_username`.
- If user has `ad_username` set: password is checked via **LDAP bind** (user’s DN + password). No local password check.
- If user has no `ad_username`: password is checked against `password_hash` (bcrypt).

So: **create with `ad_username` + store placeholder hash** → **login with username/email + domain password** → backend verifies via LDAP.

---

## 7. File reference

| What | File(s) |
|------|--------|
| Users table schema | `backend/database.py` (CREATE TABLE users + ad_username, department, manager_id migrations) |
| LDAP config & lookup | `backend/main.py`: `_get_ldap_config()`, `_ldap_lookup_user()`, `_ldap_authenticate()` |
| Create user, lookup-ad, bulk-import, list users | `backend/main.py`: POST /users, GET /users/lookup-ad, POST /users/bulk-import, GET /users |
| Role & supervisor & active | `backend/main.py`: PATCH /users/{uid}/role, PATCH /users/{uid}/supervisor, PATCH /users/{uid}/active |
| Login (email vs AD) | `backend/main.py`: POST /auth/login, _normalize_ad_username |
| Frontend: create form + Fetch from AD | `src/pages/admin/AdminUsers.jsx` |
| Frontend API | `src/services/api.js`: lookupADUser, createUser, getUsers, setUserRole, setUserActive, updateUserSupervisor, bulkImportUsers |

---

You can reuse this in another app by: (1) using the same LDAP config and `_ldap_lookup_user` pattern for “Fetch from AD”, (2) storing users with `ad_username` + placeholder password when using AD, (3) at login resolving identifier to user then checking password via LDAP if `ad_username` is set, and (4) storing `role` and optional `manager_id` for rights and approval chain.
