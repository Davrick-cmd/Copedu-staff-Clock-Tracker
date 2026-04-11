import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { ROUTES } from '../../utils/constants';

const STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_supervisor: 'Supervisor review',
  returned: 'Returned',
  verified: 'Verified',
  approved: 'Approved',
  received: 'Received',
  acknowledged: 'Acknowledged',
  returned_supervisor: 'Returned (Supervisor)',
  approved_supervisor: 'Approved (Supervisor)',
  returned_hod: 'Returned (HOD)',
  approved_hod: 'Approved (HOD)',
  locked: 'Locked',
};

const STATUS_BADGE_CLASS = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-300',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  pending_supervisor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  returned: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  returned_supervisor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  returned_hod: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved_supervisor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  approved_hod: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  locked: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  verified: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  received: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  acknowledged: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

function groupKpisByCycle(kpis) {
  const byCycle = {};
  (kpis || []).forEach((k) => {
    const cid = k.cycle_id || 'unknown';
    if (!byCycle[cid]) byCycle[cid] = { cycle_id: cid, year: k.year, quarter: k.quarter, type: k.cycle_type, kpis: [] };
    byCycle[cid].kpis.push(k);
  });
  return Object.values(byCycle).sort((a, b) => (b.year !== a.year ? b.year - a.year : (b.quarter || '').localeCompare(a.quarter || '')));
}

