import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

export function HRAnnouncements() {
  const toast = useToast();
  const { user } = useSelector((s) => s.auth);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const load = () => api.getAnnouncements(true).then(setList).catch(() => setList([]));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const onSubmit = (data) => {
    setPosting(true);
    api.createAnnouncement({
      title: data.title,
      body: data.body,
      created_by: user?.id,
      priority: data.priority || 'normal',
    })
      .then(() => {
        toast('Announcement published', 'success');
        reset();
        load();
      })
      .catch(() => toast('Failed to publish', 'error'))
      .finally(() => setPosting(false));
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this announcement?')) return;
    api.deleteAnnouncement(id).then(() => { load(); toast('Deleted', 'success'); }).catch(() => toast('Delete failed', 'error'));
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
        <h2 className="font-semibold text-gray-800 dark:text-white">New announcement</h2>
        <input
          {...register('title', { required: true })}
          placeholder="Title"
          className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
        <textarea
          {...register('body', { required: true })}
          placeholder="Body"
          rows={3}
          className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
        <select {...register('priority')} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button type="submit" disabled={posting} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">Publish</button>
      </form>

      <h2 className="font-semibold text-gray-800 dark:text-white">Published</h2>
      {!list.length ? (
        <EmptyState title="No announcements" />
      ) : (
        <div className="space-y-4">
          {list.map((a) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 flex justify-between items-start gap-4"
            >
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">{a.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{formatDateTime(a.published_at)} · {a.users?.full_name || '—'}</p>
                <p className="mt-2 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{a.body}</p>
              </div>
              <button type="button" onClick={() => handleDelete(a.id)} className="text-red-500 hover:text-red-700 text-sm">Delete</button>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
