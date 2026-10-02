import { Plus, UserRound, X } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { CitizenshipOption, EligibilityKind, GradeOption } from "@/api/scholarships/types";
import { useUpdateProfile } from "@/api/workspace/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { ChoiceSelect } from "@/features/scholarships/ChoiceSelect";
import {
  CITIZENSHIP_LABELS,
  GRADE_LABELS,
  PROFILE_FACT_RULE,
  type ProfileFactKey,
  type ProfileFacts,
} from "@/features/scholarships/eligibility";
import { US_STATE_CODES, US_STATE_NAMES } from "@/features/scholarships/us-states";
import { cn } from "@/lib/utils";

/*
 * Matching is visible and editable, never hidden: every profile fact the
 * "For you" view uses is a chip the student can drop from matching, and the
 * facts it lacks can be added right here.
 */

function factChips(facts: ProfileFacts): { key: ProfileFactKey; label: string }[] {
  const chips: { key: ProfileFactKey; label: string }[] = [];
  if (facts.citizenship) chips.push({ key: "citizenship", label: CITIZENSHIP_LABELS[facts.citizenship] });
  if (facts.state) chips.push({ key: "state", label: US_STATE_NAMES[facts.state] });
  if (facts.grade) chips.push({ key: "grade", label: GRADE_LABELS[facts.grade] });
  if (facts.gpa !== null) chips.push({ key: "gpa", label: `GPA ${facts.gpa}` });
  if (facts.firstGen) chips.push({ key: "firstGen", label: "First-gen" });
  if (facts.majors.length) chips.push({ key: "majors", label: facts.majors.slice(0, 2).join(", ") });
  return chips;
}

const MISSING_LABEL: Partial<Record<ProfileFactKey, string>> = {
  citizenship: "citizenship",
  state: "state",
  grade: "grade",
  gpa: "GPA",
};

function missingFacts(facts: ProfileFacts): string[] {
  const missing: string[] = [];
  if (!facts.citizenship) missing.push(MISSING_LABEL.citizenship as string);
  if (!facts.state) missing.push(MISSING_LABEL.state as string);
  if (!facts.grade) missing.push(MISSING_LABEL.grade as string);
  if (facts.gpa === null) missing.push(MISSING_LABEL.gpa as string);
  return missing;
}

const CITIZENSHIP_TEXT: Record<CitizenshipOption, string> = {
  us_citizen: "US citizen",
  permanent_resident: "US permanent resident",
  daca: "DACA",
  international: "International",
};

function QuickProfileForm({ facts, onDone }: { facts: ProfileFacts; onDone: () => void }) {
  const id = useId();
  const update = useUpdateProfile();
  const [citizenship, setCitizenship] = useState<CitizenshipOption | null>(facts.citizenship);
  const [state, setState] = useState<string | null>(facts.state);
  const [grade, setGrade] = useState<GradeOption | null>(facts.grade);
  const [gpa, setGpa] = useState(facts.gpa === null ? "" : String(facts.gpa));
  const gpaValue = gpa.trim() === "" ? null : Number(gpa);
  const gpaInvalid = gpaValue !== null && (!Number.isFinite(gpaValue) || gpaValue < 0 || gpaValue > 4);

  function save() {
    update.mutate(
      {
        background: {
          ...(citizenship ? { citizenship: CITIZENSHIP_TEXT[citizenship] } : {}),
          ...(state ? { residence: { state } } : {}),
        },
        basics: grade ? { grade_level: grade } : {},
        academics: gpaValue !== null && !gpaInvalid ? { gpa_unweighted: String(gpaValue), gpa_scale: "4.0" } : {},
      },
      {
        onSuccess: () => {
          toast.success("Saved to your profile");
          onDone();
        },
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <p className="text-sm font-medium text-[var(--ink)]">Match on more of your profile</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label htmlFor={`${id}-cit`}>Citizenship</Label>
          <ChoiceSelect
            id={`${id}-cit`}
            onChange={setCitizenship}
            options={(Object.keys(CITIZENSHIP_TEXT) as CitizenshipOption[]).map((value) => ({ value, label: CITIZENSHIP_TEXT[value] }))}
            placeholder="Not set"
            value={citizenship}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label htmlFor={`${id}-state`}>State you live in</Label>
          <ChoiceSelect
            id={`${id}-state`}
            onChange={setState}
            options={US_STATE_CODES.map((code) => ({ value: code, label: US_STATE_NAMES[code] }))}
            placeholder="Not set"
            value={state}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-grade`}>Grade</Label>
          <ChoiceSelect
            className="w-full min-w-0"
            id={`${id}-grade`}
            onChange={setGrade}
            options={(Object.keys(GRADE_LABELS) as GradeOption[]).map((value) => ({ value, label: GRADE_LABELS[value] }))}
            placeholder="Not set"
            value={grade}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-gpa`}>Unweighted GPA</Label>
          <Input
            aria-invalid={gpaInvalid || undefined}
            id={`${id}-gpa`}
            inputMode="decimal"
            onChange={(event) => setGpa(event.target.value)}
            placeholder="e.g. 3.7"
            value={gpa}
          />
        </div>
      </div>
      {gpaInvalid ? <p className="text-xs text-[var(--danger-fg)]">Enter a GPA between 0 and 4.0.</p> : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={gpaInvalid} loading={update.isPending} size="sm" type="submit">
          Save to profile
        </Button>
      </div>
    </form>
  );
}

export function ProfileMatchBar({
  facts,
  ignored,
  onToggleIgnored,
}: {
  facts: ProfileFacts;
  ignored: EligibilityKind[];
  onToggleIgnored: (kind: EligibilityKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const chips = factChips(facts);
  const missing = missingFacts(facts);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      <span className="flex items-center gap-1.5 text-[var(--ink-muted)]">
        <UserRound aria-hidden="true" className="size-3.5" />
        {chips.length ? "Matched on" : "Not matched to your profile yet."}
      </span>
      {chips.map((chip) => {
        const kind = PROFILE_FACT_RULE[chip.key];
        const off = ignored.includes(kind);
        return (
          <button
            aria-label={off ? `Match on ${chip.label} again` : `Stop matching on ${chip.label}`}
            aria-pressed={!off}
            className={cn(
              "group inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border pr-1.5 pl-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              off
                ? "border-dashed border-[var(--edge-strong)] text-[var(--ink-muted)] line-through decoration-[var(--ink-faint)] hover:text-[var(--ink-secondary)]"
                : "border-[var(--brand-subtle-border)] bg-[var(--brand-subtle)] text-[var(--brand-subtle-ink)] hover:border-[var(--accent-solid)]",
            )}
            key={chip.key}
            onClick={() => onToggleIgnored(kind)}
            type="button"
          >
            {chip.label}
            {off ? (
              <Plus aria-hidden="true" className="size-3 opacity-70" />
            ) : (
              <X aria-hidden="true" className="size-3 opacity-50 group-hover:opacity-100" />
            )}
          </button>
        );
      })}
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2 text-xs font-medium text-[var(--ink-secondary)] underline decoration-[var(--edge-strong)] underline-offset-2 outline-none hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {missing.length ? `Add your ${missing.slice(0, 2).join(" and ")}${missing.length > 2 ? "…" : ""}` : "Edit"}
        </PopoverTrigger>
        <PopoverPopup align="start" className="w-80 p-4">
          <QuickProfileForm facts={facts} onDone={() => setOpen(false)} />
        </PopoverPopup>
      </Popover>
    </div>
  );
}
