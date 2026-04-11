import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../services/api';
import { ROUTES } from '../../utils/constants';
import { useToast } from '../../hooks/useToast';
import { LoadingSpinner } from '../../components/LoadingSpinner';

const pipelineLabels = {
  pending_manager: 'Awaiting supervisor',
  pending_hod: 'Awaiting supervisor (legacy)',
  pending_hr: 'Awaiting HR (legacy)',
};

export function HRLeaveOverview() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getLeaveOverview()
      .then(setData)
      .catch(() => toast('Failed to load leave overview', 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Leave overview</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to={ROUTES.HR.LEAVE} className="text-primary-600 dark:text-primary-400 hover:underline">
            Approvals inbox
          </Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <Link to={ROUTES.HR.LEAVE_BALANCES} className="text-primary-600 dark:text-primary-400 hover:underline">
            All balances
          </Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <Link to={ROUTES.HR.REPORTS} className="text-primary-600 dark:text-primary-400 hover:underline">
            Reports
          </Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <Link to={ROUTES.HR.LEAVE_ORGANIZATION} className="text-primary-600 dark:text-primary-400 font-medium hover:underline">
            Organization leave
          </Link>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card label="Pending (all stages)" value={data?.pending_total ?? 0} />
        <Card label="On leave today" value={data?.staff_on_leave_today ?? 0} />
        <Card label="Approved this month" value={data?.approved_this_month ?? 0} />
        <Card label="Rejected this month" value={data?.rejected_this_month ?? 0} />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white">Staff on leave today</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Approved absences overlapping today ({data?.on_leave_today_detail?.length ?? 0} shown, max 80)
            </p>
          </div>
          <Link
            to={ROUTES.HR.LEAVE_ORGANIZATION}
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline shrink-0"
          >
            Full calendar & filters →
          </Link>
        </div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Name</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Department</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Type</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Dates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {(data?.on_leave_today_detail || []).map((r) => (
                <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </td>
                  <td className="px-4 py-2">{r.department || '-'}</td>
                  <td className="px-4 py-2">{r.leave_type_name}</td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                    {r.start_date} – {r.end_date}
                  </td>
                </tr>
              ))}
              {!(data?.on_leave_today_detail || []).length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No one is on approved leave today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data?.pipeline && Object.keys(data.pipeline).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Approval pipeline</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(data.pipeline).map(([k, n]) => (
              <div key={k} className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/80 text-sm">
                <span className="text-gray-600 dark:text-gray-400">{pipelineLabels[k] || k}:</span>{' '}
                <span className="font-semibold text-gray-900 dark:text-white">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-white">Recent pending requests</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Latest items still in the workflow</p>
        </div>
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Employee</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Type</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Dates</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Days</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {(data?.recent_pending || []).map((r) => (
              <tr key={r.id} className="text-sm text-gray-700 dark:text-gray-300">
                <td className="px-4 py-2">
                  <div className="font-medium">{r.full_name}</div>
                  <div className="text-xs text-gray-500">{r.email}</div>
                </td>
                <td className="px-4 py-2">{r.leave_type_name}</td>
                <td className="px-4 py-2">
                  {r.start_date} – {r.end_date}
                </td>
                <td className="px-4 py-2">{r.days_requested}</td>
                <td className="px-4 py-2">{pipelineLabels[r.status] || r.status}</td>
              </tr>
            ))}
            {!data?.recent_pending?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No pending leave requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
      <p className="text-xs uppercase text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value ?? 0}</p>
    </div>
  );
}
