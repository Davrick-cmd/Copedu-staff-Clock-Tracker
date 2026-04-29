import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { ROUTES, ROLES } from '../../utils/constants';
import { DashboardPageHeader } from '../../components/dashboard/DashboardWidgets';
import { UserListModal } from '../../components/dashboard/UserListModal';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';
import { AttendanceTodayDonut, CHART_TOOLTIP_DARK } from '../../components/dashboard/InsightChartCards';

export function HRAttendanceDashboard() {
  const role = useSelector((s) => s.auth.profile?.role);
  const dashboardSwitcherMode = role === ROLES.ADMIN ? 'admin' : 'hr';
  const [summary, setSummary] = useState(null);
  const [advanced, setAdvanced] = useState({ totals: { late_minutes: 0, early_departure_minutes: 0, overtime_minutes: 0, rows: 0 }, rows: [] });
  const [deptTrend, setDeptTrend] = useState([]);
  const [chartData, setChartData] = useState([]);
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
    const from = new Date();
    from.setDate(from.getDate() - 29);
    const fromDate = from.toISOString().slice(0, 10);
    api
      .getDailyReportSummary(today)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
    api
      .getAttendanceSummary({ fromDate, toDate: today })
      .then((res) => {
        setAdvanced(res || { totals: { late_minutes: 0, early_departure_minutes: 0, overtime_minutes: 0, rows: 0 }, rows: [] });
        const grouped = {};
        for (const r of res?.rows || []) {
          const dept = r?.user_department || 'Unassigned';
          if (!grouped[dept]) grouped[dept] = { department: dept, overtime: 0, late: 0 };
          grouped[dept].overtime += Number(r?.overtime_minutes || 0);
          grouped[dept].late += Number(r?.late_minutes || 0);
        }
        setDeptTrend(Object.values(grouped).sort((a, b) => (b.overtime + b.late) - (a.overtime + a.late)).slice(0, 8));
      })
      .catch(() => {
        setAdvanced({ totals: { late_minutes: 0, early_departure_minutes: 0, overtime_minutes: 0, rows: 0 }, rows: [] });
        setDeptTrend([]);
      });
  }, []);

  useEffect(() => {
    const days = 7;
    const promises = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      if (d.getDay() === 0) continue; // Sunday — not a working day
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayNum = String(d.getDate()).padStart(2, '0');
      const day = `${y}-${m}-${dayNum}`;
      promises.push(
        api.getAllAttendance({ fromDate: `${day}T00:00:00`, toDate: `${day}T23:59:59` }).then((logs) => ({ date: day.slice(5), count: logs.length }))
      );
    }
    Promise.all(promises).then(setChartData);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date();
      from.setDate(from.getDate() - 29);
      const fromDate = from.toISOString().slice(0, 10);
      api.getDailyReportSummary(today).then(setSummary).catch(() => {});
      api
        .getAttendanceSummary({ fromDate, toDate: today })
        .then((res) => {
          setAdvanced(res || { totals: { late_minutes: 0, early_departure_minutes: 0, overtime_minutes: 0, rows: 0 }, rows: [] });
          const grouped = {};
          for (const r of res?.rows || []) {
            const dept = r?.user_department || 'Unassigned';
            if (!grouped[dept]) grouped[dept] = { department: dept, overtime: 0, late: 0 };
            grouped[dept].overtime += Number(r?.overtime_minutes || 0);
            grouped[dept].late += Number(r?.late_minutes || 0);
          }
          setDeptTrend(Object.values(grouped).sort((a, b) => (b.overtime + b.late) - (a.overtime + a.late)).slice(0, 8));
        })
        .catch(() => {});
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
  const overtimeMinutes = Number(advanced?.totals?.overtime_minutes || 0);
  const lateMinutes = Number(advanced?.totals?.late_minutes || 0);
  const earlyDepartureMinutes = Number(advanced?.totals?.early_departure_minutes || 0);

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
          badge="Dashboard"
          title="Attendance dashboard"
          subtitle={`Who is in, late, or absent for ${todayLabel}. Counts refresh about every 15 seconds.`}
        />
        <DashboardSwitcher mode={dashboardSwitcherMode} active="attendance" />
      </div>

      <section>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Today’s attendance</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          Live clock-in counts and charts for this screen only. Leave analytics are on the Leave dashboard.
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
            <Link to={ROUTES.HR.DASHBOARD_LEAVE} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline mt-3 inline-block">
              Leave dashboard →
            </Link>
          </motion.div>
        </div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 mt-4">
          {statCard('Overtime (30d mins)', overtimeMinutes, 'Across visible scope', 'text-indigo-600 dark:text-indigo-400')}
          {statCard('Late (30d mins)', lateMinutes, 'Across visible scope', 'text-amber-600 dark:text-amber-400')}
          {statCard('Early departure (30d mins)', earlyDepartureMinutes, 'Across visible scope', 'text-rose-600 dark:text-rose-400')}
        </div>
      </section>

      {modal && <UserListModal title={modal.title} users={modal.list} onClose={() => setModal(null)} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-6 shadow-soft xl:col-span-1">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-1">Attendance trend</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Clock-in records per day (last 7 calendar days; Sundays omitted)</p>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData}>
                <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP_DARK} formatter={(v) => [`${v} clock-ins`, 'Day']} />
                <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Clock-ins" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No data" />
          )}
        </div>
        <AttendanceTodayDonut summary={s} />
      </div>
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-6 shadow-soft">
        <h2 className="font-semibold text-slate-900 dark:text-white mb-1">Department trend (last 30 days)</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Stacked minutes: overtime + lateness by department.</p>
        {deptTrend.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={deptTrend}>
              <XAxis dataKey="department" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
              <Tooltip {...CHART_TOOLTIP_DARK} formatter={(v) => [`${v} mins`, '']} />
              <Bar dataKey="overtime" stackId="mins" fill="#6366f1" name="Overtime" />
              <Bar dataKey="late" stackId="mins" fill="#f59e0b" name="Late" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState title="No department trend yet" message="Start assigning shifts and clocking attendance to populate this chart." />
        )}
      </div>

      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/40 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">Need deeper details? Open full tables and filters.</p>
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <Link to={ROUTES.HR.DASHBOARD_LEAVE} className="text-primary-600 dark:text-primary-400 hover:underline">
            Leave dashboard
          </Link>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <Link to={ROUTES.HR.FLAGGED} className="text-primary-600 dark:text-primary-400 hover:underline">
            Flagged attendance
          </Link>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <Link to={ROUTES.HR.REPORTS_ATTENDANCE} className="text-primary-600 dark:text-primary-400 hover:underline">
            Attendance reports
          </Link>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <Link to={ROUTES.HR.LEAVE} className="text-primary-600 dark:text-primary-400 hover:underline">
            Approvals inbox
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
