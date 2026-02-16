import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { AnnouncementBody } from '../../utils/announcementBody';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

export function HRAnnouncements() {
  const toast = useToast();
  const { user } = useSelector((s) => s.auth);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [showInsertLink, setShowInsertLink] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const bodyRef = useRef(null);
  const bodySelection = useRef({ start: 0, end: 0 });
  const { register, handleSubmit, reset, setValue, getValues } = useForm();

  const load = () => api.getAnnouncements(true).then(setList).catch(() => setList([]));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const onSubmit = (data) => {
    setPosting(true);
    const deadline = (data.deadline_at || '').trim();
    api.createAnnouncement({
      title: data.title,
      body: data.body,
      created_by: user?.id,
      priority: data.priority || 'normal',
      deadline_at: deadline ? new Date(deadline).toISOString() : undefined,
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

  const [receiptsFor, setReceiptsFor] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const loadReceipts = (aid) => {
    setReceiptsFor(aid);
    api.getAnnouncementReadReceipts(aid).then(setReceipts).catch(() => setReceipts([]));
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
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Body</label>
            <button
              type="button"
              onClick={() => { bodyRef.current && (bodySelection.current = { start: bodyRef.current.selectionStart, end: bodyRef.current.selectionEnd }); setShowInsertLink(true); setLinkText(''); setLinkUrl(''); }}
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              Insert link
            </button>
          </div>
          <textarea
            {...register('body', { required: true })}
            ref={(el) => { bodyRef.current = el; register('body').ref(el); }}
            onSelect={() => bodyRef.current && (bodySelection.current = { start: bodyRef.current.selectionStart, end: bodyRef.current.selectionEnd })}
            placeholder="Body. Use Insert link to add clickable links instead of pasting URLs."
            rows={4}
            className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          {showInsertLink && (
            <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 space-y-2">
              <input
                type="text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="Link text (e.g. Click here)"
                className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="URL (e.g. https://example.com)"
                className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const text = linkText.trim() || linkUrl.trim() || 'Link';
                    const url = linkUrl.trim();
                    if (!url) { toast('Enter a URL', 'error'); return; }
                    const markdown = `[${text}](${url})`;
                    const body = getValues('body') || '';
                    const { start } = bodySelection.current;
                    const newBody = body.slice(0, start) + markdown + body.slice(start);
                    setValue('body', newBody);
                    setShowInsertLink(false);
                    setLinkText('');
                    setLinkUrl('');
                  }}
                  className="px-3 py-1.5 bg-primary-600 text-white rounded text-sm hover:bg-primary-700"
                >
                  Insert
                </button>
                <button type="button" onClick={() => setShowInsertLink(false)} className="px-3 py-1.5 bg-gray-500 text-white rounded text-sm hover:bg-gray-600">Cancel</button>
              </div>
            </div>
          )}
        </div>
        <select {...register('priority')} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deadline (optional)</label>
          <input
            type="datetime-local"
            {...register('deadline_at')}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Users will see a countdown in red until this date/time.</p>
        </div>
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
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-white">{a.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{formatDateTime(a.published_at)} · {a.users?.full_name || '—'}</p>
                <p className="mt-2 text-gray-700 dark:text-gray-300 whitespace-pre-wrap"><AnnouncementBody body={a.body} /></p>
                <p className="mt-2 text-sm font-medium text-primary-600 dark:text-primary-400">
                  Seen by {a.acknowledged_count ?? 0}/{a.total_staff ?? 0} staff
                </p>
                <button type="button" onClick={() => loadReceipts(a.id)} className="mt-1 text-sm text-gray-500 dark:text-gray-400 hover:underline">
                  View who acknowledged
                </button>
              </div>
              <button type="button" onClick={() => handleDelete(a.id)} className="text-red-500 hover:text-red-700 text-sm shrink-0">Delete</button>
            </motion.div>
          ))}
        </div>
      )}

      {receiptsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setReceiptsFor(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">Who acknowledged</h3>
              <button type="button" onClick={() => setReceiptsFor(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">×</button>
            </div>
            <div className="p-4 overflow-y-auto">
              {receipts.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-sm">No one has acknowledged yet.</p>
              ) : (
                <ul className="space-y-2">
                  {receipts.map((r) => (
                    <li key={r.user_id} className="text-sm text-gray-700 dark:text-gray-300 flex justify-between">
                      <span>{r.full_name || r.email || '—'}</span>
                      <span className="text-gray-500">{formatDateTime(r.acknowledged_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
