import { CheckIcon } from "lucide-react";
import type React from "react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type FieldLayout,
  ProfileFieldError,
  ProfileFieldLabel,
  ProfileFieldRow,
} from "@/features/profile/ProfileFieldLabel";
import { ProfileTagInput } from "@/features/profile/ProfileTagInput";
import {
  type FieldPlacement,
  fieldWidth,
} from "@/features/profile/profile-field-layout";
import {
  profileChipClass,
  profileTextareaControlClass,
} from "@/features/profile/profile-control-styles";
import type {
  MultiSelectFieldConfig,
  ScalarFieldConfig,
  SelectFieldConfig,
  SelectOption,
  StringListFieldConfig,
} from "@/features/profile/profile-field-types";
import { useFieldDraft } from "@/features/profile/use-field-draft";
import { cn } from "@/lib/utils";

export type LeafConfig =
  | ScalarFieldConfig
  | SelectFieldConfig
  | StringListFieldConfig
  | MultiSelectFieldConfig;

const YES_NO: readonly SelectOption[] = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
];

function textFromValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function helperText(config: LeafConfig): string | undefined {
  if (config.kind === "string-list") {
    return "Press Enter after each one.";
  }
  return "help" in config ? config.help : undefined;
}

function joinIds(...ids: (string | false | undefined)[]): string | undefined {
  const present = ids.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
}

/** One profile leaf under its question, preserving the minimal merge-patch
 * contract: every control commits only its own value. */
export function ProfileScalarField({
  config,
  hideLabel = false,
  layout = "stack",
  onCommit,
  validate,
  value,
  placement = { width: fieldWidth(config), startsRow: false },
}: {
  config: LeafConfig;
  /** On when the question above already names this, its only field. */
  hideLabel?: boolean;
  layout?: FieldLayout;
  /** Set by the question, which lays its fields into rows (`layoutRows`). */
  placement?: FieldPlacement;
  onCommit: (value: unknown) => void;
  validate?: (value: unknown) => string | null;
  value: unknown;
}) {
  const inputId = useId();
  const help = layout === "compact" ? undefined : helperText(config);
  const helpId = `${inputId}-help`;
  const isChoice =
    config.kind === "multi-select" ||
    config.kind === "boolean" ||
    config.kind === "select";
  const labelId = `${inputId}-label`;

  return (
    <ProfileFieldRow
      help={help}
      helpId={helpId}
      label={
        <ProfileFieldLabel
          htmlFor={isChoice ? undefined : inputId}
          id={labelId}
          label={config.label}
          layout={layout}
          visuallyHidden={hideLabel}
        />
      }
      startsRow={placement.startsRow}
      width={placement.width}
    >
      {isChoice ? (
        <ChoiceControl
          config={config}
          labelId={labelId}
          onCommit={onCommit}
          value={value}
        />
      ) : config.kind === "string-list" ? (
        <ProfileTagInput
          describedBy={helpId}
          inputId={inputId}
          onCommit={onCommit}
          placeholder={config.placeholder}
          value={value}
        />
      ) : (
        <TextDraftField
          config={config}
          describedBy={help ? helpId : undefined}
          inputId={inputId}
          onCommit={onCommit}
          validate={validate}
          value={value}
        />
      )}
    </ProfileFieldRow>
  );
}

/** Every option on show. A single choice — a select or Yes/No — clears
 * when its chosen chip is pressed again, which is how a student takes an
 * answer back; a multi-select toggles each option and marks the chosen
 * ones with a check, because several can be on at once. */
