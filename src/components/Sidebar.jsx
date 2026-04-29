/**
 * Primary navigation: link groups depend on `auth.profile.role` (see `nav` map below).
 * Each role entry is either a flat `links` array or `{ section, links }[]` for collapsible groups.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { ROLES, ROUTES, APP_DISPLAY_NAME, APP_LOGO_SRC, ROLE_LABELS } from '../utils/constants';
import { toggleTheme } from '../store/slices/uiSlice';
import { logout } from '../store/slices/authSlice';
import * as api from '../services/api';
import * as Ni from './NavIcons';
import { NotificationBell } from './NotificationBell';
import { moduleKeyForRoute } from '../utils/moduleVisibility';

const staffLinks = [
  { to: ROUTES.EMPLOYEE.DASHBOARD, label: 'Home', Icon: Ni.IconHome },
  { to: ROUTES.EMPLOYEE.ATTENDANCE, label: 'Attendance', Icon: Ni.IconClock },
  { to: ROUTES.EMPLOYEE.LEAVE, label: 'Leave', Icon: Ni.IconCalendar },
  { to: ROUTES.EMPLOYEE.ANNOUNCEMENTS, label: 'Announcements', Icon: Ni.IconMegaphone },
  { to: ROUTES.EMPLOYEE.DOCUMENTS, label: 'Documents', Icon: Ni.IconFolder },
];
const performanceLinks = [
  { to: ROUTES.EMPLOYEE.APPRAISAL_KPI, label: 'Set KPI', Icon: Ni.IconChart },
  { to: ROUTES.EMPLOYEE.APPRAISAL_REVIEWS, label: 'Appraisal', Icon: Ni.IconClipboard },
];

const hrDashboardLinks = [
  { to: ROUTES.HR.DASHBOARD, label: 'HR overview', Icon: Ni.IconLayout },
  { to: ROUTES.HR.DASHBOARD_ATTENDANCE, label: 'Attendance dashboard', Icon: Ni.IconClock },
  { to: ROUTES.HR.DASHBOARD_LEAVE, label: 'Leave dashboard', Icon: Ni.IconCalendar },
  { to: ROUTES.APPRAISAL.DASHBOARD, label: 'Performance dashboard', Icon: Ni.IconChart },
];

const hrReportSectionLinks = [
  { to: ROUTES.HR.REPORTS, label: 'Reports home', Icon: Ni.IconLayout, navEnd: true },
  { to: ROUTES.HR.REPORTS_ATTENDANCE, label: 'Attendance reports', Icon: Ni.IconClock },
  { to: ROUTES.HR.REPORTS_LEAVE, label: 'Leave reports', Icon: Ni.IconCalendar },
  { to: ROUTES.HR.REPORTS_RECOGNITION, label: 'Recognition reports', Icon: Ni.IconChart },
  { to: ROUTES.HR.REPORTS_PERFORMANCE, label: 'Performance & appraisal', Icon: Ni.IconClipboard },
  { to: ROUTES.HR.REPORTS_ORGANIZATION, label: 'Organization report', Icon: Ni.IconBuilding },
];

const hrPrivilegeLinks = [
  { to: ROUTES.HR.ORGANIZATION, label: 'Organization', Icon: Ni.IconBuilding },
  { to: ROUTES.HR.EMPLOYEES, label: 'Employee records', Icon: Ni.IconUsers },
  { to: ROUTES.HR.SHIFTS, label: 'Shift management', Icon: Ni.IconClock },
  { to: ROUTES.HR.LEAVE_BALANCES, label: 'Leave entitlements', Icon: Ni.IconCalendar },
  { to: ROUTES.HR.FLAGGED, label: 'Flagged attendance', Icon: Ni.IconFlag },
  { to: ROUTES.HR.ANNOUNCEMENTS, label: 'Announcements (HR)', Icon: Ni.IconMegaphone },
  { to: ROUTES.HR.DOCUMENTS, label: 'Documents (HR)', Icon: Ni.IconFolder },
  { to: ROUTES.HR.APPRAISAL, label: 'Appraisal', Icon: Ni.IconClipboard },
];

const adminDashboardLinks = [
  { to: ROUTES.ADMIN.DASHBOARD, label: 'Admin overview', Icon: Ni.IconLayout },
  { to: ROUTES.APPRAISAL.DASHBOARD, label: 'Performance dashboard', Icon: Ni.IconChart },
];

const adminReportLinks = [
  { to: ROUTES.ADMIN.AUDIT, label: 'System report', Icon: Ni.IconClipboard, navEnd: true },
];

const adminPrivilegeLinks = [
  { to: ROUTES.HR.ORGANIZATION, label: 'Organization', Icon: Ni.IconBuilding },
  { to: ROUTES.ADMIN.USERS, label: 'Employee records', Icon: Ni.IconUsers },
  { to: ROUTES.HR.SHIFTS, label: 'Shift management', Icon: Ni.IconClock },
  { to: ROUTES.ADMIN.LEAVE_TYPES, label: 'Leave types', Icon: Ni.IconCalendar },
  { to: ROUTES.ADMIN.BRANCHES, label: 'Branches', Icon: Ni.IconBuilding },
  { to: ROUTES.ADMIN.AUDIT, label: 'Audit log', Icon: Ni.IconClipboard },
  { to: ROUTES.ADMIN.SETTINGS, label: 'Settings', Icon: Ni.IconSettings },
  { to: ROUTES.ADMIN.APPRAISAL, label: 'Appraisal', Icon: Ni.IconClipboard },
];

/** Nav: flat links array or array of { section, links } for dropdown menu */
const nav = {
  [ROLES.EMPLOYEE]: [
    { section: 'Workspace', links: staffLinks },
    { section: 'Performance & Appraisal', links: performanceLinks },
  ],
  [ROLES.MANAGER]: [
    { section: 'Workspace', links: staffLinks },
    { section: 'Performance & Appraisal', links: performanceLinks },
    {
      section: 'Approvals',
      links: [
        { to: ROUTES.HR.LEAVE, label: 'Leave approvals', Icon: Ni.IconInbox },
        { to: ROUTES.EMPLOYEE.TEAM_LEAVE, label: 'Team leave balances', Icon: Ni.IconUsers },
        { to: ROUTES.APPRAISAL.MANAGER, label: 'Team appraisal', Icon: Ni.IconChart },
      ],
    },
  ],
  [ROLES.HOD]: [
    { section: 'Workspace', links: staffLinks },
    { section: 'Performance & Appraisal', links: performanceLinks },
    {
      section: 'Approvals',
      links: [
        { to: ROUTES.HR.LEAVE, label: 'Leave approvals', Icon: Ni.IconInbox },
        { to: ROUTES.EMPLOYEE.TEAM_LEAVE, label: 'Team leave balances', Icon: Ni.IconUsers },
        { to: ROUTES.APPRAISAL.HOD, label: 'Department appraisal', Icon: Ni.IconChart },
      ],
    },
  ],
  [ROLES.HR]: [
    { section: 'Dashboards', links: hrDashboardLinks },
    { section: 'Employee self-service', links: staffLinks },
    { section: 'Performance & Appraisal', links: performanceLinks },
    { section: 'Reports', links: hrReportSectionLinks },
    { section: 'HR operations', links: hrPrivilegeLinks },
  ],
  [ROLES.ADMIN]: [
    { section: 'Dashboards', links: adminDashboardLinks },
    { section: 'Employee self-service', links: staffLinks },
    { section: 'Performance & Appraisal', links: performanceLinks },
    { section: 'Reports', links: adminReportLinks },
    { section: 'Administrative tools', links: adminPrivilegeLinks },
  ],
};

