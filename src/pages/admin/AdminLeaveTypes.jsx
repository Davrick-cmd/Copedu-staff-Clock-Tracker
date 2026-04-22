import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { ROUTES } from '../../utils/constants';
import { useToast } from '../../hooks/useToast';
import { LoadingSpinner } from '../../components/LoadingSpinner';

export function AdminLeaveTypes() {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [form, setForm] = useState({ code: '', name: '', default_days: '0' });

  const load = () => {
    setLoading(true);
    api
      .getLeaveTypes()
      .then(setTypes)
      .catch(() => toast('Could not load leave types', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const code = form.code.trim();
    const name = form.name.trim();
    if (!code || !name) {
      toast('Code and name are required', 'error');
      return;
    }
    let default_days = parseFloat(form.default_days);
    if (Number.isNaN(default_days) || default_days < 0) {
      toast('Default days must be zero or a positive number', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.createLeaveType({ code, name, default_days });
      toast('Leave type created', 'success');
      setForm({ code: '', name: '', default_days: '0' });
      load();
    } catch (err) {
      toast(err?.response?.data?.detail || 'Could not create leave type', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (type) => {
    const ok = window.confirm(`Delete leave type "${type?.name || ''}"? This hides it from new requests.`);
    if (!ok) return;
    setDeletingId(type.id);
    try {
      await api.deleteLeaveType(type.id);
      toast('Leave type deleted', 'success');
      load();
    } catch (err) {
      toast(err?.response?.data?.detail || 'Could not delete leave type', 'error');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-8 max-w-3xl">
      <div>
        <p className="text-sm text-primary-600 dark:text-primary-400 font-medium">
          <Link to={ROUTES.ADMIN.DASHBOARD} className="hover:underline">
            Admin
          </Link>{' '}
          / Leave types
        </p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">Leave types</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
          Active types appear for employees when they apply for leave and for managers when assigning leave. Each type
          needs a short unique code (stored uppercase). Default days seed new balance rows where configured.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Add a leave type</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Code</label>
            <input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. STUDY_LEAVE"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Display name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Study leave"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Default days (annual allocation hint)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={form.default_days}
              onChange={(e) => setForm((f) => ({ ...f, default_days: e.target.value }))}
              className="w-full max-w-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create leave type'}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Active types</h2>
        {loading ? (
          <LoadingSpinner />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {types.map((t) => (
              <li key={t.id} className="py-3 flex flex-wrap justify-between gap-2 text-sm">
                <div>
                  <span className="font-medium text-slate-900 dark:text-white">{t.name}</span>
                  <span className="text-slate-500 dark:text-slate-400 tabular-nums ml-3">
                    <span className="font-mono text-xs mr-2">{t.code}</span>
                    {t.default_days ?? 0} days default
                  </span>
                </div>
                <button
                  type="button"
                  disabled={deletingId === t.id}
                  onClick={() => onDelete(t)}
                  className="px-2.5 py-1 rounded-lg border border-red-300 text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  {deletingId === t.id ? 'Deleting…' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
