import { useState } from "react";

import type { ScholarshipView } from "@/api/scholarships/types";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { evaluateCriteria, summarizeFit } from "@/features/scholarships/eligibility";
import { StatusDot } from "@/features/scholarships/FitMark";
import { ScholarshipDetail } from "@/features/scholarships/ScholarshipDetail";
import {
  EMPTY_FACTS,
  factsThatFail,
  factsThatFit,
  type Check,
  type PreviewProfile,
} from "@/features/scholarships-admin/editor-draft";

const PROFILE_OPTIONS: { value: PreviewProfile; label: string }[] = [
  { value: "fits", label: "Fits" },
  { value: "fails", label: "Doesn't fit" },
  { value: "empty", label: "Empty profile" },
];

export function PublishChecklist({ checks }: { checks: Check[] }) {
  const open = checks.filter((check) => !check.ok).length;
  return (
    <section
      aria-label="Before publishing"
      className="flex flex-col gap-3 rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] px-5 py-4 shadow-[var(--elevation-1)]"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Before publishing</h2>
        <span className="text-xs text-[var(--ink-muted)]">{open === 0 ? "Ready" : `${open} to fix`}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {checks.map((check) => (
          <li className="flex items-center gap-2.5 text-sm" key={check.key}>
            <StatusDot status={check.ok ? "met" : "unmet"} />
            <span className={check.ok ? "text-[var(--ink-secondary)]" : "text-[var(--ink)]"}>
              <span className="sr-only">{check.ok ? "Done: " : "To fix: "}</span>
              {check.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EditorPreview({ record }: { record: ScholarshipView }) {
  const [profile, setProfile] = useState<PreviewProfile>("fits");
  const failing = factsThatFail(record.eligibility);
  const facts =
    profile === "fits" ? factsThatFit(record.eligibility) : profile === "fails" ? failing.facts : EMPTY_FACTS;

  return (
    <section aria-label="Student preview" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Student preview</h2>
        <SegmentedControl label="Preview as" onValueChange={setProfile} options={PROFILE_OPTIONS} value={profile} />
      </div>
      {profile === "fails" && !failing.failed ? (
        <p className="text-xs text-[var(--ink-muted)]">No rule here can rule a student out, so every student sees this.</p>
      ) : null}
      <ScholarshipDetail
        criteria={evaluateCriteria(record, facts)}
        fit={summarizeFit(record, facts)}
        linkProfile={false}
        scholarship={record}
      />
    </section>
  );
}
