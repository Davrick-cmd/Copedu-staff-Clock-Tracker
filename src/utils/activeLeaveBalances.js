/**
 * Restrict leave dashboard payload to types still in the active catalogue (`/leave/types`).
 * Avoids showing retired types if balance rows or API responses ever drift.
 */
export function restrictLeaveDashToActiveTypes(leaveDash, activeLeaveTypes) {
  if (!leaveDash) return null;
  const ids = new Set((activeLeaveTypes || []).map((t) => t?.id).filter(Boolean));
  const balances = (leaveDash.balances || []).filter((b) => b?.leave_type_id && ids.has(b.leave_type_id));
  const total_remaining = balances.reduce((sum, b) => sum + Number(b.remaining_days ?? 0), 0);
  return {
    ...leaveDash,
    balances,
    total_remaining_days: Math.round(total_remaining * 100) / 100,
  };
}
