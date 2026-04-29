function escapeCsvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build and download the organization demographics CSV (same columns as the dashboard export). */
export function downloadOrganizationDemographicsCsv(data) {
  const wm = data.women_men || {};
  const age = data.age_stats || {};
  const lines = [
    'Copedu HR Suite - organization demographics',
    `Generated,${new Date().toISOString().slice(0, 10)}`,
    '',
    'Headcount',
    'Metric,Count',
    `Active employees,${data.active_employees ?? 0}`,
    `No longer active (inactive accounts),${data.no_longer_active ?? data.inactive_accounts ?? 0}`,
    `Total user records in database,${data.total_users ?? ''}`,
    '',
    'Gender (active employees)',
    'Category,Count',
    `Women,${wm.women ?? 0}`,
    `Men,${wm.men ?? 0}`,
    `Other or not set,${wm.other_or_not_set ?? 0}`,
    '',
    'Age (active employees with date of birth)',
    `Known with age,${age.known_count ?? 0}`,
    `No date of birth or invalid,${age.unknown_count ?? 0}`,
    `Youngest (years),${age.min ?? ''}`,
    `Oldest (years),${age.max ?? ''}`,
    `Average age (years),${age.avg ?? ''}`,
    '',
    'Age bands (count)',
    'Band,Count',
    ...(age.chart_data || []).map((r) => `${escapeCsvCell(r.band)},${r.count ?? 0}`),
    '',
    'By department (top 20)',
    'Department,Count',
    ...(data.by_department || []).slice(0, 20).map((row) => `${escapeCsvCell(row.department)},${row.count}`),
    '',
    'By branch',
    'Branch,Count',
    ...(data.by_branch || []).map((row) =>
      `${escapeCsvCell(row.branch_name || row.branch_code || '-')},${row.count}`,
    ),
    '',
    'Workforce status',
    'Metric,Count',
    `Currently acting,${data.acting_now_count ?? 0}`,
    `Probation due approval,${data.probation_due_count ?? 0}`,
    `On probation,${data.probation_upcoming_count ?? 0}`,
    '',
    'By category',
    'Category,Count',
    ...(data.by_position_category || []).map((row) => `${escapeCsvCell(row.position_category)},${row.count ?? 0}`),
    '',
    'By employment type',
    'Employment type,Count',
    ...(data.by_employment_type || []).map((row) => `${escapeCsvCell(row.employment_type)},${row.count ?? 0}`),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `organization-demographics-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
