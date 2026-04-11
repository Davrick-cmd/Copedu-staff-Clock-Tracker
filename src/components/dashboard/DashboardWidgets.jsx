import { Link } from 'react-router-dom';

export function DashboardPageHeader({ title, subtitle, badge }) {
  return (
    <div className="mb-8 pb-8 border-b border-slate-200/80 dark:border-slate-800/80">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          {badge && (
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400 mb-2">{badge}</p>
          )}
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-2xl text-base leading-relaxed">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

export function QuickLinkCard({ to, title, description, emoji, accent = 'primary' }) {
  const accents = {
    primary: 'hover:border-primary-300 dark:hover:border-primary-600 group-hover:text-primary-600 dark:group-hover:text-primary-400',
    emerald: 'hover:border-emerald-300 dark:hover:border-emerald-700 group-hover:text-emerald-700 dark:group-hover:text-emerald-400',
    amber: 'hover:border-amber-300 dark:hover:border-amber-700 group-hover:text-amber-700 dark:group-hover:text-amber-400',
    violet: 'hover:border-violet-300 dark:hover:border-violet-700 group-hover:text-violet-700 dark:group-hover:text-violet-400',
    slate: 'hover:border-slate-400 dark:hover:border-slate-500',
  };
  const ac = accents[accent] || accents.primary;
  return (
    <Link
      to={to}
      className={`group flex flex-col rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70 backdrop-blur-sm p-5 shadow-soft hover:shadow-soft-lg hover:-translate-y-0.5 transition-all duration-200 ${ac}`}
    >
      <span className="text-2xl mb-3 drop-shadow-sm" aria-hidden>
        {emoji}
      </span>
      <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-snug">{description}</p>
      <span className="mt-3 text-xs font-semibold text-primary-600 dark:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity">
        Open →
      </span>
    </Link>
  );
}

export function QuickLinksSection({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-gradient-to-br from-white/95 via-slate-50/50 to-white dark:from-slate-900/80 dark:via-slate-900/40 dark:to-slate-950/60 p-6 md:p-8 shadow-soft">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
      {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6 max-w-3xl leading-relaxed">{description}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint, variant = 'default' }) {
  const variants = {
    default: 'border-slate-200/90 dark:border-slate-700/90 bg-white/90 dark:bg-slate-900/70',
    green: 'border-emerald-200/90 dark:border-emerald-800/40 bg-emerald-50/80 dark:bg-emerald-950/25',
    amber: 'border-amber-200/90 dark:border-amber-800/40 bg-amber-50/80 dark:bg-amber-950/25',
    red: 'border-red-200/90 dark:border-red-900/40 bg-red-50/80 dark:bg-red-950/20',
    blue: 'border-blue-200/90 dark:border-blue-900/40 bg-blue-50/80 dark:bg-blue-950/25',
  };
  return (
    <div className={`rounded-2xl border p-5 shadow-soft ${variants[variant] || variants.default}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">{hint}</p>}
    </div>
  );
}
