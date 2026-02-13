# CopeDu Staff Clock Tracker (copedustaffclocktracker)

Production-ready staff clock-in and attendance management web app. Employees log in when they arrive; Admins and HR monitor attendance, reports, and analytics.

## Tech Stack

- **Frontend:** React 18, Vite, Redux Toolkit, React Router v6, TailwindCSS, React Hook Form, Framer Motion, Recharts, D3, Axios
- **Backend:** Python (FastAPI)
- **Database:** SQLite (local, file-based; no separate server)

SQLite is used because it needs zero setup, runs anywhere, and is ideal for local/single-machine deployment. For multi-server or high concurrency you can switch the backend to PostgreSQL or MySQL by changing `backend/database.py` and connection string.

## Project Structure

```
src/
├── components/   # Reusable UI (Sidebar, Toast, LoadingSpinner, EmptyState, ErrorBoundary)
├── pages/        # Employee, HR, Admin pages
├── store/        # Redux slices (auth, attendance, ui, notifications)
├── hooks/        # useAuth, useInactivityLogout, useToast
├── services/     # API layer (api.js – all calls to Python backend)
├── utils/        # constants, formatters, storage
├── routes/       # Router, ProtectedRoute, RedirectByRole
├── layouts/      # AuthLayout, DashboardLayout
└── assets/

backend/
├── main.py       # FastAPI app, auth (JWT), all API routes
├── database.py   # SQLite connection, table creation
├── auth_jwt.py   # Password hashing, JWT
└── requirements.txt
```

## Setup Instructions

### 1. Backend (Python + SQLite)

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The first run creates `copedu.db` (SQLite file) in the backend directory and creates all tables.

### 2. Create first user (Admin)

With the backend running, register an admin:

```bash
curl -X POST http://localhost:8000/auth/register -H "Content-Type: application/json" -d "{\"email\":\"admin@example.com\",\"password\":\"yourpassword\",\"full_name\":\"Admin User\",\"role\":\"admin\"}"
```

Or use any HTTP client (Postman, etc.) to `POST /auth/register` with body:

```json
{ "email": "admin@example.com", "password": "yourpassword", "full_name": "Admin User", "role": "admin" }
```

Then log in on the frontend with that email and password.

### 3. Frontend

```bash
cd "CLock In and Out"   # project root
npm install
cp .env.example .env
```

Edit `.env`:

```
VITE_API_BASE_URL=http://localhost:8000
```

Then:

```bash
npm run start
```

Open [http://localhost:5173](http://localhost:5173) and sign in.

## Environment Variables

| Variable | Description |
|---------|-------------|
| `VITE_API_BASE_URL` | Backend API URL (required), e.g. `http://localhost:8000` |

Backend (optional, in `backend/.env`):

| Variable | Description |
|---------|-------------|
| `CORS_ORIGIN` | Allowed frontend origin (default: `http://localhost:5173`) |
| `SECRET_KEY` | JWT signing secret (change in production) |
| `DATABASE_URL` | SQLite path, e.g. `sqlite:///./copedu.db` |
| `PORT` | Port for uvicorn (default: 8000) |

## User Roles

- **Employee:** Clock in/out, attendance history, announcements, wellness links.
- **HR:** View employees, attendance reports, late/absence alerts, send announcements, upload documents, export CSV.
- **Admin:** Manage users and roles, branches, audit log, app settings.

## Database

- **SQLite** file: `backend/copedu.db` (created on first backend run).
- Schema reference: `schema.sql`. Tables are created automatically in `backend/database.py`.

To reset the DB, stop the backend, delete `copedu.db`, and restart the backend.

## Deployment

1. **Backend:** Deploy the `backend/` folder to a host that runs Python (Railway, Render, Fly.io, etc.). Set `SECRET_KEY`, `CORS_ORIGIN` (your frontend URL), and optionally a production SQLite path or switch to PostgreSQL.
2. **Frontend:** Set `VITE_API_BASE_URL` to your backend URL, run `npm run build`, and deploy `dist/` to a static host (Vercel, Netlify, etc.) with SPA redirects.

## Features

- Role-based dashboards (Employee, HR, Admin)
- JWT auth (email/password), session persistence via token
- Protected routes and auto logout after inactivity
- Clock in/out (one per day), late detection
- Attendance history and working hours summary
- HR announcements and wellness/news links
- HR: reports, date/branch filters, CSV export, clock-in feed (polling)
- Admin: user/role management, branches, audit trail, settings
- Dashboard analytics (Recharts), dark/light mode, toasts, global error boundary
