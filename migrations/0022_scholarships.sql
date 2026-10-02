-- Scholarships: admin-entered records, student saves, and the edit history
-- (plans/scholarships-plan.md §3).
-- depends: 0021_sat_practice
--
-- Text fields arrive trimmed from the API, so `<> ''` means "not blank". A
-- CHECK passes when its expression is NULL, so every nullable column the
-- publish CHECK reads is tested with IS NOT NULL explicitly.
--
-- Smaller choice lists (basis values, citizenship and grade options,
-- revision action) are validated by Literal types in app code like the rest
-- of counselle.*. The status/kind CHECKs stay here because the publish CHECK
-- reads them.

CREATE TABLE counselle.scholarships (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','archived')),
  version              integer NOT NULL DEFAULT 1,

  name                 text NOT NULL DEFAULT '',
  sponsor              text NOT NULL DEFAULT '',
  summary              text NOT NULL DEFAULT '',
  apply_url            text NOT NULL DEFAULT '',
  source_url           text NOT NULL DEFAULT '',
  logo_url             text NOT NULL DEFAULT '',           -- '' = use the source site's icon

  award_kind           text NOT NULL DEFAULT 'fixed'
                       CHECK (award_kind IN ('fixed','range','varies','full_tuition','full_ride')),
  award_amount         integer CHECK (award_amount >= 0),  -- whole dollars
  award_min            integer CHECK (award_min >= 0),
  award_max            integer CHECK (award_max >= 0),
  renewable            boolean NOT NULL DEFAULT false,
  renewal_years        smallint CHECK (renewal_years BETWEEN 1 AND 8),
  awards_count         integer CHECK (awards_count >= 1),

  deadline_kind        text NOT NULL DEFAULT 'fixed' CHECK (deadline_kind IN ('fixed','rolling')),
  deadline_on          date,
  opens_on             date,
  recurs_annually      boolean NOT NULL DEFAULT false,

  basis                text[] NOT NULL DEFAULT '{}',
  fields               text[] NOT NULL DEFAULT '{}',       -- empty = any field
  eligibility          jsonb  NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(eligibility) = 'array'),
  other_eligibility    text[] NOT NULL DEFAULT '{}',

  essays               jsonb    NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(essays) = 'array'),
  recommendations      smallint NOT NULL DEFAULT 0 CHECK (recommendations BETWEEN 0 AND 10),
  needs_transcript     boolean  NOT NULL DEFAULT false,
  needs_financial_docs boolean  NOT NULL DEFAULT false,
  needs_interview      boolean  NOT NULL DEFAULT false,

  last_checked_on      date,                               -- null = never checked against the source
  created_by           uuid REFERENCES counselle.users(id) ON DELETE SET NULL,
  updated_by           uuid REFERENCES counselle.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- A published row can never make the student page show a missing amount,
  -- a missing date, a dead link or an unchecked record.
  CONSTRAINT scholarships_published_is_complete CHECK (status <> 'published' OR (
        name <> '' AND sponsor <> ''
    AND apply_url ~* '^https?://' AND source_url ~* '^https?://'
    AND last_checked_on IS NOT NULL
    AND (award_kind <> 'fixed' OR (award_amount IS NOT NULL AND award_amount >= 1))
    AND (award_kind <> 'range' OR (award_min IS NOT NULL AND award_max IS NOT NULL
                                   AND award_max >= 1 AND award_min <= award_max))
    AND (deadline_kind <> 'fixed' OR deadline_on IS NOT NULL)))
);

CREATE TABLE counselle.scholarship_saves (
  user_id        uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  scholarship_id uuid NOT NULL REFERENCES counselle.scholarships(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scholarship_id)
);

CREATE TABLE counselle.scholarship_revisions (
  id             bigserial PRIMARY KEY,
  scholarship_id uuid NOT NULL REFERENCES counselle.scholarships(id) ON DELETE CASCADE,
  version        integer NOT NULL,   -- the scholarship's version after this change
  action         text NOT NULL,      -- create | update | publish | unpublish | archive | restore | checked
  snapshot       jsonb NOT NULL,     -- editable fields + status after the change
  actor_id       uuid REFERENCES counselle.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scholarship_id, version)
);
