import { useEffect, useMemo, useState } from 'react';
import * as api from '../../services/api';
import { useToast } from '../../hooks/useToast';

function toCsvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function HRLeaveBalances() {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getLeaveBalances({ year });
      setRows(data?.rows || []);
    } catch {
      toast('Failed to load leave balances', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [year]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.department || '').toLowerCase().includes(q) ||
      (r.leave_name || '').toLowerCase().includes(q)
    ));
  }, [rows, query]);

  const exportCsv = () => {
    const headers = ['Employee', 'Email', 'Department', 'Leave Type', 'Allocated Days', 'Used Days', 'Remaining Days'];
    const body = filtered.map((r) => [
      r.full_name,
      r.email,
      r.department,
      r.leave_name,
      r.allocated_days,
      r.used_days,
      r.remaining_days,
    ]);
    const csv = [headers.join(','), ...body.map((line) => line.map(toCsvCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-balances-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Leave balances CSV downloaded', 'success');
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Leave Balances</h1>
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="number"
          min="2020"
          max="2035"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 w-28 text-gray-900 dark:text-white"
        />
        <input
          type="search"
          placeholder="Search employee, email, department, leave type..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 w-full max-w-lg text-gray-900 dark:text-white"
        />
        <button type="button" onClick={exportCsv} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
          Export CSV
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Employee</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Department</th>
              <th className="px-4 py-2 text-left text-xs uppercase text-gray-500 dark:text-gray-300">Leave Type</th>
              <th className="px-4 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Allocated</th>
              <th className="px-4 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Used</th>
              <th className="px-4 py-2 text-right text-xs uppercase text-gray-500 dark:text-gray-300">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {!loading && filtered.map((r, i) => (
              <tr key={`${r.user_id}-${r.leave_name}-${i}`} className="text-sm text-gray-700 dark:text-gray-300">
                <td className="px-4 py-2">
                  <div className="font-medium">{r.full_name || '-'}</div>
                  <div className="text-xs text-gray-500">{r.email || '-'}</div>
                </td>
                <td className="px-4 py-2">{r.department || '-'}</td>
                <td className="px-4 py-2">{r.leave_name || '-'}</td>
                <td className="px-4 py-2 text-right">{r.allocated_days ?? 0}</td>
                <td className="px-4 py-2 text-right">{r.used_days ?? 0}</td>
                <td className="px-4 py-2 text-right">{r.remaining_days ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
