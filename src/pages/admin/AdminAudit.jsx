import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatUptime(seconds) {
  const total = Math.max(Number(seconds || 0), 0);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function AdminAudit() {
  const [systemReport, setSystemReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAdminSystemReport()
      .then((report) => {
        setSystemReport(report || null);
      })
      .catch(() => {
        setSystemReport(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const recentLogins = systemReport?.logins?.recent || [];
  const recentSecurityAlerts = systemReport?.security?.recent_blocked_clockins || [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">System Report</h1>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Health</p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{systemReport?.health?.status || 'unknown'}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            DB reachable: {systemReport?.health?.db_reachable ? 'Yes' : 'No'}
          </p>
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Uptime</p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{formatUptime(systemReport?.uptime?.seconds)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Started: {formatDateTime(systemReport?.uptime?.started_at)}
          </p>
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Database Size</p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{formatBytes(systemReport?.system?.db_size_bytes)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Generated: {formatDateTime(systemReport?.generated_at)}
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Active Users</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{systemReport?.system?.users_active ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Inactive Users</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{systemReport?.system?.users_inactive ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Logins Today</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{systemReport?.logins?.today ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Logins (7 days)</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{systemReport?.logins?.last_7_days ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Blocked Clock-ins Today</p>
          <p className="mt-1 text-2xl font-bold text-rose-700 dark:text-rose-300">{systemReport?.security?.blocked_clockins_today ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 shadow p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Blocked Clock-ins (7 days)</p>
          <p className="mt-1 text-2xl font-bold text-rose-700 dark:text-rose-300">{systemReport?.security?.blocked_clockins_last_7_days ?? 0}</p>
        </div>
      </section>

      <section className="rounded-xl bg-white dark:bg-gray-800 shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Login Activity</h2>
        </div>
        {!recentLogins.length ? (
          <div className="p-4">
            <EmptyState title="No login activity yet" message="Successful sign-ins will appear here." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Time</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">User</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Identifier</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {recentLogins.map((log) => (
                  <tr key={log.id} className="text-gray-700 dark:text-gray-300 text-sm">
                    <td className="px-4 py-2">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-2">{log.user?.full_name || log.user?.email || '-'}</td>
                    <td className="px-4 py-2">{log.identifier || '-'}</td>
                    <td className="px-4 py-2">{log.login_method || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-white dark:bg-gray-800 shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Security Alerts (Blocked Clock-ins)</h2>
        </div>
        {!recentSecurityAlerts.length ? (
          <div className="p-4">
            <EmptyState title="No blocked attempts" message="Blocked anti-cheat attempts will appear here." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Time</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">User</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Reason</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {recentSecurityAlerts.map((log) => (
                  <tr key={log.id} className="text-gray-700 dark:text-gray-300 text-sm">
                    <td className="px-4 py-2">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-2">{log.user?.full_name || log.user?.email || '-'}</td>
                    <td className="px-4 py-2">{log.reason || '-'}</td>
                    <td className="px-4 py-2">{log.client_ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </motion.div>
  );
}
