'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

interface Collaborator {
  id: string;
  email: string;
  name: string;
  role: 'viewer' | 'editor';
}

export default function ShareModal({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('editor');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/api/documents/${documentId}/permissions`)
      .then((res) => {
        setCollaborators(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load collaborators.');
        setLoading(false);
      });
  }, [documentId]);

  async function addCollaborator(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setAdding(true);
    try {
      const res = await api.post(`/api/documents/${documentId}/permissions`, { email, role });
      setCollaborators((prev) => {
        const without = prev.filter((c) => c.id !== res.data.id);
        return [...without, res.data].sort((a, b) => a.email.localeCompare(b.email));
      });
      setEmail('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ||
        'Could not add collaborator.';
      setError(msg);
    } finally {
      setAdding(false);
    }
  }

  async function removeCollaborator(userId: string) {
    const previous = collaborators;
    setCollaborators((prev) => prev.filter((c) => c.id !== userId));
    try {
      await api.delete(`/api/documents/${documentId}/permissions/${userId}`);
    } catch {
      setCollaborators(previous);
      setError('Could not remove collaborator.');
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Share document</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="mb-3 text-sm text-red-600 bg-red-50 p-2.5 rounded-lg">{error}</p>
        )}

        <form onSubmit={addCollaborator} className="flex gap-2 mb-5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="person@email.com"
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="submit"
            disabled={adding}
            className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
          >
            {adding ? '…' : 'Add'}
          </button>
        </form>

        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            People with access
          </p>
          {loading ? (
            <p className="text-sm text-gray-400 py-2">Loading…</p>
          ) : collaborators.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">
              Only you. Add someone by email above.
            </p>
          ) : (
            <ul className="space-y-1">
              {collaborators.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between py-2 px-1 border-b border-gray-100 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{c.name}</p>
                    <p className="text-xs text-gray-400 truncate">{c.email}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-500 capitalize">{c.role}</span>
                    <button
                      onClick={() => removeCollaborator(c.id)}
                      className="text-xs text-gray-300 hover:text-red-500 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
