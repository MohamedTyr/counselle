-- Tasks redesign (plans/tasks-redesign-spec.md §10): collapse status → done_at,
-- add when_on/deadline_on as DATE columns replacing the timestamptz planned_for/
-- due_at, add flagged (replacing the priority scale in the UI), and add
-- created_by_actor/last_actor so a task row can answer "did Counselle create or
-- touch this" without joining counselle.workspace_changes (spec §7.1, §8.3).
--
-- Nothing is dropped here. status, priority, category, assignee, needs_input,
-- due_at, planned_for, reminder_at, completed_at all survive for one release per
-- spec §10. `status` is kept in sync with done_at by application code
-- (app/workspace/service_tasks.py), not by a trigger, because every write path
-- already funnels through that one module. The sync exists because
-- service_applications.py's progress rollup still reads status = 'done'.
--
-- depends: 0018_drop_essay_prompt_drafts

ALTER TABLE counselle.tasks
  ADD COLUMN when_on date,
  ADD COLUMN deadline_on date,
  ADD COLUMN done_at timestamptz,
  ADD COLUMN flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN created_by_actor text NOT NULL DEFAULT 'student'
    CHECK (created_by_actor IN ('student', 'counselle')),
  ADD COLUMN last_actor text NOT NULL DEFAULT 'student'
    CHECK (last_actor IN ('student', 'counselle'));

-- Backfill. The AT TIME ZONE 'UTC' cast is mandatory: due_at/planned_for are
-- timestamptz written at UTC midnight by every known writer
-- (app/workspace/agent_tools_shared.py:validate_date_field), and a bare ::date
-- cast would use the migration session's TimeZone and shift the day by one for
-- any non-UTC session.
UPDATE counselle.tasks SET
  when_on     = (planned_for AT TIME ZONE 'UTC')::date,
  deadline_on = (due_at AT TIME ZONE 'UTC')::date,
  done_at     = CASE WHEN status = 'done' THEN updated_at ELSE NULL END,
  flagged     = (priority = 'high');

-- Spec §10 row 3: a 'waiting' task with no work date gets a check-in date so it
-- surfaces somewhere. Log the ids first so the result is reviewable.
CREATE TABLE counselle._task_migration_0019_waiting_ids AS
SELECT id, user_id, title FROM counselle.tasks
WHERE status = 'waiting' AND when_on IS NULL;

UPDATE counselle.tasks
SET when_on = (current_date + 3)
WHERE status = 'waiting' AND when_on IS NULL;

-- Spec §10 last line: delete the placeholder rows the old "New task" button
-- created before the user typed anything.
DELETE FROM counselle.tasks
WHERE title = 'Untitled task'
  AND notes IS NULL
  AND application_id IS NULL
  AND essay_id IS NULL
  AND when_on IS NULL
  AND deadline_on IS NULL
  AND done_at IS NULL;

-- Spec §2.5 / §13: a task's title is never empty. Nothing enforced this before —
-- Pydantic's `title: str` accepts "".
ALTER TABLE counselle.tasks
  ADD CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> '');

-- The new views filter on (user_id, when_on) and (user_id, deadline_on) with
-- done_at IS NULL, mirroring the existing tasks_user_active_idx partial pattern.
CREATE INDEX tasks_user_open_when_idx
  ON counselle.tasks (user_id, when_on)
  WHERE archived_at IS NULL AND done_at IS NULL;
CREATE INDEX tasks_user_open_deadline_idx
  ON counselle.tasks (user_id, deadline_on)
  WHERE archived_at IS NULL AND done_at IS NULL AND deadline_on IS NOT NULL;
