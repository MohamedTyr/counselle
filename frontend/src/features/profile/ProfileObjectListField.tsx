import { XIcon } from "lucide-react"
import type React from "react"
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  ObjectListFieldConfig,
  ScalarFieldConfig,
  SelectFieldConfig,
} from "@/features/profile/profile-field-types"
import { useFieldDraft } from "@/features/profile/use-field-draft"

type Item = Record<string, unknown>

function emptyItem(config: ObjectListFieldConfig): Item {
  const item: Item = {}
  for (const field of config.itemFields) {
    item[field.key] = field.kind === "select" ? field.options[0]?.value ?? "" : ""
  }
  return item
}

function itemsFromValue(value: unknown): Item[] {
  return Array.isArray(value) ? (value as Item[]) : []
}

function isItemComplete(
  item: Item,
  fields: readonly (ScalarFieldConfig | SelectFieldConfig)[],
): boolean {
  return fields.every((field) => {
    if (!field.required) {
      return true
    }
    const fieldValue = item[field.key]
    if (field.kind === "int") {
      return typeof fieldValue === "number" && Number.isFinite(fieldValue)
    }
    return typeof fieldValue === "string" && fieldValue.trim() !== ""
  })
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
  config: ObjectListFieldConfig
  onCommit: (value: Item[] | null) => void
  value: unknown
}) {
  const [draft, setDraft] = useFieldDraft(itemsFromValue(value))
  const committedRef = useRef(JSON.stringify(itemsFromValue(value)))

  function commit(nextItems: Item[]) {
    setDraft(nextItems)
    // Incomplete items (e.g. a just-added AP score with no subject/score
    // yet) stay in the local draft only — sending them would 422 against a
    // required backend field. The array saves once every item is complete.
    if (!nextItems.every((item) => isItemComplete(item, config.itemFields))) {
      return
    }
    const serialized = JSON.stringify(nextItems)
    if (serialized !== committedRef.current) {
      committedRef.current = serialized
      onCommit(nextItems.length > 0 ? nextItems : null)
    }
  }

  function updateItemField(index: number, key: string, fieldValue: unknown) {
    setDraft((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: fieldValue } : item,
      ),
    )
  }

  function commitDraft() {
    commit(draft)
  }

  function addItem() {
    commit([...draft, emptyItem(config)])
  }

  function removeItem(index: number) {
    commit(draft.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {config.label}
      </span>
      <div className="flex flex-col gap-2">
        {draft.map((item, index) => (
          <div
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 p-2"
            // Rows have no stable id (arrays replace wholesale on save).
            key={index}
          >
            {config.itemFields.map((field) => (
              <ObjectListItemField
                config={field}
                key={field.key}
                onBlur={commitDraft}
                onChange={(nextValue) =>
                  updateItemField(index, field.key, nextValue)
                }
                value={item[field.key]}
              />
            ))}
            <Button
              aria-label={`Remove ${config.itemSummary(item)}`}
              className="ms-auto"
              onClick={() => removeItem(index)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </div>
        ))}
      </div>
      <Button
        className="self-start"
        onClick={addItem}
        size="sm"
        type="button"
        variant="outline"
      >
        {config.addLabel}
      </Button>
    </div>
  )
}

function ObjectListItemField({
  config,
  onBlur,
  onChange,
  value,
}: {
  config: ScalarFieldConfig | SelectFieldConfig
  onBlur: () => void
  onChange: (value: unknown) => void
  value: unknown
}) {
  if (config.kind === "select") {
    const currentValue = typeof value === "string" ? value : ""
    return (
      <Select
        items={config.options}
        onValueChange={(nextValue) => {
          onChange(nextValue)
          onBlur()
        }}
        value={currentValue}
      >
        <SelectTrigger aria-label={config.label} className="w-40" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup align="start">
          <SelectGroup>
            {config.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    )
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    if (config.kind === "int") {
      onChange(raw.trim() === "" ? null : Number.parseInt(raw, 10))
      return
    }
    onChange(raw)
  }

  return (
    <Input
      aria-label={config.label}
      className="w-40"
      onBlur={onBlur}
      onChange={handleChange}
      placeholder={config.label}
      size="sm"
      type={config.kind === "int" ? "number" : config.kind === "date" ? "date" : "text"}
      value={typeof value === "string" || typeof value === "number" ? value : ""}
    />
  )
}
