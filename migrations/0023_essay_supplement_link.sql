-- Links an essay to the catalog prompt it answers (counselle.supplement_prompts),
-- so adding a school can create its required supplements and the daily sync can
-- carry a school's prompt changes into the student's essays.
--
-- supplement_key is domain.supplements.prompt_key(prompt) -- the identity of the
-- prompt's text. supplement_prompt and supplement_word_limit snapshot the
-- catalog's wording and limit as last applied to the essay: sync compares the
-- catalog against them, never against the student-editable prompt/word_limit,
-- so a limit the student typed in is not mistaken for a school change. When a
-- school rewords a prompt, sync moves the essay to the new key and records the
-- old wording in prompt_previous with prompt_updated_at; when a school drops
-- one, it sets prompt_removed_at. The student's own text is never touched.
--
-- supplement_schools.essays_synced_sha256 is the prompts_sha256 whose changes
-- have reached every student's essays; a school where the two differ is still
-- owed that step, so a sync interrupted between saving the catalog and
-- updating essays finishes on the next pass instead of being forgotten.
-- depends: 0022_school_supplements

ALTER TABLE counselle.essays
  ADD COLUMN supplement_key         text,
  ADD COLUMN supplement_prompt      text,
  ADD COLUMN supplement_word_limit  integer,
  ADD COLUMN prompt_previous        text,
  ADD COLUMN prompt_updated_at      timestamptz,
  ADD COLUMN prompt_removed_at      timestamptz;

-- One active essay per prompt per application. Archived ones stay, and still
-- count: a supplement the student deleted is never re-created for them.
CREATE UNIQUE INDEX essays_application_supplement_active_idx
  ON counselle.essays (application_id, supplement_key)
  WHERE supplement_key IS NOT NULL AND archived_at IS NULL;

ALTER TABLE counselle.supplement_schools
  ADD COLUMN essays_synced_sha256 text;
