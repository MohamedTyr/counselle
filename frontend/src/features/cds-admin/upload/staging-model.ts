import type { UploadRow } from "@/api/cds-admin/types";
import { formatAcademicYear } from "@/features/cds-admin/cds-format";
import type { UploadRowStatus } from "@/features/cds-admin/cds-status";

// ---------------------------------------------------------------------------
// The staging row model
// ---------------------------------------------------------------------------

/** A staged file's client-only request lifecycle. Distinct from the
 * server's `UploadRow.status` — `phase` tracks the one `POST` this file
 * made; `row` is the truth once that request resolves.
 *
 * There is deliberately no `detecting` phase here (SHIP-PLAN.md §6.10):
 * `fetch` gives no upload-progress events, so a size-scaled timer flipping
 * the label mid-upload had no real signal behind it — a fabricated progress
 * step, which is exactly what law 4 bans. The row stays `uploading` (chip
 * keeps spinning, honestly) until the response lands. `detecting` remains a
 * legitimate `UploadRowStatus` wire value (DESIGN.md §2.3) for the day a
 * real server-side signal exists to drive it; the client just never
 * produces it today. */
export type StagingPhase = "uploading" | "resolved" | "request-failed";

export interface StagingEntry {
  clientId: string;
  file: File;
  phase: StagingPhase;
  row: UploadRow | null;
  /** Set only when the `POST` itself rejected before any row came back
   * (network error, 5xx) — distinct from a normal 201 where the server
   * itself chose `status: "error"` for this file. */
  requestError: string | null;
}

export function stagingEntryFromServerRow(row: UploadRow): StagingEntry {
  return {
    clientId: row.id,
    file: new File([], row.filename, { type: "application/pdf" }),
    phase: "resolved",
    row,
    requestError: null,
  };
}

/** Merges a fresh `GET /uploads?batch_id=` response into the current local
 * list. Never removes an entry on absence — deletes are applied optimistic
 * (the caller drops the entry directly on a successful `DELETE`), so a
 * stale/in-flight snapshot can never make a row flicker out. Existing
 * entries get their `row` refreshed in place (PATCH edits, process
 * transitions); rows the client has never seen (initial load, another tab)
 * are appended in the server's own order. */
export function reconcileWithServer(
  current: StagingEntry[],
  serverRows: UploadRow[],
): StagingEntry[] {
  const knownRowIds = new Set(
    current.map((entry) => entry.row?.id).filter((id): id is string => Boolean(id)),
  );

  const updated = current.map((entry) => {
    if (!entry.row) {
      return entry;
    }
    const fresh = serverRows.find((row) => row.id === entry.row!.id);
    if (fresh && fresh.updated_at !== entry.row.updated_at) {
      return { ...entry, row: fresh };
    }
    return entry;
  });

  const newFromServer = serverRows
    .filter((row) => !knownRowIds.has(row.id))
    .map(stagingEntryFromServerRow);

  return [...updated, ...newFromServer];
}

export function updateEntryRow(
  entries: StagingEntry[],
  clientId: string,
  row: UploadRow,
): StagingEntry[] {
  return entries.map((entry) =>
    entry.clientId === clientId
      ? { ...entry, phase: "resolved" as const, row, requestError: null }
      : entry,
  );
}

export function markEntryFailed(
  entries: StagingEntry[],
  clientId: string,
  message: string,
): StagingEntry[] {
  return entries.map((entry) =>
    entry.clientId === clientId
      ? { ...entry, phase: "request-failed" as const, requestError: message }
      : entry,
  );
}

export function removeEntry(
  entries: StagingEntry[],
  clientId: string,
): StagingEntry[] {
  return entries.filter((entry) => entry.clientId !== clientId);
}

// ---------------------------------------------------------------------------
// File acceptance
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_FILE_SIZE_BYTES = 50 * 1024 * 1024;

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

export function partitionFiles(files: File[]): {
  accepted: File[];
  rejected: File[];
} {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    if (isPdfFile(file) && file.size <= MAX_UPLOAD_FILE_SIZE_BYTES) {
      accepted.push(file);
    } else {
      rejected.push(file);
    }
  }
  return { accepted, rejected };
}

export function rejectedFilesMessage(count: number): string {
  return `${count} file${count === 1 ? "" : "s"} skipped — PDF only, 50 MB max`;
}

