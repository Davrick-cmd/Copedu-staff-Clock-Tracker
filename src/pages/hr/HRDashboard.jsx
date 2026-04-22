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
} from '../../components/dashboard/DashboardWidgets';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';
import { AttendanceTodayDonut, LeaveInsightCharts } from '../../components/dashboard/InsightChartCards';

export function HRDashboard() {
  const role = useSelector((s) => s.auth.profile?.role);
  const dashboardSwitcherMode = role === ROLES.ADMIN ? 'admin' : 'hr';
  const [summary, setSummary] = useState(null);
  const [leaveOverview, setLeaveOverview] = useState(null);
  const [myLeaveInbox, setMyLeaveInbox] = useState(null);
  const [loading, setLoading] = useState(true);

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
  const noClockOut = s.no_clock_out ?? 0;
  const totalStaff = s.total_staff ?? 0;

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

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Executive snapshot</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Clear numbers first, then charts. Open detail pages only when you need deeper records.</p>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Total staff" value={totalStaff} tone="slate" />
          <KpiCard label="Present" value={present} tone="emerald" />
          <KpiCard label="Late" value={late} tone="amber" />
          <KpiCard label="Absent" value={absent} tone="rose" />
          <KpiCard label="No clock-out" value={noClockOut} tone="sky" />
        </div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Pending leave" value={leaveOverview?.pending_total ?? 0} tone="amber" />
          <KpiCard label="On leave today" value={leaveOverview?.staff_on_leave_today ?? 0} tone="violet" />
          <KpiCard label="Approved (range)" value={leaveOverview?.approved_this_month ?? 0} tone="emerald" />
          <KpiCard label="My approvals queue" value={myLeaveInbox?.approval_queue_count ?? 0} tone="amber" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Visual insights</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Attendance mix plus leave pipeline and decisions in one view.</p>
        <div className="grid gap-6 xl:grid-cols-3">
          <AttendanceTodayDonut summary={s} />
          <div className="xl:col-span-2">
            <LeaveInsightCharts leaveOverview={leaveOverview} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={ROUTES.HR.DASHBOARD_ATTENDANCE} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Open attendance details</Link>
          <Link to={ROUTES.HR.DASHBOARD_LEAVE} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Open leave details</Link>
          <Link to={ROUTES.HR.ORGANIZATION} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Open organization details</Link>
          <Link to={ROUTES.HR.REPORTS} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Open full reports</Link>
        </div>
      </section>

      <QuickLinksSection
        title="Quick access"
        description="Detailed workflows and full tables."
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
