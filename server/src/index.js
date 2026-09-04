require('dotenv').config();

const config = require('./config'); // validates required env vars, fails fast

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Y = require('yjs');

const db = require('./db');
const authRoutes = require('./routes/auth');
const noteRoutes = require('./routes/notes');
const profileRoutes = require('./routes/profile');
const { router: reactionRoutes } = require('./routes/reactions');
const { router: executeRoutes } = require('./routes/execute');
const { getRole, getDoc, scheduleSave, release } = require('./lib/noteStore');
const presence = require('./lib/presence');

const app = express();
const httpServer = http.createServer(app);

// Socket.io shares the HTTP server so both run on one port.
const io = new Server(httpServer, {
  cors: {
    origin: config.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true, // allow the browser to send the auth cookie
  },
  maxHttpBufferSize: 2e6, // a single Yjs update should never approach this
});

app.use(helmet());
app.use(cors({ origin: config.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/execute', executeRoutes);
// Mounted before the notes router so the more specific path wins.
app.use('/api/notes/:noteId/reactions', reactionRoutes);
app.use('/api/notes', noteRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// ── Real-time collaboration ─────────────────────────────────────────────────
// Note content is a Yjs CRDT: lib/noteStore loads it from Postgres on first
// access, keeps it in memory while people are editing, debounce-saves changes,
// and evicts it when the last client leaves. lib/presence tracks who is
// currently looking at each note.

// Authenticate every socket with the same JWT as the REST API. The browser
// sends the httpOnly cookie with the handshake automatically. Without this,
// anyone could join any note's room and read or write freely.
function readTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === config.AUTH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

io.use((socket, next) => {
  const token =
    readTokenFromCookie(socket.handshake.headers.cookie) || socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  try {
    socket.user = jwt.verify(token, config.JWT_SECRET);
    // Roles resolved at join time, keyed by noteId.
    //
    // Re-querying Postgres on every keystroke would put a database round trip
    // in the editing hot path. Access is established once, when the socket
    // joins the room, and cached for the life of that membership; revoking a
    // collaborator disconnects them (see revokeAccess below) rather than
    // relying on the next write to notice.
    socket.roles = new Map();
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

/** The viewer record broadcast to everyone else in a note's room. */
async function describeViewer(socket, role) {
  const result = await db.query('SELECT name, avatar_color FROM users WHERE id = $1', [
    socket.user.id,
  ]);
  const user = result.rows[0] ?? {};
  return {
    userId: socket.user.id,
    name: user.name ?? 'Someone',
    avatarColor: user.avatar_color ?? 'slate',
    role,
  };
}

io.on('connection', (socket) => {
  socket.on('join-note', async (noteId) => {
    try {
      const role = await getRole(noteId, socket.user.id);
      if (!role) {
        socket.emit('note-error', 'Access denied');
        return;
      }

      socket.roles.set(noteId, role);
      socket.join(noteId);

      const ydoc = await getDoc(noteId);
      // Binary CRDT state — the full note as of right now.
      socket.emit('load-note', Y.encodeStateAsUpdate(ydoc), { role });

      const roster = presence.join(noteId, socket.id, await describeViewer(socket, role));
      io.to(noteId).emit('viewers', roster);

      // Durable view history, separate from live presence.
      await db.query(
        `INSERT INTO note_views (note_id, user_id) VALUES ($1, $2)
         ON CONFLICT (note_id, user_id)
         DO UPDATE SET last_viewed_at = NOW(), view_count = note_views.view_count + 1`,
        [noteId, socket.user.id]
      );
    } catch (err) {
      console.error('join-note error:', err.message);
      socket.emit('note-error', 'Could not open note');
    }
  });

  socket.on('leave-note', (noteId) => {
    if (!socket.rooms.has(noteId)) return;
    socket.leave(noteId);
    socket.roles.delete(noteId);
    io.to(noteId).emit('viewers', presence.leave(noteId, socket.id));
    releaseIfEmpty(noteId);
  });

  // Apply an incoming edit and broadcast it.
  //
  // Gated on the cached *role*, not merely on room membership. Viewers are in
  // the room too — that is how they see live changes — so membership alone
  // would let them write, which is exactly the hole this replaced.
  socket.on('send-changes', async ({ noteId, update }) => {
    const role = socket.roles.get(noteId);
    if (role !== 'owner' && role !== 'editor') return;

    try {
      const ydoc = await getDoc(noteId);
      Y.applyUpdate(ydoc, new Uint8Array(update));
      socket.to(noteId).emit('receive-changes', update);
      scheduleSave(noteId);

      presence.touch(noteId, socket.id);
    } catch (err) {
      console.error('send-changes error:', err.message);
    }
  });

  // Cursor and selection positions, for collaborative cursors.
  socket.on('awareness', ({ noteId, state }) => {
    if (!socket.rooms.has(noteId)) return;
    socket.to(noteId).emit('awareness', { socketId: socket.id, state });
  });

  socket.on('disconnecting', () => {
    for (const noteId of presence.leaveAll(socket.id)) {
      io.to(noteId).emit('viewers', presence.roster(noteId));
    }
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      // socket.rooms still includes this socket here, so size 1 means last one.
      const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
      if (size <= 1) {
        release(room).catch((err) => console.error(`release(${room}) failed:`, err.message));
      }
    }
  });
});

function releaseIfEmpty(noteId) {
  const size = io.sockets.adapter.rooms.get(noteId)?.size ?? 0;
  if (size === 0) {
    release(noteId).catch((err) => console.error(`release(${noteId}) failed:`, err.message));
  }
}

/**
 * Disconnect a user from a note's room after their access is revoked.
 *
 * Because roles are cached for the life of a socket, revocation has to reach
 * into the socket layer explicitly — otherwise a collaborator who is already
 * connected would keep editing until they happened to reload.
 */
async function revokeAccess(noteId, userId) {
  const sockets = await io.in(noteId).fetchSockets();
  for (const s of sockets) {
    if (s.user?.id !== userId) continue;
    s.emit('note-error', 'Your access to this note was removed');
    s.leave(noteId);
    presence.leave(noteId, s.id);
  }
  io.to(noteId).emit('viewers', presence.roster(noteId));
}

// Let the REST layer reach the socket layer without a circular import.
app.set('revokeAccess', revokeAccess);

httpServer.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT}`);
});
