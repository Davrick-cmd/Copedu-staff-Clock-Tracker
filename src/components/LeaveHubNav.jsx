import { Link, NavLink, useLocation } from 'react-router-dom';
import { ROUTES } from '../utils/constants';

const pillInactive =
  'rounded-full px-4 py-2 text-sm font-semibold transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';
const pillActive =
  'rounded-full px-4 py-2 text-sm font-semibold transition-colors bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 ring-1 ring-sky-200 dark:ring-sky-700';

/**
 * Shared strip: Apply, My Leave, My team (if role may supervise), Approvals (inbox).
 * Use on Leave, Team leave, and Approvals pages so “Approvals” appears only here (not duplicated in headers).
 */
export function LeaveHubNav({ role }) {
  const location = useLocation();
  const onLeavePage = location.pathname === ROUTES.EMPLOYEE.LEAVE;
  const leaveSubTab = new URLSearchParams(location.search).get('tab') === 'requests' ? 'requests' : 'apply';
  const canTeam = ['manager', 'hod', 'hr', 'admin'].includes(role);
  const canAppr = ['employee', 'manager', 'hod', 'hr', 'admin'].includes(role);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-3"
      role="tablist"
      aria-label="Leave navigation"
    >
      <Link
        to={`${ROUTES.EMPLOYEE.LEAVE}?tab=apply`}
        className={onLeavePage && leaveSubTab === 'apply' ? pillActive : pillInactive}
      >
        Apply
      </Link>
      <Link
        to={`${ROUTES.EMPLOYEE.LEAVE}?tab=requests`}
        className={onLeavePage && leaveSubTab === 'requests' ? pillActive : pillInactive}
      >
        My Leave
      </Link>
      {canTeam && (
        <NavLink to={ROUTES.EMPLOYEE.TEAM_LEAVE} className={({ isActive }) => (isActive ? pillActive : pillInactive)}>
          My team
        </NavLink>
      )}
      {canAppr && (
        <NavLink to={ROUTES.HR.LEAVE} className={({ isActive }) => (isActive ? pillActive : pillInactive)}>
          Approvals
        </NavLink>
      )}
    </div>
  );
}

/** Primary return target from Approvals / Team leave when you want an explicit back control. */
export function LeaveBackLink({ className = '' }) {
  return (
    <Link
      to={`${ROUTES.EMPLOYEE.LEAVE}?tab=apply`}
      className={['inline-flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 w-fit', className].filter(Boolean).join(' ')}
    >
      <span className="text-lg leading-none" aria-hidden>
        ←
      </span>
      Back to Leave
    </Link>
  );
}
