-- Tasks redesign P9 (plans/tasks-redesign-plan.md, decision D4): manual
-- reorder within Today. Mirrors Activity/Honor's `sort_order integer NOT
-- NULL` column (migrations/0007_workspace.sql) and `PUT .../order` route,
-- with one deliberate difference: this column is nullable, backfilled NULL.
--
-- Activities and Honors always reorder their *entire* active set — every row
-- always has a sort_order because `_next_sort_order` assigns one on create.
-- Tasks are different: `sort_order` here only means "the student explicitly
-- dragged/keyboard-reordered this task within Today," which is a subset of
-- a much larger table also read by Upcoming/Anytime/Logbook. Most tasks will
-- never be reordered, so most rows should say "no explicit order" rather
-- than carry a fabricated one. NULL is that honest state, and NULLS LAST in
-- the Today comparator (frontend/src/features/tasks/task-filters.ts) means an
-- untouched task falls back to the existing (deadline/flag/created_at)
-- ordering exactly as before this migration.
--
-- depends: 0019_tasks_redesign

ALTER TABLE counselle.tasks
  ADD COLUMN sort_order integer;
