import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ROUTES, ROLES } from '../../utils/constants';
import {
  DashboardPageHeader,
  QuickLinkCard,
  QuickLinksSection,
  StatTile,
} from '../../components/dashboard/DashboardWidgets';
import { UserListModal } from '../../components/dashboard/UserListModal';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';

export function HRDashboard() {
  const role = useSelector((s) => s.auth.profile?.role);
  const dashboardSwitcherMode = role === ROLES.ADMIN ? 'admin' : 'hr';
  const [summary, setSummary] = useState(null);
  const [leaveOverview, setLeaveOverview] = useState(null);
  const [myLeaveInbox, setMyLeaveInbox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    api.getLeaveOverview().then(setLeaveOverview).catch(() => setLeaveOverview(null));
    api.getLeaveMyDashboard().then(setMyLeaveInbox).catch(() => setMyLeaveInbox(null));
    api
      .getDailyReportSummary(today)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      api.getDailyReportSummary(today).then(setSummary).catch(() => {});
      api.getLeaveOverview().then(setLeaveOverview).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !summary) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const s = summary || {};
  const present = s.present ?? 0;
  const absent = s.absent ?? 0;
  const late = s.late ?? 0;
  const onTime = s.on_time ?? 0;
  const noClockOut = s.no_clock_out ?? 0;
  const totalStaff = s.total_staff ?? 0;
  const pctLate = s.pct_late ?? 0;
  const pctOnTime = s.pct_on_time ?? 0;
  const pctAbsent = s.pct_absent ?? 0;
  const users = s.users || {};

  const statCard = (label, value, sub, colorClass, modalKey, modalTitle) => {
    const count = typeof value === 'number' ? value : 0;
    const clickable = count > 0 && modalKey && users[modalKey]?.length;
    return (
      <motion.button
        type="button"
        disabled={!clickable}
        className={`text-left w-full rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 backdrop-blur-sm p-5 shadow-soft transition-all ${
          clickable ? 'cursor-pointer hover:shadow-soft-lg hover:border-primary-300/80 dark:hover:border-primary-600' : ''
        }`}
        whileHover={clickable ? { y: -2 } : {}}
        transition={{ duration: 0.2 }}
        onClick={clickable ? () => setModal({ key: modalKey, title: modalTitle, list: users[modalKey] }) : undefined}
      >
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.08em]">{label}</p>
        <p className={`text-3xl font-bold tabular-nums mt-1 ${colorClass}`}>{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
          {sub}
          {clickable && <span className="block mt-1 text-primary-600 dark:text-primary-400 font-medium">Tap to view names</span>}
        </p>
      </motion.button>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-8">
      <div className="space-y-4">
        <DashboardPageHeader
          badge="HR Suite"
          title="HR dashboard"
          subtitle={`Summary for ${todayLabel} - today’s headcount mix, leave totals, and links to detailed dashboards.`}
        />
        <DashboardSwitcher mode={dashboardSwitcherMode} active="hr" />
      </div>

      {myLeaveInbox && myLeaveInbox.approval_queue_count > 0 && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-amber-950 dark:text-amber-100">
            <span className="font-bold tabular-nums">{myLeaveInbox.approval_queue_count}</span> leave request
            {myLeaveInbox.approval_queue_count === 1 ? '' : 's'} waiting on <strong>you</strong> as supervisor.
          </p>
          <Link
            to={ROUTES.HR.LEAVE}
            className="inline-flex justify-center px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shrink-0"
          >
            Open my approvals
          </Link>
        </div>
      )}

      <QuickLinksSection
        title="Quick access"
        description="Jump to the tools you use most - charts and deep lists live on each dedicated dashboard."
      >
        <QuickLinkCard
          to={ROUTES.HR.DASHBOARD_ATTENDANCE}
          emoji="🕐"
          title="Attendance dashboard"
          description="Seven-day trend, today’s mix chart, and recent clock-ins."
          accent="slate"
        />
        <QuickLinkCard
          to={ROUTES.HR.DASHBOARD_LEAVE}
          emoji="🏖️"
          title="Leave dashboard"
          description="Pipeline charts, monthly decisions, and leave shortcuts."
          accent="amber"
        />
        <QuickLinkCard
          to={ROUTES.HR.ORGANIZATION}
          emoji="🏛️"
          title="Organization dashboard"
          description="Headcount, gender, age bands, departments, and branches."
          accent="emerald"
        />
        <QuickLinkCard
          to={ROUTES.HR.REPORTS}
          emoji="📊"
          title="Reports hub"
          description="Daily & monthly attendance, raw export, recognition, and leave analytics with CSV export."
          accent="primary"
        />
        <QuickLinkCard
          to={ROUTES.HR.LEAVE_ORGANIZATION}
          emoji="🗓️"
          title="Organization leave"
          description="Who is off today or any date; browse all requests by department and status."
          accent="emerald"
        />
        <QuickLinkCard
          to={ROUTES.HR.LEAVE_OVERVIEW}
          emoji="✅"
          title="Leave overview"
          description="Pipeline counts, staff on leave, and recent pending items."
          accent="amber"
        />
        <QuickLinkCard
          to={ROUTES.HR.LEAVE}
          emoji="📥"
          title="Approvals inbox"
          description="Approve, return, or reject leave requests waiting on you or HR."
          accent="violet"
        />
        <QuickLinkCard
          to={ROUTES.HR.LEAVE_BALANCES}
          emoji="⏱️"
          title="Leave balances"
          description="Per-employee entitlements and usage across leave types."
          accent="slate"
        />
        <QuickLinkCard
          to={ROUTES.HR.EMPLOYEES}
          emoji="👥"
          title="Employee records"
          description="Edit profiles, hire dates, supervisors, and org details for everyone."
          accent="primary"
        />
      </QuickLinksSection>

      {leaveOverview && (
        <section className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Pending leave (all stages)"
            value={leaveOverview.pending_total ?? 0}
            hint="Open Approvals inbox to clear the queue."
            variant="amber"
          />
          <StatTile
            label="On approved leave today"
            value={leaveOverview.staff_on_leave_today ?? 0}
            hint="Distinct people with approved leave overlapping today."
            variant="green"
          />
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft flex flex-col justify-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Leave shortcuts</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={ROUTES.HR.LEAVE_ORGANIZATION}
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
              >
                Calendar view
              </Link>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <Link to={ROUTES.HR.REPORTS} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
                Leave report CSV
              </Link>
            </div>
          </div>
        </section>
      )}

      {leaveOverview?.on_leave_today_detail?.length > 0 && (
        <section className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">On approved leave today</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                People with approved leave overlapping today (HR also receives email when requests are approved or assigned).
              </p>
            </div>
            <Link
              to={ROUTES.HR.LEAVE_ORGANIZATION}
              className="text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline shrink-0"
            >
              Open leave calendar
            </Link>
          </div>
          <ul className="flex flex-wrap gap-2">
            {leaveOverview.on_leave_today_detail.slice(0, 24).map((r) => (
              <li
                key={r.id || `${r.user_id}-${r.start_date}`}
                className="inline-flex flex-col px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700 text-sm max-w-[220px]"
              >
                <span className="font-medium text-slate-900 dark:text-white truncate">{r.full_name || 'Employee'}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {r.leave_type_name || 'Leave'} · {r.start_date} to {r.end_date}
                </span>
                {r.department && <span className="text-[11px] text-slate-400 mt-0.5 truncate">{r.department}</span>}
              </li>
            ))}
          </ul>
          {leaveOverview.on_leave_today_detail.length > 24 && (
            <p className="text-xs text-slate-500 mt-3">Showing 24 of {leaveOverview.staff_on_leave_today ?? 'many'}; open the calendar for the full list.</p>
          )}
        </section>
      )}

      <section>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Today’s attendance</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          Live counts refresh about every 15 seconds. Trends, donut chart, and clock-in feed are on the{' '}
          <Link to={ROUTES.HR.DASHBOARD_ATTENDANCE} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
            Attendance dashboard
          </Link>
          .
        </p>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          {statCard('Present', present, `${pctOnTime}% on time`, 'text-green-600 dark:text-green-400', 'on_time', 'On time today')}
          {statCard('Late', late, `${pctLate}% of present`, 'text-amber-600 dark:text-amber-400', 'late', 'Late arrivals')}
          {statCard('Absent', absent, `${pctAbsent}% (no clock-in)`, 'text-red-600 dark:text-red-400', 'absent', 'Did not clock in')}
          {statCard('No clock-out', noClockOut, 'Still clocked in', 'text-blue-600 dark:text-blue-400', 'no_clock_out', 'Did not clock out')}
          <motion.div
            className="rounded-2xl border border-primary-200/60 dark:border-primary-900/40 bg-gradient-to-br from-primary-50/90 to-white dark:from-primary-950/35 dark:to-slate-900/80 p-5 shadow-soft"
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
          >
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.08em]">Total staff</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">{totalStaff}</p>
            <Link to={ROUTES.HR.DASHBOARD_ATTENDANCE} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline mt-3 inline-block">
              Attendance dashboard →
            </Link>
          </motion.div>
        </div>
      </section>

      {modal && <UserListModal title={modal.title} users={modal.list} onClose={() => setModal(null)} />}

      {absent > 0 && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/20 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-1">Absent today</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">No clock-in recorded for these staff.</p>
          <ul className="flex flex-wrap gap-2">
            {(users.absent || []).map((u, i) => (
              <li
                key={u.user_id || i}
                className="inline-flex items-center px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900/50 text-red-900 dark:text-red-200 text-sm shadow-sm"
              >
                <span className="font-medium">{u.full_name || '-'}</span>
                {u.email && <span className="ml-2 text-red-700/80 dark:text-red-300/90 text-xs">{u.email}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
