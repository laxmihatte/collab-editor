'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { REACTION_PALETTE, type Reaction } from '@/lib/types';

/**
 * Emoji reactions on a note.
 *
 * Reactions are available to viewers as well as editors: reacting is feedback
 * on someone else's note, not a change to it. The click is applied optimistically
 * and reconciled with whatever the server returns, so the button responds
 * immediately without the count being able to drift.
 */
export default function ReactionBar({ noteId }: { noteId: string }) {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .get(`/api/notes/${noteId}/reactions`)
      .then((res) => setReactions(res.data))
      .catch(() => setReactions([]));
  }, [noteId]);

  async function toggle(emoji: string) {
    if (busy) return;
    setBusy(emoji);

    // Optimistic update: assume the toggle succeeds so the UI does not wait a
    // round trip to acknowledge a click.
    const previous = reactions;
    setReactions((current) => {
      const existing = current.find((r) => r.emoji === emoji);
      if (!existing) return [...current, { emoji, count: 1, reacted: true, names: [] }];
      const count = existing.count + (existing.reacted ? -1 : 1);
      if (count === 0) return current.filter((r) => r.emoji !== emoji);
      return current.map((r) =>
        r.emoji === emoji ? { ...r, count, reacted: !r.reacted } : r
      );
    });

    try {
      const res = await api.post(`/api/notes/${noteId}/reactions`, { emoji });
      setReactions(res.data.reactions);
    } catch {
      setReactions(previous); // server said no — put the old state back
    } finally {
      setBusy(null);
    }
  }

  const counted = new Map(reactions.map((r) => [r.emoji, r]));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {REACTION_PALETTE.map((emoji) => {
        const reaction = counted.get(emoji);
        const active = reaction?.reacted ?? false;
        return (
          <button
            key={emoji}
            onClick={() => toggle(emoji)}
            title={
              reaction?.names.length
                ? `${reaction.names.join(', ')}${
                    reaction.count > reaction.names.length
                      ? ` and ${reaction.count - reaction.names.length} more`
                      : ''
                  }`
                : 'Add a reaction'
            }
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-sm transition-colors ${
              active
                ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950'
                : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800'
            } ${reaction ? '' : 'opacity-50 hover:opacity-100'}`}
          >
            <span>{emoji}</span>
            {reaction && (
              <span
                className={`text-xs font-medium tabular-nums ${
                  active
                    ? 'text-indigo-700 dark:text-indigo-300'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                {reaction.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
