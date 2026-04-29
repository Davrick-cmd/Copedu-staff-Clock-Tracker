import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fetchTodayAttendance, doClockIn, doClockOut } from '../../store/slices/attendanceSlice';
import { formatTime, formatDuration, formatDate, secondsUntilLate } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { RecognitionFeed } from '../../components/RecognitionFeed';
import { DashboardAnnouncements } from '../../components/DashboardAnnouncements';
import { useToast } from '../../hooks/useToast';
import * as api from '../../services/api';
import { ROUTES } from '../../utils/constants';
import { restrictLeaveDashToActiveTypes } from '../../utils/activeLeaveBalances';

const WORK_START = '09:00';
const WORK_END = '18:00';
const KIGALI_TZ = 'Africa/Kigali';

const LEAVE_BAR_COLORS = ['bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-pink-500', 'bg-violet-500'];

/** Shared surface style for dashboard cards */
const cardSurface =
  'rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white/85 dark:bg-slate-900/75 backdrop-blur-md shadow-soft dark:shadow-none';

function genderLabel(g) {
  if (!g || typeof g !== 'string') return null;
  const m = { male: 'Male', female: 'Female', other: 'Other', prefer_not_say: 'Prefer not to say' };
  return m[g.toLowerCase()] || g;
}

function initials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Renders full name with extra space between given name(s) and family name (last token). */
function ProfileDisplayName({ name }) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return <>{name || ''}</>;
  }
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(' ');
  return (
    <>
      <span className="inline-block">{rest}</span>
      <span className="inline-block ml-3 sm:ml-4">{last}</span>
    </>
  );
}

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

function clockInSuccessMessage(log) {
  const lateMinutes = Number(log?.late_minutes || 0);
  if (lateMinutes > 0) {
    return `Clock-in recorded. You checked in ${lateMinutes} min late.`;
  }
  return 'Clock-in recorded. You are on time.';
}

function clockOutSuccessMessage(log) {
  const worked = Number(log?.total_minutes || 0);
  const overtime = Number(log?.overtime_minutes || 0);
  const workedLabel = worked > 0 ? formatDuration(worked) : null;
  if (overtime > 0 && workedLabel) {
    return `Clock-out recorded. Worked ${workedLabel} today (${overtime} min overtime).`;
  }
  if (workedLabel) {
    return `Clock-out recorded. Worked ${workedLabel} today.`;
  }
  return 'Clock-out recorded successfully.';
}

