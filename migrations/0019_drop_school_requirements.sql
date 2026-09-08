-- Drop the school_requirements catalog (plans/school-page-slim.md Phase 3). The
-- "Common items to verify" section it backed was Common App's job, not Counselle's,
-- and Phase 1/2 already removed every frontend and backend reader of it.
--
-- Unlike essay_prompt_drafts (0018), this table has no live write path: the only
-- INSERT INTO counselle.school_requirements in the repo is raw SQL inside a test
-- fixture (tests/app/test_school_workspace_live.py), so it is empty in every real
-- environment and there is nothing to migrate or convert first — this is a straight
-- structural drop.
--
-- tasks.requirement_kind (added alongside this table in 0011_school_workspace.sql)
-- is free text validated by a regex CHECK, not a foreign key to this table, so
-- dropping the table cannot orphan a task row. It is left in place; see TODOS.md.
--
-- Order: drop the trigger before its function (a function with a live trigger
-- cannot be dropped), then the table — its two indexes
-- (school_requirements_active_identity_idx, school_requirements_lookup_idx) are
-- owned by the table and are dropped implicitly with it.
-- depends: 0018_drop_essay_prompt_drafts

DROP TRIGGER protect_published_requirement_facts ON counselle.school_requirements;
DROP FUNCTION counselle.protect_published_requirement_facts();
DROP TABLE counselle.school_requirements;
