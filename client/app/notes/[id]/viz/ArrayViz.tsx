'use client';

import type { ArrayFrame } from '@/lib/frames';

/**
 * Bar chart of an array mid-algorithm.
 *
 * Drawn as SVG with a viewBox rather than divs: the bars then scale to any
 * panel width without recomputing pixel sizes, and the whole thing stays sharp
 * on a retina display.
 */
export default function ArrayViz({ frame }: { frame: ArrayFrame }) {
  const { data, highlight = [], sorted = [], pointer } = frame;
  if (data.length === 0) return null;

  const W = 100;
  const H = 52;
  const gap = data.length > 30 ? 0.4 : 1.2;
  const barWidth = (W - gap * (data.length - 1)) / data.length;

  // Bars are scaled against the largest value so the tallest always fills the
  // frame. Negative values are supported by measuring the full span.
  const max = Math.max(...data, 0);
  const min = Math.min(...data, 0);
  const span = max - min || 1;

  const highlighted = new Set(highlight);
  const settled = new Set(sorted);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="array state">
        {data.map((value, i) => {
          const height = (Math.abs(value) / span) * (H - 10);
          const x = i * (barWidth + gap);
          const y = H - height;

          const fill = highlighted.has(i)
            ? 'var(--viz-highlight)'
            : settled.has(i)
              ? 'var(--viz-sorted)'
              : 'var(--viz-bar)';

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={height}
                fill={fill}
                rx={Math.min(0.6, barWidth / 3)}
                // A short transition makes a swap read as movement rather than
                // as two unrelated frames.
                style={{ transition: 'height 120ms ease, y 120ms ease, fill 120ms ease' }}
              />
              {/* Values are only legible up to a couple of dozen bars. */}
              {data.length <= 24 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 1.5}
                  textAnchor="middle"
                  fontSize={2.6}
                  fill="currentColor"
                  className="text-neutral-500"
                >
                  {value}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {pointer && Object.keys(pointer).length > 0 && (
        <div className="relative mt-1 h-4">
          {Object.entries(pointer).map(([name, index]) => {
            if (index < 0 || index >= data.length) return null;
            const left = ((index * (barWidth + gap) + barWidth / 2) / W) * 100;
            return (
              <span
                key={name}
                className="absolute -translate-x-1/2 font-mono text-[10px] text-indigo-600 dark:text-indigo-400"
                style={{ left: `${left}%` }}
              >
                ▲{name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
