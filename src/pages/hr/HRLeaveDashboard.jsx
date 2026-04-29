import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { ROUTES, ROLES } from '../../utils/constants';
import { DashboardPageHeader, QuickLinkCard, QuickLinksSection } from '../../components/dashboard/DashboardWidgets';
import { LeaveInsightCharts } from '../../components/dashboard/InsightChartCards';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';
import { useToast } from '../../hooks/useToast';

export function HRLeaveDashboard() {
  const toast = useToast();
  const role = useSelector((s) => s.auth.profile?.role);
  const dashboardSwitcherMode = role === ROLES.ADMIN ? 'admin' : 'hr';
  const [leaveOverview, setLeaveOverview] = useState(null);
  const [myLeaveInbox, setMyLeaveInbox] = useState(null);
  const [showPendingPopover, setShowPendingPopover] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [remindingId, setRemindingId] = useState('');
  const [deletingId, setDeletingId] = useState('');

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
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          <div
            className="relative"
            onMouseEnter={() => setShowPendingPopover(true)}
            onMouseLeave={() => setShowPendingPopover(false)}
          >
            <KpiCard label="Pending total" value={leaveOverview?.pending_total ?? 0} tone="violet" />
            {showPendingPopover && (
              <div className="absolute left-0 top-full z-20 mt-2 w-[30rem] max-w-[90vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Pending approvals (hover preview)</p>
                {!(leaveOverview?.recent_pending || []).length ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No pending requests.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-auto pr-1">
                    {(leaveOverview?.recent_pending || []).map((r) => (
                      <div key={r.id} className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{r.full_name} · {r.leave_type_name}</p>
                        <p className="text-slate-600 dark:text-slate-300">{r.start_date} to {r.end_date} ({Number(r.days_requested || 0)} day(s))</p>
                        <p className="text-slate-500 dark:text-slate-400">Approver: {r.approver_name || 'Not assigned'}</p>
                        <div className="pt-1.5">
                          <button
                            type="button"
                            disabled={!r.approver_name || remindingId === r.id}
                            onClick={async () => {
                              try {
                                setRemindingId(r.id);
                                await api.remindLeaveApprover(r.id);
                                toast(`Reminder sent to ${r.approver_name || 'approver'}`, 'success');
                                const ov = await api.getLeaveOverview();
                                setLeaveOverview(ov);
                              } catch (e) {
                                toast(e?.response?.data?.detail || 'Failed to send reminder', 'error');
                              } finally {
                                setRemindingId('');
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                          >
                            {remindingId === r.id ? 'Sending...' : 'Send reminder'}
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === r.id}
                            onClick={async () => {
                              if (!window.confirm('Delete this pending leave request? This cannot be undone.')) return;
                              try {
                                setDeletingId(r.id);
                                await api.deletePendingLeaveRequest(r.id);
                                toast('Pending leave request deleted', 'success');
                                const ov = await api.getLeaveOverview();
                                setLeaveOverview(ov);
                              } catch (e) {
                                toast(e?.response?.data?.detail || 'Failed to delete request', 'error');
                              } finally {
                                setDeletingId('');
                              }
                            }}
                            className="ml-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                          >
                            {deletingId === r.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <KpiCard label="Awaiting supervisor" value={leaveOverview?.pipeline?.pending_manager ?? 0} tone="amber" />
          <KpiCard label="On leave today" value={leaveOverview?.staff_on_leave_today ?? 0} tone="emerald" />
        </div>
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowPendingPanel((v) => !v)}
            className="px-3 py-2 rounded-xl border border-amber-300/80 dark:border-amber-700/70 text-sm font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20"
          >
            {showPendingPanel ? 'Hide pending + reminders' : 'Show pending + send reminders'}
          </button>
        </div>
        {showPendingPanel && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            {!(leaveOverview?.recent_pending || []).length ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No pending requests.</p>
            ) : (
              <div className="grid gap-2">
                {(leaveOverview?.recent_pending || []).map((r) => (
                  <div key={r.id} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{r.full_name} · {r.leave_type_name}</p>
                    <p className="text-slate-600 dark:text-slate-300">{r.start_date} to {r.end_date} ({Number(r.days_requested || 0)} day(s))</p>
                    <p className="text-slate-500 dark:text-slate-400">Approver: {r.approver_name || 'Not assigned'}</p>
                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={!r.approver_name || remindingId === r.id}
                        onClick={async () => {
                          try {
                            setRemindingId(r.id);
                            await api.remindLeaveApprover(r.id);
                            toast(`Reminder sent to ${r.approver_name || 'approver'}`, 'success');
                            const ov = await api.getLeaveOverview();
                            setLeaveOverview(ov);
                          } catch (e) {
                            toast(e?.response?.data?.detail || 'Failed to send reminder', 'error');
                          } finally {
                            setRemindingId('');
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                      >
                        {remindingId === r.id ? 'Sending...' : 'Send reminder'}
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={async () => {
                          if (!window.confirm('Delete this pending leave request? This cannot be undone.')) return;
                          try {
                            setDeletingId(r.id);
                            await api.deletePendingLeaveRequest(r.id);
                            toast('Pending leave request deleted', 'success');
                            const ov = await api.getLeaveOverview();
                            setLeaveOverview(ov);
                          } catch (e) {
                            toast(e?.response?.data?.detail || 'Failed to delete request', 'error');
                          } finally {
                            setDeletingId('');
                          }
                        }}
                        className="ml-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                      >
                        {deletingId === r.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            to={ROUTES.HR.LEAVE_OVERVIEW}
            className="px-3 py-2 rounded-xl border border-violet-300/80 dark:border-violet-700/70 text-sm font-medium text-violet-800 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-900/20"
          >
            Review all pending requests
          </Link>
          <Link
            to={ROUTES.HR.LEAVE}
            className="px-3 py-2 rounded-xl border border-amber-300/80 dark:border-amber-700/70 text-sm font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20"
          >
            Open my approval queue
          </Link>
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
