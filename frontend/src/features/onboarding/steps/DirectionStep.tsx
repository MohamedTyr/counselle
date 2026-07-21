import { OnboardingChoiceGroup } from "@/features/onboarding/OnboardingChoiceGroup";
import { OnboardingTagInput } from "@/features/onboarding/OnboardingTagInput";
import type { DirectionDraft, MajorCertainty } from "@/features/onboarding/onboarding-profile-patch";

const CERTAINTY_OPTIONS = [
  { value: "locked", label: "I’m set", description: "I’m unlikely to change it." },
  { value: "leaning", label: "I have a direction", description: "I have a leading idea." },
  { value: "exploring", label: "I’m exploring", description: "I want room to explore." },
] as const;

const PREPROFESSIONAL_OPTIONS = [
  { value: "pre_med", label: "Pre-med" },
  { value: "pre_law", label: "Pre-law" },
  { value: "bs_md", label: "BS/MD" },
  { value: "nursing", label: "Nursing" },
  { value: "engineering_accreditation", label: "ABET-accredited engineering" },
  { value: "other", label: "Other" },
];

export function DirectionStep({
  onChange,
  value,
}: {
  onChange: (next: DirectionDraft) => void;
  value: DirectionDraft;
}) {
  return (
    <div className="flex flex-col gap-6">
      <OnboardingTagInput
        helper="Add up to 3. Broad interests are fine."
        label="What might you want to study?"
        max={3}
        onChange={(next) => onChange({ ...value, majors: next })}
        placeholder="Type a major and press Enter"
        value={value.majors}
      />

      <OnboardingChoiceGroup
        legend="How certain do you feel about that direction?"
        mode="single"
        onChange={(next) =>
          onChange({ ...value, certainty: (next[0] as MajorCertainty) ?? "" })
        }
        options={CERTAINTY_OPTIONS}
        value={value.certainty ? [value.certainty] : []}
        variant="rows"
      />

      <OnboardingChoiceGroup
        legend="Does any specialized path matter to you?"
        mode="multi"
        onChange={(next) => onChange({ ...value, preprofessional: next })}
        options={PREPROFESSIONAL_OPTIONS}
        value={value.preprofessional}
        variant="chips"
      />
    </div>
  );
}
