import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { ROUTES } from '../../utils/constants';
import { useSelector } from 'react-redux';

export function EmployeeLeave() {
  const toast = useToast();
  const profile = useSelector((s) => s.auth.profile);
  const canTeamBalances = ['manager', 'hod', 'hr', 'admin'].includes(profile?.role);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaveTab, setLeaveTab] = useState('apply');
  const [form, setForm] = useState({
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const [types, myRequests, myDash] = await Promise.all([
        api.getLeaveTypes(),
        api.getMyLeaveRequests(),
        api.getLeaveMyDashboard().catch(() => null),
      ]);
      setLeaveTypes(types);
      setRequests(myRequests);
      setDash(myDash);
    } catch {
      toast('Failed to load leave data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createAndSubmit = async (e) => {
    e.preventDefault();
    try {
      const created = await api.createLeaveRequest(form);
      await api.submitLeaveRequest(created.id);
      toast('Leave request submitted', 'success');
      setForm((p) => ({ ...p, start_date: '', end_date: '', reason: '' }));
      load();
    } catch (err) {
      toast(err?.response?.data?.detail || 'Failed to submit leave request', 'error');
    }
  };

  const cancelRequest = async (id) => {
    try {
      await api.cancelLeaveRequest(id, 'Cancelled by employee');
      toast('Leave request cancelled', 'success');
      load();
    } catch (err) {
      toast(err?.response?.data?.detail || 'Failed to cancel request', 'error');
    }
  };

  const balances = dash?.balances || [];
  const annualBalance =
    balances.find(
      (b) =>
        String(b.leave_code || '').toUpperCase() === 'ANNUAL' ||
        String(b.leave_name || '').toLowerCase().includes('annual')
    ) || null;
  const annualRemaining = annualBalance != null ? Number(annualBalance.remaining_days ?? 0) : null;

  const selectedType = leaveTypes.find((t) => t.id === form.leave_type_id);
  const selectedBalance = useMemo(() => {
    if (!selectedType) return null;
    const byId = balances.find((b) => b.leave_type_id === selectedType.id);
    if (byId) return byId;
    const name = (selectedType.name || '').trim().toLowerCase();
    const code = (selectedType.code || '').trim().toUpperCase();
    return (
      balances.find((b) => {
        if (code && String(b.leave_code || '').toUpperCase() === code) return true;
        return (b.leave_name || '').trim().toLowerCase() === name;
      }) || null
    );
  }, [balances, selectedType]);

  const selectedRemaining =
    selectedBalance != null ? Number(selectedBalance.remaining_days ?? 0) : null;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Leave</h1>
          {(dash?.viewer?.full_name || profile?.full_name) && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Balances for <span className="font-medium text-gray-700 dark:text-gray-300">{dash?.viewer?.full_name || profile?.full_name}</span>
            </p>
          )}
        </div>
        {canTeamBalances && (
          <Link
            to={ROUTES.EMPLOYEE.TEAM_LEAVE}
            className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
          >
            Team leave balances
          </Link>
        )}
      </div>

      {dash && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-primary-200/60 dark:border-primary-800/80 bg-gradient-to-br from-primary-600/10 via-primary-500/5 to-transparent dark:from-primary-900/40 dark:via-primary-900/20 dark:to-gray-900/40 p-5 shadow-sm dark:shadow-none">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-800 dark:text-primary-200">
              Annual leave ({dash.year})
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900 dark:text-white">
              {annualRemaining != null ? `${annualRemaining.toFixed(1)} days` : '-'}
            </p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-snug">
              Starts at 18 days; +1 day per 3 full years of service (max 21), using your hire date on file.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">In workflow</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900 dark:text-white">{dash.my_pending_requests}</p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Drafts, pending approval, or returned for edits.</p>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 p-5 shadow-sm sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
              Remaining by type
            </p>
            <ul className="text-sm space-y-2 text-gray-700 dark:text-gray-300 max-h-36 overflow-y-auto pr-1">
              {balances.map((b) => (
                <li
                  key={b.leave_code || b.leave_name}
                  className="flex justify-between gap-3 rounded-lg bg-gray-50/80 dark:bg-gray-900/50 px-3 py-2"
                >
                  <span className="truncate text-gray-700 dark:text-gray-200">{b.leave_name}</span>
                  <span className="tabular-nums font-semibold shrink-0 text-gray-900 dark:text-white">
                    {Number(b.remaining_days ?? 0).toFixed(1)} d
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div
        className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-3"
        role="tablist"
        aria-label="Leave sections"
      >
        {[
          { id: 'apply', label: 'Apply' },
          { id: 'requests', label: 'My Leave' },
        ].map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={leaveTab === id}
            onClick={() => setLeaveTab(id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              leaveTab === id
                ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 ring-1 ring-sky-200 dark:ring-sky-700'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {leaveTab === 'apply' && (
        <form
          onSubmit={createAndSubmit}
          className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 p-5 md:p-6 shadow-sm space-y-5"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Apply Leave</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 -mt-2 mb-1 leading-relaxed">
            After you submit, your <strong>Supervisor</strong> (set on your employee record) approves first. If another step is needed, it goes to{' '}
            <strong>their</strong> supervisor next (your supervisor&apos;s supervisor), and continues up that chain until approved.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-6">
            <div className="flex-1 min-w-0 space-y-1">
              <label htmlFor="leave-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Leave type <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <select
                id="leave-type"
                value={form.leave_type_id}
                onChange={(e) => setForm((p) => ({ ...p, leave_type_id: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2.5 text-gray-900 dark:text-white"
                required
              >
                <option value="">Select…</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="shrink-0 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 px-4 py-2.5 sm:min-w-[10rem]">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Leave balance</p>
              <p className="text-base font-semibold tabular-nums text-gray-900 dark:text-white">
                {selectedRemaining != null ? `${selectedRemaining.toFixed(2)} day(s)` : '-'}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="leave-from" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                From date <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <input
                id="leave-from"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2.5 text-gray-900 dark:text-white"
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="leave-to" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                To date <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <input
                id="leave-to"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2.5 text-gray-900 dark:text-white"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="leave-comments" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Comments
            </label>
            <textarea
              id="leave-comments"
              rows={4}
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              placeholder="Optional notes for your approver"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2.5 text-gray-900 dark:text-white resize-y min-h-[6rem]"
            />
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <span className="text-red-600 dark:text-red-400">*</span> Required
            </p>
            <button
              type="submit"
              className="w-full sm:w-auto min-w-[8rem] px-6 py-2.5 rounded-lg bg-orange-500 text-white font-semibold shadow-sm hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors"
            >
              Apply
            </button>
          </div>
        </form>
      )}

      {leaveTab === 'requests' && (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">My Leave</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">History and current status</p>
        </div>
        <div className="overflow-x-auto max-h-[min(28rem,50vh)] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recorded by</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Start</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">End</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Days</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No leave requests yet</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                      Your applications and leave assigned by a supervisor appear here.
                    </p>
                  </td>
                </tr>
              )}
              {!loading &&
                requests.map((r) => (
                  <tr key={r.id} className="text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50/80 dark:hover:bg-gray-900/30">
                    <td className="px-4 py-3">{r.leave_type_name || r.leave_type_id}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {r.assigned_by_name ? (
                        <span title="Leave recorded by a supervisor on your behalf">Supervisor: {r.assigned_by_name}</span>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-500">You</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{r.start_date}</td>
                    <td className="px-4 py-3 tabular-nums">{r.end_date}</td>
                    <td className="px-4 py-3 tabular-nums">{r.days_requested}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      {!['approved', 'rejected', 'cancelled'].includes(r.status) && (
                        <button
                          type="button"
                          onClick={() => cancelRequest(r.id)}
                          className="text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = String(status || '');
  const base = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium';
  if (s === 'approved') return <span className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300`}>Approved</span>;
  if (s === 'rejected') return <span className={`${base} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300`}>Rejected</span>;
  if (s === 'cancelled') return <span className={`${base} bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300`}>Cancelled</span>;
  if (s === 'returned') return <span className={`${base} bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`}>Returned</span>;
  if (['draft', 'submitted', 'pending_manager', 'pending_hod', 'pending_hr'].some((p) => s.includes(p) || s === p))
    return <span className={`${base} bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300`}>In progress</span>;
  return <span className={`${base} bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300`}>{s || '-'}</span>;
}
