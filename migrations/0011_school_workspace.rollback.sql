DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM counselle.applications
    WHERE archived_at IS NULL
    GROUP BY user_id, school_unitid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'cannot rollback 0011_school_workspace: active applications exist for multiple cycles of the same school',
      HINT = 'Archive or consolidate the conflicting application rows before retrying rollback.';
  END IF;
END
$$;

DROP TRIGGER protect_published_requirement_facts ON counselle.school_requirements;
DROP FUNCTION counselle.protect_published_requirement_facts();
DROP TRIGGER protect_published_essay_prompt_facts ON counselle.school_essay_prompts;
DROP FUNCTION counselle.protect_published_essay_prompt_facts();
DROP TRIGGER protect_published_prompt_group_facts ON counselle.school_prompt_groups;
DROP FUNCTION counselle.protect_published_prompt_group_facts();

DROP INDEX counselle.essays_application_prompt_active_idx;
ALTER TABLE counselle.essays DROP COLUMN prompt_ref;

DROP TABLE counselle.school_requirements;
DROP TABLE counselle.school_essay_prompts;
DROP TABLE counselle.school_prompt_groups;

ALTER TABLE counselle.tasks DROP COLUMN requirement_kind;

DROP INDEX counselle.applications_user_school_legacy_active_idx;
DROP INDEX counselle.applications_user_school_cycle_active_idx;
ALTER TABLE counselle.applications
  DROP CONSTRAINT applications_platform_other_check,
  DROP COLUMN platform_other,
  DROP COLUMN platform,
  DROP COLUMN checklist,
  DROP COLUMN cycle_year;
CREATE UNIQUE INDEX applications_user_school_active_idx
  ON counselle.applications (user_id, school_unitid)
  WHERE archived_at IS NULL;
