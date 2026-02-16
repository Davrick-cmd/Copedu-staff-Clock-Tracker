import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '../../services/api';
import { formatDate, formatTime, formatDuration } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

const REPORT_MODE = { DAILY: 'daily', MONTHLY: 'monthly', RAW: 'raw', RECOGNITION: 'recognition' };

function escapeCsvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

export function HRReports() {
  const toast = useToast();
  const [reportMode, setReportMode] = useState(REPORT_MODE.DAILY);
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [monthYear, setMonthYear] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [dailySummary, setDailySummary] = useState(null);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState('');
  const [reportType, setReportType] = useState('all');
  const [modal, setModal] = useState(null);
  const [recognitionReport, setRecognitionReport] = useState(null);

  useEffect(() => {
    api.getBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.RECOGNITION) return;
    setLoading(true);
    api.getRecognitionReport().then(setRecognitionReport).catch(() => setRecognitionReport(null)).finally(() => setLoading(false));
  }, [reportMode]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.DAILY) return;
    setLoading(true);
    api.getDailyReportSummary(dailyDate, branchId || null)
      .then(setDailySummary)
      .catch(() => setDailySummary(null))
      .finally(() => setLoading(false));
  }, [reportMode, dailyDate, branchId]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.MONTHLY) return;
    setLoading(true);
    api.getMonthlyReportSummary(monthYear.year, monthYear.month, branchId || null)
      .then(setMonthlySummary)
      .catch(() => setMonthlySummary(null))
      .finally(() => setLoading(false));
  }, [reportMode, monthYear.year, monthYear.month, branchId]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.RAW) return;
    setLoading(true);
    const filters = { fromDate: `${fromDate}T00:00:00`, toDate: `${toDate}T23:59:59` };
    if (branchId) filters.branchId = branchId;
    if (reportType === 'late') {
      api.getLateReport(filters).then(setLogs).catch(() => setLogs([])).finally(() => setLoading(false));
    } else {
      api.getAllAttendance(filters).then(setLogs).catch(() => setLogs([])).finally(() => setLoading(false));
    }
  }, [reportMode, fromDate, toDate, branchId, reportType]);

  const exportCSV = () => {
    const headers = ['Date', 'Employee', 'Email', 'Clock In', 'Clock Out', 'Minutes', 'Status', 'IP'];
    const rows = logs.map((l) => [
      formatDate(l.clock_in_at),
      l.users?.full_name || '',
      l.users?.email || '',
      formatTime(l.clock_in_at),
      l.clock_out_at ? formatTime(l.clock_out_at) : '',
      l.total_minutes ?? '',
      l.status || 'present',
      l.client_ip || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => escapeCsvCell(c)).join(','))].join('\n');
    downloadCsv(`attendance-${fromDate}-${toDate}.csv`, csv);
    toast('Report downloaded', 'success');
  };

  const exportDailyReport = () => {
    if (!dailySummary) return;
    const sum = dailySummary.summary || {};
    const lines = [
      `Daily Attendance Report,${escapeCsvCell(dailySummary.date)}`,
      'Summary',
      'Total employees,Present count,Present %,Absent count,Absent %,Late count,Late %',
      [sum.total_employees ?? dailySummary.total_staff, sum.present_count ?? dailySummary.present, sum.present_pct ?? dailySummary.pct_present, sum.absent_count ?? dailySummary.absent, sum.absent_pct ?? dailySummary.pct_absent, sum.late_count ?? dailySummary.late, sum.late_pct ?? dailySummary.pct_late].map(escapeCsvCell).join(','),
      '',
      'Daily table',
      'Employee name,Department,Check-in,Check-out,Status,Late minutes',
      ...(dailySummary.daily_table || []).map((r) => [
        r.employee_name ?? '',
        r.department ?? '',
        r.check_in ?? '',
        r.check_out ?? '',
        r.status ?? '',
        r.late_minutes ?? 0,
      ].map(escapeCsvCell).join(',')),
    ];
    downloadCsv(`daily-report-${dailySummary.date}.csv`, lines.join('\n'));
    toast('Report exported to Excel', 'success');
  };

  const printReportSafe = () => {
    window.print();
  };

  const exportMonthlyReport = () => {
    if (!monthlySummary) return;
    const ex = monthlySummary.executive_summary || {};
    const lines = [
      `Monthly Attendance Report,${monthlySummary.year}-${String(monthlySummary.month).padStart(2, '0')}`,
      'Executive summary',
      'Overall attendance %,Overall absence %,Overall late %,Trend attendance,Trend absence,Trend late',
      [ex.overall_attendance_pct, ex.overall_absence_pct, ex.overall_late_pct, ex.trend_attendance, ex.trend_absence, ex.trend_late].map(escapeCsvCell).join(','),
      '',
      'Department summary',
      'Department,Employee count,Avg attendance %,Absence %,Late %',
      ...(monthlySummary.department_summary || []).map((r) => [
        r.department, r.employee_count, r.avg_attendance_pct, r.absence_pct, r.late_pct,
      ].map(escapeCsvCell).join(',')),
      '',
      'Employee summary',
      'Employee name,Department,Work days,Present days,Absent days,Late days,Attendance %,Late %',
      ...(monthlySummary.staff_monthly || []).map((r) => [
        r.employee_name ?? r.full_name ?? '',
        r.department ?? '',
        r.work_days ?? 0,
        r.present_days ?? 0,
        r.days_absent ?? 0,
        r.days_late ?? 0,
        r.attendance_pct ?? 0,
        r.pct_late ?? 0,
      ].map(escapeCsvCell).join(',')),
      '',
      'By day',
      'Date,Total staff,Present,Absent,Late,On time,No clock-out,Pct late %,Pct on time %,Pct absent %,Pct no clock-out %',
      ...(monthlySummary.days || []).map((d) => [
        d.date, d.total_staff, d.present, d.absent, d.late, d.on_time, d.no_clock_out,
        d.pct_late, d.pct_on_time, d.pct_absent, d.pct_no_clock_out ?? '',
      ].map(escapeCsvCell).join(',')),
    ];
    downloadCsv(`monthly-report-${monthlySummary.year}-${String(monthlySummary.month).padStart(2, '0')}.csv`, lines.join('\n'));
    toast('Report exported to Excel', 'success');
  };

  const byDate = logs.reduce((acc, l) => {
    const d = (l.clock_in_at || '').slice(0, 10);
    if (!d) return acc;
    acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});
  const chartData = Object.entries(byDate).map(([date, count]) => ({ date: date.slice(5), count })).sort((a, b) => a.date.localeCompare(b.date));

  const openUserModal = (key, title, list) => {
    if (list?.length) setModal({ title, list });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>

      <div className="flex flex-wrap gap-4 items-center">
        <select value={reportMode} onChange={(e) => setReportMode(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white font-medium">
          <option value={REPORT_MODE.DAILY}>Daily report</option>
          <option value={REPORT_MODE.MONTHLY}>Monthly report</option>
          <option value={REPORT_MODE.RAW}>Raw attendance (date range)</option>
          <option value={REPORT_MODE.RECOGNITION}>Recognition report</option>
        </select>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        {reportMode === REPORT_MODE.DAILY && (
          <>
            <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white" />
            <button type="button" onClick={exportDailyReport} disabled={!dailySummary} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">Export to Excel</button>
            <button type="button" onClick={printReportSafe} disabled={!dailySummary} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50">Print / PDF</button>
          </>
        )}
        {reportMode === REPORT_MODE.MONTHLY && (
          <>
            <input type="number" min="2020" max="2030" value={monthYear.year} onChange={(e) => setMonthYear((p) => ({ ...p, year: Number(e.target.value) }))} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 w-24 text-gray-900 dark:text-white" />
            <select value={monthYear.month} onChange={(e) => setMonthYear((p) => ({ ...p, month: Number(e.target.value) }))} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}</option>
              ))}
            </select>
            <button type="button" onClick={exportMonthlyReport} disabled={!monthlySummary} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">Export to Excel</button>
            <button type="button" onClick={printReportSafe} disabled={!monthlySummary} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50">Print / PDF</button>
          </>
        )}
        {reportMode === REPORT_MODE.RAW && (
          <>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white" />
            <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white">
              <option value="all">All attendance</option>
              <option value="late">Late only</option>
            </select>
            <button type="button" onClick={exportCSV} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Export CSV</button>
          </>
        )}
      </div>

      {modal && <UserListModal title={modal.title} users={modal.list} onClose={() => setModal(null)} />}

      {/* Daily report */}
      {reportMode === REPORT_MODE.DAILY && (
        <>
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !dailySummary ? (
            <EmptyState title="No data" message="Could not load daily summary." />
          ) : (
            <div className="space-y-6" id="daily-report-content">
              {/* Summary section (top) */}
              <h2 className="font-semibold text-gray-800 dark:text-white">Summary</h2>
              <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-4">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase">Total employees</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-white">{dailySummary.summary?.total_employees ?? dailySummary.total_staff ?? 0}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-4" onClick={() => openUserModal('on_time', 'On time', dailySummary.users?.on_time)}>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase">Present</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{dailySummary.summary?.present_count ?? dailySummary.present ?? 0}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{dailySummary.summary?.present_pct ?? dailySummary.pct_present ?? 0}% attendance</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-4" onClick={() => openUserModal('absent', 'Absent', dailySummary.users?.absent)}>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase">Absent</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{dailySummary.summary?.absent_count ?? dailySummary.absent ?? 0}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{dailySummary.summary?.absent_pct ?? dailySummary.pct_absent ?? 0}% absence</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-4" onClick={() => openUserModal('late', 'Late', dailySummary.users?.late)}>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase">Late</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{dailySummary.summary?.late_count ?? dailySummary.late ?? 0}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{dailySummary.summary?.late_pct ?? dailySummary.pct_late ?? 0}% late</p>
                </div>
              </div>
              {/* Daily table: Employee Name, Department, Check-In, Check-Out, Status, Late Minutes */}
              <h2 className="font-semibold text-gray-800 dark:text-white">Daily attendance</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Employee name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Department</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Check-in</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Check-out</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Late (min)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(dailySummary.daily_table || []).map((row, i) => (
                      <tr key={i} className="text-gray-700 dark:text-gray-300 text-sm">
                        <td className="px-4 py-2 font-medium">{row.employee_name || '—'}</td>
                        <td className="px-4 py-2">{row.department || '—'}</td>
                        <td className="px-4 py-2">{row.check_in ?? '—'}</td>
                        <td className="px-4 py-2">{row.check_out ?? '—'}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            row.status === 'Absent' ? 'bg-red-100 dark:bg-red-900/30' :
                            row.status === 'Late' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-green-100 dark:bg-green-900/30'
                          }`}>{row.status || 'Present'}</span>
                        </td>
                        <td className="px-4 py-2 text-right">{row.late_minutes ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Monthly report */}
      {reportMode === REPORT_MODE.MONTHLY && (
        <>
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !monthlySummary ? (
            <EmptyState title="No data" message="Could not load monthly summary." />
          ) : (
            <div className="space-y-6" id="monthly-report-content">
              {/* Brief overview line */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span>Overall attendance: <strong className="text-green-600 dark:text-green-400">{monthlySummary.executive_summary?.overall_attendance_pct ?? 0}%</strong> {monthlySummary.executive_summary?.trend_attendance && `(${monthlySummary.executive_summary.trend_attendance} vs last month)`}</span>
                <span>Absence: <strong className="text-red-600 dark:text-red-400">{monthlySummary.executive_summary?.overall_absence_pct ?? 0}%</strong></span>
                <span>Late: <strong className="text-amber-600 dark:text-amber-400">{monthlySummary.executive_summary?.overall_late_pct ?? 0}%</strong></span>
              </div>
              {/* Main content: Summary of each staff */}
              <h2 className="font-semibold text-gray-800 dark:text-white">Summary of each staff</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">One row per employee for the selected month. Attendance % = (Present days ÷ Work days) × 100. Late % = (Late days ÷ Work days) × 100.</p>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Employee name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Department</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Work days</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Present days</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Absent days</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Late days</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Attendance %</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Late %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(monthlySummary.staff_monthly || []).map((row, i) => (
                      <tr key={row.user_id || i} className="text-gray-700 dark:text-gray-300 text-sm">
                        <td className="px-4 py-2 font-medium">{row.employee_name || row.full_name || '—'}</td>
                        <td className="px-4 py-2">{row.department || '—'}</td>
                        <td className="px-4 py-2 text-right">{row.work_days ?? 0}</td>
                        <td className="px-4 py-2 text-right">{row.present_days ?? 0}</td>
                        <td className="px-4 py-2 text-right">{row.days_absent ?? 0}</td>
                        <td className="px-4 py-2 text-right">{row.days_late ?? 0}</td>
                        <td className="px-4 py-2 text-right text-green-600 dark:text-green-400">{row.attendance_pct ?? 0}%</td>
                        <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">{row.pct_late ?? 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2 className="font-semibold text-gray-800 dark:text-white mt-6">By department</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Department</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Employees</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Avg attendance %</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Absence %</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Late %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(monthlySummary.department_summary || []).map((row, i) => (
                      <tr key={i} className="text-gray-700 dark:text-gray-300 text-sm">
                        <td className="px-4 py-2 font-medium">{row.department || '—'}</td>
                        <td className="px-4 py-2 text-right">{row.employee_count ?? 0}</td>
                        <td className="px-4 py-2 text-right text-green-600 dark:text-green-400">{row.avg_attendance_pct ?? 0}%</td>
                        <td className="px-4 py-2 text-right text-red-600 dark:text-red-400">{row.absence_pct ?? 0}%</td>
                        <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">{row.late_pct ?? 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2 className="font-semibold text-gray-800 dark:text-white mt-6">Aggregate (whole month)</h2>
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
                <SummaryCard label="Staff absent (any day)" value={monthlySummary.aggregate?.unique_absent?.length ?? 0} onClick={() => openUserModal('absent', 'Absent at least one day', monthlySummary.aggregate?.unique_absent)} list={monthlySummary.aggregate?.unique_absent} />
                <SummaryCard label="Staff late (any day)" value={monthlySummary.aggregate?.unique_late?.length ?? 0} onClick={() => openUserModal('late', 'Late at least one day', monthlySummary.aggregate?.unique_late)} list={monthlySummary.aggregate?.unique_late} />
                <SummaryCard label="No clock-out (any day)" value={monthlySummary.aggregate?.unique_no_clock_out?.length ?? 0} onClick={() => openUserModal('no_clock_out', 'No clock-out at least one day', monthlySummary.aggregate?.unique_no_clock_out)} list={monthlySummary.aggregate?.unique_no_clock_out} />
              </div>
              <h2 className="font-semibold text-gray-800 dark:text-white mt-6">By day</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Total</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Present</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Late %</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">On time %</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Absent</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">No out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(monthlySummary.days || []).map((d) => (
                      <tr key={d.date} className="text-gray-700 dark:text-gray-300 text-sm">
                        <td className="px-3 py-2 font-medium">{d.date}</td>
                        <td className="px-3 py-2 text-right">{d.total_staff}</td>
                        <td className="px-3 py-2 text-right">{d.present}</td>
                        <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">{d.pct_late}%</td>
                        <td className="px-3 py-2 text-right text-green-600 dark:text-green-400">{d.pct_on_time}%</td>
                        <td className="px-3 py-2 text-right">{d.absent}</td>
                        <td className="px-3 py-2 text-right">{d.no_clock_out}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Raw attendance */}
      {reportMode === REPORT_MODE.RAW && (
        <>
          {chartData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
              <h2 className="font-semibold text-gray-800 dark:text-white mb-4">Attendance by day</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <XAxis dataKey="date" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !logs.length ? (
            <EmptyState title="No records" message="No attendance in the selected period." />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">In</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Out</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Duration</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {logs.map((log) => (
                      <tr key={log.id} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2">{formatDate(log.clock_in_at)}</td>
                        <td className="px-4 py-2">{log.users?.full_name || '—'}</td>
                        <td className="px-4 py-2">{formatTime(log.clock_in_at)}</td>
                        <td className="px-4 py-2">{log.clock_out_at ? formatTime(log.clock_out_at) : '—'}</td>
                        <td className="px-4 py-2">{formatDuration(log.total_minutes)}</td>
                        <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs ${log.status === 'late' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>{log.status || 'present'}</span></td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{log.client_ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Recognition report */}
      {reportMode === REPORT_MODE.RECOGNITION && (
        <>
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !recognitionReport ? (
            <EmptyState title="No data" message="Could not load recognition report." />
          ) : (
            <div className="space-y-6">
              <h2 className="font-semibold text-gray-800 dark:text-white">Recognition summary</h2>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-4">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase">Total recognitions</p>
                  <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{recognitionReport.total_count ?? 0}</p>
                </div>
              </div>
              <h2 className="font-semibold text-gray-800 dark:text-white mt-6">By type</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Type</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(recognitionReport.by_type || []).map((row, i) => (
                      <tr key={i} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2 font-medium">{row.recognition_type || '—'}</td>
                        <td className="px-4 py-2 text-right">{row.count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2 className="font-semibold text-gray-800 dark:text-white mt-6">Recent recognitions</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">From</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Type</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Message</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Likes</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Comments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(recognitionReport.recent || []).map((r) => (
                      <tr key={r.id} className="text-gray-700 dark:text-gray-300 text-sm">
                        <td className="px-4 py-2">{formatDateTime(r.created_at)}</td>
                        <td className="px-4 py-2 font-medium">{r.from_name || '—'}</td>
                        <td className="px-4 py-2">{r.recognition_type || '—'}</td>
                        <td className="px-4 py-2 max-w-xs truncate">{r.message || '—'}</td>
                        <td className="px-4 py-2 text-right">{r.like_count ?? 0}</td>
                        <td className="px-4 py-2 text-right">{r.comment_count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

function SummaryCard({ label, value, sub, color = 'text-gray-900 dark:text-white', onClick, list }) {
  const hasList = list?.length > 0;
  const clickable = hasList && onClick;
  return (
    <motion.div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-4 ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-primary-400' : ''}`}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      onClick={clickable ? () => onClick() : undefined}
    >
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
      {clickable && <p className="text-xs text-primary-600 dark:text-primary-400 mt-1">View list →</p>}
    </motion.div>
  );
}
