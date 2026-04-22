import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ROUTES } from '../../utils/constants';
import { DashboardPageHeader } from '../../components/dashboard/DashboardWidgets';

const cards = [
  {
    to: ROUTES.HR.REPORTS_ATTENDANCE,
    title: 'Attendance reports',
    description: 'Daily snapshot, monthly trends, raw clock data — CSV, XLSX, and print.',
    emoji: '🕐',
    accent: 'from-sky-50/95 to-white dark:from-sky-950/35 dark:to-slate-900/80 border-sky-200/80 dark:border-sky-800/80',
  },
  {
    to: ROUTES.HR.REPORTS_LEAVE,
    title: 'Leave reports',
    description: 'Period analytics, on-leave lists, balances by year — exports and print.',
    emoji: '🏖️',
    accent: 'from-emerald-50/95 to-white dark:from-emerald-950/30 dark:to-slate-900/80 border-emerald-200/80 dark:border-emerald-900/50',
  },
  {
    to: ROUTES.HR.REPORTS_RECOGNITION,
    title: 'Recognition reports',
    description: 'Peer recognition volume, types, and recent activity.',
    emoji: '⭐',
    accent: 'from-amber-50/95 to-white dark:from-amber-950/25 dark:to-slate-900/80 border-amber-200/80 dark:border-amber-900/40',
  },
  {
    to: ROUTES.HR.REPORTS_PERFORMANCE,
    title: 'Performance & appraisal',
    description: 'Who submitted KPIs, supervisor review, HR approval, and appraisal form status by cycle.',
    emoji: '📋',
    accent: 'from-violet-50/95 to-white dark:from-violet-950/30 dark:to-slate-900/80 border-violet-200/80 dark:border-violet-900/45',
  },
  {
    to: ROUTES.HR.REPORTS_ORGANIZATION,
    title: 'Organization report',
    description: 'Whole-organization headcount, gender, age bands, departments, branches, demographics CSV, and print.',
    emoji: '🏢',
    accent: 'from-indigo-50/95 to-white dark:from-indigo-950/35 dark:to-slate-900/80 border-indigo-200/80 dark:border-indigo-900/45',
  },
];

/**
 * Central entry for HR/Admin reporting. Module-specific exports live on scoped routes
 * so the sidebar and this page stay easy to scan.
 */
export function HRReportsHub() {
  const [searchParams] = useSearchParams();
  const mode = (searchParams.get('mode') || '').toLowerCase();
  if (mode === 'leave') return <Navigate to={ROUTES.HR.REPORTS_LEAVE} replace />;
  if (mode === 'recognition') return <Navigate to={ROUTES.HR.REPORTS_RECOGNITION} replace />;
  if (mode === 'daily' || mode === 'monthly' || mode === 'raw') {
    return <Navigate to={ROUTES.HR.REPORTS_ATTENDANCE} replace />;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-10">
      <DashboardPageHeader
        badge="Reports"
        title="Reports hub"
        subtitle="Choose a module: attendance, leave, recognition, performance, or the organization-wide workforce report. The interactive charts dashboard is still under Organization in the sidebar."
      />

      <div className="grid gap-5 md:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className={`group rounded-2xl border bg-gradient-to-br p-6 shadow-soft transition-all hover:shadow-soft-lg ${c.accent}`}
          >
            <span className="text-3xl" aria-hidden>
              {c.emoji}
            </span>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-3 group-hover:text-primary-700 dark:group-hover:text-primary-300">
              {c.title}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">{c.description}</p>
            <span className="inline-block mt-4 text-sm font-semibold text-primary-600 dark:text-primary-400">Open →</span>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 p-6 shadow-soft">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide">Workforce & demographics</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
          For exports and print in a report layout, use <strong className="text-slate-800 dark:text-slate-200">Organization report</strong> above. For charts and the full dashboard experience, open the organization workspace.
        </p>
        <div className="flex flex-wrap gap-4 mt-4">
          <Link to={ROUTES.HR.REPORTS_ORGANIZATION} className="text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline">
            Organization report →
          </Link>
          <Link to={ROUTES.HR.ORGANIZATION} className="text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline">
            Organization dashboard →
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
