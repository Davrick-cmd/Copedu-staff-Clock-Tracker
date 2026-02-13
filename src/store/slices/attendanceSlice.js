import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as api from '../../services/api';
import { minutesBetween } from '../../utils/formatters';

export const fetchTodayAttendance = createAsyncThunk('attendance/today', async (userId, { rejectWithValue }) => {
  try {
    return await api.getTodayAttendance(userId);
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

export const doClockIn = createAsyncThunk('attendance/clockIn', async ({ userId, branchId }, { rejectWithValue }) => {
  try {
    return await api.clockIn(userId, branchId);
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

export const doClockOut = createAsyncThunk('attendance/clockOut', async ({ logId, clockInAt }, { rejectWithValue }) => {
  try {
    const totalMinutes = minutesBetween(clockInAt, new Date());
    return await api.clockOut(logId, totalMinutes);
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

export const fetchAttendanceHistory = createAsyncThunk('attendance/history', async ({ userId, fromDate, toDate }, { rejectWithValue }) => {
  try {
    return await api.getAttendanceHistory(userId, fromDate, toDate);
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

export const fetchAllAttendance = createAsyncThunk('attendance/all', async (filters, { rejectWithValue }) => {
  try {
    return await api.getAllAttendance(filters || {});
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

const attendanceSlice = createSlice({
  name: 'attendance',
  initialState: {
    todayLog: null,
    history: [],
    allLogs: [],
    loading: false,
    error: null,
  },
  reducers: {
    setTodayLog: (state, { payload }) => {
      state.todayLog = payload;
    },
    addFeedLog: (state, { payload }) => {
      state.feedLogs = state.feedLogs || [];
      state.feedLogs.unshift(payload);
      state.feedLogs = state.feedLogs.slice(0, 50);
    },
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTodayAttendance.pending, (state) => { state.loading = true; })
      .addCase(fetchTodayAttendance.fulfilled, (state, { payload }) => { state.todayLog = payload; state.error = null; state.loading = false; })
      .addCase(fetchTodayAttendance.rejected, (state, { payload }) => { state.error = payload; state.loading = false; })
      .addCase(doClockIn.pending, (state) => { state.loading = true; })
      .addCase(doClockIn.fulfilled, (state, { payload }) => { state.todayLog = payload; state.error = null; state.loading = false; })
      .addCase(doClockIn.rejected, (state, { payload }) => { state.error = payload; state.loading = false; })
      .addCase(doClockOut.pending, (state) => { state.loading = true; })
      .addCase(doClockOut.fulfilled, (state, { payload }) => { state.todayLog = payload; state.error = null; state.loading = false; })
      .addCase(doClockOut.rejected, (state, { payload }) => { state.error = payload; state.loading = false; })
      .addCase(fetchAttendanceHistory.fulfilled, (state, { payload }) => { state.history = payload || []; state.error = null; })
      .addCase(fetchAllAttendance.fulfilled, (state, { payload }) => { state.allLogs = payload || []; state.error = null; });
  },
});

export const { setTodayLog, addFeedLog, clearError } = attendanceSlice.actions;
export default attendanceSlice.reducer;
