export type ScalarFieldKind =
  "text" | "textarea" | "int" | "decimal" | "boolean" | "date";

export type SelectOption = { label: string; value: string };

export type ScalarFieldConfig = {
  kind: ScalarFieldKind;
  key: string;
  label: string;
  help?: string;
  max?: number;
  min?: number;
  placeholder?: string;
  /** Object-list items only: the backend model requires this leaf (e.g.
   * `ApScore.score`) — an incomplete item is held in the local draft and
   * never sent, so a required-but-blank field never trips a 422. */
  required?: boolean;
};

export type SelectFieldConfig = {
  kind: "select";
  key: string;
  label: string;
  help?: string;
  options: readonly SelectOption[];
  required?: boolean;
};

/** Comma-separated free text that round-trips as `string[]`. Covers every
 * profile list-of-strings field (courses, languages, majors, preferences). */
export type StringListFieldConfig = {
  kind: "string-list";
  key: string;
  label: string;
  placeholder?: string;
};

/** Toggle-chip multi-select that round-trips as `string[]` of exact backend
 * literal values. Use for `list[Literal[...]]` fields — free text would
 * silently 422 on a typo, so the option set is closed here instead. */
export type MultiSelectFieldConfig = {
  kind: "multi-select";
  key: string;
  label: string;
  options: readonly SelectOption[];
};

export type ObjectFieldConfig = {
  kind: "object";
  key: string;
  label: string;
  fields: readonly FieldConfig[];
};

/** A list of small scalar-only records (planned tests, AP scores, legacy
 * hooks, recommenders) — every profile object-list field fits this shape,
 * so one editor covers all four rather than a fully recursive builder. */
export type ObjectListFieldConfig = {
  kind: "object-list";
  key: string;
  label: string;
  addLabel: string;
  itemFields: readonly (ScalarFieldConfig | SelectFieldConfig)[];
  itemSummary: (item: Record<string, unknown>) => string;
};

export type FieldConfig =
  | ScalarFieldConfig
  | SelectFieldConfig
  | StringListFieldConfig
  | MultiSelectFieldConfig
  | ObjectFieldConfig
  | ObjectListFieldConfig;

/** A labelled run of fields inside one section ("Grades", "Class rank").
 * The label is the only heading its fields get: a group holding exactly one
 * object field renders that object's children directly under the group
 * label, because a legend repeating what the label already said is chrome
 * for nothing. */
export type FieldGroupConfig = {
  label: string;
  fields: readonly FieldConfig[];
};

/** Which rail group a section sits in. `writing` is about TIMING, not rank —
 * an empty section there reads as *not yet*, never as *behind*. */
export type SectionGroupKey = "advice" | "read" | "writing";

export type SectionConfig = {
  key: string;
  title: string;
  description: string;
  group: SectionGroupKey;
  /** One line on what this section changes, shown in place of the fact
   * line while the section is empty. */
  matters: string;
  groups: readonly FieldGroupConfig[];
};
