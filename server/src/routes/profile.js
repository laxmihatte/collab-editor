const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

// Avatars are generated monograms, so customization is a colour choice rather
// than an upload. No file storage, no image processing, no moderation surface.
const AVATAR_COLORS = ['indigo', 'violet', 'sky', 'emerald', 'amber', 'rose', 'slate'];
const THEMES = ['system', 'light', 'dark'];
const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/;
const MAX_BIO = 280;

const PUBLIC_FIELDS = `id, email, name, username, bio, school, grad_year,
                       avatar_color, theme, created_at`;

// GET /api/profile/me — the signed-in user's own profile.
router.get('/me', async (req, res) => {
  try {
    const result = await db.query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [
      req.user.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('get profile error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/profile/me/stats — counts for the profile header.
router.get('/me/stats', async (req, res) => {
  try {
    // One round trip instead of four. Each scalar subquery is independently
    // indexed, and the planner runs them once each rather than per row.
    const result = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM notes WHERE owner_id = $1) AS notes_owned,
         (SELECT COUNT(*)::int FROM note_permissions WHERE user_id = $1) AS notes_shared_with_me,
         (SELECT COUNT(*)::int FROM note_permissions p
            JOIN notes n ON n.id = p.note_id WHERE n.owner_id = $1) AS collaborators,
         (SELECT COUNT(*)::int FROM reactions r
            JOIN notes n ON n.id = r.note_id WHERE n.owner_id = $1) AS reactions_received`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('get stats error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/profile/me — update the signed-in user's profile.
router.patch('/me', async (req, res) => {
  const { name, username, bio, school, grad_year, avatar_color, theme } = req.body;

  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }
  if (username !== undefined && username !== null && !USERNAME_REGEX.test(String(username))) {
    return res
      .status(400)
      .json({ error: 'Username must be 3–24 characters: lowercase letters, numbers, underscore' });
  }
  if (bio !== undefined && String(bio).length > MAX_BIO) {
    return res.status(400).json({ error: `Bio must be ${MAX_BIO} characters or fewer` });
  }
  if (avatar_color !== undefined && !AVATAR_COLORS.includes(avatar_color)) {
    return res.status(400).json({ error: 'Unknown avatar colour' });
  }
  if (theme !== undefined && !THEMES.includes(theme)) {
    return res.status(400).json({ error: 'Unknown theme' });
  }
  if (
    grad_year !== undefined &&
    grad_year !== null &&
    (!Number.isInteger(grad_year) || grad_year < 1950 || grad_year > 2100)
  ) {
    return res.status(400).json({ error: 'Graduation year looks wrong' });
  }

  try {
    const result = await db.query(
      `UPDATE users SET
         name         = COALESCE($1, name),
         username     = COALESCE($2, username),
         bio          = COALESCE($3, bio),
         school       = COALESCE($4, school),
         grad_year    = COALESCE($5, grad_year),
         avatar_color = COALESCE($6, avatar_color),
         theme        = COALESCE($7, theme)
       WHERE id = $8
       RETURNING ${PUBLIC_FIELDS}`,
      [
        name?.trim() ?? null,
        username ?? null,
        bio ?? null,
        school?.trim() ?? null,
        grad_year ?? null,
        avatar_color ?? null,
        theme ?? null,
        req.user.id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    // The unique index on username is what actually prevents duplicates. A
    // check-then-insert would leave a window where two signups take the same
    // name; letting Postgres reject it closes that window.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That username is taken' });
    }
    console.error('update profile error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/profile/options — valid choices, so the UI and API cannot drift.
router.get('/options', (req, res) => {
  res.json({ avatar_colors: AVATAR_COLORS, themes: THEMES });
});

module.exports = router;
