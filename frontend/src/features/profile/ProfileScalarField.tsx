import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProfileFieldLabel } from "@/features/profile/ProfileFieldLabel";
import {
  profileSegmentedControlClass,
  profileSegmentedOptionClass,
  profileTextareaControlClass,
} from "@/features/profile/profile-control-styles";
import type {
  MultiSelectFieldConfig,
  ScalarFieldConfig,
  SelectFieldConfig,
  StringListFieldConfig,
} from "@/features/profile/profile-field-types";
import {
  formatStringList,
  parseStringList,
} from "@/features/profile/profile-patch";
import { useFieldDraft } from "@/features/profile/use-field-draft";

const BOOLEAN_UNSET = "__unset__";

function textFromValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function helperText(
  config: ScalarFieldConfig | SelectFieldConfig | StringListFieldConfig,
) {
  if (config.kind === "string-list") {
    return "Separate with commas. Counselle saves each item individually.";
  }
  return "help" in config ? config.help : undefined;
}

/** Renders one profile leaf while preserving the minimal merge-patch contract. */
export function ProfileScalarField({
  config,
  onCommit,
  validate,
  value,
}: {
  config:
    | ScalarFieldConfig
    | SelectFieldConfig
    | StringListFieldConfig
    | MultiSelectFieldConfig;
  onCommit: (value: unknown) => void;
  validate?: (value: unknown) => string | null;
  value: unknown;
}) {
  const inputId = useId();

  if (config.kind === "multi-select") {
    const currentValues = Array.isArray(value) ? value : [];
    return (
      <div
        aria-labelledby={inputId}
        className="flex flex-col gap-2"
        role="group"
      >
        <span
          className="text-sm font-medium text-[var(--profile-field-label)]"
          id={inputId}
        >
          {config.label}
        </span>
        <div className="flex flex-wrap gap-2">
          {config.options.map((option) => {
            const isSelected = currentValues.includes(option.value);
            return (
              <Button
                aria-pressed={isSelected}
                className={
                  isSelected
                    ? "border-[var(--profile-control-selected-border)] bg-[var(--profile-control-selected-surface)] text-foreground"
                    : "text-[var(--profile-field-label)]"
                }
                key={option.value}
                onClick={() => {
                  const next = isSelected
                    ? currentValues.filter((entry) => entry !== option.value)
                    : [...currentValues, option.value];
                  onCommit(next.length > 0 ? next : null);
                }}
                size="sm"
                variant="outline"
              >
                {option.label}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  if (config.kind === "select") {
    const currentValue = typeof value === "string" ? value : BOOLEAN_UNSET;
    const help = helperText(config);
    const helperId = `${inputId}-helper`;
    return (
      <div className="flex flex-col gap-2">
        <ProfileFieldLabel htmlFor={inputId} label={config.label} />
        <Select
          items={[
            { label: "Not set", value: BOOLEAN_UNSET },
            ...config.options,
          ]}
          onValueChange={(nextValue) =>
            onCommit(nextValue === BOOLEAN_UNSET ? null : nextValue)
          }
          value={currentValue}
        >
          <SelectTrigger
            aria-describedby={help ? helperId : undefined}
            id={inputId}
            size="lg"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="start">
            <SelectGroup>
              <SelectItem value={BOOLEAN_UNSET}>Not set</SelectItem>
              {config.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
        <FieldHelper id={helperId} text={help} />
      </div>
    );
  }

  if (config.kind === "boolean") {
    const currentValue =
      value === true ? "true" : value === false ? "false" : BOOLEAN_UNSET;
    return (
      <div
        aria-labelledby={inputId}
        className="flex flex-col gap-2"
        role="group"
      >
        <span
          className="text-sm font-medium text-[var(--profile-field-label)]"
          id={inputId}
        >
          {config.label}
        </span>
        <div className="flex min-h-10 items-center">
          <div className={profileSegmentedControlClass}>
            {[
              { label: "Not set", value: BOOLEAN_UNSET },
              { label: "Yes", value: "true" },
              { label: "No", value: "false" },
            ].map((option) => {
              const isSelected = option.value === currentValue;
              return (
                <Button
                  aria-pressed={isSelected}
                  className={`h-8 px-3 text-sm sm:h-7 sm:px-2.5 sm:text-xs ${profileSegmentedOptionClass(isSelected)}`}
                  key={option.value}
                  onClick={() =>
                    onCommit(
                      option.value === BOOLEAN_UNSET
                        ? null
                        : option.value === "true",
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (config.kind === "textarea") {
    return (
      <TextDraftField
        config={config}
        inputId={inputId}
        multiline
        onCommit={onCommit}
        toDraft={textFromValue}
        toValue={(text) => (text.trim() === "" ? null : text)}
        validate={validate}
        value={value}
      />
    );
  }

  if (config.kind === "string-list") {
    return (
      <TextDraftField
        config={config}
        inputId={inputId}
        onCommit={onCommit}
        toDraft={formatStringList}
        toValue={parseStringList}
        validate={validate}
        value={value}
      />
    );
  }

  if (config.kind === "int") {
    return (
      <TextDraftField
        config={config}
        inputId={inputId}
        onCommit={onCommit}
        toDraft={textFromValue}
        toValue={(text) =>
          text.trim() === "" ? null : Number.parseInt(text, 10)
        }
        type="number"
        validate={validate}
        value={value}
      />
    );
  }

  if (config.kind === "date") {
    return (
      <TextDraftField
        config={config}
        inputId={inputId}
        onCommit={onCommit}
        toDraft={textFromValue}
        toValue={(text) => (text.trim() === "" ? null : text)}
        type="date"
        validate={validate}
        value={value}
      />
    );
  }

  return (
    <TextDraftField
      config={config}
      inputId={inputId}
      onCommit={onCommit}
      toDraft={textFromValue}
      toValue={(text) => (text.trim() === "" ? null : text.trim())}
      validate={validate}
      value={value}
    />
  );
}

function FieldHelper({
  error = false,
  id,
  text,
}: {
  error?: boolean;
  id: string;
  text?: string;
}) {
  return text ? (
    <p
      aria-live={error ? "polite" : undefined}
      className={
        error
          ? "text-xs leading-5 text-destructive-foreground"
          : "text-xs leading-5 text-[var(--profile-field-helper)]"
      }
      id={id}
    >
      {text}
    </p>
  ) : null;
}

function numberError(
  config: ScalarFieldConfig | StringListFieldConfig,
  text: string,
) {
  if (
    text.trim() === "" ||
    (config.kind !== "int" && config.kind !== "decimal")
  ) {
    return null;
  }
  if (config.kind === "int" && !/^-?\d+$/.test(text.trim())) {
    return "Use a whole number.";
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return "Enter a valid number.";
  }
  if ("min" in config && config.min !== undefined && value < config.min) {
    return `Enter ${config.min} or more.`;
  }
  if ("max" in config && config.max !== undefined && value > config.max) {
    return `Enter ${config.max} or less.`;
  }
  return null;
}

function TextDraftField({
  config,
  inputId,
  multiline = false,
  onCommit,
  toDraft,
  toValue,
  type,
  validate,
  value,
}: {
  config: ScalarFieldConfig | StringListFieldConfig;
  inputId: string;
  multiline?: boolean;
  onCommit: (value: unknown) => void;
  toDraft: (value: unknown) => string;
  toValue: (text: string) => unknown;
  type?: string;
  validate?: (value: unknown) => string | null;
  value: unknown;
}) {
  const [draft, setDraft] = useFieldDraft(toDraft(value));
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const helperId = `${inputId}-helper`;
  const listItems =
    config.kind === "string-list" ? (parseStringList(draft) ?? []) : [];

  function handleBlur() {
    setIsEditing(false);
    const nextError = numberError(config, draft);
    setError(nextError);
    if (nextError) {
      return;
    }
    const nextValue = toValue(draft);
    const validationError = validate?.(nextValue) ?? null;
    setError(validationError);
    if (validationError) {
      return;
    }
    if (nextValue !== (value ?? null)) {
      onCommit(nextValue);
    }
  }

  const help = helperText(config);
  const supportingText = error ?? help;
  if (multiline) {
    return (
      <div className="flex flex-col gap-2">
        <ProfileFieldLabel htmlFor={inputId} label={config.label} />
        <Textarea
          aria-invalid={error ? true : undefined}
          aria-describedby={supportingText ? helperId : undefined}
          className={profileTextareaControlClass}
          id={inputId}
          onBlur={handleBlur}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onFocus={() => setIsEditing(true)}
          placeholder={config.placeholder}
          rows={4}
          size="lg"
          value={draft}
        />
        <FieldHelper
          error={Boolean(error)}
          id={helperId}
          text={supportingText}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ProfileFieldLabel htmlFor={inputId} label={config.label} />
      <Input
        aria-invalid={error ? true : undefined}
        aria-describedby={supportingText ? helperId : undefined}
        id={inputId}
        onBlur={handleBlur}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onFocus={() => setIsEditing(true)}
        placeholder={config.placeholder}
        size="lg"
        type={type ?? "text"}
        value={draft}
      />
      <FieldHelper error={Boolean(error)} id={helperId} text={supportingText} />
      {listItems.length > 0 && !isEditing ? (
        <div
          aria-label={`${config.label} items`}
          className="flex flex-wrap gap-1.5"
        >
          {listItems.map((item) => (
            <span
              className="rounded-md bg-[var(--profile-control-selected-surface)] px-2 py-1 text-xs text-[var(--profile-field-label)]"
              key={item}
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
