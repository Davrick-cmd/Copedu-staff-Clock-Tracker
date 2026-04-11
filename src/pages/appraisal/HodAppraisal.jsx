import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { ROUTES } from '../../utils/constants';

export function HodAppraisal() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [annualPending, setAnnualPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [returnComment, setReturnComment] = useState({ id: null, type: null, comment: '' });
  const [showReturn, setShowReturn] = useState(null);
  const [viewingKpiId, setViewingKpiId] = useState(null);
  const [viewKpiDetail, setViewKpiDetail] = useState(null);
  const [viewKpiTitlesWithItems, setViewKpiTitlesWithItems] = useState([]);
  const [viewKpiLoading, setViewKpiLoading] = useState(false);

  const load = () => {
    Promise.all([
      api.getAppraisalDashboardHod().catch(() => null),
      api.getAnnualKpisPendingApproval().catch(() => []),
    ]).then(([d, pending]) => {
      setData(d);
      setAnnualPending(pending || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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

  const handleApproveKpi = (kpiId) => {
    setActionId(kpiId);
    api.approveKpi(kpiId).then(() => { toast('KPI approved', 'success'); load(); }).catch((e) => toast(e.response?.data?.detail || 'Failed', 'error')).finally(() => setActionId(null));
  };

  const handleApproveAppraisal = (appraisalId) => {
    setActionId(appraisalId);
    api.approveAppraisal(appraisalId).then(() => { toast('Appraisal approved', 'success'); load(); }).catch((e) => toast(e.response?.data?.detail || 'Failed', 'error')).finally(() => setActionId(null));
  };

  const handleReturnKpi = () => {
    if (!returnComment.id || !returnComment.comment?.trim()) {
      toast('Comment required', 'error');
      return;
    }
    setActionId(returnComment.id);
    api.returnKpi(returnComment.id, returnComment.comment)
      .then(() => { toast('KPI returned', 'success'); setShowReturn(null); setReturnComment({ id: null, type: null, comment: '' }); load(); })
      .catch((e) => toast(e.response?.data?.detail || 'Failed', 'error'))
      .finally(() => setActionId(null));
  };

  const handleReturnAppraisal = () => {
    if (!returnComment.id || !returnComment.comment?.trim()) {
      toast('Comment required', 'error');
      return;
    }
    setActionId(returnComment.id);
    api.returnAppraisal(returnComment.id, returnComment.comment)
      .then(() => { toast('Appraisal returned', 'success'); setShowReturn(null); setReturnComment({ id: null, type: null, comment: '' }); load(); })
      .catch((e) => toast(e.response?.data?.detail || 'Failed', 'error'))
      .finally(() => setActionId(null));
  };

  const handleApproveAnnualKpi = (annualKpiId) => {
    setActionId(annualKpiId);
    api.approveAnnualKpi(annualKpiId).then(() => { toast('Annual KPI approved', 'success'); load(); }).catch((e) => toast(e.response?.data?.detail || 'Failed', 'error')).finally(() => setActionId(null));
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

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const kpis = data?.kpis_pending_approve || [];
  const appraisals = data?.appraisals_pending_approve || [];
  const overview = data?.department_overview || [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Appraisal (HOD)</h1>
        <Link to={ROUTES.EMPLOYEE.DASHBOARD} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Dashboard</Link>
      </div>

      {annualPending.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Annual KPIs pending your approval</h2>
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
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">KPIs pending approval</h2>
        {kpis.length === 0 ? <EmptyState title="None" message="No KPIs waiting for your approval." /> : (
          <ul className="space-y-3">
            {kpis.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                <div>
                  <p className="font-medium text-gray-800 dark:text-white">{k.user_name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{k.title}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={actionId === k.id} onClick={() => handleApproveKpi(k.id)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">Approve</button>
                  <button type="button" onClick={() => { setShowReturn({ type: 'kpi', id: k.id }); setReturnComment({ id: k.id, type: 'kpi', comment: '' }); }} className="px-3 py-1.5 border border-amber-500 text-amber-700 dark:text-amber-400 rounded-lg text-sm">Return</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Appraisals pending approval</h2>
        {appraisals.length === 0 ? <EmptyState title="None" message="No appraisals waiting for your approval." /> : (
          <ul className="space-y-3">
            {appraisals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                <p className="font-medium text-gray-800 dark:text-white">{a.user_name}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={actionId === a.id} onClick={() => handleApproveAppraisal(a.id)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">Approve</button>
                  <button type="button" onClick={() => { setShowReturn({ type: 'appraisal', id: a.id }); setReturnComment({ id: a.id, type: 'appraisal', comment: '' }); }} className="px-3 py-1.5 border border-amber-500 text-amber-700 dark:text-amber-400 rounded-lg text-sm">Return</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Department overview</h2>
        {overview.length === 0 ? <EmptyState title="No data" /> : (
          <ul className="space-y-2 text-sm">
            {overview.map((o) => (
              <li key={o.user_id} className="flex justify-between text-gray-700 dark:text-gray-300">
                <span>{o.full_name}</span>
                <span>KPIs ack: {o.kpis_acknowledged} · Appraisals ack: {o.appraisals_acknowledged}</span>
              </li>
            ))}
          </ul>
        )}
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
              <button type="button" onClick={returnComment.type === 'annual_kpi' ? handleReturnAnnualKpi : (returnComment.type === 'kpi' ? handleReturnKpi : handleReturnAppraisal)} disabled={!returnComment.comment?.trim() || actionId} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">Submit return</button>
              <button type="button" onClick={() => { setShowReturn(null); setReturnComment({ id: null, type: null, comment: '' }); }} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
