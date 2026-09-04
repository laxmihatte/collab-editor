-- NoteCraft schema — full definition for a fresh database.
-- Existing installs should apply db/migrations/ in order instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Users & profiles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,

  -- Profile customization. Kept on users rather than a separate profiles table:
  -- it is 1:1, always loaded with the user, and never queried independently.
  username TEXT UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  school TEXT,
  grad_year INT CHECK (grad_year BETWEEN 1950 AND 2100),
  -- Avatar is a generated monogram, so we only store the colour choice.
  avatar_color TEXT NOT NULL DEFAULT 'indigo',
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Notes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled',

  -- Yjs CRDT state, the authoritative content. Binary and opaque to SQL.
  content BYTEA,
  -- Plain-text mirror of the same content, written on each save. Exists so the
  -- database can search notes without decoding a CRDT in the query path.
  content_text TEXT NOT NULL DEFAULT '',

  course TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  -- Default language for this note's code blocks in the built-in compiler.
  language TEXT NOT NULL DEFAULT 'python',
  is_public BOOLEAN NOT NULL DEFAULT FALSE,

  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sharing ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_permissions (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id)
);

-- ── Reactions ───────────────────────────────────────────────────────────────
-- One row per (note, user, emoji). The composite primary key is what makes a
-- reaction idempotent: clicking 👍 twice cannot produce two rows.
CREATE TABLE IF NOT EXISTS reactions (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (char_length(emoji) <= 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id, emoji)
);

-- ── Viewer activity ─────────────────────────────────────────────────────────
-- Who has opened a note, and when they were last there. Live presence is held
-- in memory by the socket layer; this table is the durable history behind it.
CREATE TABLE IF NOT EXISTS note_views (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  view_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (note_id, user_id)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notes_owner_id ON notes(owner_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_permissions_user_id ON note_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_note_id ON reactions(note_id);
CREATE INDEX IF NOT EXISTS idx_note_views_note_id ON note_views(note_id, last_viewed_at DESC);

-- GIN over the tags array so `tags @> '{recursion}'` uses an index.
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes USING GIN (tags);

-- Full-text search over title + body. The expression is repeated in the search
-- query so the planner can match it to this index.
CREATE INDEX IF NOT EXISTS idx_notes_search ON notes USING GIN (
  to_tsvector('english', title || ' ' || content_text)
);
