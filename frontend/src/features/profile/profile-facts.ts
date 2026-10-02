/** Whether anything is saved under a profile value — a section, a question's
 * fields, one test. A field with nothing behind it is empty whatever its
 * shape: blank strings, empty lists and objects of blanks all count as
 * nothing, so nothing is ever shown as answered that the student did not
 * actually fill in. */
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
