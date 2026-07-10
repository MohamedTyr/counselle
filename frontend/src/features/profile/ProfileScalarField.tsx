import { useId } from "react"

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
import { Textarea } from "@/components/ui/textarea"
import { ProfileFieldLabel } from "@/features/profile/ProfileFieldLabel"
import type {
  MultiSelectFieldConfig,
  ScalarFieldConfig,
  SelectFieldConfig,
  StringListFieldConfig,
} from "@/features/profile/profile-field-types"
import {
  formatStringList,
  parseStringList,
} from "@/features/profile/profile-patch"
import { useFieldDraft } from "@/features/profile/use-field-draft"

const BOOLEAN_UNSET = "__unset__"

function textFromValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  return String(value)
}

/** Renders one leaf profile field (text/textarea/number/decimal/date/boolean,
 * or a select) and autosaves on blur (immediately for discrete selects). An
 * empty text input commits `null` — an explicit clear, per the merge-patch
 * contract — rather than an empty string. */
export function ProfileScalarField({
  config,
  onCommit,
  value,
}: {
  config:
    | ScalarFieldConfig
    | SelectFieldConfig
    | StringListFieldConfig
    | MultiSelectFieldConfig
  onCommit: (value: unknown) => void
  value: unknown
}) {
  const inputId = useId()

  if (config.kind === "multi-select") {
    const currentValues = Array.isArray(value) ? value : []
    return (
      <div className="flex flex-col gap-1.5">
        <ProfileFieldLabel htmlFor={inputId} label={config.label} />
        <div className="flex flex-wrap gap-1.5" id={inputId}>
          {config.options.map((option) => {
            const isSelected = currentValues.includes(option.value)
            return (
              <Button
                aria-pressed={isSelected}
                key={option.value}
                onClick={() => {
                  const next = isSelected
                    ? currentValues.filter((v) => v !== option.value)
                    : [...currentValues, option.value]
                  onCommit(next.length > 0 ? next : null)
                }}
                size="sm"
                variant={isSelected ? "default" : "outline"}
              >
                {option.label}
              </Button>
            )
          })}
        </div>
      </div>
    )
  }

  if (config.kind === "select") {
    const currentValue = typeof value === "string" ? value : BOOLEAN_UNSET
    return (
      <div className="flex flex-col gap-1.5">
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
          <SelectTrigger id={inputId} size="sm">
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
      </div>
    )
  }

  if (config.kind === "boolean") {
    const currentValue =
      value === true ? "true" : value === false ? "false" : BOOLEAN_UNSET
    return (
      <div className="flex flex-col gap-1.5">
        <ProfileFieldLabel htmlFor={inputId} label={config.label} />
        <Select
          items={[
            { label: "Not set", value: BOOLEAN_UNSET },
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ]}
          onValueChange={(nextValue) =>
            onCommit(nextValue === BOOLEAN_UNSET ? null : nextValue === "true")
          }
          value={currentValue}
        >
          <SelectTrigger id={inputId} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="start">
            <SelectGroup>
              <SelectItem value={BOOLEAN_UNSET}>Not set</SelectItem>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectGroup>
          </SelectPopup>
        </Select>
      </div>
    )
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
        value={value}
      />
    )
  }

  if (config.kind === "string-list") {
    return (
      <TextDraftField
        config={config}
        inputId={inputId}
        onCommit={onCommit}
        toDraft={formatStringList}
        toValue={parseStringList}
        value={value}
      />
    )
  }

  if (config.kind === "int") {
    return (
      <TextDraftField
        config={config}
        inputId={inputId}
        onCommit={onCommit}
        toDraft={textFromValue}
        toValue={(text) => {
          if (text.trim() === "") {
            return null
          }
          const parsed = Number.parseInt(text, 10)
          return Number.isFinite(parsed) ? parsed : null
        }}
        value={value}
      />
    )
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
        value={value}
      />
    )
  }

  // "decimal" and "text" are both string-backed: decimals are sent as
  // decimal strings (app.workspace.models.ProfileDecimal parses them
  // server-side, never a lossy float).
  return (
    <TextDraftField
      config={config}
      inputId={inputId}
      onCommit={onCommit}
      toDraft={textFromValue}
      toValue={(text) => (text.trim() === "" ? null : text.trim())}
      value={value}
    />
  )
}

function TextDraftField({
  config,
  inputId,
  multiline = false,
  onCommit,
  toDraft,
  toValue,
  type,
  value,
}: {
  config: ScalarFieldConfig | StringListFieldConfig
  inputId: string
  multiline?: boolean
  onCommit: (value: unknown) => void
  toDraft: (value: unknown) => string
  toValue: (text: string) => unknown
  type?: string
  value: unknown
}) {
  const [draft, setDraft] = useFieldDraft(toDraft(value))

  function handleBlur() {
    const nextValue = toValue(draft)
    if (nextValue !== (value ?? null)) {
      onCommit(nextValue)
    }
  }

  if (multiline) {
    return (
      <div className="flex flex-col gap-1.5">
        <ProfileFieldLabel htmlFor={inputId} label={config.label} />
        <Textarea
          id={inputId}
          onBlur={handleBlur}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={config.placeholder}
          rows={3}
          value={draft}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ProfileFieldLabel htmlFor={inputId} label={config.label} />
      <Input
        id={inputId}
        onBlur={handleBlur}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={config.placeholder}
        size="sm"
        type={type ?? "text"}
        value={draft}
      />
    </div>
  )
}
