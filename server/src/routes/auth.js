const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');

const router = express.Router();

const JWT_OPTIONS = { expiresIn: '7d' };
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Throttle auth attempts to blunt brute-force / credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

router.use(authLimiter);

const normalizeEmail = (email) => email.trim().toLowerCase();

// Issue a JWT and deliver it as an httpOnly cookie rather than in the response
// body, so client-side JS (and any XSS) can never read it.
function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, email: user.email }, config.JWT_SECRET, JWT_OPTIONS);
  res.cookie(config.AUTH_COOKIE, token, config.cookieOptions);
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (!name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    // bcrypt hashes the password so we never store plaintext
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [normalizeEmail(email), passwordHash, name.trim()]
    );

    const user = result.rows[0];
    setAuthCookie(res, user);

    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error('register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    setAuthCookie(res, user);

    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout — clear the auth cookie
router.post('/logout', (req, res) => {
  // clearCookie must use the same attributes the cookie was set with
  res.clearCookie(config.AUTH_COOKIE, { ...config.cookieOptions, maxAge: undefined });
  res.json({ success: true });
});

module.exports = router;
