/**
 * API service layer: all HTTP calls to the FastAPI backend.
 *
 * - Base URL: `VITE_API_BASE_URL` or localhost (see `.env` / Vite docs).
 * - JWT: kept in runtime memory only; request interceptor attaches `Authorization: Bearer`.
 * - 401 responses clear runtime token so navigation treats user as signed out.
 */
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
let authToken = null;

function getAuthToken() {
  return authToken;
}

function setAuthToken(token) {
  authToken = token ? String(token) : null;
}

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) setAuthToken(null);
    return Promise.reject(err);
  }
);

function getAuthHeader() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------- Auth ----------
/** Login: identifier = email (app user) or AD username / UPN (domain user). Backend expects "identifier" + "password". */
export async function signIn(identifier, password) {
  const { data } = await api.post('/auth/login', { identifier: identifier || '', password: password || '' });
  if (data.access_token) setAuthToken(data.access_token);
  return { session: data.session, profile: data.profile };
}

/** Sign in with Active Directory / LDAP (username + password). Same endpoint, sends identifier. */
export async function signInWithAD(adUsername, password) {
  const { data } = await api.post('/auth/login', { identifier: adUsername || '', password: password || '' });
  if (data.access_token) setAuthToken(data.access_token);
  return { session: data.session, profile: data.profile };
}

export async function signOut() {
  setAuthToken(null);
}

