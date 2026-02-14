import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { fetchTodayAttendance, doClockIn, doClockOut } from '../../store/slices/attendanceSlice';
import { formatTime, formatDuration, secondsUntilLate } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../hooks/useToast';
import * as api from '../../services/api';

const WORK_START = '09:00';
const WORK_END = '18:00';
const KIGALI_TZ = 'Africa/Kigali';

function Countdown({ workStart, threshold, onTick }) {
  const [secs, setSecs] = useState(() => secondsUntilLate(workStart, threshold));
  useEffect(() => {
    const t = setInterval(() => {
      const s = secondsUntilLate(workStart, threshold);
      setSecs(s);
      onTick?.(s);
    }, 1000);
    return () => clearInterval(t);
  }, [workStart, threshold, onTick]);
  if (secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return (
    <span className="font-mono text-lg">
      {m}:{s.toString().padStart(2, '0')}
    </span>
  );
}

export function EmployeeDashboard() {
  const dispatch = useDispatch();
  const toast = useToast();
  const { user, profile } = useSelector((s) => s.auth);
  const { todayLog, loading, error } = useSelector((s) => s.attendance);
  const userId = user?.id;
  const [workHours, setWorkHours] = useState({ work_start: WORK_START, work_end: WORK_END, timezone: KIGALI_TZ, late_threshold_minutes: 15 });
  const [kigaliTime, setKigaliTime] = useState('');

  useEffect(() => {
    if (userId) dispatch(fetchTodayAttendance(userId));
  }, [dispatch, userId]);

  useEffect(() => {
    api.getWorkHours().then(setWorkHours).catch(() => {});
  }, []);

  useEffect(() => {
    const tick = () => setKigaliTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: KIGALI_TZ }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const canClockIn = !todayLog?.clock_in_at || todayLog?.clock_out_at;
  const canClockOut = todayLog?.clock_in_at && !todayLog?.clock_out_at;
  const hasClockedOutToday = todayLog?.clock_out_at;
  const lateThreshold = workHours.late_threshold_minutes ?? 15;
  const workStart = workHours.work_start || WORK_START;
  const workEnd = workHours.work_end || WORK_END;
  const secsUntilLate = secondsUntilLate(workStart, lateThreshold);
  const isPastLateCutoff = secsUntilLate <= 0;
  const isBeforeWorkStart = () => {
    const [h, m] = workStart.split(':').map(Number);
    const now = new Date();
    const kigali = new Date(now.toLocaleString('en-US', { timeZone: KIGALI_TZ }));
    const nowMins = kigali.getHours() * 60 + kigali.getMinutes();
    const startMins = h * 60 + (m || 0);
    return nowMins < startMins;
  };

  const handleClockIn = () => {
    dispatch(doClockIn({ userId, branchId: profile?.branch_id }))
      .unwrap()
      .then(() => {
        toast(isPastLateCutoff ? 'Clocked in (marked late)' : 'Clocked in successfully', isPastLateCutoff ? 'warning' : 'success');
      })
      .catch((e) => toast(e?.response?.data?.detail || e?.message || 'Clock-in failed', 'error'));
  };

  const handleClockOut = () => {
    const logId = todayLog?.id;
    if (!logId) {
      toast('No active clock-in. Refresh the page.', 'error');
      return;
    }
    dispatch(doClockOut({ logId }))
      .unwrap()
      .then(() => toast('Clocked out successfully', 'success'))
      .catch((e) => {
        const msg = e?.response?.data?.detail ?? e?.message ?? e;
        const text = typeof msg === 'string' ? msg : 'Clock-out failed. Try again or refresh.';
        toast(text, 'error');
      });
  };

  if (loading && !todayLog) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const greeting = () => {
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: KIGALI_TZ })).getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
            {greeting()}, {profile?.full_name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Kigali time: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{kigaliTime || '--:--:--'}</span>
          </p>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg">
          Official hours: <span className="font-medium text-gray-700 dark:text-gray-300">{workStart}</span> – <span className="font-medium text-gray-700 dark:text-gray-300">{workEnd}</span> (Kigali)
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Clock In / Clock Out hero card */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-700 dark:from-primary-600 dark:to-primary-800 rounded-2xl shadow-xl p-6 md:p-8 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            {canClockIn && (
              <>
                <h2 className="text-xl font-semibold">Ready to start your day?</h2>
                {isBeforeWorkStart() ? (
                  <p className="text-primary-100">Your shift starts at {workStart}. You can clock in when you arrive.</p>
                ) : !isPastLateCutoff ? (
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-primary-100">Clock in before {(() => {
                      const [h, m] = workStart.split(':').map(Number);
                      const totalM = (h || 0) * 60 + (m || 0) + lateThreshold;
                      const lh = Math.floor(totalM / 60);
                      const lm = totalM % 60;
                      return `${String(lh).padStart(2, '0')}:${String(lm).padStart(2, '0')}`;
                    })()} (Kigali) to avoid being marked late.</p>
                    <p className="text-primary-100">Time left: <Countdown workStart={workStart} threshold={lateThreshold} /> (min:sec)</p>
                  </div>
                ) : (
                  <p className="text-amber-200 font-medium">You’re about to be late — clock in now to record your arrival.</p>
                )}
              </>
            )}
            {canClockOut && (
              <>
                <h2 className="text-xl font-semibold">You’re clocked in</h2>
                <p className="text-primary-100">When you’re done for the day, clock out below.</p>
              </>
            )}
            {hasClockedOutToday && (
              <>
                <h2 className="text-xl font-semibold">Well done today!</h2>
                <p className="text-primary-100">It’s time to go recharge. See you next shift.</p>
              </>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 min-w-[200px]">
            {canClockIn && (
              <motion.button
                type="button"
                onClick={handleClockIn}
                disabled={loading}
                className="px-8 py-4 bg-white text-primary-700 font-semibold rounded-xl shadow-lg hover:bg-primary-50 disabled:opacity-50 transition"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? '...' : 'Clock In'}
              </motion.button>
            )}
            {canClockOut && (
              <motion.button
                type="button"
                onClick={handleClockOut}
                disabled={loading}
                className="px-8 py-4 bg-amber-400 text-amber-900 font-semibold rounded-xl shadow-lg hover:bg-amber-300 disabled:opacity-50 transition"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? '...' : 'Clock Out'}
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* Today's summary card */}
      <div className="grid gap-4 md:grid-cols-2">
        <motion.div
          className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Today’s summary</h2>
          {todayLog?.clock_in_at ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Clock in</span>
                <span className="font-medium text-gray-900 dark:text-white">{formatTime(todayLog.clock_in_at)}</span>
              </div>
              {todayLog.clock_out_at ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Clock out</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatTime(todayLog.clock_out_at)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500 dark:text-gray-400">Total time</span>
                    <span className="font-semibold text-primary-600 dark:text-primary-400">{formatDuration(todayLog.total_minutes)}</span>
                  </div>
                  {todayLog.status === 'late' && (
                    <p className="text-amber-600 dark:text-amber-400 text-sm">Marked as late arrival</p>
                  )}
                </>
              ) : (
                <p className="text-green-600 dark:text-green-400 text-sm font-medium">Currently clocked in</p>
              )}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No clock-in today yet.</p>
          )}
        </motion.div>

        <motion.div
          className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Quick info</h2>
          <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li>• Shift: {workStart} – {workEnd} (Kigali time)</li>
            <li>• Late after: {workStart} + {lateThreshold} min</li>
            <li>• View full history in <strong>My Attendance</strong></li>
          </ul>
        </motion.div>
      </div>
    </motion.div>
  );
}
