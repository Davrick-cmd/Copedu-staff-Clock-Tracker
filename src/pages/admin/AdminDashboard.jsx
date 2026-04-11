import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { ROUTES } from '../../utils/constants';
import {
  DashboardPageHeader,
  QuickLinkCard,
  QuickLinksSection,
  StatTile,
} from '../../components/dashboard/DashboardWidgets';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';

export function AdminDashboard() {
  const [usersCount, setUsersCount] = useState(0);
  const [auditCount, setAuditCount] = useState(0);
  const [myLeaveInbox, setMyLeaveInbox] = useState(null);

  useEffect(() => {
    api.getUsers().then((u) => setUsersCount(u.length)).catch(() => {});
    api.getAuditLogs(5).then((a) => setAuditCount(a.length)).catch(() => {});
    api.getLeaveMyDashboard().then(setMyLeaveInbox).catch(() => setMyLeaveInbox(null));
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-8">
      <div className="space-y-4">
        <DashboardPageHeader
          badge="Administration"
          title="Admin dashboard"
          subtitle="Accounts, branches, audit, and settings. HR analytics and attendance charts live on the HR dashboards."
        />
        <DashboardSwitcher mode="admin" active="admin" />
      </div>

      {myLeaveInbox && myLeaveInbox.approval_queue_count > 0 && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-amber-950 dark:text-amber-100">
            <span className="font-bold tabular-nums">{myLeaveInbox.approval_queue_count}</span> leave request
            {myLeaveInbox.approval_queue_count === 1 ? '' : 's'} waiting on <strong>you</strong> as supervisor.
          </p>
          <Link
            to={ROUTES.HR.LEAVE}
            className="inline-flex justify-center px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shrink-0"
          >
            Open leave approvals
          </Link>
        </div>
      )}

      <QuickLinksSection
        title="Quick access"
        description="Everything here is system administration. Use HR overview for people analytics, leave, and attendance."
      >
        <QuickLinkCard
          to={ROUTES.ADMIN.USERS}
          emoji="👤"
          title="Employee records"
          description="Create accounts, assign roles, and capture HR profile fields."
          accent="primary"
        />
        <QuickLinkCard
          to={ROUTES.ADMIN.BRANCHES}
          emoji="🏢"
          title="Branches"
          description="Locations used in attendance and reporting filters."
          accent="slate"
        />
        <QuickLinkCard
          to={ROUTES.ADMIN.AUDIT}
          emoji="📋"
          title="Audit log"
          description="Recent security and configuration events."
          accent="violet"
        />
        <QuickLinkCard
          to={ROUTES.ADMIN.SETTINGS}
          emoji="⚙️"
          title="Settings"
          description="SMTP, app options, and environment-related controls."
          accent="amber"
        />
        <QuickLinkCard
          to={ROUTES.HR.DASHBOARD}
          emoji="📈"
          title="HR overview"
          description="Organization snapshot, attendance summary, leave tiles, and links to dedicated dashboards."
          accent="emerald"
        />
        <QuickLinkCard
          to={ROUTES.HR.REPORTS}
          emoji="📊"
          title="Reports hub"
          description="Exports and printable reports when you need raw files."
          accent="primary"
        />
      </QuickLinksSection>

      <section className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Registered users" value={usersCount} hint="People who can sign in to the suite." variant="default" />
        <StatTile
          label="Recent audit entries"
          value={auditCount}
          hint="Last few events pulled for this tile; open Audit for the full list."
          variant="blue"
        />
      </section>
    </motion.div>
  );
}
