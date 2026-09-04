'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/**
 * Rendered view of the note.
 *
 * remark-gfm adds the GitHub extensions students actually use in notes —
 * tables, task lists, strikethrough. rehype-highlight colours fenced blocks
 * from the same fence info the compiler reads, so what you can run and what
 * looks like code never disagree.
 */
export default function NotePreview({ markdown }: { markdown: string }) {
  if (!markdown.trim()) {
    return (
      <p className="text-sm italic text-neutral-400">
        Nothing to preview yet — start typing on the left.
      </p>
    );
  }

  return (
    <div className="prose-note max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
