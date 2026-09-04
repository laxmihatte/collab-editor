-- 001 — Collab Editor → NoteCraft
--
-- Renames documents to notes and adds the note-taking feature set: profiles,
-- courses/tags, reactions, viewer activity, and full-text search.
-- Safe to run on an existing collab_editor database.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Profile columns on users ────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS school TEXT,
  ADD COLUMN IF NOT EXISTS grad_year INT,
  ADD COLUMN IF NOT EXISTS avatar_color TEXT NOT NULL DEFAULT 'indigo',
  ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_grad_year_check
    CHECK (grad_year BETWEEN 1950 AND 2100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_theme_check
    CHECK (theme IN ('system', 'light', 'dark'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── documents → notes ───────────────────────────────────────────────────────
-- ALTER TABLE ... RENAME preserves data, indexes, constraints and foreign keys;
-- it is a catalog-only change, so it is instant regardless of table size.
ALTER TABLE IF EXISTS documents RENAME TO notes;
ALTER TABLE IF EXISTS document_permissions RENAME TO note_permissions;
ALTER TABLE IF EXISTS note_permissions RENAME COLUMN document_id TO note_id;

ALTER INDEX IF EXISTS idx_documents_owner_id RENAME TO idx_notes_owner_id;
ALTER INDEX IF EXISTS idx_document_permissions_user_id RENAME TO idx_note_permissions_user_id;

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS course TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'python',
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- The original schema left owner_id nullable; a note with no owner has no
-- possible access rule, so tighten it now that the app always sets it.
UPDATE notes SET owner_id = (SELECT id FROM users ORDER BY created_at LIMIT 1)
  WHERE owner_id IS NULL;
ALTER TABLE notes ALTER COLUMN owner_id SET NOT NULL;

-- ── Reactions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reactions (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (char_length(emoji) <= 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id, emoji)
);

-- ── Viewer activity ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_views (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  view_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (note_id, user_id)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_note_id ON reactions(note_id);
CREATE INDEX IF NOT EXISTS idx_note_views_note_id ON note_views(note_id, last_viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_notes_search ON notes USING GIN (
  to_tsvector('english', title || ' ' || content_text)
);

COMMIT;
