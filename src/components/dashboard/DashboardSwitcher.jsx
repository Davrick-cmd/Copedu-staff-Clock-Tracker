import { Link } from 'react-router-dom';
import { ROUTES } from '../../utils/constants';

/**
 * Pills to jump between main / attendance / leave dashboards (HR and Admin).
 */
export function DashboardSwitcher({ mode = 'hr', active }) {
  const links =
    mode === 'admin'
      ? [
          { id: 'admin', to: ROUTES.ADMIN.DASHBOARD, label: 'Admin overview' },
          { id: 'hr', to: ROUTES.HR.DASHBOARD, label: 'HR overview' },
          { id: 'attendance', to: ROUTES.HR.DASHBOARD_ATTENDANCE, label: 'Attendance dashboard' },
          { id: 'leave', to: ROUTES.HR.DASHBOARD_LEAVE, label: 'Leave dashboard' },
          { id: 'organization', to: ROUTES.HR.ORGANIZATION, label: 'Organization' },
        ]
      : [
          { id: 'hr', to: ROUTES.HR.DASHBOARD, label: 'HR overview' },
          { id: 'attendance', to: ROUTES.HR.DASHBOARD_ATTENDANCE, label: 'Attendance dashboard' },
          { id: 'leave', to: ROUTES.HR.DASHBOARD_LEAVE, label: 'Leave dashboard' },
          { id: 'organization', to: ROUTES.HR.ORGANIZATION, label: 'Organization' },
        ];

  return (
    <div className="flex flex-wrap gap-2" role="navigation" aria-label="Dashboard views">
      {links.map(({ id, to, label }) => {
        const isActive = active === id;
        return (
          <Link
            key={id}
            to={to}
            className={`inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold transition-colors border ${
              isActive
                ? 'bg-primary-500/15 text-primary-800 dark:text-primary-100 border-primary-400/40 dark:border-primary-500/35 shadow-sm'
                : 'bg-white/70 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 border-slate-200/90 dark:border-slate-700/90 hover:border-primary-300/60 dark:hover:border-primary-600/50 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
