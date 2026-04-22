import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { ROUTES } from '../../utils/constants';
import {
  DashboardPageHeader,
  QuickLinkCard,
  QuickLinksSection,
  StatTile,
} from '../../components/dashboard/DashboardWidgets';

export function AdminDashboard() {
  const [usersCount, setUsersCount] = useState(0);
  const [auditCount, setAuditCount] = useState(0);

  useEffect(() => {
    api.getUsers().then((u) => setUsersCount(u.length)).catch(() => {});
    api.getAuditLogs(5).then((a) => setAuditCount(a.length)).catch(() => {});
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-8">
      <div className="space-y-4">
        <DashboardPageHeader
          badge="Administration"
          title="Admin dashboard"
          subtitle="Accounts, branches, audit, and settings. HR analytics and attendance charts live on the HR dashboards."
        />
      </div>

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
