import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { fetchAttendanceHistory } from '../../store/slices/attendanceSlice';
import { formatDate, formatTime, formatDuration } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';

export function EmployeeAttendance() {
  const dispatch = useDispatch();
  const { user } = useSelector((s) => s.auth);
  const { history, loading } = useSelector((s) => s.attendance);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (user?.id) dispatch(fetchAttendanceHistory({ userId: user.id, fromDate: `${from}T00:00:00`, toDate: `${to}T23:59:59` }));
  }, [dispatch, user?.id, from, to]);

  const totalMinutes = (history || []).reduce((acc, log) => acc + (log.total_minutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Attendance</h1>

      <div className="flex flex-wrap gap-4 items-center">
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1" />
        </label>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Total hours in period</p>
        <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{totalHours}h</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : !history?.length ? (
        <EmptyState title="No records" message="No attendance in this period." />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Clock In</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Clock Out</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Duration</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {history.map((log) => (
                  <tr key={log.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-2">{formatDate(log.clock_in_at)}</td>
                    <td className="px-4 py-2">{formatTime(log.clock_in_at)}</td>
                    <td className="px-4 py-2">{log.clock_out_at ? formatTime(log.clock_out_at) : '—'}</td>
                    <td className="px-4 py-2">{formatDuration(log.total_minutes)}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs ${log.status === 'late' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700'}`}>{log.status || 'present'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}
