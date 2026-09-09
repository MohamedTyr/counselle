-- cds_library v3 live seed (school-data-v3, ../../specs/school-data-v3/plan/school-data-v3.md §3).
--
-- This is the ONLY schema-DDL source of record for cds_library in this repo:
-- this repo's own yoyo migrations/ never touch cds_library, and the old
-- counselle-data-pipeline repo that used to own this DDL is retired. Keep
-- this file consistent with the live schema -- do not let it silently drift
-- into a second, competing definition.
--
-- v3 replaces the pre-existing CDS write-path schema (moved verbatim, and
-- completed, to deploy/seed/parked/cds_extraction_schema.sql -- D8, the CDS
-- extraction pipeline is parked, not deleted) with the CollegeData facts
-- store: `schools` (unchanged) plus eight new tables and exactly six reader
-- views. See ../../specs/school-data-v3/plan/school-data-v3.md §3.1-§3.4 for the schema chapter this
-- file implements.
--
-- Idempotent: every CREATE is guarded (IF NOT EXISTS / OR REPLACE / a
-- DROP TRIGGER IF EXISTS guard) so this is safe to re-run on every boot
-- (scripts/seed_reader_db.py's "always-run DDL" phase) -- a schema change
-- made after first deploy is never silently skipped. Only
-- `scripts/dev.py reset-db` ever drops cds_library first.
--
-- Run as COUNSELLE_DB_ADMIN_DSN. `scripts/setup_db.sql` must have already
-- created the `cds_library_owner` (NOLOGIN) and `cds_library_app` roles.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- Ownership bootstrap. Every object below is owned by `cds_library_owner`,
-- exactly as the live objects are today, regardless of which admin identity
-- a managed provider hands us (that identity may not itself hold CREATE on
-- the database -- a schema's owner always holds CREATE within its own
-- schema, which is why the schema itself is created here, before the
-- SET ROLE switch, with an explicit AUTHORIZATION clause, rather than by
-- `cds_library_owner` creating its own schema after already switching into
-- it). `scripts/seed_reader_db.py:151-155`'s `_prepare_app_schema` uses the
-- same "GRANT role TO CURRENT_USER WITH SET TRUE" trick for `counselle_app`.
-- ---------------------------------------------------------------------

GRANT cds_library_owner TO CURRENT_USER WITH SET TRUE;
CREATE SCHEMA IF NOT EXISTS cds_library AUTHORIZATION cds_library_owner;
SET ROLE cds_library_owner;

-- ---------------------------------------------------------------------
-- The six tab names, declared once. A domain over a CHECK-constrained
-- scalar has no member enumeration in the catalog, so the domain and every
-- default that needs "all six tabs" both read from this one function.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cds_library.tab_names()
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT ARRAY['overview', 'admission', 'money-matters', 'academics', 'campus-life', 'students']::text[]
$function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'cds_library' AND t.typname = 'tab_name'
  ) THEN
    CREATE DOMAIN cds_library.tab_name AS text
      CHECK (VALUE = ANY (cds_library.tab_names()));
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Base tables (nine relations: schools, unchanged, + eight new, in FK
-- order). Every UNIQUE shown in the plan with a WHERE clause or over an
-- expression is a CREATE UNIQUE INDEX below, not a table constraint --
-- PostgreSQL has no partial or expression unique *constraints*.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cds_library.schools (
    id                     integer PRIMARY KEY,
    name                   text NOT NULL,
    aliases                text[] NOT NULL DEFAULT '{}'::text[],
    city                   text,
    state                  text,
    postal_code            text,
    latitude               numeric,
    longitude              numeric,
    official_website       text,
    official_domain        text,
    general_phone          text,
    is_currently_operating boolean,
    is_main_campus         boolean,
    search_name            text NOT NULL,
    basic_profile          jsonb NOT NULL,
    profile_provenance     jsonb NOT NULL,
    profile_version        text NOT NULL,
    profile_snapshot_date  date NOT NULL,
    profile_sha256         bytea NOT NULL,
    imported_at            timestamptz NOT NULL DEFAULT now(),
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schools_basic_profile_check CHECK (jsonb_typeof(basic_profile) = 'object'),
    CONSTRAINT schools_profile_provenance_check CHECK (jsonb_typeof(profile_provenance) = 'object'),
    CONSTRAINT schools_profile_sha256_check CHECK (octet_length(profile_sha256) = 32)
);
CREATE INDEX IF NOT EXISTS schools_search_name_idx
    ON cds_library.schools USING btree (search_name, id);

