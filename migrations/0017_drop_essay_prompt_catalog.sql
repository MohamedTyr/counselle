-- Drop the unused school essay-prompt catalog (plans/essay-creation-simplification.md §5.1).
-- Nothing ever wrote to school_prompt_groups / school_essay_prompts outside tests; the
-- create-essay flow no longer reads or writes prompt_ref. school_requirements and its
-- trigger/function are a different feature and are deliberately left untouched.
-- depends: 0016_cds_pending_edit_base_extraction

-- 1. Backfill first, before anything is dropped. Catalog-linked essays store prompt = NULL
--    and read the text through the prompt_ref join; without this, dropping the column
--    would silently lose their prompt. Expected to affect zero rows in production.
UPDATE counselle.essays e
   SET prompt = p.prompt, word_limit = COALESCE(e.word_limit, p.word_limit)
  FROM counselle.school_essay_prompts p
 WHERE e.prompt_ref = p.id;

-- 2. Drop the index and column that reference school_essay_prompts.
DROP INDEX counselle.essays_application_prompt_active_idx;
ALTER TABLE counselle.essays DROP COLUMN prompt_ref;

-- 3. Drop the immutability triggers + functions, child table first (school_essay_prompts
--    FKs to school_prompt_groups).
DROP TRIGGER protect_published_essay_prompt_facts ON counselle.school_essay_prompts;
DROP FUNCTION counselle.protect_published_essay_prompt_facts();

DROP TRIGGER protect_published_prompt_group_facts ON counselle.school_prompt_groups;
DROP FUNCTION counselle.protect_published_prompt_group_facts();

-- 4. Drop the tables, child first.
DROP TABLE counselle.school_essay_prompts;
DROP TABLE counselle.school_prompt_groups;
