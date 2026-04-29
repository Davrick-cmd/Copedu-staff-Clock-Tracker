import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import * as api from '../../services/api';
import { createAuditLog } from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { ROLE_LABELS, ROLES, DEPARTMENTS, ROUTES } from '../../utils/constants';
import { Link } from 'react-router-dom';
import { EmployeeRecordEditModal } from '../../components/EmployeeRecordEditModal';

export function AdminUsers() {
  const toast = useToast();
  const { user: currentUser } = useSelector((s) => s.auth);
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [adLookupLoading, setAdLookupLoading] = useState(false);
  const [supervisorSearch, setSupervisorSearch] = useState('');
  const [editUser, setEditUser] = useState(null);
  const [passwordModalUser, setPasswordModalUser] = useState(null);
  const [passwordModalValue, setPasswordModalValue] = useState('');
  const [passwordModalSaving, setPasswordModalSaving] = useState(false);
  const { register, handleSubmit, reset, setValue, watch } = useForm();

  const loadUsers = () => api.getUsers().then(setUsers).catch(() => setUsers([]));

  useEffect(() => {
    loadUsers().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  const fetchFromAD = () => {
    const adUsername = (watch('ad_username') || '').trim();
    if (!adUsername) {
      toast('Enter an AD username first', 'error');
      return;
    }
    setAdLookupLoading(true);
    api.lookupADUser(adUsername)
      .then(({ full_name, email }) => {
        if (full_name) setValue('full_name', full_name);
        if (email) setValue('email', email);
        toast(full_name ? `Fetched: ${full_name}` : 'User found in AD', 'success');
      })
      .catch((e) => toast(e.response?.status === 404 ? 'User not found in AD' : (e.response?.data?.detail || e.message || 'Lookup failed'), 'error'))
      .finally(() => setAdLookupLoading(false));
  };

  const getApiError = (e) => {
    const d = e.response?.data?.detail;
    if (Array.isArray(d) && d[0]?.msg) return d.map((x) => x.msg).join(', ');
    if (typeof d === 'string') return d;
    if (e.message === 'Network Error') return 'Connection problem. Is the backend running?';
    return e.message || 'Request failed';
  };

  const onAddUser = (data) => {
    const useAD = (data.ad_username || '').trim().length > 0;
    if (!useAD && !(data.email || '').trim()) {
      toast('Email is required when not using AD username', 'error');
      return;
    }
    if (!(data.full_name || '').trim()) {
      toast('Full name is required', 'error');
      return;
    }
    const payload = {
      full_name: (data.full_name || '').trim(),
      role: data.role || 'employee',
    };
    const branchId = (data.branch_id || '').trim() || undefined;
    const department = (data.department || '').trim() || undefined;
    const managerId = (data.manager_id || '').trim() || undefined;
    if (branchId) payload.branch_id = branchId;
    if (department) payload.department = department;
    if (managerId) payload.manager_id = managerId;
    const g = (data.gender || '').trim();
    if (g) payload.gender = g;
    const phone = (data.phone || '').trim();
    if (phone) payload.phone = phone;
    const eid = (data.employee_id || '').trim();
    if (eid) payload.employee_id = eid;
    const div = (data.division || '').trim();
    if (div) payload.division = div;
    const jt = (data.job_title || '').trim();
    if (jt) payload.job_title = jt;
    const wa = (data.work_anniversary || '').trim();
    if (wa) payload.work_anniversary = wa;
    const hn = (data.hr_notes || '').trim();
    if (hn) payload.hr_notes = hn;
    if (useAD) {
      payload.ad_username = data.ad_username.trim();
      const email = (data.email || '').trim();
      if (email) payload.email = email;
    } else {
      payload.email = (data.email || '').trim();
      payload.password = `Temp#${Date.now()}${Math.floor(Math.random() * 1000)}`;
    }
    api.createUser(payload)
      .then((newUser) => {
        setUsers((prev) => [...prev, newUser]);
        setShowAddForm(false);
        reset();
        toast('User created', 'success');
      })
      .catch((e) => toast(getApiError(e), 'error'));
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (u.full_name && u.full_name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q));
  });
  const supervisorOptions = users
    .filter((u) => u.id !== currentUser?.id)
    .filter((u) => {
      const q = supervisorSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        String(u.full_name || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.role || '').toLowerCase().includes(q)
      );
    });

  const displayEmail = (email) => String(email || '');

  const setRole = (userId, role) => {
    api.setUserRole(userId, role)
      .then(() => {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
        createAuditLog({ action: 'user_role_change', resource: 'users', resource_id: userId, details: { role } }).catch(() => {});
        toast('Role updated', 'success');
      })
      .catch((e) => toast(e.response?.data?.detail || e.message || 'Update failed', 'error'));
  };

  const setActive = (userId, isActive) => {
    api.setUserActive(userId, isActive)
      .then(() => {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_active: isActive } : u)));
        createAuditLog({ action: isActive ? 'user_activated' : 'user_deactivated', resource: 'users', resource_id: userId }).catch(() => {});
        toast(isActive ? 'User activated' : 'User deactivated', 'success');
      })
      .catch((e) => toast(e.response?.data?.detail || e.message || 'Update failed', 'error'));
  };

  const submitPasswordReset = () => {
    const pwd = passwordModalValue.trim();
    if (pwd.length < 6) {
      toast('Password must be at least 6 characters', 'error');
      return;
    }
    if (!passwordModalUser?.id) return;
    setPasswordModalSaving(true);
    api.setUserPassword(passwordModalUser.id, pwd)
      .then(() => {
        toast('Local password updated. They can sign in with email and this password (AD still works if linked).', 'success');
        setPasswordModalUser(null);
        setPasswordModalValue('');
      })
      .catch((e) => toast(getApiError(e), 'error'))
      .finally(() => setPasswordModalSaving(false));
  };

  const onBulkImport = () => {
    if (!bulkFile) {
      toast('Choose a CSV file first', 'error');
      return;
    }
    setBulkUploading(true);
    setBulkResult(null);
    api.bulkImportUsers(bulkFile)
      .then((res) => {
        setBulkResult(res);
        if (res.created > 0) loadUsers();
        toast(`Created ${res.created}, failed ${res.failed?.length ?? 0}`, res.failed?.length ? 'warning' : 'success');
      })
      .catch((e) => {
        toast(e.response?.data?.detail || e.message || 'Bulk import failed', 'error');
        setBulkResult(null);
      })
      .finally(() => { setBulkUploading(false); setBulkFile(null); });
  };

  const downloadAllEmployeeRecords = async () => {
    try {
      const res = await api.exportEmployeeRecordsCsv();
      const csv = String(res?.csv || '');
      const filename = res?.filename || `employee-records-${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Employee records exported', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Failed to export employee records', 'error');
    }
  };

  const onBulkUpsertRecords = async () => {
    if (!bulkFile) {
      toast('Choose a CSV or Excel file first', 'error');
      return;
    }
    setBulkUploading(true);
    setBulkResult(null);
    try {
      let uploadFile = bulkFile;
      const name = String(bulkFile.name || '').toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buf = await bulkFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(ws);
        uploadFile = new File([csv], `${bulkFile.name.replace(/\.(xlsx|xls)$/i, '')}.csv`, { type: 'text/csv' });
      }
      const res = await api.bulkUpsertEmployeeRecords(uploadFile);
      setBulkResult(res);
      await loadUsers();
      toast(`Created ${res.created || 0}, updated ${res.updated || 0}, failed ${res.failed?.length || 0}`, (res.failed?.length || 0) ? 'warning' : 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || e.message || 'Bulk upload failed', 'error');
      setBulkResult(null);
    } finally {
      setBulkUploading(false);
      setBulkFile(null);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Employee records</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
          All staff appear in this list. Use <strong className="text-gray-700 dark:text-gray-300">Edit record</strong> on any row to update job title,
          department, branch, supervisor, hire date, and other details when someone moves role or location. Leave history stays
          on that account - browse under{' '}
          <Link to={ROUTES.HR.LEAVE_ORGANIZATION} className="text-primary-600 dark:text-primary-400 hover:underline">
            Leave → Organization
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <input
          type="search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 w-full max-w-xs text-gray-900 dark:text-white"
        />
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          {showAddForm ? 'Cancel' : 'Add user'}
        </button>
        <button
          type="button"
          onClick={() => setShowBulkImport((v) => !v)}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        >
          {showBulkImport ? 'Cancel' : 'Bulk upload/export records'}
        </button>
        <button
          type="button"
          onClick={downloadAllEmployeeRecords}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Download all details (CSV)
        </button>
      </div>

      {showBulkImport && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3 max-w-lg">
          <h2 className="font-semibold text-gray-800 dark:text-white">Bulk upload employee records (full details)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            First click <strong>Download all details (CSV)</strong>, update rows in Excel, then upload CSV or Excel here.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkResult(null); }}
              className="text-sm text-gray-700 dark:text-gray-300 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary-600 file:text-white"
            />
            <button
              type="button"
              onClick={onBulkUpsertRecords}
              disabled={bulkUploading || !bulkFile}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkUploading ? 'Uploading…' : 'Upload & apply'}
            </button>
          </div>
          {bulkResult && (
            <div className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg p-3">
              <p className="font-medium text-gray-800 dark:text-white">Created: {bulkResult.created || 0} · Updated: {bulkResult.updated || 0} · Failed: {bulkResult.failed?.length ?? 0}</p>
              {bulkResult.failed?.length > 0 && (
                <ul className="mt-2 text-red-600 dark:text-red-400 list-disc list-inside">
                  {bulkResult.failed.slice(0, 5).map((f, i) => (
                    <li key={i}>{f.row?.username || 'Row'} - {f.error}</li>
                  ))}
                  {bulkResult.failed.length > 5 && <li>… and {bulkResult.failed.length - 5} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {showAddForm && (
        <form onSubmit={handleSubmit(onAddUser)} className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3 max-w-md">
          <h2 className="font-semibold text-gray-800 dark:text-white">New user</h2>
          <div className="flex gap-2">
            <input
              {...register('ad_username')}
              type="text"
              placeholder="AD username (optional – for LDAP login)"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <button
              type="button"
              onClick={fetchFromAD}
              disabled={adLookupLoading}
              className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm whitespace-nowrap hover:bg-primary-700 disabled:opacity-50"
            >
              {adLookupLoading ? '…' : 'Fetch from AD'}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Enter AD username and click to fill Full name and Email from Active Directory.</p>
          <input
            {...register('email')}
            type="email"
            placeholder="Email (required if no AD username)"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <input
            {...register('full_name', { required: true })}
            type="text"
            placeholder="Full name"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <select
            {...register('role')}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="employee">{ROLE_LABELS[ROLES.EMPLOYEE]}</option>
            <option value="manager">{ROLE_LABELS[ROLES.MANAGER]}</option>
            <option value="hod">{ROLE_LABELS[ROLES.HOD]}</option>
            <option value="hr">{ROLE_LABELS[ROLES.HR]}</option>
            <option value="admin">{ROLE_LABELS[ROLES.ADMIN]}</option>
          </select>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Manager (optional)</label>
            <input
              type="search"
              value={supervisorSearch}
              onChange={(e) => setSupervisorSearch(e.target.value)}
              placeholder="Search supervisor by name, email, or role"
              className="w-full mb-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <select {...register('manager_id')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">None</option>
              {supervisorOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.role || 'employee'})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Branch</label>
            <select
              {...register('branch_id')}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">No branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label>
            <select
              {...register('department')}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">No department</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Gender</label>
              <select
                {...register('gender')}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select role</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
                <option value="prefer_not_say">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
              <input {...register('phone')} type="text" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="Optional" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Employee ID</label>
            <input {...register('employee_id')} type="text" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </div>
          <input {...register('job_title')} type="text" placeholder="Job title (optional)" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          <input {...register('division')} type="text" placeholder="Division / unit (optional)" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Work anniversary (hire date)</label>
            <input {...register('work_anniversary')} type="date" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">HR notes (internal)</label>
            <textarea {...register('hr_notes')} rows={2} className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" placeholder="Optional" />
          </div>
          <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Create user</button>
        </form>
      )}

      {!filtered.length ? (
        <EmptyState title="No employee records" />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Branch</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Department</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Role</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((u) => (
                  <tr key={u.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-2"><span className="font-medium">{u.full_name}</span></td>
                    <td className="px-4 py-2">{displayEmail(u.email)}</td>
                    <td className="px-4 py-2">{u.branches?.name || '-'}</td>
                    <td className="px-4 py-2">{u.department || '-'}</td>
                    <td className="px-4 py-2">
                      <select
                        value={u.role || 'employee'}
                        onChange={(e) => setRole(u.id, e.target.value)}
                        disabled={u.id === currentUser?.id}
                        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                      >
                        <option value="employee">{ROLE_LABELS[ROLES.EMPLOYEE]}</option>
                        <option value="manager">{ROLE_LABELS[ROLES.MANAGER]}</option>
                        <option value="hod">{ROLE_LABELS[ROLES.HOD]}</option>
                        <option value="hr">{ROLE_LABELS[ROLES.HR]}</option>
                        <option value="admin">{ROLE_LABELS[ROLES.ADMIN]}</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">{u.is_active === 1 || u.is_active === true ? 'Active' : 'Inactive'}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                        <button
                          type="button"
                          onClick={() => setEditUser(u)}
                          className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline text-left"
                        >
                          Edit record
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            type="button"
                            onClick={() => setActive(u.id, !(u.is_active === 1 || u.is_active === true))}
                            className="text-sm text-gray-600 dark:text-gray-400 hover:underline text-left"
                          >
                            {u.is_active === 1 || u.is_active === true ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                        {currentUser?.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => { setPasswordModalUser(u); setPasswordModalValue(''); }}
                            className="text-sm text-amber-700 dark:text-amber-400 hover:underline text-left"
                          >
                            Set local password
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editUser && (
        <EmployeeRecordEditModal
          key={editUser.id}
          user={editUser}
          users={users}
          branches={branches}
          onClose={() => setEditUser(null)}
          onSaved={loadUsers}
        />
      )}

      {passwordModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Set local password</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {passwordModalUser.full_name} ({passwordModalUser.email || 'no email'}) — min. 6 characters. Does not change Active Directory.
            </p>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordModalValue}
              onChange={(e) => setPasswordModalValue(e.target.value)}
              placeholder="New password"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={submitPasswordReset}
                disabled={passwordModalSaving || passwordModalValue.trim().length < 6}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {passwordModalSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setPasswordModalUser(null); setPasswordModalValue(''); }}
                disabled={passwordModalSaving}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
