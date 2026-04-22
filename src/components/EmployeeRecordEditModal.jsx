import { useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../services/api';
import { DEPARTMENTS } from '../utils/constants';
import { useToast } from '../hooks/useToast';
import { EmployeeRecordStaffDocs } from './EmployeeRecordStaffDocs';

export const GENDERS = [
  { value: '', label: '(Not set)' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_say', label: 'Prefer not to say' },
];

function fieldLabel(className, text) {
  return (
    <label className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 ${className || ''}`}>{text}</label>
  );
}

/**
 * Full employee profile editor for HR/Admin - updates via PATCH /users/:id/record.
 * Use for promotions, transfers, contact changes, hire dates, etc.
 */
export function EmployeeRecordEditModal({ user, users, branches, departments = DEPARTMENTS, onClose, onSaved, title = 'Edit employee record' }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    full_name: user.full_name || '',
    gender: user.gender || '',
    phone: user.phone || '',
    employee_id: user.employee_id || '',
    employee_code: user.employee_code || '',
    job_title: user.job_title || '',
    division: user.division || '',
    department: user.department || '',
    branch_id: user.branch_id || '',
    manager_id: user.manager_id || '',
    work_anniversary: user.work_anniversary ? String(user.work_anniversary).slice(0, 10) : '',
    date_of_birth: user.date_of_birth ? String(user.date_of_birth).slice(0, 10) : '',
    hr_notes: user.hr_notes || '',
    net_salary: user.net_salary != null && user.net_salary !== '' ? String(user.net_salary) : '',
    is_married: user.is_married === 1 || user.is_married === true ? 'yes' : user.is_married === 0 || user.is_married === false ? 'no' : '',
    is_active: user.is_active === 1 || user.is_active === true,
  }));

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        gender: form.gender || null,
        phone: form.phone.trim() || null,
        employee_id: form.employee_id.trim() || null,
        employee_code: form.employee_code.trim() || null,
        job_title: form.job_title.trim() || null,
        division: form.division.trim() || null,
        department: form.department.trim() || null,
        branch_id: form.branch_id || null,
        manager_id: form.manager_id || null,
        work_anniversary: form.work_anniversary.trim() || null,
        date_of_birth: form.date_of_birth.trim() || null,
        hr_notes: form.hr_notes.trim() || null,
      };
      if ((form.net_salary || '').trim() !== '') {
        const n = parseFloat(form.net_salary.replace(/,/g, ''));
        if (!Number.isFinite(n)) {
          toast('Enter a valid net salary or leave blank', 'error');
          setSaving(false);
          return;
        }
        payload.net_salary = n;
      } else {
        payload.net_salary = null;
      }
      if (form.is_married === 'yes') payload.is_married = true;
      else if (form.is_married === 'no') payload.is_married = false;
      else payload.is_married = null;
      await api.updateEmployeeRecord(user.id, payload);
      const nextActive = !!form.is_active;
      const currentActive = user.is_active === 1 || user.is_active === true;
      if (nextActive !== currentActive) {
        await api.setUserActive(user.id, nextActive);
      }
      toast('Employee record saved', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:hover:text-white p-1" aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {fieldLabel('', 'Full name *')}
          <input
            required
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              {fieldLabel('', 'Gender')}
              <select
                value={form.gender}
                onChange={(e) => set('gender', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {GENDERS.map((g) => (
                  <option key={g.value || 'empty'} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {fieldLabel('', 'Phone')}
              <input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="+250…"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              {fieldLabel('', 'Employee ID')}
              <input
                value={form.employee_id}
                onChange={(e) => set('employee_id', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              {fieldLabel('', 'Staff code')}
              <input
                value={form.employee_code}
                onChange={(e) => set('employee_code', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            {fieldLabel('', 'Job title')}
            <input
              value={form.job_title}
              onChange={(e) => set('job_title', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Update when role or position changes"
            />
          </div>
          <div>
            {fieldLabel('', 'Division / unit')}
            <input
              value={form.division}
              onChange={(e) => set('division', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            {fieldLabel('', 'Department')}
            <select
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">(Unassigned)</option>
              {form.department && !departments.includes(form.department) && (
                <option value={form.department}>{form.department} (current)</option>
              )}
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            {fieldLabel('', 'Branch / location')}
            <select
              value={form.branch_id}
              onChange={(e) => set('branch_id', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">(None)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            {fieldLabel('', 'Supervisor')}
            <select
              value={form.manager_id}
              onChange={(e) => set('manager_id', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">(None)</option>
              {users.filter((m) => m.id !== user.id).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Leave goes to this person first. The next step is always <strong>their</strong> supervisor (your supervisor&apos;s supervisor), and so on until fully approved.
            </p>
          </div>
          <div>
            {fieldLabel('', 'Work anniversary (hire date)')}
            <input
              type="date"
              value={form.work_anniversary}
              onChange={(e) => set('work_anniversary', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Used for service years and HR dashboard reminders.</p>
          </div>
          <div>
            {fieldLabel('', 'Date of birth')}
            <input
              type="date"
              value={form.date_of_birth}
              onChange={(e) => set('date_of_birth', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Optional. Used for organization age reports (active staff only).
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/25 p-3 space-y-3">
            <p className="text-xs font-semibold text-amber-950 dark:text-amber-100">Sensitive payroll &amp; family (HR / Admin only)</p>
            <p className="text-[11px] text-amber-900/80 dark:text-amber-200/90">
              Not shown on the employee self-service profile. Only users with the HR or Admin role can view or edit these fields.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                {fieldLabel('', 'Net salary')}
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.net_salary}
                  onChange={(e) => set('net_salary', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g. 850000"
                />
              </div>
              <div>
                {fieldLabel('', 'Married')}
                <select
                  value={form.is_married}
                  onChange={(e) => set('is_married', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">(Not set)</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/25 p-3 space-y-2">
            <p className="text-xs font-semibold text-rose-900 dark:text-rose-100">Access status</p>
            <label className="inline-flex items-center gap-2 text-sm text-rose-900 dark:text-rose-100 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
                className="rounded border-gray-300"
              />
              Employee is active (can sign in)
            </label>
            <p className="text-[11px] text-rose-900/80 dark:text-rose-200/90">
              Turn this off to deactivate the employee account without deleting their records.
            </p>
          </div>
          <EmployeeRecordStaffDocs userId={user.id} />
          <div>
            {fieldLabel('', 'HR notes (internal)')}
            <textarea
              value={form.hr_notes}
              onChange={(e) => set('hr_notes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              placeholder="Not shown on the employee home screen."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