export async function getSession() {
  const token = getAuthToken();
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

/** User list for @mentions (recognition/comments). Any authenticated user. */
export async function getUsersForMention() {
  const { data } = await api.get('/users/mention-list');
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

export async function updateUserSupervisor(userId, managerId) {
  const { data } = await api.patch(`/users/${userId}/supervisor`, { manager_id: managerId ?? null });
  return data;
}

export async function updateUserDepartment(userId, department) {
  const { data } = await api.patch(`/users/${userId}/department`, {
    department: department === '' || department == null ? null : department,
  });
  return data;
}

/** Admin only: set local password (bcrypt) for email + password login. */
export async function setUserPassword(userId, newPassword) {
  const { data } = await api.patch(`/users/${userId}/password`, { new_password: newPassword });
  return data;
}

/** HR/Admin: update employee demographic and org fields (PATCH). */
export async function updateEmployeeRecord(userId, payload) {
  const { data } = await api.patch(`/users/${userId}/record`, payload);
  return data;
}

/** HR/Admin: workforce snapshot - departments, branches, gender mix, upcoming work anniversaries. */
export async function getOrganizationOverview() {
  const { data } = await api.get('/hr/organization-overview');
  return data;
}

/** Bulk import users from CSV. CSV must have: username, role. Optional: full_name, email, department, branch (name or code). */
export async function bulkImportUsers(file) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/users/bulk-import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
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

export async function acknowledgeAnnouncement(announcementId) {
  const { data } = await api.post(`/announcements/${announcementId}/acknowledge`);
  return data;
}

export async function getAnnouncementReadReceipts(announcementId) {
  const { data } = await api.get(`/announcements/${announcementId}/read-receipts`);
  return data || [];
}

export async function getRecognitionReport(params = {}) {
  const { data } = await api.get('/reports/recognitions', { params: { limit: params.limit ?? 100, from_date: params.fromDate, to_date: params.toDate } });
  return data;
}

/** HR/Admin: KPI and appraisal pipeline by appraisal cycle (for reports). */
export async function getAppraisalPerformanceReport(params = {}) {
  const { data } = await api.get('/reports/appraisal-performance', { params });
  return data;
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

export async function getDepartmentOptions() {
  const { data } = await api.get('/departments/options');
  return data?.rows || [];
}

export async function createDepartment(name) {
  const { data } = await api.post('/departments', { name });
  return data || {};
}

// ---------- Audit ----------
export async function getAuditLogs(limit = 100) {
  const { data } = await api.get('/audit', { params: { limit } });
  return data || [];
}

export async function getAdminSystemReport() {
  const { data } = await api.get('/admin/system-report');
  return data || {};
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

export async function getAdminDataMaintenanceSummary(params = {}) {
  const { data } = await api.get('/admin/data-maintenance/summary', { params });
  return data || {};
}

export async function runAdminDataCleanup(payload) {
  const { data } = await api.post('/admin/data-maintenance/cleanup', payload);
  return data || {};
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
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/hr-documents/${documentId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(res.statusText || 'Failed to load file');
  return res.blob();
}

// ---------- Staff documents (per employee: HR confidential + certificates) ----------
export async function getStaffDocuments(subjectUserId) {
  const params = {};
  if (subjectUserId) params.subject_user_id = subjectUserId;
  const { data } = await api.get('/staff-documents', { params });
  return data || [];
}

export async function uploadStaffDocument(file, title, kind, subjectUserId, appraisalId = null) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title || file.name || 'Document');
  formData.append('kind', kind);
  formData.append('subject_user_id', subjectUserId);
  if (appraisalId) formData.append('appraisal_id', appraisalId);
  const { data } = await api.post('/staff-documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteStaffDocument(documentId) {
  const { data } = await api.delete(`/staff-documents/${documentId}`);
  return data;
}

export async function getStaffDocumentFileBlob(documentId) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/staff-documents/${documentId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(res.statusText || 'Failed to load file');
  return res.blob();
}

// ---------- In-app notifications ----------
export async function getNotifications(limit = 40) {
  const { data } = await api.get('/notifications', { params: { limit } });
  return data || [];
}

export async function getUnreadNotificationCount() {
  const { data } = await api.get('/notifications/unread-count');
  return data?.count ?? 0;
}

export async function markNotificationRead(notificationId) {
  const { data } = await api.patch(`/notifications/${notificationId}/read`);
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await api.post('/notifications/mark-all-read');
  return data;
}

export async function clearAllNotifications() {
  const { data } = await api.delete('/notifications');
  return data;
}

// ---------- Recognitions ----------
export async function getRecognitionTypes() {
  const { data } = await api.get('/recognitions/types');
  return data || [];
}

export async function getRecognitions(limit = 50) {
  const { data } = await api.get('/recognitions', { params: { limit } });
  return data || [];
}

export async function createRecognition(recognitionType, message) {
  const { data } = await api.post('/recognitions', { recognition_type: recognitionType, message });
  return data;
}

export async function toggleRecognitionLike(recognitionId) {
  const { data } = await api.post(`/recognitions/${recognitionId}/like`);
  return data;
}

export async function getRecognitionComments(recognitionId) {
  const { data } = await api.get(`/recognitions/${recognitionId}/comments`);
  return data || [];
}

export async function addRecognitionComment(recognitionId, body) {
  const { data } = await api.post(`/recognitions/${recognitionId}/comments`, { body });
  return data;
}

// No realtime with local DB; polling can be added in components if needed
export function subscribeAttendanceFeed(callback) {
  return { unsubscribe: () => {} };
}

// ---------- Appraisal ----------
export async function getAppraisalCycles() {
  const { data } = await api.get('/appraisal/cycles');
  return data || [];
}

export async function getAppraisalCycle(cycleId) {
  const { data } = await api.get(`/appraisal/cycles/${cycleId}`);
  return data;
}

export async function createAppraisalCycle(payload) {
  const { data } = await api.post('/appraisal/cycles', payload);
  return data;
}

export async function updateAppraisalCycle(cycleId, payload) {
  const { data } = await api.patch(`/appraisal/cycles/${cycleId}`, payload);
  return data;
}

export async function getAppraisalCycleKpis(cycleId) {
  const { data } = await api.get(`/appraisal/cycles/${cycleId}/kpis`);
  return data || [];
}

export async function getAppraisalCycleAppraisals(cycleId) {
  const { data } = await api.get(`/appraisal/cycles/${cycleId}/appraisals`);
  return data || [];
}

export async function createKpi(payload) {
  const { data } = await api.post('/appraisal/kpis', payload);
  return data;
}

export async function getKpi(kpiId) {
  const { data } = await api.get(`/appraisal/kpis/${kpiId}`);
  return data;
}

export async function updateKpi(kpiId, payload) {
  const { data } = await api.patch(`/appraisal/kpis/${kpiId}`, payload);
  return data;
}

export async function submitKpi(kpiId) {
  const { data } = await api.post(`/appraisal/kpis/${kpiId}/submit`);
  return data;
}

export async function returnKpi(kpiId, comment) {
  const { data } = await api.post(`/appraisal/kpis/${kpiId}/return`, { comment });
  return data;
}

export async function verifyKpi(kpiId, comment) {
  const { data } = await api.post(`/appraisal/kpis/${kpiId}/verify`, { comment: (comment || '').trim() });
  return data;
}

export async function approveKpi(kpiId) {
  const { data } = await api.post(`/appraisal/kpis/${kpiId}/approve`);
  return data;
}

export async function receiveKpi(kpiId) {
  const { data } = await api.post(`/appraisal/kpis/${kpiId}/receive`);
  return data;
}

export async function acknowledgeKpi(kpiId) {
  const { data } = await api.post(`/appraisal/kpis/${kpiId}/acknowledge`);
  return data;
}

export async function getKpiWorkflow(kpiId) {
  const { data } = await api.get(`/appraisal/kpis/${kpiId}/workflow`);
  return data;
}

export async function createAppraisal(payload) {
  const { data } = await api.post('/appraisal/appraisals', payload);
  return data;
}

export async function getAppraisal(appraisalId) {
  const { data } = await api.get(`/appraisal/appraisals/${appraisalId}`);
  return data;
}

export async function updateAppraisal(appraisalId, payload) {
  const { data } = await api.patch(`/appraisal/appraisals/${appraisalId}`, payload);
  return data;
}

export async function putAppraisalAssessments(appraisalId, assessments) {
  const { data } = await api.put(`/appraisal/appraisals/${appraisalId}/assessments`, assessments);
  return data;
}

export async function submitAppraisal(appraisalId) {
  const { data } = await api.post(`/appraisal/appraisals/${appraisalId}/submit`);
  return data;
}

export async function returnAppraisal(appraisalId, comment) {
  const { data } = await api.post(`/appraisal/appraisals/${appraisalId}/return`, { comment });
  return data;
}

export async function verifyAppraisal(appraisalId, comment) {
  const { data } = await api.post(`/appraisal/appraisals/${appraisalId}/verify`, { comment: (comment || '').trim() });
  return data;
}

export async function approveAppraisal(appraisalId) {
  const { data } = await api.post(`/appraisal/appraisals/${appraisalId}/approve`);
  return data;
}

export async function receiveAppraisal(appraisalId) {
  const { data } = await api.post(`/appraisal/appraisals/${appraisalId}/receive`);
  return data;
}

export async function acknowledgeAppraisal(appraisalId) {
  const { data } = await api.post(`/appraisal/appraisals/${appraisalId}/acknowledge`);
  return data;
}

export async function getAppraisalWorkflow(appraisalId) {
  const { data } = await api.get(`/appraisal/appraisals/${appraisalId}/workflow`);
  return data;
}

export async function getAppraisalDashboardStaff() {
  const { data } = await api.get('/appraisal/dashboard/staff');
  return data;
}

export async function getAppraisalDashboardManager() {
  const { data } = await api.get('/appraisal/dashboard/manager');
  return data;
}

export async function getAppraisalDashboardHod() {
  const { data } = await api.get('/appraisal/dashboard/hod');
  return data;
}

export async function getAppraisalDashboardHr() {
  const { data } = await api.get('/appraisal/dashboard/hr');
  return data;
}

export async function getAppraisalExport(params = {}) {
  const { data } = await api.get('/appraisal/export', { params });
  return data;
}

// ---------- Appraisal: Annual KPIs (once per year, then locked for quarterly appraisals) ----------
export async function getAnnualKpis(year = null) {
  const params = year != null ? { year } : {};
  const { data } = await api.get('/appraisal/annual-kpis', { params });
  return data || [];
}

export async function createAnnualKpi(year) {
  const { data } = await api.post('/appraisal/annual-kpis', { year });
  return data;
}

export async function getAnnualKpi(annualKpiId) {
  const { data } = await api.get(`/appraisal/annual-kpis/${annualKpiId}`);
  return data;
}

export async function getAnnualKpiTitles(annualKpiId) {
  const { data } = await api.get(`/appraisal/annual-kpis/${annualKpiId}/titles`);
  return data || [];
}

export async function createAnnualKpiTitle(annualKpiId, payload) {
  const { data } = await api.post(`/appraisal/annual-kpis/${annualKpiId}/titles`, payload);
  return data;
}

export async function getKpiTitleItems(titleId) {
  const { data } = await api.get(`/appraisal/kpi-titles/${titleId}/items`);
  return data || [];
}

export async function createKpiItem(titleId, payload) {
  const { data } = await api.post(`/appraisal/kpi-titles/${titleId}/items`, payload);
  return data;
}

export async function updateKpiItem(itemId, payload) {
  const { data } = await api.patch(`/appraisal/kpi-items/${itemId}`, payload);
  return data;
}

export async function deleteKpiItem(itemId) {
  await api.delete(`/appraisal/kpi-items/${itemId}`);
}

export async function getAnnualKpisPendingApproval() {
  const { data } = await api.get('/appraisal/annual-kpis/pending-approval');
  return data || [];
}

export async function submitAnnualKpi(annualKpiId) {
  const { data } = await api.post(`/appraisal/annual-kpis/${annualKpiId}/submit`);
  return data;
}

export async function returnAnnualKpi(annualKpiId, comment) {
  const { data } = await api.post(`/appraisal/annual-kpis/${annualKpiId}/return`, { comment });
  return data;
}

export async function approveAnnualKpi(annualKpiId) {
  const { data } = await api.post(`/appraisal/annual-kpis/${annualKpiId}/approve`);
  return data;
}

export async function lockAnnualKpi(annualKpiId) {
  const { data } = await api.post(`/appraisal/annual-kpis/${annualKpiId}/lock`);
  return data;
}

export async function getAppraisalRatingScale() {
  const { data } = await api.get('/appraisal/rating-scale');
  return data || [];
}

export async function updateAppraisalScore(appraisalId, kpiItemId, payload) {
  const { data } = await api.patch(`/appraisal/appraisals/${appraisalId}/scores/${kpiItemId}`, payload);
  return data;
}

export async function confirmAppraisalAgreedScores(appraisalId) {
  const { data } = await api.post(`/appraisal/appraisals/${appraisalId}/confirm-agreed-scores`);
  return data;
}

/** Returns HTML blob for print / Save as PDF (auth via axios). */
export async function fetchAppraisalAgreedSummaryBlob(appraisalId) {
  const res = await api.get(`/appraisal/appraisals/${appraisalId}/agreed-summary`, { responseType: 'blob' });
  return res.data;
}

// ---------- Leave ----------
export async function getLeaveTypes() {
  const { data } = await api.get('/leave/types');
  return data || [];
}

/** HR/Admin: create a new leave type (unique code). */
export async function createLeaveType(payload) {
  const { data } = await api.post('/leave/types', payload);
  return data;
}

/** Admin only: deactivate (delete) a leave type. */
export async function deleteLeaveType(leaveTypeId) {
  const { data } = await api.delete(`/leave/types/${leaveTypeId}`);
  return data;
}

export async function getMyLeaveRequests() {
  const { data } = await api.get('/leave/my-requests');
  return data || [];
}

export async function createLeaveRequest(payload) {
  const { data } = await api.post('/leave/requests', payload);
  return data;
}

/** Owner (draft/returned) or HR/Admin: edit leave request dates/type/reason. */
export async function updateLeaveRequest(leaveRequestId, payload) {
  const { data } = await api.patch(`/leave/requests/${leaveRequestId}`, payload);
  return data;
}

/** Manager/HOD/HR/Admin: book approved leave for a staff member (shows on their My Leave). */
export async function assignLeaveToStaff(payload) {
  const { data } = await api.post('/leave/assign', payload);
  return data;
}

export async function submitLeaveRequest(leaveRequestId) {
  const { data } = await api.post(`/leave/requests/${leaveRequestId}/submit`);
  return data;
}

export async function cancelLeaveRequest(leaveRequestId, comment = '') {
  const { data } = await api.post(`/leave/requests/${leaveRequestId}/cancel`, { comment });
  return data;
}

export async function getPendingLeaveRequests() {
  const { data } = await api.get('/leave/pending');
  return data || [];
}

export async function approveLeaveRequest(leaveRequestId, comment = '') {
  const { data } = await api.post(`/leave/requests/${leaveRequestId}/approve`, { comment });
  return data;
}

export async function rejectLeaveRequest(leaveRequestId, comment) {
  const { data } = await api.post(`/leave/requests/${leaveRequestId}/reject`, { comment });
  return data;
}

export async function returnLeaveRequest(leaveRequestId, comment) {
  const { data } = await api.post(`/leave/requests/${leaveRequestId}/return`, { comment });
  return data;
}

export async function remindLeaveApprover(leaveRequestId) {
  const { data } = await api.post(`/leave/requests/${leaveRequestId}/remind-approver`);
  return data;
}

export async function rescheduleApprovedLeaveRequest(leaveRequestId, payload) {
  const { data } = await api.post(`/leave/requests/${leaveRequestId}/reschedule`, payload);
  return data;
}

export async function getLeaveWorkflow(leaveRequestId) {
  const { data } = await api.get(`/leave/requests/${leaveRequestId}/workflow`);
  return data;
}

export async function getLeaveReportSummary(params = {}) {
  const { data } = await api.get('/leave/reports/summary', { params });
  return data;
}

export async function getLeaveWorkflowAnalytics(params = {}) {
  const { data } = await api.get('/leave/reports/workflow-analytics', { params });
  return data;
}

export async function getLeaveBalances(params = {}) {
  const { data } = await api.get('/leave/balances', { params });
  return data;
}

/** HR/Admin only: apply year-end rollover (base entitlement + previous-year carry-over). */
export async function postLeaveHrRecomputeStatutoryAnnual(params = {}) {
  const { data } = await api.post('/leave/hr/recompute-statutory-annual', {}, { params });
  return data;
}

export async function getLeaveBalanceAdjustments(params = {}) {
  const { data } = await api.get('/leave/hr/balance-adjustments', { params });
  return data || { rows: [], limit: 0 };
}

export async function createLeaveBalanceAdjustment(payload) {
  const { data } = await api.post('/leave/hr/balance-adjustments', payload);
  return data;
}

export async function assignLeaveTypeToEmployee(payload) {
  const { data } = await api.post('/leave/hr/assign-type', payload);
  return data;
}

export async function approveLeaveBalanceAdjustment(adjustmentId, comment = '') {
  const { data } = await api.post(`/leave/hr/balance-adjustments/${adjustmentId}/approve`, { comment });
  return data;
}

export async function rejectLeaveBalanceAdjustment(adjustmentId, comment) {
  const { data } = await api.post(`/leave/hr/balance-adjustments/${adjustmentId}/reject`, { comment });
  return data;
}

export async function getLeaveMyDashboard() {
  const { data } = await api.get('/leave/my-dashboard');
  return data;
}

export async function getLeaveOverview(params = {}) {
  const { data } = await api.get('/leave/overview', { params });
  return data;
}

export async function getLeaveTeamBalances(params = {}) {
  const { data } = await api.get('/leave/team-balances', { params });
  return data;
}

export async function getLeaveHrFilters() {
  const { data } = await api.get('/leave/filters');
  return data || { departments: [] };
}

export async function getLeaveOnLeave(params = {}) {
  const { data } = await api.get('/leave/on-leave', { params });
  return data || { rows: [], count: 0, on_date: '' };
}

export async function getLeaveColleaguesOnLeave(params = {}) {
  const { data } = await api.get('/leave/colleagues-on-leave', { params });
  return data || { rows: [], count: 0, on_date: '', department: null };
}

export async function getLeaveOrgRequests(params = {}) {
  const { data } = await api.get('/leave/org-requests', { params });
  return data || { rows: [], limit: 0 };
}
