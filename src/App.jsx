import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import { Routes } from './routes';
import { loadSession, logout } from './store/slices/authSlice';
import { useInactivityLogout } from './hooks/useInactivityLogout';
import { getTheme } from './utils/storage';
import { ErrorBoundary } from './components/ErrorBoundary';

// Apply saved theme on load
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