function ChoiceControl({
  config,
  labelId,
  onCommit,
  value,
}: {
  config: SelectFieldConfig | MultiSelectFieldConfig | ScalarFieldConfig;
  labelId: string;
  onCommit: (value: unknown) => void;
  value: unknown;
}) {
  const isMulti = config.kind === "multi-select";
  const options = "options" in config ? config.options : YES_NO;
  const selected: unknown[] = isMulti
    ? Array.isArray(value)
      ? value
      : []
    : config.kind === "boolean"
      ? typeof value === "boolean"
        ? [String(value)]
        : []
      : [value];

  function toggle(option: string) {
    if (isMulti) {
      const next = selected.includes(option)
        ? selected.filter((entry) => entry !== option)
        : [...selected, option];
      onCommit(next.length > 0 ? next : null);
      return;
    }
    if (selected.includes(option)) {
      onCommit(null);
      return;
    }
    onCommit(config.kind === "boolean" ? option === "true" : option);
  }

  return (
    <div
      aria-labelledby={labelId}
      className="flex flex-wrap gap-2"
      role="group"
    >
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <Button
            aria-pressed={isSelected}
            className={profileChipClass(isSelected)}
            key={option.value}
            onClick={() => toggle(option.value)}
            type="button"
            variant="outline"
          >
            {isMulti && isSelected ? <CheckIcon /> : null}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function numberError(config: ScalarFieldConfig, text: string) {
  if (
    text.trim() === "" ||
    (config.kind !== "int" && config.kind !== "decimal")
  ) {
    return null;
  }
  if (config.kind === "int" && !/^-?\d+$/.test(text.trim())) {
    return "Use a whole number.";
  }
  // `Number()` also reads "0x10" and "1e3", which the backend's Decimal
  // rejects; only a plain decimal is a number here.
  if (config.kind === "decimal" && !/^-?\d+(\.\d+)?$/.test(text.trim())) {
    return "Enter a number, like 3.8.";
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return "Enter a valid number.";
  }
  if (config.min !== undefined && value < config.min) {
    return `Enter ${config.min} or more.`;
  }
  if (config.max !== undefined && value > config.max) {
    return `Enter ${config.max} or less.`;
  }
  return null;
}

function toCommitValue(config: ScalarFieldConfig, text: string): unknown {
  if (text.trim() === "") {
    return null;
  }
  switch (config.kind) {
    case "int":
      return Number.parseInt(text, 10);
    case "textarea":
    case "date":
      return text;
    default:
      return text.trim();
  }
}

function inputType(config: ScalarFieldConfig): string {
  if (config.kind === "int") {
    return "number";
  }
  return config.kind === "date" ? "date" : "text";
}

/** Holds what is being typed and commits it on blur, once it parses and
 * passes the field's range and any cross-field check. */
function useDraftCommit({
  config,
  onCommit,
  validate,
  value,
}: {
  config: ScalarFieldConfig;
  onCommit: (value: unknown) => void;
  validate?: (value: unknown) => string | null;
  value: unknown;
}) {
  const [draft, setDraft] = useFieldDraft(textFromValue(value));
  const [error, setError] = useState<string | null>(null);

  function handleBlur() {
    const nextError = numberError(config, draft);
    setError(nextError);
    if (nextError) {
      return;
    }
    const nextValue = toCommitValue(config, draft);
    const validationError = validate?.(nextValue) ?? null;
    setError(validationError);
    if (validationError) {
      return;
    }
    if (nextValue !== (value ?? null)) {
      onCommit(nextValue);
    }
  }

  function setText(text: string) {
    setDraft(text);
    setError(null);
  }

  function handleChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    setText(event.target.value);
  }

  return { draft, error, handleBlur, handleChange, setText };
}

function TextDraftField({
  config,
  describedBy,
  inputId,
  onCommit,
  validate,
  value,
}: {
  config: ScalarFieldConfig;
  describedBy?: string;
  inputId: string;
  onCommit: (value: unknown) => void;
  validate?: (value: unknown) => string | null;
  value: unknown;
}) {
  const { draft, error, handleBlur, handleChange } = useDraftCommit({
    config,
    onCommit,
    validate,
    value,
  });
  const errorId = `${inputId}-error`;

  const shared = {
    "aria-describedby": joinIds(describedBy, Boolean(error) && errorId),
    "aria-invalid": error ? true : undefined,
    id: inputId,
    onBlur: handleBlur,
    onChange: handleChange,
    placeholder: config.placeholder,
    value: draft,
  };

  return (
    <>
      {config.kind === "textarea" ? (
        <Textarea
          {...shared}
          className={profileTextareaControlClass}
          rows={3}
          size="lg"
        />
      ) : (
        <Input
          {...shared}
          className={
            config.kind === "int" || config.kind === "decimal"
              ? "tabular-nums"
              : undefined
          }
          size="lg"
          type={inputType(config)}
        />
      )}
      <ProfileFieldError id={errorId} text={error} />
    </>
  );
}

/** A test's headline number, set large with its ceiling beside it ("1480
 * / 1600"): the score is what the tile is about, so it reads first. Same
 * draft-and-validate path as every other number. */
export function ProfileScoreHero({
  config,
  label,
  onCommit,
  validate,
  value,
}: {
  config: ScalarFieldConfig;
  /** The accessible name — "SAT total", not just "Total". */
  label: string;
  onCommit: (value: unknown) => void;
  validate?: (value: unknown) => string | null;
  value: unknown;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const { draft, error, handleBlur, setText } = useDraftCommit({
    config,
    onCommit,
    validate,
    value,
  });
  // The box is sized to a score, so anything that is not part of one is
  // dropped as it is typed rather than clipped out of sight.
  const allowed = config.kind === "int" ? /[^\d]/g : /[^\d.]/g;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          aria-label={label}
          className={cn(
            "max-w-[6ch] min-w-[1.5ch] bg-transparent [field-sizing:content] p-0 text-[2.125rem] leading-10 font-medium tracking-[-0.02em] text-[var(--ink)] tabular-nums outline-none placeholder:text-[var(--edge)]",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
          data-hero-score=""
          id={inputId}
          inputMode={config.kind === "int" ? "numeric" : "decimal"}
          maxLength={String(config.max).length + 3}
          onBlur={handleBlur}
          onChange={(event) => setText(event.target.value.replace(allowed, ""))}
          placeholder="—"
          type="text"
          value={draft}
        />
        {config.max !== undefined ? (
          <span className="text-[0.9375rem] text-[var(--ink-faint)] tabular-nums">
            / {config.max}
          </span>
        ) : null}
      </div>
      <ProfileFieldError id={errorId} text={error} />
    </div>
  );
}
