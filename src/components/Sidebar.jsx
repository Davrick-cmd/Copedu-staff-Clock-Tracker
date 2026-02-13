import { NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { ROLES, ROUTES, APP_DISPLAY_NAME } from '../utils/constants';
import { toggleTheme } from '../store/slices/uiSlice';
import { logout } from '../store/slices/authSlice';

const nav = {
  [ROLES.EMPLOYEE]: [
    { to: ROUTES.EMPLOYEE.DASHBOARD, label: 'Dashboard' },
    { to: ROUTES.EMPLOYEE.ATTENDANCE, label: 'My Attendance' },
    { to: ROUTES.EMPLOYEE.ANNOUNCEMENTS, label: 'Announcements' },
    { to: ROUTES.EMPLOYEE.DOCUMENTS, label: 'Documents' },
    { to: ROUTES.EMPLOYEE.WELLNESS, label: 'Wellness & News' },
  ],
  [ROLES.HR]: [
    { to: ROUTES.HR.DASHBOARD, label: 'Dashboard' },
    { to: ROUTES.HR.EMPLOYEES, label: 'Employees' },
    { to: ROUTES.HR.REPORTS, label: 'Reports' },
    { to: ROUTES.HR.FLAGGED, label: 'Flagged Staff' },
    { to: ROUTES.HR.ANNOUNCEMENTS, label: 'Announcements' },
    { to: ROUTES.HR.DOCUMENTS, label: 'Documents' },
  ],
  [ROLES.ADMIN]: [
    { to: ROUTES.ADMIN.DASHBOARD, label: 'Dashboard' },
    { to: ROUTES.ADMIN.USERS, label: 'Users' },
    { to: ROUTES.ADMIN.BRANCHES, label: 'Branches' },
    { to: ROUTES.ADMIN.AUDIT, label: 'Audit Log' },
    { to: ROUTES.ADMIN.SETTINGS, label: 'Settings' },
  ],
};

export function Sidebar({ open, mobileOpen, onToggle, onMobileClose, onMobileOpen }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const profile = useSelector((s) => s.auth.profile);
  const theme = useSelector((s) => s.ui.theme);
  const role = profile?.role || ROLES.EMPLOYEE;
  const links = nav[role] || nav[ROLES.EMPLOYEE];

  const handleLogout = () => {
    dispatch(logout());
    navigate(ROUTES.LOGIN);
  };

  const content = (
    <>
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <span className="font-semibold text-gray-800 dark:text-white truncate">{APP_DISPLAY_NAME}</span>
        {!mobileOpen && (
          <button type="button" onClick={onToggle} className="p-1 rounded lg:block hidden" aria-label="Toggle sidebar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{open ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />}</svg>
          </button>
        )}
        {mobileOpen && (
          <button type="button" onClick={onMobileClose} className="p-1 rounded lg:hidden" aria-label="Close menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <nav className="p-2 space-y-1">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onMobileClose}
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
        <button type="button" onClick={() => dispatch(toggleTheme())} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
        <button type="button" onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
          Log out
        </button>
      </div>
    </>
  );

  return (
    <>
      <button type="button" onClick={onMobileOpen} className="lg:hidden fixed top-4 left-4 z-20 p-2 rounded-lg bg-white dark:bg-gray-800 shadow" aria-label="Open menu">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={onMobileClose}
          />
        )}
      </AnimatePresence>
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white dark:bg-gray-800 shadow-xl flex flex-col ${open ? '' : 'lg:w-0 lg:overflow-hidden'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="h-full flex flex-col pt-12 lg:pt-0">
          {content}
        </div>
      </aside>
    </>
  );
}
