/** Staff records created from an earlier bulk import use ids with this prefix. */
export function isImportedStaffRecord(userId) {
  return typeof userId === 'string' && userId.startsWith('mig-user-ohrm-');
}

export function ImportedUserBadge() {
  return (
    <span
      className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
      title="Account created from a prior data import"
    >
      Imported
    </span>
  );
}
