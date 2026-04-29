import { useEffect, useState } from 'react';
import * as api from '../../services/api';

export function HRShifts() {
  const [shifts, setShifts] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [sessionRole, setSessionRole] = useState('');
  const [canManageShiftTemplates, setCanManageShiftTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    start_time: '08:00',
    end_time: '17:00',
    grace_period_minutes: 15,
    overtime_threshold_minutes: 30,
    department: '',
  });
  const [assignForm, setAssignForm] = useState({
    user_id: '',
    shift_id: '',
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: '',
  });

  const load = async () => {
    const [s, u, a] = await Promise.all([
      api.getAttendanceShifts().catch(() => []),
      api.getAttendanceShiftAssignees().catch(() => []),
      api.getAttendanceShiftAssignments().catch(() => []),
    ]);
    setShifts(s || []);
    setUsers(u || []);
    setAssignments(a || []);
  };

  useEffect(() => {
    api.getSession().then((s) => {
      const r = (s?.profile?.role || '').toLowerCase();
      setSessionRole(r);
      setCanManageShiftTemplates(r === 'admin' || r === 'hr');
    }).catch(() => {
      setSessionRole('');
      setCanManageShiftTemplates(false);
    });
    load();
  }, []);

  const createShift = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createAttendanceShift({
        ...form,
        grace_period_minutes: Number(form.grace_period_minutes || 0),
        overtime_threshold_minutes: Number(form.overtime_threshold_minutes || 0),
      });
      setForm({
        name: '',
        start_time: '08:00',
        end_time: '17:00',
        grace_period_minutes: 15,
        overtime_threshold_minutes: 30,
        department: '',
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const assignShift = async (e) => {
    e.preventDefault();
    if (!assignForm.user_id || !assignForm.shift_id || !assignForm.effective_from) return;
    setSaving(true);
    try {
      await api.assignAttendanceShift({
        ...assignForm,
        effective_to: assignForm.effective_to || null,
      });
      setAssignForm((p) => ({ ...p, effective_to: '' }));
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shift management</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Use this page in 2 steps: <strong>1) create shift templates</strong>, then <strong>2) assign them to employees</strong>.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Example: A shift with start <strong>08:00</strong>, grace <strong>15 min</strong>, and overtime threshold <strong>30 min</strong> means check-ins after 08:15 are marked late, and overtime starts after 17:30.
        </p>
      </div>

      {canManageShiftTemplates && (
      <form onSubmit={createShift} className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Step 1: Create shift template</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Shift name</label>
            <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Teller Shift" className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Start time</label>
            <input type="time" value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">End time</label>
            <input type="time" value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Grace period (minutes)</label>
            <input type="number" min="0" value={form.grace_period_minutes} onChange={(e) => setForm((p) => ({ ...p, grace_period_minutes: e.target.value }))} placeholder="e.g. 15" className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Overtime threshold (minutes)</label>
            <input type="number" min="0" value={form.overtime_threshold_minutes} onChange={(e) => setForm((p) => ({ ...p, overtime_threshold_minutes: e.target.value }))} placeholder="e.g. 30" className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Department (optional)</label>
            <input value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))} placeholder="e.g. Business Department" className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
          </div>
        </div>
        <div>
          <button disabled={saving} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-60">{saving ? 'Saving...' : 'Create shift template'}</button>
        </div>
      </form>
      )}

      <form onSubmit={assignShift} className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Step 2: Assign shift to employee</h2>
        <div className="grid gap-3 md:grid-cols-4">
        <select value={assignForm.user_id} onChange={(e) => setAssignForm((p) => ({ ...p, user_id: e.target.value }))} className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" required>
          <option value="">Select employee...</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select value={assignForm.shift_id} onChange={(e) => setAssignForm((p) => ({ ...p, shift_id: e.target.value }))} className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" required>
          <option value="">Select shift template...</option>
          {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={assignForm.effective_from} onChange={(e) => setAssignForm((p) => ({ ...p, effective_from: e.target.value }))} className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" required />
        <input type="date" value={assignForm.effective_to} onChange={(e) => setAssignForm((p) => ({ ...p, effective_to: e.target.value }))} className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" placeholder="Optional end date" />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Leave end date empty if this shift should continue until changed.</p>
        <div>
          <button disabled={saving} className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-60">{saving ? 'Saving...' : 'Assign shift'}</button>
        </div>
      </form>
      {!canManageShiftTemplates && (sessionRole === 'manager' || sessionRole === 'hod' || sessionRole === 'employee') && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Your account is in delegated mode: you can assign shifts to allowed staff, but cannot create/update/delete shift templates.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <h2 className="font-semibold mb-2">Shifts</h2>
          {!shifts.length ? <p className="text-sm text-gray-500 dark:text-gray-400">No shift templates yet. Create one above.</p> : <ul className="space-y-2 text-sm">
            {shifts.map((s) => (
              <li key={s.id} className="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
                <span>{s.name} ({s.start_time} - {s.end_time})</span>
                <span>Grace {s.grace_period_minutes}m, OT {s.overtime_threshold_minutes}m</span>
              </li>
            ))}
          </ul>}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <h2 className="font-semibold mb-2">Recent assignments</h2>
          {!assignments.length ? <p className="text-sm text-gray-500 dark:text-gray-400">No assignments yet.</p> : <ul className="space-y-2 text-sm">
            {assignments.slice(0, 20).map((a) => (
              <li key={a.id} className="border-b border-gray-200 dark:border-gray-700 pb-2">
                {a.user_name} {'->'} {a.shift_name} ({a.effective_from} {a.effective_to ? `to ${a.effective_to}` : 'onward'})
              </li>
            ))}
          </ul>}
        </div>
      </div>
    </div>
  );
}

