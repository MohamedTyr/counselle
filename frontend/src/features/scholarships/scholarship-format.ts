import type { Award, Deadline, Requirements, Scholarship } from "@/api/scholarships/types";

const MS_PER_DAY = 86_400_000;
/** A deadline this close reads as due soon. */
export const DUE_SOON_DAYS = 14;
/** A record not checked against its source for this long needs a re-check. */
export const STALE_AFTER_DAYS = 180;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(value: number): string {
  return money.format(value);
}

function rangeText(min: number | null, max: number | null): string {
  if (min !== null && max !== null) {
    return `${compactMoney.format(min)}–${compactMoney.format(max)}`;
  }
  if (max !== null) return `Up to ${formatMoney(max)}`;
  if (min !== null) return `${formatMoney(min)}+`;
  return "Amount not set";
}

/** The headline figure: "$20,000", "$4K–$50K", "Full ride". */
export function awardHeadline(award: Award): string {
  switch (award.kind) {
    case "fixed":
      return award.amount === null ? "Amount not set" : formatMoney(award.amount);
    case "range":
      return rangeText(award.min, award.max);
    case "varies":
      return "Varies";
    case "full_tuition":
      return "Full tuition";
    case "full_ride":
      return "Full ride";
  }
}

/** The line under the headline: "per year · 4 years", "one-time". */
export function awardCadence(award: Award): string {
  if (award.renewable && award.years) {
    return award.kind === "full_ride" || award.kind === "full_tuition"
      ? `${award.years} years`
      : `per year · ${award.years} years`;
  }
  if (award.kind === "full_ride") return "cost of attendance";
  if (award.kind === "full_tuition") return "tuition";
  return "one-time";
}

/** Total over the award's life, only when it's a simple multiple. */
export function awardTotal(award: Award): string | null {
  if (award.kind === "fixed" && award.amount !== null && award.renewable && award.years && award.years > 1) {
    return `${formatMoney(award.amount * award.years)} total`;
  }
  return null;
}

/** A number for sorting by amount; full rides sort first, "varies" last. */
export function awardSortValue(award: Award): number {
  switch (award.kind) {
    case "full_ride":
      return 1_000_000;
    case "full_tuition":
      return 500_000;
    case "fixed":
      return (award.amount ?? 0) * (award.renewable ? (award.years ?? 1) : 1);
    case "range":
      return award.max ?? award.min ?? 0;
    case "varies":
      return 0;
  }
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function daysUntil(iso: string): number {
  return Math.round((parseIsoDate(iso).getTime() - startOfToday()) / MS_PER_DAY);
}

export function isClosed(deadline: Deadline): boolean {
  return deadline.kind === "fixed" && deadline.date !== null && daysUntil(deadline.date) < 0;
}

export function isNotYetOpen(deadline: Deadline): boolean {
  return deadline.opensOn !== null && daysUntil(deadline.opensOn) > 0;
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

export function formatShortDate(iso: string): string {
  return shortDate.format(parseIsoDate(iso));
}

export function formatLongDate(iso: string): string {
  return longDate.format(parseIsoDate(iso));
}

export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export type DeadlineTone = "closed" | "soon" | "open" | "rolling";

export function deadlineTone(deadline: Deadline): DeadlineTone {
  if (deadline.kind === "rolling" || !deadline.date) return "rolling";
  const days = daysUntil(deadline.date);
  if (days < 0) return "closed";
  return days <= DUE_SOON_DAYS ? "soon" : "open";
}

/** Month bucket for grouping: "October 2026", "Rolling". */
export function deadlineGroup(deadline: Deadline): string {
  if (deadline.kind === "rolling" || !deadline.date) return "Rolling deadline";
  return monthYear.format(parseIsoDate(deadline.date));
}

export function deadlineSortValue(deadline: Deadline): number {
  if (deadline.kind === "rolling" || !deadline.date) return Number.MAX_SAFE_INTEGER;
  return parseIsoDate(deadline.date).getTime();
}

export function daysSince(iso: string): number {
  return -daysUntil(iso.slice(0, 10));
}

export function isStale(scholarship: Pick<Scholarship, "lastCheckedOn">): boolean {
  return daysSince(scholarship.lastCheckedOn) > STALE_AFTER_DAYS;
}

export function hasEssay(requirements: Requirements): boolean {
  return requirements.essays.length > 0;
}

/** "2 essays · 2 recommendations · transcript". */
export function requirementsSummary(requirements: Requirements): string[] {
  const parts: string[] = [];
  const essays = requirements.essays.length;
  if (essays > 0) parts.push(essays === 1 ? "1 essay" : `${essays} essays`);
  const recs = requirements.recommendations;
  if (recs > 0) parts.push(recs === 1 ? "1 recommendation" : `${recs} recommendations`);
  if (requirements.transcript) parts.push("Transcript");
  if (requirements.financialDocuments) parts.push("Financial documents");
  if (requirements.interview) parts.push("Interview");
  return parts;
}
