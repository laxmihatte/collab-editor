-- 002 — Cosmetic follow-up to 001.
--
-- ALTER TABLE ... RENAME only touches the table's own catalog entry, so
-- constraints created under the old name keep it. Nothing breaks, but the
-- leftover names are confusing in \d output and in error messages.

BEGIN;

ALTER TABLE notes RENAME CONSTRAINT documents_pkey TO notes_pkey;
ALTER TABLE notes RENAME CONSTRAINT documents_owner_id_fkey TO notes_owner_id_fkey;

ALTER TABLE note_permissions RENAME CONSTRAINT document_permissions_pkey TO note_permissions_pkey;
ALTER TABLE note_permissions
  RENAME CONSTRAINT document_permissions_document_id_fkey TO note_permissions_note_id_fkey;
ALTER TABLE note_permissions
  RENAME CONSTRAINT document_permissions_user_id_fkey TO note_permissions_user_id_fkey;
ALTER TABLE note_permissions
  RENAME CONSTRAINT document_permissions_role_check TO note_permissions_role_check;

COMMIT;
