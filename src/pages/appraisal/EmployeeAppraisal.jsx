import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
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
  const profile = useSelector((s) => s.auth.profile);
  const myId = profile?.id;
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
  const [scoreRows, setScoreRows] = useState({});
  const [savingScores, setSavingScores] = useState(false);
  const [apNarrative, setApNarrative] = useState({ achievements: '', challenges: '', overall_comments: '' });
  const [confirmAgreeing, setConfirmAgreeing] = useState(false);
  const [downloadingSummary, setDownloadingSummary] = useState(false);
  const [signUploading, setSignUploading] = useState(false);

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
    if (!appraisalDetail?.id) {
      setScoreRows({});
      setApNarrative({ achievements: '', challenges: '', overall_comments: '' });
      return;
    }
    setApNarrative({
      achievements: appraisalDetail.achievements || '',
      challenges: appraisalDetail.challenges || '',
      overall_comments: appraisalDetail.overall_comments || '',
    });
    const o = {};
    (appraisalDetail.scores || []).forEach((s) => {
      o[s.kpi_item_id] = {
        self_score: s.self_score ?? '',
        self_comment: s.self_comment ?? '',
      };
    });
    setScoreRows(o);
  }, [appraisalDetail?.id]);

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
    setForm({ title: '', description: '', target: '', weight: '' });
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
  const activeYearClosed = !!(active && closedYears.includes(Number(active.year)));
  const editKpiYearClosed = !!(editingKpi && closedYears.includes(Number(editingKpi.year)));
  const kpiYearBlocked = editKpiYearClosed || (!editingKpi && activeYearClosed);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Performance contract & appraisal</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Your main KPI sheet is <strong className="text-gray-800 dark:text-gray-200">Annual KPIs</strong> below — same idea as the Excel performance contract (categories, lines, weight %, expected results %). Quarterly appraisals score those lines.</p>
        </div>
        <Link to={ROUTES.EMPLOYEE.DASHBOARD} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Back to Dashboard</Link>
      </div>

      <p className="text-gray-600 dark:text-gray-400 text-sm border-l-4 border-primary-500 pl-3 py-1">
        <strong>Annual KPIs:</strong> build your contract (total weight 100%), submit for Supervisor → HOD → HR lock.
        <span className="mx-1.5 text-gray-400">·</span>
        <strong>Quarterly:</strong> open My Appraisals for self %, narrative, confirm agreed scores, download, sign, upload.
        <span className="mx-1.5 text-gray-400">·</span>
        Optional <strong>cycle KPIs</strong> (further down) are separate one-line records per cycle if HR still uses them.
      </p>

      {/* Annual KPIs = performance contract (Excel-style); drives quarterly appraisal score rows */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg ring-1 ring-primary-200/60 dark:ring-primary-900/40 border border-gray-100 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-1">Annual KPIs — performance contract</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Mirror your Excel sheet: each <em>category</em> is a section; each <em>line</em> is a KPI with weighting % and expected results %.</p>
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
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <p className="text-base text-gray-600 dark:text-gray-400">
                    Contract year <strong className="text-gray-900 dark:text-white">{annualDetail.year}</strong>
                    {' · '}
                    Total KPI weighting: <strong>{annualDetail.total_weight ?? 0}%</strong> (target 100%)
                    {' · '}
                    {STATUS_LABELS[annualDetail.status] || annualDetail.status}
                  </p>
                </div>
                {profile && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 p-4 mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-3">Contract header (from your profile)</p>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">Employee name</dt>
                        <dd className="font-medium text-gray-900 dark:text-white">{profile.full_name || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">Job title</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.job_title || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">Duty station</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.branches?.name || profile.branches?.code || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">Department</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.department || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">Name of supervisor</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.supervisor_name || '—'}</dd>
                      </div>
                    </dl>
                  </div>
                )}
                {(() => {
                  const yearClosed = closedYears.includes(annualDetail.year);
                  const canEdit = !yearClosed && ((annualDetail.status || '') === 'draft' || (annualDetail.status || '').includes('returned'));
                  const refreshAnnualItems = async () => {
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
                  };
                  return (
                    <div className="overflow-x-auto rounded-lg border border-slate-300 dark:border-slate-600">
                      <table className="min-w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-slate-600 text-white dark:bg-slate-700">
                            <th className="text-left px-4 py-3 font-semibold">KPIs (Key performance indicators)</th>
                            <th className="text-center px-3 py-3 font-semibold w-28">KPI weighting %</th>
                            <th className="text-center px-3 py-3 font-semibold w-32">Expected results %</th>
                            {canEdit ? <th className="w-20 px-2 py-3" aria-label="Actions" /> : null}
                          </tr>
                        </thead>
                        {annualTitlesWithItems.length === 0 ? (
                          <tbody>
                            <tr>
                              <td colSpan={canEdit ? 4 : 3} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                                No categories yet. Add a category below (e.g. 1. Infrastructure Maintenance and Availability), then add KPI lines with weighting and expected results %.
                              </td>
                            </tr>
                          </tbody>
                        ) : null}
                        {annualTitlesWithItems.map((t) => {
                          const itemForm = newItemByTitle[t.id] || {};
                          return (
                            <tbody key={t.id}>
                              <tr className="bg-slate-200 dark:bg-slate-700/80">
                                <td colSpan={canEdit ? 4 : 3} className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">
                                  {t.name}
                                </td>
                              </tr>
                              {(t.items || []).length === 0 ? (
                                <tr>
                                  <td colSpan={canEdit ? 4 : 3} className="px-4 py-2 text-gray-500 dark:text-gray-400 italic border-b border-slate-200 dark:border-slate-600">
                                    No KPI lines in this category yet.
                                  </td>
                                </tr>
                              ) : null}
                              {(t.items || []).map((i) => {
                                const raw = i.target;
                                const targetPct = raw != null
                                  ? (typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/%/g, '')))
                                  : null;
                                return (
                                  <tr key={i.id} className="border-b border-slate-200 dark:border-slate-600 bg-white dark:bg-gray-800">
                                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200 align-top">{i.description}</td>
                                    <td className="px-3 py-3 text-center tabular-nums text-gray-700 dark:text-gray-300">{i.weight != null ? `${Number(i.weight)}` : '—'}</td>
                                    <td className="px-3 py-3 text-center tabular-nums text-gray-700 dark:text-gray-300">{targetPct != null && !Number.isNaN(targetPct) ? `${targetPct}` : '—'}</td>
                                    {canEdit ? (
                                      <td className="px-2 py-3 text-right">
                                        <button
                                          type="button"
                                          className="text-red-600 dark:text-red-400 text-xs hover:underline"
                                          onClick={async () => {
                                            try {
                                              await api.deleteKpiItem(i.id);
                                              await refreshAnnualItems();
                                            } catch (e) {
                                              toast(e.response?.data?.detail || 'Delete failed', 'error');
                                            }
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </td>
                                    ) : null}
                                  </tr>
                                );
                              })}
                              {canEdit ? (
                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-600">
                                  <td colSpan={4} className="px-4 py-3">
                                    <form
                                      className="flex flex-wrap gap-2 items-end"
                                      onSubmit={async (e) => {
                                        e.preventDefault();
                                        if (!(itemForm.description || '').trim()) return;
                                        const w = parseFloat(itemForm.weight);
                                        const targetVal = parseFloat(itemForm.target);
                                        if (Number.isNaN(w) || w < 0 || w > 100) {
                                          toast('KPI weighting must be 0–100%', 'error');
                                          return;
                                        }
                                        if (Number.isNaN(targetVal) || targetVal < 0 || targetVal > 100) {
                                          toast('Expected results must be 0–100%', 'error');
                                          return;
                                        }
                                        try {
                                          await api.createKpiItem(t.id, {
                                            description: (itemForm.description || '').trim(),
                                            weight: w,
                                            target: targetVal,
                                          });
                                          setNewItemByTitle((p) => ({ ...p, [t.id]: {} }));
                                          await refreshAnnualItems();
                                          toast('KPI line added', 'success');
                                        } catch (err) {
                                          toast(err.response?.data?.detail || 'Failed', 'error');
                                        }
                                      }}
                                    >
                                      <input
                                        type="text"
                                        value={itemForm.description || ''}
                                        onChange={(e) => setNewItemByTitle((p) => ({ ...p, [t.id]: { ...(p[t.id] || {}), description: e.target.value } }))}
                                        placeholder="KPI wording (key performance indicator)"
                                        className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                      />
                                      <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        value={itemForm.target ?? ''}
                                        onChange={(e) => setNewItemByTitle((p) => ({ ...p, [t.id]: { ...(p[t.id] || {}), target: e.target.value } }))}
                                        placeholder="Expected %"
                                        className="w-28 min-w-[7.5rem] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                      />
                                      <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        value={itemForm.weight ?? ''}
                                        onChange={(e) => setNewItemByTitle((p) => ({ ...p, [t.id]: { ...(p[t.id] || {}), weight: e.target.value } }))}
                                        placeholder="Weight %"
                                        className="w-28 min-w-[7.5rem] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                      />
                                      <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">Add KPI line</button>
                                    </form>
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          );
                        })}
                      </table>
                    </div>
                  );
                })()}
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
                        toast('Category added', 'success');
                      } catch (err) {
                        toast(err.response?.data?.detail || 'Failed', 'error');
                      }
                    }}
                  >
                    <input type="text" value={newTitleName} onChange={(e) => setNewTitleName(e.target.value)} placeholder="Category / KPI area (e.g. 1. Infrastructure Maintenance and Availability)" className="flex-1 max-w-md px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base" />
                    <button type="submit" className="px-5 py-2.5 bg-primary-600 text-white rounded-lg text-base hover:bg-primary-700">Add category</button>
                  </form>
                )}
                {!closedYears.includes(annualDetail.year) && ((annualDetail.status || '') === 'draft' || (annualDetail.status || '').includes('returned')) && (() => {
                  const tw = Number(annualDetail.total_weight) || 0;
                  const readyToSubmit = Math.abs(tw - 100) < 0.01;
                  const remaining = Math.max(0, Math.round((100 - tw) * 100) / 100);
                  return (
                    <div className="mt-6 flex flex-col gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/30">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={saving || !readyToSubmit}
                          title={!readyToSubmit ? 'Add KPI lines until KPI weighting % totals 100%' : ''}
                          className="px-4 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={async () => {
                            if (!readyToSubmit) return;
                            setSaving(true);
                            try {
                              await api.submitAnnualKpi(annualDetail.id);
                              toast('Submitted to supervisor', 'success');
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
                          {saving ? 'Submitting…' : 'Submit to supervisor'}
                        </button>
                        {!readyToSubmit ? (
                          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-xl">
                            Total KPI weighting is <strong className="text-gray-800 dark:text-gray-200">{tw}%</strong>; it must be <strong>100%</strong> before submit (same rule as your Excel contract). About <strong>{remaining}%</strong> still to assign across your lines.
                          </p>
                        ) : (
                          <p className="text-sm text-green-700 dark:text-green-400">Weights total 100%. You can submit to your supervisor.</p>
                        )}
                      </div>
                    </div>
                  );
                })()}
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
        <div className="p-6 pb-0 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Optional: KPI lines by appraisal cycle</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">Separate from your <strong className="text-gray-700 dark:text-gray-300">annual performance contract</strong> above. Use this block only if HR still collects per-cycle KPI records in addition to the annual sheet.</p>
          </div>
          {isActive && active?.id && (
            <button
              type="button"
              onClick={() => {
                if (activeYearClosed) {
                  toast('This performance year is closed. Ask HR or Admin to reopen the cycle (Draft) before adding KPIs.', 'error');
                  return;
                }
                openCreateModal();
              }}
              disabled={activeYearClosed}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create KPI
            </button>
          )}
        </div>
        {activeYearClosed && isActive && (
          <p className="px-6 pt-2 text-sm text-amber-700 dark:text-amber-300">Year {active.year} is closed for performance KPIs. HR/Admin can reopen a cycle for this year (Appraisal → Cycles → Reopen).</p>
        )}
        {cyclesGrouped.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No KPIs yet"
              message={isActive && !activeYearClosed ? 'Use Create KPI to add lines for this cycle, then submit each to your supervisor.' : isActive && activeYearClosed ? 'This year is closed for new KPIs until HR reopens a cycle.' : 'When HR sets an active appraisal cycle, you can create KPIs here.'}
            />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {cyclesGrouped.map((group) => {
              const cycleTotal = group.kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
              const cycleLabel = group.type === 'quarterly' ? `${group.year} ${group.quarter || ''}` : group.year;
              const groupYearClosed = closedYears.includes(Number(group.year));
              return (
                <div key={group.cycle_id} className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-700/50 px-5 py-3 flex justify-between items-center">
                    <span className="font-semibold text-gray-800 dark:text-white text-base">{cycleLabel}</span>
                    <span className="text-base text-gray-600 dark:text-gray-400">
                      Total weight: {cycleTotal}%
                      {groupYearClosed && <span className="ml-2 text-amber-600 dark:text-amber-400 text-sm">(year closed)</span>}
                    </span>
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
                          const statusOk = (k.status || '') === 'draft' || (k.status || '') === 'returned';
                          const canEdit = statusOk && !groupYearClosed;
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
                                {canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(k)}
                                    className="text-primary-600 dark:text-primary-400 hover:underline text-base font-medium"
                                  >
                                    Edit
                                  </button>
                                ) : statusOk && groupYearClosed ? (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">Year closed</span>
                                ) : ['pending_supervisor', 'verified'].includes(k.status || '') ? (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">With supervisor</span>
                                ) : null}
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
          <div className="space-y-4">
            <button type="button" onClick={() => { setSelectedAppraisalId(null); setSelectedAppraisalRow(null); }} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">← Back to list</button>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {selectedAppraisalRow ? (selectedAppraisalRow.cycle_type === 'quarterly' ? `${selectedAppraisalRow.year} ${selectedAppraisalRow.quarter || ''}` : selectedAppraisalRow.year) : '-'} · {STATUS_LABELS[appraisalDetail.status] || appraisalDetail.status}
            </p>
            {appraisalDetail.employee_agreed_scores_at && (
              <p className="text-sm text-green-700 dark:text-green-300">You confirmed agreement with the agreed scores on {appraisalDetail.employee_agreed_scores_at}.</p>
            )}
            {(appraisalDetail.total_score != null || appraisalDetail.rating) && (
              <p className="font-medium text-gray-800 dark:text-white">Total: {appraisalDetail.total_score ?? '-'}% · Rating: {appraisalDetail.rating || '-'}</p>
            )}

            {(() => {
              const st = appraisalDetail.status || '';
              const canEditAppraisal = (st === 'draft' || st === 'returned') && isActive;
              return canEditAppraisal ? (
                <div className="space-y-3 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-800 dark:text-white">Self-assessment (save before submit)</p>
                  <textarea value={apNarrative.achievements} onChange={(e) => setApNarrative((n) => ({ ...n, achievements: e.target.value }))} rows={3} placeholder="Achievements" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm" />
                  <textarea value={apNarrative.challenges} onChange={(e) => setApNarrative((n) => ({ ...n, challenges: e.target.value }))} rows={3} placeholder="Challenges" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm" />
                  <textarea value={apNarrative.overall_comments} onChange={(e) => setApNarrative((n) => ({ ...n, overall_comments: e.target.value }))} rows={2} placeholder="Overall comments" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm" />
                  <button
                    type="button"
                    disabled={savingScores}
                    className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white rounded-lg text-sm"
                    onClick={async () => {
                      setSavingScores(true);
                      try {
                        await api.updateAppraisal(selectedAppraisalId, {
                          achievements: apNarrative.achievements,
                          challenges: apNarrative.challenges,
                          overall_comments: apNarrative.overall_comments,
                        });
                        toast('Narrative saved', 'success');
                        const d = await api.getAppraisal(selectedAppraisalId);
                        setAppraisalDetail(d);
                        load();
                      } catch (e) {
                        toast(e.response?.data?.detail || 'Failed', 'error');
                      } finally {
                        setSavingScores(false);
                      }
                    }}
                  >
                    Save narrative
                  </button>
                </div>
              ) : null;
            })()}

            {(appraisalDetail.scores || []).length > 0 ? (
              <div className="overflow-x-auto space-y-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className="text-left py-2 text-gray-700 dark:text-gray-300">KPI (from locked annual contract)</th>
                      <th className="text-center py-2 text-gray-700 dark:text-gray-300">Weight %</th>
                      <th className="text-center py-2 text-gray-700 dark:text-gray-300">Self %</th>
                      <th className="text-center py-2 text-gray-700 dark:text-gray-300">Supervisor %</th>
                      <th className="text-center py-2 text-gray-700 dark:text-gray-300">Agreed %</th>
                      <th className="text-center py-2 text-gray-700 dark:text-gray-300">Weighted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appraisalDetail.scores.map((s) => {
                      const kid = s.kpi_item_id;
                      const row = scoreRows[kid] || { self_score: '', self_comment: '' };
                      const canEditSelf = ((appraisalDetail.status || '') === 'draft' || (appraisalDetail.status || '') === 'returned') && isActive;
                      return (
                        <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700 align-top">
                          <td className="py-2 text-gray-800 dark:text-gray-200 max-w-[200px]">{s.description} — {s.target}</td>
                          <td className="py-2 text-center text-gray-600 dark:text-gray-400 tabular-nums">{s.weight}%</td>
                          <td className="py-2 text-center">
                            {canEditSelf ? (
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={row.self_score}
                                onChange={(e) => setScoreRows((prev) => ({ ...prev, [kid]: { ...row, self_score: e.target.value } }))}
                                className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                              />
                            ) : (
                              s.self_score ?? '—'
                            )}
                          </td>
                          <td className="py-2 text-center tabular-nums">{s.supervisor_score != null ? s.supervisor_score : '—'}</td>
                          <td className="py-2 text-center tabular-nums">{s.agreed_score != null ? s.agreed_score : '—'}</td>
                          <td className="py-2 text-center text-gray-600 dark:text-gray-400 tabular-nums">{s.weighted_score != null ? `${s.weighted_score}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {((appraisalDetail.status || '') === 'draft' || (appraisalDetail.status || '') === 'returned') && isActive && (appraisalDetail.scores || []).length > 0 && (
                  <button
                    type="button"
                    disabled={savingScores}
                    onClick={async () => {
                      setSavingScores(true);
                      try {
                        for (const s of appraisalDetail.scores) {
                          const kid = s.kpi_item_id;
                          const r = scoreRows[kid] || {};
                          const v = r.self_score === '' || r.self_score === null ? null : Number(r.self_score);
                          if (v != null && (Number.isNaN(v) || v < 0 || v > 100)) {
                            toast('Self % must be between 0 and 100', 'error');
                            setSavingScores(false);
                            return;
                          }
                          await api.updateAppraisalScore(selectedAppraisalId, kid, { self_score: v, self_comment: r.self_comment || null });
                        }
                        toast('Self scores saved', 'success');
                        const d = await api.getAppraisal(selectedAppraisalId);
                        setAppraisalDetail(d);
                        load();
                      } catch (e) {
                        toast(e.response?.data?.detail || 'Failed', 'error');
                      } finally {
                        setSavingScores(false);
                      }
                    }}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
                  >
                    Save my scores
                  </button>
                )}
              </div>
            ) : (
              <EmptyState title="No scored KPI lines" message="After HR locks your annual KPIs for this year, quarterly appraisals get one row per subtitle. Enter self % when the cycle is Active." />
            )}

            {((appraisalDetail.status || '') === 'draft' || (appraisalDetail.status || '') === 'returned') && (
              <button
                type="button"
                disabled={savingScores}
                onClick={async () => {
                  setSavingScores(true);
                  try {
                    await api.submitAppraisal(selectedAppraisalId);
                    toast('Submitted to your supervisor', 'success');
                    const d = await api.getAppraisal(selectedAppraisalId);
                    setAppraisalDetail(d);
                    load();
                  } catch (e) {
                    toast(e.response?.data?.detail || 'Failed', 'error');
                  } finally {
                    setSavingScores(false);
                  }
                }}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
              >
                Submit appraisal to supervisor
              </button>
            )}

            {(appraisalDetail.status || '') === 'verified' && (appraisalDetail.scores || []).length > 0 && !appraisalDetail.employee_agreed_scores_at && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-2">
                <p className="text-sm text-gray-800 dark:text-gray-200">Your manager has completed the review chain. Confirm that you agree with the <strong>Agreed %</strong> on every line (your manager must fill them all first).</p>
                <button
                  type="button"
                  disabled={confirmAgreeing}
                  onClick={async () => {
                    setConfirmAgreeing(true);
                    try {
                      await api.confirmAppraisalAgreedScores(selectedAppraisalId);
                      toast('Agreement recorded. HOD/HR can now approve.', 'success');
                      const d = await api.getAppraisal(selectedAppraisalId);
                      setAppraisalDetail(d);
                      load();
                    } catch (e) {
                      toast(e.response?.data?.detail || 'Failed', 'error');
                    } finally {
                      setConfirmAgreeing(false);
                    }
                  }}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 disabled:opacity-50"
                >
                  I agree with the agreed scores
                </button>
              </div>
            )}

            {(['verified', 'approved', 'received', 'acknowledged'].includes(appraisalDetail.status || '')) && (
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  disabled={downloadingSummary || ((appraisalDetail.scores || []).length > 0 && !appraisalDetail.employee_agreed_scores_at && (appraisalDetail.status || '') === 'verified')}
                  title={(appraisalDetail.scores || []).length > 0 && !appraisalDetail.employee_agreed_scores_at && (appraisalDetail.status || '') === 'verified' ? 'Confirm agreed scores first' : ''}
                  onClick={async () => {
                    setDownloadingSummary(true);
                    try {
                      const blob = await api.fetchAppraisalAgreedSummaryBlob(selectedAppraisalId);
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const q = selectedAppraisalRow?.quarter || 'annual';
                      a.download = `appraisal-${selectedAppraisalRow?.year || ''}-${q}.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast('Download started — open the file and use Print → Save as PDF if needed', 'success');
                    } catch (e) {
                      toast(e.response?.data?.detail || e.message || 'Failed', 'error');
                    } finally {
                      setDownloadingSummary(false);
                    }
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Download summary (HTML)
                </button>
              </div>
            )}

            {myId && ['approved', 'received', 'acknowledged'].includes(appraisalDetail.status || '') && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-4 space-y-2">
                <p className="text-sm text-gray-700 dark:text-gray-300">Upload a scan or PDF of the <strong>signed</strong> appraisal (HR is notified).</p>
                {appraisalDetail.signed_document_id && (
                  <p className="text-xs text-green-700 dark:text-green-400">A signed file is already linked to this appraisal. Upload again to replace.</p>
                )}
                <input
                  type="file"
                  accept=".pdf,image/*"
                  disabled={signUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setSignUploading(true);
                    try {
                      await api.uploadStaffDocument(file, `Signed appraisal ${selectedAppraisalRow?.year || ''} ${selectedAppraisalRow?.quarter || ''}`, 'signed_appraisal', myId, selectedAppraisalId);
                      toast('Signed appraisal uploaded', 'success');
                      const d = await api.getAppraisal(selectedAppraisalId);
                      setAppraisalDetail(d);
                    } catch (err) {
                      toast(err.response?.data?.detail || 'Upload failed', 'error');
                    } finally {
                      setSignUploading(false);
                    }
                  }}
                  className="text-sm"
                />
              </div>
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
              <div className="flex-shrink-0 px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col gap-2">
                {kpiYearBlocked && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">This performance year is closed — HR/Admin must reopen the cycle before you can save or submit.</p>
                )}
                <div className="flex flex-wrap gap-2 justify-end">
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
                    disabled={saving || kpiYearBlocked || !(form.title || '').trim() || !(form.description || '').trim() || !(form.target || '').trim() || form.weight === ''}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                  >
                    {saving ? '…' : 'Save as Draft'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitForApproval}
                    disabled={saving || kpiYearBlocked || !formValid || !canSubmitTotal}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  >
                    {saving ? '…' : 'Submit to supervisor'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
