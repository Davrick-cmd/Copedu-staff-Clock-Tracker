import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { createAuditLog } from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

export function AdminUsers() {
  const toast = useToast();
  const { user: currentUser } = useSelector((s) => s.auth);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [adLookupLoading, setAdLookupLoading] = useState(false);
  const { register, handleSubmit, reset, setValue, watch } = useForm();

  const loadUsers = () => api.getUsers().then(setUsers).catch(() => setUsers([]));

  useEffect(() => {
    loadUsers().finally(() => setLoading(false));
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
    if (!useAD && (!(data.email || '').trim() || !(data.password || '').trim())) {
      toast('Email and password are required when not using AD username', 'error');
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
    if (useAD) {
      payload.ad_username = data.ad_username.trim();
      const email = (data.email || '').trim();
      if (email) payload.email = email;
    } else {
      payload.email = (data.email || '').trim();
      payload.password = data.password || '';
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

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manage Users</h1>

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
      </div>

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
            {...register('password')}
            type="password"
            placeholder="Password (required if no AD username)"
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
            <option value="employee">employee</option>
            <option value="hr">hr</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Create user</button>
        </form>
      )}

      {!filtered.length ? (
        <EmptyState title="No users" />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Role</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((u) => (
                  <tr key={u.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-2">{u.full_name}</td>
                    <td className="px-4 py-2">{u.email}</td>
                    <td className="px-4 py-2">
                      <select
                        value={u.role || 'employee'}
                        onChange={(e) => setRole(u.id, e.target.value)}
                        disabled={u.id === currentUser?.id}
                        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                      >
                        <option value="employee">employee</option>
                        <option value="hr">hr</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">{u.is_active === 1 || u.is_active === true ? 'Active' : 'Inactive'}</td>
                    <td className="px-4 py-2">
                      {u.id !== currentUser?.id && (
                        <button
                          type="button"
                          onClick={() => setActive(u.id, !(u.is_active === 1 || u.is_active === true))}
                          className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {u.is_active === 1 || u.is_active === true ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}
