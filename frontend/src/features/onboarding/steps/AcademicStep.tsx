import type { Profile } from "@/api/workspace/types";
import { Input } from "@/components/ui/input";
import { OnboardingChoiceGroup } from "@/features/onboarding/OnboardingChoiceGroup";
import type { AcademicDraft, GpaType } from "@/features/onboarding/onboarding-profile-patch";

interface FieldError {
  fieldId: string;
  message: string;
}

function errorFor(error: FieldError | undefined, fieldId: string): string | undefined {
  return error?.fieldId === fieldId ? error.message : undefined;
}

export function AcademicStep({
  error,
  onChange,
  profile,
  value,
}: {
  error?: FieldError;
  onChange: (next: AcademicDraft) => void;
  profile: Profile | undefined;
  value: AcademicDraft;
}) {
  const scoresAlreadyExist = Boolean(
    profile?.testing?.sat?.total != null || profile?.testing?.act?.composite != null,
  );
  const testChoices: string[] = [
    ...(value.satEnabled ? ["SAT"] : []),
    ...(value.actEnabled ? ["ACT"] : []),
    ...(value.noneYet ? ["none"] : []),
  ];
  const plannedChoices: string[] = [
    ...(value.plannedSat ? ["SAT"] : []),
    ...(value.plannedAct ? ["ACT"] : []),
  ];

  function setTestChoices(next: string[]) {
    onChange({
      ...value,
      satEnabled: next.includes("SAT"),
      actEnabled: next.includes("ACT"),
      noneYet: next.includes("none"),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <OnboardingChoiceGroup
          legend="Which GPA would you like Counselle to use as a quick snapshot?"
          mode="single"
          onChange={(next) =>
            onChange({ ...value, gpaType: (next[0] as GpaType) ?? "" })
          }
          options={[
            { value: "unweighted", label: "Unweighted" },
            { value: "weighted", label: "Weighted" },
            { value: "unsure", label: "I’m not sure yet" },
          ]}
          value={value.gpaType ? [value.gpaType] : []}
          variant="rows"
        />
        {value.gpaType === "unweighted" || value.gpaType === "weighted" ? (
          <div className="grid grid-cols-2 gap-3 pl-1">
            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium text-[var(--onboarding-foreground)]"
                htmlFor="onboarding-academic-gpa-value"
              >
                GPA
              </label>
              <Input
                aria-describedby={
                  errorFor(error, "onboarding-academic-gpa-value") ? "onboarding-academic-gpa-value-error" : undefined
                }
                aria-invalid={Boolean(errorFor(error, "onboarding-academic-gpa-value"))}
                id="onboarding-academic-gpa-value"
                inputMode="decimal"
                onChange={(event) => onChange({ ...value, gpaValue: event.target.value })}
                placeholder="3.8"
                value={value.gpaValue}
              />
              <FieldError id="onboarding-academic-gpa-value-error" text={errorFor(error, "onboarding-academic-gpa-value")} />
            </div>
            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium text-[var(--onboarding-foreground)]"
                htmlFor="onboarding-academic-gpa-scale"
              >
                Out of
              </label>
              <Input
                aria-describedby={
                  errorFor(error, "onboarding-academic-gpa-scale") ? "onboarding-academic-gpa-scale-error" : undefined
                }
                aria-invalid={Boolean(errorFor(error, "onboarding-academic-gpa-scale"))}
                id="onboarding-academic-gpa-scale"
                inputMode="decimal"
                onChange={(event) => onChange({ ...value, gpaScale: event.target.value })}
                placeholder="4.0"
                value={value.gpaScale}
              />
              <FieldError id="onboarding-academic-gpa-scale-error" text={errorFor(error, "onboarding-academic-gpa-scale")} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <OnboardingChoiceGroup
          legend="Do you have a test score you want Counselle to use?"
          mode="multi"
          onChange={setTestChoices}
          options={[
            { value: "SAT", label: "SAT" },
            { value: "ACT", label: "ACT" },
            ...(scoresAlreadyExist ? [] : [{ value: "none", label: "None yet" }]),
          ]}
          value={testChoices}
          variant="chips"
        />
        {value.satEnabled || value.actEnabled ? (
          <div className="grid grid-cols-2 gap-3 pl-1">
            {value.satEnabled ? (
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium text-[var(--onboarding-foreground)]"
                  htmlFor="onboarding-academic-sat-total"
                >
                  SAT total
                </label>
                <Input
                  aria-describedby={
                    errorFor(error, "onboarding-academic-sat-total") ? "onboarding-academic-sat-total-error" : undefined
                  }
                  aria-invalid={Boolean(errorFor(error, "onboarding-academic-sat-total"))}
                  id="onboarding-academic-sat-total"
                  inputMode="numeric"
                  onChange={(event) => onChange({ ...value, satTotal: event.target.value })}
                  value={value.satTotal}
                />
                <FieldError id="onboarding-academic-sat-total-error" text={errorFor(error, "onboarding-academic-sat-total")} />
              </div>
            ) : null}
            {value.actEnabled ? (
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium text-[var(--onboarding-foreground)]"
                  htmlFor="onboarding-academic-act-composite"
                >
                  ACT composite
                </label>
                <Input
                  aria-describedby={
                    errorFor(error, "onboarding-academic-act-composite") ? "onboarding-academic-act-composite-error" : undefined
                  }
                  aria-invalid={Boolean(errorFor(error, "onboarding-academic-act-composite"))}
                  id="onboarding-academic-act-composite"
                  inputMode="numeric"
                  onChange={(event) => onChange({ ...value, actComposite: event.target.value })}
                  value={value.actComposite}
                />
                <FieldError id="onboarding-academic-act-composite-error" text={errorFor(error, "onboarding-academic-act-composite")} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <OnboardingChoiceGroup
          helper="Choose only what you currently expect. Dates are optional."
          legend="Are you planning to take or retake either test?"
          mode="multi"
          onChange={(next) =>
            onChange({ ...value, plannedSat: next.includes("SAT"), plannedAct: next.includes("ACT") })
          }
          options={[
            { value: "SAT", label: "SAT" },
            { value: "ACT", label: "ACT" },
          ]}
          value={plannedChoices}
          variant="chips"
        />
        {value.plannedSat || value.plannedAct ? (
          <div className="grid grid-cols-2 gap-3 pl-1">
            {value.plannedSat ? (
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium text-[var(--onboarding-foreground)]"
                  htmlFor="onboarding-academic-planned-sat-date"
                >
                  SAT date
                </label>
                <Input
                  id="onboarding-academic-planned-sat-date"
                  onChange={(event) => onChange({ ...value, plannedSatDate: event.target.value })}
                  type="date"
                  value={value.plannedSatDate}
                />
              </div>
            ) : null}
            {value.plannedAct ? (
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium text-[var(--onboarding-foreground)]"
                  htmlFor="onboarding-academic-planned-act-date"
                >
                  ACT date
                </label>
                <Input
                  id="onboarding-academic-planned-act-date"
                  onChange={(event) => onChange({ ...value, plannedActDate: event.target.value })}
                  type="date"
                  value={value.plannedActDate}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text ? (
    <p className="text-xs text-[var(--onboarding-error-foreground)]" id={id} role="alert">
      {text}
    </p>
  ) : null;
}
