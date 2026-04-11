import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ROUTES } from '../../utils/constants';
import { formatDate } from '../../utils/formatters';
import { StatTile } from './DashboardWidgets';
import { GenderDonutChart } from './InsightChartCards';

function escapeCsvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadOrgDemographicsCsv(data) {
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
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `organization-demographics-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {{ data: object | null, loading?: boolean, compactTitle?: boolean }} props
 */
export function OrganizationOverview({ data, loading, compactTitle = false }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-6 animate-pulse shadow-soft">
        <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded-lg w-48 mb-4" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }
  if (!data) return null;

  const deptTop = (data.by_department || []).slice(0, 8);
  const branchTop = (data.by_branch || []).slice(0, 8);
  const ann = (data.upcoming_anniversaries || []).slice(0, 10);
  const g = data.gender_counts || {};
  const wm = data.women_men || { women: g.female ?? 0, men: g.male ?? 0, other_or_not_set: 0 };
  const age = data.age_stats || {};
  const chartData = age.chart_data || [];
  const active = data.active_employees ?? 0;
  const inactive = data.no_longer_active ?? data.inactive_accounts ?? 0;
  const totalUsers = data.total_users ?? active + inactive;
  const genderRecorded = (wm.women ?? 0) + (wm.men ?? 0) + (wm.other_or_not_set ?? 0);
  const womenPct = genderRecorded > 0 ? Math.round(((wm.women ?? 0) / genderRecorded) * 1000) / 10 : 0;
  const menPct = genderRecorded > 0 ? Math.round(((wm.men ?? 0) / genderRecorded) * 1000) / 10 : 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {!compactTitle && (
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Organization overview</h2>
          )}
          {compactTitle ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Workforce demographics, age bands (requires date of birth on records), and org breakdown.
            </p>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Active vs former staff, gender mix, age bands (when date of birth is saved), and org structure. Inactive
              accounts are people who <strong className="text-slate-700 dark:text-slate-300">left or were deactivated</strong>
              - they no longer sign in. Add <strong className="text-slate-700 dark:text-slate-300">Date of birth</strong> on{' '}
              <Link to={ROUTES.HR.EMPLOYEES} className="text-primary-600 dark:text-primary-400 font-medium hover:underline">
                Employee records
              </Link>{' '}
              to populate age analytics.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {!compactTitle && (
            <Link
              to={ROUTES.HR.ORGANIZATION}
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
            >
              Full organization dashboard
            </Link>
          )}
          <button
            type="button"
            onClick={() => downloadOrgDemographicsCsv(data)}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            Export demographics CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Active employees"
          value={active}
          hint="Currently can sign in and appear in operational reports."
          variant="blue"
        />
        <StatTile
          label="No longer active"
          value={inactive}
          hint="Left the company or account disabled - excluded from live attendance/leave headcount."
          variant="default"
        />
        <StatTile label="Total user records" value={totalUsers} hint="Everyone ever created in the system." variant="green" />
        <StatTile
          label="Age data on file"
          value={age.known_count ?? 0}
          hint={`${age.unknown_count ?? 0} active staff missing or invalid date of birth.`}
          variant="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Women &amp; men (active)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Based on gender saved on employee records.</p>
          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-pink-500/10 dark:bg-pink-500/15 border border-pink-200/60 dark:border-pink-900/40 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-pink-800 dark:text-pink-200">Women</p>
                  <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white mt-1">{wm.women ?? 0}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{womenPct}% of recorded gender</p>
                </div>
                <div className="rounded-xl bg-sky-500/10 dark:bg-sky-500/15 border border-sky-200/60 dark:border-sky-900/40 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200">Men</p>
                  <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white mt-1">{wm.men ?? 0}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{menPct}% of recorded gender</p>
                </div>
              </div>
              {genderRecorded > 0 && (
                <div className="mt-4 h-3 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800" aria-hidden>
                  <div className="h-full bg-pink-500" style={{ width: `${womenPct}%` }} />
                  <div className="h-full bg-sky-500" style={{ width: `${menPct}%` }} />
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                Other / prefer not to say / not set:{' '}
                <span className="font-semibold tabular-nums">{wm.other_or_not_set ?? 0}</span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/40 p-3 min-h-[200px]">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                Recorded mix (donut)
              </p>
              <GenderDonutChart genderCounts={g} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Age range (active, with DOB)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {age.known_count
              ? `From ${age.min} to ${age.max} years · average ${age.avg} years.`
              : 'No dates of birth yet - add them under employee records to see distribution.'}
          </p>
          {chartData.some((d) => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="band" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={32} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    backgroundColor: 'rgba(255,255,255,0.96)',
                  }}
                />
                <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} name="Staff" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Age chart appears once DOB is captured.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Departments (groups)"
          value={(data.by_department || []).length}
          hint="Distinct department values among active staff"
          variant="green"
        />
        <StatTile
          label="Branches in use"
          value={(data.by_branch || []).filter((b) => b.branch_id).length}
          hint="Locations with at least one active employee"
          variant="amber"
        />
        <StatTile label="Recorded as female" value={g.female ?? 0} hint="Subset of active employees" variant="default" />
        <StatTile label="Recorded as male" value={g.male ?? 0} hint="Subset of active employees" variant="default" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">By department</h3>
          <ul className="space-y-2 max-h-56 overflow-y-auto text-sm">
            {deptTop.length === 0 ? (
              <li className="text-slate-500 dark:text-slate-400">No data</li>
            ) : (
              deptTop.map((row) => (
                <li key={row.department} className="flex justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-300 truncate">{row.department}</span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white shrink-0">{row.count}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">By branch</h3>
          <ul className="space-y-2 max-h-56 overflow-y-auto text-sm">
            {branchTop.length === 0 ? (
              <li className="text-slate-500 dark:text-slate-400">No data</li>
            ) : (
              branchTop.map((row) => (
                <li key={row.branch_id || 'none'} className="flex justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-300 truncate">
                    {row.branch_name || row.branch_code || '-'}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white shrink-0">{row.count}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Gender detail</h3>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            <li className="flex justify-between">
              <span>Female</span>
              <span className="tabular-nums font-medium">{g.female ?? 0}</span>
            </li>
            <li className="flex justify-between">
              <span>Male</span>
              <span className="tabular-nums font-medium">{g.male ?? 0}</span>
            </li>
            <li className="flex justify-between">
              <span>Other / not listed</span>
              <span className="tabular-nums font-medium">{g.other ?? 0}</span>
            </li>
            <li className="flex justify-between">
              <span>Prefer not to say</span>
              <span className="tabular-nums font-medium">{g.prefer_not_say ?? 0}</span>
            </li>
            <li className="flex justify-between text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-700">
              <span>Not set</span>
              <span className="tabular-nums font-medium">{g.unset ?? 0}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Upcoming work anniversaries (30 days)</h3>
        {ann.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No anniversaries in the next 30 days, or hire dates are not recorded yet. Add{' '}
            <strong className="text-slate-700 dark:text-slate-300">Work anniversary (hire date)</strong> on employee records.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ann.map((a) => (
              <li
                key={a.user_id}
                className="inline-flex flex-col px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700 text-sm"
              >
                <span className="font-medium text-slate-900 dark:text-white">{a.full_name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(a.next_celebration_date)} · {a.years_of_service ?? '-'} yrs
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
