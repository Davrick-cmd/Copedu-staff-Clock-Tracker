import { Outlet, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

/**
 * Shell for routes that require the user to be logged out (currently `/login`).
 * When `auth.user` is set, we immediately redirect home so dashboard routes never flash behind login.
 */
export function AuthLayout() {
  const user = useSelector((s) => s.auth.user);
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="min-h-screen relative overflow-x-hidden bg-slate-950 text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_20%_-10%,rgba(59,130,246,0.35),transparent),radial-gradient(ellipse_90%_60%_at_100%_0%,rgba(139,92,246,0.22),transparent),radial-gradient(ellipse_70%_50%_at_50%_100%,rgba(14,165,233,0.12),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(15,23,42,0.85))]" aria-hidden />
      <div className="relative z-10 min-h-screen flex items-stretch justify-center px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
        <div className="w-full max-w-6xl flex flex-col justify-center">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
