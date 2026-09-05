// Parsing the visualization frames a program prints to stdout.
// The format is documented in docs/visualization-format.md.

export interface ArrayFrame {
  viz: 'array';
  data: number[];
  highlight?: number[];
  sorted?: number[];
  pointer?: Record<string, number>;
  label?: string;
}

export interface GraphFrame {
  viz: 'graph';
  nodes: string[];
  edges: [string, string, number?][];
  visited?: string[];
  frontier?: string[];
  current?: string;
  dist?: Record<string, number>;
  label?: string;
}

export type Frame = ArrayFrame | GraphFrame;

export interface ParsedRun {
  frames: Frame[];
  /** Lines that were not frames — ordinary program output. */
  output: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Split a program's stdout into visualization frames and ordinary output.
 *
 * A line is a frame only if it parses as a JSON object carrying a `viz` key.
 * Everything else passes through untouched, so print() debugging keeps working
 * alongside the animation.
 *
 * Malformed frames are skipped rather than throwing. Output is the one thing a
 * student controls completely, and a stray brace should not blank the panel.
 */
export function parseFrames(stdout: string): ParsedRun {
  const frames: Frame[] = [];
  const plain: string[] = [];

  // Graph structure is sent once and inherited, so a traversal only transmits
  // what changed. These carry the last-seen values forward.
  let nodes: string[] = [];
  let edges: [string, string, number?][] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();

    // Cheap rejection before attempting a parse: most lines are not frames,
    // and JSON.parse on ordinary prose is pure waste.
    if (!trimmed.startsWith('{') || !trimmed.includes('"viz"')) {
      if (line.length > 0) plain.push(line);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      plain.push(line);
      continue;
    }

    if (!isRecord(parsed)) {
      plain.push(line);
      continue;
    }

    if (parsed.viz === 'array' && Array.isArray(parsed.data)) {
      frames.push({
        viz: 'array',
        data: parsed.data.filter((n): n is number => typeof n === 'number'),
        highlight: asIndexList(parsed.highlight),
        sorted: asIndexList(parsed.sorted),
        pointer: isRecord(parsed.pointer) ? (parsed.pointer as Record<string, number>) : undefined,
        label: typeof parsed.label === 'string' ? parsed.label : undefined,
      });
      continue;
    }

    if (parsed.viz === 'graph') {
      if (Array.isArray(parsed.nodes)) nodes = parsed.nodes.map(String);
      if (Array.isArray(parsed.edges)) {
        edges = parsed.edges.filter(Array.isArray).map((e) => {
          const edge = e as unknown[];
          return [String(edge[0]), String(edge[1]), typeof edge[2] === 'number' ? edge[2] : undefined];
        });
      }

      frames.push({
        viz: 'graph',
        nodes,
        edges,
        visited: asStringList(parsed.visited),
        frontier: asStringList(parsed.frontier),
        current: typeof parsed.current === 'string' ? parsed.current : undefined,
        dist: isRecord(parsed.dist) ? (parsed.dist as Record<string, number>) : undefined,
        label: typeof parsed.label === 'string' ? parsed.label : undefined,
      });
      continue;
    }

    // A `viz` we do not render yet — keep it visible rather than swallowing it.
    plain.push(line);
  }

  return { frames, output: plain.join('\n') };
}

function asIndexList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0);
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(String);
}
