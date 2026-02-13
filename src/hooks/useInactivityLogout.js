import { useEffect, useCallback, useRef } from 'react';
import { setLastActivity, getLastActivity } from '../utils/storage';
import { INACTIVITY_LOGOUT_MS } from '../utils/constants';

const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];

/**
 * Auto logout after inactivity (e.g. 30 min). Resets on user activity.
 */
export function useInactivityLogout(onLogout) {
  const timeoutRef = useRef(null);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  const resetTimer = useCallback(() => {
    setLastActivity();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const last = getLastActivity();
      if (Date.now() - last >= INACTIVITY_LOGOUT_MS) {
        onLogoutRef.current?.();
      }
      timeoutRef.current = null;
    }, INACTIVITY_LOGOUT_MS);
  }, []);

  useEffect(() => {
    events.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [resetTimer]);
}
