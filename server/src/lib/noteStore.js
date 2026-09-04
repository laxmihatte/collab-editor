const Y = require('yjs');
const db = require('../db');

// In-memory cache of active Yjs notes, keyed by noteId.
// Each entry: { ydoc: Y.Doc, saveTimer: NodeJS.Timeout | null }
// Notes are loaded from Postgres on first access and evicted once their room
// empties, so memory tracks active editing — not the total number of notes.
const notes = new Map();

const SAVE_DEBOUNCE_MS = 2000;

// The name of the shared Y.Text holding the markdown body. The client binds
// the same key through y-codemirror.next; if the two ever disagree, edits sync
// to a type nobody is rendering.
const TEXT_KEY = 'content';

/**
 * Resolve what a user may do with a note.
 *
 * Returns 'owner' | 'editor' | 'viewer' | null (no access).
 *
 * Returning the *role* rather than a boolean is the point. The previous
 * version answered only "can this user see the note?", and the socket layer
 * used that same answer to gate writes — which let a user shared as a viewer
 * edit the note anyway. Callers now have to say which they mean.
 */
async function getRole(noteId, userId) {
  const result = await db.query(
    `SELECT CASE WHEN n.owner_id = $2 THEN 'owner' ELSE p.role END AS role
       FROM notes n
       LEFT JOIN note_permissions p
         ON p.note_id = n.id AND p.user_id = $2
      WHERE n.id = $1 AND (n.owner_id = $2 OR p.user_id = $2)
      LIMIT 1`,
    [noteId, userId]
  );
  return result.rows[0]?.role ?? null;
}

/** True if the user may modify the note's content. */
async function canEdit(noteId, userId) {
  const role = await getRole(noteId, userId);
  return role === 'owner' || role === 'editor';
}

/** True if the user may open the note at all. */
async function canView(noteId, userId) {
  return (await getRole(noteId, userId)) !== null;
}

/**
 * Get the live Y.Doc for a note, hydrating it from the persisted snapshot in
 * the `content` column the first time it is requested.
 */
async function getDoc(noteId) {
  const existing = notes.get(noteId);
  if (existing) return existing.ydoc;

  const ydoc = new Y.Doc();

  const result = await db.query('SELECT content FROM notes WHERE id = $1', [noteId]);
  const content = result.rows[0]?.content;
  if (content) {
    // BYTEA comes back from pg as a Node Buffer, which Uint8Array accepts.
    Y.applyUpdate(ydoc, new Uint8Array(content));
  }

  notes.set(noteId, { ydoc, saveTimer: null });
  return ydoc;
}

/**
 * Persist the current Yjs state to Postgres immediately.
 *
 * Writes the CRDT snapshot and a plain-text mirror in one statement. The
 * mirror is what the full-text index is built over: Postgres cannot read a
 * CRDT, and decoding one per row at query time would make search unusable.
 * The cost is that the two columns are only consistent as of the last save.
 */
async function persist(noteId) {
  const entry = notes.get(noteId);
  if (!entry) return;

  const state = Y.encodeStateAsUpdate(entry.ydoc);
  const text = entry.ydoc.getText(TEXT_KEY).toString();

  await db.query(
    `UPDATE notes SET content = $1, content_text = $2, updated_at = NOW() WHERE id = $3`,
    [Buffer.from(state), text, noteId]
  );
}

/**
 * Schedule a debounced save. Rapid keystrokes collapse into a single write a
 * couple of seconds after the last edit.
 */
function scheduleSave(noteId) {
  const entry = notes.get(noteId);
  if (!entry) return;

  if (entry.saveTimer) clearTimeout(entry.saveTimer);
  entry.saveTimer = setTimeout(() => {
    entry.saveTimer = null;
    persist(noteId).catch((err) =>
      console.error(`Failed to persist note ${noteId}:`, err.message)
    );
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Flush any pending save and evict the note from memory.
 * Called when the last editor leaves a room.
 */
async function release(noteId) {
  const entry = notes.get(noteId);
  if (!entry) return;

  if (entry.saveTimer) {
    clearTimeout(entry.saveTimer);
    entry.saveTimer = null;
  }
  await persist(noteId).catch((err) =>
    console.error(`Failed to flush note ${noteId} on release:`, err.message)
  );
  entry.ydoc.destroy();
  notes.delete(noteId);
}

module.exports = { TEXT_KEY, getRole, canEdit, canView, getDoc, scheduleSave, release };
