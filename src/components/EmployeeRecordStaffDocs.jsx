import { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';
import { useToast } from '../hooks/useToast';

/**
 * HR/Admin: confidential per-staff files + view employee-uploaded certificates (same API as employee Documents).
 */
export function EmployeeRecordStaffDocs({ userId, onChanged }) {
  const toast = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    api
      .getStaffDocuments(userId)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const download = async (doc) => {
    try {
      const blob = await api.getStaffDocumentFileBlob(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fp = doc.file_path || '';
      a.download = fp.includes('_') ? fp.substring(fp.indexOf('_') + 1) : doc.title || 'file';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e.message || 'Download failed', 'error');
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Remove "${doc.title}" from this employee record?`)) return;
    try {
      await api.deleteStaffDocument(doc.id);
      toast('Document removed', 'success');
      load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.detail || e.message || 'Delete failed', 'error');
    }
  };

  const upload = async (e) => {
    e.preventDefault();
    if (!file) {
      toast('Choose a file', 'error');
      return;
    }
    setUploading(true);
    try {
      await api.uploadStaffDocument(file, title.trim() || file.name, 'hr_confidential', userId);
      toast('Confidential document uploaded', 'success');
      setTitle('');
      setFile(null);
      load();
      onChanged?.();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const confidential = docs.filter((d) => d.kind === 'hr_confidential');
  const certificates = docs.filter((d) => d.kind === 'employee_certificate');

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 p-3 space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Staff file cabinet (HR / Admin only)</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          Confidential uploads are not visible to the employee. Certificates appear when the employee uploads them from Documents.
        </p>
      </div>

      <form onSubmit={upload} className="space-y-2 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-2">
        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Upload confidential document</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. contract amendment)"
          className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        />
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-xs text-gray-600 dark:text-gray-300" />
        <button
          type="submit"
          disabled={uploading}
          className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-medium disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {loading ? (
        <p className="text-xs text-slate-500">Loading documents…</p>
      ) : (
        <>
          <div>
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Confidential</p>
            {!confidential.length ? (
              <p className="text-xs text-slate-500">None on file.</p>
            ) : (
              <ul className="space-y-1">
                {confidential.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white dark:bg-gray-800 rounded px-2 py-1.5 border border-gray-200 dark:border-gray-700">
                    <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{d.title}</span>
                    <span className="flex gap-2 shrink-0">
                      <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline" onClick={() => download(d)}>
                        Download
                      </button>
                      <button type="button" className="text-red-600 dark:text-red-400 hover:underline" onClick={() => remove(d)}>
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Employee certificates</p>
            {!certificates.length ? (
              <p className="text-xs text-slate-500">None uploaded by the employee yet.</p>
            ) : (
              <ul className="space-y-1">
                {certificates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white dark:bg-gray-800 rounded px-2 py-1.5 border border-gray-200 dark:border-gray-700">
                    <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{d.title}</span>
                    <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline shrink-0" onClick={() => download(d)}>
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
