ALTER TABLE counselle.supplement_schools DROP COLUMN essays_synced_sha256;
DROP INDEX counselle.essays_application_supplement_active_idx;
ALTER TABLE counselle.essays
  DROP COLUMN supplement_key,
  DROP COLUMN supplement_prompt,
  DROP COLUMN supplement_word_limit,
  DROP COLUMN prompt_previous,
  DROP COLUMN prompt_updated_at,
  DROP COLUMN prompt_removed_at;
