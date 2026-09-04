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

// In production the app is served from a single domain: a reverse proxy sends
// /api and /socket.io here and everything else to Next.js. Same-origin means
// the auth cookie can stay SameSite=Lax, which is a real security property —
// SameSite=None would attach the cookie to cross-site requests, so CSRF
// protection would have to be rebuilt by hand.
//
// It stays configurable because a split deployment (client on a CDN, API on
// its own subdomain) genuinely does need None, and that should be an explicit
// choice rather than something discovered when logins silently stop working.
const sameSite = process.env.COOKIE_SAMESITE || 'lax';

// Behind a proxy, Express sees the proxy's address on every request. Trusting
// one hop makes req.ip the client's real address, which is what the auth rate
// limiter keys on — without it the whole internet shares one bucket.
const trustProxy = process.env.TRUST_PROXY === 'true' || isProduction;

module.exports = {
  PORT: process.env.PORT || 3001,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  JWT_SECRET: process.env.JWT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  isProduction,
  trustProxy,

  // Name of the auth cookie and the options used to set/clear it.
  AUTH_COOKIE: 'token',
  cookieOptions: {
    httpOnly: true, // not readable by JS → immune to XSS token theft
    // Secure requires HTTPS. Off in dev, where localhost is plain http and the
    // browser would otherwise drop the cookie entirely.
    secure: isProduction,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches the JWT expiry
    path: '/',
  },
};
