import { createSlice } from '@reduxjs/toolkit';
import { getTheme, setTheme as persistTheme } from '../../utils/storage';

const theme = getTheme();
if (theme === 'dark') document.documentElement.classList.add('dark');
else document.documentElement.classList.remove('dark');

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    theme: theme,
    sidebarOpen: true,
  },
  reducers: {
    toggleTheme: (state) => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      persistTheme(state.theme);
    },
    setTheme: (state, { payload }) => {
      state.theme = payload;
      persistTheme(payload);
    },
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
  },
});

export const { toggleTheme, setTheme, toggleSidebar } = uiSlice.actions;
export default uiSlice.reducer;
