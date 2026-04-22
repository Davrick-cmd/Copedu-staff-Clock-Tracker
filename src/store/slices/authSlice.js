/**
 * Auth slice: current user + profile from JWT session.
 *
 * Thunks call `services/api` (token in runtime memory). On 401 the axios interceptor clears the token;
 * `loadSession` then resolves to null and the UI should treat the user as logged out.
 */
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as api from '../../services/api';
import { getSession } from '../../services/api';

export const loadSession = createAsyncThunk('auth/loadSession', async (_, { rejectWithValue }) => {
  try {
    const data = await getSession();
    if (!data?.session?.user) return null;
    return { session: data.session, profile: data.profile };
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

export const login = createAsyncThunk('auth/login', async (payload, { rejectWithValue }) => {
  const identifier = payload?.identifier ?? payload?.email ?? '';
  const password = payload?.password ?? '';
  try {
    const data = await api.signIn(identifier, password);
    return { session: data.session, profile: data.profile };
  } catch (e) {
    return rejectWithValue(e.response?.data?.detail || e.message || 'Login failed');
  }
});

export const logout = createAsyncThunk('auth/logout', async (_, { rejectWithValue }) => {
  try {
    await api.signOut();
    return null;
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    profile: null,
    loading: true,
    error: null,
  },
  reducers: {
    setProfile: (state, { payload }) => {
      state.profile = payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSession.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(loadSession.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.user = payload?.session?.user ?? null;
        state.profile = payload?.profile ?? null;
        state.error = null;
      })
      .addCase(loadSession.rejected, (state, { payload }) => {
        state.loading = false;
        state.user = null;
        state.profile = null;
        state.error = payload;
      })
      .addCase(login.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(login.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.user = payload?.session?.user ?? null;
        state.profile = payload?.profile ?? null;
        state.error = null;
      })
      .addCase(login.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.profile = null;
        state.error = null;
      });
  },
});

export const { setProfile, clearError } = authSlice.actions;
export default authSlice.reducer;
