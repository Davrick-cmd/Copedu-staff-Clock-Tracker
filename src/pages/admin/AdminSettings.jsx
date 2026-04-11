import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../hooks/useToast';

export function AdminSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => ({})).finally(() => setLoading(false));
  }, []);

  const update = (key, value) => {
    api.setSetting(key, value)
      .then(() => {
        setSettings((prev) => ({ ...prev, [key]: value }));
        toast('Setting saved', 'success');
      })
      .catch(() => toast('Save failed', 'error'));
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const unquote = (v) => (typeof v === 'string' ? v.replace(/"/g, '') : v);
  const lateThreshold = settings.late_threshold_minutes ?? 15;
  const absentTime = unquote(settings.absent_mark_time) || '09:00';
  const companyName = unquote(settings.company_name) || 'CopeDu Staff Clock Tracker';
  const workStart = unquote(settings.work_start_time) || '09:00';
  const workEnd = unquote(settings.work_end_time) || '18:00';
  const timezone = unquote(settings.timezone) || 'Africa/Kigali';
  const sameIpMinutes = settings.clock_in_same_ip_minutes ?? 0;
  const maxWorkHoursAutoClockOut = settings.max_work_hours_auto_clock_out ?? 10;
  const leaveEmailEnabled =
    settings.leave_email_enabled === true || String(settings.leave_email_enabled || '').toLowerCase() === 'true';
  const smtpHost = unquote(settings.smtp_host) || '';
  const smtpPort =
    typeof settings.smtp_port === 'number' ? String(settings.smtp_port) : unquote(settings.smtp_port) || '587';
  const smtpUser = unquote(settings.smtp_user) || '';
  const smtpPassword = unquote(settings.smtp_password) || '';
  const smtpFrom = unquote(settings.smtp_from) || '';
  const smtpUseTls =
    settings.smtp_use_tls === true || String(settings.smtp_use_tls || '').toLowerCase() === 'true';
  const allowedRangesRaw = settings.clock_in_allowed_ip_ranges;
  const allowedRanges = Array.isArray(allowedRangesRaw) ? allowedRangesRaw : (typeof allowedRangesRaw === 'string' ? (() => { try { return JSON.parse(allowedRangesRaw); } catch { return []; } })() : []);
  const allowedRangesStr = Array.isArray(allowedRanges) ? allowedRanges.join('\n') : '';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">App Settings</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">General</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company name</label>
            <input
              type="text"
              defaultValue={companyName}
              onBlur={(e) => update('company_name', JSON.stringify(e.target.value || ''))}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Absent mark time (HH:mm)</label>
            <input
              type="text"
              defaultValue={absentTime}
              onBlur={(e) => update('absent_mark_time', JSON.stringify(e.target.value || '09:00'))}
              placeholder="09:00"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">Work hours (Kigali)</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Work start (HH:mm)</label>
            <input
              type="text"
              defaultValue={workStart}
              onBlur={(e) => update('work_start_time', JSON.stringify(e.target.value || '09:00'))}
              placeholder="09:00"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Work end (HH:mm)</label>
            <input
              type="text"
              defaultValue={workEnd}
              onBlur={(e) => update('work_end_time', JSON.stringify(e.target.value || '18:00'))}
              placeholder="18:00"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timezone</label>
            <input
              type="text"
              defaultValue={timezone}
              onBlur={(e) => update('timezone', JSON.stringify(e.target.value || 'Africa/Kigali'))}
              placeholder="Africa/Kigali"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Late threshold (minutes after start)</label>
            <input
              type="number"
              min={0}
              defaultValue={lateThreshold}
              onBlur={(e) => update('late_threshold_minutes', e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max work hours before auto clock-out</label>
            <input
              type="number"
              min={1}
              max={24}
              defaultValue={maxWorkHoursAutoClockOut}
              onBlur={(e) => update('max_work_hours_auto_clock_out', e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">If someone stays clocked in longer than this (e.g. 10h for 9am–6pm), the system automatically clocks them out.</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">Clock-in security (anti-cheat)</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Reduce buddy-punching: restrict clock-in to office network and/or block same device used by different users.</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Allowed IP ranges (one per line, e.g. 10.10.10.0/24). Leave empty to allow any.</label>
            <textarea
              rows={3}
              defaultValue={allowedRangesStr}
              onBlur={(e) => {
                const lines = (e.target.value || '').trim().split(/\n/).map((s) => s.trim()).filter(Boolean);
                update('clock_in_allowed_ip_ranges', JSON.stringify(lines));
              }}
              placeholder="10.10.10.0/24"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Same-IP cooldown (minutes)</label>
            <input
              type="number"
              min={0}
              max={120}
              defaultValue={sameIpMinutes}
              onBlur={(e) => update('clock_in_same_ip_minutes', e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">If a different user clocked in from this IP within this many minutes, block. 0 = disabled.</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4 md:col-span-2">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
            Leave notifications (email)
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            When enabled, the system emails approvers on new requests and notifies employees and HR on final approval,
            rejection, or return. Environment variables <code className="text-xs bg-gray-100 dark:bg-gray-900 px-1 rounded">LEAVE_EMAIL_ENABLED</code> and{' '}
            <code className="text-xs bg-gray-100 dark:bg-gray-900 px-1 rounded">SMTP_*</code> override these settings if set on the server.
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={leaveEmailEnabled}
              onChange={(e) => update('leave_email_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded border-gray-300"
            />
            Enable leave emails
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SMTP host</label>
              <input
                type="text"
                defaultValue={smtpHost}
                onBlur={(e) => update('smtp_host', JSON.stringify(e.target.value || ''))}
                placeholder="smtp.example.com"
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SMTP port</label>
              <input
                type="number"
                min={1}
                max={65535}
                defaultValue={smtpPort}
                onBlur={(e) => update('smtp_port', JSON.stringify(e.target.value || '587'))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SMTP username</label>
              <input
                type="text"
                defaultValue={smtpUser}
                onBlur={(e) => update('smtp_user', JSON.stringify(e.target.value || ''))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SMTP password</label>
              <input
                type="password"
                autoComplete="new-password"
                defaultValue={smtpPassword}
                onBlur={(e) => update('smtp_password', JSON.stringify(e.target.value || ''))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From address</label>
              <input
                type="email"
                defaultValue={smtpFrom}
                onBlur={(e) => update('smtp_from', JSON.stringify(e.target.value || ''))}
                placeholder="hr@company.com"
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={smtpUseTls}
              onChange={(e) => update('smtp_use_tls', e.target.checked ? 'true' : 'false')}
              className="rounded border-gray-300"
            />
            Use STARTTLS (typical for port 587; disable for plain 25 or use port 465 with implicit TLS on the server)
          </label>
        </div>
      </div>
    </motion.div>
  );
}
