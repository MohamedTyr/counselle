export type ScalarFieldKind =
  | "text"
  | "textarea"
  | "int"
  | "decimal"
  | "boolean"
  | "date"

export type SelectOption = { label: string; value: string }

export type ScalarFieldConfig = {
  kind: ScalarFieldKind
  key: string
  label: string
  placeholder?: string
  /** Object-list items only: the backend model requires this leaf (e.g.
   * `ApScore.score`) — an incomplete item is held in the local draft and
   * never sent, so a required-but-blank field never trips a 422. */
  required?: boolean
}

export type SelectFieldConfig = {
  kind: "select"
  key: string
  label: string
  options: readonly SelectOption[]
  required?: boolean
}

/** Comma-separated free text that round-trips as `string[]`. Covers every
 * profile list-of-strings field (courses, languages, majors, preferences). */
export type StringListFieldConfig = {
  kind: "string-list"
  key: string
  label: string
  placeholder?: string
}

/** Toggle-chip multi-select that round-trips as `string[]` of exact backend
 * literal values. Use for `list[Literal[...]]` fields — free text would
 * silently 422 on a typo, so the option set is closed here instead. */
export type MultiSelectFieldConfig = {
  kind: "multi-select"
  key: string
  label: string
  options: readonly SelectOption[]
}

export type ObjectFieldConfig = {
  kind: "object"
  key: string
  label: string
  fields: readonly FieldConfig[]
}

/** A list of small scalar-only records (planned tests, AP scores, legacy
 * hooks, recommenders) — every profile object-list field fits this shape,
 * so one editor covers all four rather than a fully recursive builder. */
export type ObjectListFieldConfig = {
  kind: "object-list"
  key: string
  label: string
  addLabel: string
  itemFields: readonly (ScalarFieldConfig | SelectFieldConfig)[]
  itemSummary: (item: Record<string, unknown>) => string
}

export type FieldConfig =
  | ScalarFieldConfig
  | SelectFieldConfig
  | StringListFieldConfig
  | MultiSelectFieldConfig
  | ObjectFieldConfig
  | ObjectListFieldConfig

export type SectionConfig = {
  key: string
  title: string
  description: string
  fields: readonly FieldConfig[]
}
