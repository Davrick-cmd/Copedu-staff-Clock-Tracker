import { useSelector, useDispatch } from 'react-redux';
import { useCallback } from 'react';
import { loadSession, login as doLogin, logout as doLogout } from '../store/slices/authSlice';
import { ROLES } from '../utils/constants';

export function useAuth() {
  const dispatch = useDispatch();
  const { user, profile, loading, error } = useSelector((s) => s.auth);

  const isAdmin = profile?.role === ROLES.ADMIN;
  const isHR = profile?.role === ROLES.HR;
  const isEmployee = profile?.role === ROLES.EMPLOYEE;
  const isAuthenticated = !!user;

  const login = useCallback((email, password) => dispatch(doLogin({ email, password })), [dispatch]);
  const logout = useCallback(() => dispatch(doLogout()), [dispatch]);
  const refreshSession = useCallback(() => dispatch(loadSession()), [dispatch]);

  return {
    user,
    profile,
    loading,
    error,
    isAuthenticated,
    isAdmin,
    isHR,
    isEmployee,
    login,
    logout,
    refreshSession,
  };
}
