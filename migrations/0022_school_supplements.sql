-- School supplemental essay prompts, one current set per school and cycle.
--
-- Filled and kept current by `python -m app.supplements sync` (and the daily
-- worker that runs the same pass): the source is one public compilation page
-- (Settings.supplements_source_url), one text block per school, re-read every
-- day; a school is re-extracted only when its block's hash changes.
--
-- `status = 'none'` is a school the source lists as having no supplemental
-- essays; a school with no row at all is simply not covered, which is a
-- different thing and must never read as "none" to a student.
-- `checked` records a human comparison against the school's own application
-- (`common_app`) or official admissions page (`official_site`).
--
-- Created by the app role, like every counselle.* table -- no GRANT needed.
-- depends: 0021_sat_practice

CREATE TABLE counselle.supplement_schools (
  school_unitid   integer NOT NULL,              -- IPEDS unitid (cds_library.schools.id)
  cycle           text NOT NULL,                 -- e.g. '2026-2027'
  status          text NOT NULL CHECK (status IN ('prompts', 'none')),
  source_url      text NOT NULL,
  source_heading  text NOT NULL,
  block_sha256    text,                          -- null for rows from the source's "none" list
  prompts_sha256  text NOT NULL,
  checked         text NOT NULL DEFAULT 'unchecked'
                    CHECK (checked IN ('unchecked', 'common_app', 'official_site')),
  checked_on      date,
  observed_at     timestamptz NOT NULL DEFAULT now(),   -- last time the source still listed it
  changed_at      timestamptz NOT NULL DEFAULT now(),   -- last time its prompts changed
  PRIMARY KEY (school_unitid, cycle)
);

CREATE TABLE counselle.supplement_prompts (
  school_unitid   integer NOT NULL,
  cycle           text NOT NULL,
  ordinal         integer NOT NULL,
  prompt          text NOT NULL,
  context         text,                          -- a quotation/scenario the question refers to
  word_limit      integer CHECK (word_limit > 0),
  requirement     text NOT NULL CHECK (requirement IN ('required', 'optional')),
  -- Prompts sharing a group_label are one choice; choose_count is how many to
  -- answer (null: any number). requirement covers the whole choice.
  group_label     text,
  choose_count    integer CHECK (choose_count IS NULL OR (choose_count > 0 AND group_label IS NOT NULL)),
  applies_to      text,
  PRIMARY KEY (school_unitid, cycle, ordinal),
  FOREIGN KEY (school_unitid, cycle)
    REFERENCES counselle.supplement_schools (school_unitid, cycle) ON DELETE CASCADE
);

-- One row per sync pass, written by the daily worker (app/supplements/worker.py):
-- it decides when the next pass is due and keeps a record of what each pass did.
CREATE TABLE counselle.supplement_sync_runs (
  id              bigserial PRIMARY KEY,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  updated         integer,
  unchanged       integer,
  problems        text                            -- failed/unmapped/stale headings, or the error
);
