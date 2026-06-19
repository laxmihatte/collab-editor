const Y = require('yjs');
const db = require('../db');

// In-memory cache of active Yjs documents, keyed by documentId.
// Each entry: { ydoc: Y.Doc, saveTimer: NodeJS.Timeout | null }
// Documents are loaded from Postgres on first access and evicted from memory
// once their room empties, so memory usage tracks active editing — not the
// total number of documents that have ever been opened.
const docs = new Map();

const SAVE_DEBOUNCE_MS = 2000;

/**
 * Returns true if the user owns the document or has been granted a permission.
 * This is the same check the REST routes use, applied to the socket layer.
 */
async function userCanAccess(documentId, userId) {
  const result = await db.query(
    `SELECT 1
       FROM documents d
       LEFT JOIN document_permissions dp ON dp.document_id = d.id
      WHERE d.id = $1 AND (d.owner_id = $2 OR dp.user_id = $2)
      LIMIT 1`,
    [documentId, userId]
  );
  return result.rows.length > 0;
}

/**
 * Get the live Y.Doc for a document, hydrating it from the persisted snapshot
 * in the `content` column the first time it's requested.
 */
async function getDoc(documentId) {
  const existing = docs.get(documentId);
  if (existing) return existing.ydoc;

  const ydoc = new Y.Doc();

  const result = await db.query('SELECT content FROM documents WHERE id = $1', [documentId]);
  const content = result.rows[0]?.content;
  if (content) {
    // BYTEA comes back from pg as a Node Buffer, which Uint8Array accepts.
    Y.applyUpdate(ydoc, new Uint8Array(content));
  }

  docs.set(documentId, { ydoc, saveTimer: null });
  return ydoc;
}

/** Persist the current Yjs state to Postgres immediately. */
async function persist(documentId) {
  const entry = docs.get(documentId);
  if (!entry) return;

  const state = Y.encodeStateAsUpdate(entry.ydoc);
  await db.query(
    'UPDATE documents SET content = $1, updated_at = NOW() WHERE id = $2',
    [Buffer.from(state), documentId]
  );
}

/**
 * Schedule a debounced save. Rapid keystrokes collapse into a single write
 * a couple of seconds after the last edit.
 */
function scheduleSave(documentId) {
  const entry = docs.get(documentId);
  if (!entry) return;

  if (entry.saveTimer) clearTimeout(entry.saveTimer);
  entry.saveTimer = setTimeout(() => {
    entry.saveTimer = null;
    persist(documentId).catch((err) =>
      console.error(`Failed to persist document ${documentId}:`, err.message)
    );
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Flush any pending save and evict the document from memory.
 * Called when the last editor leaves a room.
 */
async function release(documentId) {
  const entry = docs.get(documentId);
  if (!entry) return;

  if (entry.saveTimer) {
    clearTimeout(entry.saveTimer);
    entry.saveTimer = null;
  }
  await persist(documentId).catch((err) =>
    console.error(`Failed to flush document ${documentId} on release:`, err.message)
  );
  entry.ydoc.destroy();
  docs.delete(documentId);
}

module.exports = { userCanAccess, getDoc, scheduleSave, release };
