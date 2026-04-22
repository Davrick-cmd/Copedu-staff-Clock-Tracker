import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { ROLES, ROUTES } from '../../utils/constants';
import { DashboardPageHeader } from '../../components/dashboard/DashboardWidgets';
import { OrganizationOverview } from '../../components/dashboard/OrganizationOverview';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';

export function HROrganizationDashboard() {
  const role = useSelector((s) => s.auth.profile?.role);
  const dashboardSwitcherMode = role === ROLES.ADMIN ? 'admin' : 'hr';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getOrganizationOverview()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-8">
      <div className="space-y-4">
        <DashboardPageHeader
          badge="Dashboard"
          title="Organization dashboard"
          subtitle="Headcount, women and men, age distribution (when date of birth is recorded), active vs former staff, and where people sit in the org."
        />
        <DashboardSwitcher mode={dashboardSwitcherMode} active="organization" />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Organization snapshot</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Clear headline numbers first, with full demographics and structure details below.</p>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Active employees" value={data?.active_employees ?? 0} tone="emerald" />
          <KpiCard label="No longer active" value={data?.no_longer_active ?? data?.inactive_accounts ?? 0} tone="slate" />
          <KpiCard label="Total users" value={data?.total_users ?? 0} tone="violet" />
          <KpiCard label="Departments" value={(data?.by_department || []).length} tone="sky" />
          <KpiCard label="Branches in use" value={(data?.by_branch || []).filter((b) => b.branch_id).length} tone="amber" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={ROUTES.HR.EMPLOYEES} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            Open employee records
          </Link>
          <Link to={ROUTES.HR.REPORTS_ORGANIZATION} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            Open organization reports
          </Link>
        </div>
      </section>

      <OrganizationOverview data={data} loading={loading} compactTitle />
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
