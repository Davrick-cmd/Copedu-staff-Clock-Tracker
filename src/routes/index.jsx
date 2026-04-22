/**
 * Application router (React Router v6 data API).
 *
 * - `/login` — guest only (`AuthLayout`); authenticated users are bounced by layout + `ProtectedRoute`.
 * - `/` — authenticated shell (`DashboardLayout` + `Sidebar`); child routes are role-gated via `wrapRole`.
 * - Path strings should stay in sync with `utils/constants` ROUTES for links elsewhere in the app.
 */
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
import { EmployeeLeave } from '../pages/employee/EmployeeLeave';
import { HRDashboard } from '../pages/hr/HRDashboard';
import { HRAttendanceDashboard } from '../pages/hr/HRAttendanceDashboard';
import { HRLeaveDashboard } from '../pages/hr/HRLeaveDashboard';
import { HROrganizationDashboard } from '../pages/hr/HROrganizationDashboard';
import { HREmployees } from '../pages/hr/HREmployees';
import { HRReports } from '../pages/hr/HRReports';
import { HRReportsHub } from '../pages/hr/HRReportsHub';
import { HRFlagged } from '../pages/hr/HRFlagged';
import { HRAnnouncements } from '../pages/hr/HRAnnouncements';
import { HRDocuments } from '../pages/hr/HRDocuments';
import { HRLeave } from '../pages/hr/HRLeave';
import { HRLeaveBalances } from '../pages/hr/HRLeaveBalances';
import { HRLeaveOverview } from '../pages/hr/HRLeaveOverview';
import { HRLeaveOrganization } from '../pages/hr/HRLeaveOrganization';
import { TeamLeaveBalances } from '../pages/employee/TeamLeaveBalances';
import { AdminDashboard } from '../pages/admin/AdminDashboard';
import { AdminUsers } from '../pages/admin/AdminUsers';
import { AdminBranches } from '../pages/admin/AdminBranches';
import { AdminAudit } from '../pages/admin/AdminAudit';
import { AdminSettings } from '../pages/admin/AdminSettings';
import { AdminLeaveTypes } from '../pages/admin/AdminLeaveTypes';
import { EmployeeAppraisal } from '../pages/appraisal/EmployeeAppraisal';
import { HRAppraisal } from '../pages/appraisal/HRAppraisal';
import { ManagerAppraisal } from '../pages/appraisal/ManagerAppraisal';
import { HodAppraisal } from '../pages/appraisal/HodAppraisal';

/** Wraps a page with `ProtectedRoute` plus an explicit role allow-list (omit second arg for “any logged-in user”). */
const wrapRole = (element, roles) => <ProtectedRoute allowedRoles={roles}>{element}</ProtectedRoute>;

const router = createBrowserRouter([
  /* --- Public --- */
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
      /* --- Staff workspace (most roles can open “employee” tools; HR/Admin use them too) --- */
      { path: 'employee', element: wrapRole(<EmployeeDashboard />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/attendance', element: wrapRole(<EmployeeAttendance />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/announcements', element: wrapRole(<EmployeeAnnouncements />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/documents', element: wrapRole(<EmployeeDocuments />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN]) },
      { path: 'employee/leave', element: wrapRole(<EmployeeLeave />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN, ROLES.MANAGER, ROLES.HOD]) },
      {
        path: 'employee/team-leave',
        element: wrapRole(<TeamLeaveBalances />, [ROLES.MANAGER, ROLES.HOD, ROLES.HR, ROLES.ADMIN]),
      },
      { path: 'employee/appraisal', element: wrapRole(<EmployeeAppraisal />, [ROLES.EMPLOYEE, ROLES.HR, ROLES.ADMIN, ROLES.MANAGER, ROLES.HOD]) },
      /* --- Appraisal: role-specific queues (see backend approval chains) --- */
      {
        path: 'manager/appraisal',
        element: wrapRole(<ManagerAppraisal />, [ROLES.MANAGER, ROLES.ADMIN, ROLES.HR]),
      },
      { path: 'hod/appraisal', element: wrapRole(<HodAppraisal />, [ROLES.HOD, ROLES.ADMIN]) },
      /* --- HR + Admin consoles --- */
      { path: 'hr', element: wrapRole(<HRDashboard />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/dashboard-attendance', element: wrapRole(<HRAttendanceDashboard />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/dashboard-leave', element: wrapRole(<HRLeaveDashboard />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/organization', element: wrapRole(<HROrganizationDashboard />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/employees', element: wrapRole(<HREmployees />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/reports/attendance', element: wrapRole(<HRReports reportScope="attendance" />, [ROLES.HR]) },
      { path: 'hr/reports/leave', element: wrapRole(<HRReports reportScope="leave" />, [ROLES.HR]) },
      { path: 'hr/reports/recognition', element: wrapRole(<HRReports reportScope="recognition" />, [ROLES.HR]) },
      { path: 'hr/reports/performance', element: wrapRole(<HRReports reportScope="performance" />, [ROLES.HR]) },
      { path: 'hr/reports/organization', element: wrapRole(<HRReports reportScope="organization" />, [ROLES.HR]) },
      { path: 'hr/reports', element: wrapRole(<HRReportsHub />, [ROLES.HR]) },
      { path: 'hr/leave-balances', element: wrapRole(<HRLeaveBalances />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/leave-overview', element: wrapRole(<HRLeaveOverview />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/leave-organization', element: wrapRole(<HRLeaveOrganization />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/flagged', element: wrapRole(<HRFlagged />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/announcements', element: wrapRole(<HRAnnouncements />, [ROLES.HR, ROLES.ADMIN]) },
      { path: 'hr/documents', element: wrapRole(<HRDocuments />, [ROLES.HR, ROLES.ADMIN]) },
      {
        path: 'hr/leave',
        element: wrapRole(<HRLeave />, [ROLES.HR, ROLES.ADMIN, ROLES.MANAGER, ROLES.HOD, ROLES.EMPLOYEE]),
      },
      { path: 'hr/appraisal', element: wrapRole(<HRAppraisal />, [ROLES.HR, ROLES.ADMIN]) },
      /* --- Admin only --- */
      { path: 'admin', element: wrapRole(<AdminDashboard />, [ROLES.ADMIN]) },
      { path: 'admin/users', element: wrapRole(<AdminUsers />, [ROLES.ADMIN]) },
      { path: 'admin/branches', element: wrapRole(<AdminBranches />, [ROLES.ADMIN]) },
      { path: 'admin/audit', element: wrapRole(<AdminAudit />, [ROLES.ADMIN]) },
      { path: 'admin/settings', element: wrapRole(<AdminSettings />, [ROLES.ADMIN]) },
      { path: 'admin/leave-types', element: wrapRole(<AdminLeaveTypes />, [ROLES.ADMIN]) },
      { path: 'admin/appraisal', element: wrapRole(<HRAppraisal />, [ROLES.ADMIN]) },
    ],
  },
  /* Unknown paths → home (then `RedirectByRole` sends user to their default dashboard). */
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function Routes() {
  return <RouterProvider router={router} />;
}
