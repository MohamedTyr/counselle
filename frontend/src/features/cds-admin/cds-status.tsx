/* eslint-disable react-refresh/only-export-components */
import {
  ArrowRightLeft,
  CircleCheck,
  CircleHelp,
  Clock,
  Copy,
  Flag,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type React from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * THE status vocabulary for the three CDS admin screens (Coverage, Batch
 * upload, Document review) — single source of truth, per DESIGN.md §2.
 * Nobody else defines a status→variant mapping; all three screens import
 * from here.
 */

/** A school-year's CDS document status. Identical in coverage cells, upload
 * rows once processing starts, and the review header. */
export type CdsStatus =
  | "none"
  | "processing"
  | "needs_review"
  | "approved"
  | "failed";

/** A staged file's readiness during batch upload — a different axis from
 * `CdsStatus`, obeying the same colour law. */
export type UploadRowStatus =
  | "uploading"
  | "detecting"
  | "matched"
  | "needs_input"
  | "replaces_existing"
  | "duplicate"
  | "failed";

/** Validation-flag severity — Document review only. */
export type FlagSeverity = "error" | "warning" | "info";

type CdsStatusEntry = {
  variant: BadgeVariant | null;
  Icon: LucideIcon | null;
  label: string;
  shortLabel: string;
};

type UploadRowStatusEntry = {
  variant: BadgeVariant;
  Icon: LucideIcon;
  label: string;
};

type FlagSeverityEntry = {
  variant: BadgeVariant;
  Icon: LucideIcon;
  label: string;
};

// `none` renders no badge — the coverage grid's empty cell (§3.6) handles
// that state itself with a `·`/`Plus` affordance, not `StatusChip`.
// `processing` carries two icons: `Clock` when queued (the default here),
// swapped for a spinning `Loader2` by `StatusChip`'s `running` prop — a
// queued job is not a running job, and a spinning icon for work that
// hasn't started is a small lie (DESIGN.md law 4).
export const cdsStatusMeta: Record<CdsStatus, CdsStatusEntry> = {
  none: { variant: null, Icon: null, label: "Not uploaded", shortLabel: "" },
  processing: {
    variant: "secondary",
    Icon: Clock,
    label: "Queued",
    shortLabel: "Processing",
  },
  needs_review: {
    variant: "warning",
    Icon: Flag,
    label: "Needs review",
    shortLabel: "Review",
  },
  approved: {
    variant: "success",
    Icon: CircleCheck,
    label: "Approved",
    shortLabel: "Approved",
  },
  failed: {
    variant: "destructive",
    Icon: OctagonX,
    label: "Failed",
    shortLabel: "Failed",
  },
};

export const uploadRowStatusMeta: Record<
  UploadRowStatus,
  UploadRowStatusEntry
> = {
  uploading: { variant: "secondary", Icon: Loader2, label: "Uploading" },
  detecting: { variant: "secondary", Icon: Loader2, label: "Detecting" },
  matched: { variant: "success", Icon: CircleCheck, label: "Ready" },
  needs_input: { variant: "warning", Icon: CircleHelp, label: "Needs input" },
  replaces_existing: {
    variant: "secondary",
    Icon: ArrowRightLeft,
    label: "Replaces",
  },
  duplicate: { variant: "secondary", Icon: Copy, label: "Duplicate" },
  failed: { variant: "destructive", Icon: OctagonX, label: "Failed" },
};

export const flagSeverityMeta: Record<FlagSeverity, FlagSeverityEntry> = {
  error: { variant: "destructive", Icon: OctagonX, label: "Error" },
  warning: { variant: "warning", Icon: TriangleAlert, label: "Warning" },
  info: { variant: "secondary", Icon: Info, label: "Note" },
};

/**
 * Document status chip (§2.1). Returns `null` for `"none"` — see the note
 * on `cdsStatusMeta` above.
 */
export function StatusChip({
  status,
  running = false,
  size = "default",
  short = false,
}: {
  status: CdsStatus;
  running?: boolean;
  size?: "sm" | "default";
  short?: boolean;
}): React.ReactElement | null {
  const meta = cdsStatusMeta[status];
  if (!meta.variant || !meta.Icon) {
    return null;
  }

  const spinning = status === "processing" && running;
  const Icon = spinning ? Loader2 : meta.Icon;
  const label =
    status === "processing" ? (running ? "Extracting" : meta.label) : meta.label;

  return (
    <Badge size={size} variant={meta.variant}>
      <Icon aria-hidden="true" className={spinning ? "animate-spin" : undefined} />
      {short ? meta.shortLabel : label}
    </Badge>
  );
}

/** Upload row status chip (§2.3) — the file-readiness axis, batch upload
 * only. The reason sub-line is rendered by the caller, not this component. */
export function UploadStatusChip({
  status,
}: {
  status: UploadRowStatus;
}): React.ReactElement {
  const meta = uploadRowStatusMeta[status];
  const spinning = status === "uploading" || status === "detecting";
  const Icon = meta.Icon;

  return (
    <Badge variant={meta.variant}>
      <Icon aria-hidden="true" className={spinning ? "animate-spin" : undefined} />
      {meta.label}
    </Badge>
  );
}

/**
 * Flag severity chip (§2.4) — icon + flag code only (e.g. "C1"). The
 * human-readable `message` is the row's expanded text, never tooltip-only.
 */
export function FlagChip({
  severity,
  code,
}: {
  severity: FlagSeverity;
  code: string;
}): React.ReactElement {
  const meta = flagSeverityMeta[severity];
  const Icon = meta.Icon;

  return (
    <Badge
      aria-label={`${meta.label}: ${code}`}
      size="sm"
      variant={meta.variant}
    >
      <Icon aria-hidden="true" />
      {code}
    </Badge>
  );
}
