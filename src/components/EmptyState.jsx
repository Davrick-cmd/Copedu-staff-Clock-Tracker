export function EmptyState({ title, message, icon }) {
  return (
    <div className="text-center py-12 px-4">
      {icon && <div className="text-4xl text-gray-400 dark:text-gray-500 mb-4">{icon}</div>}
      <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">{title}</h3>
      {message && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{message}</p>}
    </div>
  );
}
