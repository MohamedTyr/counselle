DROP INDEX counselle.essays_application_supplement_active_idx;
ALTER TABLE counselle.essays
  DROP COLUMN supplement_key,
  DROP COLUMN prompt_previous,
  DROP COLUMN prompt_updated_at,
  DROP COLUMN prompt_removed_at;
