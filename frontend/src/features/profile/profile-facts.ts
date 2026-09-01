import type {
  FieldConfig,
  SectionConfig,
} from "@/features/profile/profile-field-types";
import { getAtPath } from "@/features/profile/profile-patch";

/** The fact line reads back what the student actually saved, verbatim —
 * never rounded, never interpreted, never inferred (AGENTS.md principle 3).
 * A field with nothing behind it contributes nothing; it never becomes a
 * dash, a zero, or a guess.
 *
 * One rule decides whether a fact carries its label: a number is
 * meaningless alone ("1520" of what?), so numbers, counts and dates take
 * `label value`, while saved text already says what it is ("Lincoln High",
 * "Upward") and stands on its own. Inside a nested object the label is
 * qualified by the object's own — "SAT total 1520", not "Total 1520".
 */
const MAX_FACTS = 3;

export function hasAnyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasAnyValue);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasAnyValue);
  }
  return true;
}

function labelled(prefix: string, label: string, value: string): string {
  return prefix
    ? `${prefix} ${label.toLowerCase()} ${value}`
    : `${label} ${value}`;
}

function fieldFacts(field: FieldConfig, value: unknown, prefix = ""): string[] {
  if (!hasAnyValue(value)) {
    return [];
  }
  if (field.kind === "object") {
    return field.fields.flatMap((child) =>
      fieldFacts(child, getAtPath(value, [child.key]), field.label),
    );
  }
  if (
    field.kind === "object-list" ||
    field.kind === "string-list" ||
    field.kind === "multi-select"
  ) {
    const entries = Array.isArray(value) ? value.length : 0;
    return entries > 0 ? [labelled(prefix, field.label, String(entries))] : [];
  }
  if (field.kind === "select") {
    const option = field.options.find((entry) => entry.value === value);
    return option ? [option.label] : [];
  }
  if (field.kind === "boolean") {
    return [
      `${prefix ? `${prefix} ` : ""}${field.label}: ${value ? "yes" : "no"}`,
    ];
  }
  // A long free-text answer can't be quoted in one line, so the fact is
  // that it exists — the label alone, which is true and never truncates
  // the student's own words into something they did not write.
  if (field.kind === "textarea") {
    return [prefix ? `${prefix} ${field.label.toLowerCase()}` : field.label];
  }
  const text = String(value);
  return field.kind === "text" ? [text] : [labelled(prefix, field.label, text)];
}

/** Up to three facts from the section, in config order. Empty when the
 * student has saved nothing here — the caller shows why the section
 * matters instead. */
export function sectionFacts(section: SectionConfig, value: unknown): string[] {
  const facts: string[] = [];
  for (const group of section.groups) {
    for (const field of group.fields) {
      facts.push(...fieldFacts(field, getAtPath(value, [field.key])));
      if (facts.length >= MAX_FACTS) {
        return facts.slice(0, MAX_FACTS);
      }
    }
  }
  return facts;
}
