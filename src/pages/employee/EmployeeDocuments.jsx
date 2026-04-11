import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
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
  const myId = useSelector((s) => s.auth.profile?.id);
  const [list, setList] = useState([]);
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState(null);
  const [certTitle, setCertTitle] = useState('');
  const [certFile, setCertFile] = useState(null);
  const [certUploading, setCertUploading] = useState(false);

  const refreshCertificates = () => {
    if (!myId) return;
    api
      .getStaffDocuments()
      .then((rows) => setCerts((rows || []).filter((x) => x.kind === 'employee_certificate')))
      .catch(() => setCerts([]));
  };

  useEffect(() => {
    if (!myId) {
      setList([]);
      setCerts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      api.getHrDocuments().catch(() => []),
      api
        .getStaffDocuments()
        .then((rows) => (rows || []).filter((x) => x.kind === 'employee_certificate'))
        .catch(() => []),
    ])
      .then(([d, c]) => {
        setList(d || []);
        setCerts(c || []);
      })
      .finally(() => setLoading(false));
  }, [myId]);

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

  /** Use stored file_path (id_originalname.ext) so download keeps correct filename and format. */
  const getDownloadFilename = (doc) => {
    const fp = doc.file_path;
    if (fp && fp.includes('_')) return fp.substring(fp.indexOf('_') + 1);
    if (fp) return fp;
    return doc.title || 'document';
  };

  const handleDownload = async (doc) => {
    setLoadingId(doc.id);
    try {
      const blob = await api.getHrDocumentFileBlob(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getDownloadFilename(doc);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message || 'Download failed', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const staffFilename = (doc) => {
    const fp = doc.file_path;
    if (fp && fp.includes('_')) return fp.substring(fp.indexOf('_') + 1);
    if (fp) return fp;
    return doc.title || 'file';
  };

  const downloadCert = async (doc) => {
    setLoadingId(doc.id);
    try {
      const blob = await api.getStaffDocumentFileBlob(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = staffFilename(doc);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message || 'Download failed', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const removeCert = async (doc) => {
    if (!window.confirm(`Remove "${doc.title}" from your profile?`)) return;
    try {
      await api.deleteStaffDocument(doc.id);
      toast('Certificate removed', 'success');
      refreshCertificates();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || 'Remove failed', 'error');
    }
  };

  const uploadCert = async (e) => {
    e.preventDefault();
    if (!myId) return;
    if (!certFile) {
      toast('Choose a file', 'error');
      return;
    }
    setCertUploading(true);
    try {
      await api.uploadStaffDocument(certFile, certTitle.trim() || certFile.name, 'employee_certificate', myId);
      toast('Certificate uploaded. HR and Admin were notified.', 'success');
      setCertTitle('');
      setCertFile(null);
      refreshCertificates();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || 'Upload failed', 'error');
    } finally {
      setCertUploading(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Documents</h1>
        <Link to={ROUTES.EMPLOYEE.DASHBOARD} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Back to Dashboard</Link>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Company documents &amp; policy</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Published by HR for all staff.</p>
        {!list.length ? (
          <EmptyState title="No company documents" message="HR has not published any documents yet." />
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
      </section>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">My certificates</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Upload diplomas, licences, or training certificates. HR and Admin receive an in-app alert and email (when outgoing mail is configured).
        </p>
        <form onSubmit={uploadCert} className="flex flex-col sm:flex-row flex-wrap gap-3 items-end mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 min-w-[200px] w-full">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Title</label>
            <input
              value={certTitle}
              onChange={(e) => setCertTitle(e.target.value)}
              placeholder="e.g. PMP certificate"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <div className="flex-1 min-w-[200px] w-full">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">File</label>
            <input
              type="file"
              onChange={(e) => setCertFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-600 dark:text-gray-300"
            />
          </div>
          <button
            type="submit"
            disabled={certUploading}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {certUploading ? 'Uploading…' : 'Upload certificate'}
          </button>
        </form>
        {!certs.length ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">You have not uploaded any certificates yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {certs.map((d) => (
              <li key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{d.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(d.created_at)}</p>
                </div>
                <div className="flex gap-3 text-sm">
                  <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline" onClick={() => downloadCert(d)} disabled={loadingId === d.id}>
                    {loadingId === d.id ? '…' : 'Download'}
                  </button>
                  <button type="button" className="text-red-600 dark:text-red-400 hover:underline" onClick={() => removeCert(d)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </motion.div>
  );
}
