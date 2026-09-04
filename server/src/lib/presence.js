// Live viewer activity.
//
// Who is *currently* looking at a note is ephemeral: it is only true while a
// socket is open, and it is worthless after a restart. So it lives in memory
// here, not in Postgres. The durable half — who has ever opened a note, and
// when they were last there — is the note_views table, written on join.
//
// Keyed noteId → Map(socketId → viewer). Keying on socketId rather than userId
// means one user with the note open in two tabs is two entries; the roster is
// de-duplicated by userId on the way out, so they appear once with an accurate
// tab count.

const rooms = new Map();

/** Record a socket as viewing a note. Returns the updated roster. */
function join(noteId, socketId, viewer) {
  let room = rooms.get(noteId);
  if (!room) {
    room = new Map();
    rooms.set(noteId, room);
  }
  room.set(socketId, { ...viewer, joinedAt: Date.now(), activeAt: Date.now() });
  return roster(noteId);
}

/** Remove a socket. Returns the updated roster (empty if the room is gone). */
function leave(noteId, socketId) {
  const room = rooms.get(noteId);
  if (!room) return [];

  room.delete(socketId);
  if (room.size === 0) rooms.delete(noteId);
  return roster(noteId);
}

/** Remove a socket from every room it was in. Returns the affected noteIds. */
function leaveAll(socketId) {
  const affected = [];
  for (const [noteId, room] of rooms) {
    if (room.delete(socketId)) {
      affected.push(noteId);
      if (room.size === 0) rooms.delete(noteId);
    }
  }
  return affected;
}

/**
 * Mark a viewer as actively editing rather than idly reading. The client sends
 * this on keystrokes; the roster exposes it so the UI can distinguish someone
 * typing from someone who opened the tab an hour ago.
 */
function touch(noteId, socketId) {
  const viewer = rooms.get(noteId)?.get(socketId);
  if (viewer) viewer.activeAt = Date.now();
}

/**
 * The current viewers of a note, one entry per user (not per socket).
 * Sorted by join time so the list does not reshuffle on every update.
 */
function roster(noteId) {
  const room = rooms.get(noteId);
  if (!room) return [];

  const byUser = new Map();
  for (const viewer of room.values()) {
    const existing = byUser.get(viewer.userId);
    if (existing) {
      existing.tabs += 1;
      existing.joinedAt = Math.min(existing.joinedAt, viewer.joinedAt);
      existing.activeAt = Math.max(existing.activeAt, viewer.activeAt);
    } else {
      byUser.set(viewer.userId, { ...viewer, tabs: 1 });
    }
  }

  return [...byUser.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

module.exports = { join, leave, leaveAll, touch, roster };
