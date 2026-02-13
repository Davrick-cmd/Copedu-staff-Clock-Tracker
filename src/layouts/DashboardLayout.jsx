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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
      <Sidebar
        open={sidebarOpen}
        mobileOpen={mobileOpen}
        onToggle={() => dispatch(toggleSidebar())}
        onMobileClose={() => setMobileOpen(false)}
        onMobileOpen={() => setMobileOpen(true)}
      />
      <main className="flex-1 overflow-auto transition-all">
        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </main>
      <ToastContainer />
    </div>
  );
}
