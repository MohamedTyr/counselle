import { PlusIcon, XIcon } from "lucide-react";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";

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
import type {
  ObjectListFieldConfig,
  ScalarFieldConfig,
  SelectFieldConfig,
} from "@/features/profile/profile-field-types";
import {
  profileChipClass,
  profileDashedAddClass,
  profileInlineLabelClass,
  profileScoreOptionClass,
  profileScorePickerClass,
} from "@/features/profile/profile-control-styles";
import {
  ProfileFieldLabel,
  ProfileFieldRow,
} from "@/features/profile/ProfileFieldLabel";
import { cn } from "@/lib/utils";

type Item = Record<string, unknown>;

function emptyItem(config: ObjectListFieldConfig): Item {
  const item: Item = {};
  for (const field of config.itemFields) {
    item[field.key] = field.kind === "boolean" ? null : "";
  }
  return item;
}

/** A whole-number scale short enough to show every step (an AP score,
 * 1–5) is a row of buttons rather than a box to type into. */
const MAX_SCALE_STEPS = 7;

function isShortScale(field: ScalarFieldConfig | SelectFieldConfig) {
  return (
    field.kind === "int" &&
    field.min !== undefined &&
    field.max !== undefined &&
    field.max - field.min + 1 <= MAX_SCALE_STEPS
  );
}

function scaleSteps(field: ScalarFieldConfig | SelectFieldConfig): number[] {
  if (
    field.kind !== "int" ||
    field.min === undefined ||
    field.max === undefined
  ) {
    return [];
  }
  const { min } = field;
  return Array.from({ length: field.max - min + 1 }, (_, index) => min + index);
}

function itemsFromValue(value: unknown): Item[] {
  return Array.isArray(value) ? (value as Item[]) : [];
}

function isItemComplete(
  item: Item,
  fields: readonly (ScalarFieldConfig | SelectFieldConfig)[],
): boolean {
  return fields.every((field) => fieldError(field, item[field.key]) === null);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function fieldError(
  field: ScalarFieldConfig | SelectFieldConfig,
  value: unknown,
): string | null {
  if (isBlank(value)) {
    return field.required ? "Required to save this entry." : null;
  }
  if (field.kind !== "int") {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return "Use a whole number.";
  }
  if (field.min !== undefined && value < field.min) {
    return `Enter ${field.min} or more.`;
  }
  if (field.max !== undefined && value > field.max) {
    return `Enter ${field.max} or less.`;
  }
  return null;
}

/** A list of small scalar records (planned tests, AP scores, hooks,
 * recommenders). Arrays are RFC-7396 wholesale-replace under the
 * merge-patch contract (they're not JSON objects), so every add/remove/edit
 * commits the full array rather than a per-item patch. */
export function ProfileObjectListField({
  config,
  onCommit,
  showLabel = true,
  value,
}: {
  config: ObjectListFieldConfig;
  onCommit: (value: Item[] | null) => void;
  /** Off when the group heading above already says the same word. */
  showLabel?: boolean;
  value: unknown;
}) {
  const serverItems = itemsFromValue(value);
  const serverKey = JSON.stringify(serverItems);
  const [draft, setDraft] = useState(serverItems);
  const [lastServerKey, setLastServerKey] = useState(serverKey);
  // Resync from the server ("adjust state during render", as in
  // `useFieldDraft`), but carry over entries still being filled in: they
  // were never sent, so the server's copy cannot contain them, and dropping
  // them on the echo of a sibling's save would delete what is being typed.
  if (serverKey !== lastServerKey) {
    setLastServerKey(serverKey);
    setDraft([
      ...serverItems,
      ...draft.filter((item) => !isItemComplete(item, config.itemFields)),
    ]);
  }
  const draftRef = useRef(draft);
  const committedRef = useRef(JSON.stringify(itemsFromValue(value)));
  const listId = useId();

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  function commit(nextItems: Item[]) {
    draftRef.current = nextItems;
    setDraft(nextItems);
    // Incomplete items (e.g. a just-added AP score with no subject/score
    // yet) stay in the local draft only — sending them would 422 against a
    // required backend field. Every complete item still saves, so removing
    // or editing one while a new row is half-filled is never silently held
    // back; the half-filled row says it is unsaved until it is complete.
    const complete = nextItems.filter((item) =>
      isItemComplete(item, config.itemFields),
    );
    const serialized = JSON.stringify(complete);
    if (serialized !== committedRef.current) {
      committedRef.current = serialized;
      onCommit(complete.length > 0 ? complete : null);
    }
  }

  function updateItemField(index: number, key: string, fieldValue: unknown) {
    const nextItems = draftRef.current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [key]: fieldValue } : item,
    );
    draftRef.current = nextItems;
    setDraft(nextItems);
  }

  function commitDraft() {
    commit(draftRef.current);
  }

  function addItem() {
    commit([...draftRef.current, emptyItem(config)]);
  }

  function removeItem(index: number) {
    commit(draftRef.current.filter((_, itemIndex) => itemIndex !== index));
  }

  const list = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 empty:hidden" id={listId}>
        {draft.map((item, index) => (
          <ObjectListRow
            config={config}
            id={`${listId}-${index}`}
            index={index}
            item={item}
            key={index}
            onBlur={commitDraft}
            onChange={(key, nextValue) =>
              updateItemField(index, key, nextValue)
            }
            onRemove={() => removeItem(index)}
          />
        ))}
      </div>
      <Button
        className={cn(
          "h-10 self-start rounded-xl px-3.5",
          profileDashedAddClass,
        )}
        onClick={addItem}
        type="button"
        variant="outline"
      >
        <PlusIcon />
        {config.addLabel}
      </Button>
    </div>
  );

  return showLabel ? (
    <ProfileFieldRow
      label={<ProfileFieldLabel label={config.label} />}
      width="full"
    >
      {list}
    </ProfileFieldRow>
  ) : (
    list
  );
}

