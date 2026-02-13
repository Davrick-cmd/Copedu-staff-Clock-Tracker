import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';

export function EmployeeAnnouncements() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAnnouncements(false).then(setList).catch(() => setList([])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>
      {!list.length ? (
        <EmptyState title="No announcements" message="HR has not published any announcements yet." />
      ) : (
        <div className="space-y-4">
          {list.map((a) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border-l-4 border-primary-500"
            >
              <h2 className="font-semibold text-gray-900 dark:text-white">{a.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{formatDateTime(a.published_at)} {a.users?.full_name && ` · ${a.users.full_name}`}</p>
              <p className="mt-2 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{a.body}</p>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
