import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { DashboardLayout } from '../layouts/DashboardLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { RedirectByRole } from './RedirectByRole';
import { ROLES, ROUTES } from '../utils/constants';

import { LoginPage } from '../pages/LoginPage';
import { EmployeeDashboard } from '../pages/employee/EmployeeDashboard';
import { EmployeeAttendance } from '../pages/employee/EmployeeAttendance';
import { EmployeeAnnouncements } from '../pages/employee/EmployeeAnnouncements';
import { EmployeeDocuments } from '../pages/employee/EmployeeDocuments';
import { EmployeeWellness } from '../pages/employee/EmployeeWellness';
import { HRDashboard } from '../pages/hr/HRDashboard';
import { HREmployees } from '../pages/hr/HREmployees';
import { HRReports } from '../pages/hr/HRReports';
import { HRFlagged } from '../pages/hr/HRFlagged';
import { HRAnnouncements } from '../pages/hr/HRAnnouncements';
import { HRDocuments } from '../pages/hr/HRDocuments';
import { AdminDashboard } from '../pages/admin/AdminDashboard';
import { AdminUsers } from '../pages/admin/AdminUsers';
import { AdminBranches } from '../pages/admin/AdminBranches';
import { AdminAudit } from '../pages/admin/AdminAudit';
import { AdminSettings } from '../pages/admin/AdminSettings';

const wrapRole = (element, roles) => <ProtectedRoute allowedRoles={roles}>{element}</ProtectedRoute>;

const router = createBrowserRouter([
  { path: ROUTES.LOGIN, element: <AuthLayout />, children: [{ index: true, element: <LoginPage /> }] },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <RedirectByRole /> },
      { path: 'employee', element: wrapRole(<EmployeeDashboard />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/attendance', element: wrapRole(<EmployeeAttendance />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/announcements', element: wrapRole(<EmployeeAnnouncements />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/documents', element: wrapRole(<EmployeeDocuments />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/wellness', element: wrapRole(<EmployeeWellness />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr', element: wrapRole(<HRDashboard />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/employees', element: wrapRole(<HREmployees />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/reports', element: wrapRole(<HRReports />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/flagged', element: wrapRole(<HRFlagged />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/announcements', element: wrapRole(<HRAnnouncements />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/documents', element: wrapRole(<HRDocuments />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'admin', element: wrapRole(<AdminDashboard />, [ROLES.ADMIN]) },
      { path: 'admin/users', element: wrapRole(<AdminUsers />, [ROLES.ADMIN]) },
      { path: 'admin/branches', element: wrapRole(<AdminBranches />, [ROLES.ADMIN]) },
      { path: 'admin/audit', element: wrapRole(<AdminAudit />, [ROLES.ADMIN]) },
      { path: 'admin/settings', element: wrapRole(<AdminSettings />, [ROLES.ADMIN]) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function Routes() {
  return <RouterProvider router={router} />;
}
