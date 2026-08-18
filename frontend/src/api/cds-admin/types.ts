/**
 * TS mirror of the CDS admin API's frozen backend contract
 * (`app/cds/models.py` + `adapters/cds_admin_types.py`) — every field name
 * and shape below is copied verbatim from those two files, not guessed.
 * Do not duplicate `CdsStatus`/`UploadRowStatus`/`FlagSeverity` — those are
 * the shared UI vocabulary and live in
 * `@/features/cds-admin/cds-status.tsx`. `CellStatus` here is the same set
 * of five strings as `CdsStatus`, kept as its own type because it's what
 * the wire actually sends on `CoverageCell.status`.
 */

// ---------------------------------------------------------------------------
// Coverage + schools (endpoints #1-#2)
// ---------------------------------------------------------------------------

export type CellStatus =
  | "none"
  | "processing"
  | "needs_review"
  | "approved"
  | "failed";

export interface CoverageCell {
  status: CellStatus;
  school_year_id: number | null;
  document_id: number | null;
  extraction_id: string | null;
  extractor_version: string | null;
  error_code: string | null;
  updated_at: string | null;
  active_domains: number | null;
  partial_domains: number | null;
  candidate_domains: number | null;
}

export interface CoverageRow {
  school_id: number;
  name: string;
  state: string | null;
  /** Keyed by academic year (e.g. `2025`). JSON object keys are strings on
   * the wire; JS numeric property access (`row.cells[2025]`) works the same
   * either way, so this is typed by the logical key, not the wire key. */
  cells: Record<number, CoverageCell>;
}

export interface CoverageCounters {
  schools: number;
  editions: number;
  needs_review: number;
  processing: number;
  approved: number;
  failed: number;
  missing: number;
}

export interface CoverageResult {
  years: number[];
  rows: CoverageRow[];
  counters: CoverageCounters;
  total: number;
}

/** Query params for `GET /admin/cds/coverage`. */
export interface CoverageFilters {
  q?: string;
  year?: number[];
  status?: CellStatus[];
  missing_year?: number;
  all_schools?: boolean;
  limit?: number;
  offset?: number;
}

/** Typeahead row for the upload screen's school picker (endpoint #2). */
export interface SchoolSummary {
  id: number;
  name: string;
  state: string | null;
  city: string | null;
}

// ---------------------------------------------------------------------------
// Shared document/evidence shapes
// ---------------------------------------------------------------------------

export interface DocumentMeta {
  id: number;
  school_year_id: number;
  school_id: number;
  school_name: string;
  academic_year: number;
  pdf_sha256: string;
  pdf_size_bytes: number;
  original_filename: string | null;
  source_kind: string;
  retrieved_at: string;
  invalidated_at: string | null;
  superseded_at: string | null;
  is_candidate: boolean;
  is_active: boolean;
  /** The document's true page count, known server-side since upload
   * (`adapters/cds_pdf.get_page_count`). `null` for documents that didn't
   * come through the upload flow. */
  page_count: number | null;
}

export interface EvidenceRow {
  page_number: number | null;
  excerpt: string | null;
  section: string | null;
  row_label: string | null;
  column_label: string | null;
}

/** One row of the upload screen's live job-polling list (endpoint #8). */
export interface JobStatusRow {
  extraction_id: string;
  school_id: number;
  school_name: string;
  academic_year: number;
  document_id: number;
  status: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  progress: Record<string, unknown>;
}

/** Extraction statuses that mean "still working" (`adapters/cds_store.py`,
 * `app/cds/engine.py`) — the rest (`succeeded`/`partial`/`failed`) are
 * terminal. Used to drive job/coverage/review polling (DESIGN.md §1.8). */
export const CDS_NON_TERMINAL_EXTRACTION_STATUSES = new Set([
  "queued",
  "running",
]);

