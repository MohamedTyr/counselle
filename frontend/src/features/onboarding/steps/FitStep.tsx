import { OnboardingChoiceGroup } from "@/features/onboarding/OnboardingChoiceGroup";
import { OnboardingTagInput } from "@/features/onboarding/OnboardingTagInput";
import type { FitDraft } from "@/features/onboarding/onboarding-profile-patch";
import { ONBOARDING_LIST_CAP } from "@/features/onboarding/onboarding-steps";

const SUGGESTED_REGIONS = [
  "Northeast",
  "Mid-Atlantic",
  "South",
  "Midwest",
  "Southwest",
  "Mountain West",
  "West Coast",
  "Outside the U.S.",
];

const SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const SETTING_OPTIONS = [
  { value: "urban", label: "Urban" },
  { value: "suburban", label: "Suburban" },
  { value: "college_town", label: "College town" },
  { value: "rural", label: "Rural" },
];

export function FitStep({
  onChange,
  value,
}: {
  onChange: (next: FitDraft) => void;
  value: FitDraft;
}) {
  const regionChoices = value.openAnywhere ? ["__open__"] : value.regions;

  function toggleSuggestedRegion(next: string[]) {
    if (next.includes("__open__")) {
      onChange({ ...value, openAnywhere: true, regions: [] });
      return;
    }
    onChange({ ...value, openAnywhere: false, regions: next });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <OnboardingChoiceGroup
          legend="Where are you open to studying?"
          mode="multi"
          onChange={toggleSuggestedRegion}
          options={[
            ...SUGGESTED_REGIONS.map((region) => ({ value: region, label: region })),
            { value: "__open__", label: "Open anywhere" },
          ]}
          value={regionChoices}
          variant="chips"
        />
        {!value.openAnywhere ? (
          <OnboardingTagInput
            label="Add another region"
            max={20}
            onChange={(nextCustom) =>
              onChange({
                ...value,
                regions: [
                  ...value.regions.filter((region) => SUGGESTED_REGIONS.includes(region)),
                  ...nextCustom,
                ],
              })
            }
            placeholder="Type a region and press Enter"
            value={value.regions.filter((region) => !SUGGESTED_REGIONS.includes(region))}
          />
        ) : null}
      </div>

      <OnboardingChoiceGroup
        legend="What school sizes appeal to you?"
        mode="multi"
        onChange={(next) => onChange({ ...value, sizes: next })}
        options={SIZE_OPTIONS}
        value={value.sizes}
        variant="chips"
      />

      <OnboardingChoiceGroup
        legend="What settings appeal to you?"
        mode="multi"
        onChange={(next) => onChange({ ...value, settings: next })}
        options={SETTING_OPTIONS}
        value={value.settings}
        variant="chips"
      />

      <OnboardingTagInput
        helper={`Add up to ${ONBOARDING_LIST_CAP}. Examples: strong co-op program, easy access to research, active campus life.`}
        label="What are your must-haves?"
        max={ONBOARDING_LIST_CAP}
        onChange={(next) => onChange({ ...value, mustHaves: next })}
        value={value.mustHaves}
      />

      <OnboardingTagInput
        helper={`Add up to ${ONBOARDING_LIST_CAP}. Examples: too far from home, required religious services, very large classes.`}
        label="Any dealbreakers?"
        max={ONBOARDING_LIST_CAP}
        onChange={(next) => onChange({ ...value, dealbreakers: next })}
        value={value.dealbreakers}
      />
    </div>
  );
}
