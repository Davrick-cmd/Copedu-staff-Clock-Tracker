import { createSlice } from '@reduxjs/toolkit';

const notificationSlice = createSlice({
  name: 'notifications',
  initialState: {
    items: [],
  },
  reducers: {
    addNotification: (state, { payload }) => {
      const id = Date.now();
      state.items.push({ id, ...payload, createdAt: id });
      state.items = state.items.slice(-50);
    },
    removeNotification: (state, { payload }) => {
      state.items = state.items.filter((n) => n.id !== payload);
    },
    clearNotifications: (state) => {
      state.items = [];
    },
  },
});

export const { addNotification, removeNotification, clearNotifications } = notificationSlice.actions;
export default notificationSlice.reducer;
