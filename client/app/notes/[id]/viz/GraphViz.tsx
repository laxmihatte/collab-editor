'use client';

import { useMemo } from 'react';
import type { GraphFrame } from '@/lib/frames';

/**
 * Node-link diagram of a graph mid-traversal.
 *
 * Nodes are laid out on a circle rather than by force simulation. A force
 * layout would look nicer but move between frames, and a node that drifts
 * while you are watching an algorithm is actively misleading — you cannot tell
 * whether the movement means something. A fixed layout keeps every change on
 * screen attributable to the algorithm.
 */
export default function GraphViz({ frame }: { frame: GraphFrame }) {
  const { nodes, edges, visited = [], frontier = [], current, dist } = frame;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const radius = 38;
    nodes.forEach((node, i) => {
      // Start at the top (-90°) so small graphs look deliberate rather than
      // arbitrarily rotated.
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      map.set(node, { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
    });
    return map;
  }, [nodes]);

  if (nodes.length === 0) return null;

  const visitedSet = new Set(visited);
  const frontierSet = new Set(frontier);

  return (
    <svg viewBox="0 0 100 100" className="w-full" role="img" aria-label="graph state">
      {edges.map(([from, to, weight], i) => {
        const a = positions.get(from);
        const b = positions.get(to);
        if (!a || !b) return null;

        // An edge between two finalized nodes is part of the explored region.
        const explored = visitedSet.has(from) && visitedSet.has(to);

        return (
          <g key={`${from}-${to}-${i}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={explored ? 'var(--viz-highlight)' : 'var(--viz-edge)'}
              strokeWidth={explored ? 0.9 : 0.5}
              style={{ transition: 'stroke 150ms ease' }}
            />
            {weight !== undefined && (
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 1}
                textAnchor="middle"
                fontSize={3}
                fill="currentColor"
                className="text-neutral-500"
              >
                {weight}
              </text>
            )}
          </g>
        );
      })}

      {nodes.map((node) => {
        const pos = positions.get(node)!;
        const fill =
          node === current
            ? 'var(--viz-current)'
            : visitedSet.has(node)
              ? 'var(--viz-sorted)'
              : frontierSet.has(node)
                ? 'var(--viz-highlight)'
                : 'var(--viz-bar)';

        return (
          <g key={node} style={{ transition: 'all 150ms ease' }}>
            <circle
              cx={pos.x}
              cy={pos.y}
              r={node === current ? 6 : 5}
              fill={fill}
              style={{ transition: 'fill 150ms ease, r 150ms ease' }}
            />
            <text
              x={pos.x}
              y={pos.y + 1.3}
              textAnchor="middle"
              fontSize={3.6}
              fontWeight={600}
              fill="white"
            >
              {node}
            </text>
            {/* Distance sits outside the node so it never covers the label. */}
            {dist && dist[node] !== undefined && (
              <text
                x={pos.x}
                y={pos.y - 7}
                textAnchor="middle"
                fontSize={3.2}
                fill="currentColor"
                className="text-indigo-600 dark:text-indigo-400"
              >
                {dist[node] === null || dist[node] === Infinity ? '∞' : dist[node]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
