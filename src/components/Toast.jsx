import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { removeNotification } from '../store/slices/notificationSlice';

const AUTO_DISMISS_MS = 4000; // 4 seconds

const typeStyles = {
  success: 'bg-green-500 text-white',
  error: 'bg-red-500 text-white',
  info: 'bg-blue-500 text-white',
  warning: 'bg-amber-500 text-white',
};

function ToastItem({ n, onDismiss }) {
  const dispatch = useDispatch();
  useEffect(() => {
    const t = setTimeout(() => dispatch(removeNotification(n.id)), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [n.id, dispatch]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className={`relative px-4 py-3 rounded-lg shadow-lg ${typeStyles[n.type] || typeStyles.info}`}
    >
      <p className="text-sm pr-6">{n.message}</p>
      <button type="button" onClick={() => onDismiss(n.id)} className="absolute top-2 right-2 opacity-80 hover:opacity-100" aria-label="Dismiss">×</button>
    </motion.div>
  );
}

export function ToastContainer() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.notifications.items);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {items.map((n) => (
          <ToastItem key={n.id} n={n} onDismiss={(id) => dispatch(removeNotification(id))} />
        ))}
      </AnimatePresence>
    </div>
  );
}