export function EmployeeDashboard() {
  const dispatch = useDispatch();
  const toast = useToast();
  const { user, profile } = useSelector((s) => s.auth);
  const { todayLog, loading, error } = useSelector((s) => s.attendance);
  const userId = user?.id;
  const [workHours, setWorkHours] = useState({ work_start: WORK_START, work_end: WORK_END, timezone: KIGALI_TZ, late_threshold_minutes: 15 });
  const [kigaliTime, setKigaliTime] = useState('');
  const [leaveDash, setLeaveDash] = useState(null);
  const [colleaguesLeave, setColleaguesLeave] = useState(null);

  useEffect(() => {
    if (userId) dispatch(fetchTodayAttendance(userId));
  }, [dispatch, userId]);

  useEffect(() => {
    api.getWorkHours().then(setWorkHours).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) return;
    const load = () =>
      Promise.all([api.getLeaveMyDashboard(), api.getLeaveTypes()])
        .then(([dash, types]) => setLeaveDash(restrictLeaveDashToActiveTypes(dash, types)))
        .catch(() => setLeaveDash(null));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const load = () => api.getLeaveColleaguesOnLeave().then(setColleaguesLeave).catch(() => setColleaguesLeave(null));
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [userId]);

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
      .then((log) => {
        const lateMinutes = Number(log?.late_minutes || 0);
        toast(clockInSuccessMessage(log), lateMinutes > 0 ? 'warning' : 'success');
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
      .then((log) => toast(clockOutSuccessMessage(log), 'success'))
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

  const branchLabel = profile?.branches?.name || profile?.branches?.code || null;
  const displayName = profile?.full_name || 'there';
  const empId = profile?.employee_id;
  const staffCode = profile?.employee_code;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400">My workspace</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">Welcome back</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Your snapshot for today - leave, team, and attendance.</p>
        </div>
        <div className="inline-flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80 shadow-soft text-sm text-slate-600 dark:text-slate-300">
          <span className="text-slate-500 dark:text-slate-400">Kigali</span>
          <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">{kigaliTime || '--:--:--'}</span>
          <span className="w-px h-4 bg-slate-200 dark:bg-slate-600" aria-hidden />
          <span className="text-slate-500 dark:text-slate-400">Shift</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">
            {workStart} – {workEnd}
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200/90 dark:border-red-900/50 rounded-2xl px-4 py-3 text-red-800 dark:text-red-200 text-sm shadow-soft">
          {error}
        </div>
      )}

      {/* Clock In / Clock Out - directly under time/shift so the main daily action stays above the fold */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-500 via-primary-600 to-primary-800 dark:from-primary-600 dark:via-primary-700 dark:to-slate-900 p-6 md:p-8 text-white shadow-soft-lg ring-1 ring-white/10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-40 w-40 rounded-full bg-primary-400/20 blur-2xl" aria-hidden />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
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
                  <p className="text-amber-200 font-medium">You’re about to be late - clock in now to record your arrival.</p>
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

      {/* Today’s attendance - full width under clock; shift times stay in the header pill above */}
      <motion.div
        className={`${cardSurface} p-4 sm:p-5`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
      >
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2 sm:mb-2.5">Today’s summary</h2>
          {todayLog?.clock_in_at ? (
            <div className="space-y-2.5 text-sm max-w-lg">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Clock in</span>
                <span className="font-medium text-slate-900 dark:text-white tabular-nums">{formatTime(todayLog.clock_in_at)}</span>
              </div>
              {todayLog.clock_out_at ? (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 dark:text-slate-400">Clock out</span>
                    <span className="font-medium text-slate-900 dark:text-white tabular-nums">{formatTime(todayLog.clock_out_at)}</span>
                  </div>
                  <div className="flex justify-between gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Total time</span>
                    <span className="font-semibold text-primary-600 dark:text-primary-400 tabular-nums">{formatDuration(todayLog.total_minutes)}</span>
                  </div>
                  {todayLog.status === 'late' && (
                    <p className="text-amber-600 dark:text-amber-400 text-sm">Arrival recorded as late ({Number(todayLog.late_minutes || 0)} min)</p>
                  )}
                </>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">Currently clocked in</p>
              )}
            </div>
          ) : (
            <p className="text-slate-600 dark:text-slate-400 text-sm">No clock-in today yet.</p>
          )}
        </div>
      </motion.div>

      {/* Profile + leave + colleagues — items-start so short cards (e.g. on leave today) are not stretched to match the leave list height */}
      <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
        <motion.div
          className={`lg:col-span-5 ${cardSurface} p-6 sm:p-7 flex flex-col ring-1 ring-slate-200/50 dark:ring-slate-700/50 min-w-0`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-start gap-4 sm:gap-5">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center text-lg sm:text-xl font-bold shrink-0 shadow-lg shadow-primary-500/25">
              {initials(displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <span className="text-sm leading-none" aria-hidden>
                  👋
                </span>
                {greeting()}
              </p>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-snug break-words">
                <ProfileDisplayName name={displayName} />
              </h2>
              {(empId || staffCode) && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Employee Code</span>
                  <span className="mx-0.5">:</span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                    {staffCode != null && String(staffCode).trim() !== '' ? staffCode : empId}
                  </span>
                  {staffCode != null && String(staffCode).trim() !== '' && empId != null && String(empId).trim() !== '' && String(staffCode).trim() !== String(empId).trim() && (
                    <span className="block mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                      <span className="font-medium">Employee ID</span>
                      <span className="mx-0.5">:</span>
                      <span className="font-mono tabular-nums">{empId}</span>
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          <dl className="mt-5 border-t border-slate-100 dark:border-slate-800 pt-5 divide-y divide-slate-100 dark:divide-slate-800">
            {profile?.job_title && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    💼
                  </span>
                  Job title
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed break-words">
                  {profile.job_title}
                </dd>
              </div>
            )}
            {profile?.department && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    🏢
                  </span>
                  Department
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed break-words">
                  {profile.department}
                </dd>
              </div>
            )}
            {profile?.division && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    🗂️
                  </span>
                  Division
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed break-words">
                  {profile.division}
                </dd>
              </div>
            )}
            {branchLabel && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    📍
                  </span>
                  Location
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed break-words">
                  {branchLabel}
                </dd>
              </div>
            )}
            {genderLabel(profile?.gender) && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    👤
                  </span>
                  Gender
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed break-words">
                  {genderLabel(profile.gender)}
                </dd>
              </div>
            )}
            {profile?.phone && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    📞
                  </span>
                  Phone
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed tabular-nums break-words">
                  {profile.phone}
                </dd>
              </div>
            )}
            {profile?.supervisor_name && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    🤝
                  </span>
                  Supervisor
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed break-words">
                  {profile.supervisor_name}
                </dd>
              </div>
            )}
            {profile?.work_anniversary && (
              <div className="py-3.5 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>
                    🎉
                  </span>
                  Work anniversary
                </dt>
                <dd className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed break-words">
                  {formatDate(profile.work_anniversary)}
                </dd>
              </div>
            )}
            {!(
              profile?.department ||
              branchLabel ||
              profile?.supervisor_name ||
              profile?.job_title ||
              profile?.division ||
              profile?.work_anniversary ||
              profile?.phone ||
              genderLabel(profile?.gender)
            ) && (
              <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed flex gap-2">
                <span className="shrink-0 text-sm" aria-hidden>
                  ℹ️
                </span>
                <span>
                  HR can add your department, location, job details, and supervisor under Employee records - they will show here after your next login or refresh.
                </span>
              </p>
            )}
          </dl>
        </motion.div>

        <motion.div
          className={`lg:col-span-4 ${cardSurface} p-6 sm:p-7 flex flex-col min-w-0`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Available leave</h2>
              {leaveDash && (
                <>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Year {leaveDash.year} · Total remaining:{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
                      {Number(leaveDash.total_remaining_days ?? 0).toFixed(1)} days
                    </span>
                  </p>
                  {leaveDash.balances_effective_year_note && (
                    <p className="text-xs text-amber-800 dark:text-amber-200/90 mt-1">{leaveDash.balances_effective_year_note}</p>
                  )}
                </>
              )}
            </div>
            <Link
              to={ROUTES.EMPLOYEE.LEAVE}
              className="text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline shrink-0"
            >
              View all
            </Link>
          </div>
          {!leaveDash ? (
            <div className="flex justify-center py-8 text-slate-500 dark:text-slate-400 text-sm">Loading balances…</div>
          ) : (
            <ul className="space-y-4 max-h-[min(26rem,52vh)] overflow-y-auto overflow-x-hidden pr-1 -mr-1">
              {(leaveDash.balances || []).map((b, i) => {
                const alloc = Number(b.allocated_days ?? 0);
                const rem = Number(b.remaining_days ?? 0);
                const pct = alloc > 0 ? Math.min(100, Math.round((rem / alloc) * 1000) / 10) : 0;
                const color = LEAVE_BAR_COLORS[i % LEAVE_BAR_COLORS.length];
                return (
                  <li key={b.leave_type_id || b.leave_name}>
                    <div className="flex justify-between text-sm gap-3 mb-1 items-baseline">
                      <span className="font-medium text-slate-800 dark:text-slate-200 min-w-0 break-words pr-1">
                        {b.leave_name}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300 tabular-nums shrink-0 text-right whitespace-nowrap">
                        {rem.toFixed(1)} of {alloc.toFixed(1)} day(s)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${color}`}
                        style={{ width: `${alloc > 0 ? pct : 0}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>

        <motion.div
          className={`lg:col-span-3 ${cardSurface} p-5 sm:p-6 flex flex-col h-fit`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">On leave today</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {colleaguesLeave?.department
              ? `In your department (${colleaguesLeave.department})`
              : 'Colleagues in your department'}
          </p>
          {!colleaguesLeave ? (
            <div className="flex justify-center py-6 text-slate-500 dark:text-slate-400 text-sm">Loading…</div>
          ) : colleaguesLeave.department == null ? (
            <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-600 px-4 py-5 text-center text-sm text-slate-600 dark:text-slate-400">
              Add your department in employee records to see who else is off.
            </div>
          ) : (colleaguesLeave.rows || []).length === 0 ? (
            <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/30 border border-slate-200/90 dark:border-slate-700 px-4 py-5 text-center text-sm text-slate-600 dark:text-slate-400 flex flex-col items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-base" aria-hidden>
                ✓
              </span>
              No colleague in your department is on leave today.
            </div>
          ) : (
            <ul className="space-y-2 max-h-52 overflow-y-auto text-sm">
              {colleaguesLeave.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex justify-between gap-2 border-b border-gray-100 dark:border-gray-700 last:border-0 pb-2 last:pb-0"
                >
                  <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{r.full_name}</span>
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">{r.leave_type_name}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          to={ROUTES.EMPLOYEE.LEAVE}
          className="group flex items-center gap-3 rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/60 px-4 py-3.5 shadow-soft hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-soft-lg transition-all"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400 text-lg" aria-hidden>
            📅
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-300">Request leave</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">Book or check balances</span>
          </span>
        </Link>
        <Link
          to={ROUTES.EMPLOYEE.APPRAISAL}
          className="group flex items-center gap-3 rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/60 px-4 py-3.5 shadow-soft hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-soft-lg transition-all"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 text-lg" aria-hidden>
            📈
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-900 dark:text-white group-hover:text-violet-700 dark:group-hover:text-violet-300">Performance</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">Goals &amp; appraisals</span>
          </span>
        </Link>
        <Link
          to={ROUTES.EMPLOYEE.ATTENDANCE}
          className="group flex items-center gap-3 rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/60 px-4 py-3.5 shadow-soft hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-soft-lg transition-all"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-lg" aria-hidden>
            ⏱
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300">My attendance</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">History &amp; patterns</span>
          </span>
        </Link>
      </div>

      {leaveDash && leaveDash.approval_queue_count > 0 && (
        <motion.div
          className="rounded-2xl border-2 border-amber-400/90 dark:border-amber-500/70 bg-amber-50 dark:bg-amber-950/35 shadow-lg overflow-hidden"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="px-5 py-4 border-b border-amber-200/90 dark:border-amber-800/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-amber-950 dark:text-amber-100">
                Leave requests need your approval
              </h2>
              <p className="text-sm text-amber-900/85 dark:text-amber-200/90 mt-1 leading-relaxed">
                You are the current approver for{' '}
                <span className="font-semibold tabular-nums">{leaveDash.approval_queue_count}</span>{' '}
                {leaveDash.approval_queue_count === 1 ? 'request' : 'requests'}. If leave emails are enabled in Settings, you also get an email when a request reaches you.
              </p>
            </div>
            <Link
              to={ROUTES.HR.LEAVE}
              className="inline-flex justify-center items-center px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-md shrink-0"
            >
              Review &amp; approve
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-amber-100/90 dark:bg-amber-900/25 text-left text-xs font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-200">
                  <th className="px-5 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Leave type</th>
                  <th className="px-4 py-2.5">Dates</th>
                  <th className="px-4 py-2.5">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-200/70 dark:divide-amber-900/40">
                {(leaveDash.pending_approvals_preview || []).map((row) => (
                  <tr key={row.id} className="text-amber-950 dark:text-amber-50">
                    <td className="px-5 py-3">
                      <div className="font-medium">{row.staff_name}</div>
                      {row.staff_email && (
                        <div className="text-xs text-amber-800/75 dark:text-amber-300/75">{row.staff_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{row.leave_type_name}</td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                      {formatDate(row.start_date)} – {formatDate(row.end_date)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.days_requested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {leaveDash.approval_queue_count > (leaveDash.pending_approvals_preview || []).length && (
            <p className="px-5 py-2.5 text-xs text-amber-900 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/25 border-t border-amber-200/80 dark:border-amber-800/40">
              Showing the next {leaveDash.pending_approvals_preview.length} in queue (oldest first). Open approvals for the full list.
            </p>
          )}
        </motion.div>
      )}

      <DashboardAnnouncements />
      <RecognitionFeed />
    </motion.div>
  );
}
