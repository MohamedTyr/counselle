import { useState } from "react";

import type {
  RequirementApplicability,
  SchoolRequirement,
  TaskCategory,
  TrackableRequirementKind,
} from "@/api/workspace/types";

/*
 * Shared vocabulary for the school workspace surfaces.
 *
 * Extracted from SchoolWorkspace.tsx, which had grown to 1489 lines against
 * the 800-line house limit. Pure move: every function below is byte-identical
 * to what it replaced, so this file changes structure and nothing else.
 */

export const applicabilityLabels: Record<RequirementApplicability, string> = {
  required: "Required",
  optional: "Optional",
  not_required: "Not required",
  conditional: "Conditional",
  unknown: "Unknown",
};

export type CommonRequirement = {
  kind: string;
  label: string;
  category: TaskCategory;
  trackable?: TrackableRequirementKind;
  statuses?: string[];
};

export const commonRequirements: CommonRequirement[] = [
  {
    kind: "fee",
    label: "Application fee",
    category: "form",
    trackable: "fee",
    statuses: ["to_do", "waiver_requested", "paid"],
  },
  {
    kind: "testing",
    label: "Testing",
    category: "form",
    trackable: "testing",
    statuses: ["not_started", "in_progress", "submitted"],
  },
  {
    kind: "css_profile",
    label: "CSS Profile",
    category: "aid",
    trackable: "css_profile",
    statuses: ["not_started", "in_progress", "submitted"],
  },
  {
    kind: "fafsa",
    label: "FAFSA",
    category: "aid",
    trackable: "fafsa",
    statuses: ["not_started", "in_progress", "submitted"],
  },
  { kind: "teacher_rec", label: "Teacher recommendations", category: "lor" },
  { kind: "counselor_rec", label: "Counselor recommendation", category: "lor" },
  { kind: "transcript", label: "Transcript", category: "form" },
  { kind: "interview", label: "Interview", category: "interview" },
];


export function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function useSyncedDraft<TValue>(serverValue: TValue) {
  const [draft, setDraft] = useState({ dirty: false, value: serverValue });
  return {
    dirty: draft.dirty,
    value: draft.dirty ? draft.value : serverValue,
    setValue: (next: TValue) => setDraft({ dirty: true, value: next }),
    commit: () => setDraft((current) => ({ ...current, dirty: false })),
    revert: () => setDraft({ dirty: false, value: serverValue }),
  };
}

export function cycleLabel(cycleYear: number | null | undefined) {
  return cycleYear
    ? `${cycleYear - 1}-${String(cycleYear).slice(-2)}`
    : "cycle not confirmed";
}

export function referenceDetail(requirement: SchoolRequirement) {
  if (requirement.kind === "fee") {
    const amount = requirement.detail.amount_cents;
    const waiver = requirement.detail.waiver_available;
    const parts = [
      typeof amount === "number" ? `Fee: $${(amount / 100).toFixed(2)}` : null,
      typeof waiver === "boolean"
        ? `Fee waiver: ${waiver ? "available" : "not available"}`
        : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }
  if (
    requirement.kind === "teacher_rec" ||
    requirement.kind === "counselor_rec"
  ) {
    const count = requirement.detail.count;
    if (typeof count === "number")
      return `${count} recommendation${count === 1 ? "" : "s"}`;
  }
  if (requirement.kind === "testing") {
    const policy = requirement.detail.policy;
    if (typeof policy === "string") return humanize(policy);
  }
  const entries = Object.entries(requirement.detail ?? {}).filter(
    ([, value]) => value !== null && value !== "",
  );
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => `${humanize(key)}: ${formatDetailValue(value)}`)
    .join(" · ");
}

function formatDetailValue(value: unknown, depth = 0): string {
  if (value == null) return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (depth >= 2) return "See cited source";
  if (Array.isArray(value))
    return value.map((item) => formatDetailValue(item, depth + 1)).join(", ");
  if (typeof value === "object") {
    return (
      Object.entries(value as Record<string, unknown>)
        .map(
          ([key, nested]) =>
            `${humanize(key)} ${formatDetailValue(nested, depth + 1)}`,
        )
        .join("; ") || "No additional detail"
    );
  }
  return "See cited source";
}

export function audienceDescription(audience: Record<string, unknown>) {
  const knownLabels: Record<string, string> = {
    applicant_type: "Applicant type",
    college: "College",
    major: "Major",
    program: "Program",
    residency: "Residency",
  };
  const entries = Object.entries(audience ?? {});
  if (entries.length === 0) return null;
  const readable = entries
    .filter(
      ([key, value]) =>
        key in knownLabels &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"),
    )
    .map(([key, value]) => `${knownLabels[key]}: ${String(value)}`);
  const hasAdditionalConditions = entries.some(
    ([key]) => !(key in knownLabels),
  );
  if (readable.length === 0) {
    return "Published conditions apply; verify the details in the cited source.";
  }
  return `${readable.join(" · ")}${hasAdditionalConditions ? " · Additional published conditions also apply" : ""}`;
}
