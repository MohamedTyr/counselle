import { Input } from "@/components/ui/input";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OnboardingChoiceGroup } from "@/features/onboarding/OnboardingChoiceGroup";
import type { BasicsDraft, GradeLevel } from "@/features/onboarding/onboarding-profile-patch";

const GRADE_OPTIONS: readonly { value: GradeLevel; label: string }[] = [
  { value: "9", label: "9th grade" },
  { value: "10", label: "10th grade" },
  { value: "11", label: "11th grade" },
  { value: "12", label: "12th grade" },
  { value: "gap", label: "Gap year" },
  { value: "other", label: "Other" },
];

function graduationYearOptions(existing: number | null): number[] {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 9 }, (_, index) => currentYear + index);
  if (existing !== null && !years.includes(existing)) {
    return [...years, existing].sort((a, b) => a - b);
  }
  return years;
}

export function BasicsStep({
  onChange,
  value,
}: {
  onChange: (next: BasicsDraft) => void;
  value: BasicsDraft;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label
          className="text-[15px] font-medium text-[var(--onboarding-foreground)]"
          htmlFor="onboarding-basics-name"
        >
          What should Counselle call you?
        </label>
        <p className="-mt-1 text-sm text-[var(--onboarding-foreground-soft)]">
          This can be different from the name on your account.
        </p>
        <Input
          id="onboarding-basics-name"
          onChange={(event) => onChange({ ...value, preferredName: event.target.value })}
          value={value.preferredName}
        />
      </div>

      <OnboardingChoiceGroup
        legend="Where are you in school?"
        mode="single"
        onChange={(next) => onChange({ ...value, gradeLevel: (next[0] as GradeLevel) ?? "" })}
        options={GRADE_OPTIONS}
        value={value.gradeLevel ? [value.gradeLevel] : []}
        variant="tiles"
      />

      <div className="flex flex-col gap-2">
        <label
          className="text-[15px] font-medium text-[var(--onboarding-foreground)]"
          htmlFor="onboarding-basics-grad-year"
        >
          When do you expect to graduate?
        </label>
        <p className="-mt-1 text-sm text-[var(--onboarding-foreground-soft)]">
          An estimate is fine.
        </p>
        <Select
          items={graduationYearOptions(value.graduationYear).map((year) => ({
            label: String(year),
            value: String(year),
          }))}
          onValueChange={(next) => onChange({ ...value, graduationYear: Number(next) })}
          value={value.graduationYear !== null ? String(value.graduationYear) : "__unset__"}
        >
          <SelectTrigger id="onboarding-basics-grad-year">
            <SelectValue placeholder="Choose a year" />
          </SelectTrigger>
          <SelectPopup align="start">
            <SelectGroup>
              {graduationYearOptions(value.graduationYear).map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
      </div>
    </div>
  );
}
