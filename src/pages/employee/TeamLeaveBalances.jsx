import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import * as api from '../../services/api';
import { ROUTES, ROLE_LABELS } from '../../utils/constants';
import { useToast } from '../../hooks/useToast';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { Link } from 'react-router-dom';

export function TeamLeaveBalances() {
  const toast = useToast();
  const profile = useSelector((s) => s.auth.profile);
  const role = profile?.role;
  const [year, setYear] = useState(new Date().getFullYear());
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [assignForm, setAssignForm] = useState({
    staff_user_id: '',
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });
  const [assigning, setAssigning] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .getLeaveTeamBalances({ year })
      .then(setPayload)
      .catch(() => toast('You may not have access to team leave balances', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [year, toast]);

  useEffect(() => {
    api.getLeaveTypes().then(setLeaveTypes).catch(() => setLeaveTypes([]));
  }, []);

  const submitAssign = async (e) => {
    e.preventDefault();
    if (!assignForm.staff_user_id || !assignForm.leave_type_id || !assignForm.start_date || !assignForm.end_date) {
      toast('Choose a team member, leave type, and dates', 'error');
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
      toast('Leave assigned - it appears on the employee’s My Leave tab', 'success');
      setAssignForm((p) => ({ ...p, start_date: '', end_date: '', reason: '' }));
      load();
    } catch (err) {
      toast(err?.response?.data?.detail || 'Could not assign leave', 'error');
    } finally {
      setAssigning(false);
    }
  };

  const scopeHint =
    role === 'manager'
      ? 'Direct reports'
      : role === 'hod'
        ? 'Same department (excluding you)'
        : role === 'hr' || role === 'admin'
          ? 'Active employees (preview, up to 250)'
          : '';

  if (loading && !payload) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Team leave balances</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {scopeHint} · Your role: {ROLE_LABELS[role] || role}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            Year
            <input
              type="number"
              min={2020}
              max={2035}
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
              className="w-24 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-gray-900 dark:text-white"
            />
          </label>
          <Link to={ROUTES.HR.LEAVE} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
            Approvals
          </Link>
        </div>
      </div>

      {['manager', 'hod', 'hr', 'admin'].includes(role) && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Assign leave</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
            Record approved leave for someone in your scope. It is saved as approved and updates their balance; they will see it under Leave → My Leave.
          </p>
          <form onSubmit={submitAssign} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 items-end">
            <div className="sm:col-span-2 xl:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Team member</label>
              <select
                required
                value={assignForm.staff_user_id}
                onChange={(e) => setAssignForm((p) => ({ ...p, staff_user_id: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              >
                <option value="">Select…</option>
                {(payload?.members || []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="xl:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Leave type</label>
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
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
              <input
                type="date"
                required
                value={assignForm.start_date}
                onChange={(e) => setAssignForm((p) => ({ ...p, start_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
              <input
                type="date"
                required
                value={assignForm.end_date}
                onChange={(e) => setAssignForm((p) => ({ ...p, end_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div className="sm:col-span-2 xl:col-span-3">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Comment (optional)</label>
              <input
                type="text"
                value={assignForm.reason}
                onChange={(e) => setAssignForm((p) => ({ ...p, reason: e.target.value }))}
                placeholder="Shown on notification email"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div className="sm:col-span-2 xl:col-span-3 flex justify-end">
              <button
                type="submit"
                disabled={assigning}
                className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {assigning ? 'Saving…' : 'Assign leave'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Name</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Department</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Balances ({payload?.year || year})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {(payload?.members || []).map((m) => (
              <tr key={m.user_id} className="text-gray-700 dark:text-gray-300">
                <td className="px-4 py-2">
                  <div className="font-medium">{m.full_name}</div>
                  <div className="text-xs text-gray-500">{m.email}</div>
                </td>
                <td className="px-4 py-2">{m.department || '-'}</td>
                <td className="px-4 py-2">
                  <ul className="space-y-0.5">
                    {(m.balances || []).map((b) => (
                      <li key={b.leave_code || b.leave_name}>
                        <span className="text-gray-600 dark:text-gray-400">{b.leave_name}:</span>{' '}
                        <span className="font-medium tabular-nums">{Number(b.remaining_days ?? 0).toFixed(1)}</span>
                        <span className="text-gray-500 text-xs"> d left</span>
                      </li>
                    ))}
                    {!m.balances?.length && <li className="text-gray-500">No balance rows</li>}
                  </ul>
                </td>
              </tr>
            ))}
            {!payload?.members?.length && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No team members found for this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
