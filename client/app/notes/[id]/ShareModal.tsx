'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import type { Collaborator } from '@/lib/types';

export default function ShareModal({
  noteId,
  onClose,
}: {
  noteId: string;
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
      .get(`/api/notes/${noteId}/permissions`)
      .then((res) => setCollaborators(res.data))
      .catch((err) => setError(err?.response?.data?.error || 'Could not load collaborators.'))
      .finally(() => setLoading(false));
  }, [noteId]);

  // Escape closes the dialog — expected of anything modal, and the only way
  // out for someone not using a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function addCollaborator(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setAdding(true);
    try {
      const res = await api.post(`/api/notes/${noteId}/permissions`, { email, role });
      setCollaborators((prev) =>
        [...prev.filter((c) => c.id !== res.data.id), res.data].sort((a, b) =>
          a.email.localeCompare(b.email)
        )
      );
      setEmail('');
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ||
          'Could not add collaborator.'
      );
    } finally {
      setAdding(false);
    }
  }

  async function changeRole(person: Collaborator, next: 'viewer' | 'editor') {
    const previous = collaborators;
    setCollaborators((prev) =>
      prev.map((c) => (c.id === person.id ? { ...c, role: next } : c))
    );
    try {
      // Re-posting the same email is how a role changes: the server upserts on
      // (note_id, user_id), so there is no separate update endpoint to keep in
      // sync with this one.
      await api.post(`/api/notes/${noteId}/permissions`, { email: person.email, role: next });
    } catch {
      setCollaborators(previous);
      setError('Could not change that role.');
    }
  }

  async function removeCollaborator(userId: string) {
    const previous = collaborators;
    setCollaborators((prev) => prev.filter((c) => c.id !== userId));
    try {
      await api.delete(`/api/notes/${noteId}/permissions/${userId}`);
    } catch {
      setCollaborators(previous);
      setError('Could not remove collaborator.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share this note"
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
            Share this note
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-600 dark:bg-rose-950 dark:text-rose-300">
            {error}
          </p>
        )}

        <form onSubmit={addCollaborator} className="mb-5 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="classmate@school.edu"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="submit"
            disabled={adding}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {adding ? '…' : 'Add'}
          </button>
        </form>

        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          People with access
        </p>

        {loading ? (
          <p className="py-2 text-sm text-neutral-400">Loading…</p>
        ) : collaborators.length === 0 ? (
          <p className="py-2 text-sm text-neutral-400">
            Only you. Add a classmate by email above.
          </p>
        ) : (
          <ul className="space-y-1">
            {collaborators.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-3 border-b border-neutral-100 px-1 py-2 last:border-0 dark:border-neutral-800"
              >
                <Avatar name={person.name} color={person.avatar_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-800 dark:text-neutral-200">
                    {person.name}
                  </p>
                  <p className="truncate text-xs text-neutral-400">{person.email}</p>
                </div>
                <select
                  value={person.role}
                  onChange={(e) => changeRole(person, e.target.value as 'viewer' | 'editor')}
                  className="shrink-0 rounded border border-neutral-200 bg-transparent px-1.5 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={() => removeCollaborator(person.id)}
                  className="shrink-0 text-xs text-neutral-300 transition-colors hover:text-rose-500"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs leading-relaxed text-neutral-400">
          Editors can write and rename. Viewers can read and react — the server
          enforces this on both the API and the live connection.
        </p>
      </div>
    </div>
  );
}
