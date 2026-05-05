import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '../../services/api';
import { formatDate, formatDateTime, formatTime, formatDuration } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { DashboardPageHeader } from '../../components/dashboard/DashboardWidgets';
import { OrganizationOverview } from '../../components/dashboard/OrganizationOverview';
import { ROUTES } from '../../utils/constants';
import { downloadOrganizationDemographicsCsv } from '../../utils/organizationDemographicsCsv';
import * as XLSX from 'xlsx';

const REPORT_MODE = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
  RAW: 'raw',
  RECOGNITION: 'recognition',
  LEAVE: 'leave',
  PERFORMANCE: 'performance',
  /** Workforce demographics (organization-wide report view). */
  ORG_REPORT: 'org_report',
};

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

/** @param {{ name: string, aoa?: unknown[][], json?: Record<string, unknown>[] }[]} sheets */
function downloadXlsx(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((sh) => {
    const safeName = (sh.name || 'Sheet').slice(0, 31);
    let ws;
    if (sh.aoa && sh.aoa.length) ws = XLSX.utils.aoa_to_sheet(sh.aoa);
    else if (sh.json && sh.json.length) ws = XLSX.utils.json_to_sheet(sh.json);
    else ws = XLSX.utils.aoa_to_sheet([['(No rows)']]);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });
  XLSX.writeFile(wb, filename);
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
                    <span className="font-medium">{u.full_name || '-'}</span>
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

function initialReportModeForScope(reportScope) {
  if (reportScope === 'leave') return REPORT_MODE.LEAVE;
  if (reportScope === 'recognition') return REPORT_MODE.RECOGNITION;
  if (reportScope === 'performance') return REPORT_MODE.PERFORMANCE;
  if (reportScope === 'organization') return REPORT_MODE.ORG_REPORT;
  return REPORT_MODE.DAILY;
}

/** @param {{ reportScope?: 'all' | 'attendance' | 'leave' | 'recognition' | 'performance' | 'organization' }} props */
export function HRReports({ reportScope = 'all' }) {
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [reportMode, setReportMode] = useState(() => initialReportModeForScope(reportScope));
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
  const [attendanceDepartment, setAttendanceDepartment] = useState('');
  const [attendanceUserId, setAttendanceUserId] = useState('');
  /** Daily table + CSV/XLSX: all | present | late | absent (matches row.status from API). */
  const [dailyTableFilter, setDailyTableFilter] = useState('all');
  const [rawDepartmentOptions, setRawDepartmentOptions] = useState([]);
  const [rawEmployeeOptions, setRawEmployeeOptions] = useState([]);
  const [rawEmployeeSearch, setRawEmployeeSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [recognitionReport, setRecognitionReport] = useState(null);
  const [recognitionReportSection, setRecognitionReportSection] = useState('recent');
  const [recognitionExportType, setRecognitionExportType] = useState('csv');
  const [performanceReport, setPerformanceReport] = useState(null);
  const [performanceReportSection, setPerformanceReportSection] = useState('kpi_status');
  const [performanceExportType, setPerformanceExportType] = useState('xlsx');
  const [performanceCycleId, setPerformanceCycleId] = useState('');
  const [leaveReport, setLeaveReport] = useState(null);
  const [leaveReportSection, setLeaveReportSection] = useState('balances');
  const [leaveExportType, setLeaveExportType] = useState('excel');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('');
  const [leaveAsOf, setLeaveAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [leaveBalanceYear, setLeaveBalanceYear] = useState(() => parseInt(new Date().toISOString().slice(0, 4), 10));
  const [leaveDeptFilter, setLeaveDeptFilter] = useState('');
  const [leaveDepartments, setLeaveDepartments] = useState([]);
  const [organizationOverview, setOrganizationOverview] = useState(null);
  const [organizationOverviewLoading, setOrganizationOverviewLoading] = useState(false);
  const [orgFetchKey, setOrgFetchKey] = useState(0);

  useEffect(() => {
    api.getBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.ORG_REPORT) return;
    setOrganizationOverviewLoading(true);
    api
      .getOrganizationOverview()
      .then(setOrganizationOverview)
      .catch(() => setOrganizationOverview(null))
      .finally(() => setOrganizationOverviewLoading(false));
  }, [reportMode, orgFetchKey]);

  useEffect(() => {
    setReportMode(initialReportModeForScope(reportScope));
  }, [reportScope]);

  useEffect(() => {
    const t = (searchParams.get('type') || '').toLowerCase();
    if (!t) return;
    if (reportScope === 'attendance') {
      setReportMode(REPORT_MODE.RAW);
      if (t === 'late') setReportType('late');
      else if (t === 'overtime') setReportType('overtime');
      else setReportType('all');
    } else if (reportScope === 'leave') {
      setReportMode(REPORT_MODE.LEAVE);
      if (t === 'department') setLeaveReportSection('department');
      else if (t === 'trends') setLeaveReportSection('activity');
    }
  }, [reportScope, searchParams]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.LEAVE) return;
    api.getLeaveHrFilters().then((d) => setLeaveDepartments(d.departments || [])).catch(() => setLeaveDepartments([]));
  }, [reportMode]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.RAW) return;
    api.getDepartmentOptions().then(setRawDepartmentOptions).catch(() => setRawDepartmentOptions([]));
    api
      .getUsers()
      .then((users) => {
        const staff = (users || []).filter((u) => (u.role || '').toLowerCase() === 'employee');
        staff.sort((a, b) =>
          String(a.full_name || '').localeCompare(String(b.full_name || ''), undefined, { sensitivity: 'base' }),
        );
        setRawEmployeeOptions(staff);
      })
      .catch(() => setRawEmployeeOptions([]));
  }, [reportMode]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.RECOGNITION) return;
    setLoading(true);
    api
      .getRecognitionReport({ fromDate, toDate, limit: 200 })
      .then(setRecognitionReport)
      .catch(() => setRecognitionReport(null))
      .finally(() => setLoading(false));
  }, [reportMode, fromDate, toDate]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.PERFORMANCE) return;
    setLoading(true);
    const params = {};
    if (performanceCycleId.trim()) params.cycle_id = performanceCycleId.trim();
    params.from_date = fromDate;
    params.to_date = toDate;
    api
      .getAppraisalPerformanceReport(params)
      .then(setPerformanceReport)
      .catch(() => setPerformanceReport(null))
      .finally(() => setLoading(false));
  }, [reportMode, performanceCycleId, fromDate, toDate]);

  useEffect(() => {
    if (reportMode !== REPORT_MODE.LEAVE) return;
    setLoading(true);
    const params = {
      from_date: fromDate,
      to_date: toDate,
      as_of: leaveAsOf,
      balance_year: leaveBalanceYear,
      ...(leaveDeptFilter.trim() ? { department: leaveDeptFilter.trim() } : {}),
    };
    api
      .getLeaveReportSummary(params)
      .then(setLeaveReport)
      .catch(() => setLeaveReport(null))
      .finally(() => setLoading(false));
  }, [reportMode, fromDate, toDate, leaveAsOf, leaveBalanceYear, leaveDeptFilter]);

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
    if (attendanceDepartment.trim()) filters.department = attendanceDepartment.trim();
    if (attendanceUserId.trim()) filters.userId = attendanceUserId.trim();
    if (reportType === 'late') {
      api.getLateReport(filters).then(setLogs).catch(() => setLogs([])).finally(() => setLoading(false));
    } else if (reportType === 'overtime') {
      api.getOvertimeReport({ ...filters, minMinutes: 1 }).then(setLogs).catch(() => setLogs([])).finally(() => setLoading(false));
    } else {
      api.getAllAttendance(filters).then(setLogs).catch(() => setLogs([])).finally(() => setLoading(false));
    }
  }, [reportMode, fromDate, toDate, branchId, reportType, attendanceDepartment, attendanceUserId]);

  const displayedRawLogs = useMemo(() => {
    const q = rawEmployeeSearch.trim().toLowerCase();
    if (!q) return logs;
    return (logs || []).filter((l) => {
      const name = l.users?.full_name || '';
      const email = l.users?.email || '';
      const department = l.users?.department || '';
      const uid = l.user_id || '';
      return (
        String(name).toLowerCase().includes(q) ||
        String(email).toLowerCase().includes(q) ||
        String(department).toLowerCase().includes(q) ||
        String(uid).toLowerCase().includes(q)
      );
    });
  }, [logs, rawEmployeeSearch]);

  const exportCSV = () => {
    const headers = ['Date', 'Employee', 'Email', 'Department', 'Clock In', 'Clock Out', 'Minutes', 'Late (min)', 'Overtime (min)', 'Status', 'IP'];
    const rows = displayedRawLogs.map((l) => [
      formatDate(l.clock_in_at),
      l.users?.full_name || '',
      l.users?.email || '',
      l.users?.department || '',
      formatTime(l.clock_in_at),
      l.clock_out_at ? formatTime(l.clock_out_at) : '',
      l.total_minutes ?? '',
      l.late_minutes ?? 0,
      l.overtime_minutes ?? 0,
      l.status || 'present',
      l.client_ip || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => escapeCsvCell(c)).join(','))].join('\n');
    downloadCsv(`attendance-${fromDate}-${toDate}.csv`, csv);
    toast('Report downloaded', 'success');
  };

  const exportRawAttendanceXlsx = () => {
    const json = displayedRawLogs.map((l) => ({
      date: formatDate(l.clock_in_at),
      employee: l.users?.full_name || '',
      email: l.users?.email || '',
      department: l.users?.department || '',
      clock_in: formatTime(l.clock_in_at),
      clock_out: l.clock_out_at ? formatTime(l.clock_out_at) : '',
      minutes: l.total_minutes ?? '',
      late_minutes: l.late_minutes ?? 0,
      overtime_minutes: l.overtime_minutes ?? 0,
      status: l.status || 'present',
      ip: l.client_ip || '',
    }));
    downloadXlsx(`attendance-${fromDate}-${toDate}.xlsx`, [{ name: 'Attendance', json }]);
    toast('Attendance XLSX downloaded', 'success');
  };

  const filteredDailyTable = useMemo(() => {
    const rows = dailySummary?.daily_table || [];
    if (dailyTableFilter === 'all') return rows;
    return rows.filter((r) => {
      const s = String(r.status || '').toLowerCase();
      if (dailyTableFilter === 'absent') return s === 'absent';
      if (dailyTableFilter === 'late') return s === 'late';
      if (dailyTableFilter === 'present') return s === 'present';
      return true;
    });
  }, [dailySummary?.daily_table, dailyTableFilter]);

  const exportDailyReportCsv = () => {
    if (!dailySummary) return;
    const sum = dailySummary.summary || {};
    const filterNote =
      dailyTableFilter !== 'all'
        ? [`Table filter (rows below),${escapeCsvCell(dailyTableFilter)}`, '']
        : [];
    const lines = [
      `Daily Attendance Report,${escapeCsvCell(dailySummary.date)}`,
      ...filterNote,
      'Summary',
      'Total employees,Present count,Present %,Absent count,Absent %,Late count,Late %',
      [sum.total_employees ?? dailySummary.total_staff, sum.present_count ?? dailySummary.present, sum.present_pct ?? dailySummary.pct_present, sum.absent_count ?? dailySummary.absent, sum.absent_pct ?? dailySummary.pct_absent, sum.late_count ?? dailySummary.late, sum.late_pct ?? dailySummary.pct_late].map(escapeCsvCell).join(','),
      '',
      'Daily table',
      'Employee name,Department,Check-in,Check-out,Status,Late minutes',
      ...filteredDailyTable.map((r) => [
        r.employee_name ?? '',
        r.department ?? '',
        r.check_in ?? '',
        r.check_out ?? '',
        r.status ?? '',
        r.late_minutes ?? 0,
      ].map(escapeCsvCell).join(',')),
    ];
    downloadCsv(`daily-report-${dailySummary.date}.csv`, lines.join('\n'));
    toast('Daily report CSV downloaded', 'success');
  };

  const exportDailyReportXlsx = () => {
    if (!dailySummary) return;
    const sum = dailySummary.summary || {};
    const summaryAoa = [
      ['Daily attendance report', dailySummary.date],
      ...(dailyTableFilter !== 'all' ? [['Table filter (rows sheet)', dailyTableFilter]] : []),
      [],
      ['Total employees', 'Present', 'Present %', 'Absent', 'Absent %', 'Late', 'Late %'],
      [
        sum.total_employees ?? dailySummary.total_staff,
        sum.present_count ?? dailySummary.present,
        sum.present_pct ?? dailySummary.pct_present,
        sum.absent_count ?? dailySummary.absent,
        sum.absent_pct ?? dailySummary.pct_absent,
        sum.late_count ?? dailySummary.late,
        sum.late_pct ?? dailySummary.pct_late,
      ],
    ];
    const tableJson = filteredDailyTable.map((r) => ({
      employee_name: r.employee_name ?? '',
      department: r.department ?? '',
      check_in: r.check_in ?? '',
      check_out: r.check_out ?? '',
      status: r.status ?? '',
      late_minutes: r.late_minutes ?? 0,
    }));
    downloadXlsx(`daily-report-${dailySummary.date}.xlsx`, [
      { name: 'Summary', aoa: summaryAoa },
      { name: 'Attendance', json: tableJson },
    ]);
    toast('Daily report XLSX downloaded', 'success');
  };

  const printReportSafe = () => {
    const prev = document.title;
    const stamp = new Date().toISOString().slice(0, 10);
    if (reportMode === REPORT_MODE.LEAVE) {
      document.title = `Leave-report-${fromDate}-to-${toDate}-asof-${leaveAsOf}`;
    } else if (reportMode === REPORT_MODE.RECOGNITION) {
      document.title = `Recognition-report-${fromDate}-to-${toDate}`;
    } else if (reportMode === REPORT_MODE.RAW) {
      document.title = `Attendance-raw-${fromDate}-to-${toDate}`;
    } else if (reportMode === REPORT_MODE.DAILY && dailySummary?.date) {
      document.title = `Daily-attendance-${dailySummary.date}`;
    } else if (reportMode === REPORT_MODE.MONTHLY && monthlySummary) {
      document.title = `Monthly-attendance-${monthlySummary.year}-${String(monthlySummary.month).padStart(2, '0')}`;
    } else if (reportMode === REPORT_MODE.PERFORMANCE && performanceReport?.cycle) {
      const cy = performanceReport.cycle;
      document.title = `Performance-appraisal-${cy.year ?? ''}-${cy.quarter || cy.type || 'cycle'}`;
    } else if (reportMode === REPORT_MODE.ORG_REPORT) {
      document.title = `Organization-report-${stamp}`;
    } else {
      document.title = `HR-reports-${stamp}`;
    }
    window.print();
    setTimeout(() => {
      document.title = prev;
    }, 800);
  };

  const exportMonthlyReportCsv = () => {
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
    toast('Monthly report CSV downloaded', 'success');
  };

  const exportMonthlyReportXlsx = () => {
    if (!monthlySummary) return;
    const ex = monthlySummary.executive_summary || {};
    const ym = `${monthlySummary.year}-${String(monthlySummary.month).padStart(2, '0')}`;
    const execAoa = [
      ['Monthly attendance report', ym],
      [],
      ['Overall attendance %', 'Overall absence %', 'Overall late %', 'Trend attendance', 'Trend absence', 'Trend late'],
      [ex.overall_attendance_pct, ex.overall_absence_pct, ex.overall_late_pct, ex.trend_attendance, ex.trend_absence, ex.trend_late],
    ];
    const deptJson = (monthlySummary.department_summary || []).map((r) => ({
      department: r.department,
      employee_count: r.employee_count,
      avg_attendance_pct: r.avg_attendance_pct,
      absence_pct: r.absence_pct,
      late_pct: r.late_pct,
    }));
    const staffJson = (monthlySummary.staff_monthly || []).map((r) => ({
      employee_name: r.employee_name ?? r.full_name ?? '',
      department: r.department ?? '',
      work_days: r.work_days ?? 0,
      present_days: r.present_days ?? 0,
      absent_days: r.days_absent ?? 0,
      late_days: r.days_late ?? 0,
      attendance_pct: r.attendance_pct ?? 0,
      late_pct: r.pct_late ?? 0,
    }));
    const daysJson = (monthlySummary.days || []).map((d) => ({
      date: d.date,
      total_staff: d.total_staff,
      present: d.present,
      absent: d.absent,
      late: d.late,
      on_time: d.on_time,
      no_clock_out: d.no_clock_out,
      pct_late: d.pct_late,
      pct_on_time: d.pct_on_time,
      pct_absent: d.pct_absent,
      pct_no_clock_out: d.pct_no_clock_out ?? '',
    }));
    downloadXlsx(`monthly-report-${ym}.xlsx`, [
      { name: 'Executive', aoa: execAoa },
      { name: 'Departments', json: deptJson },
      { name: 'Staff', json: staffJson },
      { name: 'By day', json: daysJson },
    ]);
    toast('Monthly report XLSX downloaded', 'success');
  };

  const exportLeaveReport = () => {
    if (!leaveReport) return;
    const p = leaveReport.period || {};
    const lines = [
      `Leave report (HR), period ${p.from_date ?? fromDate} to ${p.to_date ?? toDate}, on-leave snapshot as of ${p.as_of ?? leaveAsOf}`,
      'Headline metrics',
      'Staff in scope (active non-admin),On leave as of snapshot (distinct staff),No approved leave in period (distinct staff),Total requests (overlap period),Approved requests,Rejected requests,Approved days in period (taken),Pending days in period,Pending requests in period',
      [
        leaveReport.staff_in_scope ?? '',
        leaveReport.on_leave_as_of_count ?? '',
        leaveReport.no_approved_leave_in_period_count ?? '',
        leaveReport.total_requests ?? 0,
        leaveReport.approved_count ?? 0,
        leaveReport.rejected_count ?? 0,
        leaveReport.leave_totals_in_period?.approved_days ?? '',
        leaveReport.leave_totals_in_period?.pending_days ?? '',
        leaveReport.leave_totals_in_period?.pending_requests ?? '',
      ].map(escapeCsvCell).join(','),
      '',
      'Approval rate %,Rejection rate %',
      `${leaveReport.approval_rate_pct ?? 0},${leaveReport.rejection_rate_pct ?? 0}`,
      '',
      'By status (requests overlapping period)',
      'Status,Count',
      ...(leaveReport.by_status || []).map((r) => [r.status ?? '', r.count ?? 0].map(escapeCsvCell).join(',')),
      '',
      'Department breakdown',
      'Department,Active staff,On leave as of,Requests in period,Total days (all statuses),Taken (approved days),Approved requests,Pending days,Pending requests,No approved leave in period',
      ...(leaveReport.department_breakdown || []).map((r) =>
        [
          r.department ?? '',
          r.active_staff ?? 0,
          r.on_leave_as_of ?? 0,
          r.requests_in_period ?? 0,
          r.total_days_in_period ?? 0,
          r.approved_days_in_period ?? 0,
          r.approved_requests_in_period ?? 0,
          r.pending_days_in_period ?? 0,
          r.pending_requests_in_period ?? 0,
          r.no_approved_leave_in_period ?? 0,
        ].map(escapeCsvCell).join(','),
      ),
      '',
      'On leave as of snapshot (detail)',
      'Employee,Email,Department,Branch,Phone,Leave type,Start,End,Days',
      ...(leaveReport.on_leave_as_of || []).map((r) =>
        [
          r.full_name ?? '',
          r.email ?? '',
          r.department ?? '',
          r.branch_name ?? '',
          r.phone ?? '',
          r.leave_type_name ?? '',
          r.start_date ?? '',
          r.end_date ?? '',
          r.days_requested ?? '',
        ].map(escapeCsvCell).join(','),
      ),
      '',
      'No approved leave overlapping period (sample up to 400)',
      'Employee,Email,Department,Branch,Phone,Role',
      ...(leaveReport.no_approved_leave_in_period || []).map((r) =>
        [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.role ?? ''].map(escapeCsvCell).join(','),
      ),
      '',
      'By person: taken vs pending (overlap period)',
      'Employee,Email,Department,Branch,Phone,Taken days,Taken requests,Pending days,Pending requests,Total days',
      ...(leaveReport.staff_leave_activity || []).map((r) =>
        [
          r.full_name ?? '',
          r.email ?? '',
          r.department ?? '',
          r.branch_name ?? '',
          r.phone ?? '',
          r.approved_days ?? 0,
          r.approved_requests ?? 0,
          r.pending_days ?? 0,
          r.pending_requests ?? 0,
          r.total_days ?? 0,
        ].map(escapeCsvCell).join(','),
      ),
      '',
      'Top requesters by request count (overlap period)',
      'Employee,Email,Department,Branch,Phone,Requests,Days',
      ...(leaveReport.top_requesters || []).map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.total_requests ?? 0, r.total_days ?? 0].map(escapeCsvCell).join(',')),
      '',
      `Leave balances by type (year ${leaveReport.period?.balance_year ?? leaveBalanceYear})`,
      'Employee,Email,Department,Branch,Phone,Leave type,Allocated,Used,Remaining',
      ...((leaveReport.staff_leave_balance_rows || []).map((r) =>
        [
          r.full_name ?? '',
          r.email ?? '',
          r.department ?? '',
          r.branch_name ?? '',
          r.phone ?? '',
          r.leave_type_name ?? '',
          r.allocated_days ?? '',
          r.used_days ?? '',
          r.remaining_days ?? '',
        ].map(escapeCsvCell).join(','),
      )),
      '',
      'Total remaining leave days per employee (sum of types)',
      'Employee,Email,Department,Branch,Phone,Total remaining',
      ...((leaveReport.staff_leave_balance_totals || []).map((r) =>
        [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.total_remaining_days ?? 0].map(escapeCsvCell).join(','),
      )),
    ];
    downloadCsv(`leave-report-${fromDate}-to-${toDate}.csv`, lines.join('\n'));
    toast('Leave report CSV exported', 'success');
  };

  const exportLeaveReportXlsx = () => {
    if (!leaveReport) return;
    const p = leaveReport.period || {};
    const summaryAoa = [
      ['Leave report (HR)'],
      ['Period', `${p.from_date ?? fromDate} → ${p.to_date ?? toDate}`],
      ['On-leave snapshot as of', p.as_of ?? leaveAsOf],
      ['Balance year', p.balance_year ?? leaveBalanceYear],
      [],
      ['Staff in scope', 'On leave (snapshot)', 'No approved leave in period', 'Total requests', 'Approved', 'Rejected'],
      [
        leaveReport.staff_in_scope ?? '',
        leaveReport.on_leave_as_of_count ?? '',
        leaveReport.no_approved_leave_in_period_count ?? '',
        leaveReport.total_requests ?? 0,
        leaveReport.approved_count ?? 0,
        leaveReport.rejected_count ?? 0,
      ],
    ];
    const onLeaveJson = (leaveReport.on_leave_as_of || []).map((r) => ({
      employee: r.full_name ?? '',
      email: r.email ?? '',
      department: r.department ?? '',
      branch: r.branch_name ?? '',
      phone: r.phone ?? '',
      leave_type: r.leave_type_name ?? '',
      start: r.start_date ?? '',
      end: r.end_date ?? '',
      days: r.days_requested ?? '',
    }));
    const balanceJson = (leaveReport.staff_leave_balance_rows || []).map((r) => ({
      employee: r.full_name ?? '',
      email: r.email ?? '',
      department: r.department ?? '',
      branch: r.branch_name ?? '',
      phone: r.phone ?? '',
      leave_type: r.leave_type_name ?? '',
      allocated: r.allocated_days ?? '',
      used: r.used_days ?? '',
      remaining: r.remaining_days ?? '',
    }));
    const totalsJson = (leaveReport.staff_leave_balance_totals || []).map((r) => ({
      employee: r.full_name ?? '',
      email: r.email ?? '',
      department: r.department ?? '',
      branch: r.branch_name ?? '',
      phone: r.phone ?? '',
      total_remaining_days: r.total_remaining_days ?? 0,
    }));
    const deptJson = (leaveReport.department_breakdown || []).map((r) => ({
      department: r.department ?? '',
      active_staff: r.active_staff ?? 0,
      on_leave_as_of: r.on_leave_as_of ?? 0,
      requests_in_period: r.requests_in_period ?? 0,
      approved_days: r.approved_days_in_period ?? 0,
      pending_days: r.pending_days_in_period ?? 0,
    }));
    downloadXlsx(`leave-report-${fromDate}-to-${toDate}.xlsx`, [
      { name: 'Summary', aoa: summaryAoa },
      { name: 'On leave', json: onLeaveJson },
      { name: 'Dept breakdown', json: deptJson },
      { name: 'Balances', json: balanceJson },
      { name: 'Balance totals', json: totalsJson },
    ]);
    toast('Leave report XLSX downloaded', 'success');
  };

  const exportLeaveSectionCsv = (name, headers, rows, intro = []) => {
    if (!leaveReport) return;
    const p = leaveReport.period || {};
    const lines = [
      `HR leave report export: ${name}`,
      `Period: ${p.from_date ?? fromDate} to ${p.to_date ?? toDate}`,
      `Snapshot as of: ${p.as_of ?? leaveAsOf}`,
      ...(intro || []),
      '',
      headers.map(escapeCsvCell).join(','),
      ...(rows || []).map((row) => row.map(escapeCsvCell).join(',')),
    ];
    downloadCsv(`leave-${name}-${p.from_date ?? fromDate}-to-${p.to_date ?? toDate}.csv`, lines.join('\n'));
    toast(`${name} CSV downloaded`, 'success');
  };

  const exportLeaveDepartmentCsv = () => {
    exportLeaveSectionCsv(
      'department-breakdown',
      ['Department', 'Active staff', 'On leave', 'Requests', 'Days (all)', 'Taken (approved days)', 'Pending days', 'Pending requests', 'No approved in period'],
      (leaveReport?.department_breakdown || []).map((row) => [
        row.department ?? '',
        row.active_staff ?? 0,
        row.on_leave_as_of ?? 0,
        row.requests_in_period ?? 0,
        row.total_days_in_period ?? 0,
        row.approved_days_in_period ?? 0,
        row.pending_days_in_period ?? 0,
        row.pending_requests_in_period ?? 0,
        row.no_approved_leave_in_period ?? 0,
      ]),
    );
  };

  const exportLeaveNoApprovedCsv = () => {
    exportLeaveSectionCsv(
      'no-approved-in-period',
      ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Role'],
      (leaveReport?.no_approved_leave_in_period || []).map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.role ?? '']),
      ['Sample list only. Use Full CSV/XLSX from Exports for complete data when truncated.'],
    );
  };

  const exportLeaveActivityCsv = () => {
    exportLeaveSectionCsv(
      'staff-activity',
      ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Taken (days)', 'Taken (requests)', 'Pending (days)', 'Pending (requests)', 'All days'],
      (leaveReport?.staff_leave_activity || []).map((r) => [
        r.full_name ?? '',
        r.email ?? '',
        r.department ?? '',
        r.branch_name ?? '',
        r.phone ?? '',
        Number(r.approved_days ?? 0).toFixed(1),
        r.approved_requests ?? 0,
        Number(r.pending_days ?? 0).toFixed(1),
        r.pending_requests ?? 0,
        Number(r.total_days ?? 0).toFixed(1),
      ]),
    );
  };

  const exportLeaveBalanceTotalsCsv = () => {
    exportLeaveSectionCsv(
      'remaining-balances',
      ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Total remaining (days)'],
      (leaveReport?.staff_leave_balance_totals || []).map((r) => [
        r.full_name ?? '',
        r.email ?? '',
        r.department ?? '',
        r.branch_name ?? '',
        r.phone ?? '',
        Number(r.total_remaining_days ?? 0).toFixed(1),
      ]),
      [`Balance year: ${leaveReport?.period?.balance_year ?? leaveBalanceYear}`],
    );
  };

  const exportLeaveTopRequestersCsv = () => {
    exportLeaveSectionCsv(
      'top-requesters',
      ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Requests', 'Days'],
      (leaveReport?.top_requesters || []).map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.total_requests ?? 0, Number(r.total_days ?? 0).toFixed(1)]),
    );
  };

  const exportSelectedLeaveCsv = () => {
    if (!leaveReport) return;
    const p = leaveReport.period || {};
    let name = 'leave-report';
    let headers = [];
    let rows = [];
    if (leaveReportSection === 'on_leave') {
      name = 'employee-on-leave';
      headers = ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Leave type', 'Start', 'End', 'Days'];
      rows = filteredOnLeaveRows.map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.leave_type_name ?? '', r.start_date ?? '', r.end_date ?? '', Number(r.days_requested ?? 0).toFixed(1)]);
    } else if (leaveReportSection === 'approved') {
      name = 'employee-leave-approved';
      headers = ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Leave type', 'Start', 'End', 'Days', 'Status', 'Final decision at'];
      rows = filteredApprovedRows.map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.leave_type_name ?? '', r.start_date ?? '', r.end_date ?? '', Number(r.days_requested ?? 0).toFixed(1), r.status ?? '', r.final_decision_at ?? '']);
    } else if (leaveReportSection === 'pending') {
      name = 'employee-leave-pending';
      headers = ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Leave type', 'Start', 'End', 'Days', 'Status', 'Updated at'];
      rows = filteredPendingRows.map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.leave_type_name ?? '', r.start_date ?? '', r.end_date ?? '', Number(r.days_requested ?? 0).toFixed(1), r.status ?? '', r.updated_at ?? '']);
    } else if (leaveReportSection === 'balances') {
      name = 'employee-leave-balances';
      headers = ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Leave type', 'Allocated', 'Used', 'Remaining'];
      rows = filteredBalanceRows.map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.leave_type_name ?? '', Number(r.allocated_days ?? 0).toFixed(1), Number(r.used_days ?? 0).toFixed(1), Number(r.remaining_days ?? 0).toFixed(1)]);
    } else if (leaveReportSection === 'activity') {
      name = 'employee-leave-activity';
      headers = ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Taken (days)', 'Taken (requests)', 'Pending (days)', 'Pending (requests)', 'All days'];
      rows = (leaveReport?.staff_leave_activity || []).map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', Number(r.approved_days ?? 0).toFixed(1), r.approved_requests ?? 0, Number(r.pending_days ?? 0).toFixed(1), r.pending_requests ?? 0, Number(r.total_days ?? 0).toFixed(1)]);
    } else if (leaveReportSection === 'top_requesters') {
      name = 'top-requesters';
      headers = ['Employee', 'Email', 'Department', 'Branch', 'Phone', 'Requests', 'Days'];
      rows = (leaveReport?.top_requesters || []).map((r) => [r.full_name ?? '', r.email ?? '', r.department ?? '', r.branch_name ?? '', r.phone ?? '', r.total_requests ?? 0, Number(r.total_days ?? 0).toFixed(1)]);
    } else {
      name = 'leave-department-summary';
      headers = ['Department', 'Active staff', 'On leave', 'Requests', 'Days (all)', 'Taken (approved days)', 'Pending days', 'Pending requests', 'No approved in period'];
      rows = (leaveReport?.department_breakdown || []).map((row) => [row.department ?? '', row.active_staff ?? 0, row.on_leave_as_of ?? 0, row.requests_in_period ?? 0, row.total_days_in_period ?? 0, row.approved_days_in_period ?? 0, row.pending_days_in_period ?? 0, row.pending_requests_in_period ?? 0, row.no_approved_leave_in_period ?? 0]);
    }
    const lines = [
      `Leave report export: ${name}`,
      `Period: ${p.from_date ?? fromDate} to ${p.to_date ?? toDate}`,
      `Snapshot as of: ${p.as_of ?? leaveAsOf}`,
      `Department: ${leaveDeptFilter || 'All departments'}`,
      `Leave type: ${leaveTypeFilter || 'All leave types'}`,
      '',
      headers.map(escapeCsvCell).join(','),
      ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    ];
    downloadCsv(`leave-${name}-${p.from_date ?? fromDate}-to-${p.to_date ?? toDate}.csv`, lines.join('\n'));
    toast('Leave CSV downloaded', 'success');
  };

  const exportSelectedLeaveXlsx = () => {
    if (!leaveReport) return;
    const p = leaveReport.period || {};
    let sheetName = 'Leave';
    let json = [];
    if (leaveReportSection === 'on_leave') {
      sheetName = 'On leave';
      json = filteredOnLeaveRows.map((r) => ({ employee: r.full_name ?? '', email: r.email ?? '', department: r.department ?? '', branch: r.branch_name ?? '', phone: r.phone ?? '', leave_type: r.leave_type_name ?? '', start: r.start_date ?? '', end: r.end_date ?? '', days: Number(r.days_requested ?? 0).toFixed(1) }));
    } else if (leaveReportSection === 'approved') {
      sheetName = 'Approved';
      json = filteredApprovedRows.map((r) => ({ employee: r.full_name ?? '', email: r.email ?? '', department: r.department ?? '', branch: r.branch_name ?? '', phone: r.phone ?? '', leave_type: r.leave_type_name ?? '', start: r.start_date ?? '', end: r.end_date ?? '', days: Number(r.days_requested ?? 0).toFixed(1), status: r.status ?? '', final_decision_at: r.final_decision_at ?? '' }));
    } else if (leaveReportSection === 'pending') {
      sheetName = 'Pending';
      json = filteredPendingRows.map((r) => ({ employee: r.full_name ?? '', email: r.email ?? '', department: r.department ?? '', branch: r.branch_name ?? '', phone: r.phone ?? '', leave_type: r.leave_type_name ?? '', start: r.start_date ?? '', end: r.end_date ?? '', days: Number(r.days_requested ?? 0).toFixed(1), status: r.status ?? '', updated_at: r.updated_at ?? '' }));
    } else if (leaveReportSection === 'balances') {
      sheetName = 'Balances';
      json = filteredBalanceRows.map((r) => ({ employee: r.full_name ?? '', email: r.email ?? '', department: r.department ?? '', branch: r.branch_name ?? '', phone: r.phone ?? '', leave_type: r.leave_type_name ?? '', allocated: Number(r.allocated_days ?? 0).toFixed(1), used: Number(r.used_days ?? 0).toFixed(1), remaining: Number(r.remaining_days ?? 0).toFixed(1) }));
    } else if (leaveReportSection === 'activity') {
      sheetName = 'Activity';
      json = (leaveReport?.staff_leave_activity || []).map((r) => ({ employee: r.full_name ?? '', email: r.email ?? '', department: r.department ?? '', branch: r.branch_name ?? '', phone: r.phone ?? '', taken_days: Number(r.approved_days ?? 0).toFixed(1), taken_requests: r.approved_requests ?? 0, pending_days: Number(r.pending_days ?? 0).toFixed(1), pending_requests: r.pending_requests ?? 0, all_days: Number(r.total_days ?? 0).toFixed(1) }));
    } else if (leaveReportSection === 'top_requesters') {
      sheetName = 'Top requesters';
      json = (leaveReport?.top_requesters || []).map((r) => ({ employee: r.full_name ?? '', email: r.email ?? '', department: r.department ?? '', branch: r.branch_name ?? '', phone: r.phone ?? '', requests: r.total_requests ?? 0, days: Number(r.total_days ?? 0).toFixed(1) }));
    } else {
      sheetName = 'Department';
      json = (leaveReport?.department_breakdown || []).map((row) => ({ department: row.department ?? '', active_staff: row.active_staff ?? 0, on_leave: row.on_leave_as_of ?? 0, requests: row.requests_in_period ?? 0, days_all: row.total_days_in_period ?? 0, taken_days: row.approved_days_in_period ?? 0, pending_days: row.pending_days_in_period ?? 0, pending_requests: row.pending_requests_in_period ?? 0, no_approved_in_period: row.no_approved_leave_in_period ?? 0 }));
    }
    const infoAoa = [
      ['Leave report export'],
      ['Section', sheetName],
      ['Period', `${p.from_date ?? fromDate} → ${p.to_date ?? toDate}`],
      ['Snapshot as of', p.as_of ?? leaveAsOf],
      ['Department', leaveDeptFilter || 'All departments'],
      ['Leave type', leaveTypeFilter || 'All leave types'],
    ];
    downloadXlsx(`leave-${sheetName.toLowerCase().replace(/\s+/g, '-')}-${p.from_date ?? fromDate}-to-${p.to_date ?? toDate}.xlsx`, [
      { name: 'Info', aoa: infoAoa },
      { name: sheetName, json },
    ]);
    toast('Leave XLSX downloaded', 'success');
  };

  const runLeaveExport = () => {
    if (!leaveReport) return;
    if (leaveExportType === 'excel') return exportSelectedLeaveXlsx();
    if (leaveExportType === 'csv') return exportSelectedLeaveCsv();
    if (leaveExportType === 'pdf') return printReportSafe();
  };

  const exportOrganizationCsv = () => {
    if (!organizationOverview) return;
    downloadOrganizationDemographicsCsv(organizationOverview);
    toast('Demographics CSV downloaded', 'success');
  };

  const exportPerformanceReportCsv = () => {
    if (!performanceReport?.cycle) return;
    const cy = performanceReport.cycle;
    const label = `y${cy.year ?? ''}-${cy.quarter || cy.type || 'cycle'}`;
    const kpiHead = ['Employee', 'Email', 'Department', 'Role', 'KPI count', 'Draft', 'Pending supervisor', 'Returned', 'Verified', 'Approved', 'Received', 'Acknowledged'];
    const apHead = ['Employee', 'Email', 'Department', 'Role', 'Appraisal count', 'Draft', 'Pending supervisor', 'Returned', 'Verified', 'Approved', 'Received', 'Acknowledged'];
    const lines = [
      `Performance & appraisal report, cycle ${label}, id ${cy.id}`,
      performanceReport.note || '',
      '',
      'KPI rows by status (all KPIs in cycle)',
      'Status,Count',
      ...(performanceReport.kpi_by_status || []).map((r) => [r.status ?? '', r.count ?? 0].map(escapeCsvCell).join(',')),
      '',
      'Appraisal rows by status',
      'Status,Count',
      ...(performanceReport.appraisal_by_status || []).map((r) => [r.status ?? '', r.count ?? 0].map(escapeCsvCell).join(',')),
      '',
      'KPI by employee',
      kpiHead.join(','),
      ...(performanceReport.kpi_by_staff || []).map((r) =>
        [
          r.full_name ?? '',
          r.email ?? '',
          r.department ?? '',
          r.role ?? '',
          r.kpi_count ?? 0,
          r.kpi_draft ?? 0,
          r.kpi_pending_supervisor ?? 0,
          r.kpi_returned ?? 0,
          r.kpi_verified ?? 0,
          r.kpi_approved ?? 0,
          r.kpi_received ?? 0,
          r.kpi_acknowledged ?? 0,
        ].map(escapeCsvCell).join(','),
      ),
      '',
      'Appraisal by employee',
      apHead.join(','),
      ...(performanceReport.appraisal_by_staff || []).map((r) =>
        [
          r.full_name ?? '',
          r.email ?? '',
          r.department ?? '',
          r.role ?? '',
          r.appraisal_count ?? 0,
          r.ap_draft ?? 0,
          r.ap_pending_supervisor ?? 0,
          r.ap_returned ?? 0,
          r.ap_verified ?? 0,
          r.ap_approved ?? 0,
          r.ap_received ?? 0,
          r.ap_acknowledged ?? 0,
        ].map(escapeCsvCell).join(','),
      ),
    ];
    downloadCsv(`appraisal-performance-${label}.csv`, lines.join('\n'));
    toast('Performance report CSV downloaded', 'success');
  };

  const exportPerformanceReportXlsx = () => {
    if (!performanceReport?.cycle) return;
    const cy = performanceReport.cycle;
    const label = `y${cy.year ?? ''}-${cy.quarter || cy.type || 'cycle'}`;
    const summaryAoa = [
      ['Performance & appraisal'],
      ['Cycle', `${cy.year ?? ''} ${cy.quarter || ''} (${cy.type})`, cy.status],
      ['Cycle id', cy.id],
      ['Staff in scope (active non-admin)', performanceReport.staff_in_scope ?? ''],
      [performanceReport.note || ''],
    ];
    const kpiStatusJson = (performanceReport.kpi_by_status || []).map((r) => ({ status: r.status, count: r.count }));
    const apStatusJson = (performanceReport.appraisal_by_status || []).map((r) => ({ status: r.status, count: r.count }));
    const kpiStaffJson = (performanceReport.kpi_by_staff || []).map((r) => ({
      employee: r.full_name,
      email: r.email,
      department: r.department,
      role: r.role,
      kpi_count: r.kpi_count,
      draft: r.kpi_draft,
      pending_supervisor: r.kpi_pending_supervisor,
      returned: r.kpi_returned,
      verified: r.kpi_verified,
      approved: r.kpi_approved,
      received: r.kpi_received,
      acknowledged: r.kpi_acknowledged,
    }));
    const apStaffJson = (performanceReport.appraisal_by_staff || []).map((r) => ({
      employee: r.full_name,
      email: r.email,
      department: r.department,
      role: r.role,
      appraisal_count: r.appraisal_count,
      draft: r.ap_draft,
      pending_supervisor: r.ap_pending_supervisor,
      returned: r.ap_returned,
      verified: r.ap_verified,
      approved: r.ap_approved,
      received: r.ap_received,
      acknowledged: r.ap_acknowledged,
    }));
    downloadXlsx(`appraisal-performance-${label}.xlsx`, [
      { name: 'Summary', aoa: summaryAoa },
      { name: 'KPI by status', json: kpiStatusJson },
      { name: 'Appraisal by status', json: apStatusJson },
      { name: 'KPI by staff', json: kpiStaffJson },
      { name: 'Appraisal by staff', json: apStaffJson },
    ]);
    toast('Performance report XLSX downloaded', 'success');
  };

  const exportRecognitionReportCsv = () => {
    if (!recognitionReport) return;
    const lines = [
      `Recognition report, period ${fromDate} to ${toDate}`,
      '',
      'Summary',
      'Total recognitions',
      `${recognitionReport.total_count ?? 0}`,
      '',
      'By type',
      'Type,Count',
      ...((recognitionReport.by_type || []).map((r) => [r.recognition_type ?? '', r.count ?? 0].map(escapeCsvCell).join(','))),
      '',
      'Recent recognitions',
      'Date,From,Type,Message,Likes,Comments',
      ...((recognitionReport.recent || []).map((r) =>
        [
          r.created_at ?? '',
          r.from_name ?? '',
          r.recognition_type ?? '',
          r.message ?? '',
          r.like_count ?? 0,
          r.comment_count ?? 0,
        ].map(escapeCsvCell).join(','))),
    ];
    downloadCsv(`recognition-report-${fromDate}-to-${toDate}.csv`, lines.join('\n'));
    toast('Recognition report CSV downloaded', 'success');
  };

  const runRecognitionExport = () => {
    if (!recognitionReport) return;
    if (recognitionExportType === 'csv') return exportRecognitionReportCsv();
    if (recognitionExportType === 'print_pdf') return printReportSafe();
  };

  const runPerformanceExport = () => {
    if (!performanceReport?.cycle) return;
    if (performanceExportType === 'xlsx') return exportPerformanceReportXlsx();
    if (performanceExportType === 'csv') return exportPerformanceReportCsv();
    if (performanceExportType === 'print_pdf') return printReportSafe();
  };

  const byDate = displayedRawLogs.reduce((acc, l) => {
    const d = (l.clock_in_at || '').slice(0, 10);
    if (!d) return acc;
    acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});
  const chartData = Object.entries(byDate).map(([date, count]) => ({ date: date.slice(5), count })).sort((a, b) => a.date.localeCompare(b.date));

  const openUserModal = (key, title, list) => {
    if (list?.length) setModal({ title, list });
  };

  const allReportTabs = useMemo(
    () => [
      { id: REPORT_MODE.DAILY, label: 'Daily', hint: 'Snapshot for one day' },
      { id: REPORT_MODE.MONTHLY, label: 'Monthly', hint: 'Trends & departments' },
      { id: REPORT_MODE.RAW, label: 'Raw attendance', hint: 'Date range, XLSX, CSV, print' },
      { id: REPORT_MODE.RECOGNITION, label: 'Recognition', hint: 'Peer recognition stats' },
      { id: REPORT_MODE.LEAVE, label: 'Leave', hint: 'Period dates, balances, XLSX / CSV / PDF' },
      { id: REPORT_MODE.PERFORMANCE, label: 'Performance', hint: 'KPI & appraisal cycle status' },
      { id: REPORT_MODE.ORG_REPORT, label: 'Organization', hint: 'Workforce demographics & structure' },
    ],
    [],
  );

  const reportTabs = useMemo(() => {
    if (reportScope === 'attendance') {
      return allReportTabs.filter((t) =>
        [REPORT_MODE.DAILY, REPORT_MODE.MONTHLY, REPORT_MODE.RAW].includes(t.id),
      );
    }
    if (reportScope === 'leave') return allReportTabs.filter((t) => t.id === REPORT_MODE.LEAVE);
    if (reportScope === 'recognition') return allReportTabs.filter((t) => t.id === REPORT_MODE.RECOGNITION);
    if (reportScope === 'performance') return allReportTabs.filter((t) => t.id === REPORT_MODE.PERFORMANCE);
    if (reportScope === 'organization') return allReportTabs.filter((t) => t.id === REPORT_MODE.ORG_REPORT);
    return allReportTabs;
  }, [allReportTabs, reportScope]);

  const leaveTypeOptions = useMemo(() => {
    const set = new Set();
    (leaveReport?.on_leave_as_of || []).forEach((r) => {
      if ((r.leave_type_name || '').trim()) set.add(r.leave_type_name.trim());
    });
    (leaveReport?.approved_requests_rows || []).forEach((r) => {
      if ((r.leave_type_name || '').trim()) set.add(r.leave_type_name.trim());
    });
    (leaveReport?.pending_requests_rows || []).forEach((r) => {
      if ((r.leave_type_name || '').trim()) set.add(r.leave_type_name.trim());
    });
    (leaveReport?.staff_leave_balance_rows || []).forEach((r) => {
      if ((r.leave_type_name || '').trim()) set.add(r.leave_type_name.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [leaveReport]);

  const filteredOnLeaveRows = useMemo(
    () => (leaveReport?.on_leave_as_of || []).filter((r) => !leaveTypeFilter || (r.leave_type_name || '') === leaveTypeFilter),
    [leaveReport, leaveTypeFilter],
  );
  const filteredApprovedRows = useMemo(
    () => (leaveReport?.approved_requests_rows || []).filter((r) => !leaveTypeFilter || (r.leave_type_name || '') === leaveTypeFilter),
    [leaveReport, leaveTypeFilter],
  );
  const filteredPendingRows = useMemo(
    () => (leaveReport?.pending_requests_rows || []).filter((r) => !leaveTypeFilter || (r.leave_type_name || '') === leaveTypeFilter),
    [leaveReport, leaveTypeFilter],
  );
  const filteredBalanceRows = useMemo(
    () => (leaveReport?.staff_leave_balance_rows || []).filter((r) => !leaveTypeFilter || (r.leave_type_name || '') === leaveTypeFilter),
    [leaveReport, leaveTypeFilter],
  );

  const scopeTitle =
    reportScope === 'attendance'
      ? 'Attendance reports'
      : reportScope === 'leave'
        ? 'Leave reports'
        : reportScope === 'recognition'
          ? 'Recognition reports'
          : reportScope === 'performance'
            ? 'Performance & appraisal reports'
            : reportScope === 'organization'
              ? 'Organization report'
              : 'HR reports';

  const scopeSubtitle =
    reportScope === 'attendance'
      ? 'Daily, monthly, and raw attendance with branch filters, CSV, XLSX, and print.'
      : reportScope === 'leave'
        ? 'Leave period analytics, on-leave snapshot, balances by year, and exports.'
        : reportScope === 'recognition'
          ? 'Peer recognition counts and recent entries.'
          : reportScope === 'performance'
            ? 'KPI submissions and evaluations, plus appraisal self-assessment workflow, by appraisal cycle.'
            : reportScope === 'organization'
              ? 'Whole-organization headcount, gender, age bands, departments, branches, and demographics CSV — same data as the organization dashboard, in a report-first layout.'
              : 'Pick a module tab below, or use the Reports section in the sidebar for a focused view.';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="space-y-6 pb-8"
    >
      <div className="print-hidden space-y-6">
      {reportScope !== 'all' && (
        <Link
          to={ROUTES.HR.REPORTS}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          ← All reports
        </Link>
      )}
      <DashboardPageHeader
        badge="Reports"
        title={scopeTitle}
        subtitle={scopeSubtitle}
      />

      {reportScope === 'organization' && (
        <div className="flex flex-wrap gap-4 text-sm print-hidden">
          <Link to={ROUTES.HR.ORGANIZATION} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
            Open full organization dashboard (charts & switcher)
          </Link>
          <span className="text-slate-300 dark:text-slate-600" aria-hidden>
            ·
          </span>
          <Link to={ROUTES.HR.EMPLOYEES} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
            Edit employee records
          </Link>
        </div>
      )}

      {reportTabs.length > 1 && (
        <div
          className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/90 shadow-inner"
          role="tablist"
          aria-label="Report type"
        >
          {reportTabs.map((tab) => {
            const active = reportMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={tab.hint}
                onClick={() => setReportMode(tab.id)}
                className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-soft ring-1 ring-slate-200/90 dark:ring-slate-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="sticky top-0 z-20 -mx-1 px-1 py-3 md:py-4 bg-slate-50/95 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 mb-2 rounded-b-xl">
        <div className="flex flex-wrap gap-3 items-center">
        {[REPORT_MODE.DAILY, REPORT_MODE.MONTHLY, REPORT_MODE.RAW].includes(reportMode) && (
          <>
            <label className="sr-only" htmlFor="reports-branch">
              Branch
            </label>
            <select
              id="reports-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white shadow-sm"
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
        )}

        {reportMode === REPORT_MODE.DAILY && (
          <>
            <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white" />
            <label className="sr-only" htmlFor="daily-table-filter">
              Table rows
            </label>
            <select
              id="daily-table-filter"
              value={dailyTableFilter}
              onChange={(e) => setDailyTableFilter(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white shadow-sm max-w-[11rem]"
              title="Filter which staff appear in the daily table and in CSV / XLSX (summary totals stay for the full day)"
            >
              <option value="all">All — table</option>
              <option value="present">Present only</option>
              <option value="late">Late only</option>
              <option value="absent">Absent only</option>
            </select>
            <button type="button" onClick={exportDailyReportXlsx} disabled={!dailySummary} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">Download XLSX</button>
            <button type="button" onClick={exportDailyReportCsv} disabled={!dailySummary} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">CSV</button>
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
            <button type="button" onClick={exportMonthlyReportXlsx} disabled={!monthlySummary} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">Download XLSX</button>
            <button type="button" onClick={exportMonthlyReportCsv} disabled={!monthlySummary} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">CSV</button>
            <button type="button" onClick={printReportSafe} disabled={!monthlySummary} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50">Print / PDF</button>
          </>
        )}
        {reportMode === REPORT_MODE.RAW && (
          <>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 self-center">From / to</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white" title="Range start (inclusive)" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white" title="Range end (inclusive)" />
            <button type="button" onClick={() => setToDate(fromDate)} className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800" title="Set end date equal to start for a single-day report">
              Single day
            </button>
            <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white">
              <option value="all">All attendance</option>
              <option value="late">Late only</option>
              <option value="overtime">Overtime only</option>
            </select>
            <label className="sr-only" htmlFor="raw-dept-filter">
              Department
            </label>
            <select
              id="raw-dept-filter"
              value={attendanceDepartment}
              onChange={(e) => setAttendanceDepartment(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white max-w-[14rem]"
              title="Filter by department"
            >
              <option value="">All departments</option>
              {rawDepartmentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="raw-employee-filter">
              Employee
            </label>
            <select
              id="raw-employee-filter"
              value={attendanceUserId}
              onChange={(e) => setAttendanceUserId(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white max-w-[16rem]"
              title="Filter by employee name"
            >
              <option value="">All employees</option>
              {rawEmployeeOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email || u.id}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="raw-employee-search">
              Search employee
            </label>
            <input
              id="raw-employee-search"
              type="text"
              value={rawEmployeeSearch}
              onChange={(e) => setRawEmployeeSearch(e.target.value)}
              placeholder="Search employee..."
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white max-w-[16rem]"
              title="Search within returned rows by employee name/email/department"
            />
            <button type="button" onClick={exportRawAttendanceXlsx} disabled={!displayedRawLogs.length} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">Download XLSX</button>
            <button type="button" onClick={exportCSV} disabled={!displayedRawLogs.length} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed">CSV</button>
            <button type="button" onClick={printReportSafe} disabled={!displayedRawLogs.length} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50">Print / PDF</button>
          </>
        )}
        {reportMode === REPORT_MODE.LEAVE && (
          <>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">Period</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm" title="Period start" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm" title="Period end" />
            <button type="button" onClick={() => { setToDate(fromDate); setLeaveAsOf(fromDate); }} className="px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800" title="Use one calendar day for period end and on-leave snapshot">
              Single day
            </button>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">On leave</span>
            <input type="date" value={leaveAsOf} onChange={(e) => setLeaveAsOf(e.target.value)} className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm" title="Snapshot date: who is on approved leave this day" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">Balances</span>
            <input
              type="number"
              min={1990}
              max={2100}
              value={leaveBalanceYear}
              onChange={(e) => setLeaveBalanceYear(Number(e.target.value) || leaveBalanceYear)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm w-[5.5rem]"
              title="Calendar year for remaining leave columns in exports and the table below"
            />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">Target users</span>
            <select
              value={leaveDeptFilter}
              onChange={(e) => setLeaveDeptFilter(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[12rem]"
              title="Filter by user department"
            >
              <option value="">All target users</option>
              {leaveDepartments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">Report type</span>
            <select
              value={leaveReportSection}
              onChange={(e) => setLeaveReportSection(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[14rem]"
              title="Select which leave report table to display"
            >
              <option value="on_leave">Employee on leave</option>
              <option value="approved">Employee leave approved</option>
              <option value="pending">Employee leave pending for approval</option>
              <option value="balances">Employee leave balances</option>
              <option value="department">Department summary</option>
              <option value="activity">Employee leave activity</option>
              <option value="top_requesters">Top requesters</option>
            </select>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">Leave type</span>
            <select
              value={leaveTypeFilter}
              onChange={(e) => setLeaveTypeFilter(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[14rem]"
              title="Filter by leave type for balance rows"
            >
              <option value="">All leave types</option>
              {leaveTypeOptions.map((lt) => (
                <option key={lt} value={lt}>{lt}</option>
              ))}
            </select>
            <div className="w-full flex flex-wrap items-center gap-2 pt-3 mt-1 border-t border-slate-200/90 dark:border-slate-700/90">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">Exports</span>
              <select
                value={leaveExportType}
                onChange={(e) => setLeaveExportType(e.target.value)}
                className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm min-w-[12rem]"
                title="Choose extension"
                disabled={!leaveReport}
              >
                <option value="excel">Excel (.xlsx)</option>
                <option value="csv">CSV (.csv)</option>
                <option value="pdf">PDF (.pdf)</option>
              </select>
              <button
                type="button"
                onClick={runLeaveExport}
                disabled={!leaveReport}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
              >
                Download
              </button>
            </div>
          </>
        )}
        {reportMode === REPORT_MODE.RECOGNITION && (
          <>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">Period</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm" title="Range start" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm" title="Range end" />
            <button type="button" onClick={() => setToDate(fromDate)} className="px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800" title="Set end date equal to start">
              Single day
            </button>
            <select
              value={recognitionReportSection}
              onChange={(e) => setRecognitionReportSection(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[13rem]"
              title="Select recognition report table"
            >
              <option value="by_type">By type</option>
              <option value="recent">Recent recognitions</option>
            </select>
            <select
              value={recognitionExportType}
              onChange={(e) => setRecognitionExportType(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[11rem]"
              title="Choose export format"
              disabled={!recognitionReport}
            >
              <option value="csv">CSV</option>
              <option value="print_pdf">Print / PDF</option>
            </select>
            <button type="button" onClick={runRecognitionExport} disabled={!recognitionReport} className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 text-sm font-medium shadow-sm">
              Download
            </button>
          </>
        )}
        {reportMode === REPORT_MODE.PERFORMANCE && (
          <>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center">Period</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm" title="Range start for KPI/appraisal activity dates" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm" title="Range end for KPI/appraisal activity dates" />
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 self-center" htmlFor="perf-cycle">
              Cycle
            </label>
            <select
              id="perf-cycle"
              value={performanceCycleId.trim() ? performanceCycleId : '__auto'}
              onChange={(e) => setPerformanceCycleId(e.target.value === '__auto' ? '' : e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[14rem]"
              title="Appraisal cycle for KPI and appraisal counts"
            >
              <option value="__auto">Active or latest (automatic)</option>
              {(performanceReport?.cycles || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.year}
                  {c.quarter ? ` ${c.quarter}` : ''} · {c.type} · {c.status}
                </option>
              ))}
            </select>
            <select
              value={performanceReportSection}
              onChange={(e) => setPerformanceReportSection(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[15rem]"
              title="Select performance report table"
            >
              <option value="kpi_status">KPI pipeline</option>
              <option value="appraisal_status">Appraisal pipeline</option>
              <option value="kpi_staff">KPIs by employee</option>
              <option value="appraisal_staff">Appraisals by employee</option>
            </select>
            <select
              value={performanceExportType}
              onChange={(e) => setPerformanceExportType(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm max-w-[11rem]"
              title="Choose export format"
              disabled={!performanceReport?.cycle}
            >
              <option value="xlsx">XLSX</option>
              <option value="csv">CSV</option>
              <option value="print_pdf">Print / PDF</option>
            </select>
            <button type="button" onClick={runPerformanceExport} disabled={!performanceReport?.cycle} className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 text-sm font-medium shadow-sm">Download</button>
          </>
        )}
        {reportMode === REPORT_MODE.ORG_REPORT && (
          <>
            <button
              type="button"
              onClick={exportOrganizationCsv}
              disabled={organizationOverviewLoading || !organizationOverview}
              className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
            >
              Demographics CSV
            </button>
            <button
              type="button"
              onClick={printReportSafe}
              disabled={organizationOverviewLoading || !organizationOverview}
              className="px-4 py-2 bg-gray-600 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50 text-sm font-medium shadow-sm"
            >
              Print / PDF
            </button>
          </>
        )}
        </div>
      </div>
      </div>

      {modal && <UserListModal title={modal.title} users={modal.list} onClose={() => setModal(null)} />}

      <div id="hr-reports-print-area" className="space-y-6">
      {reportMode === REPORT_MODE.ORG_REPORT && (
        <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-6 shadow-soft print:border-slate-300">
          <h2 className="text-base font-bold text-slate-900 dark:text-white print:text-black mb-4">Organization demographics &amp; structure</h2>
          {organizationOverviewLoading ? (
            <OrganizationOverview data={null} loading compactTitle />
          ) : !organizationOverview ? (
            <div className="text-center py-6">
              <EmptyState
                title="Could not load organization data"
                message="Check your connection and permissions, then try again. Demographics CSV is available after the overview loads."
              />
              <button
                type="button"
                onClick={() => setOrgFetchKey((k) => k + 1)}
                className="mt-4 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
              >
                Try again
              </button>
            </div>
          ) : (
            <OrganizationOverview data={organizationOverview} loading={false} compactTitle />
          )}
        </section>
      )}
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
              {dailyTableFilter !== 'all' && (
                <p className="text-sm text-gray-500 dark:text-gray-400 -mt-3 mb-2">
                  Showing {filteredDailyTable.length} of {(dailySummary.daily_table || []).length} rows
                  {dailyTableFilter === 'present' && ' (on-time present)'}
                  {dailyTableFilter === 'late' && ' (late)'}
                  {dailyTableFilter === 'absent' && ' (absent)'}
                  . Summary cards above are still for the full day.
                </p>
              )}
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
                    {filteredDailyTable.map((row, i) => (
                      <tr key={i} className="text-gray-700 dark:text-gray-300 text-sm">
                        <td className="px-4 py-2 font-medium">{row.employee_name || '-'}</td>
                        <td className="px-4 py-2">{row.department || '-'}</td>
                        <td className="px-4 py-2">{row.check_in ?? '-'}</td>
                        <td className="px-4 py-2">{row.check_out ?? '-'}</td>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">One row per employee for the selected month. Work days are Monday–Saturday (Sundays excluded). Attendance % = (Present days ÷ Work days) × 100. Late % = (Late days ÷ Work days) × 100.</p>
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
                        <td className="px-4 py-2 font-medium">{row.employee_name || row.full_name || '-'}</td>
                        <td className="px-4 py-2">{row.department || '-'}</td>
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
                        <td className="px-4 py-2 font-medium">{row.department || '-'}</td>
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
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Sundays are omitted (non-working days).</p>
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
          ) : !displayedRawLogs.length ? (
            <EmptyState title="No records" message="No attendance in the selected period." />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Department</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">In</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Out</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Duration</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Late</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Overtime</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {displayedRawLogs.map((log) => (
                      <tr key={log.id} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2">{formatDate(log.clock_in_at)}</td>
                        <td className="px-4 py-2">{log.users?.full_name || '-'}</td>
                        <td className="px-4 py-2">{log.users?.department || '-'}</td>
                        <td className="px-4 py-2">{formatTime(log.clock_in_at)}</td>
                        <td className="px-4 py-2">{log.clock_out_at ? formatTime(log.clock_out_at) : '-'}</td>
                        <td className="px-4 py-2">{formatDuration(log.total_minutes)}</td>
                        <td className="px-4 py-2">{log.late_minutes ?? 0}m</td>
                        <td className="px-4 py-2">{log.overtime_minutes ?? 0}m</td>
                        <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs ${log.status === 'late' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>{log.status || 'present'}</span></td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{log.client_ip || '-'}</td>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Period: <span className="font-medium">{fromDate}</span> to <span className="font-medium">{toDate}</span>
              </p>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-4">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase">Total recognitions</p>
                  <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{recognitionReport.total_count ?? 0}</p>
                </div>
              </div>
              {recognitionReportSection === 'by_type' && (
              <>
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
                        <td className="px-4 py-2 font-medium">{row.recognition_type || '-'}</td>
                        <td className="px-4 py-2 text-right">{row.count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
              )}
              {recognitionReportSection === 'recent' && (
              <>
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
                        <td className="px-4 py-2 font-medium">{r.from_name || '-'}</td>
                        <td className="px-4 py-2">{r.recognition_type || '-'}</td>
                        <td className="px-4 py-2 max-w-xs truncate">{r.message || '-'}</td>
                        <td className="px-4 py-2 text-right">{r.like_count ?? 0}</td>
                        <td className="px-4 py-2 text-right">{r.comment_count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
              )}
            </div>
          )}
        </>
      )}

      {/* Performance & appraisal (KPI + appraisal cycle) */}
      {reportMode === REPORT_MODE.PERFORMANCE && (
        <>
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !performanceReport?.cycle ? (
            <EmptyState
              title="No appraisal cycles"
              message={performanceReport?.note || 'Create an appraisal cycle under HR → Appraisal to track KPIs and appraisals.'}
            />
          ) : (
            <div className="space-y-8">
              <p className="text-sm text-gray-600 dark:text-gray-400 max-w-4xl leading-relaxed">
                {performanceReport.note}{' '}
                <Link to={ROUTES.HR.APPRAISAL} className="text-primary-600 dark:text-primary-400 font-medium hover:underline">
                  Open Appraisal workspace
                </Link>{' '}
                to manage cycles, approvals, and scoring.
              </p>
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Selected cycle</p>
                <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  {performanceReport.cycle.year}
                  {performanceReport.cycle.quarter ? ` · ${performanceReport.cycle.quarter}` : ''} · {performanceReport.cycle.type} ·{' '}
                  <span className="text-primary-600 dark:text-primary-400">{performanceReport.cycle.status}</span>
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                  {performanceReport.cycle.start_date} → {performanceReport.cycle.end_date}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-3">
                  Staff in scope: <strong className="tabular-nums">{performanceReport.staff_in_scope ?? 0}</strong> (active, non-admin)
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  Activity period: <strong className="tabular-nums">{performanceReport.period?.from_date || fromDate}</strong> to{' '}
                  <strong className="tabular-nums">{performanceReport.period?.to_date || toDate}</strong>
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {performanceReportSection === 'kpi_status' && (
                <div>
                  <h2 className="font-semibold text-gray-800 dark:text-white mb-2">KPI pipeline (counts in cycle)</h2>
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700/80">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Status</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">KPIs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {(performanceReport.kpi_by_status || []).map((row) => (
                          <tr key={row.status} className="text-gray-700 dark:text-gray-300">
                            <td className="px-4 py-2 font-medium">{row.status?.replace(/_/g, ' ')}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{row.count ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!(performanceReport.kpi_by_status || []).length && (
                      <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No KPI rows for this cycle yet.</p>
                    )}
                  </div>
                </div>
                )}
                {performanceReportSection === 'appraisal_status' && (
                <div>
                  <h2 className="font-semibold text-gray-800 dark:text-white mb-2">Appraisal pipeline (counts in cycle)</h2>
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700/80">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Status</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Appraisals</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {(performanceReport.appraisal_by_status || []).map((row) => (
                          <tr key={row.status} className="text-gray-700 dark:text-gray-300">
                            <td className="px-4 py-2 font-medium">{row.status?.replace(/_/g, ' ')}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{row.count ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!(performanceReport.appraisal_by_status || []).length && (
                      <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No appraisal records for this cycle yet.</p>
                    )}
                  </div>
                </div>
                )}
              </div>

              {performanceReportSection === 'kpi_staff' && (
              <div>
                <h2 className="font-semibold text-gray-800 dark:text-white mb-2">KPIs by employee</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Counts of KPI <em>objectives</em> per person in this cycle (not submitted = draft; evaluated through supervisor chain = pending / verified / etc.).
                </p>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto max-h-[24rem] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs sm:text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-300">Employee</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-300">Dept</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Total</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Draft</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Pending</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Returned</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Verified</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Approved</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Received</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Ack</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(performanceReport.kpi_by_staff || []).map((r) => (
                        <tr key={r.user_id} className="text-gray-700 dark:text-gray-300">
                          <td className="px-3 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-gray-500 dark:text-gray-400 truncate max-w-[10rem]">{r.email}</div>
                          </td>
                          <td className="px-3 py-2">{r.department}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.kpi_count ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.kpi_draft ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300">{r.kpi_pending_supervisor ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.kpi_returned ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-violet-700 dark:text-violet-300">{r.kpi_verified ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.kpi_approved ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.kpi_received ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-300">{r.kpi_acknowledged ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}

              {performanceReportSection === 'appraisal_staff' && (
              <div>
                <h2 className="font-semibold text-gray-800 dark:text-white mb-2">Appraisals by employee</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Self-assessment forms in this cycle (usually one appraisal per person per cycle).</p>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto max-h-[24rem] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs sm:text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-300">Employee</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-300">Dept</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Count</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Draft</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Pending</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Returned</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Verified</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Approved</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Received</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-300">Ack</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(performanceReport.appraisal_by_staff || []).map((r) => (
                        <tr key={r.user_id} className="text-gray-700 dark:text-gray-300">
                          <td className="px-3 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-gray-500 dark:text-gray-400 truncate max-w-[10rem]">{r.email}</div>
                          </td>
                          <td className="px-3 py-2">{r.department}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.appraisal_count ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.ap_draft ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300">{r.ap_pending_supervisor ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.ap_returned ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-violet-700 dark:text-violet-300">{r.ap_verified ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.ap_approved ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.ap_received ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-300">{r.ap_acknowledged ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Leave report */}
      {reportMode === REPORT_MODE.LEAVE && (
        <>
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !leaveReport ? (
            <EmptyState title="No data" message="Could not load leave report." />
          ) : (
            <div className="space-y-8">
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/80 dark:bg-slate-900/60 p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Report context</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Period</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{leaveReport.period?.from_date ?? fromDate} to {leaveReport.period?.to_date ?? toDate}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">On-leave snapshot</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{leaveReport.period?.as_of ?? leaveAsOf}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Balance year</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{leaveReport.period?.balance_year ?? leaveBalanceYear}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Department filter</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{leaveDeptFilter || 'All departments'}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                <SummaryCard label="Staff in scope" sub="Active, non-admin" value={leaveReport.staff_in_scope ?? 0} />
                <SummaryCard
                  label="On leave (snapshot)"
                  sub={`As of ${leaveReport.period?.as_of ?? leaveAsOf}`}
                  value={leaveReport.on_leave_as_of_count ?? 0}
                  color="text-sky-600 dark:text-sky-400"
                />
                <SummaryCard
                  label="Leave taken (days)"
                  sub="Approved, in period"
                  value={Number(leaveReport.leave_totals_in_period?.approved_days ?? 0).toFixed(1)}
                  color="text-green-600 dark:text-green-400"
                />
                <SummaryCard
                  label="Pending (requests)"
                  sub="In workflow, in period"
                  value={leaveReport.leave_totals_in_period?.pending_requests ?? 0}
                  color="text-violet-700 dark:text-violet-300"
                />
              </div>

              {leaveReportSection === 'on_leave' && (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-gray-800 dark:text-white mb-1">Employee on leave</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Approved leave overlapping snapshot date {leaveReport.period?.as_of ?? leaveAsOf}.</p>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto max-h-[28rem] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dept</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Branch</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Tel</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Leave type</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dates</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredOnLeaveRows.map((r) => (
                        <tr key={r.id || `${r.user_id}-${r.start_date}-${r.end_date}`} className="text-gray-700 dark:text-gray-300">
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{r.email}</div>
                          </td>
                          <td className="px-4 py-2">{r.department ?? '-'}</td>
                          <td className="px-4 py-2">{r.branch_name || '-'}</td>
                          <td className="px-4 py-2">{r.phone || '-'}</td>
                          <td className="px-4 py-2">{r.leave_type_name || '-'}</td>
                          <td className="px-4 py-2 whitespace-nowrap tabular-nums text-xs">{formatDate(r.start_date)} - {formatDate(r.end_date)} ({Number(r.days_requested ?? 0).toFixed(1)} d)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredOnLeaveRows.length && (
                    <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No employees on leave for selected filters.</p>
                  )}
                </div>
              </div>
              )}

              {leaveReportSection === 'approved' && (
              <div>
                <div className="mb-3">
                  <h2 className="font-semibold text-gray-800 dark:text-white mb-1">Employee leave approved</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Approved leave requests overlapping selected period.</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto max-h-[28rem] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dept</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Leave type</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dates</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Days</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredApprovedRows.map((r) => (
                        <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{r.email}</div>
                          </td>
                          <td className="px-4 py-2">{r.department ?? '-'}</td>
                          <td className="px-4 py-2">{r.leave_type_name ?? '-'}</td>
                          <td className="px-4 py-2 whitespace-nowrap tabular-nums">{formatDate(r.start_date)} - {formatDate(r.end_date)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(r.days_requested ?? 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredApprovedRows.length && (
                    <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No approved leave rows for selected filters.</p>
                  )}
                </div>
              </div>
              )}

              {leaveReportSection === 'pending' && (
              <div>
                <div className="mb-3">
                  <h2 className="font-semibold text-gray-800 dark:text-white mb-1">Employee leave pending for approval</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Pending/returned requests overlapping selected period.</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto max-h-[28rem] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dept</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Leave type</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dates</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Status</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Days</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredPendingRows.map((r) => (
                        <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{r.email}</div>
                          </td>
                          <td className="px-4 py-2">{r.department ?? '-'}</td>
                          <td className="px-4 py-2">{r.leave_type_name ?? '-'}</td>
                          <td className="px-4 py-2 whitespace-nowrap tabular-nums">{formatDate(r.start_date)} - {formatDate(r.end_date)}</td>
                          <td className="px-4 py-2">{r.status ?? '-'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(r.days_requested ?? 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredPendingRows.length && (
                    <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No pending leave rows for selected filters.</p>
                  )}
                </div>
              </div>
              )}

              {leaveReportSection === 'department' && (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-gray-800 dark:text-white mb-1">By department</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Headcount, snapshot on leave, approved vs pending days in the period (overlap), and staff with no approved leave touching the period.
                    </p>
                  </div>
                  <button type="button" onClick={exportLeaveDepartmentCsv} disabled={!leaveReport} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
                    Download table CSV
                  </button>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Department</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Active staff</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">On leave</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Requests</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Days (all)</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Taken (approved days)</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Pending days</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Pending reqs</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">No approved in period</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(leaveReport.department_breakdown || []).map((row) => (
                        <tr key={row.department} className="text-gray-700 dark:text-gray-300">
                          <td className="px-4 py-3 font-medium">{row.department || '-'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.active_staff ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-sky-700 dark:text-sky-300">{row.on_leave_as_of ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.requests_in_period ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.total_days_in_period ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-green-700 dark:text-green-300">{row.approved_days_in_period ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-violet-700 dark:text-violet-300">{row.pending_days_in_period ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-violet-700 dark:text-violet-300">{row.pending_requests_in_period ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-amber-800 dark:text-amber-200">{row.no_approved_leave_in_period ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!(leaveReport.department_breakdown || []).length && (
                    <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No department rows yet - add departments on user profiles or import staff with a department column.</p>
                  )}
                </div>
              </div>
              )}

              {leaveReportSection === 'balances' && (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-gray-800 dark:text-white mb-1">Employee leave balances (by type)</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Filter by leave type to quickly audit who has this entitlement and the remaining days for calendar year{' '}
                      <span className="font-mono tabular-nums">{leaveReport.period?.balance_year ?? leaveBalanceYear}</span>
                      .
                    </p>
                  </div>
                  <button type="button" onClick={exportLeaveReportXlsx} disabled={!leaveReport} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
                    Download XLSX
                  </button>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto max-h-[28rem] overflow-y-auto mb-6">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dept</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Branch</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Tel</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Leave type</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Allocated</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Used</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredBalanceRows.map((r, i) => (
                        <tr key={`${r.user_id}-${r.leave_type_name}-${i}`} className="text-gray-700 dark:text-gray-300">
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{r.email}</div>
                          </td>
                          <td className="px-4 py-2">{r.department ?? '-'}</td>
                          <td className="px-4 py-2">{r.branch_name || '-'}</td>
                          <td className="px-4 py-2">{r.phone || '-'}</td>
                          <td className="px-4 py-2">{r.leave_type_name ?? '-'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(r.allocated_days ?? 0).toFixed(1)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(r.used_days ?? 0).toFixed(1)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-300">{Number(r.remaining_days ?? 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!(leaveReport.staff_leave_balance_rows || []).length && (
                    <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No balance rows in scope — check leave types and entitlements.</p>
                  )}
                </div>
              </div>
              )}

              {leaveReportSection === 'activity' && (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-gray-800 dark:text-white mb-1">By person: leave taken vs pending</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Same period overlap. <strong className="text-gray-700 dark:text-gray-300">Taken</strong> = approved days; <strong className="text-gray-700 dark:text-gray-300">Pending</strong> = days in workflow. Up to 400 rows.
                    </p>
                  </div>
                  <button type="button" onClick={exportLeaveActivityCsv} disabled={!leaveReport} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
                    Download table CSV
                  </button>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto max-h-[28rem] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dept</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Branch</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Tel</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Taken (days)</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Taken (reqs)</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Pending (days)</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Pending (reqs)</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">All days</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(leaveReport.staff_leave_activity || []).map((r, i) => (
                        <tr key={`${r.email}-${i}`} className="text-gray-700 dark:text-gray-300">
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{r.email}</div>
                          </td>
                          <td className="px-4 py-2">{r.department ?? '-'}</td>
                          <td className="px-4 py-2">{r.branch_name || '-'}</td>
                          <td className="px-4 py-2">{r.phone || '-'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-300">{Number(r.approved_days ?? 0).toFixed(1)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.approved_requests ?? 0}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-violet-700 dark:text-violet-300">{Number(r.pending_days ?? 0).toFixed(1)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-violet-700 dark:text-violet-300">{r.pending_requests ?? 0}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(r.total_days ?? 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!(leaveReport.staff_leave_activity || []).length && (
                    <p className="px-4 py-8 text-sm text-gray-500 dark:text-gray-400 text-center">No overlapping requests in this period for staff in scope.</p>
                  )}
                </div>
              </div>
              )}

              {leaveReportSection === 'top_requesters' && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-gray-800 dark:text-white mb-1">Top requesters by volume (period)</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Most requests overlapping the range (any status), up to 30.</p>
                  </div>
                  <button type="button" onClick={exportLeaveTopRequestersCsv} disabled={!leaveReport} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
                    Download table CSV
                  </button>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/80">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Employee</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Dept</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Branch</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Tel</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Requests</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase">Days</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(leaveReport.top_requesters || []).map((r, i) => (
                        <tr key={i} className="text-gray-700 dark:text-gray-300">
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.full_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{r.email}</div>
                          </td>
                          <td className="px-4 py-2">{r.department ?? '-'}</td>
                          <td className="px-4 py-2">{r.branch_name || '-'}</td>
                          <td className="px-4 py-2">{r.phone || '-'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.total_requests ?? 0}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.total_days ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          )}
        </>
      )}
      </div>
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
