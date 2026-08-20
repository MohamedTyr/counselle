-- Counselle CDS reader contract (ADR 0012): the five read-only surfaces the
-- app consumes, materialised as plain tables for the staging deployment.
-- Generated from artifacts/deploy/cds-reader-schema.sql.

CREATE SCHEMA IF NOT EXISTS cds_library;
CREATE TABLE IF NOT EXISTS cds_library.active_cds_documents (
    school_id integer,
    academic_year smallint,
    school_year_id bigint,
    document_id bigint,
    pdf_sha256 bytea,
    source_kind text,
    source_page_url text,
    original_download_url text,
    resolved_download_url text,
    retrieved_at timestamp with time zone,
    currentness text,
    staleness_reason text,
    usable_domain_count integer,
    partial_domain_count integer,
    latest_extraction_id uuid,
    latest_extraction_status text,
    latest_error_code text
);
CREATE TABLE IF NOT EXISTS cds_library.active_cds_domain_packets (
    school_id integer,
    academic_year smallint,
    school_year_id bigint,
    document_id bigint,
    pdf_sha256 bytea,
    domain_id text,
    accepted_packet_status text,
    packet jsonb,
    extraction_id uuid,
    manifest_version text,
    domain_schema_hash bytea,
    current_definition_match boolean,
    latest_requested_extraction_id uuid,
    latest_requested_outcome text,
    latest_error_code text
);
CREATE TABLE IF NOT EXISTS cds_library.cds_document_sources (
    document_id bigint,
    school_id integer,
    academic_year smallint,
    pdf_content bytea,
    pdf_sha256 bytea,
    mime_type text,
    original_filename text,
    source_kind text,
    source_page_url text,
    original_download_url text,
    resolved_download_url text,
    repository_school_name text,
    retrieved_at timestamp with time zone,
    created_at timestamp with time zone,
    invalidated_at timestamp with time zone,
    superseded_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS cds_library.cds_manifest_snapshots (
    version text,
    content_sha256 bytea,
    content jsonb,
    domain_hashes jsonb,
    published_at timestamp with time zone,
    extractor_contract_version text,
    is_current boolean
);
CREATE TABLE IF NOT EXISTS cds_library.school_profiles (
    id integer,
    name text,
    aliases text[],
    city text,
    state text,
    postal_code text,
    latitude numeric,
    longitude numeric,
    official_website text,
    official_domain text,
    general_phone text,
    is_currently_operating boolean,
    is_main_campus boolean,
    search_name text,
    basic_profile jsonb,
    profile_provenance jsonb,
    profile_version text,
    profile_snapshot_date date,
    profile_sha256 bytea,
    imported_at timestamp with time zone
);
