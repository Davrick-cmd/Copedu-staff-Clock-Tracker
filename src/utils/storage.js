import { STORAGE_KEYS } from './constants';

export function getTheme() {
  return localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function getLastActivity() {
  const v = localStorage.getItem(STORAGE_KEYS.LAST_ACTIVITY);
  return v ? parseInt(v, 10) : Date.now();
}

export function setLastActivity() {
  localStorage.setItem(STORAGE_KEYS.LAST_ACTIVITY, String(Date.now()));
}
