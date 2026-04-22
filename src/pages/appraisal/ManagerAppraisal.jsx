import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { ROUTES } from '../../utils/constants';

function formatCycleContext(row) {
  if (!row) return '';
  const y = row.year;
  const q = row.quarter;
  const t = (row.cycle_type || 'cycle').replace(/^\w/, (c) => c.toUpperCase());
  if ((row.cycle_type || '') === 'quarterly' && q) return `${y} ${q} · ${t}`;
  if (y != null) return `${y} · ${t}`;
  return t;
}

export function ManagerAppraisal() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [annualPending, setAnnualPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [returnComment, setReturnComment] = useState({ id: null, type: null, comment: '' });
  const [showReturn, setShowReturn] = useState(null);
  const [verifyModal, setVerifyModal] = useState(null);
  /** Prior comments on the item under review (Oracle-style KPI discussion). */
  const [verifyWorkflow, setVerifyWorkflow] = useState(null);
  const [verifyAppraisalDetail, setVerifyAppraisalDetail] = useState(null);
  const [mgrScoreDrafts, setMgrScoreDrafts] = useState({});
  const [savingMgrScores, setSavingMgrScores] = useState(false);
  const [viewingKpiId, setViewingKpiId] = useState(null);
  const [viewKpiDetail, setViewKpiDetail] = useState(null);
  const [viewKpiTitlesWithItems, setViewKpiTitlesWithItems] = useState([]);
  const [viewKpiLoading, setViewKpiLoading] = useState(false);
  const [viewKpiError, setViewKpiError] = useState(null);

  const load = () => {
    Promise.all([
      api.getAppraisalDashboardManager().catch(() => null),
      api.getAnnualKpisPendingApproval().catch(() => []),
    ]).then(([d, pending]) => {
      setData(d);
      setAnnualPending(pending || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!verifyModal?.id) {
      setVerifyWorkflow(null);
      return;
    }
    setVerifyWorkflow({ loading: true, comments: [], error: null });
    const p =
      verifyModal.type === 'kpi'
        ? api.getKpiWorkflow(verifyModal.id)
        : api.getAppraisalWorkflow(verifyModal.id);
    p.then((w) => setVerifyWorkflow({ loading: false, comments: w?.comments || [], error: null }))
      .catch(() => setVerifyWorkflow({ loading: false, comments: [], error: 'Could not load prior comments.' }));
  }, [verifyModal?.id, verifyModal?.type]);

  useEffect(() => {
    if (!verifyModal?.id || verifyModal.type !== 'appraisal') {
      setVerifyAppraisalDetail(null);
      setMgrScoreDrafts({});
      return;
    }
    api.getAppraisal(verifyModal.id)
      .then((d) => {
        setVerifyAppraisalDetail(d);
        const o = {};
        (d?.scores || []).forEach((s) => {
          o[s.kpi_item_id] = {
            supervisor_score: s.supervisor_score ?? '',
            agreed_score: s.agreed_score ?? '',
            supervisor_comment: s.supervisor_comment ?? '',
          };
        });
        setMgrScoreDrafts(o);
      })
      .catch(() => {
        setVerifyAppraisalDetail(null);
        setMgrScoreDrafts({});
      });
  }, [verifyModal?.id, verifyModal?.type]);

  useEffect(() => {
    if (!viewingKpiId) {
      setViewKpiDetail(null);
      setViewKpiTitlesWithItems([]);
      setViewKpiError(null);
      return;
    }
    setViewKpiError(null);
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
      .catch((err) => {
        const msg = err.response?.data?.detail || err.message || 'Failed to load KPI';
        setViewKpiError(msg);
        toast(msg, 'error');
      })
      .finally(() => setViewKpiLoading(false));
  }, [viewingKpiId]);

  const handleSubmitVerify = () => {
    if (!verifyModal?.id || !verifyModal.comment?.trim()) {
      toast('Comment required', 'error');
      return;
    }
    const { type, id, comment } = verifyModal;
    setActionId(id);
    const p = type === 'kpi'
      ? api.verifyKpi(id, comment)
      : api.verifyAppraisal(id, comment);
    p.then(() => {
      toast(type === 'kpi' ? 'KPI review saved' : 'Appraisal review saved', 'success');
      setVerifyModal(null);
      load();
    })
      .catch((e) => toast(e.response?.data?.detail || 'Failed', 'error'))
      .finally(() => setActionId(null));
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

  const kpis = data?.kpis_pending_verify || [];
  const appraisals = data?.appraisals_pending_verify || [];
  const returnedKpis = data?.returned_kpis || [];
  const returnedAppraisals = data?.returned_appraisals || [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Appraisal (Manager)</h1>
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
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">KPIs awaiting your supervisor review</h2>
        {kpis.length === 0 ? <EmptyState title="None" message="No KPIs at your step in the supervisor chain." /> : (
          <ul className="space-y-3">
            {kpis.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                <div>
                  <p className="font-medium text-gray-800 dark:text-white">{k.user_name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{k.title}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={actionId === k.id} onClick={() => setVerifyModal({ type: 'kpi', id: k.id, comment: '', snapshot: k })} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">Review</button>
                  <button type="button" onClick={() => { setShowReturn({ type: 'kpi', id: k.id }); setReturnComment({ id: k.id, type: 'kpi', comment: '' }); }} className="px-3 py-1.5 border border-amber-500 text-amber-700 dark:text-amber-400 rounded-lg text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20">Return</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Appraisals awaiting your supervisor review</h2>
        {appraisals.length === 0 ? <EmptyState title="None" message="No appraisals at your step in the supervisor chain." /> : (
          <ul className="space-y-3">
            {appraisals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                <p className="font-medium text-gray-800 dark:text-white">{a.user_name}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={actionId === a.id} onClick={() => setVerifyModal({ type: 'appraisal', id: a.id, comment: '', snapshot: a })} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">Review</button>
                  <button type="button" onClick={() => { setShowReturn({ type: 'appraisal', id: a.id }); setReturnComment({ id: a.id, type: 'appraisal', comment: '' }); }} className="px-3 py-1.5 border border-amber-500 text-amber-700 dark:text-amber-400 rounded-lg text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20">Return</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(returnedKpis.length > 0 || returnedAppraisals.length > 0) && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 dark:text-amber-200 mb-3">Returned (awaiting resubmit)</h2>
          <ul className="space-y-2 text-sm">
            {returnedKpis.map((k) => (
              <li key={k.id} className="text-gray-700 dark:text-gray-300">{k.user_name} - KPI: {k.title}</li>
            ))}
            {returnedAppraisals.map((a) => (
              <li key={a.id} className="text-gray-700 dark:text-gray-300">{a.user_name} - Appraisal</li>
            ))}
          </ul>
        </div>
      )}

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
              ) : viewKpiError ? (
                <p className="text-amber-600 dark:text-amber-400 py-4 text-base">{viewKpiError}</p>
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

      {verifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              {verifyModal.type === 'kpi' ? 'Supervisor review (KPI)' : 'Supervisor review (appraisal)'}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Add a comment (required). If you are not the last approver in the chain, the item moves to the next manager.</p>

            {verifyModal.type === 'kpi' && verifyModal.snapshot && (
              <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">KPI definition (context)</p>
                <p><span className="text-gray-500 dark:text-gray-400">Owner:</span> <span className="text-gray-900 dark:text-white font-medium">{verifyModal.snapshot.user_name || '—'}</span></p>
                <p><span className="text-gray-500 dark:text-gray-400">Period:</span> <span className="text-gray-900 dark:text-white">{formatCycleContext(verifyModal.snapshot) || '—'}</span></p>
                {(verifyModal.snapshot.cycle_start_date || verifyModal.snapshot.cycle_end_date) && (
                  <p className="text-gray-600 dark:text-gray-300 text-xs">Cycle dates: {verifyModal.snapshot.cycle_start_date || '—'} → {verifyModal.snapshot.cycle_end_date || '—'}</p>
                )}
                <p><span className="text-gray-500 dark:text-gray-400">Title:</span> <span className="text-gray-900 dark:text-white font-medium">{verifyModal.snapshot.title || '—'}</span></p>
                {verifyModal.snapshot.description ? (
                  <p><span className="text-gray-500 dark:text-gray-400">Description:</span> <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{verifyModal.snapshot.description}</span></p>
                ) : null}
                {verifyModal.snapshot.target ? (
                  <p><span className="text-gray-500 dark:text-gray-400">Target / success criteria:</span> <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{verifyModal.snapshot.target}</span></p>
                ) : null}
                <p><span className="text-gray-500 dark:text-gray-400">Weight in cycle:</span> <span className="tabular-nums text-gray-900 dark:text-white">{verifyModal.snapshot.weight != null ? `${Number(verifyModal.snapshot.weight)}%` : '—'}</span></p>
              </div>
            )}

            {verifyModal.type === 'appraisal' && verifyModal.snapshot && (
              <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Self-assessment (context)</p>
                <p><span className="text-gray-500 dark:text-gray-400">Employee:</span> <span className="text-gray-900 dark:text-white font-medium">{verifyModal.snapshot.user_name || '—'}</span></p>
                <p><span className="text-gray-500 dark:text-gray-400">Period:</span> <span className="text-gray-900 dark:text-white">{formatCycleContext(verifyModal.snapshot) || '—'}</span></p>
                {(verifyModal.snapshot.cycle_start_date || verifyModal.snapshot.cycle_end_date) && (
                  <p className="text-gray-600 dark:text-gray-300 text-xs">Cycle dates: {verifyModal.snapshot.cycle_start_date || '—'} → {verifyModal.snapshot.cycle_end_date || '—'}</p>
                )}
                {verifyModal.snapshot.achievements ? (
                  <p><span className="text-gray-500 dark:text-gray-400">Achievements:</span> <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{verifyModal.snapshot.achievements}</span></p>
                ) : null}
                {verifyModal.snapshot.challenges ? (
                  <p><span className="text-gray-500 dark:text-gray-400">Challenges:</span> <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{verifyModal.snapshot.challenges}</span></p>
                ) : null}
                {verifyModal.snapshot.overall_comments ? (
                  <p><span className="text-gray-500 dark:text-gray-400">Overall comments:</span> <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{verifyModal.snapshot.overall_comments}</span></p>
                ) : null}
              </div>
            )}

            {verifyModal.type === 'appraisal' && verifyAppraisalDetail?.scores?.length > 0 && (
              <div className="mb-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/20 p-4 text-sm space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-800 dark:text-primary-200">Quarterly KPI scores — enter supervisor % and agreed % before submitting your review</p>
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-600">
                        <th className="text-left py-1 text-gray-700 dark:text-gray-300">Line</th>
                        <th className="py-1">Sup %</th>
                        <th className="py-1">Agreed %</th>
                        <th className="py-1">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verifyAppraisalDetail.scores.map((s) => {
                        const kid = s.kpi_item_id;
                        const dr = mgrScoreDrafts[kid] || {};
                        return (
                          <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700">
                            <td className="py-1 text-gray-800 dark:text-gray-200 max-w-[140px]">{s.description}</td>
                            <td className="py-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={dr.supervisor_score}
                                onChange={(e) => setMgrScoreDrafts((prev) => ({ ...prev, [kid]: { ...dr, supervisor_score: e.target.value } }))}
                                className="w-16 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                              />
                            </td>
                            <td className="py-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={dr.agreed_score}
                                onChange={(e) => setMgrScoreDrafts((prev) => ({ ...prev, [kid]: { ...dr, agreed_score: e.target.value } }))}
                                className="w-16 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                              />
                            </td>
                            <td className="py-1">
                              <input
                                type="text"
                                value={dr.supervisor_comment}
                                onChange={(e) => setMgrScoreDrafts((prev) => ({ ...prev, [kid]: { ...dr, supervisor_comment: e.target.value } }))}
                                className="w-full min-w-[100px] px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  disabled={savingMgrScores || !verifyModal.id}
                  onClick={async () => {
                    setSavingMgrScores(true);
                    try {
                      for (const s of verifyAppraisalDetail.scores) {
                        const kid = s.kpi_item_id;
                        const dr = mgrScoreDrafts[kid] || {};
                        const sup = dr.supervisor_score === '' ? null : Number(dr.supervisor_score);
                        const ag = dr.agreed_score === '' ? null : Number(dr.agreed_score);
                        if (sup != null && (Number.isNaN(sup) || sup < 0 || sup > 100)) {
                          toast('Supervisor % must be 0–100', 'error');
                          setSavingMgrScores(false);
                          return;
                        }
                        if (ag != null && (Number.isNaN(ag) || ag < 0 || ag > 100)) {
                          toast('Agreed % must be 0–100', 'error');
                          setSavingMgrScores(false);
                          return;
                        }
                        await api.updateAppraisalScore(verifyModal.id, kid, {
                          supervisor_score: sup,
                          agreed_score: ag,
                          supervisor_comment: dr.supervisor_comment || null,
                        });
                      }
                      const d = await api.getAppraisal(verifyModal.id);
                      setVerifyAppraisalDetail(d);
                      toast('Supervisor scores saved', 'success');
                    } catch (e) {
                      toast(e.response?.data?.detail || 'Failed', 'error');
                    } finally {
                      setSavingMgrScores(false);
                    }
                  }}
                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700 disabled:opacity-50"
                >
                  Save supervisor scores
                </button>
              </div>
            )}

            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Prior discussion</p>
              {verifyWorkflow?.loading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : verifyWorkflow?.error ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">{verifyWorkflow.error}</p>
              ) : (verifyWorkflow?.comments || []).length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No comments yet on this item.</p>
              ) : (
                <ul className="max-h-40 overflow-y-auto space-y-2 border border-gray-100 dark:border-gray-700 rounded-lg p-2 bg-white dark:bg-gray-800/80">
                  {(verifyWorkflow.comments || []).map((c) => (
                    <li key={c.id} className="text-xs text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700 last:border-0 pb-2 last:pb-0">
                      <span className="font-medium text-gray-800 dark:text-gray-200">{c.from_role || 'reviewer'}</span>
                      {c.created_at ? <span className="text-gray-400 ml-1">{c.created_at}</span> : null}
                      <p className="mt-1 whitespace-pre-wrap text-gray-600 dark:text-gray-400">{c.comment}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <textarea
              value={verifyModal.comment}
              onChange={(e) => setVerifyModal((m) => ({ ...m, comment: e.target.value }))}
              placeholder="Your comments..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={handleSubmitVerify} disabled={!verifyModal.comment?.trim() || actionId === verifyModal.id} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">Submit review</button>
              <button type="button" onClick={() => setVerifyModal(null)} disabled={actionId === verifyModal.id} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            </div>
          </div>
        </div>
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
