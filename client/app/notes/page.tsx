'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { clearLocalUser, getUser, isLoggedIn, logout } from '@/lib/auth';
import Avatar from '@/components/Avatar';
import type { Note } from '@/lib/types';

interface CourseCount {
  course: string;
  count: number;
}

export default function NotesLibrary() {
  const router = useRouter();

  const [notes, setNotes] = useState<Note[]>([]);
  const [courses, setCourses] = useState<CourseCount[]>([]);
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const user = getUser();

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (course) params.set('course', course);
    if (tag) params.set('tag', tag);

    try {
      const res = await api.get(`/api/notes?${params}`);
      setNotes(res.data);
      setError('');
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        clearLocalUser();
        router.replace('/login');
        return;
      }
      setError('Could not load your notes.');
    } finally {
      setLoading(false);
    }
  }, [query, course, tag, router]);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    api.get('/api/notes/courses').then((res) => setCourses(res.data)).catch(() => {});
  }, [router]);

  // Debounced so typing in the search box does not fire a query per keystroke.
  // Full-text search hits an index, but it still crosses the network.
  useEffect(() => {
    const timer = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function createNote() {
    setCreating(true);
    try {
      const res = await api.post('/api/notes', {
        title: 'Untitled note',
        course: course ?? undefined,
      });
      router.push(`/notes/${res.data.id}`);
    } catch {
      setError('Could not create a note.');
      setCreating(false);
    }
  }

  async function deleteNote(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const previous = notes;
    setNotes((current) => current.filter((n) => n.id !== id));
    try {
      await api.delete(`/api/notes/${id}`);
    } catch {
      setNotes(previous);
      setError('Could not delete that note.');
    }
  }

  const activeFilters = [course, tag].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            NoteCraft
          </h1>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your notes…"
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm placeholder:text-neutral-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />

          <button
            onClick={createNote}
            disabled={creating}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? '…' : 'New note'}
          </button>

          <Link href="/profile" className="shrink-0" title="Your profile">
            <Avatar name={user?.name ?? '?'} color={user?.avatar_color} size="md" />
          </Link>

          <button
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
            className="shrink-0 text-sm text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <aside className="hidden w-48 shrink-0 md:block">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Courses
          </p>
          <ul className="space-y-0.5">
            <li>
              <button
                onClick={() => setCourse(null)}
                className={`w-full rounded px-2 py-1 text-left text-sm transition-colors ${
                  course === null
                    ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
                }`}
              >
                All notes
              </button>
            </li>
            {courses.map((c) => (
              <li key={c.course}>
                <button
                  onClick={() => setCourse(c.course === course ? null : c.course)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm transition-colors ${
                    course === c.course
                      ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
                  }`}
                >
                  <span className="truncate">{c.course}</span>
                  <span className="ml-2 shrink-0 text-xs text-neutral-400">{c.count}</span>
                </button>
              </li>
            ))}
            {courses.length === 0 && (
              <li className="px-2 text-xs italic text-neutral-400">
                Set a course on a note to group it here.
              </li>
            )}
          </ul>
        </aside>

        <main className="min-w-0 flex-1">
          {(activeFilters > 0 || query) && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-neutral-500">
                {notes.length} {notes.length === 1 ? 'note' : 'notes'}
              </span>
              {course && <Chip label={course} onClear={() => setCourse(null)} />}
              {tag && <Chip label={`#${tag}`} onClear={() => setTag(null)} />}
              {query && <Chip label={`"${query}"`} onClear={() => setQuery('')} />}
            </div>
          )}

          {error && (
            <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-neutral-400">Loading…</p>
          ) : notes.length === 0 ? (
            <EmptyState filtered={!!query || activeFilters > 0} onCreate={createNote} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {notes.map((note) => (
                <li key={note.id}>
                  <div className="group relative h-full rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700">
                    <Link href={`/notes/${note.id}`} className="block">
                      <div className="mb-1 flex items-start gap-2">
                        <h2 className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100">
                          {note.title}
                        </h2>
                        {!note.is_owner && (
                          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                            shared
                          </span>
                        )}
                      </div>

                      <p className="mb-3 line-clamp-2 h-8 text-xs leading-4 text-neutral-500">
                        {note.excerpt?.trim() || 'Empty note'}
                      </p>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {note.course && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                            {note.course}
                          </span>
                        )}
                        {note.tags.slice(0, 3).map((t) => (
                          <button
                            key={t}
                            onClick={(e) => {
                              e.preventDefault();
                              setTag(t === tag ? null : t);
                            }}
                            className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400"
                          >
                            #{t}
                          </button>
                        ))}
                        <span className="ml-auto text-neutral-400">
                          {new Date(note.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </Link>

                    {note.is_owner && (
                      <button
                        onClick={() => deleteNote(note.id, note.title)}
                        className="absolute top-3 right-3 text-xs text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-500"
                        aria-label={`Delete ${note.title}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      onClick={onClear}
      className="flex items-center gap-1 rounded-full bg-neutral-200 px-2 py-0.5 text-neutral-700 transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300"
    >
      {label} <span className="text-neutral-500">×</span>
    </button>
  );
}

function EmptyState({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-16 text-center dark:border-neutral-700">
      <p className="mb-1 text-sm text-neutral-600 dark:text-neutral-400">
        {filtered ? 'Nothing matches those filters.' : 'No notes yet.'}
      </p>
      <p className="mb-4 text-xs text-neutral-400">
        {filtered
          ? 'Try clearing the search or the course filter.'
          : 'Notes are markdown, with runnable code blocks.'}
      </p>
      {!filtered && (
        <button
          onClick={onCreate}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Write your first note
        </button>
      )}
    </div>
  );
}
