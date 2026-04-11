import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ROLES, ROUTES } from '../utils/constants';

export function RedirectByRole() {
  const profile = useSelector((s) => s.auth.profile);
  const role = profile?.role || ROLES.EMPLOYEE;
  const to = role === ROLES.ADMIN ? ROUTES.ADMIN.DASHBOARD
    : role === ROLES.HR ? ROUTES.HR.DASHBOARD
    : ROUTES.EMPLOYEE.DASHBOARD;
  return <Navigate to={to} replace />;
}
