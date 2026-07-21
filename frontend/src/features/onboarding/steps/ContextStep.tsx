import { Input } from "@/components/ui/input";
import { OnboardingChoiceGroup } from "@/features/onboarding/OnboardingChoiceGroup";
import type {
  ContextDraft,
  TriState,
} from "@/features/onboarding/onboarding-profile-patch";

interface FieldError {
  fieldId: string;
  message: string;
}

const TRI_STATE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
] as const;

function triStateValue(state: TriState): string[] {
  return state === "unanswered" ? [] : [state];
}

function triStateFromSelection(next: string[]): TriState {
  return (next[0] as TriState) ?? "unanswered";
}

export function ContextStep({
  error,
  onChange,
  value,
}: {
  error?: FieldError;
  onChange: (next: ContextDraft) => void;
  value: ContextDraft;
}) {
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-[15px] font-medium text-[var(--onboarding-foreground)]">
          Where do you live now?
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-[var(--onboarding-foreground-soft)]" htmlFor="onboarding-context-country">
              Country
            </label>
            <Input
              autoComplete="country-name"
              id="onboarding-context-country"
              onChange={(event) => onChange({ ...value, country: event.target.value })}
              value={value.country}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-[var(--onboarding-foreground-soft)]" htmlFor="onboarding-context-state">
              State or region
            </label>
            <Input
              autoComplete="address-level1"
              id="onboarding-context-state"
              onChange={(event) => onChange({ ...value, state: event.target.value })}
              value={value.state}
            />
            <p className="text-xs text-[var(--onboarding-muted-foreground)]">
              Use a state, province, or region.
            </p>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label
          className="text-[15px] font-medium text-[var(--onboarding-foreground)]"
          htmlFor="onboarding-context-citizenship"
        >
          What is your citizenship status?
        </label>
        <Input
          id="onboarding-context-citizenship"
          onChange={(event) => onChange({ ...value, citizenship: event.target.value })}
          placeholder="U.S. citizen, dual citizen, permanent resident…"
          value={value.citizenship}
        />
        {value.visaOpen ? (
          <div className="mt-1 flex flex-col gap-2">
            <label
              className="text-sm text-[var(--onboarding-foreground-soft)]"
              htmlFor="onboarding-context-visa"
            >
              Current or expected visa status
            </label>
            <Input
              id="onboarding-context-visa"
              onChange={(event) => onChange({ ...value, visaStatus: event.target.value })}
              value={value.visaStatus}
            />
            <p className="text-xs text-[var(--onboarding-muted-foreground)]">
              Only if this affects how you’ll apply.
            </p>
          </div>
        ) : (
          <button
            className="mt-1 self-start text-sm text-[var(--onboarding-muted-foreground)] underline-offset-4 hover:text-[var(--onboarding-foreground-soft)] hover:underline"
            onClick={() => onChange({ ...value, visaOpen: true })}
            type="button"
          >
            Add visa status
          </button>
        )}
      </div>

      <OnboardingChoiceGroup
        helper="Colleges define this differently. Choose the answer that best matches how you understand your situation."
        legend="Are you a first-generation college student?"
        mode="single"
        onChange={(next) => onChange({ ...value, firstGen: triStateFromSelection(next) })}
        options={TRI_STATE_OPTIONS}
        value={triStateValue(value.firstGen)}
        variant="rows"
      />

      <div className="flex flex-col gap-3">
        <OnboardingChoiceGroup
          legend="Will you need financial aid to attend?"
          mode="single"
          onChange={(next) => onChange({ ...value, needAid: triStateFromSelection(next) })}
          options={TRI_STATE_OPTIONS}
          value={triStateValue(value.needAid)}
          variant="rows"
        />
        {value.needAid === "yes" ? (
          <div className="flex flex-col gap-2 pl-1">
            <label
              className="text-sm font-medium text-[var(--onboarding-foreground)]"
              htmlFor="onboarding-context-budget"
            >
              About how much can your family pay each year?
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--onboarding-muted-foreground)]">$</span>
              <Input
                aria-describedby={
                  error?.fieldId === "onboarding-context-budget" ? "onboarding-context-budget-error" : undefined
                }
                aria-invalid={error?.fieldId === "onboarding-context-budget"}
                id="onboarding-context-budget"
                inputMode="decimal"
                onChange={(event) => onChange({ ...value, budgetPerYear: event.target.value })}
                value={value.budgetPerYear}
              />
              <span className="text-sm text-[var(--onboarding-muted-foreground)]">USD per year</span>
            </div>
            <p className="text-xs text-[var(--onboarding-muted-foreground)]">
              An estimate is fine. Leave blank if you don’t know yet.
            </p>
            {error?.fieldId === "onboarding-context-budget" ? (
              <p
                className="text-xs text-[var(--onboarding-error-foreground)]"
                id="onboarding-context-budget-error"
                role="alert"
              >
                {error.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <OnboardingChoiceGroup
        legend="Should Counselle prioritize schools that offer merit scholarships?"
        mode="single"
        onChange={(next) => onChange({ ...value, meritPriority: triStateFromSelection(next) })}
        options={TRI_STATE_OPTIONS}
        value={triStateValue(value.meritPriority)}
        variant="rows"
      />
    </div>
  );
}
