'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { isLoggedIn, getUser, clearLocalUser, logout } from '@/lib/auth';

interface Document {
  id: string;
  title: string;
  updated_at: string;
  owner_id: string;
}

export default function DocumentsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const user = getUser();

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    api
      .get('/api/documents')
      .then((res) => {
        setDocs(res.data);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.response?.status === 401) {
          clearLocalUser();
          router.replace('/login');
        } else {
          setError('Could not load your documents. Please refresh to try again.');
          setLoading(false);
        }
      });
  }, [router]);

  async function createDocument() {
    setCreating(true);
    try {
      const res = await api.post('/api/documents', { title: 'Untitled' });
      router.push(`/documents/${res.data.id}`);
    } catch {
      setError('Could not create a document. Please try again.');
      setCreating(false);
    }
  }

  async function deleteDocument(id: string) {
    const previous = docs;
    setDocs((prev) => prev.filter((d) => d.id !== id)); // optimistic
    try {
      await api.delete(`/api/documents/${id}`);
    } catch {
      setDocs(previous); // roll back on failure
      setError('Could not delete that document.');
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">My Documents</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user?.name}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>
        )}

        <div className="flex justify-end mb-6">
          <button
            onClick={createDocument}
            disabled={creating}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating…' : '+ New Document'}
          </button>
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg mb-2">No documents yet</p>
            <p className="text-sm">Click &ldquo;+ New Document&rdquo; to get started</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="bg-white border border-gray-200 rounded-lg px-5 py-4 flex items-center justify-between hover:border-blue-300 transition-colors group"
              >
                <Link
                  href={`/documents/${doc.id}`}
                  className="flex-1 min-w-0"
                >
                  <p className="font-medium text-gray-800 truncate group-hover:text-blue-600 transition-colors">
                    {doc.title || 'Untitled'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(doc.updated_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </Link>
                <button
                  onClick={() => deleteDocument(doc.id)}
                  className="ml-4 text-gray-300 hover:text-red-500 transition-colors text-sm shrink-0"
                  title="Delete document"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
