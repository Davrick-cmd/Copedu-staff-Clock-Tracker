import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../services/api';
import { AnnouncementCountdown } from './AnnouncementCountdown';
import { ROUTES } from '../utils/constants';

const PRIORITY_STYLES = {
  urgent: 'bg-red-500 text-white',
  high: 'bg-amber-500 text-white',
  normal: 'bg-gray-500 text-white dark:bg-gray-600',
  low: 'bg-gray-400 text-white dark:bg-gray-500',
};

export function DashboardAnnouncements({ viewAllTo = ROUTES.EMPLOYEE.ANNOUNCEMENTS }) {
  const [list, setList] = useState([]);

  useEffect(() => {
    api.getAnnouncements(false).then((data) => setList((data || []).slice(0, 5))).catch(() => setList([]));
  }, []);

  if (!list.length) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Announcements</h2>
        <Link to={viewAllTo} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
          View all
        </Link>
      </div>
      <ul className="space-y-3">
        {list.map((a) => (
          <motion.li
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-gray-200 dark:border-gray-600 rounded-lg p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[a.priority] || PRIORITY_STYLES.normal}`}>
                {(a.priority || 'normal').toUpperCase()}
              </span>
              <Link to={viewAllTo} className="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400">
                {a.title}
              </Link>
            </div>
            {a.deadline_at && (
              <div className="mt-2">
                <AnnouncementCountdown deadlineAt={a.deadline_at} />
              </div>
            )}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
