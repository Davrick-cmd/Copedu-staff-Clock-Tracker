import { ROUTES } from './constants';

export const MODULE_VISIBILITY_OPTIONS = [
  { key: 'attendance', label: 'Attendance', routes: [ROUTES.EMPLOYEE.ATTENDANCE, ROUTES.HR.DASHBOARD_ATTENDANCE] },
  { key: 'leave', label: 'Leave', routes: [ROUTES.EMPLOYEE.LEAVE, ROUTES.HR.LEAVE, ROUTES.HR.LEAVE_OVERVIEW, ROUTES.HR.LEAVE_ORGANIZATION, ROUTES.HR.LEAVE_BALANCES, ROUTES.ADMIN.LEAVE_TYPES] },
  { key: 'reports', label: 'Reports', routes: [ROUTES.HR.REPORTS, ROUTES.HR.REPORTS_ATTENDANCE, ROUTES.HR.REPORTS_LEAVE, ROUTES.HR.REPORTS_RECOGNITION, ROUTES.HR.REPORTS_PERFORMANCE, ROUTES.HR.REPORTS_ORGANIZATION] },
  { key: 'organization', label: 'Organization', routes: [ROUTES.HR.ORGANIZATION] },
  { key: 'employees', label: 'Employee records', routes: [ROUTES.HR.EMPLOYEES, ROUTES.ADMIN.USERS] },
  { key: 'documents', label: 'Documents', routes: [ROUTES.EMPLOYEE.DOCUMENTS, ROUTES.HR.DOCUMENTS] },
  { key: 'announcements', label: 'Announcements', routes: [ROUTES.EMPLOYEE.ANNOUNCEMENTS, ROUTES.HR.ANNOUNCEMENTS] },
  { key: 'appraisal', label: 'Performance & appraisal', routes: [ROUTES.EMPLOYEE.APPRAISAL, ROUTES.HR.APPRAISAL, ROUTES.ADMIN.APPRAISAL, ROUTES.APPRAISAL.MANAGER, ROUTES.APPRAISAL.HOD] },
  { key: 'branches', label: 'Branches', routes: [ROUTES.ADMIN.BRANCHES] },
  { key: 'audit', label: 'Audit log', routes: [ROUTES.ADMIN.AUDIT] },
];

const routeToModuleKey = new Map(
  MODULE_VISIBILITY_OPTIONS.flatMap((m) => m.routes.map((r) => [r, m.key])),
);

export function moduleKeyForRoute(route) {
  return routeToModuleKey.get(route) || null;
}

