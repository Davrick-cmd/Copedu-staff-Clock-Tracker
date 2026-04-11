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

      <QuickLinksSection
        title="Leave tools"
        description="Everything for requests, coverage, and balances - full detail tables live on each screen."
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

      <section className="space-y-2">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Leave at a glance</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pipeline, monthly outcomes, and who is out today by leave type - detail tables stay on Leave overview.
        </p>
        <LeaveInsightCharts leaveOverview={leaveOverview} />
      </section>
    </motion.div>
  );
}