function ObjectListRow({
  config,
  id,
  index,
  item,
  onBlur,
  onChange,
  onRemove,
}: {
  config: ObjectListFieldConfig;
  id: string;
  index: number;
  item: Item;
  onBlur: () => void;
  onChange: (key: string, value: unknown) => void;
  onRemove: () => void;
}) {
  // A blank required field is not a mistake yet, so it is named in one quiet
  // line under the row; only a value that is actually wrong turns its own
  // field red.
  const missing = config.itemFields.filter(
    (field) => field.required && isBlank(item[field.key]),
  );
  const summary = config.itemSummary(item);

  // Entries read as one table: the first carries the column labels, the rest
  // keep theirs for screen readers only.
  const showLabels = index === 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-2">
        {config.itemFields.map((field) => (
          <ObjectListItemField
            config={field}
            error={
              isBlank(item[field.key])
                ? null
                : fieldError(field, item[field.key])
            }
            id={`${id}-${field.key}`}
            key={field.key}
            onBlur={onBlur}
            onChange={(nextValue) => onChange(field.key, nextValue)}
            showLabel={showLabels}
            value={item[field.key]}
          />
        ))}
        <Button
          aria-label={`Remove ${summary === "New entry" ? `${config.label} ${index + 1}` : summary}`}
          className={cn(
            "text-[var(--ink-faint)] hover:text-destructive-foreground",
            showLabels && "mt-[22px]",
          )}
          onClick={onRemove}
          size="icon-lg"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
      {missing.length > 0 ? (
        <p className="text-xs leading-5 text-[var(--ink-faint)]">
          Add{" "}
          {missing
            .map((field) => `a ${field.label.toLowerCase()}`)
            .join(" and ")}{" "}
          to save this.
        </p>
      ) : null}
    </div>
  );
}

/** Each column is as wide as what it holds, as in the settings rows. */
function itemWidthClass(field: ScalarFieldConfig | SelectFieldConfig): string {
  switch (field.kind) {
    case "int":
    case "decimal":
      return "w-24";
    case "date":
      return "w-40";
    case "select":
      return "w-44";
    case "boolean":
      return "";
    default:
      return "min-w-40 flex-1";
  }
}

