import { SCHOLARSHIP_FIXTURES } from "@/api/scholarships/fixtures";
import type { Scholarship, ScholarshipDraft } from "@/api/scholarships/types";

/*
 * Stand-in for `/v1/scholarships` until the backend exists. Every function
 * is async with a short delay so loading states are real. Records live in
 * memory, so admin edits last until reload; saved ids persist in
 * localStorage per browser.
 */

const LATENCY_MS = 280;
const SAVED_KEY = "counselle:scholarships:saved";

let records: Scholarship[] = SCHOLARSHIP_FIXTURES.map((item) => ({ ...item }));

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(structuredClone(value)), LATENCY_MS);
  });
}

export function listPublished(): Promise<Scholarship[]> {
  return delay(records.filter((item) => item.status === "published"));
}

export function listAll(): Promise<Scholarship[]> {
  return delay(records);
}

export function getScholarship(id: string): Promise<Scholarship> {
  const found = records.find((item) => item.id === id);
  if (!found) {
    return Promise.reject(new Error("Scholarship not found"));
  }
  return delay(found);
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  const slug = base || "scholarship";
  let candidate = slug;
  let n = 2;
  while (records.some((item) => item.id === candidate)) {
    candidate = `${slug}-${n}`;
    n += 1;
  }
  return candidate;
}

export function createScholarship(draft: ScholarshipDraft): Promise<Scholarship> {
  const now = new Date().toISOString();
  const created: Scholarship = {
    ...draft,
    id: slugify(draft.name),
    createdAt: now,
    updatedAt: now,
    updatedBy: "You",
  };
  records = [created, ...records];
  return delay(created);
}

export function updateScholarship(
  id: string,
  draft: ScholarshipDraft,
): Promise<Scholarship> {
  const index = records.findIndex((item) => item.id === id);
  if (index === -1) {
    return Promise.reject(new Error("Scholarship not found"));
  }
  const updated: Scholarship = {
    ...records[index],
    ...draft,
    updatedAt: new Date().toISOString(),
    updatedBy: "You",
  };
  records = records.map((item) => (item.id === id ? updated : item));
  return delay(updated);
}

export function readSavedIds(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeSavedIds(ids: string[]): Promise<string[]> {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable (private window); the in-session state still holds.
  }
  return Promise.resolve(ids);
}

export function setScholarshipStatus(
  id: string,
  status: Scholarship["status"],
): Promise<Scholarship> {
  const found = records.find((item) => item.id === id);
  if (!found) {
    return Promise.reject(new Error("Scholarship not found"));
  }
  const updated: Scholarship = { ...found, status, updatedAt: new Date().toISOString(), updatedBy: "You" };
  records = records.map((item) => (item.id === id ? updated : item));
  return delay(updated);
}
