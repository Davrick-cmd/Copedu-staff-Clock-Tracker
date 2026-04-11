# Login reference – copy to another app

See these files in this project for the full code:

- **Backend auth + JWT:** `backend/auth_jwt.py` (full file)
- **Backend login + LDAP:** `backend/main.py` (from top through `/auth/login` and `/auth/me` – search for "Auth", "LDAP", "login", "get_current_user_id")
- **Frontend API:** `src/services/api.js` (auth: signIn, signOut, getSession, interceptors, TOKEN_KEY)
- **Frontend Redux:** `src/store/slices/authSlice.js` (loadSession, login, logout)
- **Login page:** `src/pages/LoginPage.jsx`
- **Guards:** `src/routes/ProtectedRoute.jsx`, `src/layouts/AuthLayout.jsx`
- **Bootstrap:** `src/App.jsx` (loadSession in useEffect)

Login uses one form: identifier (email or AD username) + password. Backend detects email vs AD and verifies via bcrypt or LDAP.