export function EmployeeAppraisal() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ackId, setAckId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingKpi, setEditingKpi] = useState(null);
  const [returnComment, setReturnComment] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', target: '', weight: '' });
  const [saving, setSaving] = useState(false);
  const [annualKpis, setAnnualKpis] = useState([]);
  const [selectedAnnualId, setSelectedAnnualId] = useState(null);
  const [annualDetail, setAnnualDetail] = useState(null);
  const [createYear, setCreateYear] = useState(new Date().getFullYear());
  const [selectedAppraisalId, setSelectedAppraisalId] = useState(null);
  const [selectedAppraisalRow, setSelectedAppraisalRow] = useState(null);
  const [appraisalDetail, setAppraisalDetail] = useState(null);
  const [annualTitlesWithItems, setAnnualTitlesWithItems] = useState([]);
  const [newTitleName, setNewTitleName] = useState('');
  const [newItemByTitle, setNewItemByTitle] = useState({});

  const load = () => {
    api.getAppraisalDashboardStaff()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const loadAnnualKpis = () => {
    api.getAnnualKpis()
      .then(setAnnualKpis)
      .catch(() => setAnnualKpis([]));
  };

  useEffect(() => {
    load();
    loadAnnualKpis();
  }, []);

  useEffect(() => {
    if (selectedAnnualId) {
      api.getAnnualKpi(selectedAnnualId).then(setAnnualDetail).catch(() => setAnnualDetail(null));
      return;
    }
    setAnnualDetail(null);
  }, [selectedAnnualId]);

  useEffect(() => {
    if (selectedAppraisalId) {
      api.getAppraisal(selectedAppraisalId).then(setAppraisalDetail).catch(() => setAppraisalDetail(null));
      return;
    }
    setAppraisalDetail(null);
  }, [selectedAppraisalId]);

  useEffect(() => {
    if (!annualDetail?.id) {
      setAnnualTitlesWithItems([]);
      return;
    }
    api.getAnnualKpiTitles(annualDetail.id).then(async (titles) => {
      const withItems = await Promise.all(
        (titles || []).map(async (t) => {
          const items = await api.getKpiTitleItems(t.id);
          return { ...t, items: items || [] };
        })
      );
      setAnnualTitlesWithItems(withItems);
    }).catch(() => setAnnualTitlesWithItems([]));
  }, [annualDetail?.id]);

  useEffect(() => {
    if (modalOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [modalOpen]);

  const active = data?.active_cycle || null;
  const kpis = data?.kpis || [];
  const closedYears = data?.closed_years || [];
  const cyclesGrouped = groupKpisByCycle(kpis);

  const weightForCycle = (cycleId, excludeKpiId = null) => {
    return kpis
      .filter((k) => k.cycle_id === cycleId && k.id !== excludeKpiId)
      .reduce((sum, k) => sum + (Number(k.weight) || 0), 0);
  };

  const openCreateModal = () => {
    setEditingKpi(null);
    setReturnComment(null);
    setForm({ title: '', description: '', target: '', weight: '' });
    setModalOpen(true);
  };

  const openEditModal = async (kpi) => {
    setEditingKpi(kpi);
    setForm({
      title: kpi.title || '',
      description: kpi.description || '',
      target: kpi.target || '',
      weight: kpi.weight != null ? String(kpi.weight) : '',
    });
    setReturnComment(null);
    if ((kpi.status || '') === 'returned') {
      try {
        const w = await api.getKpiWorkflow(kpi.id);
        const comments = (w?.comments || []).filter((c) => (c.comment || '').trim());
        if (comments.length) setReturnComment(comments[comments.length - 1]);
      } catch {
        // ignore
      }
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingKpi(null);
    setReturnComment(null);
    setForm({ title: '', description: '', target: '' });
  };

  const currentCycleId = active?.id || editingKpi?.cycle_id;
  const otherWeight = currentCycleId ? weightForCycle(currentCycleId, editingKpi?.id) : 0;
  const formWeight = parseFloat(form.weight) || 0;
  const totalAfter = otherWeight + formWeight;
  const remainingWeight = 100 - otherWeight;
  const canSubmitTotal = Math.abs(totalAfter - 100) < 0.01;
  const formValid = (form.title || '').trim() && (form.description || '').trim() && (form.target || '').trim() && form.weight !== '' && formWeight >= 0 && formWeight <= 100;

  const handleSaveDraft = async () => {
    if (!(form.title || '').trim()) {
      toast('Title is required', 'error');
      return;
    }
    if (!(form.description || '').trim()) {
      toast('Description is required', 'error');
      return;
    }
    if (!(form.target || '').trim()) {
      toast('Target / success criteria is required', 'error');
      return;
    }
    if (form.weight === '' || isNaN(formWeight) || formWeight < 0 || formWeight > 100) {
      toast('Weight must be a number between 0 and 100', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        target: form.target.trim(),
        weight: formWeight,
      };
      if (editingKpi) {
        await api.updateKpi(editingKpi.id, payload);
        toast('KPI updated (draft)', 'success');
      } else {
        if (!active?.id) {
          toast('No active cycle', 'error');
          return;
        }
        await api.createKpi({ cycle_id: active.id, ...payload });
        toast('KPI saved as draft', 'success');
      }
      closeModal();
      load();
    } catch (e) {
      toast(e.response?.data?.detail || e.message || 'Failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!formValid) {
      toast('Fill all required fields and a valid weight (0–100)', 'error');
      return;
    }
    if (!canSubmitTotal) {
      toast(`Total weight for this cycle must equal 100%. Current total would be ${totalAfter}%. Remaining to allocate: ${remainingWeight}%.`, 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingKpi) {
        await api.updateKpi(editingKpi.id, {
          title: form.title.trim(),
          description: form.description.trim(),
          target: form.target.trim(),
          weight: formWeight,
        });
        await api.submitKpi(editingKpi.id);
        toast('KPI submitted for approval', 'success');
      } else {
        if (!active?.id) {
          toast('No active cycle', 'error');
          return;
        }
        const created = await api.createKpi({
          cycle_id: active.id,
          title: form.title.trim(),
          description: form.description.trim(),
          target: form.target.trim(),
          weight: formWeight,
        });
        if (created?.id) await api.submitKpi(created.id);
        toast('KPI created and submitted for approval', 'success');
      }
      closeModal();
      load();
    } catch (e) {
      toast(e.response?.data?.detail || e.message || 'Failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAckKpi = (kpiId) => {
    setAckId(kpiId);
    api.acknowledgeKpi(kpiId)
      .then(() => {
        toast('KPIs acknowledged', 'success');
        load();
      })
      .catch((e) => toast(e.response?.data?.detail || e.message || 'Failed', 'error'))
      .finally(() => setAckId(null));
  };

  const handleAckAppraisal = (appraisalId) => {
    setAckId(appraisalId);
    api.acknowledgeAppraisal(appraisalId)
      .then(() => {
        toast('Appraisal acknowledged', 'success');
        load();
      })
      .catch((e) => toast(e.response?.data?.detail || e.message || 'Failed', 'error'))
      .finally(() => setAckId(null));
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const appraisals = data?.appraisals || [];
  const receivedKpis = kpis.filter((k) => (k.status || '') === 'received');
  const receivedAppraisals = appraisals.filter((a) => (a.status || '') === 'received');
  const cycles = data?.cycles || [];
  const isActive = active && (active.status || '').toLowerCase() === 'active';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Appraisal</h1>
        <Link to={ROUTES.EMPLOYEE.DASHBOARD} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Back to Dashboard</Link>
      </div>

      <p className="text-gray-600 dark:text-gray-400 text-sm">
        Add <strong>KPI Titles</strong>, then under each title add <strong>subtitles</strong> with <strong>Target %</strong> and <strong>Weight %</strong> (both 0–100). Total weight across all subtitles must equal 100% to submit. After Supervisor → HOD → HR lock, use them for quarterly appraisals.
      </p>

      {/* Annual KPIs (once per year, reused for quarterly appraisals) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Annual KPIs</h2>
        {selectedAnnualId ? (
          <div>
            <button type="button" onClick={() => { setSelectedAnnualId(null); setAnnualDetail(null); }} className="text-sm text-primary-600 dark:text-primary-400 hover:underline mb-3">← Back to list</button>
            {annualDetail && (
              <div className="space-y-4">
                {closedYears.includes(annualDetail.year) && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-base font-medium">
                    Year {annualDetail.year} is closed for appraisal. No new KPIs or edits can be added.
                  </div>
                )}
                <p className="text-base text-gray-600 dark:text-gray-400">Year {annualDetail.year} · Total weight: <strong>{annualDetail.total_weight ?? 0}%</strong> · {STATUS_LABELS[annualDetail.status] || annualDetail.status}</p>
                {annualTitlesWithItems.map((t) => {
                  const itemForm = newItemByTitle[t.id] || {};
                  const yearClosed = closedYears.includes(annualDetail.year);
                  const canEdit = !yearClosed && ((annualDetail.status || '') === 'draft' || (annualDetail.status || '').includes('returned'));
                  return (
                    <div key={t.id} className="border border-gray-200 dark:border-gray-600 rounded-lg p-5">
                      <p className="font-semibold text-gray-900 dark:text-white text-lg">{t.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-3">KPI Title</p>
                      <ul className="mt-4 space-y-3 text-base">
                        {(t.items || []).map((i) => {
                          const targetPct = i.target != null ? (typeof i.target === 'number' ? i.target : parseFloat(i.target)) : null;
                          return (
                            <li key={i.id} className="flex justify-between items-center pl-4 border-l-2 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                              <span className="font-medium">{i.description}</span>
                              <span className="text-gray-500 dark:text-gray-400 text-base">
                                Target: {targetPct != null && !isNaN(targetPct) ? `${targetPct}%` : '-'} · Weight: {i.weight != null ? `${Number(i.weight)}%` : '-'}
                              </span>
                              {canEdit && (
                                <button
                                  type="button"
                                  className="text-red-600 dark:text-red-400 text-xs hover:underline"
                                  onClick={async () => {
                                    try {
                                      await api.deleteKpiItem(i.id);
                                      const updated = await api.getAnnualKpi(annualDetail.id);
                                      setAnnualDetail(updated);
                                      const titles = await api.getAnnualKpiTitles(annualDetail.id);
                                      const withItems = await Promise.all(
                                        (titles || []).map(async (tit) => ({
                                          ...tit,
                                          items: await api.getKpiTitleItems(tit.id),
                                        }))
                                      );
                                      setAnnualTitlesWithItems(withItems);
                                    } catch (e) {
                                      toast(e.response?.data?.detail || 'Delete failed', 'error');
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {canEdit && (
                        <form
                          className="mt-3 flex flex-wrap gap-2 items-end"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!(itemForm.description || '').trim()) return;
                            const w = parseFloat(itemForm.weight);
                            const targetVal = parseFloat(itemForm.target);
                            if (isNaN(w) || w < 0 || w > 100) {
                              toast('Weight must be 0–100%', 'error');
                              return;
                            }
                            if (isNaN(targetVal) || targetVal < 0 || targetVal > 100) {
                              toast('Target must be 0–100%', 'error');
                              return;
                            }
                            try {
                              await api.createKpiItem(t.id, {
                                description: (itemForm.description || '').trim(),
                                weight: w,
                                target: targetVal,
                              });
                              setNewItemByTitle((p) => ({ ...p, [t.id]: {} }));
                              const updated = await api.getAnnualKpi(annualDetail.id);
                              setAnnualDetail(updated);
                              const titles = await api.getAnnualKpiTitles(annualDetail.id);
                              const withItems = await Promise.all(
                                (titles || []).map(async (tit) => ({
                                  ...tit,
                                  items: await api.getKpiTitleItems(tit.id),
                                }))
                              );
                              setAnnualTitlesWithItems(withItems);
                              toast('Subtitle added', 'success');
                            } catch (err) {
                              toast(err.response?.data?.detail || 'Failed', 'error');
                            }
                          }}
                        >
                          <input
                            type="text"
                            value={itemForm.description || ''}
                            onChange={(e) => setNewItemByTitle((p) => ({ ...p, [t.id]: { ...(p[t.id] || {}), description: e.target.value } }))}
                            placeholder="Subtitle"
                            className="flex-1 min-w-[140px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                          />
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={itemForm.target ?? ''}
                            onChange={(e) => setNewItemByTitle((p) => ({ ...p, [t.id]: { ...(p[t.id] || {}), target: e.target.value } }))}
                            placeholder="Target %"
                            className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                          />
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={itemForm.weight ?? ''}
                            onChange={(e) => setNewItemByTitle((p) => ({ ...p, [t.id]: { ...(p[t.id] || {}), weight: e.target.value } }))}
                            placeholder="Weight %"
                            className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                          />
                          <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg text-base hover:bg-primary-700">Add subtitle</button>
                        </form>
                      )}
                    </div>
                  );
                })}
                {!closedYears.includes(annualDetail.year) && ((annualDetail.status || '') === 'draft' || (annualDetail.status || '').includes('returned')) && (
                  <form
                    className="flex gap-2 items-end"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!(newTitleName || '').trim()) return;
                      try {
                        await api.createAnnualKpiTitle(annualDetail.id, { name: newTitleName.trim() });
                        setNewTitleName('');
                        const titles = await api.getAnnualKpiTitles(annualDetail.id);
                        const withItems = await Promise.all(
                          (titles || []).map(async (tit) => ({
                            ...tit,
                            items: await api.getKpiTitleItems(tit.id),
                          }))
                        );
                        setAnnualTitlesWithItems(withItems);
                        toast('KPI title added', 'success');
                      } catch (err) {
                        toast(err.response?.data?.detail || 'Failed', 'error');
                      }
                    }}
                  >
                    <input type="text" value={newTitleName} onChange={(e) => setNewTitleName(e.target.value)} placeholder="KPI Title (e.g. Customer Service Performance)" className="flex-1 max-w-md px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base" />
                    <button type="submit" className="px-5 py-2.5 bg-primary-600 text-white rounded-lg text-base hover:bg-primary-700">Add Title</button>
                  </form>
                )}
                {!closedYears.includes(annualDetail.year) && ((annualDetail.status || '') === 'draft' || (annualDetail.status || '').includes('returned')) && Math.abs((annualDetail.total_weight ?? 0) - 100) < 0.01 && (
                  <button
                    type="button"
                    disabled={saving}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await api.submitAnnualKpi(annualDetail.id);
                        toast('Submitted', 'success');
                        loadAnnualKpis();
                        const updated = await api.getAnnualKpi(annualDetail.id);
                        setAnnualDetail(updated);
                      } catch (err) {
                        toast(err.response?.data?.detail || 'Failed', 'error');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Submit for approval
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2 mb-4">
              <input type="number" value={createYear} onChange={(e) => setCreateYear(Number(e.target.value) || new Date().getFullYear())} className="w-24 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
              {closedYears.includes(createYear) && (
                <span className="text-amber-600 dark:text-amber-400 text-sm font-medium">Year {createYear} is closed - no new KPIs can be added.</span>
              )}
              <button
                type="button"
                disabled={closedYears.includes(createYear)}
                className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={async () => {
                  try {
                    await api.createAnnualKpi(createYear);
                    toast('Annual KPIs created', 'success');
                    loadAnnualKpis();
                  } catch (err) {
                    toast(err.response?.data?.detail || 'Failed', 'error');
                  }
                }}
              >
                Create for year
              </button>
            </div>
            {annualKpis.length === 0 ? (
              <EmptyState title="No annual KPIs" message="Create a set for a year above. Add KPI titles and items (total weight 100%), then submit for Supervisor → HOD → HR approval." />
            ) : (
              <ul className="space-y-3">
                {annualKpis.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3 px-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <span className="font-semibold text-gray-800 dark:text-white text-base">{a.year}</span>
                    <span className="text-base text-gray-600 dark:text-gray-400">{(a.total_weight ?? 0)}%</span>
                    <span className={`px-3 py-1 rounded-md text-sm font-medium ${STATUS_BADGE_CLASS[a.status] || 'bg-gray-100 dark:bg-gray-600'}`}>{STATUS_LABELS[a.status] || a.status}</span>
                    <button type="button" onClick={() => setSelectedAnnualId(a.id)} className="text-primary-600 dark:text-primary-400 hover:underline text-base font-medium">Open</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {active && (
        <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-primary-800 dark:text-primary-200">Active cycle</p>
              <p className="text-gray-700 dark:text-gray-300">
                {active.type === 'quarterly' ? `${active.year} ${active.quarter || ''}` : active.year}
                {active.start_date && active.end_date && ` (${active.start_date} – ${active.end_date})`}
              </p>
            </div>
            {isActive && !appraisals.some((a) => a.cycle_id === active.id) && (
              <button
                type="button"
                onClick={() => { api.createAppraisal({ cycle_id: active.id }).then(() => { toast('Appraisal created', 'success'); load(); }).catch((e) => toast(e.response?.data?.detail || 'Failed', 'error')); }}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 shadow-sm"
              >
                Create appraisal for this cycle
              </button>
            )}
          </div>
        </div>
      )}

      {receivedKpis.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <h2 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">Pending acknowledgement (KPIs)</h2>
          <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">Please acknowledge your approved KPIs.</p>
          <ul className="space-y-2">
            {receivedKpis.map((k) => (
              <li key={k.id} className="flex items-center justify-between">
                <span className="text-gray-700 dark:text-gray-300">{k.title}</span>
                <button
                  type="button"
                  disabled={ackId === k.id}
                  onClick={() => handleAckKpi(k.id)}
                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
                >
                  {ackId === k.id ? '…' : 'Acknowledge'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {receivedAppraisals.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <h2 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">Pending acknowledgement (Appraisal)</h2>
          <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">Please acknowledge your approved appraisal.</p>
          <ul className="space-y-2">
            {receivedAppraisals.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span className="text-gray-700 dark:text-gray-300">
                  {a.cycle_type === 'quarterly' ? `${a.year} ${a.quarter || ''}` : a.year}
                </span>
                <button
                  type="button"
                  disabled={ackId === a.id}
                  onClick={() => handleAckAppraisal(a.id)}
                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
                >
                  {ackId === a.id ? '…' : 'Acknowledge'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white p-6 pb-0">My KPIs by cycle</h2>
        {cyclesGrouped.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No KPIs" message={isActive ? 'Use "Create KPI" above to add KPIs for the active cycle.' : 'Create KPIs when an appraisal cycle is active.'} />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {cyclesGrouped.map((group) => {
              const cycleTotal = group.kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
              const cycleLabel = group.type === 'quarterly' ? `${group.year} ${group.quarter || ''}` : group.year;
              return (
                <div key={group.cycle_id} className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-700/50 px-5 py-3 flex justify-between items-center">
                    <span className="font-semibold text-gray-800 dark:text-white text-base">{cycleLabel}</span>
                    <span className="text-base text-gray-600 dark:text-gray-400">Total weight: {cycleTotal}%</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                      <thead className="bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                          <th className="px-5 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Title</th>
                          <th className="px-5 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Weight</th>
                          <th className="px-5 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Target</th>
                          <th className="px-5 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
                          <th className="px-5 py-3 text-right text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                        {group.kpis.map((k) => {
                          const canEdit = (k.status || '') === 'draft' || (k.status || '') === 'returned';
                          return (
                            <tr key={k.id} className="bg-white dark:bg-gray-800">
                              <td className="px-5 py-4 text-base font-medium text-gray-800 dark:text-gray-200">{k.title}</td>
                              <td className="px-5 py-4 text-base text-gray-600 dark:text-gray-400">{k.weight != null ? `${Number(k.weight)}%` : '-'}</td>
                              <td className="px-5 py-4 text-base text-gray-600 dark:text-gray-400 max-w-xs truncate" title={k.target}>{k.target || '-'}</td>
                              <td className="px-5 py-4">
                                <span className={`inline-flex px-3 py-1 rounded-md text-sm font-medium ${STATUS_BADGE_CLASS[k.status] || STATUS_BADGE_CLASS.draft}`}>
                                  {STATUS_LABELS[k.status] || k.status}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-right">
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(k)}
                                    className="text-primary-600 dark:text-primary-400 hover:underline text-base font-medium"
                                  >
                                    Edit
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">My Appraisals by cycle</h2>
        {selectedAppraisalId && appraisalDetail ? (
          <div>
            <button type="button" onClick={() => { setSelectedAppraisalId(null); setSelectedAppraisalRow(null); }} className="text-sm text-primary-600 dark:text-primary-400 hover:underline mb-3">← Back to list</button>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {selectedAppraisalRow ? (selectedAppraisalRow.cycle_type === 'quarterly' ? `${selectedAppraisalRow.year} ${selectedAppraisalRow.quarter || ''}` : selectedAppraisalRow.year) : '-'} · {STATUS_LABELS[appraisalDetail.status] || appraisalDetail.status}
            </p>
            {(appraisalDetail.total_score != null || appraisalDetail.rating) && (
              <p className="font-medium text-gray-800 dark:text-white mb-3">Total: {appraisalDetail.total_score ?? '-'}% · Rating: {appraisalDetail.rating || '-'}</p>
            )}
            {(appraisalDetail.scores || []).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 dark:border-gray-600"><th className="text-left py-2 text-gray-700 dark:text-gray-300">KPI</th><th className="py-2 text-gray-700 dark:text-gray-300">Weight</th><th className="py-2 text-gray-700 dark:text-gray-300">Self %</th><th className="py-2 text-gray-700 dark:text-gray-300">Supervisor %</th><th className="py-2 text-gray-700 dark:text-gray-300">Agreed %</th><th className="py-2 text-gray-700 dark:text-gray-300">Weighted</th></tr></thead>
                  <tbody>
                    {appraisalDetail.scores.map((s) => (
                      <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700">
                        <td className="py-2 text-gray-800 dark:text-gray-200">{s.description} - {s.target}</td>
                        <td className="py-2 text-gray-600 dark:text-gray-400">{s.weight}%</td>
                        <td className="py-2">{s.self_score != null ? s.self_score : '-'}</td>
                        <td className="py-2">{s.supervisor_score != null ? s.supervisor_score : '-'}</td>
                        <td className="py-2">{s.agreed_score != null ? s.agreed_score : '-'}</td>
                        <td className="py-2 text-gray-600 dark:text-gray-400">{s.weighted_score != null ? `${s.weighted_score}%` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No scores" message="Scores appear when HR has locked your annual KPIs and this is a quarterly cycle. Enter scores when the cycle is Active." />
            )}
          </div>
        ) : appraisals.length === 0 ? (
          <EmptyState title="No appraisals" message="Create an appraisal for the active cycle. Score when cycle is Active." />
        ) : (
          <ul className="space-y-2">
            {appraisals.map((a) => (
              <li key={a.id} className="flex justify-between items-center text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {a.cycle_type === 'quarterly' ? `${a.year} ${a.quarter || ''}` : a.year}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE_CLASS[a.status] || STATUS_BADGE_CLASS.draft}`}>
                  {STATUS_LABELS[a.status] || a.status}
                </span>
                <button type="button" onClick={() => { setSelectedAppraisalId(a.id); setSelectedAppraisalRow(a); }} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Open</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-3">Cycles</h2>
        {cycles.length === 0 ? (
          <EmptyState title="No cycles" message="HR will create appraisal cycles." />
        ) : (
          <ul className="space-y-2">
            {cycles.map((c) => (
              <li key={c.id} className="flex justify-between items-center">
                <span className="text-gray-700 dark:text-gray-300">
                  {c.type === 'quarterly' ? `${c.year} ${c.quarter || ''}` : c.year} - {c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-black/50"
              aria-hidden
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              className="fixed right-0 top-0 z-[70] h-screen w-[450px] max-w-[100vw] flex flex-col bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700"
              role="dialog"
              aria-modal="true"
              aria-labelledby="kpi-drawer-title"
            >
              {/* Sticky header */}
              <div className="flex-shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="min-w-0 flex-1">
                  <h2 id="kpi-drawer-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                    {editingKpi ? 'Edit KPI' : 'Create KPI'}
                  </h2>
                  {currentCycleId && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Remaining weight for this cycle: <strong className="text-gray-700 dark:text-gray-300">{remainingWeight}%</strong>
                      {!canSubmitTotal && (
                        <span className="block mt-0.5 text-amber-600 dark:text-amber-400 text-xs">Total must equal 100% to submit</span>
                      )}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-shrink-0 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="p-5 space-y-4">
                  {returnComment && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-1">Return comment (from Manager/HOD)</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{returnComment.comment}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">KPI Title (required)</label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. Complete project X on time"
                      className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">Description (required)</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="Describe the KPI"
                      rows={3}
                      className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">Target / success criteria (required)</label>
                    <input
                      type="text"
                      value={form.target}
                      onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                      placeholder="e.g. Deliver by 30 June with sign-off"
                      className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">Weight (%) (required)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={form.weight}
                      onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                      placeholder="0–100"
                      className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                    />
                    {currentCycleId && form.weight !== '' && !canSubmitTotal && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Current total would be {totalAfter}%. Must equal 100% to submit.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Sticky footer */}
              <div className="flex-shrink-0 px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving || !(form.title || '').trim() || !(form.description || '').trim() || !(form.target || '').trim() || form.weight === ''}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                >
                  {saving ? '…' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  onClick={handleSubmitForApproval}
                  disabled={saving || !formValid || !canSubmitTotal}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? '…' : 'Submit for approval'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
