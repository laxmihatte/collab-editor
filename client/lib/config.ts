/**
 * Where the API lives, relative to the page.
 *
 * In development the client is on :3000 and the API on :3001, so requests are
 * cross-origin. In production both sit behind one reverse proxy on the same
 * domain, and the correct base URL is the empty string — meaning "same origin,
 * use a relative path". That is the whole reason for `??` instead of `||`
 * here: an empty string is a deliberate value, and `||` would discard it and
 * fall back to localhost in production.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so this is fixed when the
 * image is built, not when the container starts.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Socket.io connects to the same place. Passing undefined (rather than an
 * empty string) makes the client default to the page's own origin.
 */
export const SOCKET_URL = API_BASE || undefined;
