import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

export function HRDocuments() {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');

  const fetchList = () => {
    api.getHrDocuments().then(setList).catch(() => setList([])).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchList();
  }, []);

  const handleUpload = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast('Please select a file', 'error');
      return;
    }
    setUploading(true);
    try {
      await api.uploadHrDocument(file, uploadTitle || file.name);
      toast('Document uploaded successfully', 'success');
      setUploadTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchList();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
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
    }
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">HR Documents</h1>

      <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl shadow">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
          <input
            type="text"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="Document title"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">File</label>
          <input
            ref={fileInputRef}
            type="file"
            className="w-full text-sm text-gray-600 dark:text-gray-400 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-primary-100 file:text-primary-700 dark:file:bg-primary-900/30 dark:file:text-primary-300"
          />
        </div>
        <button type="submit" disabled={uploading} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
      </form>

      {!list.length ? (
        <EmptyState title="No documents" message="Upload HR documents above. Files are stored on this server." />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Title</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Uploaded</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">By</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {list.map((d) => (
                <tr key={d.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-4 py-2">{d.title}</td>
                  <td className="px-4 py-2">{formatDateTime(d.created_at)}</td>
                  <td className="px-4 py-2">{d.users?.full_name || '-'}</td>
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => handleDownload(d)} className="text-primary-600 dark:text-primary-400 hover:underline text-sm">Download</button>
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
