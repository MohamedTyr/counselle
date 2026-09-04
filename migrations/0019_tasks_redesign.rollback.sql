-- Structural rollback only. Rows deleted by the "Untitled task" cleanup are not
-- recoverable, and there is no reverse mapping from a when_on/flagged value
-- written after this migration back to planned_for/priority. This matches the
-- documented pattern in 0018_drop_essay_prompt_drafts.rollback.sql.

DROP INDEX counselle.tasks_user_open_deadline_idx;
DROP INDEX counselle.tasks_user_open_when_idx;
ALTER TABLE counselle.tasks DROP CONSTRAINT tasks_title_not_blank;
DROP TABLE IF EXISTS counselle._task_migration_0019_waiting_ids;

ALTER TABLE counselle.tasks
  DROP COLUMN when_on,
  DROP COLUMN deadline_on,
  DROP COLUMN done_at,
  DROP COLUMN flagged,
  DROP COLUMN created_by_actor,
  DROP COLUMN last_actor;
