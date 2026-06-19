const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// All document routes require the user to be logged in
router.use(authMiddleware);

// GET /api/documents — list all documents the user owns or has access to
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT d.id, d.title, d.created_at, d.updated_at, d.owner_id
       FROM documents d
       LEFT JOIN document_permissions dp ON dp.document_id = d.id
       WHERE d.owner_id = $1 OR dp.user_id = $1
       ORDER BY d.updated_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('list documents error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/documents — create a new document
router.post('/', async (req, res) => {
  const { title } = req.body;

  try {
    const result = await db.query(
      'INSERT INTO documents (title, owner_id) VALUES ($1, $2) RETURNING id, title, created_at',
      [title || 'Untitled', req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/documents/:id — get a single document (checks permission)
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT d.id, d.title, d.owner_id, d.created_at, d.updated_at
       FROM documents d
       LEFT JOIN document_permissions dp ON dp.document_id = d.id
       WHERE d.id = $1 AND (d.owner_id = $2 OR dp.user_id = $2)`,
      [req.params.id, req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('get document error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/documents/:id — update document title
router.patch('/:id', async (req, res) => {
  const { title } = req.body;

  try {
    const result = await db.query(
      `UPDATE documents SET title = $1, updated_at = NOW()
       WHERE id = $2 AND owner_id = $3
       RETURNING id, title, updated_at`,
      [title, req.params.id, req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Document not found or not authorized' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('update document error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM documents WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Document not found or not authorized' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('delete document error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Sharing / collaborators ---
// Only the document owner may view or change who has access.

async function requireOwnership(documentId, userId) {
  const result = await db.query(
    'SELECT owner_id FROM documents WHERE id = $1',
    [documentId]
  );
  const doc = result.rows[0];
  if (!doc) return { error: 404 };
  if (doc.owner_id !== userId) return { error: 403 };
  return { ok: true };
}

// GET /api/documents/:id/permissions — list collaborators (owner only)
router.get('/:id/permissions', async (req, res) => {
  try {
    const check = await requireOwnership(req.params.id, req.user.id);
    if (check.error === 404) return res.status(404).json({ error: 'Document not found' });
    if (check.error === 403) return res.status(403).json({ error: 'Only the owner can manage sharing' });

    const result = await db.query(
      `SELECT u.id, u.email, u.name, dp.role
         FROM document_permissions dp
         JOIN users u ON u.id = dp.user_id
        WHERE dp.document_id = $1
        ORDER BY u.email`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('list permissions error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/documents/:id/permissions — grant access by email (owner only)
router.post('/:id/permissions', async (req, res) => {
  const { email, role } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (role && !['viewer', 'editor'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "viewer" or "editor"' });
  }

  try {
    const check = await requireOwnership(req.params.id, req.user.id);
    if (check.error === 404) return res.status(404).json({ error: 'Document not found' });
    if (check.error === 403) return res.status(403).json({ error: 'Only the owner can manage sharing' });

    const userResult = await db.query(
      'SELECT id, email, name FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const target = userResult.rows[0];
    if (!target) return res.status(404).json({ error: 'No user with that email' });
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You already own this document' });
    }

    await db.query(
      `INSERT INTO document_permissions (document_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [req.params.id, target.id, role || 'editor']
    );

    res.status(201).json({ id: target.id, email: target.email, name: target.name, role: role || 'editor' });
  } catch (err) {
    console.error('grant permission error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/documents/:id/permissions/:userId — revoke access (owner only)
router.delete('/:id/permissions/:userId', async (req, res) => {
  try {
    const check = await requireOwnership(req.params.id, req.user.id);
    if (check.error === 404) return res.status(404).json({ error: 'Document not found' });
    if (check.error === 403) return res.status(403).json({ error: 'Only the owner can manage sharing' });

    await db.query(
      'DELETE FROM document_permissions WHERE document_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('revoke permission error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
