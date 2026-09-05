'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import type { PastViewer, Viewer } from '@/lib/types';

/** Someone counts as "typing" if they edited within this window. */
const ACTIVE_WINDOW_MS = 8000;

function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Who is here now, and who has been here before.
 *
 * The two halves come from different places on purpose. Live viewers arrive
 * over the socket and vanish when a tab closes; past viewers come from the
 * note_views table and survive a server restart. Presenting them together is a
 * UI decision, not a storage one.
 */
export default function ViewerActivity({
  noteId,
  viewers,
  currentUserId,
}: {
  noteId: string;
  viewers: Viewer[];
  currentUserId?: string;
}) {
  const [past, setPast] = useState<PastViewer[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api
      .get(`/api/notes/${noteId}/viewers`)
      .then((res) => setPast(res.data))
      .catch(() => setPast([]));
  }, [noteId, viewers.length]);

  // "Typing" is derived from a timestamp, so it has to be re-evaluated on a
  // timer — no further socket traffic is needed for the halo to fade.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);

  const liveIds = new Set(viewers.map((v) => v.userId));
  const away = past.filter((p) => !liveIds.has(p.id));

  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Here now · {viewers.length}
        </h3>

        <ul className="space-y-1.5">
          {viewers.map((viewer) => {
            const typing = now - viewer.activeAt < ACTIVE_WINDOW_MS;
            return (
              <li key={viewer.userId} className="flex items-center gap-2">
                <Avatar name={viewer.name} color={viewer.avatarColor} size="sm" ring={typing} />
                {/* The name truncates; the "(you)" marker must not, or it is
                    the first thing to disappear in a narrow panel. */}
                <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">
                  {viewer.name}
                </span>
                {viewer.userId === currentUserId && (
                  <span className="shrink-0 text-[11px] text-neutral-400">you</span>
                )}
                {viewer.tabs > 1 && (
                  <span className="text-[10px] text-neutral-400" title={`${viewer.tabs} tabs open`}>
                    ×{viewer.tabs}
                  </span>
                )}
                <span className="text-[11px] text-neutral-400">
                  {typing ? 'typing…' : viewer.role === 'viewer' ? 'reading' : 'idle'}
                </span>
              </li>
            );
          })}
          {viewers.length === 0 && (
            <li className="text-xs italic text-neutral-400">Connecting…</li>
          )}
        </ul>
      </section>

      {away.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Recently here
          </h3>
          <ul className="space-y-1.5">
            {away.slice(0, 8).map((person) => (
              <li key={person.id} className="flex items-center gap-2">
                <Avatar name={person.name} color={person.avatar_color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-400">
                  {person.name}
                </span>
                <span
                  className="text-[11px] text-neutral-400"
                  title={`${person.view_count} visit${person.view_count === 1 ? '' : 's'}`}
                >
                  {relativeTime(person.last_viewed_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
