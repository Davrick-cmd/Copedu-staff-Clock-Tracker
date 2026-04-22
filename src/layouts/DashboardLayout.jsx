/**
 * Authenticated app shell: sidebar + scrollable main area + global toasts.
 *
 * Sidebar open state lives in Redux (`ui.sidebarOpen`) so it survives navigation.
 * Mobile drawer uses local `mobileOpen` (overlay + slide-in); desktop uses width collapse.
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Sidebar } from '../components/Sidebar';
import { ToastContainer } from '../components/Toast';
import { toggleSidebar } from '../store/slices/uiSlice';

export function DashboardLayout() {
  const dispatch = useDispatch();
  const sidebarOpen = useSelector((s) => s.ui.sidebarOpen);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100/90 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <Sidebar
        open={sidebarOpen}
        mobileOpen={mobileOpen}
        onToggle={() => dispatch(toggleSidebar())}
        onMobileClose={() => setMobileOpen(false)}
        onMobileOpen={() => setMobileOpen(true)}
      />
      <main className="flex-1 min-w-0 overflow-auto transition-all flex flex-col relative">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
          aria-hidden
          style={{
            backgroundImage: `radial-gradient(at 100% 0%, rgba(59, 130, 246, 0.08) 0px, transparent 50%),
              radial-gradient(at 0% 100%, rgba(99, 102, 241, 0.06) 0px, transparent 45%)`,
          }}
        />
        <div className="p-4 md:p-8 flex-1 min-w-0 relative z-0">
          <div className="max-w-[1400px] mx-auto w-full">
            <Outlet />
          </div>
        </div>
      </main>
      <ToastContainer />
    </div>
  );
}
