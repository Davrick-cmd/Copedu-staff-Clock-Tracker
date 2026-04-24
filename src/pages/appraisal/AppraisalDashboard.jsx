import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as api from '../../services/api';
import { EmptyState } from '../../components/EmptyState';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ROLES, ROUTES } from '../../utils/constants';

function KpiCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

export function AppraisalDashboard() {
  const role = useSelector((s) => s.auth.profile?.role);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    let fn = api.getAppraisalDashboardStaff;
    if (role === ROLES.MANAGER) fn = api.getAppraisalDashboardManager;
    else if (role === ROLES.HOD) fn = api.getAppraisalDashboardHod;
    else if (role === ROLES.HR || role === ROLES.ADMIN) fn = api.getAppraisalDashboardHr;
    fn()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [role]);

  if (loading) {
    return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  }

  const tooltipDark = {
    contentStyle: {
      borderRadius: 12,
      border: '1px solid rgba(148,163,184,0.45)',
      backgroundColor: 'rgba(15,23,42,0.97)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
    },
    labelStyle: { color: '#f8fafc', fontWeight: 600, marginBottom: 4 },
    itemStyle: { color: '#e2e8f0' },
  };

  const staffKpis = data?.kpis || [];
  const staffAppraisals = data?.appraisals || [];
  const mgrPendingKpis = data?.kpis_pending_verify || data?.kpis_pending_approve || [];
  const mgrPendingAppraisals = data?.appraisals_pending_verify || data?.appraisals_pending_approve || [];
  const hrLocked = data?.annual_kpis_locked || [];
  const hrReady = data?.annual_kpis_ready_to_lock || [];
  const managerDone = data?.team_appraisals_done || [];
  const chartAppraisals = (role === ROLES.MANAGER ? managerDone : staffAppraisals) || [];
  const allCycles = data?.cycles || data?.all_cycles || [];
  const activeYear = Number(allCycles.find((c) => String(c.status || '').toLowerCase() === 'active')?.year || new Date().getFullYear());
  const finalizedStatuses = new Set(['approved', 'received', 'acknowledged']);

  const ratingCounts = chartAppraisals
    .filter((a) => finalizedStatuses.has(String(a.status || '').toLowerCase()))
    .reduce((acc, a) => {
      const key = String(a.rating || 'Not rated');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  const ratingPieData = Object.entries(ratingCounts).map(([name, value]) => ({ name, value: Number(value || 0) }));
  const pieColors = ['#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#f43f5e', '#64748b'];

  const quarterOrder = ['Q1', 'Q2', 'Q3', 'Q4'];
  const quarterBarData = quarterOrder.map((q) => {
    const cycle = (allCycles || []).find(
      (c) =>
        String(c.type || '').toLowerCase() === 'quarterly' &&
        Number(c.year) === activeYear &&
        String(c.quarter || '').toUpperCase() === q
    );
    const appraisal = cycle ? chartAppraisals.find((a) => a.cycle_id === cycle.id) : null;
    return {
      quarter: q,
      done: appraisal && finalizedStatuses.has(String(appraisal.status || '').toLowerCase()) ? 1 : 0,
      in_progress: appraisal && !finalizedStatuses.has(String(appraisal.status || '').toLowerCase()) ? 1 : 0,
    };
  });

  const kpiStatusBar = Object.entries(
    staffKpis.reduce((acc, k) => {
      const key = String(k.status || 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  ).map(([status, count]) => ({ status, count }));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Performance & Appraisal Dashboard</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Quick view of KPI setup, appraisal progress, and approvals.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="My KPI records" value={staffKpis.length} />
        <KpiCard label="My appraisals" value={staffAppraisals.length} />
        <KpiCard label="Pending KPI approvals" value={mgrPendingKpis.length} />
        <KpiCard label="Pending appraisal approvals" value={mgrPendingAppraisals.length} />
      </div>

      {(role === ROLES.HR || role === ROLES.ADMIN) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard label="Annual KPIs ready to lock" value={hrReady.length} />
          <KpiCard label="Annual KPIs locked" value={hrLocked.length} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 xl:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Quarterly appraisal progress ({activeYear})</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterBarData}>
                <XAxis dataKey="quarter" />
                <YAxis allowDecimals={false} />
                <Tooltip {...tooltipDark} />
                <Bar dataKey="done" name="Finalized" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="in_progress" name="In progress" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Final ratings distribution</h3>
          <div className="h-72">
            {ratingPieData.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 h-full flex items-center justify-center">No finalized ratings yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ratingPieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3}>
                    {ratingPieData.map((d, i) => (
                      <Cell key={d.name} fill={pieColors[i % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipDark} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-2">KPI status overview</h3>
        <div className="h-64">
          {kpiStatusBar.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 h-full flex items-center justify-center">No KPI records yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kpiStatusBar}>
                <XAxis dataKey="status" />
                <YAxis allowDecimals={false} />
                <Tooltip {...tooltipDark} />
                <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Quick actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link to={ROUTES.EMPLOYEE.APPRAISAL_KPI} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">Set KPI</Link>
          <Link to={ROUTES.EMPLOYEE.APPRAISAL_REVIEWS} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Open Appraisal</Link>
          {(role === ROLES.MANAGER || role === ROLES.HR || role === ROLES.ADMIN) && (
            <Link to={ROUTES.APPRAISAL.MANAGER} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Supervisor queue</Link>
          )}
          {(role === ROLES.HOD || role === ROLES.ADMIN) && (
            <Link to={ROUTES.APPRAISAL.HOD} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">HOD queue</Link>
          )}
          {(role === ROLES.HR || role === ROLES.ADMIN) && (
            <Link to={ROUTES.APPRAISAL.HR} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">HR appraisal admin</Link>
          )}
        </div>
      </div>

      {!data && <EmptyState title="No data yet" message="No appraisal data available for this role right now." />}
    </motion.div>
  );
}
