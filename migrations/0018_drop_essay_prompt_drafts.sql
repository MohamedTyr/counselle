-- Drop essay_prompt_drafts (plans/essay-creation-simplification.md §5.2). Unlike the
-- catalog tables, this one has a live write path real students can reach, so every
-- active, unconverted draft is converted into a Supplement essay before the table is
-- dropped. Archived drafts are deliberately NOT converted — the student deleted them.
-- Already-converted drafts are skipped (converted_to_essay_id is set) to avoid creating
-- a duplicate essay alongside the one convert_essay_prompt_draft already made.
--
-- Drafts whose owning application is archived are also excluded, same as archived
-- drafts: the preceding backend commit that removed the prompt catalog from the
-- application code also removed the cascade that archived a draft when its
-- application was archived, so an active-looking draft can now belong to an archived
-- application. Converting it would resurrect a put-away draft as a new active essay
-- attached to an archived application — service_essays._ESSAY_LIST_SQL filters on the
-- essay's own archived_at but not the application's, so it would silently reappear in
-- the student's active essay list.
--
-- created_at/updated_at are carried through explicitly from the draft. Both columns on
-- counselle.essays default to now() (migrations/0007_workspace.sql), and Postgres fixes
-- now() at transaction start, so every converted row would otherwise get an identical
-- timestamp — the moment this migration ran, not when the student wrote it — and jump to
-- the top of the student's essay list (ordered by updated_at DESC), silently reordering
-- work done that day ahead of it.
--
-- The title is the flat literal below, not a school-qualified one: counselle.applications
-- has no school_name column (school names resolve at read time from the CDS catalog via
-- school_identities()), so no .sql migration can produce a school-qualified title. See
-- plan §5.2 for the rationale and the one-off-script escape hatch if that is ever wanted.
--
-- Known consequence: this INSERT is a raw migration statement, so it bypasses
-- counselle.workspace_changes and the SSE event bus that every live essay-creation path
-- writes to. A student with an open tab at deploy time will not see the converted essay
-- appear without a refresh. Deliberately not "fixed" — synthesizing change-log rows from
-- a migration would couple the schema migration to the application's event contract.
--
-- Rehearsed against synthetic rows (including the archived-application case) in a
-- rolled-back transaction before being run for real; see the phase-2 report for the
-- rehearsal detail. Production count of active, unconverted drafts at the time this
-- migration was written: 0.
-- depends: 0017_drop_essay_prompt_catalog

INSERT INTO counselle.essays
  (user_id, application_id, title, essay_type, status, prompt, word_limit,
   created_at, updated_at)
SELECT d.user_id, d.application_id, 'Untitled supplement',
       'Supplement', 'Not started', d.prompt, d.word_limit,
       d.created_at, d.updated_at
  FROM counselle.essay_prompt_drafts d
 WHERE d.archived_at IS NULL
   AND d.converted_to_essay_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM counselle.applications a
      WHERE a.id = d.application_id AND a.archived_at IS NOT NULL
   );

DELETE FROM counselle.workspace_changes WHERE object_type = 'essay_prompt_draft';
DROP TABLE counselle.essay_prompt_drafts;
