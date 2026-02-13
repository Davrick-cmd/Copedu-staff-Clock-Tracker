// App name and role constants
export const APP_NAME = 'copedustaffclocktracker';
export const APP_DISPLAY_NAME = 'CopeDu Staff Clock Tracker';

export const ROLES = {
  ADMIN: 'admin',
  HR: 'hr',
  EMPLOYEE: 'employee',
};

export const ROUTES = {
  LOGIN: '/login',
  EMPLOYEE: {
    DASHBOARD: '/employee',
    ATTENDANCE: '/employee/attendance',
    ANNOUNCEMENTS: '/employee/announcements',
    DOCUMENTS: '/employee/documents',
    WELLNESS: '/employee/wellness',
  },
  HR: {
    DASHBOARD: '/hr',
    EMPLOYEES: '/hr/employees',
    REPORTS: '/hr/reports',
    FLAGGED: '/hr/flagged',
    ANNOUNCEMENTS: '/hr/announcements',
    DOCUMENTS: '/hr/documents',
  },
  ADMIN: {
    DASHBOARD: '/admin',
    USERS: '/admin/users',
    BRANCHES: '/admin/branches',
    AUDIT: '/admin/audit',
    SETTINGS: '/admin/settings',
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
