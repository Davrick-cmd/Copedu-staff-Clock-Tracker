/**
 * Guards routes that require authentication (and optionally a role allow-list).
 *
 * - No session → redirect to login (preserves `location` in state for future deep-link restore).
 * - Session but wrong role → redirect to that role’s default home (see `roleBasePath`).
 * - `loading` true while `loadSession` runs → show a simple spinner to avoid flash of login.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ROLES, ROUTES } from '../utils/constants';

/** Default landing route per role when user hits a page their role cannot access. */
const roleBasePath = {
  [ROLES.ADMIN]: ROUTES.ADMIN.DASHBOARD,
  [ROLES.HR]: ROUTES.HR.DASHBOARD,
  [ROLES.HOD]: ROUTES.APPRAISAL.HOD,
  [ROLES.MANAGER]: ROUTES.APPRAISAL.MANAGER,
  [ROLES.EMPLOYEE]: ROUTES.EMPLOYEE.DASHBOARD,
};

export function ProtectedRoute({ children, allowedRoles }) {
  const location = useLocation();
  const { user, profile, loading } = useSelector((s) => s.auth);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    const redirect = roleBasePath[profile.role] || ROUTES.EMPLOYEE.DASHBOARD;
    return <Navigate to={redirect} replace />;
  }

  return children;
}
