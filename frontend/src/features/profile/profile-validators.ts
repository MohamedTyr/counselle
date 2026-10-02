import { getAtPath } from "@/features/profile/profile-patch";

/** Checks a value about to be saved against its committed neighbours, for
 * the rules the backend enforces across fields (`app/workspace/models.py`).
 * Without them the field would save, the server would answer 422, and the
 * student would see "Couldn't save" with no idea which number was wrong. */
export type FieldValidator = (nextValue: unknown) => string | null;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The pair of values a rule compares: the one being edited takes its new
 * value, every other one its committed value. */
function readWith(
  sectionValue: unknown,
  path: readonly string[],
  editedKey: string,
  nextValue: unknown,
) {
  return (key: string) =>
    finiteNumber(
      key === editedKey ? nextValue : getAtPath(sectionValue, [...path, key]),
    );
}

const RULES: Record<
  string,
  {
    keys: readonly string[];
    check: (read: (key: string) => number | null) => string | null;
  }[]
> = {
  academics: [
    {
      keys: ["class_rank", "class_size"],
      check: (read) => {
        const rank = read("class_rank");
        const size = read("class_size");
        return rank !== null && size !== null && rank > size
          ? "Class rank can’t be higher than class size."
          : null;
      },
    },
    {
      keys: ["gpa_unweighted", "gpa_scale"],
      check: (read) => {
        const gpa = read("gpa_unweighted");
        const scale = read("gpa_scale");
        if (scale !== null && scale <= 0) {
          return "Enter a scale above 0.";
        }
        return gpa !== null && scale !== null && gpa > scale
          ? "Unweighted GPA can’t be higher than the scale."
          : null;
      },
    },
  ],
  "testing.sat": [
    {
      keys: ["total", "ebrw", "math"],
      check: (read) => {
        const total = read("total");
        const ebrw = read("ebrw");
        const math = read("math");
        return total !== null &&
          ebrw !== null &&
          math !== null &&
          total !== ebrw + math
          ? `Total should be reading & writing plus math (${ebrw + math}).`
          : null;
      },
    },
  ],
};

/** The validator for the leaf at `path` (from the profile root), or
 * `undefined` when no cross-field rule covers it. `sectionValue` is the
 * committed section the leaf lives in. */
export function crossFieldValidator(
  path: readonly string[],
  sectionValue: unknown,
): FieldValidator | undefined {
  const [, ...inner] = path;
  const editedKey = inner[inner.length - 1];
  const parent = inner.slice(0, -1);
  const rules = RULES[[path[0], ...parent].join(".")]?.filter((rule) =>
    rule.keys.includes(editedKey),
  );
  if (!rules || rules.length === 0) {
    return undefined;
  }
  return (nextValue) => {
    const read = readWith(sectionValue, parent, editedKey, nextValue);
    for (const rule of rules) {
      const error = rule.check(read);
      if (error) {
        return error;
      }
    }
    return null;
  };
}
