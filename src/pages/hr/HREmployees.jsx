import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
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

function AddEmployeeModal({ users, branches, departments, employmentTypes = [], categories = [], onClose, onCreated }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [adLoading, setAdLoading] = useState(false);
  const [supervisorSearch, setSupervisorSearch] = useState('');
  const [form, setForm] = useState({
    ad_username: '',
    email: '',
    full_name: '',
    role: 'employee',
    branch_id: '',
    department: '',
    manager_id: '',
    position_category: '',
    employment_type: '',
    gender: '',
    phone: '',
    date_of_birth: '',
    employee_id: '',
    rssb_number: '',
    national_id_or_passport: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relationship: '',
    job_title: '',
    division: '',
    work_anniversary: '',
    hr_notes: '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const supervisorOptions = users
    .filter((m) => {
      const q = supervisorSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        String(m.full_name || '').toLowerCase().includes(q) ||
        String(m.email || '').toLowerCase().includes(q) ||
        String(m.role || '').toLowerCase().includes(q)
      );
    });

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
    if (!useAD && !(form.email || '').trim()) {
      toast('Email is required when not using AD', 'error');
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
        position_category: form.position_category.trim() || undefined,
        employment_type: form.employment_type.trim() || undefined,
        gender: form.gender || undefined,
        phone: form.phone.trim() || undefined,
        date_of_birth: form.date_of_birth.trim() || undefined,
        employee_id: form.employee_id.trim() || undefined,
        rssb_number: form.rssb_number.trim() || undefined,
        national_id_or_passport: form.national_id_or_passport.trim() || undefined,
        emergency_contact_name: form.emergency_contact_name.trim() || undefined,
        emergency_contact_phone: form.emergency_contact_phone.trim() || undefined,
        emergency_contact_relationship: form.emergency_contact_relationship.trim() || undefined,
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
        payload.password = `Temp#${Date.now()}${Math.floor(Math.random() * 1000)}`;
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
          <div>
            {fieldLabel('', 'Employee ID')}
            <input
              value={form.employee_id}
              onChange={(e) => set('employee_id', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            {fieldLabel('', 'RSSB number')}
            <input
              value={form.rssb_number}
              onChange={(e) => set('rssb_number', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            {fieldLabel('', 'National ID / Passport')}
            <input
              value={form.national_id_or_passport}
              onChange={(e) => set('national_id_or_passport', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={form.emergency_contact_name}
              onChange={(e) => set('emergency_contact_name', e.target.value)}
              placeholder="Emergency contact name"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <input
              value={form.emergency_contact_phone}
              onChange={(e) => set('emergency_contact_phone', e.target.value)}
              placeholder="Emergency phone"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <input
              value={form.emergency_contact_relationship}
              onChange={(e) => set('emergency_contact_relationship', e.target.value)}
              placeholder="Relationship"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
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
          <div className="grid grid-cols-2 gap-3">
            <select value={form.position_category} onChange={(e) => set('position_category', e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">Category (not set)</option>
              {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">Employment type (not set)</option>
              {employmentTypes.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </div>
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
            <input
              type="search"
              value={supervisorSearch}
              onChange={(e) => setSupervisorSearch(e.target.value)}
              placeholder="Search all users by name, email, or role"
              className="w-full mb-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <select
              value={form.manager_id}
              onChange={(e) => set('manager_id', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">(None)</option>
              {supervisorOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.role || 'employee'})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              {fieldLabel('', 'Work anniversary (hire date)')}
              <input
                type="date"
                value={form.work_anniversary}
                onChange={(e) => set('work_anniversary', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              {fieldLabel('', 'Date of birth')}
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
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
  const [employmentTypeOptions, setEmploymentTypeOptions] = useState(['Full-time employment', 'Part-time employment', 'Contract employment', 'Internship/Apprenticeship', 'Remote employment', 'Acting']);
  const [categoryOptions, setCategoryOptions] = useState(['Officer', 'Senior Officer', 'Manager', 'Head', 'Executive Director', 'CEO']);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newDepartment, setNewDepartment] = useState('');
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [newEmploymentType, setNewEmploymentType] = useState('');
  const [addingEmploymentType, setAddingEmploymentType] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: '', code: '', address: '' });
  const [addingBranch, setAddingBranch] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkImportFile, setBulkImportFile] = useState(null);
  const [bulkImportResult, setBulkImportResult] = useState(null);
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
  useEffect(() => {
    api.getEmploymentTypeOptions().then((rows) => setEmploymentTypeOptions(rows?.length ? rows : ['Full-time employment', 'Part-time employment', 'Contract employment', 'Internship/Apprenticeship', 'Remote employment', 'Acting'])).catch(() => {});
  }, []);
  useEffect(() => {
    api.getPositionCategoryOptions().then((rows) => setCategoryOptions(rows?.length ? rows : ['Officer', 'Senior Officer', 'Manager', 'Head', 'Executive Director', 'CEO'])).catch(() => {});
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

  const displayEmail = (email) => String(email || '');

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
  const onCreateEmploymentType = async () => {
    const name = (newEmploymentType || '').trim();
    if (!name) {
      toast('Employment type is required', 'error');
      return;
    }
    setAddingEmploymentType(true);
    try {
      const res = await api.createEmploymentType(name);
      setEmploymentTypeOptions(res.rows || employmentTypeOptions);
      setNewEmploymentType('');
      toast(res.created ? 'Employment type added' : 'Employment type already exists', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Failed to add employment type', 'error');
    } finally {
      setAddingEmploymentType(false);
    }
  };
  const onCreateCategory = async () => {
    const name = (newCategory || '').trim();
    if (!name) return toast('Category is required', 'error');
    setAddingCategory(true);
    try {
      const res = await api.createPositionCategory(name);
      setCategoryOptions(res.rows || categoryOptions);
      setNewCategory('');
      toast(res.created ? 'Category added' : 'Category already exists', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Failed to add category', 'error');
    } finally {
      setAddingCategory(false);
    }
  };
  const renameOption = async (kind, oldName) => {
    const next = window.prompt(`Rename "${oldName}" to:`, oldName);
    if (!next || next.trim() === '' || next.trim() === oldName) return;
    try {
      if (kind === 'department') {
        const res = await api.renameDepartment(oldName, next.trim());
        setDepartmentOptions(res.rows || []);
      } else if (kind === 'employment') {
        const res = await api.renameEmploymentType(oldName, next.trim());
        setEmploymentTypeOptions(res.rows || []);
      } else {
        const res = await api.renamePositionCategory(oldName, next.trim());
        setCategoryOptions(res.rows || []);
      }
      toast('Updated', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Rename failed', 'error');
    }
  };
  const deleteOption = async (kind, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      if (kind === 'department') {
        const res = await api.deleteDepartment(name);
        setDepartmentOptions(res.rows || []);
      } else if (kind === 'employment') {
        const res = await api.deleteEmploymentType(name);
        setEmploymentTypeOptions(res.rows || []);
      } else {
        const res = await api.deletePositionCategory(name);
        setCategoryOptions(res.rows || []);
      }
      toast('Deleted', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Delete failed', 'error');
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

  const downloadImportSampleCsv = () => {
    const toCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'No.',
      'Last Name',
      'First Name',
      'Job Title',
      'DEPARTMENT',
      'Work anniversary (hire date)',
      'BRANCH',
      'Email',
      'Employee ID',
      'Date of Birth',
      'Role',
    ];
    const rows = [
      [1, 'MUGANGA', 'David', 'Head of IT', 'IT', '2024-09-24', 'HQ', 'david@example.com', 'E-001', '1990-05-17', 'employee'],
      [2, 'DOE', 'Jane', 'HR Officer', 'HR', '2023-01-10', 'Kigali Branch', 'jane@example.com', 'E-002', '1995-11-02', 'employee'],
    ];
    const csv = [headers.map(toCsvCell).join(','), ...rows.map((line) => line.map(toCsvCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employee-import-sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Employee import sample downloaded', 'success');
  };

  const normalizeBulkImportFile = async (file) => {
    if (!file) return null;
    const name = String(file.name || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws);
      return new File([csv], `${file.name.replace(/\.(xlsx|xls)$/i, '')}.csv`, { type: 'text/csv;charset=utf-8;' });
    }
    return file;
  };

  const handleBulkUploadRecords = async (dryRun) => {
    if (!bulkImportFile) {
      toast('Choose a CSV/Excel file first', 'error');
      return;
    }
    setBulkUploading(true);
    try {
      const uploadFile = await normalizeBulkImportFile(bulkImportFile);
      const res = await api.bulkUpsertEmployeeRecords(uploadFile, { dryRun });
      setBulkImportResult(res || null);
      if (dryRun) {
        toast(
          `Preview: valid ${res?.rows_valid || 0}, invalid ${res?.rows_invalid || 0}`,
          (res?.rows_invalid || 0) > 0 ? 'warning' : 'success'
        );
      } else {
        toast(`Import done. Created: ${res?.created || 0}, Updated: ${res?.updated || 0}, Failed: ${(res?.failed || []).length}`, (res?.failed || []).length ? 'warning' : 'success');
        await load();
      }
    } catch (e) {
      toast(e?.response?.data?.detail || e?.message || 'Bulk upload failed', 'error');
    } finally {
      setBulkUploading(false);
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadAllEmployeeRecords}
            className="shrink-0 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Download all details (CSV)
          </button>
          <button
            type="button"
            onClick={downloadImportSampleCsv}
            className="shrink-0 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Download import sample
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="shrink-0 px-4 py-2 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700"
          >
            Add employee
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/70 dark:bg-emerald-900/10 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Bulk employee update</h2>
            <p className="text-xs text-emerald-700/90 dark:text-emerald-200/90">
              Upload CSV/Excel to add or update details. Empty cells are ignored and existing staff are never removed.
            </p>
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300">
            {bulkImportFile ? `Selected: ${bulkImportFile.name}` : 'No file selected'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            disabled={bulkUploading}
            onChange={(e) => setBulkImportFile(e.target.files?.[0] || null)}
            className="shrink-0 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800"
          />
          <button
            type="button"
            disabled={bulkUploading || !bulkImportFile}
            onClick={() => handleBulkUploadRecords(true)}
            className="shrink-0 px-4 py-2 rounded-lg border border-emerald-400 text-emerald-700 dark:text-emerald-300 font-medium hover:bg-emerald-100/70 dark:hover:bg-emerald-900/20 disabled:opacity-50"
          >
            {bulkUploading ? 'Working…' : 'Preview upload'}
          </button>
          <button
            type="button"
            disabled={bulkUploading || !bulkImportFile}
            onClick={() => handleBulkUploadRecords(false)}
            className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {bulkUploading ? 'Uploading…' : 'Apply upload'}
          </button>
        </div>
      </div>
      {bulkImportResult && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            Total: <strong>{bulkImportResult.rows_total || bulkImportResult.total_rows || 0}</strong> ·
            Valid: <strong>{bulkImportResult.rows_valid || 0}</strong> ·
            Invalid: <strong>{bulkImportResult.rows_invalid || (bulkImportResult.failed || []).length || 0}</strong> ·
            Created: <strong>{bulkImportResult.created || 0}</strong> ·
            Updated: <strong>{bulkImportResult.updated || 0}</strong>
          </p>
          {(bulkImportResult.failed || []).length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 p-2">
              {(bulkImportResult.failed || []).slice(0, 80).map((f, idx) => (
                <p key={`${f.line || 'row'}-${idx}`} className="text-xs text-red-700 dark:text-red-300">
                  Line {f.line || '?'}: {f.error}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <input
          type="search"
          placeholder="Search name, email, ID, or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-4 py-2 w-full max-w-md"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
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
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add employment type</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newEmploymentType}
              onChange={(e) => setNewEmploymentType(e.target.value)}
              placeholder="e.g. Contract"
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2"
            />
            <button
              type="button"
              onClick={onCreateEmploymentType}
              disabled={addingEmploymentType}
              className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {addingEmploymentType ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add category</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. Director"
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2"
            />
            <button
              type="button"
              onClick={onCreateCategory}
              disabled={addingCategory}
              className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {addingCategory ? 'Adding…' : 'Add'}
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
      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Departments</h3>
          <div className="space-y-2 max-h-44 overflow-auto pr-1">
            {departmentOptions.map((name) => (
              <div key={`d-${name}`} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1">
                <span className="text-sm text-gray-800 dark:text-gray-200">{name}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => renameOption('department', name)} className="text-xs text-blue-600">Edit</button>
                  <button type="button" onClick={() => deleteOption('department', name)} className="text-xs text-rose-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Employment types</h3>
          <div className="space-y-2 max-h-44 overflow-auto pr-1">
            {employmentTypeOptions.map((name) => (
              <div key={`e-${name}`} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1">
                <span className="text-sm text-gray-800 dark:text-gray-200">{name}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => renameOption('employment', name)} className="text-xs text-blue-600">Edit</button>
                  <button type="button" onClick={() => deleteOption('employment', name)} className="text-xs text-rose-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Categories</h3>
          <div className="space-y-2 max-h-44 overflow-auto pr-1">
            {categoryOptions.map((name) => (
              <div key={`c-${name}`} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1">
                <span className="text-sm text-gray-800 dark:text-gray-200">{name}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => renameOption('category', name)} className="text-xs text-blue-600">Edit</button>
                  <button type="button" onClick={() => deleteOption('category', name)} className="text-xs text-rose-600">Delete</button>
                </div>
              </div>
            ))}
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
                        {u.department && !departmentOptions.includes(u.department) && <option value={u.department}>{u.department}</option>}
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
            employmentTypes={employmentTypeOptions}
            categories={categoryOptions}
            onClose={() => setEditUser(null)}
            onSaved={load}
          />
        )}
        {showAdd && (
          <AddEmployeeModal users={users} branches={branches} departments={departmentOptions} employmentTypes={employmentTypeOptions} categories={categoryOptions} onClose={() => setShowAdd(false)} onCreated={load} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
