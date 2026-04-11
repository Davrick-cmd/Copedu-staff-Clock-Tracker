import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const VIOLET = '#8b5cf6';
const CYAN = '#06b6d4';
const AMBER = '#f59e0b';
const EMERALD = '#10b981';
const ROSE = '#f43f5e';
const SKY = '#0ea5e9';
const SLATE = '#64748b';

const PIPELINE_LABELS = {
  pending_manager: 'Awaiting supervisor',
  pending_hod: 'Awaiting HOD',
  pending_hr: 'Awaiting HR',
};

/** Recharts defaults use dark label text - force light text on dark tooltip for readability. */
export const CHART_TOOLTIP_DARK = {
  contentStyle: {
    borderRadius: 12,
    border: '1px solid rgba(148,163,184,0.45)',
    backgroundColor: 'rgba(15,23,42,0.97)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
  },
  labelStyle: {
    color: '#f8fafc',
    fontWeight: 600,
    marginBottom: 4,
  },
  itemStyle: {
    color: '#e2e8f0',
  },
  wrapperStyle: { outline: 'none' },
};

function chartCard(title, subtitle, children) {
  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-gradient-to-b from-white via-white to-slate-50/80 dark:from-slate-900/95 dark:via-slate-900/90 dark:to-slate-950/95 p-5 shadow-soft-lg ring-1 ring-violet-500/[0.08] dark:ring-violet-400/[0.12] min-h-[280px] flex flex-col">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">{subtitle}</p>}
      <div className="flex-1 min-h-[200px]">{children}</div>
    </div>
  );
}

