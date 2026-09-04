'use client';

import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { yCollab } from 'y-codemirror.next';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

/**
 * The markdown editing surface: CodeMirror 6 bound to a Yjs text type.
 *
 * The binding is what makes collaboration work. CodeMirror's document and the
 * Y.Text are kept in step by yCollab in both directions, so a remote edit
 * arrives as a normal CodeMirror transaction and a local keystroke becomes a
 * CRDT update. Neither side ever overwrites the other wholesale, which is why
 * two people can type in the same paragraph without one clobbering the other.
 */
export default function MarkdownEditor({
  ytext,
  awareness,
  editable,
  onFocusedLine,
}: {
  ytext: Y.Text;
  awareness: Awareness;
  editable: boolean;
  /** Reports the cursor's line so the compiler can pick the enclosing block. */
  onFocusedLine?: (line: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Compartments let a single configuration field be reconfigured later
  // without tearing down and rebuilding the editor — which would lose the
  // cursor, the scroll position, and the collaborative binding.
  const editableComp = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // languageData gives fenced code blocks real per-language highlighting,
        // loaded on demand rather than bundled up front.
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        cmPlaceholder('# Start typing…\n\nMarkdown works here. Fence a code block with ``` and run it.'),
        // Must come after the base config so its keymap for collaborative
        // undo takes precedence over the local history above.
        yCollab(ytext, awareness),
        editableComp.current.of(EditorView.editable.of(editable)),
        EditorView.updateListener.of((update) => {
          if (onFocusedLine && update.selectionSet) {
            const pos = update.state.selection.main.head;
            onFocusedLine(update.state.doc.lineAt(pos).number);
          }
        }),
        EditorView.theme({
          '&': { backgroundColor: 'transparent' },
          '.cm-placeholder': { color: '#a3a3a3' },
        }),
      ],
    });

    const editorView = new EditorView({ state, parent: host.current });
    view.current = editorView;

    return () => {
      editorView.destroy();
      view.current = null;
    };
    // Deliberately built once. ytext and awareness are stable for the page's
    // lifetime, and `editable` is applied through its compartment below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext, awareness]);

  // Apply permission changes in place.
  useEffect(() => {
    view.current?.dispatch({
      effects: editableComp.current.reconfigure(EditorView.editable.of(editable)),
    });
  }, [editable]);

  return <div ref={host} className="h-full overflow-hidden" />;
}
