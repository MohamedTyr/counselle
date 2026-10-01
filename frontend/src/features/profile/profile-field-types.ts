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

/** One question inside a section ("Where are you in high school?") and the
 * fields that answer it. The question is the only heading its fields get:
 * an object field renders its children directly under it, because a legend
 * repeating what the question already asked is chrome for nothing.
 *
 * `label` is the group's short name — its React key, and what an
 * object-list's own label is compared against to avoid saying a word twice.
 * `why` is one line on what the answer changes; leave it off when the
 * question explains itself. `layout: "tiles"` lays each object field out as
 * a score tile (SAT, ACT, …), with tests not yet taken folded into "+" buttons. */
export type FieldGroupConfig = {
  label: string;
  question: string;
  why?: string;
  layout?: "tiles";
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
  groups: readonly FieldGroupConfig[];
};
