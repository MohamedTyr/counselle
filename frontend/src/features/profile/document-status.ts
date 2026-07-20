import type { BadgeProps } from "@/components/ui/badge";
import type { DocumentTextStatus, DocumentType } from "@/api/workspace/types";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * Honesty-critical: mirrors the server-side extraction-honesty invariant
 * (`app/student_context.py`, plan Part B) — a document Counselle could not
 * read must never be presented as though its content were understood.
 * `extracted` is the only status implying readable content; `unsupported`
 * and `failed` both render an explicit "can't read this yet" message.
 */
export const DOCUMENT_STATUS_LABEL: Record<DocumentTextStatus, string> = {
  extracted: "Readable",
  unsupported: "Can't read yet",
  failed: "Couldn't read",
};

export const DOCUMENT_STATUS_BADGE_VARIANT: Record<
  DocumentTextStatus,
  BadgeVariant
> = {
  extracted: "success",
  unsupported: "warning",
  failed: "error",
};

export function documentStatusMessage(status: DocumentTextStatus): string {
  switch (status) {
    case "extracted":
      return "Counselle can read this document's contents.";
    case "unsupported":
      return "Counselle can see this file but can't read it yet (unsupported format).";
    case "failed":
      return "Counselle couldn't extract text from this file.";
  }
}

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  transcript: "Transcript",
  resume: "Resume",
  essay: "Essay",
  recommendation: "Recommendation",
  award: "Award",
  school_report: "School report",
  other: "Other",
};

export const DOCUMENT_TYPE_OPTIONS: readonly {
  label: string;
  value: DocumentType;
}[] = (Object.keys(DOCUMENT_TYPE_LABEL) as DocumentType[]).map((value) => ({
  label: DOCUMENT_TYPE_LABEL[value],
  value,
}));
