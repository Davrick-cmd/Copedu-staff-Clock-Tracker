import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import * as api from '../services/api';
import { formatDateTime } from '../utils/formatters';
import { useToast } from '../hooks/useToast';
import { LoadingSpinner } from './LoadingSpinner';

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const sec = Math.floor((now - d) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return formatDateTime(dateStr);
}

/** Render comment body with @mentions as tags */
function CommentBody({ body, users }) {
  if (!body) return null;
  const parts = [];
  const re = /@([^\s@]+(?:\s+[^\s@]+)*)/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(lastIndex, m.index);
    if (before) parts.push({ type: 'text', value: before });
    const name = m[1].trim();
    const user = users.find((u) => (u.full_name && u.full_name.toLowerCase() === name.toLowerCase()) || (u.email && u.email.toLowerCase().startsWith(name.toLowerCase())));
    parts.push({ type: 'mention', value: name, fullName: user ? user.full_name || user.email : name });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < body.length) parts.push({ type: 'text', value: body.slice(lastIndex) });

  return (
    <span className="text-gray-600 dark:text-gray-400">
      {parts.map((p, i) =>
        p.type === 'mention' ? (
          <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-medium">
            @{p.fullName || p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </span>
  );
}

export function RecognitionFeed() {
  const toast = useToast();
  const { user } = useSelector((s) => s.auth);
  const [recognitions, setRecognitions] = useState([]);
  const [recognitionTypes, setRecognitionTypes] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recognitionType, setRecognitionType] = useState('');
  const [message, setMessage] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [comments, setComments] = useState({});
  const [commentText, setCommentText] = useState({});
  const [mentionForRid, setMentionForRid] = useState(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0);
  const [messageMentionQuery, setMessageMentionQuery] = useState('');
  const [messageMentionStart, setMessageMentionStart] = useState(0);
  const [showMessageMention, setShowMessageMention] = useState(false);
  const commentInputRefs = useRef({});
  const messageInputRef = useRef(null);

  const loadRecognitions = () => api.getRecognitions().then(setRecognitions).catch(() => setRecognitions([]));
  const colleagues = users.filter((u) => u.id !== user?.id && (u.is_active === 1 || u.is_active === true));

  useEffect(() => {
    loadRecognitions().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getRecognitionTypes().then(setRecognitionTypes).catch(() => setRecognitionTypes(['Teamwork', 'Innovation', 'Customer focus', 'Going the extra mile', 'Leadership', 'Support', 'Other']));
  }, []);

  useEffect(() => {
    api.getUsersForMention().then(setUsers).catch(() => setUsers([]));
  }, []);

  const handleMessageChange = (value) => {
    setMessage(value);
    const el = messageInputRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    const textBefore = value.slice(0, pos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx === -1) {
      setShowMessageMention(false);
      return;
    }
    const afterAt = textBefore.slice(atIdx + 1);
    if (/\s/.test(afterAt)) {
      setShowMessageMention(false);
      return;
    }
    setShowMessageMention(true);
    setMessageMentionQuery(afterAt);
    setMessageMentionStart(atIdx);
  };

  const insertMentionInMessage = (fullName) => {
    const before = message.slice(0, messageMentionStart);
    const after = message.slice(messageMentionStart);
    const rest = after.replace(/^@[^\s]*/, '');
    setMessage(before + '@' + fullName + (rest.startsWith(' ') ? rest : ' ' + rest));
    setShowMessageMention(false);
    setTimeout(() => {
      if (messageInputRef.current) {
        const pos = messageMentionStart + fullName.length + 2;
        messageInputRef.current.focus();
        messageInputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const messageMentionUsers = colleagues.filter((u) => {
    const name = (u.full_name || u.email || '').toLowerCase();
    return name.includes((messageMentionQuery || '').toLowerCase());
  }).slice(0, 8);

  const handleSubmit = (e) => {
    e.preventDefault();
    const type = (recognitionType || '').trim() || 'Other';
    if (!(message || '').trim()) {
      toast('Write a message', 'error');
      return;
    }
    setSubmitting(true);
    api.createRecognition(type, message.trim())
      .then((newRec) => {
        setRecognitions((prev) => [newRec, ...prev]);
        setRecognitionType('');
        setMessage('');
        toast('Recognition posted!', 'success');
      })
      .catch((err) => toast(err.response?.data?.detail || err.message || 'Failed to post', 'error'))
      .finally(() => setSubmitting(false));
  };

  const handleLike = (rid) => {
    api.toggleRecognitionLike(rid)
      .then(({ liked, like_count }) => {
        setRecognitions((prev) => prev.map((r) => (r.id === rid ? { ...r, like_count, liked_by_me: liked } : r)));
      })
      .catch(() => toast('Could not update like', 'error'));
  };

  const loadComments = (rid) => {
    if (comments[rid]) return;
    api.getRecognitionComments(rid).then((list) => setComments((c) => ({ ...c, [rid]: list })));
  };

  const handleExpand = (rid) => {
    setExpandedId((prev) => (prev === rid ? null : rid));
    setMentionForRid(null);
    loadComments(rid);
  };

  const handleCommentInputChange = (rid, value) => {
    setCommentText((t) => ({ ...t, [rid]: value }));
    const el = commentInputRefs.current[rid];
    if (!el) return;
    const pos = el.selectionStart || 0;
    const textBefore = value.slice(0, pos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx === -1) {
      setMentionForRid((cur) => (cur === rid ? null : cur));
      return;
    }
    const afterAt = textBefore.slice(atIdx + 1);
    if (/\s/.test(afterAt)) {
      setMentionForRid((cur) => (cur === rid ? null : cur));
      return;
    }
    setMentionForRid(rid);
    setMentionQuery(afterAt);
    setMentionStart(atIdx);
  };

  const insertMention = (rid, fullName) => {
    const text = commentText[rid] || '';
    const before = text.slice(0, mentionStart);
    const after = text.slice(mentionStart);
    const rest = after.replace(/^@[^\s]*/, '');
    const newText = before + '@' + fullName + (rest.startsWith(' ') ? rest : ' ' + rest);
    setCommentText((t) => ({ ...t, [rid]: newText }));
    setMentionForRid(null);
    setTimeout(() => {
      const el = commentInputRefs.current[rid];
      if (el) {
        const pos = mentionStart + fullName.length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const filteredMentionUsers = colleagues.filter((u) => {
    const name = (u.full_name || u.email || '').toLowerCase();
    const q = mentionQuery.toLowerCase();
    return name.includes(q);
  }).slice(0, 8);

  const handleAddComment = (rid) => {
    const body = (commentText[rid] || '').trim();
    if (!body) return;
    api.addRecognitionComment(rid, body)
      .then((newComment) => {
        setComments((c) => ({ ...c, [rid]: [...(c[rid] || []), newComment] }));
        setCommentText((t) => ({ ...t, [rid]: '' }));
        setMentionForRid(null);
        setRecognitions((prev) => prev.map((r) => (r.id === rid ? { ...r, comment_count: (r.comment_count || 0) + 1 } : r)));
      })
      .catch((err) => toast(err.response?.data?.detail || err.message || 'Failed to add comment', 'error'));
  };

  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 backdrop-blur-sm shadow-soft p-6 md:p-8">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Recognition</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">Share recognition by type. In the message or comments, type @ to mention colleagues by name.</p>

      <form onSubmit={handleSubmit} className="mb-6 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type of recognition</label>
          <select
            value={recognitionType}
            onChange={(e) => setRecognitionType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">Select type</option>
            {recognitionTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="relative">
          <textarea
            ref={messageInputRef}
            value={message}
            onChange={(e) => handleMessageChange(e.target.value)}
            placeholder="Share what happened. Type @ to mention a colleague by name."
            rows={2}
            maxLength={2000}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
          />
          {showMessageMention && messageMentionUsers.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
              {messageMentionUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-sm text-gray-800 dark:text-gray-200"
                  onClick={() => insertMentionInMessage(u.full_name || u.email || '')}
                >
                  @{u.full_name || u.email}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className="px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold shadow-soft hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Posting…' : 'Post recognition'}
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center py-6"><LoadingSpinner /></div>
      ) : recognitions.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm py-4">No recognitions yet. Be the first to post!</p>
      ) : (
        <ul className="space-y-4">
          {recognitions.map((r) => (
            <motion.li
              key={r.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="border border-slate-200/90 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-800/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 dark:text-gray-200">
                    <span className="font-medium text-primary-600 dark:text-primary-400">{r.from_name || 'Someone'}</span>
                    <span className="text-gray-500 dark:text-gray-400"> · </span>
                    <span className="font-medium text-gray-600 dark:text-gray-300">{r.recognition_type || 'Other'}</span>
                  </p>
                  {r.to_name && r.to_name !== r.from_name && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Recognizing {r.to_name}</p>
                  )}
                  <p className="mt-1 text-gray-700 dark:text-gray-300">{r.message}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{relativeTime(r.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleLike(r.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${r.liked_by_me ? 'text-red-500' : 'text-gray-500 dark:text-gray-400 hover:text-red-500'}`}
                    title={r.liked_by_me ? 'Unlike' : 'Like'}
                  >
                    <span>{r.liked_by_me ? '❤️' : '🤍'}</span>
                    {r.like_count > 0 && <span>{r.like_count}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExpand(r.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600"
                  >
                    💬 {r.comment_count || 0}
                  </button>
                </div>
              </div>
              {expandedId === r.id && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600 space-y-2">
                  {(comments[r.id] || []).map((c) => (
                    <div key={c.id} className="text-sm">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{c.user_name}</span>
                      <span className="ml-2"><CommentBody body={c.body} users={users} /></span>
                      <span className="text-xs text-gray-400 ml-2">{relativeTime(c.created_at)}</span>
                    </div>
                  ))}
                  <div className="relative mt-2">
                    <textarea
                      ref={(el) => { commentInputRefs.current[r.id] = el; }}
                      value={commentText[r.id] || ''}
                      onChange={(e) => handleCommentInputChange(r.id, e.target.value)}
                      placeholder="Add a comment... Type @name to tag"
                      rows={2}
                      className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(r.id); } }}
                    />
                    {mentionForRid === r.id && filteredMentionUsers.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded shadow-lg z-10 max-h-40 overflow-y-auto">
                        {filteredMentionUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-sm text-gray-800 dark:text-gray-200"
                            onClick={() => insertMention(r.id, u.full_name || u.email || '')}
                          >
                            @{u.full_name || u.email}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAddComment(r.id)}
                      className="mt-2 px-3 py-1.5 bg-primary-600 text-white rounded text-sm hover:bg-primary-700"
                    >
                      Comment
                    </button>
                  </div>
                </div>
              )}
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
