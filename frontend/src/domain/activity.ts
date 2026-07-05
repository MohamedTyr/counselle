import type { Option } from "@/domain/shared";

// Activities workspace data model.
//
// Two-layer model:
//   1. Common App entry - the compressed, copy-ready export truth.
//   2. The full story    - Counselle-only raw material, never exported.
//
// Field sets and limits mirror the Common App activities + honors sections.
// Per the product's verification ethos, confirm these against the live form
// for the active cycle before treating them as verified.

export type ActivityType =
  | "Academic"
  | "Art"
  | "Athletics: Club"
  | "Athletics: JV/Varsity"
  | "Career Oriented"
  | "Community Service (Volunteer)"
  | "Computer/Technology"
  | "Cultural"
  | "Dance"
  | "Debate/Speech"
  | "Environmental"
  | "Family Responsibilities"
  | "Foreign Exchange"
  | "Foreign Language"
  | "Internship"
  | "Journalism/Publication"
  | "Junior R.O.T.C."
  | "LGBT"
  | "Music: Instrumental"
  | "Music: Vocal"
  | "Religious"
  | "Research"
  | "Robotics"
  | "School Spirit"
  | "Science/Math"
  | "Social Justice"
  | "Student Govt./Politics"
  | "Theater/Drama"
  | "Work (Paid)"
  | "Other Club/Activity";

export type Grade = "9" | "10" | "11" | "12" | "pg";
export type Timing = "school_year" | "break" | "all_year";
export type RecognitionLevel =
  "school" | "state_regional" | "national" | "international";

export type Activity = {
  id: string;
  order: number; // 1-10, importance rank
  type: ActivityType;
  position: string; // limit 50
  organization: string; // limit 100
  description: string; // limit 150
  grades: Grade[];
  timing: Timing[]; // check all that apply
  hours_per_week?: number; // integer, 1-168
  weeks_per_year?: number; // integer, 1-52
  continue_in_college?: boolean;
  story?: string; // Counselle-only, never exported
  created_at: string;
  updated_at: string;
};

export type Honor = {
  id: string;
  order: number; // 1-5, importance rank
  title: string; // limit 100
  grades: Grade[];
  levels: RecognitionLevel[]; // Level(s) of recognition, multi-select
  created_at: string;
  updated_at: string;
};

export const ACTIVITY_LIMITS = {
  position: 50,
  organization: 100,
  description: 150,
} as const;

export const HONOR_TITLE_LIMIT = 100;
export const MAX_ACTIVITIES = 10;
export const MAX_HONORS = 5;
export const HOURS_MAX = 168;
export const WEEKS_MAX = 52;

// Amber warning threshold: the counter turns amber at 90% of the limit.
export const NEAR_LIMIT_RATIO = 0.9;

export const activityTypeOptions: readonly Option<ActivityType>[] = (
  [
    "Academic",
    "Art",
    "Athletics: Club",
    "Athletics: JV/Varsity",
    "Career Oriented",
    "Community Service (Volunteer)",
    "Computer/Technology",
    "Cultural",
    "Dance",
    "Debate/Speech",
    "Environmental",
    "Family Responsibilities",
    "Foreign Exchange",
    "Foreign Language",
    "Internship",
    "Journalism/Publication",
    "Junior R.O.T.C.",
    "LGBT",
    "Music: Instrumental",
    "Music: Vocal",
    "Religious",
    "Research",
    "Robotics",
    "School Spirit",
    "Science/Math",
    "Social Justice",
    "Student Govt./Politics",
    "Theater/Drama",
    "Work (Paid)",
    "Other Club/Activity",
  ] as const
).map((type) => ({ label: type, value: type }));

export const gradeOptions: readonly Option<Grade>[] = [
  { label: "9", value: "9" },
  { label: "10", value: "10" },
  { label: "11", value: "11" },
  { label: "12", value: "12" },
  { label: "PG", value: "pg" },
];

export const timingOptions: readonly Option<Timing>[] = [
  { label: "School year", value: "school_year" },
  { label: "Break", value: "break" },
  { label: "All year", value: "all_year" },
];

export const levelOptions: readonly Option<RecognitionLevel>[] = [
  { label: "School", value: "school" },
  { label: "State/Regional", value: "state_regional" },
  { label: "National", value: "national" },
  { label: "International", value: "international" },
];

export const gradeShortLabel: Record<Grade, string> = {
  "9": "9",
  "10": "10",
  "11": "11",
  "12": "12",
  pg: "PG",
};

export const timingLabel: Record<Timing, string> = {
  school_year: "School year",
  break: "Break",
  all_year: "All year",
};

export const levelLabel: Record<RecognitionLevel, string> = {
  school: "School",
  state_regional: "State/Regional",
  national: "National",
  international: "International",
};

