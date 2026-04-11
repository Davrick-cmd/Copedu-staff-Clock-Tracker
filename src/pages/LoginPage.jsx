import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { login, clearError } from '../store/slices/authSlice';
import { APP_DISPLAY_NAME, APP_FORMAL_NAME } from '../utils/constants';

function FeatureCard({ icon, title, description, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="h-full rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 shadow-lg hover:border-white/15 hover:bg-white/[0.06] transition-colors"
    >
      <div className="flex gap-3 h-full">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/30 to-violet-500/20 border border-white/10 flex items-center justify-center text-lg">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white tracking-tight">{title}</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </motion.div>
  );
}

export function LoginPage() {
  const dispatch = useDispatch();
  const { loading, error } = useSelector((s) => s.auth);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  const onSubmit = (data) => {
    dispatch(login({ identifier: data.identifier, password: data.password }));
  };

  return (
    <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
      {/* Marketing / enterprise column */}
      <div className="lg:col-span-5 space-y-8 order-2 lg:order-1">
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45 }}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-300/90 mb-3">Enterprise HCM</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight">
            <span className="bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">{APP_FORMAL_NAME}</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-slate-400 leading-relaxed max-w-md">
            One secure workspace for your workforce, from daily attendance and leave workflows to employee records,
            HR documents and policy, performance cycles, recognition, announcements, and KPI visibility for HR, managers, and staff.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <FeatureCard
            delay={0.08}
            icon="🏖️"
            title="Leave management"
            description="Requests, multi-step approvals, balances, calendars, and organization-wide coverage."
          />
          <FeatureCard
            delay={0.12}
            icon="👥"
            title="Employee records"
            description="Profiles, departments, reporting lines, and data that feeds every HR process."
          />
          <FeatureCard
            delay={0.16}
            icon="📄"
            title="HR documents and policy"
            description="Handbooks, forms, and policies published by HR so staff can open trusted files in one library."
          />
          <FeatureCard
            delay={0.2}
            icon="🕐"
            title="Attendance"
            description="Clock in/out, live dashboards, trends, and operational reports your teams rely on."
          />
          <FeatureCard
            delay={0.24}
            icon="📈"
            title="Performance & KPIs"
            description="Appraisal cycles, manager and HR reviews, and structured visibility on goals and outcomes."
          />
          <FeatureCard
            delay={0.28}
            icon={
              <span className="flex items-center justify-center gap-0.5 text-[15px] leading-none" aria-hidden>
                <span>🏆</span>
                <span className="text-[13px] opacity-90">🔔</span>
              </span>
            }
            title="Recognition & announcements"
            description="Peer recognition with @ mentions, likes, and comments, plus org-wide announcements, urgent notices, and deadlines."
          />
        </div>
      </div>

      {/* Sign-in card */}
      <div className="lg:col-span-7 order-1 lg:order-2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="mx-auto w-full max-w-md lg:max-w-lg rounded-3xl border border-white/10 bg-slate-900/70 backdrop-blur-xl shadow-2xl shadow-black/40 ring-1 ring-white/5 p-8 sm:p-10"
        >
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-400 mb-2">Welcome</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{APP_DISPLAY_NAME}</h2>
            <p className="mt-2 text-sm text-slate-400 font-medium">{APP_FORMAL_NAME}</p>
          </div>

          <div className="border-t border-white/10 pt-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 mb-5">Credentials</p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label htmlFor="identifier" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Email or AD username
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="you@company.com or AD username"
                  {...register('identifier', { required: 'Email or username is required' })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-slate-950/80 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/60 transition-shadow outline-none"
                />
                {errors.identifier && <p className="mt-1.5 text-sm text-red-400">{errors.identifier.message}</p>}
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...register('password', { required: 'Password is required' })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-slate-950/80 text-white focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/60 transition-shadow outline-none"
                />
                {errors.password && <p className="mt-1.5 text-sm text-red-400">{errors.password.message}</p>}
              </div>
              {error && <p className="text-sm text-red-400 rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 text-white font-semibold hover:from-primary-500 hover:to-primary-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-900/30 transition-all"
              >
                {loading ? 'Signing in…' : 'Sign in to suite'}
              </button>
            </form>
          </div>

          <p className="mt-8 text-center text-[11px] text-slate-500 leading-relaxed">
            Role-based access · sessions secured with your organization&apos;s policies
          </p>
        </motion.div>
      </div>
    </div>
  );
}
