-- PARKED (D8, plans/school-data-v3.md §3.5, ADR 0037): the CDS extraction
-- pipeline's write-path schema, preserved for the future -- not mounted or
-- started by anything in this repo. This file is the pre-v3
-- deploy/seed/cds_library_schema.sql, moved verbatim and completed with the
-- three cds_*_immutable triggers/functions, the cds_library_app grants, and
-- the two default-privilege rows, none of which the pre-v3 file actually
-- had (it was documentation transcribed from a live introspection snapshot,
-- never itself executed by any bootstrap script -- see git history).
--
-- v3's live seed is deploy/seed/cds_library_schema.sql (the CollegeData
-- facts store: `schools` + eight new tables + six reader views). This file
-- is its opposite number: the seven CDS base tables, the
-- is_sorted_distinct_text_array() helper one of their CHECK constraints
-- depends on, and the four CDS-specific reader views -- kept complete and
-- importable so the CDS system can be revived without reconstructing its
-- schema from memory. `school_profiles` -- one of the live seed's six
-- reader views -- is NOT part of this file, for the same reason `schools`
-- is not (see the base-tables and grant-block comments below): it is a
-- live v3 object this file does not own. The CDS *data* (all seven tables' rows, including
-- cds_documents.pdf_content) is preserved separately as a restore-verified
-- pg_dump; an off-workstation copy is still outstanding -- see PARKED.md.
--
-- Not idempotent-boot-tested the way the live seed is (nothing runs this
-- automatically), but every CREATE is still guarded so a future revival can
-- run it against a fresh schema without editing it first.

\set ON_ERROR_STOP on

-- Same ownership bootstrap as the live seed (deploy/seed/cds_library_schema.sql):
-- every object below ends up owned by cds_library_owner, matching the live
-- catalog today, regardless of which admin identity runs this on revival.
GRANT cds_library_owner TO CURRENT_USER WITH SET TRUE;
CREATE SCHEMA IF NOT EXISTS cds_library AUTHORIZATION cds_library_owner;
SET ROLE cds_library_owner;

-- Referenced by cds_extractions_requested_domains_check1 below.
CREATE OR REPLACE FUNCTION cds_library.is_sorted_distinct_text_array(value text[])
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
AS $function$
  SELECT value = ARRAY(SELECT DISTINCT item FROM unnest(value) AS item ORDER BY item)
$function$;

