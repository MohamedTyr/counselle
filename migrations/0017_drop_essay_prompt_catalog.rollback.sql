-- Restores the school_prompt_groups / school_essay_prompts DDL exactly as it was created
-- in 0011_school_workspace.sql:30-230, plus the prompt_ref column and index on essays.
-- LIMITATION: this restores structure only. The backfill run by the forward migration
-- (copying prompt/word_limit from school_essay_prompts into essays, and clearing the
-- prompt_ref link implicitly by dropping the column) is not reversible — rows that were
-- linked via prompt_ref will come back with the catalog tables empty and no relationship
-- to re-establish. Restoring data, not just structure, would require a backup taken
-- before the forward migration ran.

CREATE TABLE counselle.school_prompt_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_unitid integer NOT NULL,
  cycle_year integer NOT NULL CHECK (cycle_year BETWEEN 2000 AND 2200),
  label text NOT NULL CHECK (btrim(label) <> ''),
  choice_min integer NOT NULL CHECK (choice_min > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retracted')),
  source text,
  source_url text,
  verified_at date,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_unitid, cycle_year),
  CHECK (
    state <> 'published' OR (
      btrim(coalesce(source, '')) <> ''
      AND source_url ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
      AND position('@' in source_url) = 0
      AND verified_at IS NOT NULL
      AND published_at IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX school_prompt_groups_active_identity_idx
  ON counselle.school_prompt_groups (school_unitid, cycle_year, label)
  WHERE retired_at IS NULL AND state <> 'retracted';
CREATE INDEX school_prompt_groups_lookup_idx
  ON counselle.school_prompt_groups (school_unitid, cycle_year);

CREATE TABLE counselle.school_essay_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_unitid integer NOT NULL,
  cycle_year integer NOT NULL CHECK (cycle_year BETWEEN 2000 AND 2200),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  word_limit integer CHECK (word_limit > 0),
  applicability text NOT NULL DEFAULT 'unknown' CHECK (
    applicability IN ('required', 'optional', 'not_required', 'conditional', 'unknown')
  ),
  audience jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience) = 'object'),
  group_id uuid,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retracted')),
  source text,
  source_url text,
  verified_at date,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (group_id, school_unitid, cycle_year)
    REFERENCES counselle.school_prompt_groups (id, school_unitid, cycle_year)
    ON DELETE RESTRICT,
  CHECK (
    state <> 'published' OR (
      btrim(coalesce(source, '')) <> ''
      AND source_url ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
      AND position('@' in source_url) = 0
      AND verified_at IS NOT NULL
      AND published_at IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX school_essay_prompts_active_ordinal_idx
  ON counselle.school_essay_prompts (school_unitid, cycle_year, ordinal)
  WHERE retired_at IS NULL AND state <> 'retracted';
CREATE INDEX school_essay_prompts_lookup_idx
  ON counselle.school_essay_prompts (school_unitid, cycle_year);

CREATE FUNCTION counselle.protect_published_prompt_group_facts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.state IN ('published', 'retracted') OR OLD.published_at IS NOT NULL) AND (
    NEW.school_unitid IS DISTINCT FROM OLD.school_unitid OR
    NEW.cycle_year IS DISTINCT FROM OLD.cycle_year OR
    NEW.label IS DISTINCT FROM OLD.label OR
    NEW.choice_min IS DISTINCT FROM OLD.choice_min OR
    NEW.source IS DISTINCT FROM OLD.source OR
    NEW.source_url IS DISTINCT FROM OLD.source_url OR
    NEW.verified_at IS DISTINCT FROM OLD.verified_at OR
    NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'published prompt-group facts are immutable; retract and insert a correction';
  END IF;
  IF OLD.state = 'retracted' AND NEW.state <> 'retracted' THEN
    RAISE EXCEPTION 'retracted prompt groups cannot be republished';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published', 'retracted') THEN
    RAISE EXCEPTION 'published prompt groups must be retracted, not returned to draft';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER protect_published_prompt_group_facts
BEFORE UPDATE ON counselle.school_prompt_groups
FOR EACH ROW EXECUTE FUNCTION counselle.protect_published_prompt_group_facts();

CREATE FUNCTION counselle.protect_published_essay_prompt_facts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.state IN ('published', 'retracted') OR OLD.published_at IS NOT NULL) AND (
    NEW.school_unitid IS DISTINCT FROM OLD.school_unitid OR
    NEW.cycle_year IS DISTINCT FROM OLD.cycle_year OR
    NEW.ordinal IS DISTINCT FROM OLD.ordinal OR
    NEW.prompt IS DISTINCT FROM OLD.prompt OR
    NEW.word_limit IS DISTINCT FROM OLD.word_limit OR
    NEW.applicability IS DISTINCT FROM OLD.applicability OR
    NEW.audience IS DISTINCT FROM OLD.audience OR
    NEW.group_id IS DISTINCT FROM OLD.group_id OR
    NEW.source IS DISTINCT FROM OLD.source OR
    NEW.source_url IS DISTINCT FROM OLD.source_url OR
    NEW.verified_at IS DISTINCT FROM OLD.verified_at OR
    NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'published essay-prompt facts are immutable; retract and insert a correction';
  END IF;
  IF OLD.state = 'retracted' AND NEW.state <> 'retracted' THEN
    RAISE EXCEPTION 'retracted essay prompts cannot be republished';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published', 'retracted') THEN
    RAISE EXCEPTION 'published essay prompts must be retracted, not returned to draft';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER protect_published_essay_prompt_facts
BEFORE UPDATE ON counselle.school_essay_prompts
FOR EACH ROW EXECUTE FUNCTION counselle.protect_published_essay_prompt_facts();

ALTER TABLE counselle.essays
  ADD COLUMN prompt_ref uuid REFERENCES counselle.school_essay_prompts(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX essays_application_prompt_active_idx
  ON counselle.essays (application_id, prompt_ref)
  WHERE archived_at IS NULL AND prompt_ref IS NOT NULL;
