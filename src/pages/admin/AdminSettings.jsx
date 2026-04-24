import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../hooks/useToast';
import { MODULE_VISIBILITY_OPTIONS } from '../../utils/moduleVisibility';

export function AdminSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [workForm, setWorkForm] = useState({
    work_start_time: '09:00',
    work_end_time: '18:00',
    timezone: 'Africa/Kigali',
    late_threshold_minutes: '15',
    max_work_hours_auto_clock_out: '10',
  });
  const [securityForm, setSecurityForm] = useState({
    clock_in_allowed_ip_ranges: '',
    clock_in_same_ip_minutes: '0',
  });
  const [smtpForm, setSmtpForm] = useState({
    leave_email_enabled: false,
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_password: '',
    smtp_from: '',
    smtp_use_tls: true,
  });
  const [testEmailRecipient, setTestEmailRecipient] = useState('');
  const [moduleForm, setModuleForm] = useState({
    hidden_modules: [],
  });
  const [maintenanceForm, setMaintenanceForm] = useState({
    notifications_days: '30',
    audit_days: '180',
    confirm_text: '',
  });
  const [maintenanceSummary, setMaintenanceSummary] = useState(null);
  const [workSaving, setWorkSaving] = useState(false);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [moduleSaving, setModuleSaving] = useState(false);
  const [maintenanceBusyTarget, setMaintenanceBusyTarget] = useState('');

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => ({})).finally(() => setLoading(false));
  }, []);

  const refreshMaintenanceSummary = async (daysOverride = null) => {
    const notificationsDays = Number(daysOverride?.notifications_days ?? maintenanceForm.notifications_days) || 30;
    const auditDays = Number(daysOverride?.audit_days ?? maintenanceForm.audit_days) || 180;
    try {
      const summary = await api.getAdminDataMaintenanceSummary({
        notifications_days: notificationsDays,
        audit_days: auditDays,
      });
      setMaintenanceSummary(summary);
    } catch {
      setMaintenanceSummary(null);
    }
  };

  useEffect(() => {
    refreshMaintenanceSummary();
  }, []);

  const unquote = (v) => (typeof v === 'string' ? v.replace(/"/g, '') : v);
  const lateThreshold = settings.late_threshold_minutes ?? 15;
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
  const hiddenModulesRaw = settings.hidden_modules;
  const hiddenModules = Array.isArray(hiddenModulesRaw)
    ? hiddenModulesRaw
    : (typeof hiddenModulesRaw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(hiddenModulesRaw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : []);

  useEffect(() => {
    setWorkForm({
      work_start_time: workStart,
      work_end_time: workEnd,
      timezone,
      late_threshold_minutes: String(lateThreshold ?? 15),
      max_work_hours_auto_clock_out: String(maxWorkHoursAutoClockOut ?? 10),
    });
    setSecurityForm({
      clock_in_allowed_ip_ranges: allowedRangesStr,
      clock_in_same_ip_minutes: String(sameIpMinutes ?? 0),
    });
    setSmtpForm({
      leave_email_enabled: leaveEmailEnabled,
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_user: smtpUser,
      smtp_password: smtpPassword,
      smtp_from: smtpFrom,
      smtp_use_tls: smtpUseTls,
    });
    setModuleForm({
      hidden_modules: hiddenModules,
    });
  }, [
    workStart,
    workEnd,
    timezone,
    lateThreshold,
    maxWorkHoursAutoClockOut,
    sameIpMinutes,
    allowedRangesStr,
    leaveEmailEnabled,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpFrom,
    smtpUseTls,
    hiddenModulesRaw,
  ]);

  const saveWorkSettings = async () => {
    setWorkSaving(true);
    try {
      await Promise.all([
        api.setSetting('work_start_time', JSON.stringify(workForm.work_start_time || '09:00')),
        api.setSetting('work_end_time', JSON.stringify(workForm.work_end_time || '18:00')),
        api.setSetting('timezone', JSON.stringify(workForm.timezone || 'Africa/Kigali')),
        api.setSetting('late_threshold_minutes', workForm.late_threshold_minutes || '15'),
        api.setSetting('max_work_hours_auto_clock_out', workForm.max_work_hours_auto_clock_out || '10'),
      ]);
      setSettings((prev) => ({
        ...prev,
        work_start_time: JSON.stringify(workForm.work_start_time || '09:00'),
        work_end_time: JSON.stringify(workForm.work_end_time || '18:00'),
        timezone: JSON.stringify(workForm.timezone || 'Africa/Kigali'),
        late_threshold_minutes: workForm.late_threshold_minutes || '15',
        max_work_hours_auto_clock_out: workForm.max_work_hours_auto_clock_out || '10',
      }));
      toast('Work hour settings saved', 'success');
    } catch {
      toast('Save failed', 'error');
    } finally {
      setWorkSaving(false);
    }
  };

  const saveSecuritySettings = async () => {
    setSecuritySaving(true);
    try {
      const lines = (securityForm.clock_in_allowed_ip_ranges || '')
        .trim()
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      await Promise.all([
        api.setSetting('clock_in_allowed_ip_ranges', JSON.stringify(lines)),
        api.setSetting('clock_in_same_ip_minutes', securityForm.clock_in_same_ip_minutes || '0'),
      ]);
      setSettings((prev) => ({
        ...prev,
        clock_in_allowed_ip_ranges: lines,
        clock_in_same_ip_minutes: securityForm.clock_in_same_ip_minutes || '0',
      }));
      toast('Clock-in security settings saved', 'success');
    } catch {
      toast('Save failed', 'error');
    } finally {
      setSecuritySaving(false);
    }
  };

  const saveLeaveEmailSettings = async () => {
    setSmtpSaving(true);
    try {
      await Promise.all([
        api.setSetting('leave_email_enabled', smtpForm.leave_email_enabled ? 'true' : 'false'),
        api.setSetting('smtp_host', JSON.stringify(smtpForm.smtp_host || '')),
        api.setSetting('smtp_port', JSON.stringify(smtpForm.smtp_port || '587')),
        api.setSetting('smtp_user', JSON.stringify(smtpForm.smtp_user || '')),
        api.setSetting('smtp_password', JSON.stringify(smtpForm.smtp_password || '')),
        api.setSetting('smtp_from', JSON.stringify(smtpForm.smtp_from || '')),
        api.setSetting('smtp_use_tls', smtpForm.smtp_use_tls ? 'true' : 'false'),
      ]);
      setSettings((prev) => ({
        ...prev,
        leave_email_enabled: smtpForm.leave_email_enabled ? 'true' : 'false',
        smtp_host: JSON.stringify(smtpForm.smtp_host || ''),
        smtp_port: JSON.stringify(smtpForm.smtp_port || '587'),
        smtp_user: JSON.stringify(smtpForm.smtp_user || ''),
        smtp_password: JSON.stringify(smtpForm.smtp_password || ''),
        smtp_from: JSON.stringify(smtpForm.smtp_from || ''),
        smtp_use_tls: smtpForm.smtp_use_tls ? 'true' : 'false',
      }));
      toast('Leave email settings saved', 'success');
    } catch {
      toast('Save failed', 'error');
    } finally {
      setSmtpSaving(false);
    }
  };

  const sendTestEmail = async () => {
    const recipient = (testEmailRecipient || '').trim();
    if (!recipient) {
      toast('Enter a recipient email first', 'error');
      return;
    }
    setSmtpTesting(true);
    try {
      await api.sendSettingsEmailTest({
        recipient_email: recipient,
        subject: 'HR Suite SMTP test',
      });
      toast(`Test email sent to ${recipient}`, 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Test email failed', 'error');
    } finally {
      setSmtpTesting(false);
    }
  };

  const saveModuleVisibility = async () => {
    setModuleSaving(true);
    try {
      await api.setSetting('hidden_modules', JSON.stringify(moduleForm.hidden_modules || []));
      window.dispatchEvent(
        new CustomEvent('module-visibility-updated', {
          detail: { hidden_modules: moduleForm.hidden_modules || [] },
        }),
      );
      setSettings((prev) => ({ ...prev, hidden_modules: moduleForm.hidden_modules || [] }));
      toast('Module visibility saved', 'success');
    } catch {
      toast('Save failed', 'error');
    } finally {
      setModuleSaving(false);
    }
  };

  const runMaintenanceCleanup = async (target) => {
    const confirmRequired = target === 'audit_logs' ? 'CLEAR AUDIT' : 'CLEAR NOTIFICATIONS';
    const older_than_days =
      target === 'audit_logs'
        ? Number(maintenanceForm.audit_days || 180)
        : Number(maintenanceForm.notifications_days || 30);
    if ((maintenanceForm.confirm_text || '').trim() !== confirmRequired) {
      toast(`Type ${confirmRequired} to continue`, 'error');
      return;
    }
    setMaintenanceBusyTarget(target);
    try {
      const res = await api.runAdminDataCleanup({
        target,
        older_than_days,
        confirm_text: maintenanceForm.confirm_text.trim(),
      });
      toast(`Cleanup done: ${res.deleted_rows || 0} row(s) removed`, 'success');
      setMaintenanceForm((prev) => ({ ...prev, confirm_text: '' }));
      await refreshMaintenanceSummary();
    } catch (e) {
      toast(e?.response?.data?.detail || 'Cleanup failed', 'error');
    } finally {
      setMaintenanceBusyTarget('');
    }
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">App Settings</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">Work hours (Kigali)</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Work start (HH:mm)</label>
            <input
              type="text"
              value={workForm.work_start_time}
              onChange={(e) => setWorkForm((prev) => ({ ...prev, work_start_time: e.target.value }))}
              placeholder="09:00"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Work end (HH:mm)</label>
            <input
              type="text"
              value={workForm.work_end_time}
              onChange={(e) => setWorkForm((prev) => ({ ...prev, work_end_time: e.target.value }))}
              placeholder="18:00"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timezone</label>
            <input
              type="text"
              value={workForm.timezone}
              onChange={(e) => setWorkForm((prev) => ({ ...prev, timezone: e.target.value }))}
              placeholder="Africa/Kigali"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Late threshold (minutes after start)</label>
            <input
              type="number"
              min={0}
              value={workForm.late_threshold_minutes}
              onChange={(e) => setWorkForm((prev) => ({ ...prev, late_threshold_minutes: e.target.value }))}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max work hours before auto clock-out</label>
            <input
              type="number"
              min={1}
              max={24}
              value={workForm.max_work_hours_auto_clock_out}
              onChange={(e) => setWorkForm((prev) => ({ ...prev, max_work_hours_auto_clock_out: e.target.value }))}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">If someone stays clocked in longer than this (e.g. 10h for 9am–6pm), the system automatically clocks them out.</p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveWorkSettings}
              disabled={workSaving}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
            >
              {workSaving ? 'Saving...' : 'Save work hour settings'}
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">Clock-in security (anti-cheat)</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Reduce buddy-punching: restrict clock-in to office network and/or block same device used by different users.</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Allowed IP ranges (one per line, e.g. 10.10.10.0/24). Leave empty to allow any.</label>
            <textarea
              rows={3}
              value={securityForm.clock_in_allowed_ip_ranges}
              onChange={(e) => setSecurityForm((prev) => ({ ...prev, clock_in_allowed_ip_ranges: e.target.value }))}
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
              value={securityForm.clock_in_same_ip_minutes}
              onChange={(e) => setSecurityForm((prev) => ({ ...prev, clock_in_same_ip_minutes: e.target.value }))}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">If a different user clocked in from this IP within this many minutes, block. 0 = disabled.</p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveSecuritySettings}
              disabled={securitySaving}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
            >
              {securitySaving ? 'Saving...' : 'Save security settings'}
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4 md:col-span-2">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
            Leave notifications (email)
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            When enabled, the system emails approvers on new requests and notifies employees and HR on final approval,
            rejection, or return.
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={smtpForm.leave_email_enabled}
              onChange={(e) => setSmtpForm((prev) => ({ ...prev, leave_email_enabled: e.target.checked }))}
              className="rounded border-gray-300"
            />
            Enable leave emails
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SMTP host</label>
              <input
                type="text"
                value={smtpForm.smtp_host}
                onChange={(e) => setSmtpForm((prev) => ({ ...prev, smtp_host: e.target.value }))}
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
                value={smtpForm.smtp_port}
                onChange={(e) => setSmtpForm((prev) => ({ ...prev, smtp_port: e.target.value }))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SMTP username</label>
              <input
                type="text"
                value={smtpForm.smtp_user}
                onChange={(e) => setSmtpForm((prev) => ({ ...prev, smtp_user: e.target.value }))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SMTP password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={smtpForm.smtp_password}
                onChange={(e) => setSmtpForm((prev) => ({ ...prev, smtp_password: e.target.value }))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From address</label>
              <input
                type="email"
                value={smtpForm.smtp_from}
                onChange={(e) => setSmtpForm((prev) => ({ ...prev, smtp_from: e.target.value }))}
                placeholder="hr@company.com"
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={smtpForm.smtp_use_tls}
              onChange={(e) => setSmtpForm((prev) => ({ ...prev, smtp_use_tls: e.target.checked }))}
              className="rounded border-gray-300"
            />
            Use STARTTLS (typical for port 587; disable for plain 25 or use port 465 with implicit TLS on the server)
          </label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              type="email"
              value={testEmailRecipient}
              onChange={(e) => setTestEmailRecipient(e.target.value)}
              placeholder="Recipient for test email (e.g. it@company.com)"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <button
              type="button"
              onClick={sendTestEmail}
              disabled={smtpTesting}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 text-sm font-semibold hover:bg-primary-50 dark:hover:bg-primary-900/30 disabled:opacity-50"
            >
              {smtpTesting ? 'Sending test…' : 'Send test email'}
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveLeaveEmailSettings}
              disabled={smtpSaving}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
            >
              {smtpSaving ? 'Saving...' : 'Save email settings'}
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4 md:col-span-2">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
            Module visibility
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Hide modules that are still under development. Hidden modules are removed from sidebars for all roles.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MODULE_VISIBILITY_OPTIONS.map((m) => {
              const checked = (moduleForm.hidden_modules || []).includes(m.key);
              return (
                <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? Array.from(new Set([...(moduleForm.hidden_modules || []), m.key]))
                        : (moduleForm.hidden_modules || []).filter((k) => k !== m.key);
                      setModuleForm((prev) => ({ ...prev, hidden_modules: next }));
                    }}
                    className="rounded border-gray-300"
                  />
                  Hide {m.label}
                </label>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveModuleVisibility}
              disabled={moduleSaving}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
            >
              {moduleSaving ? 'Saving...' : 'Save module visibility'}
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4 md:col-span-2">
          <h2 className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
            Data maintenance
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Safe cleanup with archive-first behavior. Older rows are exported to a JSON archive before deletion.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notifications older than (days)</label>
              <input
                type="number"
                min={30}
                value={maintenanceForm.notifications_days}
                onChange={(e) => setMaintenanceForm((prev) => ({ ...prev, notifications_days: e.target.value }))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Eligible rows: {maintenanceSummary?.notifications?.eligible_rows ?? '-'} (minimum {maintenanceSummary?.notifications?.min_days ?? 30} days)
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Audit logs older than (days)</label>
              <input
                type="number"
                min={90}
                value={maintenanceForm.audit_days}
                onChange={(e) => setMaintenanceForm((prev) => ({ ...prev, audit_days: e.target.value }))}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Eligible rows: {maintenanceSummary?.audit_logs?.eligible_rows ?? '-'} (minimum {maintenanceSummary?.audit_logs?.min_days ?? 90} days)
              </p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Confirmation phrase (type <code className="text-xs bg-gray-100 dark:bg-gray-900 px-1 rounded">CLEAR NOTIFICATIONS</code> or <code className="text-xs bg-gray-100 dark:bg-gray-900 px-1 rounded">CLEAR AUDIT</code>)
            </label>
            <input
              type="text"
              value={maintenanceForm.confirm_text}
              onChange={(e) => setMaintenanceForm((prev) => ({ ...prev, confirm_text: e.target.value }))}
              className="w-full px-4 py-2 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Type exact confirmation phrase"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => refreshMaintenanceSummary()}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Refresh counts
            </button>
            <button
              type="button"
              onClick={() => runMaintenanceCleanup('notifications')}
              disabled={maintenanceBusyTarget !== ''}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
            >
              {maintenanceBusyTarget === 'notifications' ? 'Cleaning notifications...' : 'Archive + clear notifications'}
            </button>
            <button
              type="button"
              onClick={() => runMaintenanceCleanup('audit_logs')}
              disabled={maintenanceBusyTarget !== ''}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
            >
              {maintenanceBusyTarget === 'audit_logs' ? 'Cleaning audit logs...' : 'Archive + clear audit logs'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
