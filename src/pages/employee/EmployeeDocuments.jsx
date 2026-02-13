import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';
import { ROUTES } from '../../utils/constants';

export function EmployeeDocuments() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState(null);

  useEffect(() => {
    api.getHrDocuments().then(setList).catch(() => setList([])).finally(() => setLoading(false));
  }, []);

  const openAndPrint = async (doc) => {
    setLoadingId(doc.id);
    try {
      const blob = await api.getHrDocumentFileBlob(doc.id);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank', 'noopener');
      if (w) {
        w.onload = () => {
          try {
            w.print();
          } finally {
            URL.revokeObjectURL(url);
          }
        };
      } else {
        URL.revokeObjectURL(url);
        toast('Please allow pop-ups to print', 'info');
      }
    } catch (err) {
      toast(err.message || 'Failed to open document', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDownload = async (doc) => {
    setLoadingId(doc.id);
    try {
      const blob = await api.getHrDocumentFileBlob(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.title || 'document';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message || 'Download failed', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Company Documents</h1>
        <Link to={ROUTES.EMPLOYEE.DASHBOARD} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Back to Dashboard</Link>
      </div>

      {!list.length ? (
        <EmptyState title="No documents" message="HR has not published any documents yet." />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Uploaded</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {list.map((d) => (
                <tr key={d.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-4 py-3 font-medium">{d.title}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{formatDateTime(d.created_at)}</td>
                  <td className="px-4 py-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(d)}
                      disabled={loadingId === d.id}
                      className="text-primary-600 dark:text-primary-400 hover:underline text-sm disabled:opacity-50"
                    >
                      {loadingId === d.id ? '…' : 'Download'}
                    </button>
                    <span className="text-gray-400">|</span>
                    <button
                      type="button"
                      onClick={() => openAndPrint(d)}
                      disabled={loadingId === d.id}
                      className="text-primary-600 dark:text-primary-400 hover:underline text-sm disabled:opacity-50"
                    >
                      {loadingId === d.id ? '…' : 'Open & Print'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
