import { XIcon } from "lucide-react";
import type React from "react";
import { useEffect, useId, useRef } from "react";

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
  profileGroupBoxClass,
  profileInlineLabelClass,
  profileSegmentedControlClass,
  profileSegmentedOptionClass,
} from "@/features/profile/profile-control-styles";
import { useFieldDraft } from "@/features/profile/use-field-draft";

type Item = Record<string, unknown>;

function emptyItem(config: ObjectListFieldConfig): Item {
  const item: Item = {};
  for (const field of config.itemFields) {
    item[field.key] = field.kind === "boolean" ? null : "";
  }
  return item;
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

function fieldError(
  field: ScalarFieldConfig | SelectFieldConfig,
  value: unknown,
): string | null {
  const isBlank = value === null || value === undefined || value === "";
  if (isBlank) {
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
  value,
}: {
  config: ObjectListFieldConfig;
  onCommit: (value: Item[] | null) => void;
  value: unknown;
}) {
  const [draft, setDraft] = useFieldDraft(itemsFromValue(value));
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
    // required backend field. The array saves once every item is complete.
    if (!nextItems.every((item) => isItemComplete(item, config.itemFields))) {
      return;
    }
    const serialized = JSON.stringify(nextItems);
    if (serialized !== committedRef.current) {
      committedRef.current = serialized;
      onCommit(nextItems.length > 0 ? nextItems : null);
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

  return (
    <div className="flex flex-col gap-3.5">
      <span className="text-sm font-medium text-[var(--profile-field-label)]">
        {config.label}
      </span>
      <div className="flex flex-col gap-3" id={listId}>
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
      {draft.length === 0 ? (
        <p className="text-sm text-[var(--profile-field-helper)]">
          No entries added yet.
        </p>
      ) : null}
      <Button
        className="self-start border-[var(--profile-field-border)] bg-transparent text-[var(--profile-field-label)] hover:border-[var(--profile-field-hover-border)] hover:bg-[var(--profile-control-selected-surface)]"
        onClick={addItem}
        size="sm"
        type="button"
        variant="outline"
      >
        {config.addLabel}
      </Button>
    </div>
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
  const errors = config.itemFields
    .map((field) => fieldError(field, item[field.key]))
    .filter((error): error is string => error !== null);
  const summary = config.itemSummary(item);

  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${profileGroupBoxClass}`}>
      <div className="col-span-full flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--profile-field-label)]">
          {summary === "New entry" ? `${config.label} ${index + 1}` : summary}
        </span>
        <Button
          aria-label={`Remove ${summary}`}
          className="text-muted-foreground hover:text-destructive-foreground"
          onClick={onRemove}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
      {config.itemFields.map((field) => (
        <ObjectListItemField
          config={field}
          error={fieldError(field, item[field.key])}
          id={`${id}-${field.key}`}
          key={field.key}
          onBlur={onBlur}
          onChange={(nextValue) => onChange(field.key, nextValue)}
          value={item[field.key]}
        />
      ))}
      {errors.length > 0 ? (
        <p className="col-span-full text-xs leading-5 text-[var(--profile-field-helper)]">
          Complete or correct the highlighted fields to save this entry.
        </p>
      ) : null}
    </div>
  );
}

function ObjectListItemField({
  config,
  error,
  id,
  onBlur,
  onChange,
  value,
}: {
  config: ScalarFieldConfig | SelectFieldConfig;
  error: string | null;
  id: string;
  onBlur: () => void;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  if (config.kind === "select") {
    const currentValue =
      typeof value === "string" && value !== "" ? value : "__unset__";
    const helperId = `${id}-helper`;
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <label className={profileInlineLabelClass} htmlFor={id}>
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
    const currentValue =
      value === true ? "true" : value === false ? "false" : "__unset__";
    return (
      <div
        aria-labelledby={id}
        className="flex min-w-0 flex-col gap-2"
        role="group"
      >
        <span className={profileInlineLabelClass} id={id}>
          {config.label}
        </span>
        <div className="flex min-h-10 items-center">
          <div className={profileSegmentedControlClass}>
            {[
              { label: "Not set", value: "__unset__" },
              { label: "Yes", value: "true" },
              { label: "No", value: "false" },
            ].map((option) => {
              const isSelected = option.value === currentValue;
              return (
                <Button
                  aria-pressed={isSelected}
                  className={`h-8 px-3 text-sm sm:h-7 sm:px-2.5 sm:text-xs ${profileSegmentedOptionClass(isSelected)}`}
                  key={option.value}
                  onClick={() => {
                    onChange(
                      option.value === "__unset__"
                        ? null
                        : option.value === "true",
                    );
                    onBlur();
                  }}
                  size="sm"
                  type="button"
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
    <div className="flex min-w-0 flex-col gap-2">
      <label className={profileInlineLabelClass} htmlFor={id}>
        {config.label}
      </label>
      <Input
        aria-describedby={error ? helperId : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
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