-- ---------------------------------------------------------------------
-- Base tables, in an order that avoids the cds_school_years/cds_documents
-- circular FK (closed with an ALTER TABLE once both sides exist). `schools`
-- itself is NOT part of this file -- it lives in the v3 live seed
-- (deploy/seed/cds_library_schema.sql) and is shared by both schemas.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cds_library.cds_school_years (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id              integer NOT NULL REFERENCES cds_library.schools(id),
    academic_year          smallint NOT NULL,
    active_document_id     bigint,
    candidate_document_id  bigint,
    last_action_kind       text NOT NULL DEFAULT 'created',
    last_action_at         timestamptz NOT NULL DEFAULT now(),
    retired_at             timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cds_school_years_school_id_academic_year_key UNIQUE (school_id, academic_year),
    CONSTRAINT cds_school_years_academic_year_check
        CHECK (academic_year >= 2000 AND academic_year <= 2200),
    CONSTRAINT cds_school_years_check CHECK (
        active_document_id IS NULL OR candidate_document_id IS NULL
        OR active_document_id <> candidate_document_id
    )
);
CREATE INDEX IF NOT EXISTS cds_school_years_manager_idx
    ON cds_library.cds_school_years USING btree (academic_year, last_action_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS cds_library.cds_documents (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_year_id           bigint NOT NULL REFERENCES cds_library.cds_school_years(id),
    pdf_content              bytea NOT NULL,
    pdf_sha256               bytea NOT NULL,
    pdf_size_bytes           bigint NOT NULL,
    mime_type                text NOT NULL,
    original_filename        text,
    source_kind              text NOT NULL,
    source_page_url          text,
    original_download_url    text,
    resolved_download_url    text,
    repository_school_name  text,
    retrieved_at             timestamptz NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    invalidated_at           timestamptz,
    superseded_at            timestamptz,
    CONSTRAINT cds_documents_id_school_year_id_key UNIQUE (id, school_year_id),
    CONSTRAINT cds_documents_check CHECK (invalidated_at IS NULL OR superseded_at IS NULL),
    CONSTRAINT cds_documents_mime_type_check CHECK (mime_type = 'application/pdf'),
    CONSTRAINT cds_documents_pdf_sha256_check CHECK (octet_length(pdf_sha256) = 32),
    CONSTRAINT cds_documents_pdf_size_bytes_check CHECK (pdf_size_bytes > 0),
    CONSTRAINT cds_documents_source_kind_check
        CHECK (source_kind = ANY (ARRAY['upload'::text, 'college_transitions'::text]))
);

-- V-01/T-101 (specs/cds-pipeline/plan/cds-admin-polish-2.md): NOT YET
-- APPLIED TO THE LIVE DATABASE -- an owner decision, kept here per plan
-- §3.5 so a fresh revival gets the fix from day one. No unique constraint
-- on (school_year_id, pdf_sha256) backs adapters/cds_store.py's
-- insert_document dedupe; this partial index closes that gap while still
-- allowing a byte-identical re-upload after the original was invalidated or
-- superseded. Verified against live data in a rolled-back transaction
-- (specs/cds-pipeline/plan/cds-admin-polish-2.md V-01 write-up): zero
-- current rows violate it.
CREATE UNIQUE INDEX IF NOT EXISTS cds_documents_active_sha256_uidx
    ON cds_library.cds_documents (school_year_id, pdf_sha256)
    WHERE invalidated_at IS NULL AND superseded_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cds_school_years_active_document_slot_fk'
  ) THEN
    ALTER TABLE cds_library.cds_school_years
      ADD CONSTRAINT cds_school_years_active_document_slot_fk
      FOREIGN KEY (active_document_id, id)
      REFERENCES cds_library.cds_documents (id, school_year_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cds_school_years_candidate_document_slot_fk'
  ) THEN
    ALTER TABLE cds_library.cds_school_years
      ADD CONSTRAINT cds_school_years_candidate_document_slot_fk
      FOREIGN KEY (candidate_document_id, id)
      REFERENCES cds_library.cds_documents (id, school_year_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS cds_library.cds_manifests (
    version                     text PRIMARY KEY,
    content_sha256              bytea NOT NULL UNIQUE,
    content                     jsonb NOT NULL,
    domain_hashes               jsonb NOT NULL,
    extractor_contract_version  text NOT NULL,
    is_current                  boolean NOT NULL DEFAULT false,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    published_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cds_manifests_content_check CHECK (jsonb_typeof(content) = 'object'),
    CONSTRAINT cds_manifests_content_sha256_check CHECK (octet_length(content_sha256) = 32),
    CONSTRAINT cds_manifests_domain_hashes_check CHECK (jsonb_typeof(domain_hashes) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS cds_manifests_one_current_idx
    ON cds_library.cds_manifests USING btree (is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS cds_library.cds_extractions (
    id                   uuid PRIMARY KEY,
    school_year_id       bigint NOT NULL REFERENCES cds_library.cds_school_years(id),
    document_id          bigint NOT NULL,
    manifest_version     text NOT NULL REFERENCES cds_library.cds_manifests(version),
    target_kind          text NOT NULL,
    requested_domains    text[] NOT NULL,
    status               text NOT NULL,
    queued_at            timestamptz NOT NULL DEFAULT now(),
    started_at           timestamptz,
    finished_at          timestamptz,
    lease_expires_at     timestamptz,
    extractor_version    text NOT NULL,
    model_id             text NOT NULL,
    validation_summary   jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code           text,
    error_message        text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    reactivated_at       timestamptz,
    CONSTRAINT cds_extractions_id_document_id_manifest_version_key
        UNIQUE (id, document_id, manifest_version),
    CONSTRAINT cds_extractions_document_id_school_year_id_fkey
        FOREIGN KEY (document_id, school_year_id)
        REFERENCES cds_library.cds_documents (id, school_year_id),
    CONSTRAINT cds_extractions_status_check CHECK (
        status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text,
                            'partial'::text, 'failed'::text])
    ),
    CONSTRAINT cds_extractions_target_kind_check CHECK (
        target_kind = ANY (ARRAY['candidate'::text, 'active_update'::text, 'full_reextract'::text])
    ),
    CONSTRAINT cds_extractions_requested_domains_check CHECK (cardinality(requested_domains) > 0),
    CONSTRAINT cds_extractions_requested_domains_check1
        CHECK (cds_library.is_sorted_distinct_text_array(requested_domains)),
    CONSTRAINT cds_extractions_reactivated_status_ck CHECK (
        reactivated_at IS NULL OR status = ANY (ARRAY['succeeded'::text, 'partial'::text])
    ),
    CONSTRAINT cds_extractions_check CHECK (
        (status = 'queued' AND started_at IS NULL AND finished_at IS NULL)
        OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL
            AND lease_expires_at IS NOT NULL)
        OR (status = ANY (ARRAY['succeeded'::text, 'partial'::text, 'failed'::text])
            AND started_at IS NOT NULL AND finished_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS cds_extractions_claim_idx
    ON cds_library.cds_extractions USING btree (status, queued_at);
CREATE UNIQUE INDEX IF NOT EXISTS cds_extractions_one_live_per_slot_idx
    ON cds_library.cds_extractions USING btree (school_year_id)
    WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE TABLE IF NOT EXISTS cds_library.cds_domain_packets (
    document_id          bigint NOT NULL,
    extraction_id        uuid NOT NULL,
    manifest_version     text NOT NULL,
    domain_id            text NOT NULL,
    domain_schema_hash   bytea NOT NULL,
    status               text NOT NULL,
    packet               jsonb NOT NULL,
    validation           jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active            boolean NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),
    activated_at         timestamptz,
    CONSTRAINT cds_domain_packets_pkey PRIMARY KEY (extraction_id, domain_id),
    CONSTRAINT cds_domain_packets_extraction_id_document_id_manifest_vers_fkey
        FOREIGN KEY (extraction_id, document_id, manifest_version)
        REFERENCES cds_library.cds_extractions (id, document_id, manifest_version),
    CONSTRAINT cds_domain_packets_domain_schema_hash_check
        CHECK (octet_length(domain_schema_hash) = 32),
    CONSTRAINT cds_domain_packets_status_check CHECK (
        status = ANY (ARRAY['validated'::text, 'partial'::text, 'parse_failed'::text])
    ),
    CONSTRAINT cds_domain_packets_packet_check CHECK (jsonb_typeof(packet) = 'object'),
    CONSTRAINT cds_domain_packets_validation_check CHECK (jsonb_typeof(validation) = 'object'),
    CONSTRAINT cds_domain_packets_check CHECK (is_active = false OR activated_at IS NOT NULL),
    CONSTRAINT cds_domain_packets_check1 CHECK (
        is_active = false OR status = ANY (ARRAY['validated'::text, 'partial'::text])
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS cds_domain_packets_one_active_idx
    ON cds_library.cds_domain_packets USING btree (document_id, domain_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS cds_library.ct_index_entries (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_name      text NOT NULL,
    normalized_name  text NOT NULL,
    academic_year    smallint NOT NULL,
    original_url     text NOT NULL,
    resolved_url     text NOT NULL,
    link_kind        text NOT NULL,
    indexed_at       timestamptz NOT NULL DEFAULT now(),
    generation       bigint NOT NULL DEFAULT 0,
    CONSTRAINT ct_index_entries_generation_entry_key
        UNIQUE (generation, normalized_name, academic_year, resolved_url),
    CONSTRAINT ct_index_entries_academic_year_check
        CHECK (academic_year >= 2000 AND academic_year <= 2200),
    CONSTRAINT ct_index_entries_link_kind_check
        CHECK (link_kind = ANY (ARRAY['drive'::text, 'sheet'::text, 'document'::text]))
);
CREATE INDEX IF NOT EXISTS ct_index_entries_generation_search_idx
    ON cds_library.ct_index_entries USING btree (generation, academic_year, normalized_name);
CREATE INDEX IF NOT EXISTS ct_index_entries_search_idx
    ON cds_library.ct_index_entries USING btree (academic_year, normalized_name);

CREATE TABLE IF NOT EXISTS cds_library.ct_index_state (
    id                 smallint PRIMARY KEY DEFAULT 1,
    status             text NOT NULL DEFAULT 'never_indexed',
    last_attempt_at    timestamptz,
    last_success_at    timestamptz,
    source_url         text,
    school_count       integer,
    link_count         integer,
    year_columns       jsonb NOT NULL DEFAULT '[]'::jsonb,
    parser_version     text,
    error_message      text,
    active_generation  bigint NOT NULL DEFAULT 0,
    CONSTRAINT ct_index_state_id_check CHECK (id = 1),
    CONSTRAINT ct_index_state_year_columns_check CHECK (jsonb_typeof(year_columns) = 'array')
);

-- ---------------------------------------------------------------------
-- Immutability triggers and their functions. Captured verbatim from the
-- live catalog with pg_get_functiondef/pg_get_triggerdef in Phase 0 step 1
-- (artifacts/school-data-v3/<ts>-prenuke/triggers_and_functions.sql) --
-- the pre-v3 seed file had zero CREATE TRIGGER statements even though these
-- three run live today.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cds_library.reject_immutable_document()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.school_year_id IS DISTINCT FROM OLD.school_year_id OR NEW.pdf_content IS DISTINCT FROM OLD.pdf_content
     OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 OR NEW.pdf_size_bytes IS DISTINCT FROM OLD.pdf_size_bytes
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind OR NEW.source_page_url IS DISTINCT FROM OLD.source_page_url
     OR NEW.original_download_url IS DISTINCT FROM OLD.original_download_url OR NEW.resolved_download_url IS DISTINCT FROM OLD.resolved_download_url
     OR NEW.repository_school_name IS DISTINCT FROM OLD.repository_school_name OR NEW.retrieved_at IS DISTINCT FROM OLD.retrieved_at THEN
    RAISE EXCEPTION 'CDS document evidence is immutable';
  END IF;
  IF (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
     OR (NEW.invalidated_at IS NOT NULL AND NEW.superseded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'document invalidation/supersession may be set once and are exclusive';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS cds_documents_immutable ON cds_library.cds_documents;
CREATE TRIGGER cds_documents_immutable
  BEFORE UPDATE ON cds_library.cds_documents
  FOR EACH ROW EXECUTE FUNCTION cds_library.reject_immutable_document();

CREATE OR REPLACE FUNCTION cds_library.reject_immutable_manifest()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.version IS DISTINCT FROM OLD.version OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.content IS DISTINCT FROM OLD.content OR NEW.domain_hashes IS DISTINCT FROM OLD.domain_hashes OR NEW.extractor_contract_version IS DISTINCT FROM OLD.extractor_contract_version OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN RAISE EXCEPTION 'manifest snapshot is immutable'; END IF;
 RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS cds_manifests_immutable ON cds_library.cds_manifests;
CREATE TRIGGER cds_manifests_immutable
  BEFORE UPDATE ON cds_library.cds_manifests
  FOR EACH ROW EXECUTE FUNCTION cds_library.reject_immutable_manifest();

CREATE OR REPLACE FUNCTION cds_library.reject_immutable_packet()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.extraction_id IS DISTINCT FROM OLD.extraction_id OR NEW.manifest_version IS DISTINCT FROM OLD.manifest_version OR NEW.domain_id IS DISTINCT FROM OLD.domain_id OR NEW.domain_schema_hash IS DISTINCT FROM OLD.domain_schema_hash OR NEW.status IS DISTINCT FROM OLD.status OR NEW.packet IS DISTINCT FROM OLD.packet OR NEW.validation IS DISTINCT FROM OLD.validation OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'domain packet evidence is immutable'; END IF;
 IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN RAISE EXCEPTION 'packet activation timestamp is immutable'; END IF;
 RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS cds_domain_packets_immutable ON cds_library.cds_domain_packets;
CREATE TRIGGER cds_domain_packets_immutable
  BEFORE UPDATE ON cds_library.cds_domain_packets
  FOR EACH ROW EXECUTE FUNCTION cds_library.reject_immutable_packet();

-- ---------------------------------------------------------------------
-- Reader views (four): the exact bodies pulled live via pg_get_viewdef.
-- cds_library_app also holds INSERT/UPDATE on the two non-aggregating
-- ones below because Postgres treats a single-relation, non-aggregating
-- view as automatically updatable; the grant is a no-op in practice for the
-- two aggregating views (active_cds_documents, active_cds_domain_packets).
-- `school_profiles` is NOT one of the four -- see the header comment above
-- and the grant-block comment below.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW cds_library.cds_document_sources AS
 SELECT d.id AS document_id,
    sy.school_id,
    sy.academic_year,
    d.pdf_content,
    d.pdf_sha256,
    d.mime_type,
    d.original_filename,
    d.source_kind,
    d.source_page_url,
    d.original_download_url,
    d.resolved_download_url,
    d.repository_school_name,
    d.retrieved_at,
    d.created_at,
    d.invalidated_at,
    d.superseded_at
   FROM cds_library.cds_documents d
     JOIN cds_library.cds_school_years sy ON sy.id = d.school_year_id;

CREATE OR REPLACE VIEW cds_library.cds_manifest_snapshots AS
 SELECT version,
    content_sha256,
    content,
    domain_hashes,
    published_at,
    extractor_contract_version,
    is_current
   FROM cds_library.cds_manifests;

CREATE OR REPLACE VIEW cds_library.active_cds_documents AS
 SELECT sy.school_id,
    sy.academic_year,
    sy.id AS school_year_id,
    d.id AS document_id,
    d.pdf_sha256,
    d.source_kind,
    d.source_page_url,
    d.original_download_url,
    d.resolved_download_url,
    d.retrieved_at,
        CASE
            WHEN sy.academic_year::numeric < (EXTRACT(year FROM CURRENT_DATE) -
            CASE
                WHEN EXTRACT(month FROM CURRENT_DATE) < 7::numeric THEN 1
                ELSE 0
            END::numeric) THEN 'stale'::text
            ELSE 'current'::text
        END AS currentness,
        CASE
            WHEN sy.academic_year::numeric < (EXTRACT(year FROM CURRENT_DATE) -
            CASE
                WHEN EXTRACT(month FROM CURRENT_DATE) < 7::numeric THEN 1
                ELSE 0
            END::numeric) THEN 'older_edition'::text
            ELSE NULL::text
        END AS staleness_reason,
    count(p.*) FILTER (WHERE p.is_active AND (p.status = ANY (ARRAY['validated'::text, 'partial'::text])))::integer AS usable_domain_count,
    count(p.*) FILTER (WHERE p.is_active AND p.status = 'partial'::text)::integer AS partial_domain_count,
    e.id AS latest_extraction_id,
    e.status AS latest_extraction_status,
    e.error_code AS latest_error_code
   FROM cds_library.cds_school_years sy
     JOIN cds_library.cds_documents d ON d.id = sy.active_document_id AND d.school_year_id = sy.id
     LEFT JOIN cds_library.cds_domain_packets p ON p.document_id = d.id
     LEFT JOIN LATERAL ( SELECT x.id,
            x.school_year_id,
            x.document_id,
            x.manifest_version,
            x.target_kind,
            x.requested_domains,
            x.status,
            x.queued_at,
            x.started_at,
            x.finished_at,
            x.lease_expires_at,
            x.extractor_version,
            x.model_id,
            x.validation_summary,
            x.error_code,
            x.error_message,
            x.created_at,
            x.reactivated_at
           FROM cds_library.cds_extractions x
          WHERE x.document_id = d.id
          ORDER BY x.created_at DESC, x.id DESC
         LIMIT 1) e ON true
  WHERE sy.retired_at IS NULL
  GROUP BY sy.school_id, sy.academic_year, sy.id, d.id, e.id, e.status, e.error_code;

CREATE OR REPLACE VIEW cds_library.active_cds_domain_packets AS
 WITH current_domains AS (
         SELECT domain.domain_id,
            decode(domain.domain_hash, 'hex'::text) AS domain_schema_hash
           FROM cds_library.cds_manifests m
             CROSS JOIN LATERAL jsonb_each_text(m.domain_hashes) domain(domain_id, domain_hash)
          WHERE m.is_current
        )
 SELECT sy.school_id,
    sy.academic_year,
    sy.id AS school_year_id,
    d.id AS document_id,
    d.pdf_sha256,
    current_domains.domain_id,
    p.status AS accepted_packet_status,
    p.packet,
    p.extraction_id,
    p.manifest_version,
    p.domain_schema_hash,
    COALESCE(p.domain_schema_hash = current_domains.domain_schema_hash, false) AS current_definition_match,
    latest.id AS latest_requested_extraction_id,
    latest.status AS latest_requested_outcome,
    latest.error_code AS latest_error_code
   FROM cds_library.cds_school_years sy
     JOIN cds_library.cds_documents d ON d.id = sy.active_document_id AND d.school_year_id = sy.id
     CROSS JOIN current_domains
     LEFT JOIN cds_library.cds_domain_packets p ON p.document_id = d.id AND p.domain_id = current_domains.domain_id AND p.is_active AND (p.status = ANY (ARRAY['validated'::text, 'partial'::text]))
     LEFT JOIN LATERAL ( SELECT x.id,
            x.school_year_id,
            x.document_id,
            x.manifest_version,
            x.target_kind,
            x.requested_domains,
            x.status,
            x.queued_at,
            x.started_at,
            x.finished_at,
            x.lease_expires_at,
            x.extractor_version,
            x.model_id,
            x.validation_summary,
            x.error_code,
            x.error_message,
            x.created_at,
            x.reactivated_at
           FROM cds_library.cds_extractions x
          WHERE x.document_id = d.id AND (current_domains.domain_id = ANY (x.requested_domains))
          ORDER BY x.created_at DESC, x.id DESC
         LIMIT 1) latest ON true
  WHERE sy.retired_at IS NULL;

-- ---------------------------------------------------------------------
-- Grants and default privileges (completed here -- the pre-v3 file had
-- zero GRANT and zero ALTER DEFAULT PRIVILEGES statements even though
-- these run live today). cds_library_app never holds DELETE anywhere
-- (ADR 0036).
-- ---------------------------------------------------------------------

GRANT USAGE ON SCHEMA cds_library TO cds_library_app;
-- `schools` and `school_profiles` are deliberately absent from this list: neither is part of this
-- file (see the base-tables and reader-views comments above) -- both are live v3 objects owned by
-- deploy/seed/cds_library_schema.sql, which grants cds_library_app SELECT-only on `schools` (a v3
-- invariant `scripts/dev.py` checks for) and nothing at all on `school_profiles`. PostgreSQL grants
-- are additive, so granting INSERT/UPDATE/SELECT here would widen that role's privileges on objects
-- this file does not own the moment this DDL is applied for revival.
GRANT INSERT, SELECT, UPDATE ON TABLE
  cds_library.cds_school_years,
  cds_library.cds_documents,
  cds_library.cds_manifests,
  cds_library.cds_extractions,
  cds_library.cds_domain_packets,
  cds_library.ct_index_entries,
  cds_library.ct_index_state,
  cds_library.active_cds_documents,
  cds_library.active_cds_domain_packets,
  cds_library.cds_document_sources,
  cds_library.cds_manifest_snapshots
TO cds_library_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA cds_library TO cds_library_app;

GRANT USAGE ON SCHEMA cds_library TO cds_library_reader;
-- `school_profiles` is likewise absent here: deploy/seed/cds_library_schema.sql already grants
-- cds_library_reader SELECT on it, so re-granting it here would be a harmless duplicate today, but
-- it still isn't this file's object to grant on -- same rule as the cds_library_app block above.
GRANT SELECT ON TABLE
  cds_library.active_cds_documents,
  cds_library.active_cds_domain_packets,
  cds_library.cds_document_sources,
  cds_library.cds_manifest_snapshots
TO cds_library_reader;

-- Matches the live default-privilege rows exactly (rU on sequences, not the
-- v3 live seed's tightened U -- this file preserves what actually runs
-- today rather than fixing it, per D8).
ALTER DEFAULT PRIVILEGES FOR ROLE cds_library_owner IN SCHEMA cds_library
  GRANT INSERT, SELECT, UPDATE ON TABLES TO cds_library_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cds_library_owner IN SCHEMA cds_library
  GRANT SELECT, USAGE ON SEQUENCES TO cds_library_app;

RESET ROLE;
