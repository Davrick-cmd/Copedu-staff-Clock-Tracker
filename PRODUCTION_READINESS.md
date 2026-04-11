# Production readiness checklist

Use this list before going live so the app is secure, reliable, and easy to run in production.

---

## 1. Security

- [ ] **SECRET_KEY** – Set a strong random value in production (e.g. `openssl rand -hex 32`). Never use the default `change-me-in-production-use-env`. The backend logs a warning at startup if the default is still in use.
- [ ] **HTTPS** – Serve the app over HTTPS only. Use a reverse proxy (e.g. Nginx, Caddy) or your host’s TLS.
- [ ] **CORS** – Set `CORS_ORIGIN` in backend `.env` to your real frontend URL (e.g. `https://app.yourcompany.com`). Avoid `*` in production.
- [ ] **Passwords** – Rely on bcrypt (already in use). If you add password rules, enforce them on register/change-password.
- [ ] **LDAP** – Store LDAP credentials in env vars or a secrets manager, not in code. Restrict who can read `backend/.env`.

---

## 2. Configuration

- [ ] **Backend `.env`** – Copy `backend/.env.example` to `backend/.env` and set at least:
  - `SECRET_KEY`
  - `CORS_ORIGIN` (frontend URL)
  - LDAP vars if using AD login
- [ ] **Frontend build** – Set `VITE_API_BASE_URL` to your production API URL before `npm run build`. The value is baked into the build.
- [ ] **Database** – SQLite is fine for single-instance. For multiple servers or high load, plan a move to PostgreSQL/MySQL and set `DATABASE_URL`.

---

## 3. Deployment

- [ ] **Backend**
  - Run with a process manager (e.g. systemd, Docker, or your host’s app runner).
  - Example: `uvicorn main:app --host 0.0.0.0 --port 8000` (no `--reload` in production).
  - Optionally use Gunicorn + Uvicorn workers for concurrency.
- [ ] **Frontend**
  - Run `npm run build` and serve the `dist/` folder (Nginx, Vercel, Netlify, etc.).
  - Configure SPA fallback: all routes serve `index.html` so client-side routing works.
- [ ] **Database file** – If using SQLite, put `copedu.db` (and `backend/uploads/`) on a persistent volume so restarts don’t wipe data.
- [ ] **Backups** – Schedule regular backups of `copedu.db` (and uploads if important).

---

## 4. Reliability and monitoring

- [ ] **Health check** – Use `GET /health` for load balancers or monitoring. It returns `{"status":"ok"}`.
- [ ] **Logging** – Backend uses Python logging. In production, consider a log level (e.g. INFO) and shipping logs to a central place.
- [ ] **Errors** – Avoid exposing stack traces to end users. FastAPI’s default is reasonable; keep `debug=False` (default) in production.
- [ ] **Inactivity logout** – Already implemented; confirm timeout and behaviour (e.g. token clear + redirect) match policy.

---

## 5. User and data readiness

- [ ] **First admin** – Create at least one admin user (register or seed). Disable or restrict `/auth/register` in production if you only use AD or admin-created users.
- [ ] **Supervisors** – Assign supervisors (HR → Employees → Supervisor) so the appraisal approval chain works.
- [ ] **Branches / settings** – Configure branches and any app settings (e.g. late threshold, working hours) in Admin.
- [ ] **LDAP** – If using AD: test login with a real account; confirm search base and attributes (e.g. sAMAccountName, mail) match your AD.

---

## 6. Optional improvements

- [ ] **Rate limiting** – Add rate limiting on `/auth/login` to reduce brute-force risk.
- [ ] **Audit** – Sensitive actions are logged in the audit table; review or export if needed for compliance.
- [ ] **Tests** – Add a few backend tests (e.g. login, one key API) and run them in CI.
- [ ] **Docs** – Keep README and this checklist updated when you change deployment or env vars.

---

## Quick pre-launch check

1. Set `SECRET_KEY` and `CORS_ORIGIN` in production.
2. Build frontend with correct `VITE_API_BASE_URL`.
3. Serve backend and frontend over HTTPS.
4. Create an admin user and test login (and AD if used).
5. Back up `copedu.db` (and uploads) regularly.

Once these are done, the app is in good shape for production use.
