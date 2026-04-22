/**
 * Redux store (single global instance, provided in `App.jsx`).
 *
 * - `auth` — session user + profile + login/logout thunks.
 * - `attendance` — today’s clock state + history fetchers used on the employee dashboard.
 * - `ui` — theme + sidebar collapsed flag.
 * - `notifications` — ephemeral toast queue (not the same as API bell notifications).
 */
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import attendanceReducer from './slices/attendanceSlice';
import uiReducer from './slices/uiSlice';
import notificationReducer from './slices/notificationSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    attendance: attendanceReducer,
    ui: uiReducer,
    notifications: notificationReducer,
  },
});