const privilegedSections = new Set(['Administration', 'Administrative tools', 'HR operations']);

export function Sidebar({ open, mobileOpen, onToggle, onMobileClose, onMobileOpen }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const profile = useSelector((s) => s.auth.profile);
  const theme = useSelector((s) => s.ui.theme);
  const role = profile?.role || ROLES.EMPLOYEE;
  const navConfigBase = nav[role] || nav[ROLES.EMPLOYEE];
  const [hiddenModules, setHiddenModules] = useState([]);
  useEffect(() => {
    let mounted = true;
    api
      .getSettings()
      .then((s) => {
        if (!mounted) return;
        const raw = s?.hidden_modules;
        if (Array.isArray(raw)) setHiddenModules(raw);
        else if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            setHiddenModules(Array.isArray(parsed) ? parsed : []);
          } catch {
            setHiddenModules([]);
          }
        } else setHiddenModules([]);
      })
      .catch(() => {
        if (mounted) setHiddenModules([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const onVisibilityUpdated = (evt) => {
      const next = evt?.detail?.hidden_modules;
      if (Array.isArray(next)) {
        setHiddenModules(next);
      }
    };
    window.addEventListener('module-visibility-updated', onVisibilityUpdated);
    return () => window.removeEventListener('module-visibility-updated', onVisibilityUpdated);
  }, []);
  const navConfig = useMemo(() => {
    let dynamicBase = navConfigBase;
    const allowDelegatedShift = (role === ROLES.MANAGER || role === ROLES.HOD || role === ROLES.EMPLOYEE) && (profile?.can_assign_shifts === 1 || profile?.can_assign_shifts === true);
    if (allowDelegatedShift) {
      let added = false;
      dynamicBase = navConfigBase.map((section) => {
        if (section.section !== 'Approvals') return section;
        const hasShiftLink = (section.links || []).some((l) => l.to === ROUTES.HR.SHIFTS);
        if (hasShiftLink) {
          added = true;
          return section;
        }
        added = true;
        return {
          ...section,
          links: [...(section.links || []), { to: ROUTES.HR.SHIFTS, label: 'Shift management', Icon: Ni.IconClock }],
        };
      });
      if (!added && dynamicBase.length) {
        const first = dynamicBase[0];
        const hasShiftLink = (first.links || []).some((l) => l.to === ROUTES.HR.SHIFTS);
        if (!hasShiftLink) {
          dynamicBase = [
            { ...first, links: [...(first.links || []), { to: ROUTES.HR.SHIFTS, label: 'Shift management', Icon: Ni.IconClock }] },
            ...dynamicBase.slice(1),
          ];
        }
      }
    }
    if (!hiddenModules.length) return dynamicBase;
    const hideSet = new Set(hiddenModules);
    const filterLinks = (links = []) =>
      links.filter((l) => {
        const key = moduleKeyForRoute(l.to);
        return key ? !hideSet.has(key) : true;
      });
    return dynamicBase
      .map((section) => ({ ...section, links: filterLinks(section.links) }))
      .filter((section) => section.links.length > 0);
  }, [navConfigBase, role, hiddenModules, profile?.can_assign_shifts]);
  const hasDropdowns = Array.isArray(navConfig) && navConfig.length > 0 && navConfig[0].section;

  const [openDropdowns, setOpenDropdowns] = useState(() =>
    hasDropdowns
      ? Object.fromEntries(
          navConfig.map(({ section }) => [
            section,
            !['Administration', 'Administrative tools', 'HR operations'].includes(section),
          ]),
        )
      : {}
  );

  const toggleDropdown = (section) => {
    setOpenDropdowns((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate(ROUTES.LOGIN);
  };

  const linkClass = (isActive) =>
    `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-primary-500/12 dark:bg-primary-500/20 text-primary-800 dark:text-primary-100 shadow-sm ring-1 ring-primary-500/20 dark:ring-primary-400/25'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/90 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white'
    }`;

  const sectionClass = 'text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 px-3 pt-3 pb-1.5';

  const content = (
    <>
      <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2.5">
          <img
            src={APP_LOGO_SRC}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 object-contain rounded-lg ring-1 ring-slate-200/80 dark:ring-slate-600/80 bg-white dark:bg-slate-800/50 p-0.5"
          />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">Suite</p>
            <span className="font-semibold text-slate-900 dark:text-white truncate block text-sm leading-tight">{APP_DISPLAY_NAME}</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <NotificationBell />
          {!mobileOpen && (
            <button
              type="button"
              onClick={onToggle}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:block hidden transition-colors"
              aria-label="Toggle sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {open ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                )}
              </svg>
            </button>
          )}
          {mobileOpen && (
            <button type="button" onClick={onMobileClose} className="p-2 rounded-lg lg:hidden text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close menu">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {profile?.full_name && (
        <div className="px-3 pt-4 pb-1">
          <div className="rounded-xl px-3 py-2.5 bg-gradient-to-br from-slate-100/90 to-slate-50/80 dark:from-slate-800/60 dark:to-slate-900/40 border border-slate-200/70 dark:border-slate-700/60">
            <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{profile.full_name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{ROLE_LABELS[role] || role}</p>
          </div>
        </div>
      )}

      <nav className="p-2 space-y-0.5 flex-1 min-h-0 overflow-y-auto">
        {hasDropdowns ? (
          navConfig.map(({ section, links }) => {
            const isOpen = openDropdowns[section] !== false;
            const isPrivilegedSection = privilegedSections.has(section);
            return (
              <div key={section} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleDropdown(section)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-slate-100/80 dark:hover:bg-slate-800/60 transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="flex items-center gap-2">
                    <span className={sectionClass}>{section}</span>
                    {isPrivilegedSection && (
                      <span className="inline-flex items-center rounded-full border border-amber-300/80 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        Privileged
                      </span>
                    )}
                  </span>
                  <svg
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-0.5 mt-0.5 pb-1">
                        {links.map(({ to, label, Icon, navEnd }) => (
                          <NavLink
                            key={to}
                            to={to}
                            end={!!navEnd}
                            onClick={onMobileClose}
                            className={({ isActive }) => linkClass(isActive)}
                          >
                            {Icon && <Icon className="w-5 h-5 shrink-0 opacity-85 group-hover:opacity-100" />}
                            <span className="truncate">{label}</span>
                          </NavLink>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        ) : (
          navConfig.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} onClick={onMobileClose} className={({ isActive }) => linkClass(isActive)}>
              {Icon && <Icon className="w-5 h-5 shrink-0 opacity-85" />}
              <span className="truncate">{label}</span>
            </NavLink>
          ))
        )}
      </nav>

      <div className="flex-shrink-0 p-3 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5 bg-slate-50/50 dark:bg-slate-950/30">
        <button
          type="button"
          onClick={() => dispatch(toggleTheme())}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800/80 border border-transparent hover:border-slate-200/80 dark:hover:border-slate-700 transition-all"
        >
          <span className="text-lg" aria-hidden>
            {theme === 'dark' ? '☀️' : '🌙'}
          </span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 18l6-6-6-6M21 12H9m12 0H9m0 0H5a2 2 0 01-2-2V6a2 2 0 012-2h4" />
          </svg>
          Log out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: when sidebar is collapsed (w-0), the in-panel toggle is hidden — show a fixed control to expand */}
      {!open && (
        <button
          type="button"
          onClick={onToggle}
          title="Expand menu"
          aria-label="Expand sidebar"
          className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-50 w-11 h-20 items-center justify-center rounded-r-xl bg-white dark:bg-slate-900 border border-l-0 border-slate-200/90 dark:border-slate-700 shadow-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={onMobileOpen}
        className="lg:hidden fixed top-4 left-4 z-20 p-2.5 rounded-xl bg-white/95 dark:bg-slate-900/95 shadow-lg shadow-slate-900/10 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200"
        aria-label="Open menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-30 lg:hidden"
            onClick={onMobileClose}
          />
        )}
      </AnimatePresence>
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-[17rem] flex-shrink-0 h-full flex flex-col bg-white dark:bg-slate-950 border-r border-slate-200/90 dark:border-slate-800/90 shadow-[4px_0_24px_-12px_rgba(15,23,42,0.15)] dark:shadow-none ${
          open ? '' : 'lg:w-0 lg:overflow-hidden lg:flex-shrink-0'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="h-full min-h-0 flex flex-col pt-14 lg:pt-0">{content}</div>
      </aside>
    </>
  );
}
