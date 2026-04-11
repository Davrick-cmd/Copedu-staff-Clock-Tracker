// App name and role constants
export const APP_NAME = 'copedustaffclocktracker';
/** Short product name (headers, login). */
export const APP_DISPLAY_NAME = 'Copedu HR Suite';
/** Full formal product name (marketing, login). */
export const APP_FORMAL_NAME = 'Copedu Human Resource Suite';

export const ROLES = {
  ADMIN: 'admin',
  HR: 'hr',
  HOD: 'hod',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

/** Display labels for roles */
export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.HR]: 'HR',
  [ROLES.HOD]: 'Head of Department',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.EMPLOYEE]: 'Employee',
};

/** Department options for user creation (dropdown) */
export const DEPARTMENTS = [
  'IT Department',
  'Business Department',
  'Operation',
  'Human Resources',
  'CEO offices',
  'Executive Office',
  'Legal',
  'Risk & Compliance',
  'Finance',
  'Credit',
  'Audit',
];

export const ROUTES = {
  LOGIN: '/login',
  EMPLOYEE: {
    DASHBOARD: '/employee',
    ATTENDANCE: '/employee/attendance',
    ANNOUNCEMENTS: '/employee/announcements',
    DOCUMENTS: '/employee/documents',
    APPRAISAL: '/employee/appraisal',
    LEAVE: '/employee/leave',
    TEAM_LEAVE: '/employee/team-leave',
  },
  HR: {
    DASHBOARD: '/hr',
    DASHBOARD_ATTENDANCE: '/hr/dashboard-attendance',
    DASHBOARD_LEAVE: '/hr/dashboard-leave',
    ORGANIZATION: '/hr/organization',
    EMPLOYEES: '/hr/employees',
    REPORTS: '/hr/reports',
    LEAVE_BALANCES: '/hr/leave-balances',
    FLAGGED: '/hr/flagged',
    ANNOUNCEMENTS: '/hr/announcements',
    DOCUMENTS: '/hr/documents',
    APPRAISAL: '/hr/appraisal',
    LEAVE: '/hr/leave',
    LEAVE_OVERVIEW: '/hr/leave-overview',
    LEAVE_ORGANIZATION: '/hr/leave-organization',
  },
  ADMIN: {
    DASHBOARD: '/admin',
    USERS: '/admin/users',
    BRANCHES: '/admin/branches',
    AUDIT: '/admin/audit',
    SETTINGS: '/admin/settings',
    APPRAISAL: '/admin/appraisal',
    LEAVE_TYPES: '/admin/leave-types',
  },
  APPRAISAL: {
    CYCLES: '/appraisal/cycles',
    STAFF: '/employee/appraisal',
    MANAGER: '/manager/appraisal',
    HOD: '/hod/appraisal',
    HR: '/hr/appraisal',
  },
};

// Late threshold in minutes (after this, clock-in is "late")
export const LATE_THRESHOLD_MINUTES = 15;
// Time (HH:mm) after which user is auto-marked absent if no clock-in
export const ABSENT_MARK_TIME = '09:00';
export const WORKING_HOURS_PER_DAY = 8;

export const STORAGE_KEYS = {
  THEME: 'copedu_theme',
  LAST_ACTIVITY: 'copedu_last_activity',
};
export const INACTIVITY_LOGOUT_MS = 30 * 60 * 1000; // 30 minutes
