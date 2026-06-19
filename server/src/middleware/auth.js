const jwt = require('jsonwebtoken');
const config = require('../config');

// This middleware runs before protected routes to verify the user is logged in.
// The token is normally delivered as an httpOnly cookie; we also accept a
// Bearer header as a fallback (useful for scripts/tests). The decoded user is
// attached to req.user so route handlers can use it.
function authMiddleware(req, res, next) {
  let token = req.cookies?.[config.AUTH_COOKIE];

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
