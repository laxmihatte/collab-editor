const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { getRole } = require('../lib/noteStore');

const router = express.Router();

router.use(authMiddleware);

const VALID_LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'go', 'rust'];
const MAX_TAGS = 12;

/** Normalize a client-supplied tag list: trimmed, lowercased, unique, capped. */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  const cleaned = tags
    .filter((t) => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 32);
  return [...new Set(cleaned)].slice(0, MAX_TAGS);
}

// GET /api/notes — the user's library, with optional search and filters.
//
//   ?q=binary+search   full-text over title + body
//   ?course=CS+2110    exact course match
//   ?tag=recursion     tag containment (repeatable)
router.get('/', async (req, res) => {
  const { q, course, tag } = req.query;

  // Conditions are accumulated as parameterized fragments so every user value
  // reaches Postgres as a bound parameter, never as concatenated SQL.
  const conditions = ['(n.owner_id = $1 OR p.user_id = $1)'];
  const params = [req.user.id];

  if (q && q.trim()) {
    params.push(q.trim());
    // Repeats the indexed expression verbatim so the planner can use
    // idx_notes_search instead of recomputing tsvectors per row.
    conditions.push(
      `to_tsvector('english', n.title || ' ' || n.content_text)
         @@ plainto_tsquery('english', $${params.length})`
    );
  }

  if (course && course.trim()) {
    params.push(course.trim());
    conditions.push(`n.course = $${params.length}`);
  }

  const tags = normalizeTags([].concat(tag ?? []));
  if (tags && tags.length > 0) {
    params.push(tags);
    conditions.push(`n.tags @> $${params.length}`);
  }

  try {
    const result = await db.query(
      `SELECT DISTINCT n.id, n.title, n.course, n.tags, n.language, n.is_public,
              n.owner_id, n.created_at, n.updated_at,
              (n.owner_id = $1) AS is_owner,
              -- Cheap preview for the library cards; the full body is only
              -- loaded when a note is actually opened.
              left(n.content_text, 180) AS excerpt
         FROM notes n
         LEFT JOIN note_permissions p ON p.note_id = n.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY n.updated_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('list notes error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notes/courses — distinct courses, for the sidebar filter.
router.get('/courses', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT n.course, COUNT(*)::int AS count
         FROM notes n
         LEFT JOIN note_permissions p ON p.note_id = n.id
        WHERE (n.owner_id = $1 OR p.user_id = $1) AND n.course IS NOT NULL
        GROUP BY n.course
        ORDER BY count DESC, n.course`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('list courses error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notes
router.post('/', async (req, res) => {
  const { title, course, language } = req.body;
  const tags = normalizeTags(req.body.tags) ?? [];

  if (language && !VALID_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: 'Unsupported language' });
  }

  try {
    const result = await db.query(
      `INSERT INTO notes (title, course, tags, language, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, course, tags, language, is_public, created_at, updated_at`,
      [title?.trim() || 'Untitled', course?.trim() || null, tags, language || 'python', req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('create note error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notes/:id — metadata for one note, plus the caller's role.
// Opening a note also records a view, which is what powers "recently viewed by".
router.get('/:id', async (req, res) => {
  try {
    const role = await getRole(req.params.id, req.user.id);
    if (!role) return res.status(404).json({ error: 'Note not found or access denied' });

    const result = await db.query(
      `SELECT n.id, n.title, n.course, n.tags, n.language, n.is_public,
              n.owner_id, n.created_at, n.updated_at,
              u.name AS owner_name, u.avatar_color AS owner_avatar_color
         FROM notes n JOIN users u ON u.id = n.owner_id
        WHERE n.id = $1`,
      [req.params.id]
    );

    // ON CONFLICT turns "insert a view or bump the existing one" into a single
    // statement, so two tabs opening at once cannot race into duplicate rows.
    await db.query(
      `INSERT INTO note_views (note_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (note_id, user_id)
       DO UPDATE SET last_viewed_at = NOW(), view_count = note_views.view_count + 1`,
      [req.params.id, req.user.id]
    );

    res.json({ ...result.rows[0], role });
  } catch (err) {
    console.error('get note error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/notes/:id — update metadata.
// Editors may retitle and re-tag; only the owner may change visibility.
router.patch('/:id', async (req, res) => {
  const { title, course, language, is_public } = req.body;
  const tags = normalizeTags(req.body.tags);

  if (language && !VALID_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: 'Unsupported language' });
  }

  try {
    const role = await getRole(req.params.id, req.user.id);
    if (!role) return res.status(404).json({ error: 'Note not found' });
    if (role === 'viewer') {
      return res.status(403).json({ error: 'Viewers cannot modify this note' });
    }
    if (is_public !== undefined && role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can change visibility' });
    }

    // COALESCE lets one statement handle a partial update: any field the client
    // omitted arrives as NULL and falls through to the column's current value.
    const result = await db.query(
      `UPDATE notes
          SET title    = COALESCE($1, title),
              course   = COALESCE($2, course),
              tags     = COALESCE($3, tags),
              language = COALESCE($4, language),
              is_public = COALESCE($5, is_public),
              updated_at = NOW()
        WHERE id = $6
        RETURNING id, title, course, tags, language, is_public, updated_at`,
      [
        title?.trim() || null,
        course === null ? null : course?.trim() || null,
        tags,
        language ?? null,
        is_public ?? null,
        req.params.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('update note error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notes/:id — owner only.
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM notes WHERE id = $1 AND owner_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Note not found or not authorized' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('delete note error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notes/:id/viewers — durable view history (distinct from live presence).
router.get('/:id/viewers', async (req, res) => {
  try {
    if (!(await getRole(req.params.id, req.user.id))) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const result = await db.query(
      `SELECT u.id, u.name, u.avatar_color, v.last_viewed_at, v.view_count
         FROM note_views v JOIN users u ON u.id = v.user_id
        WHERE v.note_id = $1
        ORDER BY v.last_viewed_at DESC
        LIMIT 50`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('list viewers error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Sharing ─────────────────────────────────────────────────────────────────
// Only the owner may view or change who has access.

async function requireOwnership(noteId, userId) {
  const result = await db.query('SELECT owner_id FROM notes WHERE id = $1', [noteId]);
  const note = result.rows[0];
  if (!note) return { error: 404 };
  if (note.owner_id !== userId) return { error: 403 };
  return { ok: true };
}

function denyIfNotOwner(check, res) {
  if (check.error === 404) {
    res.status(404).json({ error: 'Note not found' });
    return true;
  }
  if (check.error === 403) {
    res.status(403).json({ error: 'Only the owner can manage sharing' });
    return true;
  }
  return false;
}

router.get('/:id/permissions', async (req, res) => {
  try {
    const check = await requireOwnership(req.params.id, req.user.id);
    if (denyIfNotOwner(check, res)) return;

    const result = await db.query(
      `SELECT u.id, u.email, u.name, u.avatar_color, p.role
         FROM note_permissions p JOIN users u ON u.id = p.user_id
        WHERE p.note_id = $1
        ORDER BY u.email`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('list permissions error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/permissions', async (req, res) => {
  const { email, role } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (role && !['viewer', 'editor'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "viewer" or "editor"' });
  }

  try {
    const check = await requireOwnership(req.params.id, req.user.id);
    if (denyIfNotOwner(check, res)) return;

    const userResult = await db.query(
      'SELECT id, email, name, avatar_color FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const target = userResult.rows[0];
    if (!target) return res.status(404).json({ error: 'No user with that email' });
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You already own this note' });
    }

    await db.query(
      `INSERT INTO note_permissions (note_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (note_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [req.params.id, target.id, role || 'editor']
    );

    // The socket layer caches roles for the life of a connection, so a change
    // made here would not reach a collaborator who is already connected.
    // Dropping them from the room forces a rejoin, which re-reads the role.
    await req.app.get('revokeAccess')?.(req.params.id, target.id);

    res.status(201).json({ ...target, role: role || 'editor' });
  } catch (err) {
    console.error('grant permission error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/permissions/:userId', async (req, res) => {
  try {
    const check = await requireOwnership(req.params.id, req.user.id);
    if (denyIfNotOwner(check, res)) return;

    await db.query('DELETE FROM note_permissions WHERE note_id = $1 AND user_id = $2', [
      req.params.id,
      req.params.userId,
    ]);

    // Disconnect them now rather than letting an open session keep editing.
    await req.app.get('revokeAccess')?.(req.params.id, req.params.userId);

    res.json({ success: true });
  } catch (err) {
    console.error('revoke permission error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
