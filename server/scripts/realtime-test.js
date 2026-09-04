/**
 * Realtime tests: the collaboration layer, over actual sockets.
 *
 * The REST smoke test cannot reach any of this. Yjs sync, presence, and the
 * viewer/editor split on writes all live in the socket handlers, and the
 * viewer-cannot-write rule in particular has to be proven here — enforcing it
 * only in the REST layer is exactly the bug this replaced.
 *
 * Usage: node scripts/realtime-test.js   (server must be running)
 */

const { io } = require('socket.io-client');
const Y = require('yjs');

const API = process.env.API || 'http://localhost:3001';

// INSECURE=1 accepts a locally-issued certificate, for exercising a stack
// behind Caddy's internal CA. Test-only: a real client must never do this.
const INSECURE = process.env.INSECURE === '1';

// fetch() has its own TLS stack (undici) that ignores the socket.io option
// below, so trust has to be relaxed for both.
if (INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const STAMP = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'correct-horse-battery';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${
    ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  }`);
  ok ? pass++ : fail++;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Register a user and return the session cookie the browser would hold. */
async function register(email, name) {
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  if (!res.ok) throw new Error(`register ${email} failed: ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function apiCall(cookie, method, path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A connected client with a Y.Doc wired to the socket, as the browser does. */
function connect(cookie, noteId) {
  return new Promise((resolve, reject) => {
    const socket = io(API, {
      extraHeaders: { Cookie: cookie },
      // Start on polling and let it upgrade, which is what a browser does.
      // Forcing 'websocket' would skip the upgrade path entirely — and that
      // path is the one a reverse proxy can break.
      transports: ['polling', 'websocket'],
      rejectUnauthorized: !INSECURE,
    });

    const ydoc = new Y.Doc();
    const client = { socket, ydoc, text: ydoc.getText('content'), viewers: [], errors: [] };

    ydoc.on('update', (update, origin) => {
      if (origin !== socket) socket.emit('send-changes', { noteId, update });
    });

    socket.on('load-note', (state) => {
      Y.applyUpdate(ydoc, new Uint8Array(state), socket);
      resolve(client);
    });
    socket.on('receive-changes', (update) => Y.applyUpdate(ydoc, new Uint8Array(update), socket));
    socket.on('viewers', (roster) => (client.viewers = roster));
    socket.on('note-error', (message) => {
      client.errors.push(message);
      reject(new Error(message));
    });
    socket.on('connect_error', reject);
    socket.on('connect', () => socket.emit('join-note', noteId));

    setTimeout(() => reject(new Error('timed out joining note')), 8000);
  });
}

async function main() {
  const ownerEmail = `rt-owner+${STAMP}@test.local`;
  const viewerEmail = `rt-viewer+${STAMP}@test.local`;

  const ownerCookie = await register(ownerEmail, 'Ada Lovelace');
  const viewerCookie = await register(viewerEmail, 'Grace Hopper');

  const created = await apiCall(ownerCookie, 'POST', '/notes', { title: 'Realtime test' });
  const noteId = created.body.id;
  await apiCall(ownerCookie, 'POST', `/notes/${noteId}/permissions`, {
    email: viewerEmail,
    role: 'viewer',
  });

  console.log('\nTransport');
  const owner = await connect(ownerCookie, noteId);
  const viewer = await connect(viewerCookie, noteId);
  await wait(600);
  // Socket.io opens on HTTP polling and upgrades. Behind a reverse proxy the
  // upgrade is the part that silently fails, leaving a connection that works
  // but falls back to polling every message.
  check('the connection upgraded to a websocket', owner.socket.io.engine.transport.name, 'websocket');

  console.log('\nDocument sync');

  owner.text.insert(0, '# Dijkstra\n\nRelax every edge.');
  await wait(400);
  check("the owner's edit reaches the viewer", viewer.text.toString(), '# Dijkstra\n\nRelax every edge.');

  console.log('\nConcurrent editing');
  // Two inserts at the same offset, neither client having seen the other's.
  // A last-write-wins store would drop one; a CRDT keeps both and converges.
  const second = await connect(ownerCookie, noteId);
  await wait(300);
  owner.text.insert(0, 'AAA');
  second.text.insert(0, 'BBB');
  await wait(600);
  check('both concurrent inserts survive', owner.text.toString() === second.text.toString(), true);
  check('nothing was lost', /AAA/.test(owner.text.toString()) && /BBB/.test(owner.text.toString()), true);
  second.socket.disconnect();

  console.log('\nWrite permissions');
  const before = owner.text.toString();
  viewer.text.insert(0, 'VIEWER WAS HERE ');
  await wait(500);
  check("the viewer's write is rejected by the server", owner.text.toString(), before);

  await apiCall(ownerCookie, 'POST', `/notes/${noteId}/permissions`, {
    email: viewerEmail,
    role: 'editor',
  });
  await wait(300);
  // Promotion drops the socket from the room, so the client must rejoin —
  // which is what a browser does when it sees the access-changed message.
  const promoted = await connect(viewerCookie, noteId);
  await wait(300);
  promoted.text.insert(0, 'EDITOR ');
  await wait(500);
  check('after promotion the same user can write', /^EDITOR /.test(owner.text.toString()), true);

  console.log('\nPresence');
  await wait(300);
  const names = owner.viewers.map((v) => v.name).sort();
  check('both people appear in the roster', names, ['Ada Lovelace', 'Grace Hopper']);
  promoted.socket.disconnect();
  await wait(500);
  check('leaving removes them from the roster', owner.viewers.map((v) => v.name), ['Ada Lovelace']);

  console.log('\nPersistence');
  owner.socket.disconnect();
  viewer.socket.disconnect();
  // The store debounce-saves after 2s and flushes when the room empties.
  await wait(1500);
  const reopened = await connect(ownerCookie, noteId);
  check('content survives every client leaving', /Dijkstra/.test(reopened.text.toString()), true);

  const fetched = await apiCall(ownerCookie, 'GET', `/notes?q=dijkstra`);
  check('the saved text is searchable', fetched.body.some((n) => n.id === noteId), true);
  reopened.socket.disconnect();

  console.log('\nUnauthenticated access');
  await new Promise((resolve) => {
    const anon = io(API, {
      transports: ['polling', 'websocket'],
      rejectUnauthorized: !INSECURE,
    });
    anon.on('connect_error', (err) => {
      check('a socket with no cookie is refused', err.message, 'Authentication required');
      anon.close();
      resolve();
    });
    anon.on('connect', () => {
      check('a socket with no cookie is refused', 'connected', 'rejected');
      anon.close();
      resolve();
    });
  });

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n\x1b[31mtest run failed:\x1b[0m', err.message);
  process.exit(1);
});
