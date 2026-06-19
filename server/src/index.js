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

const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const { userCanAccess, getDoc, scheduleSave, release } = require('./lib/documentStore');

const app = express();
const httpServer = http.createServer(app);

// Socket.io is attached to the same HTTP server so they share one port
const io = new Server(httpServer, {
  cors: {
    origin: config.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true, // allow the browser to send the auth cookie
  },
});

app.use(helmet());
app.use(cors({ origin: config.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// --- Real-time collaboration with Yjs ---
// Document state is managed by lib/documentStore: loaded from Postgres on first
// access, kept in memory while clients are editing, debounce-saved on changes,
// and evicted when the last client leaves.

// Authenticate every socket connection using the same JWT as the REST API.
// The browser sends the httpOnly auth cookie automatically with the handshake
// (because the client connects with withCredentials). We also accept an
// auth.token for non-browser clients. Without this, anyone could join any
// document room and read/write freely.
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
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'user:', socket.user.id);

  // Client joins a document "room" — only if they own it or have permission.
  socket.on('join-document', async (documentId) => {
    try {
      const allowed = await userCanAccess(documentId, socket.user.id);
      if (!allowed) {
        socket.emit('document-error', 'Access denied');
        return;
      }

      socket.join(documentId);
      const ydoc = await getDoc(documentId);

      // Send the current state to the newly joined client (binary).
      socket.emit('load-document', Y.encodeStateAsUpdate(ydoc));
      console.log(`Socket ${socket.id} joined document ${documentId}`);
    } catch (err) {
      console.error('join-document error:', err.message);
      socket.emit('document-error', 'Could not open document');
    }
  });

  // Apply an incoming edit and broadcast it. Writes are only accepted for rooms
  // the socket has actually joined (which required passing the access check).
  socket.on('send-changes', async ({ documentId, update }) => {
    if (!socket.rooms.has(documentId)) return;

    try {
      const ydoc = await getDoc(documentId);
      Y.applyUpdate(ydoc, new Uint8Array(update));
      socket.to(documentId).emit('receive-changes', update);
      scheduleSave(documentId);
    } catch (err) {
      console.error('send-changes error:', err.message);
    }
  });

  // Broadcast cursor position to others in the same (joined) room.
  socket.on('cursor-update', ({ documentId, cursor }) => {
    if (!socket.rooms.has(documentId)) return;
    socket.to(documentId).emit('cursor-update', { socketId: socket.id, cursor });
  });

  // On disconnect, flush + evict any document whose room is now empty.
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      // rooms still include this socket here; size 1 means it's the last one.
      const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
      if (size <= 1) {
        release(room).catch((err) =>
          console.error(`release(${room}) failed:`, err.message)
        );
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

httpServer.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT}`);
});
