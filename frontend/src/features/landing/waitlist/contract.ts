// The waitlist's shape, shared by the form and functions/api/waitlist.ts.
// Import-free and browser-free: the Pages Function imports it by relative path.

export const SIDES = ["me", "school"] as const;
export const ROLES = ["student", "parent", "counselor"] as const;
export const CLASS_YEARS = ["2027", "2028", "2029", "Later"] as const;
export const PLAN_IDS = ["free", "monthly", "yearly"] as const;
/**
 * What opened the form: the nav CTA, a Pricing plan, the Schools CTA, the
 * footer form, or a deep link / untagged anchor.
 */
export const SOURCES = ["nav", "plan", "schools", "footer", "link"] as const;
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

export type Side = (typeof SIDES)[number];
export type Role = (typeof ROLES)[number];
export type ClassYear = (typeof CLASS_YEARS)[number];
export type PlanId = (typeof PLAN_IDS)[number];
export type Source = (typeof SOURCES)[number];

/** One list for the form and the admin page, so a new value is one edit. */
export const ROLE_LABELS: Record<Role, string> = {
  student: "Student",
  parent: "Parent",
  counselor: "Counselor",
};
export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  monthly: "Monthly",
  yearly: "Yearly",
};
export const SOURCE_LABELS: Record<Source, string> = {
  nav: "Header button",
  plan: "Pricing",
  schools: "For schools",
  footer: "Footer",
  link: "Direct link",
};

/** A row as D1 stores it, and as /admin/api/waitlist returns it. */
export type WaitlistRow = {
  email: string;
  side: Side;
  source: Source;
  plan: PlanId | null;
  role: Role | null;
  class_of: ClassYear | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_at: string;
  updated_at: string;
};

export function isSource(value: unknown): value is Source {
  return SOURCES.includes(value as Source);
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Control and invisible formatting characters, such as U+202E. */
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/u;

/** RFC 5321's limits on a whole address and on the part before the @. */
const MAX_EMAIL = 254;
const MAX_LOCAL_PART = 64;

/** Whether a trimmed email looks like one. The server applies the same rule. */
export function emailShape(value: string): boolean {
  return (
    value.length <= MAX_EMAIL &&
    value.lastIndexOf("@") <= MAX_LOCAL_PART &&
    EMAIL_SHAPE.test(value) &&
    !HIDDEN_CHARS.test(value)
  );
}
