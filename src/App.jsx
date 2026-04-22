/**
 * Root React component: Redux provider, session bootstrap, theme, and router.
 *
 * Boot order:
 * 1. Theme from localStorage is applied to `<html>` before paint (see below).
 * 2. `loadSession()` checks for an active in-memory JWT (refresh requires sign-in again).
 * 3. `useInactivityLogout` dispatches `logout` after idle timeout (`INACTIVITY_LOGOUT_MS` in `utils/constants.js`).
 */
import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import { Routes } from './routes';
import { loadSession, logout } from './store/slices/authSlice';
import { useInactivityLogout } from './hooks/useInactivityLogout';
import { getTheme } from './utils/storage';
import { ErrorBoundary } from './components/ErrorBoundary';

const theme = getTheme();
if (theme === 'dark') document.documentElement.classList.add('dark');
else document.documentElement.classList.remove('dark');

function AppInner() {
  useInactivityLogout(() => store.dispatch(logout()));
  return <Routes />;
}

export default function App() {
  useEffect(() => {
    store.dispatch(loadSession());
  }, []);

  return (
    <ErrorBoundary>
      <Provider store={store}>
        <AppInner />
      </Provider>
    </ErrorBoundary>
  );
}
