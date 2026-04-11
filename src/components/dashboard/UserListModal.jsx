import { AnimatePresence, motion } from 'framer-motion';
import { formatTime } from '../../utils/formatters';

export function UserListModal({ title, users, onClose }) {
  const list = Array.isArray(users) ? users : [];
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col border border-slate-200 dark:border-slate-700"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="p-4 overflow-y-auto flex-1">
            {list.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400 text-sm">No one in this category.</p>
            ) : (
              <ul className="space-y-2">
                {list.map((u, i) => (
                  <li
                    key={u.user_id || i}
                    className="text-sm text-slate-700 dark:text-slate-300 py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700"
                  >
                    <span className="font-medium">{u.full_name || '-'}</span>
                    {u.email && <span className="text-slate-500 dark:text-slate-400 ml-2 block sm:inline">{u.email}</span>}
                    {u.clock_in_at && (
                      <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">Clocked in: {formatTime(u.clock_in_at)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
