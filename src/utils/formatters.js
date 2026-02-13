/**
 * Format date for display (e.g. "12 Feb 2025")
 */
export function formatDate(d) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format time (e.g. "09:15")
 */
export function formatTime(d) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Format datetime
 */
export function formatDateTime(d) {
  if (!d) return '—';
  return `${formatDate(d)} ${formatTime(d)}`;
}

/**
 * Format duration in minutes to "Xh Ym"
 */
export function formatDuration(minutes) {
  if (minutes == null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Parse "HH:mm" to today's Date in local time
 */
export function parseTimeToToday(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d;
}

/**
 * Get minutes between two dates
 */
export function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const s = typeof start === 'string' ? new Date(start) : start;
  const e = typeof end === 'string' ? new Date(end) : end;
  return Math.round((e - s) / (60 * 1000));
}

const KIGALI_TZ = 'Africa/Kigali';

/** Get current time string in Kigali (e.g. "14:35") */
export function nowInKigaliTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: KIGALI_TZ });
}

/** Get today's date parts in Kigali */
function getTodayKigali() {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: KIGALI_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(new Date());
  const obj = {};
  parts.forEach((p) => { if (p.type !== 'literal') obj[p.type] = parseInt(p.value, 10); });
  return obj;
}

/** Late cutoff: today in Kigali at workStart + threshold. Kigali = UTC+2, so (lateH, lateM) Kigali = (lateH-2, lateM) UTC */
export function getLateCutoffKigali(workStart = '09:00', thresholdMinutes = 15) {
  const [h, m] = workStart.split(':').map(Number);
  const totalMinutes = (h || 0) * 60 + (m || 0) + (thresholdMinutes || 0);
  const lateH = Math.floor(totalMinutes / 60) % 24;
  const lateM = totalMinutes % 60;
  const { year, month, day } = getTodayKigali();
  return new Date(Date.UTC(year, month - 1, day, lateH - 2, lateM, 0));
}

/** Seconds until late cutoff (positive = time left) */
export function secondsUntilLate(workStart, thresholdMinutes) {
  const cutoff = getLateCutoffKigali(workStart, thresholdMinutes);
  return Math.floor((cutoff - Date.now()) / 1000);
}
