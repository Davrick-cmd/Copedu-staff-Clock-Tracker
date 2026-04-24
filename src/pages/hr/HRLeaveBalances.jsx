import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { addMonths, format, getDay, getDaysInMonth, startOfMonth, subMonths } from 'date-fns';
import * as api from '../../services/api';
import { useToast } from '../../hooks/useToast';

function toCsvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function HRLeaveBalances() {
  const toast = useToast();
  const profile = useSelector((s) => s.auth.profile);
  const [year, setYear] = useState(new Date().getFullYear());
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recoBusy, setRecoBusy] = useState(false);
  const [adjustments, setAdjustments] = useState([]);
  const [adjLoading, setAdjLoading] = useState(false);
  const [adjBusyId, setAdjBusyId] = useState('');
  const [creatingAdj, setCreatingAdj] = useState(false);
  const [assigningType, setAssigningType] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [adjustForm, setAdjustForm] = useState({
    target_user_id: '',
    leave_type_id: '',
    year: new Date().getFullYear(),
    allocated_days: '',
    reason: '',
  });
  const [assignTypeForm, setAssignTypeForm] = useState({
    target_user_id: '',
    leave_type_id: '',
    year: new Date().getFullYear(),
    allocated_days: '',
    reason: '',
  });
  const [newTypeForm, setNewTypeForm] = useState({ code: '', name: '', default_days: '0' });
  const [holidayRows, setHolidayRows] = useState([]);
  const [holidayForm, setHolidayForm] = useState({ day_date: '', reason: '' });
  const [holidayBusy, setHolidayBusy] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getLeaveBalances({ year });
      setRows(data?.rows || []);
    } catch {
      toast('Failed to load leave balances', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [year]);

  const loadAdjustments = async () => {
    setAdjLoading(true);
    try {
      const data = await api.getLeaveBalanceAdjustments({ status: 'pending,approved,rejected', limit: 120 });
      setAdjustments(data?.rows || []);
    } catch {
      toast('Failed to load entitlement adjustment approvals', 'error');
    } finally {
      setAdjLoading(false);
    }
  };

  useEffect(() => {
    loadAdjustments();
  }, []);

  useEffect(() => {
    api.getLeaveTypes().then(setLeaveTypes).catch(() => setLeaveTypes([]));
  }, []);

  const loadHolidayCalendar = async () => {
    try {
      const data = await api.getLeaveNonWorkingDays({ year });
      setHolidayRows(data?.rows || []);
    } catch {
      toast('Failed to load HR holiday calendar', 'error');
    }
  };

  useEffect(() => {
    loadHolidayCalendar();
  }, [year]);

  useEffect(() => {
    const y = calendarMonth.getFullYear();
    if (y !== year) setYear(y);
  }, [calendarMonth]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.department || '').toLowerCase().includes(q) ||
      (r.leave_name || '').toLowerCase().includes(q)
    ));
  }, [rows, query]);

  const employeeOptions = useMemo(() => {
    const byId = new Map();
    rows.forEach((r) => {
      if (!r.user_id) return;
      if (!byId.has(r.user_id)) {
        byId.set(r.user_id, {
          user_id: r.user_id,
          full_name: r.full_name || '',
          email: r.email || '',
          department: r.department || '',
        });
      }
    });
    return Array.from(byId.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [rows]);

  const leaveTypeMasterOptions = useMemo(
    () => (leaveTypes || []).map((t) => ({ id: t.id, name: t.name || '', default_days: Number(t.default_days ?? 0) })),
    [leaveTypes],
  );

  const leaveTypeOptions = useMemo(
    () => leaveTypeMasterOptions.map((t) => ({ leave_type_id: t.id, leave_name: t.name })),
    [leaveTypeMasterOptions],
  );

  const recomputeStatutoryAnnual = async () => {
    const ok = window.confirm(
      `Apply year-end rollover for ${year}? This sets each employee allocation to current-year default entitlement plus what remained from ${year - 1}.`
    );
    if (!ok) return;
    setRecoBusy(true);
    try {
      await api.postLeaveHrRecomputeStatutoryAnnual({ year });
      toast('Year-end rollover applied for all staff', 'success');
      await load();
    } catch (e) {
      toast(e?.response?.data?.detail || e?.message || 'Failed to recalculate', 'error');
    } finally {
      setRecoBusy(false);
    }
  };

  const exportCsv = () => {
    const headers = ['Employee', 'Email', 'Department', 'Leave Type', 'Allocated Days', 'Used Days', 'Remaining Days'];
    const body = filtered.map((r) => [
      r.full_name,
      r.email,
      r.department,
      r.leave_name,
      r.allocated_days,
      r.used_days,
      r.remaining_days,
    ]);
    const csv = [headers.join(','), ...body.map((line) => line.map(toCsvCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-balances-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Leave balances CSV downloaded', 'success');
  };

  const exportAdjustmentsCsv = () => {
    const headers = [
      'Status',
      'Employee',
      'Employee Email',
      'Department',
      'Leave Type',
      'Year',
      'Requested Allocated Days',
      'Reason',
      'Requested By',
      'Supervisor Approver',
      'Approved/Rejected By',
      'Rejection Comment',
      'Created At',
      'Reviewed At',
    ];
    const body = (adjustments || []).map((a) => [
      a.status || '',
      a.target_user_name || '',
      a.target_user_email || '',
      a.target_user_department || '',
      a.leave_type_name || '',
      a.year ?? '',
      a.requested_allocated_days ?? '',
      a.reason || '',
      a.requested_by_name || '',
      a.current_approver_name || '',
      a.approved_by_name || '',
      a.rejection_comment || '',
      a.created_at || '',
      a.approved_at || '',
    ]);
    const csv = [headers.join(','), ...body.map((line) => line.map(toCsvCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-entitlement-adjustment-audit-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Adjustment audit CSV downloaded', 'success');
  };

  const onAdjustTargetChange = (next) => {
    setAdjustForm((prev) => {
      const selected = rows.find((r) => r.user_id === next && r.leave_type_id === prev.leave_type_id);
      return {
        ...prev,
        target_user_id: next,
        allocated_days: selected ? String(selected.allocated_days ?? '') : prev.allocated_days,
      };
    });
  };

  const onAdjustTypeChange = (next) => {
    setAdjustForm((prev) => {
      const selected = rows.find((r) => r.user_id === prev.target_user_id && r.leave_type_id === next);
      return {
        ...prev,
        leave_type_id: next,
        allocated_days: selected ? String(selected.allocated_days ?? '') : prev.allocated_days,
      };
    });
  };

  const submitAdjustment = async (e) => {
    e.preventDefault();
    if (!adjustForm.target_user_id || !adjustForm.leave_type_id || adjustForm.allocated_days === '') {
      toast('Choose employee, leave type, and allocated days', 'error');
      return;
    }
    setCreatingAdj(true);
    try {
      await api.createLeaveBalanceAdjustment({
        target_user_id: adjustForm.target_user_id,
        leave_type_id: adjustForm.leave_type_id,
        year: Number(adjustForm.year) || year,
        allocated_days: Number(adjustForm.allocated_days),
        reason: adjustForm.reason || undefined,
      });
      toast('Adjustment submitted for supervisor approval', 'success');
      setAdjustForm((p) => ({ ...p, reason: '' }));
      await Promise.all([load(), loadAdjustments()]);
    } catch (e2) {
      toast(e2?.response?.data?.detail || e2?.message || 'Failed to submit adjustment', 'error');
    } finally {
      setCreatingAdj(false);
    }
  };

  const approveAdjustment = async (id) => {
    setAdjBusyId(id);
    try {
      await api.approveLeaveBalanceAdjustment(id);
      toast('Adjustment approved and leave balance updated', 'success');
      await Promise.all([load(), loadAdjustments()]);
    } catch (e) {
      toast(e?.response?.data?.detail || e?.message || 'Failed to approve adjustment', 'error');
    } finally {
      setAdjBusyId('');
    }
  };

  const rejectAdjustment = async (id) => {
    const comment = window.prompt('Reason for rejection (required):', '');
    if (!comment || !comment.trim()) return;
    setAdjBusyId(id);
    try {
      await api.rejectLeaveBalanceAdjustment(id, comment.trim());
      toast('Adjustment rejected', 'success');
      await loadAdjustments();
    } catch (e) {
      toast(e?.response?.data?.detail || e?.message || 'Failed to reject adjustment', 'error');
    } finally {
      setAdjBusyId('');
    }
  };

  const submitAssignType = async (e) => {
    e.preventDefault();
    if (!assignTypeForm.target_user_id || !assignTypeForm.leave_type_id) {
      toast('Choose employee and leave type', 'error');
      return;
    }
    setAssigningType(true);
    try {
      await api.assignLeaveTypeToEmployee({
        target_user_id: assignTypeForm.target_user_id,
        leave_type_id: assignTypeForm.leave_type_id,
        year: Number(assignTypeForm.year) || year,
        allocated_days: assignTypeForm.allocated_days === '' ? undefined : Number(assignTypeForm.allocated_days),
        reason: assignTypeForm.reason || undefined,
      });
      toast('Leave type assignment submitted for supervisor approval', 'success');
      setAssignTypeForm((p) => ({ ...p, reason: '' }));
      await Promise.all([load(), loadAdjustments()]);
    } catch (e) {
      toast(e?.response?.data?.detail || e?.message || 'Failed to assign leave type', 'error');
    } finally {
      setAssigningType(false);
    }
  };

  const submitCreateType = async (e) => {
    e.preventDefault();
    const code = (newTypeForm.code || '').trim();
    const name = (newTypeForm.name || '').trim();
    if (!code || !name) {
      toast('Code and name are required', 'error');
      return;
    }
    const dd = Number(newTypeForm.default_days);
    if (Number.isNaN(dd) || dd < 0) {
      toast('Default days must be zero or a positive number', 'error');
      return;
    }
    setCreatingType(true);
    try {
      await api.createLeaveType({ code, name, default_days: dd });
      toast('Leave type created', 'success');
      setNewTypeForm({ code: '', name: '', default_days: '0' });
      const [types] = await Promise.all([api.getLeaveTypes(), load()]);
      setLeaveTypes(types || []);
    } catch (e) {
      toast(e?.response?.data?.detail || e?.message || 'Failed to create leave type', 'error');
    } finally {
      setCreatingType(false);
    }
  };

  const addHoliday = async (e) => {
    e.preventDefault();
    if (!holidayForm.day_date) {
      toast('Select a date first', 'error');
      return;
    }
    setHolidayBusy(true);
    try {
      await api.createLeaveNonWorkingDay({
        day_date: holidayForm.day_date,
        reason: holidayForm.reason,
      });
      toast('Holiday/non-working day added', 'success');
      setHolidayForm({ day_date: '', reason: '' });
      await loadHolidayCalendar();
    } catch (e2) {
      toast(e2?.response?.data?.detail || e2?.message || 'Failed to add holiday', 'error');
    } finally {
      setHolidayBusy(false);
    }
  };

  const removeHoliday = async (id) => {
    if (!window.confirm('Remove this non-working day from HR calendar?')) return;
    setHolidayBusy(true);
    try {
      await api.deleteLeaveNonWorkingDay(id);
      toast('Holiday removed', 'success');
      await loadHolidayCalendar();
    } catch (e2) {
      toast(e2?.response?.data?.detail || e2?.message || 'Failed to remove holiday', 'error');
    } finally {
      setHolidayBusy(false);
    }
  };

  const holidayByDate = useMemo(() => {
    const m = new Map();
    (holidayRows || []).forEach((h) => {
      const key = String(h.day_date || '').slice(0, 10);
      if (key) m.set(key, h);
    });
    return m;
  }, [holidayRows]);

  const calendarCells = useMemo(() => {
    const first = startOfMonth(calendarMonth);
    const startOffset = getDay(first); // 0=Sun
    const total = getDaysInMonth(first);
    const cells = [];
    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let d = 1; d <= total; d += 1) {
      const dt = new Date(first.getFullYear(), first.getMonth(), d);
      const iso = format(dt, 'yyyy-MM-dd');
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      const holiday = holidayByDate.get(iso) || null;
      cells.push({ iso, d, isWeekend, holiday });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [calendarMonth, holidayByDate]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Leave Balances</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
        Numbers come from each employee&apos;s <code className="text-xs bg-gray-100 dark:bg-gray-900 px-1 rounded">leave_balances</code> rows
        (including data imported from OrangeHRM). They are not recalculated on every page load.
      </p>
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="number"
          min="2020"
          max="2035"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 w-28 text-gray-900 dark:text-white"
        />
        <input
          type="search"
          placeholder="Search employee, email, department, leave type..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 w-full max-w-lg text-gray-900 dark:text-white"
        />
        <button type="button" onClick={exportCsv} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
          Export CSV
        </button>
        <button
          type="button"
          disabled={recoBusy || loading}
          onClick={recomputeStatutoryAnnual}
          className="px-4 py-2 rounded-lg border border-amber-600 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50 text-sm font-medium"
        >
          {recoBusy ? 'Applying rollover…' : 'Apply year-end rollover (all staff)'}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Request leave entitlement update</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Use this when a staff member is missing a leave entitlement or imported allocations need correction. Changes require approval by your assigned supervisor.
          </p>
        </div>
        <form onSubmit={submitAdjustment} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Employee</label>
            <select
              value={adjustForm.target_user_id}
              onChange={(e) => onAdjustTargetChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            >
              <option value="">Select employee…</option>
              {employeeOptions.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name} {u.department ? `(${u.department})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Leave type</label>
            <select
              value={adjustForm.leave_type_id}
              onChange={(e) => onAdjustTypeChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            >
              <option value="">Select type…</option>
              {leaveTypeOptions.map((t) => (
                <option key={t.leave_type_id} value={t.leave_type_id}>{t.leave_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Year</label>
            <input
              type="number"
              min="2020"
              max="2035"
              value={adjustForm.year}
              onChange={(e) => setAdjustForm((p) => ({ ...p, year: Number(e.target.value) || year }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Allocated days</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={adjustForm.allocated_days}
              onChange={(e) => setAdjustForm((p) => ({ ...p, allocated_days: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div className="sm:col-span-2 xl:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason</label>
            <input
              type="text"
              value={adjustForm.reason}
              onChange={(e) => setAdjustForm((p) => ({ ...p, reason: e.target.value }))}
              placeholder="Migration fix, policy update, missing entitlement, etc."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div className="sm:col-span-2 xl:col-span-6 flex justify-end">
            <button type="submit" disabled={creatingAdj} className="px-5 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
              {creatingAdj ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Assign leave type to employee</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Submit a request to add a leave type entitlement for an employee. Your supervisor must approve before balances update.
          </p>
        </div>
        <form onSubmit={submitAssignType} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Employee</label>
            <select
              value={assignTypeForm.target_user_id}
              onChange={(e) => setAssignTypeForm((p) => ({ ...p, target_user_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            >
              <option value="">Select employee…</option>
              {employeeOptions.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name} {u.department ? `(${u.department})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Leave type</label>
            <select
              value={assignTypeForm.leave_type_id}
              onChange={(e) => {
                const selected = leaveTypeMasterOptions.find((t) => t.id === e.target.value);
                setAssignTypeForm((p) => ({
                  ...p,
                  leave_type_id: e.target.value,
                  allocated_days: selected ? String(selected.default_days ?? 0) : p.allocated_days,
                }));
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            >
              <option value="">Select type…</option>
              {leaveTypeMasterOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Year</label>
            <input
              type="number"
              min="2020"
              max="2035"
              value={assignTypeForm.year}
              onChange={(e) => setAssignTypeForm((p) => ({ ...p, year: Number(e.target.value) || year }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Allocated days (optional)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={assignTypeForm.allocated_days}
              onChange={(e) => setAssignTypeForm((p) => ({ ...p, allocated_days: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div className="sm:col-span-2 xl:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason</label>
            <input
              type="text"
              value={assignTypeForm.reason}
              onChange={(e) => setAssignTypeForm((p) => ({ ...p, reason: e.target.value }))}
              placeholder="Assigning missing entitlement to employee"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div className="sm:col-span-2 xl:col-span-6 flex justify-end">
            <button type="submit" disabled={assigningType} className="px-5 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
              {assigningType ? 'Submitting…' : 'Submit assignment'}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create leave type (HR)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            HR can create leave types. Only Admin can delete leave types.
          </p>
        </div>
        <form onSubmit={submitCreateType} className="grid gap-4 sm:grid-cols-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Code</label>
            <input
              value={newTypeForm.code}
              onChange={(e) => setNewTypeForm((p) => ({ ...p, code: e.target.value }))}
              placeholder="e.g. STUDY_LEAVE"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
            <input
              value={newTypeForm.name}
              onChange={(e) => setNewTypeForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Study leave"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Default days</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={newTypeForm.default_days}
              onChange={(e) => setNewTypeForm((p) => ({ ...p, default_days: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button type="submit" disabled={creatingType} className="px-5 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
              {creatingType ? 'Creating…' : 'Create leave type'}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Working-day calendar (HR)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Weekends are auto non-working. Add government/public holidays here so leave requests exclude them automatically.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Rwanda known official holidays are auto-seeded yearly. Add EID dates manually each year when announced.
          </p>
        </div>
        <form onSubmit={addHoliday} className="grid gap-4 sm:grid-cols-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={holidayForm.day_date}
              onChange={(e) => setHolidayForm((p) => ({ ...p, day_date: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason *</label>
            <input
              type="text"
              value={holidayForm.reason}
              onChange={(e) => setHolidayForm((p) => ({ ...p, reason: e.target.value }))}
              placeholder="e.g. Labour Day (Government holiday)"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              required
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={holidayBusy} className="px-5 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
              {holidayBusy ? 'Saving…' : 'Add holiday'}
            </button>
          </div>
        </form>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30 p-3">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setCalendarMonth((m) => subMonths(m, 1))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Prev
            </button>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {format(calendarMonth, 'MMMM yyyy')}
            </div>
            <button
              type="button"
              onClick={() => setCalendarMonth((m) => addMonths(m, 1))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Next
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
              <div key={w} className="text-center py-1">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((c, i) => {
              if (!c) return <div key={`empty-${i}`} className="h-16 rounded-lg bg-transparent" />;
              const isHoliday = !!c.holiday;
              const base = c.isWeekend
                ? 'bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400'
                : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100';
              const holidayCls = isHoliday
                ? 'ring-2 ring-rose-400/80 dark:ring-rose-500/70 bg-rose-50 dark:bg-rose-900/25'
                : '';
              return (
                <div key={c.iso} className={`h-16 rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 ${base} ${holidayCls}`} title={c.holiday?.name || (c.isWeekend ? 'Weekend' : 'Working day')}>
                  <div className="text-xs font-semibold">{c.d}</div>
                  <div className="mt-1 text-[10px] leading-tight overflow-hidden text-ellipsis whitespace-nowrap">
                    {isHoliday ? (c.holiday?.name || 'Holiday') : (c.isWeekend ? 'Weekend' : 'Working')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Date</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Reason</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {holidayRows.map((h) => (
                <tr key={h.id}>
                  <td className="px-3 py-2 tabular-nums text-gray-700 dark:text-gray-300">{h.day_date}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{h.name || 'Public holiday'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeHoliday(h.id)}
                      disabled={holidayBusy}
                      className="px-2.5 py-1 rounded border border-red-300 text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!holidayRows.length && (
                <tr>
                  <td colSpan={3} className="px-4 py-5 text-center text-sm text-gray-500 dark:text-gray-400">
                    No holidays added for {year}. Weekends are still automatically excluded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Entitlement adjustment approvals (supervisor workflow)</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportAdjustmentsCsv} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              Download audit CSV
            </button>
            <button type="button" onClick={loadAdjustments} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              Refresh
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Employee</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Leave type</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Year</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Allocated</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Requested by</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Supervisor approver</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Status</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {!adjLoading && adjustments.map((a) => {
                const isMine = String(a.requested_by_user_id || '') === String(profile?.id || '');
                const canReview = a.status === 'pending' && String(a.current_approver_id || '') === String(profile?.id || '');
                return (
                  <tr key={a.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-3 py-2">
                      <div className="font-medium">{a.target_user_name || '-'}</div>
                      <div className="text-xs text-gray-500">{a.target_user_email || '-'}</div>
                    </td>
                    <td className="px-3 py-2">{a.leave_type_name || '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.year}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(a.requested_allocated_days ?? 0).toFixed(1)}</td>
                    <td className="px-3 py-2">
                      <div>{a.requested_by_name || '-'}</div>
                      <div className="text-xs text-gray-500">{a.reason || 'No reason provided'}</div>
                    </td>
                    <td className="px-3 py-2">{a.current_approver_name || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        a.status === 'approved'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : a.status === 'rejected'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {canReview ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={adjBusyId === a.id}
                            onClick={() => approveAdjustment(a.id)}
                            className="px-2.5 py-1 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={adjBusyId === a.id}
                            onClick={() => rejectAdjustment(a.id)}
                            className="px-2.5 py-1 rounded border border-red-300 text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {a.status === 'pending' && isMine
                            ? `Waiting for supervisor${a.current_approver_name ? ` (${a.current_approver_name})` : ''}`
                            : a.status === 'pending'
                              ? 'Awaiting assigned supervisor'
                              : (a.approved_by_name ? `Reviewed by ${a.approved_by_name}` : '—')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!adjLoading && !adjustments.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    No adjustment requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Employee</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Department</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Leave Type</th>
              <th className="px-4 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Allocated</th>
              <th className="px-4 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Used</th>
              <th className="px-4 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {!loading && filtered.map((r, i) => (
              <tr key={`${r.user_id}-${r.leave_name}-${i}`} className="text-sm text-gray-700 dark:text-gray-300">
                <td className="px-4 py-2">
                  <div className="font-medium">{r.full_name || '-'}</div>
                  <div className="text-xs text-gray-500">{r.email || '-'}</div>
                </td>
                <td className="px-4 py-2">{r.department || '-'}</td>
                <td className="px-4 py-2">{r.leave_name || '-'}</td>
                <td className="px-4 py-2 text-right">{r.allocated_days ?? 0}</td>
                <td className="px-4 py-2 text-right">{r.used_days ?? 0}</td>
                <td className="px-4 py-2 text-right">{r.remaining_days ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
