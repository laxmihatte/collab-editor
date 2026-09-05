'use client';

import { useMemo, useState } from 'react';
import api from '@/lib/api';
import { blockAtLine, extractCodeBlocks } from '@/lib/markdown';
import { parseFrames } from '@/lib/frames';
import VizPlayer from './viz/VizPlayer';
import { LANGUAGE_LABELS, type ExecutionResult, type Language } from '@/lib/types';

/**
 * Runs the code blocks in a note.
 *
 * The panel deliberately has no editor of its own: the source of truth is the
 * note, so what runs is always exactly what the reader sees. It picks the block
 * containing the cursor, which makes "run the thing I'm looking at" the default
 * without anyone having to select it.
 */
export default function CompilerPanel({
  markdown,
  focusedLine,
  defaultLanguage,
  onClose,
}: {
  markdown: string;
  focusedLine: number;
  defaultLanguage: Language;
  onClose: () => void;
}) {
  const [stdin, setStdin] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState('');
  const [pinned, setPinned] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  // Identifies a run, so the player can be keyed on it and remount cleanly.
  const [runId, setRunId] = useState(0);

  const blocks = useMemo(() => extractCodeBlocks(markdown), [markdown]);

  // Follow the cursor unless the reader has explicitly pinned a block.
  const selected =
    (pinned !== null ? blocks[pinned] : null) ?? blockAtLine(blocks, focusedLine) ?? blocks[0] ?? null;

  const language: Language = selected?.language ?? defaultLanguage;

  async function run() {
    if (!selected) return;

    setRunning(true);
    setError('');
    setResult(null);
    const started = performance.now();

    try {
      const res = await api.post('/api/execute', {
        language,
        source: selected.code,
        stdin,
      });
      setResult(res.data);
      setElapsed(Math.round(performance.now() - started));
      setRunId((n) => n + 1);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not reach the execution service.';
      setError(message);
    } finally {
      setRunning(false);
    }
  }

  const compileFailed = result?.compile != null && result.compile.code !== 0;

  // Derived from the result rather than held in its own state: the frames are
  // a view of this run's stdout, and storing them separately would let the two
  // drift apart on the next run.
  const parsed = useMemo(
    () => (result ? parseFrames(result.run.stdout) : null),
    [result]
  );
  const hasFrames = (parsed?.frames.length ?? 0) > 0;

  return (
    <aside className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Run</span>
        <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          {LANGUAGE_LABELS[language]}
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
          aria-label="Close the run panel"
        >
          ✕
        </button>
      </header>

      {blocks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-neutral-500">
          <p>
            No code blocks yet. Fence one with{' '}
            <code className="rounded bg-neutral-200 px-1 font-mono text-xs dark:bg-neutral-800">
              ```python
            </code>{' '}
            and it will show up here.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {blocks.length > 1 && (
            <div className="shrink-0 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Block
              </label>
              <select
                value={pinned ?? blocks.indexOf(selected!)}
                onChange={(e) => setPinned(Number(e.target.value))}
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {blocks.map((b, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {b.language ? LANGUAGE_LABELS[b.language] : b.info || 'plain'} — line{' '}
                    {b.startLine}
                  </option>
                ))}
              </select>
              {pinned !== null && (
                <button
                  onClick={() => setPinned(null)}
                  className="mt-1 text-[11px] text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Follow my cursor instead
                </button>
              )}
            </div>
          )}

          <div className="shrink-0 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Input (stdin)
            </label>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              rows={2}
              placeholder="Piped to the program"
              className="w-full resize-y rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs text-neutral-800 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            />
          </div>

          <div className="shrink-0 px-4 py-2.5">
            <button
              onClick={run}
              disabled={running || !selected?.code.trim()}
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? 'Running…' : `Run ${LANGUAGE_LABELS[language]}`}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {error && (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {error}
              </p>
            )}

            {result && (
              <div className="space-y-3">
                {/* Compilation is shown separately from output so a syntax
                    error does not read like something the program printed. */}
                {compileFailed && (
                  <Section label="Compile error" tone="error">
                    {result.compile!.stderr || result.compile!.stdout}
                  </Section>
                )}

                {/* When a program narrated itself, the animation is the
                    result — the raw frames below would be noise. */}
                {!compileFailed && hasFrames && (
                  <VizPlayer key={runId} frames={parsed!.frames} />
                )}

                {!compileFailed && (hasFrames ? parsed!.output : result.run.stdout) && (
                  <Section label={hasFrames ? 'Printed output' : 'Output'}>
                    {hasFrames ? parsed!.output : result.run.stdout}
                  </Section>
                )}

                {!compileFailed && result.run.stderr && (
                  <Section label="Stderr" tone="error">
                    {result.run.stderr}
                  </Section>
                )}

                {!compileFailed && !hasFrames && !result.run.stdout && !result.run.stderr && (
                  <Section label="Output" muted>
                    (no output)
                  </Section>
                )}

                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                  <span>
                    exit{' '}
                    <span
                      className={
                        result.run.code === 0
                          ? 'font-medium text-emerald-600 dark:text-emerald-400'
                          : 'font-medium text-rose-600 dark:text-rose-400'
                      }
                    >
                      {result.run.code ?? '—'}
                    </span>
                  </span>
                  {/* A signal means the sandbox killed it — a timeout or an
                      out-of-memory kill, not a clean exit. */}
                  {result.run.signal && (
                    <span className="text-rose-600 dark:text-rose-400">
                      killed by {result.run.signal}
                    </span>
                  )}
                  {elapsed !== null && <span>{elapsed} ms round trip</span>}
                  <span className="font-mono">{LANGUAGE_LABELS[result.language]} {result.version}</span>
                  {hasFrames && (
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {parsed!.frames.length} frames
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function Section({
  label,
  children,
  tone,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'error';
  muted?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <pre
        className={`overflow-x-auto whitespace-pre-wrap break-words rounded-md border px-3 py-2 font-mono text-xs ${
          tone === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'
            : 'border-neutral-200 bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200'
        } ${muted ? 'italic text-neutral-400' : ''}`}
      >
        {children}
      </pre>
    </div>
  );
}
