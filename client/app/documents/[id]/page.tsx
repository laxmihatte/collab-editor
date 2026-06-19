'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { io, Socket } from 'socket.io-client';
import api from '@/lib/api';
import { isLoggedIn, getUser, clearLocalUser } from '@/lib/auth';
import ShareModal from './ShareModal';

export default function EditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);

  // One stable Y.Doc for the lifetime of this page
  const ydoc = useMemo(() => new Y.Doc(), []);

  // Destroy the Y.Doc when leaving the page to avoid leaking it
  useEffect(() => {
    return () => ydoc.destroy();
  }, [ydoc]);

  // Load document metadata
  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    api
      .get(`/api/documents/${id}`)
      .then((res) => {
        setTitle(res.data.title);
        setIsOwner(res.data.owner_id === getUser()?.id);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.response?.status === 401) {
          clearLocalUser();
          router.replace('/login');
        } else if (err?.response?.status === 404) {
          setError('This document does not exist or you do not have access to it.');
          setLoading(false);
        } else {
          setError('Could not load this document. Please try again.');
          setLoading(false);
        }
      });
  }, [id, router]);

  // Set up Socket.io <-> Yjs sync
  useEffect(() => {
    if (!isLoggedIn()) return;

    // withCredentials sends the httpOnly auth cookie with the handshake, which
    // the server validates before allowing the connection.
    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', {
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.emit('join-document', id);

    socket.on('connect_error', () => {
      setError('Lost connection to the collaboration server.');
    });

    // Server rejected the join (e.g. access denied)
    socket.on('document-error', (message: string) => {
      setError(message || 'Could not open this document.');
    });

    // Server sends the full current document state when we join
    socket.on('load-document', (state: ArrayBuffer) => {
      Y.applyUpdate(ydoc, new Uint8Array(state), socket);
    });

    // When someone else edits, apply their update to our local doc
    socket.on('receive-changes', (update: ArrayBuffer) => {
      Y.applyUpdate(ydoc, new Uint8Array(update), socket);
    });

    // When we edit locally, send to server (skip updates that came from the
    // socket). The Uint8Array is sent directly so socket.io transmits it as
    // binary rather than a bloated JSON number array.
    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== socket) {
        socket.emit('send-changes', { documentId: id, update });
      }
    };
    ydoc.on('update', handleUpdate);

    return () => {
      ydoc.off('update', handleUpdate);
      socket.disconnect();
    };
  }, [id, ydoc]);

  const editor = useEditor({
    immediatelyRender: false, // avoid SSR hydration mismatch in the App Router
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc }),
    ],
  });

  async function saveTitle(newTitle: string) {
    setSaving(true);
    try {
      await api.patch(`/api/documents/${id}`, { title: newTitle });
    } catch {
      setError('Could not save the title.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-gray-600 max-w-sm">{error}</p>
        <button
          onClick={() => router.push('/documents')}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Back to documents
        </button>
      </div>
    );
  }

  const user = getUser();

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Toolbar */}
      <header className="border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0">
        <button
          onClick={() => router.push('/documents')}
          className="text-gray-400 hover:text-gray-700 transition-colors text-sm"
        >
          ← Back
        </button>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => saveTitle(e.target.value)}
          className="flex-1 text-lg font-semibold text-gray-800 bg-transparent border-none outline-none focus:ring-0 placeholder:text-gray-300 min-w-0"
          placeholder="Untitled"
        />

        <div className="flex items-center gap-3 shrink-0">
          {saving && <span className="text-xs text-gray-400">Saving…</span>}
          {isOwner && (
            <button
              onClick={() => setShareOpen(true)}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Share
            </button>
          )}
          <span className="text-sm text-gray-400">{user?.name}</span>
        </div>
      </header>

      {shareOpen && <ShareModal documentId={id} onClose={() => setShareOpen(false)} />}

      {/* Formatting bar */}
      {editor && (
        <div className="border-b border-gray-100 px-6 py-2 flex items-center gap-1 shrink-0">
          {[
            { label: 'B', action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold'), title: 'Bold' },
            { label: 'I', action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic'), title: 'Italic' },
            { label: 'S', action: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike'), title: 'Strikethrough' },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              title={btn.title}
              className={`w-8 h-8 rounded text-sm font-medium transition-colors ${
                btn.active
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
              }`}
            >
              {btn.label}
            </button>
          ))}

          <div className="w-px h-5 bg-gray-200 mx-1" />

          {[1, 2, 3].map((level) => (
            <button
              key={level}
              onClick={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}
              title={`Heading ${level}`}
              className={`px-2 h-8 rounded text-xs font-medium transition-colors ${
                editor.isActive('heading', { level })
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
              }`}
            >
              H{level}
            </button>
          ))}

          <div className="w-px h-5 bg-gray-200 mx-1" />

          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet list"
            className={`px-2 h-8 rounded text-xs font-medium transition-colors ${
              editor.isActive('bulletList')
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
            }`}
          >
            • List
          </button>

          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
            className={`px-2 h-8 rounded text-xs font-medium transition-colors ${
              editor.isActive('orderedList')
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
            }`}
          >
            1. List
          </button>

          <div className="w-px h-5 bg-gray-200 mx-1" />

          <button
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo"
            disabled={!editor.can().undo()}
            className="px-2 h-8 rounded text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30 transition-colors"
          >
            Undo
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo"
            disabled={!editor.can().redo()}
            className="px-2 h-8 rounded text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30 transition-colors"
          >
            Redo
          </button>
        </div>
      )}

      {/* Editor canvas */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-10">
          <EditorContent editor={editor} className="tiptap-editor" />
        </div>
      </div>
    </div>
  );
}
