-- Links an essay to the catalog prompt it answers (counselle.supplement_prompts),
-- so adding a school can create its required supplements and the daily sync can
-- carry a school's prompt changes into the student's essays.
--
-- supplement_key is domain.supplements.prompt_key(prompt) -- the identity of the
-- prompt's text. When a school rewords a prompt, sync moves the essay to the new
-- key and records the old wording in prompt_previous with prompt_updated_at;
-- when a school drops one, it sets prompt_removed_at. The student's own text is
-- never touched by either.
-- depends: 0022_school_supplements

ALTER TABLE counselle.essays
  ADD COLUMN supplement_key     text,
  ADD COLUMN prompt_previous    text,
  ADD COLUMN prompt_updated_at  timestamptz,
  ADD COLUMN prompt_removed_at  timestamptz;

-- One active essay per prompt per application. Archived ones stay, and still
-- count: a supplement the student deleted is never re-created for them.
CREATE UNIQUE INDEX essays_application_supplement_active_idx
  ON counselle.essays (application_id, supplement_key)
  WHERE supplement_key IS NOT NULL AND archived_at IS NULL;
