import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { ROUTES } from '../../utils/constants';

const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', pending_supervisor: 'Supervisor review', returned: 'Returned', verified: 'Verified',
  approved: 'Approved', received: 'Received', acknowledged: 'Acknowledged',
  returned_supervisor: 'Returned (Supervisor)', returned_hod: 'Returned (HOD)',
  approved_supervisor: 'Approved (Supervisor)', approved_hod: 'Approved (HOD)', locked: 'Locked',
};

const ANNUAL_STATUS_CLASS = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-300',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  pending_supervisor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  returned_supervisor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  returned_hod: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved_supervisor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  approved_hod: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  locked: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

export function HRAppraisal() {
  const toast = useToast();
  const [cycles, setCycles] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [annualPending, setAnnualPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [returnComment, setReturnComment] = useState({ id: null, type: null, comment: '' });
  const [showReturn, setShowReturn] = useState(null);
  const [viewingKpiId, setViewingKpiId] = useState(null);
  const [viewKpiDetail, setViewKpiDetail] = useState(null);
  const [viewKpiTitlesWithItems, setViewKpiTitlesWithItems] = useState([]);
  const [viewKpiLoading, setViewKpiLoading] = useState(false);
  const [form, setForm] = useState({ type: 'annual', year: new Date().getFullYear(), quarter: '', start_date: '', end_date: '', status: 'draft' });
  const [trackYearFilter, setTrackYearFilter] = useState(null);
  const [trackList, setTrackList] = useState([]);
  const [trackLoading, setTrackLoading] = useState(false);

  const load = () => {
    Promise.all([
      api.getAppraisalCycles(),
      api.getAppraisalDashboardHr(),
      api.getAnnualKpisPendingApproval(),
    ])
      .then(([c, d, pending]) => {
        setCycles(c || []);
        setDashboard(d);
        setAnnualPending(pending || []);
      })
      .catch(() => { setCycles([]); setDashboard(null); setAnnualPending([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setTrackLoading(true);
    api.getAnnualKpis(trackYearFilter ?? undefined)
      .then((list) => setTrackList(list || []))
      .catch(() => setTrackList([]))
      .finally(() => setTrackLoading(false));
  }, [trackYearFilter]);

  useEffect(() => {
    if (!viewingKpiId) {
      setViewKpiDetail(null);
      setViewKpiTitlesWithItems([]);
      return;
    }
    setViewKpiLoading(true);
    api.getAnnualKpi(viewingKpiId)
      .then((kpi) => {
        setViewKpiDetail(kpi);
        return api.getAnnualKpiTitles(viewingKpiId);
      })
      .then(async (titles) => {
        const withItems = await Promise.all(
          (titles || []).map(async (t) => ({ ...t, items: await api.getKpiTitleItems(t.id) }))
        );
        setViewKpiTitlesWithItems(withItems);
      })
      .catch(() => toast('Failed to load KPI', 'error'))
      .finally(() => setViewKpiLoading(false));
  }, [viewingKpiId]);

  const handleApproveAnnualKpi = (annualKpiId) => {
    setActionId(annualKpiId);
    api.approveAnnualKpi(annualKpiId)
      .then(() => { toast('Annual KPI approved', 'success'); load(); })
      .catch((e) => toast(e.response?.data?.detail || 'Failed', 'error'))
      .finally(() => setActionId(null));
  };

  const handleReturnAnnualKpi = () => {
    if (!returnComment.id || !returnComment.comment?.trim()) {
      toast('Comment required', 'error');
      return;
    }
    setActionId(returnComment.id);
    api.returnAnnualKpi(returnComment.id, returnComment.comment)
      .then(() => { toast('Annual KPI returned', 'success'); setShowReturn(null); setReturnComment({ id: null, type: null, comment: '' }); load(); })
      .catch((e) => toast(e.response?.data?.detail || 'Failed', 'error'))
      .finally(() => setActionId(null));
  };

  const handleCreateCycle = (e) => {
    e.preventDefault();
    if (!form.start_date || !form.end_date) {
      toast('Start date and end date required', 'error');
      return;
    }
    if (form.type === 'quarterly' && !form.quarter) {
      toast('Quarter required for quarterly cycle', 'error');
      return;
    }
    setSubmitting(true);
    api.createAppraisalCycle({
      type: form.type,
      year: Number(form.year),
      quarter: form.type === 'quarterly' ? form.quarter : null,
      start_date: form.start_date,
      end_date: form.end_date,
      status: form.status,
    })
      .then(() => {
        toast('Cycle created', 'success');
        setForm({ type: 'annual', year: new Date().getFullYear(), quarter: '', start_date: '', end_date: '', status: 'draft' });
        load();
      })
      .catch((e) => toast(e.response?.data?.detail || e.message || 'Failed', 'error'))
      .finally(() => setSubmitting(false));
  };

  const handleStatusChange = (cycleId, status) => {
    api.updateAppraisalCycle(cycleId, { status })
      .then(() => { toast('Cycle updated', 'success'); load(); })
      .catch((e) => toast(e.response?.data?.detail || e.message || 'Failed', 'error'));
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const kpis = dashboard?.kpis || [];
  const annualKpisLocked = dashboard?.annual_kpis_locked || [];
  const appraisals = dashboard?.appraisals || [];
  const annualReadyToLock = dashboard?.annual_kpis_ready_to_lock || [];

  const handleLockAnnualKpi = (annualKpiId) => {
    setActionId(annualKpiId);
    api.lockAnnualKpi(annualKpiId)
      .then(() => { toast('Annual KPI locked', 'success'); load(); })
      .catch((e) => toast(e.response?.data?.detail || 'Failed to lock', 'error'))
      .finally(() => setActionId(null));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Appraisal (HR)</h1>
        <Link to={ROUTES.HR.DASHBOARD} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Back to HR Dashboard</Link>
      </div>

      {annualReadyToLock.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Annual KPIs ready to lock (approved by Manager and HOD)</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Lock these KPIs so they can be used for appraisals. Staff cannot edit after lock.</p>
          <ul className="space-y-3">
            {annualReadyToLock.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                <div>
                  <p className="font-medium text-gray-800 dark:text-white">{k.user_name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Year {k.year}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setViewingKpiId(k.id)} className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700">View</button>
                  <button type="button" disabled={actionId === k.id} onClick={() => handleLockAnnualKpi(k.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">Lock</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Track annual KPIs</h2>
        <p className="text-base text-gray-600 dark:text-gray-400 mb-4">Find any annual KPI by staff and year. Filter by year or view all.</p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="text-base font-medium text-gray-700 dark:text-gray-300">Year</label>
          <select
            value={trackYearFilter ?? ''}
            onChange={(e) => setTrackYearFilter(e.target.value === '' ? null : Number(e.target.value))}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-4 py-2 text-base"
          >
            <option value="">All years</option>
            {[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2, new Date().getFullYear() - 3].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        {trackLoading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Staff</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Year</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {trackList.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-5 text-base text-gray-500 dark:text-gray-400 text-center">No annual KPIs found.</td></tr>
                ) : (
                  trackList.map((k) => (
                    <tr key={k.id} className="text-gray-700 dark:text-gray-300">
                      <td className="px-4 py-3 text-base font-medium">{k.user_name || '-'}</td>
                      <td className="px-4 py-3 text-base">{k.year}</td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-md text-sm font-medium ${ANNUAL_STATUS_CLASS[k.status] || 'bg-gray-100 dark:bg-gray-600'}`}>
                          {STATUS_LABELS[k.status] || k.status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setViewingKpiId(k.id)} className="text-base text-primary-600 dark:text-primary-400 hover:underline font-medium">View</button>
                          {(k.status || '') === 'approved_hod' && (
                            <button type="button" disabled={actionId === k.id} onClick={() => handleLockAnnualKpi(k.id)} className="text-base text-green-600 dark:text-green-400 hover:underline font-medium disabled:opacity-50">Lock</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {annualPending.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Annual KPIs pending your approval</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">You are in the approval chain as supervisor/HOD. Approve or return below.</p>
          <ul className="space-y-3">
            {annualPending.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                <div>
                  <p className="font-medium text-gray-800 dark:text-white">{k.user_name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Year {k.year}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setViewingKpiId(k.id)} className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700">View</button>
                  <button type="button" disabled={actionId === k.id} onClick={() => handleApproveAnnualKpi(k.id)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">Approve</button>
                  <button type="button" onClick={() => { setShowReturn({ type: 'annual_kpi', id: k.id }); setReturnComment({ id: k.id, type: 'annual_kpi', comment: '' }); }} className="px-3 py-1.5 border border-amber-500 text-amber-700 dark:text-amber-400 rounded-lg text-sm">Return</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-4">Create cycle</h2>
        <form onSubmit={handleCreateCycle} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Year</label>
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          {form.type === 'quarterly' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quarter</label>
              <select
                value={form.quarter}
                onChange={(e) => setForm((f) => ({ ...f, quarter: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start date</label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End date</label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex items-end">
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create cycle'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Cycles</h2>
        {cycles.length === 0 ? (
          <EmptyState title="No cycles" message="Create a cycle above." />
        ) : (
          <ul className="space-y-2">
            {cycles.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-700 dark:text-gray-300">
                  {c.type === 'quarterly' ? `${c.year} ${c.quarter || ''}` : c.year} - {c.status}
                </span>
                <div className="flex flex-wrap gap-2">
                  {c.status !== 'active' && (
                    <button type="button" onClick={() => handleStatusChange(c.id, 'active')} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">Set Active</button>
                  )}
                  {c.status !== 'closed' && (
                    <button type="button" onClick={() => handleStatusChange(c.id, 'closed')} className="text-sm text-gray-600 dark:text-gray-400 hover:underline">Close year / cycle</button>
                  )}
                  {c.status === 'closed' && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(c.id, 'draft')}
                      className="text-sm text-amber-700 dark:text-amber-400 hover:underline"
                      title="Allows staff to add or edit cycle KPIs for this year again (if no other closed cycle remains for the same year)"
                    >
                      Reopen (draft)
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Final / approved KPIs</h2>
          {kpis.length === 0 && annualKpisLocked.length === 0 ? (
            <EmptyState title="None" />
          ) : (
            <div className="space-y-4">
              {kpis.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {kpis.slice(0, 15).map((k) => (
                    <li key={k.id} className="flex justify-between">
                      <span className="text-gray-700 dark:text-gray-300 truncate">{k.user_name} - {k.title}</span>
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-600">{STATUS_LABELS[k.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
              {annualKpisLocked.length > 0 && (
                <>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Locked annual KPIs</p>
                  <ul className="space-y-2 text-sm">
                    {annualKpisLocked.slice(0, 15).map((k) => (
                      <li key={k.id} className="flex justify-between">
                        <span className="text-gray-700 dark:text-gray-300 truncate">{k.user_name} - Year {k.year}</span>
                        <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">{STATUS_LABELS[k.status] || 'Locked'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Final / approved Appraisals</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Download the agreed summary (HTML, print to PDF). If the employee uploaded a signed scan, open Signed file.</p>
          {appraisals.length === 0 ? <EmptyState title="None" /> : (
            <ul className="space-y-3 text-sm">
              {appraisals.slice(0, 40).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                  <div>
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{a.user_name}</span>
                    <span className="text-gray-500 dark:text-gray-400 ml-2">{a.cycle_type === 'quarterly' ? `${a.year} ${a.quarter || ''}` : a.year}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-600">{STATUS_LABELS[a.status]}</span>
                    {a.employee_agreed_scores_at && (
                      <span className="text-xs text-green-700 dark:text-green-400" title="Employee confirmed agreed scores">Agreed ✓</span>
                    )}
                    {a.signed_document_id && (
                      <span className="text-xs text-primary-700 dark:text-primary-400">Signed on file</span>
                    )}
                    <button
                      type="button"
                      className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      onClick={async () => {
                        try {
                          const blob = await api.fetchAppraisalAgreedSummaryBlob(a.id);
                          const url = URL.createObjectURL(blob);
                          const el = document.createElement('a');
                          el.href = url;
                          el.download = `appraisal-${a.user_name || 'staff'}-${a.year}-${a.quarter || 'annual'}.html`;
                          el.click();
                          URL.revokeObjectURL(url);
                          toast('Download started', 'success');
                        } catch (e) {
                          toast(e.response?.data?.detail || e.message || 'Failed', 'error');
                        }
                      }}
                    >
                      Summary
                    </button>
                    {a.signed_document_id ? (
                      <button
                        type="button"
                        className="px-2 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700"
                        onClick={async () => {
                          try {
                            const blob = await api.getStaffDocumentFileBlob(a.signed_document_id);
                            const url = URL.createObjectURL(blob);
                            const el = document.createElement('a');
                            el.href = url;
                            el.download = `signed-appraisal-${a.user_name || 'staff'}`;
                            el.click();
                            URL.revokeObjectURL(url);
                          } catch (e) {
                            toast(e.message || 'Failed', 'error');
                          }
                        }}
                      >
                        Signed file
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {viewingKpiId && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && setViewingKpiId(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col my-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                {viewKpiDetail ? `View KPI - ${viewKpiDetail.user_name || 'Staff'} (Year ${viewKpiDetail.year})` : 'View KPI'}
              </h3>
              <button type="button" onClick={() => setViewingKpiId(null)} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400" aria-label="Close">✕</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {viewKpiLoading ? (
                <div className="flex justify-center py-8"><LoadingSpinner /></div>
              ) : (
                <div className="space-y-5">
                  {viewKpiTitlesWithItems.map((t) => (
                    <div key={t.id} className="border border-gray-200 dark:border-gray-600 rounded-lg p-5">
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{t.name}</h4>
                      <ul className="space-y-3">
                        {(t.items || []).map((item) => (
                          <li key={item.id} className="text-base text-gray-700 dark:text-gray-300 pl-4 border-l-2 border-gray-200 dark:border-gray-600">
                            <span className="font-medium">{item.description}</span>
                            <span className="text-gray-500 dark:text-gray-400"> - Target: {item.target}% · Weight: {item.weight}%</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {!viewKpiLoading && viewKpiTitlesWithItems.length === 0 && <p className="text-gray-500 dark:text-gray-400 text-base">No KPI titles or items.</p>}
                </div>
              )}
            </div>
            {viewKpiDetail && !viewKpiLoading && (
              <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-2">
                <button type="button" disabled={actionId === viewingKpiId} onClick={() => { handleApproveAnnualKpi(viewingKpiId); setViewingKpiId(null); }} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">Approve</button>
                <button type="button" onClick={() => { setViewingKpiId(null); setShowReturn({ type: 'annual_kpi', id: viewingKpiId }); setReturnComment({ id: viewingKpiId, type: 'annual_kpi', comment: '' }); }} className="px-4 py-2 border border-amber-500 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20">Return</button>
                <button type="button" onClick={() => setViewingKpiId(null)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Close</button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {showReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Return with comment (required)</h3>
            <textarea
              value={returnComment.comment}
              onChange={(e) => setReturnComment((r) => ({ ...r, comment: e.target.value }))}
              placeholder="Reason for return..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={handleReturnAnnualKpi} disabled={!returnComment.comment?.trim() || actionId} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">Submit return</button>
              <button type="button" onClick={() => { setShowReturn(null); setReturnComment({ id: null, type: null, comment: '' }); }} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
