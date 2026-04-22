import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { ROUTES, ROLES } from '../../utils/constants';
import { DashboardPageHeader, QuickLinkCard, QuickLinksSection } from '../../components/dashboard/DashboardWidgets';
import { LeaveInsightCharts } from '../../components/dashboard/InsightChartCards';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';

export function HRLeaveDashboard() {
  const role = useSelector((s) => s.auth.profile?.role);
  const dashboardSwitcherMode = role === ROLES.ADMIN ? 'admin' : 'hr';
  const [leaveOverview, setLeaveOverview] = useState(null);
  const [myLeaveInbox, setMyLeaveInbox] = useState(null);

  useEffect(() => {
    api.getLeaveOverview().then(setLeaveOverview).catch(() => setLeaveOverview(null));
    api.getLeaveMyDashboard().then(setMyLeaveInbox).catch(() => setMyLeaveInbox(null));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      api.getLeaveOverview().then(setLeaveOverview).catch(() => {});
      api.getLeaveMyDashboard().then(setMyLeaveInbox).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-8">
      <div className="space-y-4">
        <DashboardPageHeader
          badge="Dashboard"
          title="Leave dashboard"
          subtitle="Pipeline, who is off today, and shortcuts to approvals, balances, and calendar views."
        />
        <DashboardSwitcher mode={dashboardSwitcherMode} active="leave" />
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

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Leave summary</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Clear numbers first. Use the detail links below when you need full tables and workflows.
        </p>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Pending total" value={leaveOverview?.pending_total ?? 0} tone="violet" />
          <KpiCard label="Awaiting supervisor" value={leaveOverview?.pipeline?.pending_manager ?? 0} tone="amber" />
          <KpiCard label="Awaiting HOD" value={leaveOverview?.pipeline?.pending_hod ?? 0} tone="sky" />
          <KpiCard label="Awaiting HR" value={leaveOverview?.pipeline?.pending_hr ?? 0} tone="slate" />
          <KpiCard label="On leave today" value={leaveOverview?.staff_on_leave_today ?? 0} tone="emerald" />
        </div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Approved (range)" value={leaveOverview?.approved_this_month ?? 0} tone="emerald" />
          <KpiCard label="Rejected (range)" value={leaveOverview?.rejected_this_month ?? 0} tone="rose" />
          <KpiCard label="My queue" value={myLeaveInbox?.approval_queue_count ?? 0} tone="amber" />
          <KpiCard label="Recent pending" value={leaveOverview?.recent_pending?.length ?? 0} tone="violet" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Leave at a glance</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pie and bar charts for quick understanding. Open detail pages only when you need deeper records.
        </p>
        <LeaveInsightCharts leaveOverview={leaveOverview} />
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to={ROUTES.HR.LEAVE_OVERVIEW} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            Open leave overview details
          </Link>
          <Link to={ROUTES.HR.LEAVE} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            Open approvals inbox
          </Link>
          <Link to={ROUTES.HR.LEAVE_ORGANIZATION} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            Open organization leave
          </Link>
          <Link to={ROUTES.HR.LEAVE_BALANCES} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            Open leave balances
          </Link>
        </div>
      </section>

      <QuickLinksSection
        title="Leave tools"
        description="Need to take action? Open the full workflow/detail screens below."
      >
        <QuickLinkCard
          to={ROUTES.HR.LEAVE}
          emoji="📥"
          title="Approvals inbox"
          description="Approve, return, or reject items in your queue."
          accent="violet"
        />
        <QuickLinkCard
          to={ROUTES.HR.LEAVE_OVERVIEW}
          emoji="✅"
          title="Leave overview (detail)"
          description="Pipeline counts, staff on leave, and pending tables."
          accent="amber"
        />
        <QuickLinkCard
          to={ROUTES.HR.LEAVE_ORGANIZATION}
          emoji="🗓️"
          title="Organization leave"
          description="Calendar of who is off by date and department."
          accent="emerald"
        />
        <QuickLinkCard
          to={ROUTES.HR.LEAVE_BALANCES}
          emoji="⏱️"
          title="Leave balances"
          description="Per-employee balances across leave types."
          accent="slate"
        />
      </QuickLinksSection>
    </motion.div>
  );
}

function KpiCard({ label, value, tone = 'slate' }) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'violet'
        ? 'text-violet-700 dark:text-violet-300'
        : tone === 'amber'
          ? 'text-amber-700 dark:text-amber-300'
          : tone === 'rose'
            ? 'text-rose-700 dark:text-rose-300'
            : tone === 'sky'
              ? 'text-sky-700 dark:text-sky-300'
              : 'text-slate-900 dark:text-white';
  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 p-4 shadow-soft">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-extrabold tabular-nums ${toneClass}`}>{Number(value || 0)}</p>
    </div>
  );
}
