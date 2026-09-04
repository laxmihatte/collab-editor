const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { canView } = require('../lib/noteStore');

// mergeParams lets this router read :noteId from the path it is mounted under,
// keeping reaction handling out of the already-long notes router.
const router = express.Router({ mergeParams: true });

router.use(authMiddleware);

// A fixed palette rather than arbitrary user input. Free-form emoji would mean
// validating grapheme clusters and would let the reaction bar grow unbounded.
const ALLOWED = ['👍', '🔥', '🤯', '❓', '✅', '🐛'];

/**
 * Current reaction counts for a note, and whether the caller reacted.
 *
 * bool_or(...) computes "did I react with this emoji" inside the same
 * aggregate pass, so the UI's highlighted state needs no second query.
 */
async function summary(noteId, userId) {
  const result = await db.query(
    `SELECT r.emoji,
            COUNT(*)::int AS count,
            bool_or(r.user_id = $2) AS reacted,
            (array_agg(u.name ORDER BY r.created_at))[1:5] AS names
       FROM reactions r JOIN users u ON u.id = r.user_id
      WHERE r.note_id = $1
      GROUP BY r.emoji
      ORDER BY count DESC, r.emoji`,
    [noteId, userId]
  );
  return result.rows;
}

// GET /api/notes/:noteId/reactions
router.get('/', async (req, res) => {
  try {
    if (!(await canView(req.params.noteId, req.user.id))) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(await summary(req.params.noteId, req.user.id));
  } catch (err) {
    console.error('list reactions error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notes/:noteId/reactions — toggle one emoji for the caller.
//
// Viewers may react. That is deliberate: reacting is feedback on someone
// else's note, not a modification of it, so it is gated on canView.
router.post('/', async (req, res) => {
  const { emoji } = req.body;

  if (!ALLOWED.includes(emoji)) {
    return res.status(400).json({ error: 'Unsupported reaction' });
  }

  try {
    if (!(await canView(req.params.noteId, req.user.id))) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Toggle in one statement. A DELETE that reports how many rows it removed
    // tells us whether the reaction existed, so there is no read-then-write
    // gap where a double-click could insert twice.
    const removed = await db.query(
      'DELETE FROM reactions WHERE note_id = $1 AND user_id = $2 AND emoji = $3',
      [req.params.noteId, req.user.id, emoji]
    );

    if (removed.rowCount === 0) {
      await db.query(
        `INSERT INTO reactions (note_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [req.params.noteId, req.user.id, emoji]
      );
    }

    res.json({
      reactions: await summary(req.params.noteId, req.user.id),
      active: removed.rowCount === 0,
    });
  } catch (err) {
    console.error('toggle reaction error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router, ALLOWED };
