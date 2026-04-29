/**
 * LoginPage — unauthenticated sign-in for the HR suite.
 *
 * Flow:
 * 1. User enters identifier + password; react-hook-form validates required fields.
 * 2. On submit, Redux `login` thunk calls the API; errors surface via `auth.error`.
 * 3. AuthLayout redirects to "/" when `auth.user` exists, so this page only renders for guests.
 *
 * Card logo URL: `APP_LOGO_SRC` in `utils/constants` (Vite `public/images/`). HR footer: `HR_SUPPORT_EMAIL`.
 */
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { login, clearError } from '../store/slices/authSlice';
import { APP_DISPLAY_NAME, APP_FORMAL_NAME, APP_LOGO_SRC, HR_SUPPORT_EMAIL } from '../utils/constants';

/** Small marketing tile on the left column; purely presentational. */
function FeatureCard({ icon, title, description, delay, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className={`h-full rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-md p-4 shadow-lg hover:border-white/15 hover:bg-white/[0.07] transition-colors ${className}`}
    >
      <div className="flex gap-3 h-full">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/30 to-violet-500/20 border border-white/10 flex items-center justify-center text-lg">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white tracking-tight">{title}</h3>
          <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">{description}</p>
        </div>
      </div>
    </motion.div>
  );
}

/** Logo on the sign-in card only (left column stays text-only). */
function LoginCardLogo({ className = '' }) {
  return (
    <img
      src={APP_LOGO_SRC}
      alt="Company logo"
      width={320}
      height={128}
      decoding="async"
      className={`object-contain rounded-2xl bg-white p-3 sm:p-4 shadow-2xl ring-2 ring-white/40 ${className}`}
    />
  );
}

export function LoginPage() {
  const dispatch = useDispatch();
  const { loading, error } = useSelector((s) => s.auth);
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  // Clear stale auth error when mounting or revisiting login (e.g. after logout).
  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  const onSubmit = (data) => {
    dispatch(login({ identifier: data.identifier, password: data.password }));
  };

  return (
    <div className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-center">
      {/* --- Left: product story (hidden below hero on small screens via order) --- */}
      <div className="lg:col-span-5 space-y-6 lg:space-y-7 order-2 lg:order-1">
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45 }}>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight">
            <span className="bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">{APP_FORMAL_NAME}</span>
          </h1>
          <p className="mt-5 text-sm sm:text-base text-slate-300 leading-relaxed max-w-md">
            One secure workspace for your workforce: attendance and leave, employee records, HR documents, performance
            and KPIs, recognition, and announcements — for HR, managers, and staff.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <FeatureCard
            delay={0.08}
            icon="🏖️"
            title="Leave management"
            description="Requests, approvals, balances, calendars, and organization-wide coverage."
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
            description="Handbooks, forms, and policies published by HR in one trusted library."
          />
          <FeatureCard
            delay={0.2}
            icon="🕐"
            title="Attendance"
            description="Clock in/out, dashboards, trends, and reports your teams rely on."
          />
          <FeatureCard
            delay={0.24}
            icon="📈"
            title="Performance & KPIs"
            description="Appraisal cycles, manager and HR reviews, and structured goal visibility."
            className="hidden xl:block"
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
            description="Peer recognition with @mentions, likes, and comments, plus org-wide notices."
            className="hidden xl:block"
          />
        </div>
      </div>

      {/* --- Right: sign-in card (shown first on mobile for faster access) --- */}
      <div className="lg:col-span-7 order-1 lg:order-2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="mx-auto w-full max-w-md lg:max-w-lg rounded-3xl border border-white/10 bg-slate-900/75 backdrop-blur-xl shadow-2xl shadow-black/40 ring-1 ring-white/5 px-6 py-7 sm:px-8 sm:py-9"
        >
          <div className="text-center mb-8">
            <LoginCardLogo className="mx-auto h-24 sm:h-28 w-auto max-w-[min(100%,17rem)] mb-5" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-300 mb-2">Welcome</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{APP_DISPLAY_NAME}</h2>
            <p className="mt-2 text-sm text-slate-300 font-medium">{APP_FORMAL_NAME}</p>
          </div>

          <div className="border-t border-white/10 pt-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-5">Credentials</p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label htmlFor="identifier" className="block text-sm font-medium text-slate-200 mb-1.5">
                  Email or login name
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter email or username"
                  {...register('identifier', { required: 'Email or username is required' })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-slate-950/80 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/60 transition-shadow outline-none"
                />
                {errors.identifier && <p className="mt-1.5 text-sm text-red-400">{errors.identifier.message}</p>}
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-200 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    {...register('password', { required: 'Password is required' })}
                    className="w-full px-4 py-3 pr-20 rounded-xl border border-white/10 bg-slate-950/80 text-white focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/60 transition-shadow outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-2 my-auto h-8 rounded-md border border-white/20 bg-white/10 px-2 text-xs font-semibold text-white hover:bg-white/20"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {errors.password && <p className="mt-1.5 text-sm text-red-400">{errors.password.message}</p>}
              </div>
              {error && (
                <p className="text-sm text-red-300 rounded-lg bg-red-950/50 border border-red-800/60 px-3 py-2" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 text-white font-semibold hover:from-primary-500 hover:to-primary-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-900/30 transition-all"
              >
                {loading ? 'Signing in…' : 'Sign in to suite'}
              </button>
            </form>
          </div>

          <p className="mt-8 text-center text-sm text-slate-300 leading-relaxed">
            Need help signing in or using the suite?{' '}
            <a
              href={`mailto:${HR_SUPPORT_EMAIL}`}
              className="text-primary-300 hover:text-primary-200 font-semibold underline-offset-2 hover:underline"
            >
              {HR_SUPPORT_EMAIL}
            </a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
