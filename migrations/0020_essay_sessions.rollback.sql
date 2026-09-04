-- Drops the sessions -> essays link added in 0020_essay_sessions.sql.
--
-- NOTE: this is lossy in one direction only. Which essay a session belonged to
-- is forgotten, so after a rollback + re-apply every essay's panel starts a
-- fresh thread; the old session rows and their checkpoints survive untouched,
-- they just become ordinary chats and reappear in the main chat list (which
-- filters on essay_id IS NULL). No conversation content is deleted.
--
-- The index is dropped explicitly before the column for readability; DROP
-- COLUMN would take it anyway.

DROP INDEX counselle.sessions_essay_id_idx;
ALTER TABLE counselle.sessions DROP COLUMN essay_id;
