import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '../../services/api';
import { ROLES, ROUTES } from '../../utils/constants';
import { formatDate } from '../../utils/formatters';
import { downloadOrganizationDemographicsCsv } from '../../utils/organizationDemographicsCsv';
import { StatTile } from './DashboardWidgets';
import { GenderDonutChart } from './InsightChartCards';

function localTodayIso() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {{ data: object | null, loading?: boolean, compactTitle?: boolean }} props
 */
export function OrganizationOverview({ data, loading, compactTitle = false }) {
  const role = useSelector((s) => s.auth.profile?.role);
  const canSendAnniversaryEmails = role === ROLES.HR || role === ROLES.ADMIN;
  const [anniversaryRunDate, setAnniversaryRunDate] = useState(localTodayIso);
  const [anniversaryBusy, setAnniversaryBusy] = useState(false);
  const [anniversaryNotice, setAnniversaryNotice] = useState(null);

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
  const categoryTop = (data.by_position_category || []).slice(0, 8);
  const employmentTop = (data.by_employment_type || []).slice(0, 8);
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
  const today = new Date();
  const daysUntil = (isoDate) => {
    const d = new Date(`${isoDate}T00:00:00`);
    const ms = d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return Math.max(0, Math.round(ms / 86400000));
  };

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
            onClick={() => downloadOrganizationDemographicsCsv(data)}
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Currently acting" value={data.acting_now_count ?? 0} hint="Active acting assignments today." variant="blue" />
        <StatTile label="Probation due approval" value={data.probation_due_count ?? 0} hint="Probation ended, pending HR approval." variant="amber" />
        <StatTile label="On probation" value={data.probation_upcoming_count ?? 0} hint="Probation end date still in future." variant="default" />
        <StatTile
          label="Retiring soon (60 years)"
          value={age.retiring_within_12_months_count ?? 0}
          hint={`${age.retirement_due_count ?? 0} already at/above retirement age.`}
          variant="green"
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
        <StatTile label="Role categories" value={(data.by_position_category || []).length} hint="Distinct position-category groups." variant="default" />
        <StatTile
          label="Full-time employment"
          value={(data.by_employment_type || []).find((x) => String(x.employment_type || '').toLowerCase() === 'full-time employment')?.count ?? 0}
          hint="Active staff marked full-time."
          variant="default"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
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
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">By category</h3>
          <ul className="space-y-2 max-h-56 overflow-y-auto text-sm">
            {categoryTop.length === 0 ? (
              <li className="text-slate-500 dark:text-slate-400">No data</li>
            ) : (
              categoryTop.map((row) => (
                <li key={row.position_category} className="flex justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-300 truncate">{row.position_category}</span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white shrink-0">{row.count}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">By employment type</h3>
          <ul className="space-y-2 max-h-56 overflow-y-auto text-sm">
            {employmentTop.length === 0 ? (
              <li className="text-slate-500 dark:text-slate-400">No data</li>
            ) : (
              employmentTop.map((row) => (
                <li key={row.employment_type} className="flex justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-300 truncate">{row.employment_type}</span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white shrink-0">{row.count}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-5 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Upcoming work anniversaries (30 days)</h3>
          {canSendAnniversaryEmails && (
            <div className="flex flex-col gap-2 sm:items-end shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <span className="whitespace-nowrap">Send for date</span>
                  <input
                    type="date"
                    value={anniversaryRunDate}
                    onChange={(e) => setAnniversaryRunDate(e.target.value)}
                    disabled={anniversaryBusy}
                    className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs px-2 py-1.5"
                  />
                </label>
                <button
                  type="button"
                  disabled={anniversaryBusy}
                  onClick={async () => {
                    setAnniversaryBusy(true);
                    setAnniversaryNotice(null);
                    try {
                      const res = await api.hrSendWorkAnniversaryEmails({
                        runDate: anniversaryRunDate,
                        dryRun: true,
                      });
                      if (res.enabled === false && res.detail) {
                        setAnniversaryNotice({ type: 'err', text: String(res.detail) });
                      } else {
                        setAnniversaryNotice({
                          type: 'ok',
                          text: `Preview: ${res.sent ?? 0} would be sent, ${res.skipped_duplicate ?? 0} skipped (already emailed this year). Eligible today: ${res.eligible ?? 0}.`,
                        });
                      }
                    } catch (e) {
                      const msg = e?.response?.data?.detail || e?.message || 'Preview failed';
                      setAnniversaryNotice({ type: 'err', text: Array.isArray(msg) ? msg.map((x) => x.msg || x).join(' ') : String(msg) });
                    } finally {
                      setAnniversaryBusy(false);
                    }
                  }}
                  className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:border-primary-400 disabled:opacity-50"
                >
                  Preview emails
                </button>
                <button
                  type="button"
                  disabled={anniversaryBusy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        'Send work anniversary emails now for the selected date? Anyone already logged for this celebration year is skipped (same as automatic sends).'
                      )
                    ) {
                      return;
                    }
                    setAnniversaryBusy(true);
                    setAnniversaryNotice(null);
                    try {
                      const res = await api.hrSendWorkAnniversaryEmails({
                        runDate: anniversaryRunDate,
                        dryRun: false,
                      });
                      if (res.enabled === false && res.detail) {
                        setAnniversaryNotice({ type: 'err', text: String(res.detail) });
                      } else {
                        setAnniversaryNotice({
                          type: 'ok',
                          text: `Sent ${res.sent ?? 0} email(s). ${res.skipped_duplicate ?? 0} skipped (already sent this year). Eligible on that date: ${res.eligible ?? 0}.`,
                        });
                      }
                    } catch (e) {
                      const msg = e?.response?.data?.detail || e?.message || 'Send failed';
                      setAnniversaryNotice({ type: 'err', text: Array.isArray(msg) ? msg.map((x) => x.msg || x).join(' ') : String(msg) });
                    } finally {
                      setAnniversaryBusy(false);
                    }
                  }}
                  className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  Send emails now
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md sm:text-right">
                Manual send uses the same duplicate log as the daily job—no one gets two emails for the same anniversary year.
              </p>
            </div>
          )}
        </div>
        {anniversaryNotice && (
          <p
            className={`text-sm mb-3 rounded-lg px-3 py-2 ${
              anniversaryNotice.type === 'err'
                ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200'
                : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-100'
            }`}
          >
            {anniversaryNotice.text}
          </p>
        )}
        {ann.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No anniversaries in the next 30 days, or hire dates are not recorded yet. Add{' '}
            <strong className="text-slate-700 dark:text-slate-300">Work anniversary (hire date)</strong> on employee records.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ann.map((a) => (
              <li
                key={a.user_id}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-gradient-to-r from-slate-50 to-white dark:from-slate-800/80 dark:to-slate-900/80 p-3 text-sm shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-white leading-tight">{a.full_name}</span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200 whitespace-nowrap">
                    {daysUntil(a.next_celebration_date) === 0 ? 'Today' : `${daysUntil(a.next_celebration_date)}d`}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{formatDate(a.next_celebration_date)}</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{a.years_of_service ?? '-'} yrs</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
