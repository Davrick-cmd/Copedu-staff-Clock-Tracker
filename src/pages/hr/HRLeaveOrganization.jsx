import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../services/api';
import { ROUTES } from '../../utils/constants';
import { useToast } from '../../hooks/useToast';
import { LoadingSpinner } from '../../components/LoadingSpinner';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending_manager,pending_hod,pending_hr,submitted,draft,returned', label: 'In workflow (all)' },
  { value: 'pending_manager', label: 'Awaiting supervisor' },
  { value: 'pending_hod', label: 'Legacy: pending HOD' },
  { value: 'pending_hr', label: 'Legacy: pending HR' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusLabel(s) {
  const m = {
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    returned: 'Returned',
    pending_manager: 'Awaiting supervisor',
    pending_hod: 'Legacy: pending HOD',
    pending_hr: 'Legacy: pending HR',
    submitted: 'Submitted',
    draft: 'Draft',
  };
  return m[s] || s;
}

export function HRLeaveOrganization() {
  const toast = useToast();
  const [filtersMeta, setFiltersMeta] = useState({ departments: [] });
  const [onDate, setOnDate] = useState(todayISO);
  const [deptOnLeave, setDeptOnLeave] = useState('');
  const [onLeaveData, setOnLeaveData] = useState(null);
  const [loadingOnLeave, setLoadingOnLeave] = useState(true);

  const [orgDept, setOrgDept] = useState('');
  const [orgStatus, setOrgStatus] = useState('');
  const [orgFrom, setOrgFrom] = useState('');
  const [orgTo, setOrgTo] = useState('');
  const [orgData, setOrgData] = useState(null);
  const [loadingOrg, setLoadingOrg] = useState(true);
  const [members, setMembers] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [savingEditId, setSavingEditId] = useState('');
  const [assignForm, setAssignForm] = useState({
    staff_user_id: '',
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });
  const [editForm, setEditForm] = useState(null);

  useEffect(() => {
    api.getLeaveHrFilters().then(setFiltersMeta).catch(() => setFiltersMeta({ departments: [] }));
    api.getLeaveTypes().then(setLeaveTypes).catch(() => setLeaveTypes([]));
    api.getLeaveTeamBalances().then((d) => setMembers(d?.members || [])).catch(() => setMembers([]));
  }, []);

  const loadOnLeave = useCallback(async () => {
    setLoadingOnLeave(true);
    try {
      const params = { on_date: onDate };
      if (deptOnLeave) params.department = deptOnLeave;
      const data = await api.getLeaveOnLeave(params);
      setOnLeaveData(data);
    } catch {
      toast('Failed to load who is on leave', 'error');
    } finally {
      setLoadingOnLeave(false);
    }
  }, [onDate, deptOnLeave]);

  const loadOrg = useCallback(async () => {
    setLoadingOrg(true);
    try {
      const params = { limit: 500 };
      if (orgDept) params.department = orgDept;
      if (orgStatus) params.status = orgStatus;
      if (orgFrom) params.from_date = orgFrom;
      if (orgTo) params.to_date = orgTo;
      const data = await api.getLeaveOrgRequests(params);
      setOrgData(data);
    } catch {
      toast('Failed to load organization leave requests', 'error');
    } finally {
      setLoadingOrg(false);
    }
  }, [orgDept, orgStatus, orgFrom, orgTo]);

  useEffect(() => {
    loadOnLeave();
  }, [loadOnLeave]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  const deptSelectClass =
    'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[12rem]';
  const activeMembers = useMemo(
    () => (members || []).filter((m) => (m?.user_id || '').trim() && (m?.full_name || '').trim()),
    [members],
  );
  const canEdit = (status) => !['cancelled', 'rejected'].includes(String(status || '').toLowerCase());

  const submitAssign = async (e) => {
    e.preventDefault();
    if (!assignForm.staff_user_id || !assignForm.leave_type_id || !assignForm.start_date || !assignForm.end_date) {
      toast('Select employee, leave type, and dates', 'error');
      return;
    }
    setAssigning(true);
    try {
      await api.assignLeaveToStaff({
        staff_user_id: assignForm.staff_user_id,
        leave_type_id: assignForm.leave_type_id,
        start_date: assignForm.start_date,
        end_date: assignForm.end_date,
        reason: assignForm.reason || undefined,
      });
      toast('Leave added successfully', 'success');
      setAssignForm((p) => ({ ...p, start_date: '', end_date: '', reason: '' }));
      loadOnLeave();
      loadOrg();
    } catch (err) {
      toast(err?.response?.data?.detail || 'Could not add leave', 'error');
    } finally {
      setAssigning(false);
    }
  };

  const startEdit = (row) => {
    setEditForm({
      id: row.id,
      leave_type_id: row.leave_type_id || '',
      start_date: row.start_date || '',
      end_date: row.end_date || '',
      reason: row.reason || '',
    });
  };

  const saveEdit = async () => {
    if (!editForm) return;
    if (!editForm.leave_type_id || !editForm.start_date || !editForm.end_date) {
      toast('Leave type and dates are required', 'error');
      return;
    }
    setSavingEditId(editForm.id);
    try {
      await api.updateLeaveRequest(editForm.id, {
        leave_type_id: editForm.leave_type_id,
        start_date: editForm.start_date,
        end_date: editForm.end_date,
        reason: editForm.reason || undefined,
      });
      toast('Leave updated', 'success');
      setEditForm(null);
      loadOnLeave();
      loadOrg();
    } catch (err) {
      toast(err?.response?.data?.detail || 'Could not update leave', 'error');
    } finally {
      setSavingEditId('');
    }
  };

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Organization leave</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">HR/Admin can add approved leave and edit existing requests.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to={ROUTES.HR.LEAVE_OVERVIEW} className="text-primary-600 dark:text-primary-400 hover:underline">
            Leave overview
          </Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <Link to={ROUTES.HR.LEAVE} className="text-primary-600 dark:text-primary-400 hover:underline">
            Approvals
          </Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <Link to={ROUTES.HR.LEAVE_BALANCES} className="text-primary-600 dark:text-primary-400 hover:underline">
            Balances
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 dark:text-white">Add leave (HR/Admin)</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
          This saves leave as approved immediately and updates employee leave balances.
        </p>
        <form onSubmit={submitAssign} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Employee</label>
            <select
              required
              value={assignForm.staff_user_id}
              onChange={(e) => setAssignForm((p) => ({ ...p, staff_user_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Select…</option>
              {activeMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Leave type</label>
            <select
              required
              value={assignForm.leave_type_id}
              onChange={(e) => setAssignForm((p) => ({ ...p, leave_type_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Select…</option>
              {leaveTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
            <input
              type="date"
              required
              value={assignForm.start_date}
              onChange={(e) => setAssignForm((p) => ({ ...p, start_date: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
            <input
              type="date"
              required
              value={assignForm.end_date}
              onChange={(e) => setAssignForm((p) => ({ ...p, end_date: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Reason</label>
            <input
              value={assignForm.reason}
              onChange={(e) => setAssignForm((p) => ({ ...p, reason: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              placeholder="Optional"
            />
          </div>
          <button
            type="submit"
            disabled={assigning}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {assigning ? 'Saving…' : 'Add leave'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-emerald-50/80 dark:bg-emerald-900/20">
          <h2 className="font-semibold text-gray-900 dark:text-white">Who is on leave</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            Approved leave that overlaps the date you pick (organization-wide).
          </p>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={deptSelectClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Department</label>
            <select value={deptOnLeave} onChange={(e) => setDeptOnLeave(e.target.value)} className={deptSelectClass}>
              <option value="">All departments</option>
              {filtersMeta.departments?.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => loadOnLeave()}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            Refresh
          </button>
          {onLeaveData && (
            <span className="text-sm text-gray-600 dark:text-gray-400 ml-auto">
              <span className="font-semibold text-gray-900 dark:text-white">{onLeaveData.count}</span> people
            </span>
          )}
        </div>
        <div className="overflow-x-auto max-h-[min(24rem,45vh)] overflow-y-auto border-t border-gray-200 dark:border-gray-700">
          {loadingOnLeave && !onLeaveData ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Department</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Dates</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {(onLeaveData?.rows || []).map((r) => (
                  <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.full_name}</div>
                      <div className="text-xs text-gray-500">{r.email}</div>
                    </td>
                    <td className="px-4 py-2">{r.department || '-'}</td>
                    <td className="px-4 py-2">{r.leave_type_name}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {r.start_date} → {r.end_date}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.days_requested}</td>
                  </tr>
                ))}
                {!loadingOnLeave && !(onLeaveData?.rows || []).length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                      No approved leave overlaps this date{deptOnLeave ? ` in ${deptOnLeave}` : ''}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
          <h2 className="font-semibold text-gray-900 dark:text-white">All organization leave requests</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            Filter by department, status, and leave period overlap. If you clear both period dates, the last 365 days of
            activity are shown (by request date).
          </p>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Department</label>
            <select value={orgDept} onChange={(e) => setOrgDept(e.target.value)} className={deptSelectClass}>
              <option value="">All</option>
              {filtersMeta.departments?.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
            <select value={orgStatus} onChange={(e) => setOrgStatus(e.target.value)} className={`${deptSelectClass} min-w-[14rem]`}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'any'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Period from</label>
            <input
              type="date"
              value={orgFrom}
              onChange={(e) => setOrgFrom(e.target.value)}
              className={deptSelectClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Period to</label>
            <input type="date" value={orgTo} onChange={(e) => setOrgTo(e.target.value)} className={deptSelectClass} />
          </div>
          <button
            type="button"
            onClick={() => loadOrg()}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
          >
            Apply filters
          </button>
        </div>
        <div className="overflow-x-auto max-h-[min(32rem,55vh)] overflow-y-auto border-t border-gray-200 dark:border-gray-700">
          {loadingOrg && !orgData ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Employee</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Dept</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Dates</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Days</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {(orgData?.rows || []).map((r) => (
                  <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.full_name}</div>
                      <div className="text-xs text-gray-500">{r.email}</div>
                    </td>
                    <td className="px-4 py-2">{r.department || '-'}</td>
                    <td className="px-4 py-2">{r.leave_type_name}</td>
                    <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                      {r.start_date} → {r.end_date}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.days_requested}</td>
                    <td className="px-4 py-2">{statusLabel(r.status)}</td>
                    <td className="px-4 py-2">
                      {canEdit(r.status) && (
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="text-primary-600 dark:text-primary-400 hover:underline text-sm"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loadingOrg && !(orgData?.rows || []).length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                      No requests match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {orgData?.rows?.length >= (orgData?.limit || 500) && (
          <p className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20">
            Showing up to {orgData.limit} rows. Narrow filters to see specific periods or departments.
          </p>
        )}
      </section>
      {editForm && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => setEditForm(null)}>
          <div
            className="w-full max-w-xl rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit leave request</h3>
            <div className="grid gap-3 sm:grid-cols-2 mt-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Leave type</label>
                <select
                  value={editForm.leave_type_id}
                  onChange={(e) => setEditForm((p) => ({ ...p, leave_type_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                >
                  {leaveTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={editForm.start_date}
                  onChange={(e) => setEditForm((p) => ({ ...p, start_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={editForm.end_date}
                  onChange={(e) => setEditForm((p) => ({ ...p, end_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Reason</label>
                <textarea
                  rows={3}
                  value={editForm.reason}
                  onChange={(e) => setEditForm((p) => ({ ...p, reason: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditForm(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingEditId === editForm.id}
                onClick={saveEdit}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {savingEditId === editForm.id ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
