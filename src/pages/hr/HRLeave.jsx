import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import * as api from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { ROUTES, ROLES } from '../../utils/constants';
import { LeaveBackLink, LeaveHubNav } from '../../components/LeaveHubNav';

export function HRLeave() {
  const toast = useToast();
  const role = useSelector((s) => s.auth.profile?.role);
  const [pending, setPending] = useState([]);
  const [report, setReport] = useState(null);
  const [commentById, setCommentById] = useState({});
  const [loading, setLoading] = useState(true);
  const [actingById, setActingById] = useState({});
  const [remindingById, setRemindingById] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const pendingItems = await api.getPendingLeaveRequests();
      setPending(pendingItems);
      if (role === ROLES.HR || role === ROLES.ADMIN) {
        const summary = await api.getLeaveReportSummary();
        setReport(summary);
      } else {
        setReport(null);
      }
    } catch {
      toast('Failed to load leave approvals', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [role]);

  const action = async (id, type) => {
    if (actingById[id]) return;
    const comment = commentById[id] || '';
    try {
      setActingById((p) => ({ ...p, [id]: type }));
      if (type === 'approve') await api.approveLeaveRequest(id, comment);
      if (type === 'reject') await api.rejectLeaveRequest(id, comment);
      if (type === 'return') await api.returnLeaveRequest(id, comment);
      toast(`Leave request ${type}d`, 'success');
      load();
    } catch (err) {
      toast(err?.response?.data?.detail || `Failed to ${type} request`, 'error');
    } finally {
      setActingById((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    }
  };

  const remind = async (id) => {
    if (remindingById[id]) return;
    try {
      setRemindingById((p) => ({ ...p, [id]: true }));
      await api.remindLeaveApprover(id);
      toast('Reminder sent to current supervisor approver', 'success');
    } catch (err) {
      toast(err?.response?.data?.detail || 'Failed to send reminder', 'error');
    } finally {
      setRemindingById((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    }
  };

  return (
    <div className="space-y-6">
      <LeaveBackLink />
      <LeaveHubNav role={role} />
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Leave Approvals & Reports</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 max-w-3xl leading-relaxed">
        Your inbox lists requests where <strong>you</strong> are the current approver. The <strong>first</strong> approver is always the
        employee&apos;s <strong>Supervisor</strong> on their record in Employee records (<code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">manager / report-to</code>
        ). The <strong>second</strong> approver (if any) is that supervisor&apos;s own supervisor, then the same pattern continues up the line until there is no manager above and the request is fully approved. Use{' '}
        <Link to={ROUTES.EMPLOYEE.TEAM_LEAVE} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
          Team leave balances
        </Link>{' '}
        to assign approved leave to your staff (managers and HOD: direct reports only).
        {(role === ROLES.HR || role === ROLES.ADMIN) && (
          <>
            {' '}
            HR can monitor the pipeline in{' '}
            <Link to={ROUTES.HR.LEAVE_OVERVIEW} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
              Leave overview
            </Link>{' '}
            and{' '}
            <Link to={ROUTES.HR.LEAVE_ORGANIZATION} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
              Organization leave
            </Link>
            .
          </>
        )}
      </p>

      {report && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Snapshot uses default period (last ~year). Full breakdown:{' '}
            <Link to={ROUTES.HR.REPORTS_LEAVE} className="text-primary-600 dark:text-primary-400 font-medium hover:underline">
              Reports → Leave reports
            </Link>
            .
          </p>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <Card label="Total requests" value={report.total_requests} />
            <Card label="Approved (count)" value={report.approved_count} />
            <Card label="Rejected" value={report.rejected_count} />
            <Card label="Approval rate" value={`${report.approval_rate_pct ?? 0}%`} />
            <Card label="Taken (approved days)" value={Number(report.leave_totals_in_period?.approved_days ?? 0).toFixed(1)} />
            <Card label="Pending (days)" value={Number(report.leave_totals_in_period?.pending_days ?? 0).toFixed(1)} />
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Employee</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Type</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Dates / requested</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Balance (this leave)</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Status</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Comment</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {!loading && pending.map((r) => (
              <tr key={r.id} className="text-sm text-gray-700 dark:text-gray-300">
                <td className="px-4 py-2">
                  <div className="font-medium">{r.staff_name}</div>
                  <div className="text-xs text-gray-500">{r.staff_email}</div>
                </td>
                <td className="px-4 py-2">{r.leave_type_name}</td>
                <td className="px-4 py-2">
                  <div className="whitespace-nowrap">{r.start_date} – {r.end_date}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-200">
                      {Number(r.days_requested ?? 0).toFixed(1)}
                    </span>
                    {' '}day(s) requested
                  </div>
                </td>
                <td className="px-4 py-2 text-sm">
                  {(() => {
                    const bal = (r.requester_balances || []).find((b) => b.leave_type_id === r.leave_type_id);
                    if (!bal) {
                      return <span className="text-gray-400">No balance on file for this type</span>;
                    }
                    return (
                      <div>
                        <p className="font-semibold tabular-nums text-gray-900 dark:text-white">
                          {Number(bal.remaining_days ?? 0).toFixed(1)} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">days remaining</span>
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{bal.leave_name}</p>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-4 py-2">{r.status}</td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={commentById[r.id] || ''}
                    onChange={(e) => setCommentById((p) => ({ ...p, [r.id]: e.target.value }))}
                    disabled={!!actingById[r.id]}
                    className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1"
                    placeholder="Comment"
                  />
                </td>
                <td className="px-4 py-2 space-x-2">
                  <button type="button" disabled={!!actingById[r.id]} onClick={() => action(r.id, 'approve')} className="text-green-600 hover:underline disabled:opacity-60 disabled:no-underline">{actingById[r.id] === 'approve' ? 'Approving...' : 'Approve'}</button>
                  <button type="button" disabled={!!actingById[r.id]} onClick={() => action(r.id, 'return')} className="text-amber-600 hover:underline disabled:opacity-60 disabled:no-underline">{actingById[r.id] === 'return' ? 'Returning...' : 'Return'}</button>
                  <button type="button" disabled={!!actingById[r.id]} onClick={() => action(r.id, 'reject')} className="text-red-600 hover:underline disabled:opacity-60 disabled:no-underline">{actingById[r.id] === 'reject' ? 'Rejecting...' : 'Reject'}</button>
                  {(role === ROLES.HR || role === ROLES.ADMIN) && (
                    <button type="button" disabled={!!remindingById[r.id]} onClick={() => remind(r.id)} className="text-blue-600 hover:underline disabled:opacity-60 disabled:no-underline">{remindingById[r.id] ? 'Sending...' : 'Remind supervisor'}</button>
                  )}
                </td>
              </tr>
            ))}
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