/** Leave dashboard: pipeline donut, month outcomes bar, today by leave type, rolling 12-month decisions. */
export function LeaveInsightCharts({ leaveOverview }) {
  if (!leaveOverview) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Loading leave analytics…
      </div>
    );
  }

  const pipeline = leaveOverview.pipeline || {};
  const pieColors = [VIOLET, CYAN, AMBER];
  const pipelineData = ['pending_manager', 'pending_hod', 'pending_hr']
    .map((key, i) => ({
      name: PIPELINE_LABELS[key] || key,
      value: Number(pipeline[key] || 0),
      fill: pieColors[i % pieColors.length],
    }))
    .filter((d) => d.value > 0);
  const pipelineTotal = pipelineData.reduce((a, d) => a + d.value, 0);

  const monthData = [
    { name: 'Approved', count: Number(leaveOverview.approved_this_month ?? 0), fill: EMERALD },
    { name: 'Rejected', count: Number(leaveOverview.rejected_this_month ?? 0), fill: ROSE },
  ];
  const monthDecisionsSum = monthData.reduce((a, d) => a + d.count, 0);

  const detail = leaveOverview.on_leave_today_detail || [];
  const byType = detail.reduce((acc, r) => {
    const t = (r.leave_type_name || 'Other').trim() || 'Other';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const typeBar = Object.entries(byType)
    .map(([name, count]) => ({ name: name.length > 22 ? `${name.slice(0, 20)}…` : name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const typeTotal = typeBar.reduce((a, d) => a + d.count, 0);
  const typeColors = [VIOLET, CYAN, AMBER, EMERALD, SKY, ROSE, '#a855f7', '#14b8a6', '#eab308', SLATE];

  const monthlyRaw = leaveOverview.monthly_decisions || [];
  const monthlyChart = monthlyRaw.map((row) => ({
    ...row,
    approved: Number(row.approved ?? 0),
    rejected: Number(row.rejected ?? 0),
  }));

  const legendMutedStyle = { fontSize: 11, color: '#94a3b8' };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        {chartCard(
          'Pending pipeline',
          'Where open requests sit in the approval chain (hover for % of queue)',
          pipelineData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pipelineData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={3}
                  stroke="rgba(15,23,42,0.25)"
                  strokeWidth={1}
                  label={false}
                  isAnimationActive={false}
                >
                  {pipelineData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  {...CHART_TOOLTIP_DARK}
                  formatter={(value, name) => {
                    const v = Number(value);
                    const pct = pipelineTotal ? Math.round((v / pipelineTotal) * 1000) / 10 : 0;
                    return [`${v} requests (${pct}% of queue)`, name];
                  }}
                />
                <Legend
                  wrapperStyle={legendMutedStyle}
                  formatter={(value) => {
                    const item = pipelineData.find((d) => d.name === value);
                    const v = item?.value ?? 0;
                    const pct = pipelineTotal ? Math.round((v / pipelineTotal) * 1000) / 10 : 0;
                    return `${value} · ${pct}%`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center h-[200px]">
              No pending requests in the pipeline.
            </p>
          ),
        )}

        {chartCard(
          'This month - decisions',
          'Approved vs rejected (current calendar month); share of monthly total in tooltip',
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={36} />
              <Tooltip
                {...CHART_TOOLTIP_DARK}
                formatter={(value, _name, item) => {
                  const v = Number(value);
                  const pct = monthDecisionsSum ? Math.round((v / monthDecisionsSum) * 1000) / 10 : 0;
                  const label = item?.payload?.name ?? 'Requests';
                  return [`${v} (${pct}% of this month’s decisions)`, label];
                }}
              />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} name="Requests">
                {monthData.map((e) => (
                  <Cell key={e.name} fill={e.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>,
        )}

        {chartCard(
          'On leave today - by type',
          'Approved leave overlapping today; hover shows % of people out',
          typeBar.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart layout="vertical" data={typeBar} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip
                  {...CHART_TOOLTIP_DARK}
                  formatter={(value) => {
                    const v = Number(value);
                    const pct = typeTotal ? Math.round((v / typeTotal) * 1000) / 10 : 0;
                    return [`${v} people (${pct}% of those out today)`, ''];
                  }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} name="People">
                  {typeBar.map((_, i) => (
                    <Cell key={i} fill={typeColors[i % typeColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center h-[200px]">
              No one on approved leave today, or types not loaded.
            </p>
          ),
        )}
      </div>

      {chartCard(
        'Leave decisions by month',
        'Count of requests approved or rejected per month (by final decision date, last 12 months)',
        monthlyChart.some((r) => r.approved > 0 || r.rejected > 0) ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyChart} margin={{ top: 8, right: 8, left: 0, bottom: 36 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} angle={-30} textAnchor="end" height={48} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={36} />
              <Tooltip
                {...CHART_TOOLTIP_DARK}
                formatter={(value, name, item) => {
                  const v = Number(value);
                  const row = item?.payload;
                  const rowSum = row ? Number(row.approved ?? 0) + Number(row.rejected ?? 0) : 0;
                  const pct = rowSum ? Math.round((v / rowSum) * 1000) / 10 : 0;
                  return [`${v} (${pct}% of that month’s decisions)`, name];
                }}
              />
              <Legend wrapperStyle={legendMutedStyle} />
              <Bar dataKey="approved" fill={EMERALD} name="Approved" radius={[4, 4, 0, 0]} />
              <Bar dataKey="rejected" fill={ROSE} name="Rejected" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center min-h-[200px]">
            No approved or rejected decisions in the last 12 months yet.
          </p>
        ),
      )}
    </div>
  );
}

/** Today attendance mix (present / late / absent / no clock-out). */
export function AttendanceTodayDonut({ summary }) {
  const s = summary || {};
  const data = [
    { name: 'On time', value: Number(s.on_time ?? 0), fill: EMERALD },
    { name: 'Late', value: Number(s.late ?? 0), fill: AMBER },
    { name: 'Absent', value: Number(s.absent ?? 0), fill: ROSE },
    { name: 'No clock-out', value: Number(s.no_clock_out ?? 0), fill: SKY },
  ].filter((d) => d.value > 0);

  const total = data.reduce((a, d) => a + d.value, 0);
  const legendMutedStyle = { fontSize: 11, color: '#94a3b8' };

  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-gradient-to-br from-emerald-500/[0.07] via-white to-cyan-500/[0.06] dark:from-emerald-950/40 dark:via-slate-900/90 dark:to-cyan-950/30 p-5 shadow-soft-lg ring-1 ring-emerald-500/10 dark:ring-emerald-400/15">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Today&apos;s attendance mix</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-2">Share of staff in each status - legend shows % of everyone counted.</p>
      {!total ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center">No attendance data for today yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={68}
              outerRadius={96}
              paddingAngle={2}
              stroke="rgba(15,23,42,0.2)"
              strokeWidth={1}
              label={false}
              isAnimationActive={false}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              {...CHART_TOOLTIP_DARK}
              formatter={(v) => {
                const n = Number(v);
                const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
                return [`${n} (${pct}% of staff in chart)`, ''];
              }}
            />
            <Legend
              wrapperStyle={legendMutedStyle}
              formatter={(value) => {
                const item = data.find((d) => d.name === value);
                const n = item?.value ?? 0;
                const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
                return `${value} · ${pct}%`;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Gender split among active employees (recorded fields). */
export function GenderDonutChart({ genderCounts }) {
  const g = genderCounts || {};
  const data = [
    { name: 'Women', value: Number(g.female ?? 0), fill: '#ec4899' },
    { name: 'Men', value: Number(g.male ?? 0), fill: '#38bdf8' },
    {
      name: 'Other / unset',
      value: Number((g.other ?? 0) + (g.prefer_not_say ?? 0) + (g.unset ?? 0)),
      fill: SLATE,
    },
  ].filter((d) => d.value > 0);
  const total = data.reduce((a, d) => a + d.value, 0);
  const legendMutedStyle = { fontSize: 11, color: '#94a3b8' };

  if (!total) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">No gender data recorded for active employees.</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={56}
          outerRadius={82}
          paddingAngle={2}
          stroke="rgba(15,23,42,0.15)"
          strokeWidth={1}
          label={false}
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Pie>
        <Tooltip
          {...CHART_TOOLTIP_DARK}
          formatter={(v, name) => {
            const n = Number(v);
            const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
            return [`${n} (${pct}% of active records)`, name];
          }}
        />
        <Legend
          wrapperStyle={legendMutedStyle}
          formatter={(value) => {
            const item = data.find((d) => d.name === value);
            const n = item?.value ?? 0;
            const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
            return `${value} · ${pct}%`;
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
