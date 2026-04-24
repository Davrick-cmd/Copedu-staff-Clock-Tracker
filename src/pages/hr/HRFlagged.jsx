import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';

export function HRFlagged() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [minLates] = useState(3);

  const load = () => {
    setLoading(true);
    api.getFlaggedStaff({ fromDate, toDate, minLates })
      .then(setList)
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate, minLates]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Flagged Staff</h1>
      <p className="text-gray-600 dark:text-gray-400 text-sm">Employees who are late 3 times or more in the selected period are flagged.</p>

      <div className="flex flex-wrap gap-4 items-center">
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1 text-gray-900 dark:text-white" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1 text-gray-900 dark:text-white" />
        <span className="text-sm text-gray-600 dark:text-gray-400">Late threshold: {minLates} times</span>
        <button type="button" onClick={load} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Refresh</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      ) : !list.length ? (
        <EmptyState title="No flagged staff" message="No employee reached 3 late clock-ins in this period." />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Late count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {list.map((row) => (
                <tr key={row.user_id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-4 py-2">{row.full_name}</td>
                  <td className="px-4 py-2">{row.email}</td>
                  <td className="px-4 py-2"><span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{row.late_count}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