function ObjectListItemField({
  config,
  error,
  id,
  onBlur,
  onChange,
  showLabel,
  value,
}: {
  config: ScalarFieldConfig | SelectFieldConfig;
  error: string | null;
  id: string;
  onBlur: () => void;
  onChange: (value: unknown) => void;
  showLabel: boolean;
  value: unknown;
}) {
  const labelClass = showLabel ? profileInlineLabelClass : "sr-only";

  if (config.kind === "select") {
    const currentValue =
      typeof value === "string" && value !== "" ? value : "__unset__";
    const helperId = `${id}-helper`;
    return (
      <div
        className={cn("flex min-w-0 flex-col gap-1.5", itemWidthClass(config))}
      >
        <label className={labelClass} htmlFor={id}>
          {config.label}
        </label>
        <Select
          items={[{ label: "Choose…", value: "__unset__" }, ...config.options]}
          onValueChange={(nextValue) => {
            onChange(nextValue === "__unset__" ? null : nextValue);
            onBlur();
          }}
          value={currentValue}
        >
          <SelectTrigger
            aria-describedby={error ? helperId : undefined}
            aria-invalid={error ? true : undefined}
            id={id}
            size="lg"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="start">
            <SelectGroup>
              <SelectItem value="__unset__">Choose…</SelectItem>
              {config.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
        <InlineFieldError id={helperId} text={error} />
      </div>
    );
  }

  if (config.kind === "boolean") {
    return (
      <div
        aria-labelledby={id}
        className="flex min-w-0 flex-col gap-1.5"
        role="group"
      >
        <span className={labelClass} id={id}>
          {config.label}
        </span>
        <div className="flex min-h-10 items-center gap-1.5">
          {[true, false].map((option) => {
            const isSelected = value === option;
            return (
              <Button
                aria-pressed={isSelected}
                className={profileChipClass(isSelected)}
                key={String(option)}
                onClick={() => {
                  onChange(isSelected ? null : option);
                  onBlur();
                }}
                type="button"
                variant="outline"
              >
                {option ? "Yes" : "No"}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  if (isShortScale(config)) {
    return (
      <div
        aria-labelledby={id}
        className="flex min-w-0 flex-col gap-1.5"
        role="group"
      >
        <span className={labelClass} id={id}>
          {config.label}
        </span>
        <div className={profileScorePickerClass}>
          {scaleSteps(config).map((step) => {
            const isSelected = value === step;
            return (
              <button
                aria-label={`${config.label} ${step}`}
                aria-pressed={isSelected}
                className={profileScoreOptionClass(isSelected)}
                key={step}
                onClick={() => {
                  onChange(isSelected ? null : step);
                  onBlur();
                }}
                type="button"
              >
                {step}
              </button>
            );
          })}
        </div>
        <InlineFieldError id={`${id}-helper`} text={error} />
      </div>
    );
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    if (config.kind === "int") {
      onChange(raw.trim() === "" ? null : Number.parseInt(raw, 10));
      return;
    }
    onChange(raw);
  }

  const helperId = `${id}-helper`;

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", itemWidthClass(config))}
    >
      <label className={labelClass} htmlFor={id}>
        {config.label}
      </label>
      <Input
        aria-describedby={error ? helperId : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
        size="lg"
        max={config.kind === "int" ? config.max : undefined}
        min={config.kind === "int" ? config.min : undefined}
        onBlur={onBlur}
        onChange={handleChange}
        placeholder={config.placeholder}
        type={
          config.kind === "int"
            ? "number"
            : config.kind === "date"
              ? "date"
              : "text"
        }
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
      />
      <InlineFieldError id={helperId} text={error} />
    </div>
  );
}

function InlineFieldError({ id, text }: { id: string; text: string | null }) {
  return text ? (
    <p
      aria-live="polite"
      className="text-xs leading-5 text-destructive-foreground"
      id={id}
    >
      {text}
    </p>
  ) : null;
}
