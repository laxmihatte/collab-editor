'use client';

import { useEffect, useRef, useState } from 'react';
import type { Frame } from '@/lib/frames';
import ArrayViz from './ArrayViz';
import GraphViz from './GraphViz';

const SPEEDS = [0.5, 1, 2, 4];

/**
 * Playback for a run's visualization frames.
 *
 * The frames are the algorithm's own account of what it did, already complete
 * before this component mounts. Playback is therefore just an index into an
 * array — there is no streaming, no re-running, and stepping backwards is free.
 * That is what makes scrubbing possible at all.
 */
export default function VizPlayer({ frames }: { frames: Frame[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  // A new run replaces the frames; start it from the beginning.
  useEffect(() => {
    setIndex(0);
    setPlaying(true);
  }, [frames]);

  // setInterval rather than requestAnimationFrame: this advances on a fixed
  // wall-clock cadence a viewer can follow, not on the display's refresh rate.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing || frames.length === 0) return;

    timer.current = setInterval(() => {
      setIndex((current) => {
        if (current >= frames.length - 1) {
          setPlaying(false); // stop at the end rather than looping
          return current;
        }
        return current + 1;
      });
    }, 420 / speed);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, frames.length]);

  if (frames.length === 0) return null;

  const frame = frames[Math.min(index, frames.length - 1)];
  const atEnd = index >= frames.length - 1;

  function step(delta: number) {
    setPlaying(false);
    setIndex((current) => Math.max(0, Math.min(frames.length - 1, current + delta)));
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 min-h-[8rem]">
        {frame.viz === 'array' ? <ArrayViz frame={frame} /> : <GraphViz frame={frame} />}
      </div>

      <p className="mb-2 min-h-[1.25rem] font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
        {frame.label ?? ''}
      </p>

      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
        className="mb-2 w-full accent-indigo-600"
        aria-label="Step through the run"
      />

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => step(-1)}
          disabled={index === 0}
          className={buttonClass}
          aria-label="Previous step"
        >
          ◀
        </button>

        <button
          onClick={() => {
            // Replay from the start once it has finished, rather than
            // resuming at the end and doing nothing visible.
            if (atEnd) setIndex(0);
            setPlaying((p) => !p);
          }}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
        </button>

        <button
          onClick={() => step(1)}
          disabled={atEnd}
          className={buttonClass}
          aria-label="Next step"
        >
          ▶
        </button>

        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="ml-auto rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
          aria-label="Playback speed"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>

        <span className="font-mono text-[11px] tabular-nums text-neutral-400">
          {index + 1}/{frames.length}
        </span>
      </div>
    </div>
  );
}

const buttonClass =
  'rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800';
