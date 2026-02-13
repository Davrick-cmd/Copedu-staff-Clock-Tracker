export function LoadingSpinner({ size = 'md' }) {
  const s = size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-12 h-12' : 'w-8 h-8';
  return (
    <div className={`animate-spin rounded-full border-2 border-gray-200 border-t-primary-500 ${s}`} role="status" aria-label="Loading" />
  );
}