const gradeRank: Record<Grade, number> = {
  "9": 0,
  "10": 1,
  "11": 2,
  "12": 3,
  pg: 4,
};

const timingRank: Record<Timing, number> = {
  school_year: 0,
  break: 1,
  all_year: 2,
};

const levelRank: Record<RecognitionLevel, number> = {
  school: 0,
  state_regional: 1,
  national: 2,
  international: 3,
};

export function sortGrades(grades: Grade[]): Grade[] {
  return [...grades].sort((a, b) => gradeRank[a] - gradeRank[b]);
}

export function sortTiming(timing: Timing[]): Timing[] {
  return [...timing].sort((a, b) => timingRank[a] - timingRank[b]);
}

export function sortLevels(levels: RecognitionLevel[]): RecognitionLevel[] {
  return [...levels].sort((a, b) => levelRank[a] - levelRank[b]);
}

// "Grades 10-12" when contiguous, "Grades 9, 11" otherwise; "PG" handled inline.
export function formatGrades(grades: Grade[]): string {
  if (grades.length === 0) {
    return "No grades";
  }

  const sorted = sortGrades(grades);
  const labels = sorted.map((grade) => gradeShortLabel[grade]);
  const numeric = sorted.filter((grade) => grade !== "pg");
  const isContiguous =
    numeric.length > 1 &&
    numeric.every(
      (grade, index) =>
        index === 0 || gradeRank[grade] - gradeRank[numeric[index - 1]] === 1,
    );

  if (isContiguous && sorted.length === numeric.length) {
    return `Grades ${gradeShortLabel[numeric[0]]}-${gradeShortLabel[numeric[numeric.length - 1]]}`;
  }

  const prefix = sorted.length === 1 ? "Grade" : "Grades";
  return `${prefix} ${labels.join(", ")}`;
}

export function formatTiming(timing: Timing[]): string {
  if (timing.length === 0) {
    return "No timing";
  }

  return sortTiming(timing)
    .map((value) => timingLabel[value])
    .join(", ");
}

export function formatLevels(levels: RecognitionLevel[]): string {
  if (levels.length === 0) {
    return "No level";
  }

  return sortLevels(levels)
    .map((value) => levelLabel[value])
    .join(", ");
}

export type CharState = "empty" | "ok" | "near" | "over";

export function getCharState(length: number, limit: number): CharState {
  if (length === 0) {
    return "empty";
  }

  if (length > limit) {
    return "over";
  }

  if (length >= Math.floor(limit * NEAR_LIMIT_RATIO)) {
    return "near";
  }

  return "ok";
}

// A field over its budget cannot be pasted into the Common App as-is.
export function isActivityOverLimit(activity: Activity): boolean {
  return (
    activity.position.length > ACTIVITY_LIMITS.position ||
    activity.organization.length > ACTIVITY_LIMITS.organization ||
    activity.description.length > ACTIVITY_LIMITS.description
  );
}

// Named missing/over-budget fields, in the order a student would fill them.
export function getActivityMissingFields(activity: Activity): string[] {
  const missing: string[] = [];

  if (!activity.position.trim()) {
    missing.push("Position");
  }

  if (!activity.organization.trim()) {
    missing.push("Organization");
  }

  if (!activity.description.trim()) {
    missing.push("Description");
  }

  if (activity.grades.length === 0) {
    missing.push("Grades");
  }

  if (activity.timing.length === 0) {
    missing.push("Timing");
  }

  if (
    activity.hours_per_week === undefined ||
    activity.hours_per_week < 1 ||
    activity.hours_per_week > HOURS_MAX
  ) {
    missing.push("Hours/week");
  }

  if (
    activity.weeks_per_year === undefined ||
    activity.weeks_per_year < 1 ||
    activity.weeks_per_year > WEEKS_MAX
  ) {
    missing.push("Weeks/year");
  }

  return missing;
}

export function isActivityReady(activity: Activity): boolean {
  return (
    getActivityMissingFields(activity).length === 0 &&
    !isActivityOverLimit(activity)
  );
}

export function getHonorMissingFields(honor: Honor): string[] {
  const missing: string[] = [];

  if (!honor.title.trim()) {
    missing.push("Title");
  }

  if (honor.grades.length === 0) {
    missing.push("Grades");
  }

  if (honor.levels.length === 0) {
    missing.push("Level of recognition");
  }

  return missing;
}

export function isHonorOverLimit(honor: Honor): boolean {
  return honor.title.length > HONOR_TITLE_LIMIT;
}

export function isHonorReady(honor: Honor): boolean {
  return getHonorMissingFields(honor).length === 0 && !isHonorOverLimit(honor);
}
