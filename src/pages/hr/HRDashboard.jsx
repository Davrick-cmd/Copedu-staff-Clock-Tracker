import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '../../services/api';
import { formatTime } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { ROUTES } from '../../utils/constants';

function UserListModal({ title, users, onClose }) {
  const list = Array.isArray(users) ? users : [];
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">✕</button>
          </div>
          <div className="p-4 overflow-y-auto flex-1">
            {list.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No one in this category.</p>
            ) : (
              <ul className="space-y-2">
                {list.map((u, i) => (
                  <li key={u.user_id || i} className="text-sm text-gray-700 dark:text-gray-300 py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <span className="font-medium">{u.full_name || '—'}</span>
                    {u.email && <span className="text-gray-500 dark:text-gray-400 ml-2">{u.email}</span>}
                    {u.clock_in_at && <span className="block text-xs text-gray-500 dark:text-gray-400">Clocked in: {formatTime(u.clock_in_at)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export function HRDashboard() {
  const [summary, setSummary] = useState(null);
  const [feed, setFeed] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    api.getDailyReportSummary(today)
      .then((data) => {
        setSummary(data);
        return data;
      })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    api.getAllAttendance({ fromDate: `${today}T00:00:00`, toDate: `${today}T23:59:59` })
      .then((logs) => setFeed(logs.slice(0, 10).map((l) => ({ ...l, users: l.users || {} }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const days = 7;
    const promises = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      promises.push(api.getAllAttendance({ fromDate: `${day}T00:00:00`, toDate: `${day}T23:59:59` }).then((logs) => ({ date: day.slice(5), count: logs.length })));
    }
    Promise.all(promises).then(setChartData);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      api.getDailyReportSummary(today).then(setSummary).catch(() => {});
      api.getAllAttendance({ fromDate: `${today}T00:00:00`, toDate: `${today}T23:59:59` })
        .then((logs) => setFeed(logs.slice(0, 10).map((l) => ({ ...l, users: l.users || {} }))))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !summary) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const s = summary || {};
  const totalStaff = s.total_staff ?? 0;
  const present = s.present ?? 0;
  const absent = s.absent ?? 0;
  const late = s.late ?? 0;
  const onTime = s.on_time ?? 0;
  const noClockOut = s.no_clock_out ?? 0;
  const pctLate = s.pct_late ?? 0;
  const pctOnTime = s.pct_on_time ?? 0;
  const pctAbsent = s.pct_absent ?? 0;
  const users = s.users || {};

  const statCard = (label, value, sub, colorClass, modalKey, modalTitle) => {
    const count = typeof value === 'number' ? value : 0;
    const clickable = count > 0 && modalKey && users[modalKey]?.length;
    return (
      <motion.div
        className={`bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-5 ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-primary-400' : ''}`}
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        onClick={clickable ? () => setModal({ key: modalKey, title: modalTitle, list: users[modalKey] }) : undefined}
      >
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
        <p className={`text-3xl font-bold mt-1 ${colorClass}`}>{value}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {sub}
          {clickable && <span className="block mt-0.5 text-primary-600 dark:text-primary-400">View list →</span>}
        </p>
      </motion.div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">HR Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Today’s attendance • Click a number to see staff</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        {statCard('Present', present, `${pctOnTime}% on time`, 'text-green-600 dark:text-green-400', 'on_time', 'On time today')}
        {statCard('Late', late, `${pctLate}% of present`, 'text-amber-600 dark:text-amber-400', 'late', 'Late arrivals')}
        {statCard('Absent', absent, `${pctAbsent}% (no clock-in)`, 'text-red-600 dark:text-red-400', 'absent', 'Did not clock in')}
        {statCard('No clock-out', noClockOut, 'Still clocked in', 'text-blue-600 dark:text-blue-400', 'no_clock_out', 'Did not clock out')}
        <motion.div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-5" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total staff</p>
          <p className="text-3xl font-bold text-gray-700 dark:text-gray-300 mt-1">{totalStaff}</p>
          <Link to={ROUTES.HR.REPORTS} className="text-xs text-primary-600 dark:text-primary-400 hover:underline mt-1 block">Daily & monthly reports →</Link>
        </motion.div>
      </div>

      {modal && <UserListModal title={modal.title} users={modal.list} onClose={() => setModal(null)} />}

      {/* Absent today – visible list of staff who didn't clock in */}
      {absent > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Absent today (did not clock in)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">These staff have not clocked in today.</p>
          <ul className="flex flex-wrap gap-2">
            {(users.absent || []).map((u, i) => (
              <li key={u.user_id || i} className="inline-flex items-center px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
                <span className="font-medium">{u.full_name || '—'}</span>
                {u.email && <span className="ml-2 text-red-600 dark:text-red-400 opacity-90">{u.email}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-4">Attendance (last 7 days)</h2>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <XAxis dataKey="date" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip contentStyle={{ backgroundColor: 'var(--tw-bg-opacity)', borderRadius: 8 }} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No data" />
          )}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-4">Recent clock-ins</h2>
          {feed.length ? (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {feed.map((log) => (
                <li key={log.id} className="flex justify-between text-sm py-1 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">{log.users?.full_name || 'Employee'}</span>
                  <span className="text-gray-500 dark:text-gray-400">{formatTime(log.clock_in_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No clock-ins yet" message="Recent clock-ins will appear here." />
          )}
        </div>
      </div>
    </motion.div>
  );
}
