import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { AnnouncementBody } from '../../utils/announcementBody';
import { AnnouncementCountdown } from '../../components/AnnouncementCountdown';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

export function EmployeeAnnouncements() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState(null);

  const load = () => api.getAnnouncements(false).then(setList).catch(() => setList([]));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const handleAcknowledge = (a) => {
    setAcking(a.id);
    api.acknowledgeAnnouncement(a.id)
      .then(({ acknowledged_count, total_staff }) => {
        setList((prev) => prev.map((x) => (x.id === a.id ? { ...x, acknowledged_by_me: true, acknowledged_count, total_staff } : x)));
        toast('Acknowledged', 'success');
      })
      .catch(() => toast('Failed to acknowledge', 'error'))
      .finally(() => setAcking(null));
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">Read each announcement and click Acknowledge so HR can track who has seen it.</p>
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
              {a.deadline_at && (
                <div className="mt-2">
                  <AnnouncementCountdown deadlineAt={a.deadline_at} />
                </div>
              )}
              <p className="mt-2 text-gray-700 dark:text-gray-300 whitespace-pre-wrap"><AnnouncementBody body={a.body} /></p>
              <div className="mt-3 flex items-center gap-3">
                {a.acknowledged_by_me ? (
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium">✓ Acknowledged</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAcknowledge(a)}
                    disabled={acking === a.id}
                    className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700 disabled:opacity-50"
                  >
                    {acking === a.id ? '…' : 'Acknowledge'}
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