// ---------------------------------------------------------------------------
// Row-level status + reason line (§2.3)
// ---------------------------------------------------------------------------

/** The chip status for a staging row, or `"committed"` once it's been
 * queued for processing — at which point the caller switches to the
 * document vocabulary (`document-status.ts`) instead of this one. */
export type StagingChipStatus = UploadRowStatus | "committed";

export function stagingChipStatus(entry: StagingEntry): StagingChipStatus {
  if (entry.phase === "uploading") {
    return entry.phase;
  }
  if (entry.phase === "request-failed") {
    return "failed";
  }
  const row = entry.row;
  if (!row) {
    return "uploading";
  }
  if (row.status === "error") {
    return "failed";
  }
  return row.status;
}

export function needsInputReason(row: UploadRow): string {
  const missingSchool = row.school_id === null;
  const missingYear = row.academic_year === null;
  if (missingSchool && missingYear) {
    return "Pick a school and year";
  }
  if (missingSchool) {
    return "Pick a school";
  }
  if (missingYear) {
    return "Pick a year";
  }
  return "";
}

/** The `text-xs text-muted-foreground` reason sub-line under a row's status
 * chip, plus an optional document id to link (`replaces_existing`'s target
 * isn't identifiable from the wire contract — `DetectionInfo.duplicate_of`
 * is documented as duplicate-only, so it's deliberately left unlinked
 * rather than guessed; see the PR notes). */
export function stagingReason(entry: StagingEntry): {
  text: string;
  linkedDocumentId: number | null;
} {
  if (entry.phase === "request-failed") {
    return { text: entry.requestError ?? "Could not upload this file.", linkedDocumentId: null };
  }
  if (entry.phase === "uploading") {
    return { text: "", linkedDocumentId: null };
  }

  const row = entry.row;
  if (!row) {
    return { text: "", linkedDocumentId: null };
  }

  switch (row.status) {
    case "needs_input":
      return { text: needsInputReason(row), linkedDocumentId: null };
    case "replaces_existing":
      return {
        text: row.academic_year
          ? `Supersedes the ${formatAcademicYear(row.academic_year)} document`
          : "Supersedes an existing document",
        linkedDocumentId: null,
      };
    case "duplicate":
      return {
        text: "Matches an existing document",
        linkedDocumentId: row.detection.duplicate_of,
      };
    case "error":
      return { text: row.error_message ?? "Something went wrong.", linkedDocumentId: null };
    default:
      return { text: "", linkedDocumentId: null };
  }
}

// ---------------------------------------------------------------------------
// The action bar's readiness sentence (§4.7 / §4.8.8)
// ---------------------------------------------------------------------------

export function buildReadinessSentence(entries: StagingEntry[]): string {
  const counts = { duplicate: 0, failed: 0, needsInput: 0, ready: 0 };
  let inFlight = 0;

  for (const entry of entries) {
    if (entry.phase === "uploading") {
      inFlight += 1;
      continue;
    }
    if (entry.phase === "request-failed") {
      counts.failed += 1;
      continue;
    }
    const row = entry.row;
    if (!row || row.status === "committed") {
      continue;
    }
    if (row.status === "matched" || row.status === "replaces_existing") {
      counts.ready += 1;
    } else if (row.status === "needs_input") {
      counts.needsInput += 1;
    } else if (row.status === "duplicate") {
      counts.duplicate += 1;
    } else if (row.status === "error") {
      counts.failed += 1;
    }
  }

  const parts: string[] = [];
  if (counts.ready > 0) parts.push(`${counts.ready} ready`);
  if (counts.needsInput > 0) {
    parts.push(`${counts.needsInput} need${counts.needsInput === 1 ? "s" : ""} input`);
  }
  if (counts.duplicate > 0) {
    parts.push(`${counts.duplicate} duplicate${counts.duplicate === 1 ? "" : "s"} skipped`);
  }
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (inFlight > 0) parts.push(`${inFlight} uploading`);

  if (parts.length === 0) {
    return "This batch is empty.";
  }
  return parts.join(" · ");
}

export function readyToProcessCount(entries: StagingEntry[]): number {
  return entries.filter(
    (entry) =>
      entry.row &&
      (entry.row.status === "matched" || entry.row.status === "replaces_existing"),
  ).length;
}

export function committedFileIds(entries: StagingEntry[]): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.row?.status === "committed")
      .map((entry) => entry.row!.id),
  );
}
