-- CDS admin surface (plans/cds-pipeline/PLAN.md §C2): upload staging, pending
-- review edits, and the actor-attributed audit log. Additive, counselle.* only —
-- cds_library.* is never touched by this repo's migrations (see plan §C1).
-- depends: 0014_response_mode

-- Files live here between upload and "Process all". A PDF cannot become a
-- cds_documents row until a school_year exists, and a school_year needs a
-- confirmed school + academic year, so uploads stage here first.
CREATE TABLE counselle.cds_upload_files (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                 uuid NOT NULL,
  uploaded_by              uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  filename                 text NOT NULL CHECK (btrim(filename) <> ''),
  content                  bytea,          -- dropped (set NULL) once committed to cds_documents
  size_bytes               bigint NOT NULL CHECK (size_bytes > 0),
  sha256                   bytea NOT NULL CHECK (octet_length(sha256) = 32),
  page_count               integer CHECK (page_count IS NULL OR page_count > 0),
  status                   text NOT NULL CHECK (
    status IN ('matched', 'needs_input', 'replaces_existing', 'duplicate', 'committed', 'error')
  ),
  -- No FK: cross-schema — counselle_app has zero grants on cds_library (plan §C2/§C3).
  school_id                integer,
  academic_year            smallint CHECK (academic_year IS NULL OR academic_year BETWEEN 2000 AND 2200),
  detection                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detection) = 'object'),
  error_message            text,
  committed_document_id    bigint,
  committed_extraction_id  uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cds_upload_files_batch_idx ON counselle.cds_upload_files (batch_id, created_at);
CREATE INDEX cds_upload_files_sha_idx ON counselle.cds_upload_files (sha256);

-- Pending review edits, held until Approve materializes them into a
-- human-review packet (cds_domain_packets is immutable — corrections are new
-- rows, never UPDATEs, per plan §B5). Nothing in cds_library moves until then.
CREATE TABLE counselle.cds_pending_edits (
  document_id  bigint NOT NULL,
  metric_ref   text NOT NULL CHECK (btrim(metric_ref) <> ''),
  domain_id    text NOT NULL CHECK (btrim(domain_id) <> ''),
  payload      jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  edited_by    uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  edited_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, metric_ref)
);

-- Who did what, forever. Actor is always the authenticated superuser's id —
-- never client-supplied (app/cds/audit.py is the only writer).
CREATE TABLE counselle.cds_admin_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid NOT NULL REFERENCES counselle.users(id),
  action         text NOT NULL CHECK (
    action IN ('upload', 'commit', 'extract', 'edit', 'approve', 'approve_override', 'reject', 'rerun')
  ),
  school_id      integer,
  academic_year  smallint CHECK (academic_year IS NULL OR academic_year BETWEEN 2000 AND 2200),
  document_id    bigint,
  extraction_id  uuid,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX cds_admin_audit_at_idx ON counselle.cds_admin_audit (at DESC);
CREATE INDEX cds_admin_audit_document_idx ON counselle.cds_admin_audit (document_id, at DESC)
  WHERE document_id IS NOT NULL;
