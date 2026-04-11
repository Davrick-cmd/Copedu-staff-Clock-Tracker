import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { ROLES } from '../../utils/constants';
import { DashboardPageHeader } from '../../components/dashboard/DashboardWidgets';
import { OrganizationOverview } from '../../components/dashboard/OrganizationOverview';
import { DashboardSwitcher } from '../../components/dashboard/DashboardSwitcher';

export function HROrganizationDashboard() {
  const role = useSelector((s) => s.auth.profile?.role);
  const dashboardSwitcherMode = role === ROLES.ADMIN ? 'admin' : 'hr';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getOrganizationOverview()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-8">
      <div className="space-y-4">
        <DashboardPageHeader
          badge="Dashboard"
          title="Organization dashboard"
          subtitle="Headcount, women and men, age distribution (when date of birth is recorded), active vs former staff, and where people sit in the org."
        />
        <DashboardSwitcher mode={dashboardSwitcherMode} active="organization" />
      </div>

      <OrganizationOverview data={data} loading={loading} compactTitle />
    </motion.div>
  );
}
