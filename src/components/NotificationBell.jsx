import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../services/api';

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);

  const refreshCount = useCallback(() => {
    api.getUnreadNotificationCount().then(setCount).catch(() => setCount(0));
  }, []);

  const loadList = useCallback(() => {
    setLoading(true);
    api
      .getNotifications(50)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 45000);
    return () => clearInterval(t);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onPick = async (n) => {
    try {
      await api.markNotificationRead(n.id);
    } catch {
      /* ignore */
    }
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    refreshCount();
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try {
      await api.markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
      refreshCount();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {count > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-[100] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Alerts</span>
            {items.some((i) => !i.read_at) && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading && <p className="px-3 py-4 text-sm text-slate-500 text-center">Loading…</p>}
            {!loading && !items.length && <p className="px-3 py-4 text-sm text-slate-500 text-center">No notifications yet.</p>}
            {!loading &&
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onPick(n)}
                  className={`w-full text-left px-3 py-2.5 border-b border-slate-50 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                    n.read_at ? 'opacity-70' : 'bg-primary-50/40 dark:bg-primary-950/20'
                  }`}
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-white leading-snug">{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{n.body}</p>}
                  <p className="text-[10px] text-slate-400 mt-1">{n.kind}</p>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
