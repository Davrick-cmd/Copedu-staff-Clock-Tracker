/**
 * API service layer: all backend calls go through the Python API (SQLite).
 * Auth: JWT stored in localStorage; sent as Authorization header.
 */
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const TOKEN_KEY = 'copedu_token';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) localStorage.removeItem(TOKEN_KEY);
    return Promise.reject(err);
  }
);

function getAuthHeader() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------- Auth ----------
export async function signIn(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  if (data.access_token) localStorage.setItem(TOKEN_KEY, data.access_token);
  return { session: data.session, profile: data.profile };
}

/** Sign in with Active Directory / LDAP (username + password). */
export async function signInWithAD(adUsername, password) {
  const { data } = await api.post('/auth/login', { ad_username: adUsername, password });
  if (data.access_token) localStorage.setItem(TOKEN_KEY, data.access_token);
  return { session: data.session, profile: data.profile };
}

export async function signOut() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function getSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const { data } = await api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    return { session: data.session, profile: data.profile };
  } catch {
    return null;
  }
}

export async function getUserProfile(userId) {
  const { data } = await api.get('/auth/me', { headers: getAuthHeader() });
  if (data.session?.user?.id !== userId) throw new Error('Forbidden');
  return data.profile;
}

export async function updateUserProfile(userId, payload) {
  const { data } = await api.get('/auth/me', { headers: getAuthHeader() });
  if (data.session?.user?.id !== userId) throw new Error('Forbidden');
  return data.profile;
}

// ---------- Attendance ----------
export async function getTodayAttendance(userId) {
  const { data } = await api.get('/attendance/today');
  return data;
}

export async function clockIn(userId, branchId = null) {
  const { data } = await api.post('/attendance/clock-in', { branch_id: branchId || undefined });
  return data;
}

export async function clockOut(logId) {
  const id = logId != null ? String(logId) : '';
  if (!id) throw new Error('No clock-in session to clock out');
  const { data } = await api.post('/attendance/clock-out', { log_id: id });
  return data;
}

export async function getAttendanceHistory(userId, fromDate, toDate) {
  const params = {};
  if (fromDate) params.from_date = fromDate.slice(0, 10);
  if (toDate) params.to_date = toDate.slice(0, 10);
  const { data } = await api.get('/attendance/history', { params });
  return data || [];
}

export async function getAllAttendance(filters = {}) {
  const params = {};
  if (filters.fromDate) params.from_date = filters.fromDate;
  if (filters.toDate) params.to_date = filters.toDate;
  if (filters.branchId) params.branch_id = filters.branchId;
  if (filters.userId) params.user_id = filters.userId;
  const { data } = await api.get('/attendance/all', { params });
  return data || [];
}

export async function getLateReport(filters = {}) {
  const params = {};
  if (filters.fromDate) params.from_date = filters.fromDate;
  if (filters.toDate) params.to_date = filters.toDate;
  if (filters.branchId) params.branch_id = filters.branchId;
  const { data } = await api.get('/reports/late', { params });
  return data || [];
}

export async function getFlaggedStaff(filters = {}) {
  const params = { min_lates: filters.minLates ?? 3 };
  if (filters.fromDate) params.from_date = filters.fromDate;
  if (filters.toDate) params.to_date = filters.toDate;
  const { data } = await api.get('/reports/flagged', { params });
  return data || [];
}

/** Daily report summary: present, absent, late, summary, daily_table. */
export async function getDailyReportSummary(date, branchId = null) {
  const params = { date: (date || '').toString().slice(0, 10) };
  if (branchId) params.branch_id = branchId;
  const { data } = await api.get('/reports/daily-summary', { params });
  return data;
}

/** Monthly report: executive_summary, department_summary, staff_monthly, days. */
export async function getMonthlyReportSummary(year, month, branchId = null) {
  const params = { year, month };
  if (branchId) params.branch_id = branchId;
  const { data } = await api.get('/reports/monthly-summary', { params });
  return data;
}

// ---------- Users ----------
export async function getUsers() {
  const { data } = await api.get('/users');
  return data || [];
}

/** Look up user in AD by username; returns { full_name, email } for create-user form. Admin only. */
export async function lookupADUser(username) {
  const { data } = await api.get('/users/lookup-ad', { params: { username: (username || '').trim() } });
  return data;
}

export async function createUser(payload) {
  const { data } = await api.post('/users', payload);
  return data;
}

export async function setUserRole(userId, role) {
  const { data } = await api.patch(`/users/${userId}/role`, { role });
  return data;
}

export async function setUserActive(userId, isActive) {
  const { data } = await api.patch(`/users/${userId}/active`, { is_active: isActive });
  return data;
}

// ---------- Announcements ----------
export async function getAnnouncements(expired = false) {
  const { data } = await api.get('/announcements', { params: { expired } });
  return data || [];
}

export async function createAnnouncement(payload) {
  const { data } = await api.post('/announcements', payload);
  return data;
}

export async function deleteAnnouncement(id) {
  await api.delete(`/announcements/${id}`);
}

// ---------- Branches ----------
export async function getBranches() {
  const { data } = await api.get('/branches');
  return data || [];
}

export async function createBranch(payload) {
  const { data } = await api.post('/branches', payload);
  return data;
}

export async function updateBranch(id, payload) {
  const { data } = await api.patch(`/branches/${id}`, payload);
  return data;
}

export async function deleteBranch(id) {
  await api.delete(`/branches/${id}`);
}

// ---------- Audit ----------
export async function getAuditLogs(limit = 100) {
  const { data } = await api.get('/audit', { params: { limit } });
  return data || [];
}

export async function createAuditLog(payload) {
  const { data } = await api.post('/audit', payload);
  return data;
}

// ---------- Settings ----------
export async function getSettings() {
  const { data } = await api.get('/settings');
  return data || {};
}

export async function getWorkHours() {
  const { data } = await api.get('/settings/work-hours');
  return data || { work_start: '09:00', work_end: '18:00', timezone: 'Africa/Kigali', late_threshold_minutes: 15 };
}

export async function setSetting(key, value) {
  await api.patch('/settings', { key, value: typeof value === 'string' ? value : JSON.stringify(value) });
}

// ---------- HR Documents ----------
export async function getHrDocuments() {
  const { data } = await api.get('/hr-documents');
  return data || [];
}

export async function addHrDocument(payload) {
  const { data } = await api.post('/hr-documents', payload);
  return data;
}

/** Upload HR document (file + title). Returns created document. */
export async function uploadHrDocument(file, title) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title || file.name || 'Document');
  const { data } = await api.post('/hr-documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** Fetch HR document file as blob for download/print. */
export async function getHrDocumentFileBlob(documentId) {
  const token = localStorage.getItem('copedu_token');
  const res = await fetch(`${API_BASE}/hr-documents/${documentId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(res.statusText || 'Failed to load file');
  return res.blob();
}

// No realtime with local DB; polling can be added in components if needed
export function subscribeAttendanceFeed(callback) {
  return { unsubscribe: () => {} };
}
