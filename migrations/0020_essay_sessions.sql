-- Per-essay chat threads (plans/essay-ai-panel.md Part 0 C6 / Part 1 §7).
--
-- The essay editor's AI panel needs its own conversation, and that conversation
-- is a property of the essay — it must survive the student opening the essay on
-- a different browser or device — so the link lives here, not in localStorage.
--
-- One nullable column on the existing generic sessions table rather than a new
-- table: a session row already fronts the LangGraph checkpoint (ADR 0019), so
-- an essay thread is an ordinary session that happens to know which essay it
-- belongs to. Existing rows stay NULL and keep behaving exactly as before.
--
-- The partial UNIQUE index is load-bearing, not decorative: it is what makes
-- "exactly one durable thread per essay" true under concurrency, and it is the
-- conflict target app/sessions.py::get_or_create_essay_session infers with
-- ON CONFLICT (essay_id) WHERE essay_id IS NOT NULL. Without it, two racing
-- first-opens of the same essay would silently create two threads and the
-- student would lose one of them.
--
-- ON DELETE CASCADE matches every other workspace FK in this migration set
-- (e.g. sessions_user_fk in 0004_users.sql). Essays are soft-deleted via
-- archived_at and never hard-deleted, so in practice this only fires on the
-- dev-purge / account-deletion path.
-- Depends on 0018, not on 0019_drop_school_requirements: this migration only
-- touches counselle.sessions (0001) and counselle.essays (0007), and 0019 is
-- deliberately held unapplied pending owner sign-off (TODOS.md). Chaining onto
-- it would make applying this feature force that owner-gated drop. 0019 and
-- this migration are now independent siblings off 0018.
-- depends: 0018_drop_essay_prompt_drafts

ALTER TABLE counselle.sessions
  ADD COLUMN essay_id uuid REFERENCES counselle.essays(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX sessions_essay_id_idx
  ON counselle.sessions (essay_id)
  WHERE essay_id IS NOT NULL;
