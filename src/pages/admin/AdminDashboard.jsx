import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '../../services/api';
import { LoadingSpinner } from '../../components/LoadingSpinner';

export function AdminDashboard() {
  const [usersCount, setUsersCount] = useState(0);
  const [auditCount, setAuditCount] = useState(0);
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    api.getUsers().then((u) => setUsersCount(u.length)).catch(() => {});
    api.getAuditLogs(5).then((a) => setAuditCount(a.length)).catch(() => {});
  }, []);

  useEffect(() => {
    const days = 14;
    const promises = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      promises.push(d.toISOString().slice(0, 10));
    }
    setChartData(promises.map((date) => ({ date: date.slice(5), count: Math.floor(Math.random() * 20) + 5 })));
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total users</p>
          <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{usersCount}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Audit events (recent)</p>
          <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{auditCount}</p>
        </div>
      </div>
      {chartData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <h2 className="font-semibold text-gray-800 dark:text-white mb-4">Activity timeline (sample)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" stroke="#6b7280" />
              <YAxis stroke="#6b7280" />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}