CREATE TABLE IF NOT EXISTS cds_library.collegedata_schools (
    slug                     text PRIMARY KEY,
    collegedata_id           integer,
    name                     text,
    city                     text,
    state                    text,
    zip                      text,
    school_id                integer REFERENCES cds_library.schools(id),
    match_method             text NOT NULL CHECK (match_method IN (
                                 'exact', 'exact_city', 'trigram', 'trigram_city',
                                 'token_city', 'single_city', 'manual', 'unmatched'
                             )),
    matched_at               timestamptz,
    note                     text,
    first_seen_at            timestamptz NOT NULL DEFAULT now(),
    last_seen_in_sitemap_at  timestamptz,
    retired_at               timestamptz,
    CONSTRAINT collegedata_schools_collegedata_id_key UNIQUE (collegedata_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS collegedata_schools_live_school_idx
    ON cds_library.collegedata_schools (school_id) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collegedata_schools_lower_slug_idx
    ON cds_library.collegedata_schools (lower(slug));

CREATE TABLE IF NOT EXISTS cds_library.page_snapshots (
    id                bigserial PRIMARY KEY,
    school_id         integer NOT NULL REFERENCES cds_library.schools(id),
    tab               cds_library.tab_name NOT NULL,
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    http_status       integer,
    build_id          text,
    content_sha256    bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    body              jsonb NOT NULL,
    CONSTRAINT page_snapshots_body_key UNIQUE (school_id, tab, content_sha256)
);
CREATE INDEX IF NOT EXISTS page_snapshots_retention_idx
    ON cds_library.page_snapshots (school_id, tab, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS cds_library.school_pages (
    school_id             integer NOT NULL REFERENCES cds_library.schools(id),
    tab                   cds_library.tab_name NOT NULL,
    latest_snapshot_id    bigint REFERENCES cds_library.page_snapshots(id) ON DELETE RESTRICT,
    last_attempted_at     timestamptz,
    last_fetched_at       timestamptz,
    last_changed_at       timestamptz,
    last_status           text NOT NULL DEFAULT 'never_fetched'
                             CHECK (last_status IN (
                                 'ok', 'http_error', 'not_found', 'build_id_rotated',
                                 'parse_error', 'never_fetched'
                             )),
    consecutive_failures  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (school_id, tab)
);
CREATE INDEX IF NOT EXISTS school_pages_failing_idx
    ON cds_library.school_pages (last_status, consecutive_failures) WHERE last_status <> 'ok';

CREATE TABLE IF NOT EXISTS cds_library.school_facts (
    id                     bigserial PRIMARY KEY,
    school_id              integer NOT NULL REFERENCES cds_library.schools(id),
    fact_key               text NOT NULL,
    tab                    cds_library.tab_name NOT NULL,
    section                text NOT NULL,
    label                  text NOT NULL,
    value                  jsonb NOT NULL,
    display                text NOT NULL,
    unit                   text,
    value_type             text NOT NULL,
    value_num              numeric,
    value_text             text,
    value_bool             boolean,
    value_date             date,
    reported_period        text,
    reported_period_year   smallint,
    snapshot_id            bigint REFERENCES cds_library.page_snapshots(id) ON DELETE SET NULL,
    snapshot_sha256        bytea NOT NULL CHECK (octet_length(snapshot_sha256) = 32),
    source_path            text NOT NULL,
    mapper_version         text NOT NULL,
    valid_from             timestamptz NOT NULL,
    valid_to               timestamptz,
    CONSTRAINT school_facts_value_shape_check
        CHECK (num_nonnulls(value_num, value_text, value_bool, value_date) <= 1),
    CONSTRAINT school_facts_reported_period_year_check
        CHECK (reported_period_year IS NULL OR reported_period IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_facts_current_idx
    ON cds_library.school_facts (school_id, fact_key) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS school_facts_key_num_idx
    ON cds_library.school_facts (fact_key, value_num) WHERE valid_to IS NULL AND value_num IS NOT NULL;
CREATE INDEX IF NOT EXISTS school_facts_key_idx
    ON cds_library.school_facts (fact_key) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS school_facts_snapshot_idx
    ON cds_library.school_facts (snapshot_id);
-- Deliberately NO index over valid_to IS NOT NULL: history is written now,
-- read by nothing yet (plan §5.6).

-- school_explore_rows: the ~100 typed nullable metric/filter columns from
-- ../../specs/school-data-v3/plan/school-data-v3-appendix.md Appendix E-iv, minus its identity columns
-- (name/city/state/website_url -- the school_explore view supplies those
-- from `schools`) and minus `size_bucket` (dropped, plan §3.1: the shipped
-- four size buckets do not nest inside IPEDS's five, so the column is null
-- until crawled with no seed-time fallback); `undergraduate_full_time` is a
-- column here per the plan's explicit override (both it and
-- `faculty_full_time` must be visible on `school_explore` so the ratio can
-- be computed in explore SQL) and `students_per_faculty` itself is never a
-- column. Every metric is nullable and never defaulted to 0 -- a blank cell
-- is a real "not published" observation, not a zero.
CREATE TABLE IF NOT EXISTS cds_library.school_explore_rows (
    school_id                     integer PRIMARY KEY REFERENCES cds_library.schools(id),

    -- IPEDS-derived filter columns, projected from schools.basic_profile
    region                        text NOT NULL,
    locale                        text,
    control                       text NOT NULL CHECK (control IN ('public', 'private', 'private_for_profit')),
    institution_level             text,
    gender_model                  text CHECK (gender_model IS NULL OR gender_model IN ('coed', 'women', 'men')),
    religious_affiliation         text,
    hbcu                          boolean NOT NULL,
    hsi                           boolean,
    tribal                        boolean NOT NULL,
    land_grant                    boolean NOT NULL,

    -- students
    undergraduates                integer,
    graduate_students             integer,

    -- admissions
    admit_rate                    numeric,
    admit_rate_women              numeric,
    admit_rate_men                numeric,
    applicants_total              integer,
    admitted_total                integer,
    enrolled_total                integer,
    yield_rate                    numeric,
    entrance_difficulty           text,

    -- testing
    test_policy                   text CHECK (test_policy IS NULL OR test_policy IN (
                                       'required', 'considered', 'not_required', 'not_reported'
                                   )),
    sat_math_p25                  integer,
    sat_math_p75                  integer,
    sat_ebrw_p25                  integer,
    sat_ebrw_p75                  integer,
    -- NO sat_total_* columns ever (R14): the 25th percentile of a total is
    -- not the sum of two section 25th percentiles -- see D10/the plan's
    -- exit test (`tests/app/facts/test_explore_projection.py`). A
    -- fabricated `sat_math_p25 + sat_ebrw_p25` composite shipped here
    -- once (Finding 2, 2026-09-07 hardening) and was removed.
    act_composite_p25             integer,
    act_composite_p75             integer,
    act_composite_avg             numeric,
    gpa_avg                       numeric,
    class_rank_top_tenth          numeric,

    -- cost & aid
    cost_attendance_in_state      integer,
    cost_attendance_out_of_state  integer,
    tuition_in_state              integer,
    tuition_out_of_state          integer,
    room_and_board                integer,
    books_and_supplies            integer,
    other_expenses                integer,
    need_met_pct                  numeric,
    need_fully_met_pct            numeric,  -- computed: aid.need_fully_met / aid.received, never the printed average
    merit_aid_pct                 numeric,
    avg_award                     integer,

    -- outcomes
    avg_indebtedness              integer,
    graduates_with_loans_pct      numeric,
    retention_pct                 numeric,
    grad_rate_4y                  numeric,
    grad_rate_5y                  numeric,
    grad_rate_6y                  numeric,

    -- faculty / campus
    undergraduate_full_time       integer,
    faculty_full_time             integer,
    faculty_part_time             integer,
    faculty_terminal_pct          numeric,
    housing_pct                   numeric,
    housing_offered               boolean,
    greek_pct_men                 numeric,
    greek_pct_women               numeric,
    international_pct             numeric,
    calendar                      text,

    -- applying
    application_fee               integer,
    application_fee_waiver        boolean,
    accepts_common_app            boolean,
    offers_early_decision         boolean,
    offers_early_action           boolean,
    is_rolling                    boolean,
    deadline_regular              date,
    deadline_early_decision       date,
    deadline_early_action         date,
    waitlist_used                 boolean,

    -- lists
    majors                        text[],
    majors_count                  integer,
    sports_women                  text[],
    sports_men                    text[],
    special_programs              text[],

    -- ethnicity distribution (an omitted bucket is null, never 0)
    ethnicity_aian_pct            numeric,
    ethnicity_asian_pct           numeric,
    ethnicity_black_pct           numeric,
    ethnicity_hispanic_pct        numeric,
    ethnicity_multi_pct           numeric,
    ethnicity_nhpi_pct            numeric,
    ethnicity_white_pct           numeric,
    ethnicity_unknown_pct         numeric,

    -- bookkeeping
    facts_updated_at              timestamptz NOT NULL,
    mapper_version                text NOT NULL,
    retired_at                    timestamptz
);
-- NO secondary index at all: ~2,587 rows ~ 70 pages; a seq scan wins for
-- every filter, including the majors containment (measured 0.7ms). Add GIN
-- only if the table ever passes ~50k rows.

CREATE TABLE IF NOT EXISTS cds_library.fact_coverage_counts (
    fact_key            text PRIMARY KEY,
    schools_with_value  integer NOT NULL,
    schools_total       integer NOT NULL,
    computed_at         timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cds_library.facts_jobs (
    id                 bigserial PRIMARY KEY,
    kind               text NOT NULL CHECK (kind IN ('crawl_pass', 'remap')),
    status             text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error')),
    queued_at          timestamptz NOT NULL DEFAULT now(),
    started_at         timestamptz,
    finished_at        timestamptz,
    lease_expires_at   timestamptz,
    error_code         text,
    error_message      text
);
CREATE UNIQUE INDEX IF NOT EXISTS facts_jobs_one_live_pass_idx
    ON cds_library.facts_jobs (kind) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS facts_jobs_lease_idx
    ON cds_library.facts_jobs (lease_expires_at) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS cds_library.crawl_runs (
    id                     bigserial PRIMARY KEY,
    job_id                 bigint REFERENCES cds_library.facts_jobs(id),
    status                 text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'aborted')),
    started_at             timestamptz NOT NULL DEFAULT now(),
    finished_at            timestamptz,
    error_code             text,
    error_message          text,
    build_id               text,
    build_id_rotations     integer NOT NULL DEFAULT 0,
    sitemap_slugs          integer,
    crosswalk_matched      integer,
    crosswalk_unmatched    integer,
    schools_seen           integer,
    pages_fetched          integer NOT NULL DEFAULT 0,
    pages_changed          integer NOT NULL DEFAULT 0,
    pages_failed           integer NOT NULL DEFAULT 0,
    failures_by_kind       jsonb NOT NULL DEFAULT '{}'::jsonb,
    facts_changed          integer NOT NULL DEFAULT 0,
    snapshots_pruned       integer NOT NULL DEFAULT 0,
    rate_backoffs          integer NOT NULL DEFAULT 0,
    unmapped_label_count   integer NOT NULL DEFAULT 0,
    unmapped_labels        jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT crawl_runs_status_finished_check CHECK ((status = 'running') = (finished_at IS NULL))
);
CREATE INDEX IF NOT EXISTS crawl_runs_recent_idx
    ON cds_library.crawl_runs (started_at DESC);

-- ---------------------------------------------------------------------
-- Triggers and their functions.
--
-- schools_projection_matches / reject_school_projection_mismatch() are
-- captured verbatim from the live catalog via pg_get_functiondef /
-- pg_get_triggerdef in Phase 0 step 1 (see
-- artifacts/school-data-v3/<ts>-prenuke/triggers_and_functions.sql) --
-- they exist nowhere else in the repo. page_snapshots_immutable is new in
-- v3: page_snapshots rows are insert-only (retention deletes them; nothing
-- ever legitimately updates one).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cds_library.reject_school_projection_mismatch()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
DECLARE
  expected_aliases text[];
  expected_domain text;
  homepage text;
BEGIN
  expected_aliases := COALESCE(ARRAY(SELECT jsonb_array_elements_text(NEW.basic_profile->'aliases')), ARRAY[]::text[]);
  homepage := NEW.basic_profile #>> '{official_links,homepage}';
  expected_domain := CASE WHEN homepage IS NULL THEN NULL ELSE lower(split_part(split_part(regexp_replace(homepage, '^[[:alpha:]][[:alnum:]+.-]*://', ''), '/', 1), ':', 1)) END;

  IF NEW.id IS DISTINCT FROM (NEW.basic_profile->>'id')::integer THEN RAISE EXCEPTION 'schools typed column id does not match basic_profile'; END IF;
  IF NEW.name IS DISTINCT FROM NEW.basic_profile->>'name' THEN RAISE EXCEPTION 'schools typed column name does not match basic_profile'; END IF;
  IF NEW.aliases IS DISTINCT FROM expected_aliases THEN RAISE EXCEPTION 'schools typed column aliases does not match basic_profile'; END IF;
  IF NEW.city IS DISTINCT FROM NEW.basic_profile#>>'{location,city}' THEN RAISE EXCEPTION 'schools typed column city does not match basic_profile'; END IF;
  IF NEW.state IS DISTINCT FROM NEW.basic_profile#>>'{location,state}' THEN RAISE EXCEPTION 'schools typed column state does not match basic_profile'; END IF;
  IF NEW.postal_code IS DISTINCT FROM NEW.basic_profile#>>'{location,postal_code}' THEN RAISE EXCEPTION 'schools typed column postal_code does not match basic_profile'; END IF;
  IF NEW.latitude::double precision IS DISTINCT FROM NULLIF(NEW.basic_profile#>>'{location,latitude}', '')::double precision THEN RAISE EXCEPTION 'schools typed column latitude does not match basic_profile'; END IF;
  IF NEW.longitude::double precision IS DISTINCT FROM NULLIF(NEW.basic_profile#>>'{location,longitude}', '')::double precision THEN RAISE EXCEPTION 'schools typed column longitude does not match basic_profile'; END IF;
  IF NEW.official_website IS DISTINCT FROM homepage THEN RAISE EXCEPTION 'schools typed column official_website does not match basic_profile'; END IF;
  IF NEW.official_domain IS DISTINCT FROM expected_domain THEN RAISE EXCEPTION 'schools typed column official_domain does not match basic_profile'; END IF;
  IF NEW.general_phone IS DISTINCT FROM NEW.basic_profile#>>'{contact,general_phone}' THEN RAISE EXCEPTION 'schools typed column general_phone does not match basic_profile'; END IF;
  IF NEW.is_currently_operating IS DISTINCT FROM NULLIF(NEW.basic_profile#>>'{operational,currently_operating}', '')::boolean THEN RAISE EXCEPTION 'schools typed column is_currently_operating does not match basic_profile'; END IF;
  IF NEW.is_main_campus IS DISTINCT FROM NULLIF(NEW.basic_profile#>>'{identity,main_campus}', '')::boolean THEN RAISE EXCEPTION 'schools typed column is_main_campus does not match basic_profile'; END IF;
  IF NEW.search_name IS DISTINCT FROM lower(trim(regexp_replace(NEW.basic_profile->>'name', '[[:space:]]+', ' ', 'g'))) THEN RAISE EXCEPTION 'schools typed column search_name does not match basic_profile'; END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS schools_projection_matches ON cds_library.schools;
CREATE TRIGGER schools_projection_matches
  BEFORE INSERT OR UPDATE ON cds_library.schools
  FOR EACH ROW EXECUTE FUNCTION cds_library.reject_school_projection_mismatch();

CREATE OR REPLACE FUNCTION cds_library.reject_immutable_page_snapshot()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'page snapshot evidence is immutable (delete for retention, never update)';
END
$function$;

DROP TRIGGER IF EXISTS page_snapshots_immutable ON cds_library.page_snapshots;
CREATE TRIGGER page_snapshots_immutable
  BEFORE UPDATE ON cds_library.page_snapshots
  FOR EACH ROW EXECUTE FUNCTION cds_library.reject_immutable_page_snapshot();

-- ---------------------------------------------------------------------
-- Reader views (exactly six, plan §3.2). Owner-owned with security_invoker
-- off (the PG default) -- that is the whole reason cds_library_reader can
-- read these while holding zero grants on any base table. Never add
-- WITH (security_invoker = true) here.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW cds_library.school_profiles AS
 SELECT id,
    name,
    aliases,
    city,
    state,
    postal_code,
    latitude,
    longitude,
    official_website,
    official_domain,
    general_phone,
    is_currently_operating,
    is_main_campus,
    search_name,
    basic_profile,
    profile_provenance,
    profile_version,
    profile_snapshot_date,
    profile_sha256,
    imported_at
   FROM cds_library.schools;

-- current_school_facts: all columns including value jsonb. Used only by the
-- typed get_facts service function (Phase 2); not on the query_database
-- allow-list (Phase 3) -- that allow-list uses school_facts_sql below.
CREATE OR REPLACE VIEW cds_library.current_school_facts AS
 SELECT
    f.id,
    f.school_id,
    f.fact_key,
    f.tab,
    f.section,
    f.label,
    f.value,
    f.display,
    f.unit,
    f.value_type,
    f.value_num,
    f.value_text,
    f.value_bool,
    f.value_date,
    f.reported_period,
    f.reported_period_year,
    f.snapshot_id,
    f.snapshot_sha256,
    f.source_path,
    f.mapper_version,
    f.valid_from,
    p.last_fetched_at AS observed_at
   FROM cds_library.school_facts f
   JOIN cds_library.school_pages p ON p.school_id = f.school_id AND p.tab = f.tab
  WHERE f.valid_to IS NULL;

-- school_facts_sql: the same current rows, no `value` jsonb -- the only
-- facts relation query_database (Phase 3) may touch.
CREATE OR REPLACE VIEW cds_library.school_facts_sql AS
 SELECT
    f.school_id,
    f.fact_key,
    f.label,
    f.section,
    f.tab,
    f.value_type,
    f.unit,
    f.display,
    f.value_num,
    f.value_text,
    f.value_bool,
    f.value_date,
    f.reported_period,
    f.reported_period_year,
    p.last_fetched_at AS observed_at
   FROM cds_library.school_facts f
   JOIN cds_library.school_pages p ON p.school_id = f.school_id AND p.tab = f.tab
  WHERE f.valid_to IS NULL;

CREATE OR REPLACE VIEW cds_library.school_explore AS
 SELECT
    s.name,
    s.city,
    s.state,
    s.official_website,
    s.official_domain,
    r.*
   FROM cds_library.school_explore_rows r
   JOIN cds_library.schools s ON s.id = r.school_id
  WHERE r.retired_at IS NULL;

-- school_data_status: has_collegedata, facts_updated_at (max(last_fetched_at)
-- over ok tabs), fact_count, and tabs jsonb (jsonb_object_agg over all six
-- tab_names(), defaulting each to 'never_fetched') for every school,
-- including one with no school_pages rows at all.
CREATE OR REPLACE VIEW cds_library.school_data_status AS
 SELECT
    s.id AS school_id,
    (cs.school_id IS NOT NULL) AS has_collegedata,
    (SELECT max(p.last_fetched_at)
       FROM cds_library.school_pages p
      WHERE p.school_id = s.id AND p.last_status = 'ok') AS facts_updated_at,
    (SELECT count(*)
       FROM cds_library.school_facts f
      WHERE f.school_id = s.id AND f.valid_to IS NULL) AS fact_count,
    (SELECT jsonb_object_agg(tab_name.tab_name, coalesce(p.last_status, 'never_fetched'))
       FROM unnest(cds_library.tab_names()) AS tab_name(tab_name)
       LEFT JOIN cds_library.school_pages p
         ON p.school_id = s.id AND p.tab = tab_name.tab_name::cds_library.tab_name) AS tabs
   FROM cds_library.schools s
   LEFT JOIN cds_library.collegedata_schools cs
     ON cs.school_id = s.id AND cs.retired_at IS NULL;

-- fact_coverage: schools_total is the number of schools with a live
-- crosswalk row, not 2,746 -- computed by the mapper into
-- fact_coverage_counts, not derived here.
CREATE OR REPLACE VIEW cds_library.fact_coverage AS
 SELECT fact_key, schools_with_value, schools_total, computed_at
   FROM cds_library.fact_coverage_counts;

-- ---------------------------------------------------------------------
-- Grants (this file is the single source of every cds_library object
-- grant -- scripts/setup_db.sql owns roles only).
-- ---------------------------------------------------------------------

GRANT USAGE ON SCHEMA cds_library TO cds_library_reader;
GRANT SELECT ON TABLE
  cds_library.school_profiles,
  cds_library.current_school_facts,
  cds_library.school_facts_sql,
  cds_library.school_explore,
  cds_library.school_data_status,
  cds_library.fact_coverage
TO cds_library_reader;

GRANT USAGE ON SCHEMA cds_library TO cds_library_app;
GRANT SELECT ON TABLE cds_library.schools TO cds_library_app;
GRANT INSERT, SELECT, UPDATE ON TABLE
  cds_library.collegedata_schools,
  cds_library.page_snapshots,
  cds_library.school_pages,
  cds_library.school_facts,
  cds_library.school_explore_rows,
  cds_library.fact_coverage_counts,
  cds_library.facts_jobs,
  cds_library.crawl_runs
TO cds_library_app;
-- Retention is the only DELETE this role ever needs; a retired fact_key in
-- fact_coverage_counts is zeroed by an UPDATE, never removed (§3.1).
GRANT DELETE ON TABLE cds_library.page_snapshots TO cds_library_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA cds_library TO cds_library_app;

-- Default privileges for future objects created by this seed's owner role
-- (tables: INSERT/SELECT/UPDATE only -- "arw", never DELETE by default;
-- sequences: USAGE only, not today's live-only "rU").
ALTER DEFAULT PRIVILEGES FOR ROLE cds_library_owner IN SCHEMA cds_library
  GRANT INSERT, SELECT, UPDATE ON TABLES TO cds_library_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cds_library_owner IN SCHEMA cds_library
  GRANT USAGE ON SEQUENCES TO cds_library_app;

RESET ROLE;
