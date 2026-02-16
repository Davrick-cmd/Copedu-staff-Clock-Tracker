import { useState, useEffect } from 'react';

/**
 * Shows countdown to deadline in RED, big font. When passed, shows "Expired".
 */
export function AnnouncementCountdown({ deadlineAt, className = '' }) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!deadlineAt) return;
    const update = () => {
      const end = new Date(deadlineAt);
      const now = new Date();
      if (now >= end) {
        setText('Expired');
        return;
      }
      const ms = end - now;
      const days = Math.floor(ms / (24 * 60 * 60 * 1000));
      const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
      const secs = Math.floor((ms % (60 * 1000)) / 1000);
      if (days > 0) {
        setText(`${days}d ${hours}h ${mins}m left`);
      } else if (hours > 0) {
        setText(`${hours}h ${mins}m ${secs}s left`);
      } else if (mins > 0) {
        setText(`${mins}m ${secs}s left`);
      } else {
        setText(`${secs}s left`);
      }
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadlineAt]);

  if (!deadlineAt || !text) return null;

  return (
    <div className={`font-bold text-red-600 dark:text-red-400 text-xl md:text-2xl ${className}`}>
      {text}
    </div>
  );
}
