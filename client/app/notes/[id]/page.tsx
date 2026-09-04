'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { io, type Socket } from 'socket.io-client';
import api from '@/lib/api';
import { SOCKET_URL } from '@/lib/config';
import { clearLocalUser, getUser, isLoggedIn } from '@/lib/auth';
import Avatar from '@/components/Avatar';
import { LANGUAGE_LABELS, type Language, type Note, type Viewer } from '@/lib/types';
import MarkdownEditor from './MarkdownEditor';
import NotePreview from './NotePreview';
import CompilerPanel from './CompilerPanel';
import ReactionBar from './ReactionBar';
import ViewerActivity from './ViewerActivity';
import ShareModal from './ShareModal';

// Cursor colours for collaborators, keyed by the avatar colour they chose so a
// person's cursor matches their avatar everywhere they appear.
const CURSOR_COLORS: Record<string, string> = {
  indigo: '#6366f1',
  violet: '#8b5cf6',
  sky: '#0ea5e9',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#64748b',
};

type ViewMode = 'edit' | 'split' | 'read';

export default function NotePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [view, setView] = useState<ViewMode>('split');
  const [showCompiler, setShowCompiler] = useState(false);
  const [focusedLine, setFocusedLine] = useState(1);
  const [shareOpen, setShareOpen] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const socketRef = useRef<Socket | null>(null);

  // One Y.Doc and one Awareness for the life of the page. Recreating either
  // would drop the collaborative session and every remote cursor with it.
  const ydoc = useMemo(() => new Y.Doc(), []);
  const ytext = useMemo(() => ydoc.getText('content'), [ydoc]);
  const awareness = useMemo(() => new Awareness(ydoc), [ydoc]);

  const me = getUser();
  const canEdit = note?.role === 'owner' || note?.role === 'editor';

  useEffect(() => {
    return () => {
      awareness.destroy();
      ydoc.destroy();
    };
  }, [ydoc, awareness]);

  // ── Metadata ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }

    api
      .get(`/api/notes/${id}`)
      .then((res) => {
        setNote(res.data);
        setTitle(res.data.title);
      })
      .catch((err) => {
        if (err?.response?.status === 401) {
          clearLocalUser();
          router.replace('/login');
        } else if (err?.response?.status === 404) {
          setError('This note does not exist, or it has not been shared with you.');
        } else {
          setError('Could not load this note.');
        }
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  // ── Mirror the CRDT into React state ──────────────────────────────────────
  // The Y.Text is the source of truth; this copy exists so the preview and the
  // compiler can read the note without either of them touching the CRDT.
  useEffect(() => {
    const sync = () => setMarkdown(ytext.toString());
    sync();
    ytext.observe(sync);
    return () => ytext.unobserve(sync);
  }, [ytext]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn() || !me) return;

    // withCredentials sends the httpOnly auth cookie with the handshake; the
    // server verifies it before the connection is allowed at all.
    const socket = io(SOCKET_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('live');
      socket.emit('join-note', id);
    });
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('offline'));
    socket.on('note-error', (message: string) => setError(message || 'Could not open this note.'));

    // Full CRDT state on join.
    socket.on('load-note', (state: ArrayBuffer) => {
      Y.applyUpdate(ydoc, new Uint8Array(state), socket);
    });
    socket.on('receive-changes', (update: ArrayBuffer) => {
      Y.applyUpdate(ydoc, new Uint8Array(update), socket);
    });
    socket.on('viewers', (roster: Viewer[]) => setViewers(roster));

    // Local edits go out — but not the ones that just arrived from the server,
    // which would otherwise echo back and forth forever. The origin tag on
    // applyUpdate above is what distinguishes them.
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== socket) socket.emit('send-changes', { noteId: id, update });
    };
    ydoc.on('update', onDocUpdate);

    // ── Awareness (cursors and selections) ──
    // Awareness is not part of the document: it is ephemeral per-connection
    // state, so it rides its own channel and is never persisted.
    awareness.setLocalStateField('user', {
      name: me.name,
      color: CURSOR_COLORS[me.avatar_color ?? 'slate'] ?? CURSOR_COLORS.slate,
      colorLight: `${CURSOR_COLORS[me.avatar_color ?? 'slate'] ?? CURSOR_COLORS.slate}33`,
    });

    const onAwareness = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (origin === 'remote') return;
      const changed = [...added, ...updated, ...removed];
      socket.emit('awareness', {
        noteId: id,
        state: encodeAwarenessUpdate(awareness, changed),
      });
    };
    awareness.on('update', onAwareness);

    socket.on('awareness', ({ state }: { state: ArrayBuffer }) => {
      applyAwarenessUpdate(awareness, new Uint8Array(state), 'remote');
    });

    return () => {
      ydoc.off('update', onDocUpdate);
      awareness.off('update', onAwareness);
      socket.emit('leave-note', id);
      socket.disconnect();
    };
    // me is read once to seed awareness; re-running on identity change would
    // tear down a live session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ydoc, awareness]);

  // ── Metadata edits ────────────────────────────────────────────────────────
  const patch = useCallback(
    async (changes: Partial<Note>) => {
      try {
        const res = await api.patch(`/api/notes/${id}`, changes);
        setNote((current) => (current ? { ...current, ...res.data } : current));
      } catch {
        setError('Could not save that change.');
      }
    },
    [id]
  );

  if (loading) {
    return <Centered>Loading…</Centered>;
  }

  if (error && !note) {
    return (
      <Centered>
        <p className="max-w-sm text-neutral-600 dark:text-neutral-400">{error}</p>
        <button
          onClick={() => router.push('/notes')}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Back to my notes
        </button>
      </Centered>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-neutral-900">
      <header className="shrink-0 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => router.push('/notes')}
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            ← Notes
          </button>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== note?.title && patch({ title })}
            disabled={!canEdit}
            className="min-w-0 flex-1 border-none bg-transparent text-base font-semibold text-neutral-800 outline-none placeholder:text-neutral-300 disabled:cursor-default dark:text-neutral-100"
            placeholder="Untitled"
          />

          <ConnectionBadge status={status} />

          {/* Live viewers, collapsed into a stack of avatars. */}
          <div className="flex -space-x-1.5">
            {viewers.slice(0, 4).map((viewer) => (
              <Avatar
                key={viewer.userId}
                name={viewer.name}
                color={viewer.avatarColor}
                size="sm"
                title={`${viewer.name} — ${viewer.role}`}
              />
            ))}
            {viewers.length > 4 && (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                +{viewers.length - 4}
              </span>
            )}
          </div>

          {note?.role === 'owner' && (
            <button
              onClick={() => setShareOpen(true)}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Share
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 py-2 dark:border-neutral-800">
          <ViewToggle value={view} onChange={setView} />

          <button
            onClick={() => setShowCompiler((open) => !open)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showCompiler
                ? 'bg-emerald-600 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            ▶ Run code
          </button>

          <div className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

          <input
            defaultValue={note?.course ?? ''}
            onBlur={(e) => e.target.value !== (note?.course ?? '') && patch({ course: e.target.value.trim() || null })}
            disabled={!canEdit}
            placeholder="Course"
            className="w-28 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs text-neutral-700 placeholder:text-neutral-400 dark:border-neutral-700 dark:text-neutral-300"
          />

          <TagEditor
            tags={note?.tags ?? []}
            editable={!!canEdit}
            onChange={(tags) => patch({ tags })}
          />

          <select
            value={note?.language ?? 'python'}
            onChange={(e) => patch({ language: e.target.value as Language })}
            disabled={!canEdit}
            className="rounded-md border border-neutral-200 bg-transparent px-1.5 py-1 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
            title="Default language for unlabelled code blocks"
          >
            {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-3">
            {!canEdit && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Read-only
              </span>
            )}
            <ReactionBar noteId={id} />
          </div>
        </div>
      </header>

      {error && note && (
        <p className="shrink-0 bg-rose-50 px-4 py-1.5 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </p>
      )}

      <main className="flex min-h-0 flex-1">
        {view !== 'read' && (
          <div className="min-w-0 flex-1 border-r border-neutral-200 dark:border-neutral-800">
            <MarkdownEditor
              ytext={ytext}
              awareness={awareness}
              editable={!!canEdit}
              onFocusedLine={setFocusedLine}
            />
          </div>
        )}

        {view !== 'edit' && (
          <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
            <NotePreview markdown={markdown} />
          </div>
        )}

        {showCompiler && (
          <div className="w-80 shrink-0">
            <CompilerPanel
              markdown={markdown}
              focusedLine={focusedLine}
              defaultLanguage={note?.language ?? 'python'}
              onClose={() => setShowCompiler(false)}
            />
          </div>
        )}

        <div className="hidden w-56 shrink-0 overflow-y-auto border-l border-neutral-200 px-4 py-4 xl:block dark:border-neutral-800">
          <ViewerActivity noteId={id} viewers={viewers} currentUserId={me?.id} />
        </div>
      </main>

      {shareOpen && <ShareModal noteId={id} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-neutral-400">
      {children}
    </div>
  );
}

function ConnectionBadge({ status }: { status: 'connecting' | 'live' | 'offline' }) {
  const map = {
    connecting: { dot: 'bg-amber-400', label: 'connecting' },
    live: { dot: 'bg-emerald-500', label: 'live' },
    offline: { dot: 'bg-rose-500', label: 'offline' },
  }[status];

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-400">
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </span>
  );
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
      {(['edit', 'split', 'read'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
            value === mode
              ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900'
              : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

function TagEditor({
  tags,
  editable,
  onChange,
}: {
  tags: string[];
  editable: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {tag}
          {editable && (
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="text-neutral-400 hover:text-rose-500"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {editable && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !draft.trim()) return;
            e.preventDefault();
            onChange([...tags, draft.trim()]);
            setDraft('');
          }}
          placeholder="+ tag"
          className="w-16 rounded-md border border-dashed border-neutral-300 bg-transparent px-1.5 py-0.5 text-[11px] text-neutral-700 placeholder:text-neutral-400 dark:border-neutral-700 dark:text-neutral-300"
        />
      )}
    </div>
  );
}
