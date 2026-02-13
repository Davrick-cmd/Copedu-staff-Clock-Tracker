import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { addNotification } from '../store/slices/notificationSlice';

export function useToast() {
  const dispatch = useDispatch();
  const toast = useCallback((message, type = 'info') => {
    dispatch(addNotification({ message, type }));
  }, [dispatch]);
  return toast;
}
