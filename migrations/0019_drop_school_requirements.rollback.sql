-- Restores counselle.school_requirements, its two indexes, the
-- protect_published_requirement_facts() function, and its trigger exactly as
-- created in 0011_school_workspace.sql. NOTE: this restores structure only — the
-- table starts empty, same as the forward migration found it (F2: no production
-- writer ever populated it).

CREATE TABLE counselle.school_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_unitid integer NOT NULL,
  cycle_year integer NOT NULL CHECK (cycle_year BETWEEN 2000 AND 2200),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text NOT NULL CHECK (btrim(label) <> ''),
  applicability text NOT NULL DEFAULT 'unknown' CHECK (
    applicability IN ('required', 'optional', 'not_required', 'conditional', 'unknown')
  ),
  audience jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience) = 'object'),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retracted')),
  source text,
  source_url text,
  verified_at date,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
CREATE UNIQUE INDEX school_requirements_active_identity_idx
  ON counselle.school_requirements (school_unitid, cycle_year, kind)
  WHERE retired_at IS NULL AND state <> 'retracted';
CREATE INDEX school_requirements_lookup_idx
  ON counselle.school_requirements (school_unitid, cycle_year);

CREATE FUNCTION counselle.protect_published_requirement_facts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.state IN ('published', 'retracted') OR OLD.published_at IS NOT NULL) AND (
    NEW.school_unitid IS DISTINCT FROM OLD.school_unitid OR
    NEW.cycle_year IS DISTINCT FROM OLD.cycle_year OR
    NEW.kind IS DISTINCT FROM OLD.kind OR
    NEW.label IS DISTINCT FROM OLD.label OR
    NEW.applicability IS DISTINCT FROM OLD.applicability OR
    NEW.audience IS DISTINCT FROM OLD.audience OR
    NEW.detail IS DISTINCT FROM OLD.detail OR
    NEW.source IS DISTINCT FROM OLD.source OR
    NEW.source_url IS DISTINCT FROM OLD.source_url OR
    NEW.verified_at IS DISTINCT FROM OLD.verified_at OR
    NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'published requirement facts are immutable; retract and insert a correction';
  END IF;
  IF OLD.state = 'retracted' AND NEW.state <> 'retracted' THEN
    RAISE EXCEPTION 'retracted requirements cannot be republished';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published', 'retracted') THEN
    RAISE EXCEPTION 'published requirements must be retracted, not returned to draft';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER protect_published_requirement_facts
BEFORE UPDATE ON counselle.school_requirements
FOR EACH ROW EXECUTE FUNCTION counselle.protect_published_requirement_facts();
