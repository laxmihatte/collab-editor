import type { Language } from './types';

export interface CodeBlock {
  /** 1-based line of the opening fence. */
  startLine: number;
  /** 1-based line of the closing fence (or the last line, if unclosed). */
  endLine: number;
  /** The info string as written, e.g. "python" or "cpp". */
  info: string;
  language: Language | null;
  code: string;
}

// Fence info strings people actually type, mapped to what the API accepts.
const ALIASES: Record<string, Language> = {
  py: 'python', python: 'python', python3: 'python',
  js: 'javascript', javascript: 'javascript', node: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  java: 'java',
  c: 'c',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
};

export function languageFromInfo(info: string): Language | null {
  return ALIASES[info.trim().toLowerCase().split(/\s+/)[0]] ?? null;
}

/**
 * Find fenced code blocks in a markdown document.
 *
 * Written as a line scanner rather than a regex because fences are a
 * line-oriented construct: a ``` only opens a block at the start of a line,
 * and the closing fence must be at least as long as the opening one — rules a
 * regex over the whole string gets wrong on nested or indented fences.
 */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const lines = markdown.split('\n');
  const blocks: CodeBlock[] = [];

  let open: { startLine: number; info: string; fence: string; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);

    if (!open) {
      if (fence) {
        open = { startLine: i + 1, info: fence[2].trim(), fence: fence[1][0].repeat(fence[1].length), body: [] };
      }
      continue;
    }

    // A closing fence uses the same character and is at least as long, and
    // carries no info string.
    const closes =
      fence && fence[1][0] === open.fence[0] && fence[1].length >= open.fence.length && !fence[2].trim();

    if (closes) {
      blocks.push({
        startLine: open.startLine,
        endLine: i + 1,
        info: open.info,
        language: languageFromInfo(open.info),
        code: open.body.join('\n'),
      });
      open = null;
    } else {
      open.body.push(line);
    }
  }

  // An unterminated fence still holds code someone may want to run.
  if (open) {
    blocks.push({
      startLine: open.startLine,
      endLine: lines.length,
      info: open.info,
      language: languageFromInfo(open.info),
      code: open.body.join('\n'),
    });
  }

  return blocks;
}

/** The block containing a given line, if any. */
export function blockAtLine(blocks: CodeBlock[], line: number): CodeBlock | null {
  return blocks.find((b) => line >= b.startLine && line <= b.endLine) ?? null;
}
