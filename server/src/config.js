// Centralized environment configuration.
// Validate required variables once at startup so we fail fast with a clear
// message instead of throwing deep inside a request handler later.

const required = ['JWT_SECRET', 'DATABASE_URL'];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missing.join(', ')}.\n` +
      `Copy .env.example to .env and fill them in before starting the server.`
  );
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  PORT: process.env.PORT || 3001,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  JWT_SECRET: process.env.JWT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  isProduction,

  // Name of the auth cookie and the options used to set/clear it.
  AUTH_COOKIE: 'token',
  cookieOptions: {
    httpOnly: true, // not readable by JS → immune to XSS token theft
    // In production the client may be on a different domain, which requires
    // SameSite=None (and Secure). In dev (localhost:3000 → :3001, same site,
    // plain http) Lax works and Secure must be off or the cookie is dropped.
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches the JWT expiry
    path: '/',
  },
};
