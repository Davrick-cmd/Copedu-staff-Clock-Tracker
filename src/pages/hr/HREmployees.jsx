import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '../../services/api';
import { ROLE_LABELS, DEPARTMENTS, ROLES } from '../../utils/constants';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { EmployeeRecordEditModal, GENDERS } from '../../components/EmployeeRecordEditModal';

function fieldLabel(className, text) {
  return (
    <label className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 ${className || ''}`}>{text}</label>
  );
}

function AddEmployeeModal({ users, branches, departments, onClose, onCreated }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [adLoading, setAdLoading] = useState(false);
  const [form, setForm] = useState({
    ad_username: '',
    email: '',
    password: '',
    full_name: '',
    role: 'employee',
    branch_id: '',
    department: '',
    manager_id: '',
    gender: '',
    phone: '',
    employee_id: '',
    employee_code: '',
    job_title: '',
    division: '',
    work_anniversary: '',
    hr_notes: '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const fetchFromAD = () => {
    const u = (form.ad_username || '').trim();
    if (!u) {
      toast('Enter an AD username first', 'error');
      return;
    }
    setAdLoading(true);
    api
      .lookupADUser(u)
      .then((data) => {
        setForm((prev) => ({
          ...prev,
          full_name: data.full_name || prev.full_name,
          email: data.email || prev.email,
        }));
        toast('Filled from Active Directory', 'success');
      })
      .catch((e) => toast(e.response?.data?.detail || e.message || 'Lookup failed', 'error'))
      .finally(() => setAdLoading(false));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const useAD = (form.ad_username || '').trim().length > 0;
    if (!useAD && (!(form.email || '').trim() || !(form.password || '').trim())) {
      toast('Email and password are required when not using AD', 'error');
      return;
    }
    if (!(form.full_name || '').trim()) {
      toast('Full name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        role: form.role || 'employee',
        gender: form.gender || undefined,
        phone: form.phone.trim() || undefined,
        employee_id: form.employee_id.trim() || undefined,
        employee_code: form.employee_code.trim() || undefined,
        job_title: form.job_title.trim() || undefined,
        division: form.division.trim() || undefined,
        work_anniversary: form.work_anniversary.trim() || undefined,
        hr_notes: form.hr_notes.trim() || undefined,
      };
      const branchId = (form.branch_id || '').trim();
      const dept = (form.department || '').trim();
      const managerId = (form.manager_id || '').trim();
      if (branchId) payload.branch_id = branchId;
      if (dept) payload.department = dept;
      if (managerId) payload.manager_id = managerId;
      if (useAD) {
        payload.ad_username = form.ad_username.trim();
        const em = (form.email || '').trim();
        if (em) payload.email = em;
      } else {
        payload.email = form.email.trim();
        payload.password = form.password;
      }
      await api.createUser(payload);
      toast('Employee created', 'success');
      onCreated();
      onClose();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || 'Create failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New employee</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:hover:text-white p-1" aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="flex gap-2">
            <input
              value={form.ad_username}
              onChange={(e) => set('ad_username', e.target.value)}
              placeholder="AD username (optional)"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <button type="button" onClick={fetchFromAD} disabled={adLoading} className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm whitespace-nowrap">
              {adLoading ? '…' : 'AD lookup'}
            </button>
          </div>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="Email (if no AD)"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder="Password (if no AD)"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <input
            required
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            placeholder="Full name *"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <div>
            {fieldLabel('', 'Role')}
            <select
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="employee">{ROLE_LABELS[ROLES.EMPLOYEE]}</option>
              <option value="manager">{ROLE_LABELS[ROLES.MANAGER]}</option>
              <option value="hod">{ROLE_LABELS[ROLES.HOD]}</option>
            </select>
          </div>
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
          <input
            value={form.job_title}
            onChange={(e) => set('job_title', e.target.value)}
            placeholder="Job title"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <input
            value={form.division}
            onChange={(e) => set('division', e.target.value)}
            placeholder="Division / unit"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <div>
            {fieldLabel('', 'Department')}
            <select
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">(Unassigned)</option>
              {(departments || DEPARTMENTS).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            {fieldLabel('', 'Branch')}
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
              {users.filter((m) => ['manager', 'hod', 'admin', 'hr'].includes(m.role || '')).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.role})
                </option>
              ))}
            </select>
          </div>
          <div>
            {fieldLabel('', 'Work anniversary (hire date)')}
            <input
              type="date"
              value={form.work_anniversary}
              onChange={(e) => set('work_anniversary', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <textarea
            value={form.hr_notes}
            onChange={(e) => set('hr_notes', e.target.value)}
            placeholder="HR notes (internal)"
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create employee'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export function HREmployees() {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [departmentOptions, setDepartmentOptions] = useState(DEPARTMENTS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newDepartment, setNewDepartment] = useState('');
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: '', code: '', address: '' });
  const [addingBranch, setAddingBranch] = useState(false);
  const toast = useToast();

  const load = () => api.getUsers().then(setUsers).catch(() => setUsers([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    api.getBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    api.getDepartmentOptions().then(setDepartmentOptions).catch(() => setDepartmentOptions(DEPARTMENTS));
  }, []);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.full_name && u.full_name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.employee_id && String(u.employee_id).toLowerCase().includes(q)) ||
      (u.employee_code && String(u.employee_code).toLowerCase().includes(q))
    );
  });

  const displayEmail = (email) => String(email || '').replace(/@migrated\./gi, '@imported.');

  const onSupervisorChange = async (employeeId, managerId) => {
    const value = managerId === '' ? null : managerId;
    setUpdatingId(employeeId);
    try {
      await api.updateUserSupervisor(employeeId, value);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingId(null);
    }
  };

  const onDepartmentChange = async (employeeId, department) => {
    setUpdatingId(employeeId);
    try {
      await api.updateUserDepartment(employeeId, department || null);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingId(null);
    }
  };

  const onCreateDepartment = async () => {
    const name = (newDepartment || '').trim();
    if (!name) {
      toast('Department name is required', 'error');
      return;
    }
    setAddingDepartment(true);
    try {
      const res = await api.createDepartment(name);
      setDepartmentOptions(res.rows || DEPARTMENTS);
      setNewDepartment('');
      toast(res.created ? 'Department added' : 'Department already exists', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Failed to add department', 'error');
    } finally {
      setAddingDepartment(false);
    }
  };

  const onCreateBranch = async () => {
    const name = (newBranch.name || '').trim();
    const code = (newBranch.code || '').trim();
    if (!name || !code) {
      toast('Branch name and code are required', 'error');
      return;
    }
    setAddingBranch(true);
    try {
      await api.createBranch({
        name,
        code,
        address: (newBranch.address || '').trim() || undefined,
      });
      const rows = await api.getBranches();
      setBranches(rows || []);
      setNewBranch({ name: '', code: '', address: '' });
      toast('Branch created', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Failed to create branch', 'error');
    } finally {
      setAddingBranch(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Employee records</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="shrink-0 px-4 py-2 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700"
        >
          Add employee
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        <input
          type="search"
          placeholder="Search name, email, ID, or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-4 py-2 w-full max-w-md"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add department</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newDepartment}
              onChange={(e) => setNewDepartment(e.target.value)}
              placeholder="e.g. Procurement"
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2"
            />
            <button
              type="button"
              onClick={onCreateDepartment}
              disabled={addingDepartment}
              className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {addingDepartment ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add branch</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={newBranch.name}
              onChange={(e) => setNewBranch((p) => ({ ...p, name: e.target.value }))}
              placeholder="Branch name"
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2"
            />
            <input
              type="text"
              value={newBranch.code}
              onChange={(e) => setNewBranch((p) => ({ ...p, code: e.target.value }))}
              placeholder="Code"
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2"
            />
            <input
              type="text"
              value={newBranch.address}
              onChange={(e) => setNewBranch((p) => ({ ...p, address: e.target.value }))}
              placeholder="Address (optional)"
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCreateBranch}
              disabled={addingBranch}
              className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {addingBranch ? 'Creating…' : 'Create branch'}
            </button>
          </div>
        </div>
      </div>
      {!filtered.length ? (
        <EmptyState title="No employee records" message={search ? 'No matches for your search.' : 'No employees in the system yet.'} />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Role</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Department</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Branch</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Supervisor</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((u) => (
                  <tr key={u.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-2"><span className="font-medium">{u.full_name}</span></td>
                    <td className="px-4 py-2">{displayEmail(u.email)}</td>
                    <td className="px-4 py-2">
                      {u.is_active === 1 || u.is_active === true ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700">{ROLE_LABELS[u.role] || u.role}</span>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={u.department ?? ''}
                        onChange={(e) => onDepartmentChange(u.id, e.target.value)}
                        disabled={updatingId === u.id}
                        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm py-1 pr-6 min-w-[160px] max-w-[220px]"
                      >
                        <option value="">(Unassigned)</option>
                        {u.department && !departmentOptions.includes(u.department) && (
                          <option value={u.department}>{u.department} (current)</option>
                        )}
                        {departmentOptions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">{u.branches?.name || '-'}</td>
                    <td className="px-4 py-2">
                      <select
                        value={u.manager_id ?? ''}
                        onChange={(e) => onSupervisorChange(u.id, e.target.value)}
                        disabled={updatingId === u.id}
                        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm py-1 pr-6 min-w-[140px]"
                      >
                        <option value="">(None)</option>
                        {users
                          .filter((m) => m.id !== u.id)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name}
                            </option>
                          ))}
                      </select>
                      {updatingId === u.id && <span className="ml-2 text-xs text-gray-500">Saving…</span>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditUser(u)}
                        className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        Edit record
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {editUser && (
          <EmployeeRecordEditModal
            key={editUser.id}
            user={editUser}
            users={users}
            branches={branches}
            departments={departmentOptions}
            onClose={() => setEditUser(null)}
            onSaved={load}
          />
        )}
        {showAdd && (
          <AddEmployeeModal users={users} branches={branches} departments={departmentOptions} onClose={() => setShowAdd(false)} onCreated={load} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
