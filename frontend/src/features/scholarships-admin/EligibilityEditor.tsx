import { Plus, Search, X } from "lucide-react";
import { useState } from "react";

import type {
  CitizenshipOption,
  EligibilityKind,
  EligibilityRule,
  GradeOption,
} from "@/api/scholarships/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { CITIZENSHIP_LABELS, GRADE_LABELS, joinOr } from "@/features/scholarships/eligibility";
import { US_STATE_CODES, US_STATE_NAMES } from "@/features/scholarships/us-states";
import { toggleIn } from "@/features/scholarships-admin/editor-draft";
import { ChoiceChips, NumberInput, TagInput } from "@/features/scholarships-admin/editor-ui";

/*
 * Each rule is a sentence: "Citizenship is one of [chips]". Only facts the
 * student profile can answer are rules; everything else is a line under
 * "Anything else", which students always see as "Check this yourself".
 */

const KIND_LABELS: Record<EligibilityKind, string> = {
  citizenship: "Citizenship",
  state: "State of residence",
  grade: "Grade",
  gpa_min: "Minimum GPA",
  first_gen: "First-generation student",
  financial_need: "Financial need",
  major: "Intended major",
};

const KIND_ORDER: EligibilityKind[] = ["citizenship", "state", "grade", "gpa_min", "major", "first_gen", "financial_need"];

function newRule(kind: EligibilityKind): EligibilityRule {
  switch (kind) {
    case "citizenship":
      return { kind, any_of: ["us_citizen", "permanent_resident"] };
    case "state":
      return { kind, any_of: [] };
    case "grade":
      return { kind, any_of: ["12"] };
    case "gpa_min":
      return { kind, value: 3.0 };
    case "major":
      return { kind, any_of: [] };
    case "first_gen":
    case "financial_need":
      return { kind };
  }
}

function StatePicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState("");
  const shown = US_STATE_CODES.filter((code) =>
    US_STATE_NAMES[code].toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button className="max-w-full justify-start" size="sm" variant="outline">
            <span className="truncate">
              {value.length === 0 ? "Choose states" : joinOr(value.map((code) => US_STATE_NAMES[code]))}
            </span>
          </Button>
        }
      />
      <PopoverPopup align="start" className="w-64 p-1.5">
        <div className="relative mb-1">
          <Search aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
          <Input
            aria-label="Search states"
            className="[&_input]:ps-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search states"
            size="sm"
            value={query}
          />
        </div>
        <div className="flex max-h-64 flex-col gap-px overflow-y-auto">
          {shown.map((code) => (
            <label
              className="flex h-8 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]"
              key={code}
            >
              <Checkbox checked={value.includes(code)} onCheckedChange={() => onChange(toggleIn(value, code))} />
              {US_STATE_NAMES[code]}
            </label>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

const CITIZENSHIP_OPTIONS = (Object.keys(CITIZENSHIP_LABELS) as CitizenshipOption[]).map((value) => ({
  value,
  label: CITIZENSHIP_LABELS[value].charAt(0).toUpperCase() + CITIZENSHIP_LABELS[value].slice(1),
}));
const GRADE_OPTIONS = (Object.keys(GRADE_LABELS) as GradeOption[]).map((value) => ({ value, label: GRADE_LABELS[value] }));

function RuleControl({ rule, onChange }: { rule: EligibilityRule; onChange: (rule: EligibilityRule) => void }) {
  switch (rule.kind) {
    case "citizenship":
      return (
        <ChoiceChips
          label="Citizenship"
          onToggle={(value) => onChange({ ...rule, any_of: toggleIn(rule.any_of, value) })}
          options={CITIZENSHIP_OPTIONS}
          selected={rule.any_of}
        />
      );
    case "state":
      return <StatePicker onChange={(any_of) => onChange({ ...rule, any_of })} value={rule.any_of} />;
    case "grade":
      return (
        <ChoiceChips
          label="Grade"
          onToggle={(value) => onChange({ ...rule, any_of: toggleIn(rule.any_of, value) })}
          options={GRADE_OPTIONS}
          selected={rule.any_of}
        />
      );
    case "gpa_min":
      return (
        <div className="flex items-center gap-2 text-sm text-[var(--ink-secondary)]">
          <NumberInput
            className="w-20"
            onChange={(value) => onChange({ ...rule, value: value ?? 0 })}
            step={0.1}
            value={rule.value}
          />
          <span>unweighted, on a 4.0 scale</span>
        </div>
      );
    case "major":
      return (
        <TagInput
          onChange={(any_of) => onChange({ ...rule, any_of })}
          placeholder="Type a field and press Enter"
          values={rule.any_of}
        />
      );
    case "first_gen":
    case "financial_need":
      return <span className="text-sm text-[var(--ink-secondary)]">Required</span>;
  }
}

function ruleIsEmpty(rule: EligibilityRule): boolean {
  return "any_of" in rule && rule.any_of.length === 0;
}

export function EligibilityEditor({
  rules,
  other,
  onRulesChange,
  onOtherChange,
}: {
  rules: EligibilityRule[];
  other: string[];
  onRulesChange: (rules: EligibilityRule[]) => void;
  onOtherChange: (other: string[]) => void;
}) {
  const available = KIND_ORDER.filter((kind) => !rules.some((rule) => rule.kind === kind));

  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">No rules. Every student will see this as open to them.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--hairline)] rounded-lg border border-[var(--edge)]">
          {rules.map((rule, index) => (
            <li className="grid grid-cols-[9.5rem_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5" key={rule.kind}>
              <span className="pt-1 text-sm font-medium text-[var(--ink)]">{KIND_LABELS[rule.kind]}</span>
              <div className="flex min-w-0 flex-col gap-1 pt-0.5">
                <RuleControl
                  onChange={(next) => onRulesChange(rules.map((r, i) => (i === index ? next : r)))}
                  rule={rule}
                />
                {ruleIsEmpty(rule) ? (
                  <span className="text-xs text-[var(--warning-fg)]">Choose at least one, or remove this rule.</span>
                ) : null}
              </div>
              <Button
                aria-label={`Remove ${KIND_LABELS[rule.kind]} rule`}
                onClick={() => onRulesChange(rules.filter((_, i) => i !== index))}
                size="icon-xs"
                variant="ghost"
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="self-start" size="sm" variant="outline">
              <Plus aria-hidden="true" />
              Add rule
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {available.map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => onRulesChange([...rules, newRule(kind)])}>
                {KIND_LABELS[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-[var(--hairline)] pt-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-[var(--ink-secondary)]">Anything else</span>
          <span className="text-xs text-[var(--ink-muted)]">
            Rules the profile can't check, including restrictions by ethnicity, gender or religion. Students see each as
            "Check this yourself".
          </span>
        </div>
        {other.map((line, index) => (
          <div className="flex items-center gap-2" key={index}>
            <Input
              aria-label={`Other requirement ${index + 1}`}
              onChange={(event) => onOtherChange(other.map((l, i) => (i === index ? event.target.value : l)))}
              placeholder="e.g. Family income under $65,000"
              value={line}
            />
            <Button
              aria-label={`Remove other requirement ${index + 1}`}
              onClick={() => onOtherChange(other.filter((_, i) => i !== index))}
              size="icon-xs"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ))}
        <Button className="self-start" onClick={() => onOtherChange([...other, ""])} size="sm" variant="ghost">
          <Plus aria-hidden="true" />
          Add a line
        </Button>
      </div>
    </div>
  );
}
