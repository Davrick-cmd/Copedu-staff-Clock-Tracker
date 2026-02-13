import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { removeNotification } from '../store/slices/notificationSlice';

const typeStyles = {
  success: 'bg-green-500 text-white',
  error: 'bg-red-500 text-white',
  info: 'bg-blue-500 text-white',
  warning: 'bg-amber-500 text-white',
};

export function ToastContainer() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.notifications.items);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {items.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className={`relative px-4 py-3 rounded-lg shadow-lg ${typeStyles[n.type] || typeStyles.info}`}
          >
            <p className="text-sm">{n.message}</p>
            <button type="button" onClick={() => dispatch(removeNotification(n.id))} className="absolute top-2 right-2 opacity-80 hover:opacity-100">×</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