export function isNonTerminalExtractionStatus(status: string): boolean {
  return CDS_NON_TERMINAL_EXTRACTION_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Uploads / staging (endpoints #3-#7)
// ---------------------------------------------------------------------------

export type UploadStatus =
  | "matched"
  | "needs_input"
  | "replaces_existing"
  | "duplicate"
  | "committed"
  | "error";

export interface DetectionCandidate {
  school_id: number;
  name: string;
  state: string | null;
  city: string | null;
  score: number;
}

/** `counselle.cds_upload_files.detection` jsonb, typed. */
export interface DetectionInfo {
  name: string | null;
  year: number | null;
  confident: boolean;
  candidates: DetectionCandidate[];
  error: string | null;
  /** Existing document_id, when `status === "duplicate"`. */
  duplicate_of: number | null;
}

export interface UploadRow {
  id: string;
  batch_id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  page_count: number | null;
  status: UploadStatus;
  school_id: number | null;
  school_name: string | null;
  academic_year: number | null;
  detection: DetectionInfo;
  error_message: string | null;
  committed_document_id: number | null;
  committed_extraction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadBatch {
  batch_id: string;
  rows: UploadRow[];
}

export interface UploadPatchBody {
  school_id?: number | null;
  academic_year?: number | null;
}

export interface ProcessQueuedItem {
  file_id: string;
  school_year_id: number;
  document_id: number;
  extraction_id: string;
}

export interface ProcessSkippedItem {
  file_id: string;
  reason: string;
}

export interface ProcessResult {
  queued: ProcessQueuedItem[];
  skipped: ProcessSkippedItem[];
}

// ---------------------------------------------------------------------------
// Review (endpoints #9, #11, #12, #13, #14)
// ---------------------------------------------------------------------------

export interface ReviewFlagOut {
  code: string;
  severity: "error" | "warning";
  message: string;
  metric_ref: string | null;
}

/** One row of `counselle.cds_pending_edits`, typed for the review screen. */
export interface PendingEditOut {
  value: unknown;
  raw_value: string | null;
  availability_status: string | null;
  evidence: EvidenceRow;
  note: string | null;
  edited_by: string;
  edited_at: string;
}

export interface ReviewMetric {
  ref: string;
  title: string;
  description: string | null;
  type: string;
  unit: string | null;
  source_hints: string[];
  value: unknown;
  raw_value: string | null;
  display: string | null;
  availability_status: string | null;
  extraction_status: string | null;
  evidence: EvidenceRow | null;
  flags: ReviewFlagOut[];
  pending_edit: PendingEditOut | null;
}

export interface ReviewSection {
  domain_id: string;
  title: string;
  status: string | null;
  counts: Record<string, number>;
  metrics: ReviewMetric[];
}

export interface ReviewExtraction {
  id: string;
  status: string;
  extractor_version: string;
  model_id: string;
  finished_at: string | null;
  error_code: string | null;
  counts: Record<string, number>;
}

export interface FlagsSummary {
  unresolved: number;
  total: number;
}

/** The review screen's read model (plan §D `DocumentReview`). */
export interface DocumentReviewOut {
  document: DocumentMeta;
  extraction: ReviewExtraction | null;
  sections: ReviewSection[];
  flags_summary: FlagsSummary;
}

export interface EvidenceIn {
  page_number: number;
  excerpt: string;
  section?: string | null;
  row_label?: string | null;
  column_label?: string | null;
}

export interface MetricEditIn {
  metric_ref: string;
  domain_id: string;
  value?: unknown;
  raw_value?: string | null;
  availability_status: string;
  evidence: EvidenceIn;
  note?: string | null;
}

export interface MetricEditsBody {
  edits: MetricEditIn[];
}

export interface ApproveBody {
  override_flags?: boolean;
  note?: string | null;
}

export interface ApproveResult {
  document_id: number;
  activated_domains: string[];
  extraction_id: string | null;
}

export interface RejectBody {
  reason: string;
}

export interface RerunBody {
  domains?: string[] | null;
}

export interface RerunResult {
  extraction_id: string;
}
