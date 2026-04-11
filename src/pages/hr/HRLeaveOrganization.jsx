import { useCallback, useEffect, useState } from 'react';
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

  useEffect(() => {
    api.getLeaveHrFilters().then(setFiltersMeta).catch(() => setFiltersMeta({ departments: [] }));
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

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Organization leave</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            HR and Admin: see who is off on a given day, and browse all staff leave with department and date filters.
          </p>
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
                  </tr>
                ))}
                {!loadingOrg && !(orgData?.rows || []).length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
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
    </div>
  );
}
