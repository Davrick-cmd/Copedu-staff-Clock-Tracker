import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '../../services/api';
import { formatTime } from '../../utils/formatters';
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
  const [feed, setFeed] = useState([]);
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
    api
      .getDailyReportSummary(today)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    api
      .getAllAttendance({ fromDate: `${today}T00:00:00`, toDate: `${today}T23:59:59` })
      .then((logs) => setFeed(logs.slice(0, 16).map((l) => ({ ...l, users: l.users || {} }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const days = 7;
    const promises = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      promises.push(
        api.getAllAttendance({ fromDate: `${day}T00:00:00`, toDate: `${day}T23:59:59` }).then((logs) => ({ date: day.slice(5), count: logs.length }))
      );
    }
    Promise.all(promises).then(setChartData);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      api.getDailyReportSummary(today).then(setSummary).catch(() => {});
      api
        .getAllAttendance({ fromDate: `${today}T00:00:00`, toDate: `${today}T23:59:59` })
        .then((logs) => setFeed(logs.slice(0, 16).map((l) => ({ ...l, users: l.users || {} }))))
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
      </section>

      {modal && <UserListModal title={modal.title} users={modal.list} onClose={() => setModal(null)} />}

      {absent > 0 && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/20 p-6">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-1">Absent today</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">No clock-in recorded for these staff.</p>
          <ul className="flex flex-wrap gap-2">
            {(users.absent || []).map((u, i) => (
              <li
                key={u.user_id || i}
                className="inline-flex items-center px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-red-100 dark:border-red-900/50 text-red-900 dark:text-red-200 text-sm shadow-sm"
              >
                <span className="font-medium">{u.full_name || '-'}</span>
                {u.email && <span className="ml-2 text-red-700/80 dark:text-red-300/90 text-xs">{u.email}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-6 shadow-soft xl:col-span-1">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-1">Attendance trend</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Clock-in records per day (last 7 days)</p>
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
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-6 shadow-soft">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-1">Recent clock-ins</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Latest arrivals today</p>
          {feed.length ? (
            <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {feed.map((log) => (
                <li
                  key={log.id}
                  className="flex justify-between items-center text-sm py-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-200">{log.users?.full_name || 'Employee'}</span>
                  <span className="text-slate-500 dark:text-slate-400 tabular-nums">{formatTime(log.clock_in_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No clock-ins yet" message="Activity will show here during the day." />
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/40 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">Leave pipeline, balances, and exports</p>
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <Link to={ROUTES.HR.DASHBOARD_LEAVE} className="text-primary-600 dark:text-primary-400 hover:underline">
            Leave dashboard
          </Link>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <Link to={ROUTES.HR.FLAGGED} className="text-primary-600 dark:text-primary-400 hover:underline">
            Flagged attendance
          </Link>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <Link to={ROUTES.HR.REPORTS} className="text-primary-600 dark:text-primary-400 hover:underline">
            Reports hub
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
