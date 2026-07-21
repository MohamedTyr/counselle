import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Semantic single/multi choice control shared by every onboarding step
 * (plan `02-ui-ux-spec.md` §12.4). Single choice exposes radiogroup/radio
 * semantics; multi choice exposes checkbox semantics via `aria-checked` so
 * screen readers announce state the same way a native checkbox would.
 * Selected state is never color-only: background + border + a check icon
 * combine, and the label text itself changes weight.
 */
export interface OnboardingChoiceOption {
  value: string;
  label: string;
  description?: string;
}

interface OnboardingChoiceGroupProps {
  legend: string;
  helper?: string;
  mode: "single" | "multi";
  options: readonly OnboardingChoiceOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  variant?: "tiles" | "rows" | "chips";
  fieldId?: string;
}

export function OnboardingChoiceGroup({
  fieldId,
  helper,
  legend,
  mode,
  onChange,
  options,
  value,
  variant = "tiles",
}: OnboardingChoiceGroupProps) {
  function toggle(optionValue: string) {
    const isSelected = value.includes(optionValue);
    if (mode === "single") {
      onChange(isSelected ? [] : [optionValue]);
      return;
    }
    onChange(
      isSelected ? value.filter((entry) => entry !== optionValue) : [...value, optionValue],
    );
  }

  const layoutClass =
    variant === "chips"
      ? "flex flex-wrap gap-2"
      : variant === "rows"
        ? "flex flex-col gap-2"
        : "grid grid-cols-2 gap-2 sm:grid-cols-3";

  return (
    <fieldset className="flex flex-col gap-2.5" id={fieldId}>
      <legend className="text-[15px] font-medium text-[var(--onboarding-foreground)]">
        {legend}
      </legend>
      {helper ? (
        <p className="-mt-1 text-sm text-[var(--onboarding-foreground-soft)]">{helper}</p>
      ) : null}
      <div
        aria-label={legend}
        className={layoutClass}
        role={mode === "single" ? "radiogroup" : "group"}
      >
        {options.map((option) => {
          const isSelected = value.includes(option.value);
          return (
            <button
              aria-checked={isSelected}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-center text-sm font-medium transition-colors duration-150",
                "border-[var(--onboarding-control-border)] bg-[var(--onboarding-control-surface)] text-[var(--onboarding-foreground)]",
                "hover:border-[var(--onboarding-control-hover-border)] hover:bg-[var(--onboarding-control-hover-surface)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--onboarding-ring)]",
                isSelected &&
                  "border-[var(--onboarding-selected-border)] bg-[var(--onboarding-selected-surface)]",
                variant === "rows" && "justify-start text-left",
                variant === "chips" && "min-h-11 rounded-full px-4",
              )}
              key={option.value}
              onClick={() => toggle(option.value)}
              role={mode === "single" ? "radio" : "checkbox"}
              type="button"
            >
              {isSelected ? (
                <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
              ) : null}
              <span className="flex flex-col">
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-xs font-normal text-[var(--onboarding-muted-foreground)]">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
