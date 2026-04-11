import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

export function AdminBranches() {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBranches().then(setBranches).catch(() => setBranches([])).finally(() => setLoading(false));
  }, []);

  const handleCreate = () => {
    const name = window.prompt('Branch name');
    const code = window.prompt('Branch code (short)');
    if (!name || !code) return;
    api.createBranch({ name, code })
      .then((b) => {
        setBranches((prev) => [...prev, b]);
        toast('Branch created', 'success');
      })
      .catch(() => toast('Create failed', 'error'));
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Branches</h1>
      <button type="button" onClick={handleCreate} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Add branch</button>
      {!branches.length ? (
        <EmptyState title="No branches" message="Add branches for multi-location support." />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Code</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {branches.map((b) => (
                <tr key={b.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-4 py-2">{b.name}</td>
                  <td className="px-4 py-2">{b.code}</td>
                  <td className="px-4 py-2">{b.address || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
