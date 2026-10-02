import { afterEach, describe, expect, it } from "vitest";
import type { WaitlistRow } from "@/features/landing/waitlist/contract";
import {
  applyFilters,
  classOf,
  dailyBuckets,
  facetCounts,
  narrowest,
  NO_FILTERS,
  summary,
  toCsv,
  UNTAGGED,
  wasAskedClass,
  whoOf,
  type Filters,
} from "./derive";

function row(overrides: Partial<WaitlistRow> = {}): WaitlistRow {
  return {
    email: "a@check.invalid",
    side: "me",
    source: "nav",
    plan: null,
    role: null,
    class_of: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    created_at: "2026-09-29T12:00:00.000Z",
    updated_at: "2026-09-29T12:00:00.000Z",
    ...overrides,
  };
}

const filters = (overrides: Partial<Filters>): Filters => ({
  ...NO_FILTERS,
  ...overrides,
});

describe("who someone is", () => {
  it.each([
    [{ side: "me", role: "student" }, "student", true, "2027"],
    [{ side: "me", role: "parent" }, "parent", true, "2027"],
    [{ side: "me", role: "counselor" }, "counselor", false, null],
    [{ side: "me", role: null }, "unanswered", true, "2027"],
    [{ side: "school", role: null }, "school", false, null],
  ] as const)("%o is %s", (fields, who, asked, cls) => {
    const r = row({ ...fields, class_of: "2027" });
    expect(whoOf(r)).toBe(who);
    expect(wasAskedClass(r)).toBe(asked);
    expect(classOf(r)).toBe(cls);
  });

  it("counts an asked person with no year as Didn't say", () => {
    expect(classOf(row({ role: "student" }))).toBe("unanswered");
  });
});

describe("facets", () => {
  const rows = [
    row({ email: "a@x.co", utm_source: "x", role: "student" }),
    row({ email: "b@x.co", utm_source: "x", role: "parent" }),
    row({ email: "c@x.co", utm_source: "producthunt", role: "student" }),
    row({ email: "d@x.co", side: "school" }),
  ];

  it("exclude their own facet and include every other filter", () => {
    const facets = facetCounts(rows, filters({ channel: "x", q: "a@" }));
    // Channel ignores its own "x" but applies the search.
    expect(facets.channel).toEqual([{ value: "x", count: 1 }]);
    expect(facets.who.find((f) => f.value === "student")?.count).toBe(1);
  });

  it("keep a selected channel listed at 0", () => {
    const facets = facetCounts(rows, filters({ channel: "reddit" }));
    expect(facets.channel).toContainEqual({ value: "reddit", count: 0 });
  });

  it("list every who and class value, untagged rows under one key", () => {
    const facets = facetCounts(rows, NO_FILTERS);
    expect(facets.who.map((f) => f.value)).toEqual([
      "student",
      "parent",
      "counselor",
      "school",
      "unanswered",
    ]);
    expect(facets.class.map((f) => f.count)).toEqual([0, 0, 0, 0, 3]);
    expect(facets.channel).toContainEqual({ value: UNTAGGED, count: 1 });
  });

  it("filter by class keeps only the people who were asked", () => {
    const kept = applyFilters(rows, filters({ class: "unanswered" }));
    expect(kept.map((r) => r.email)).toEqual(["a@x.co", "b@x.co", "c@x.co"]);
  });

  it("name the filter whose removal brings back the most", () => {
    const zero = filters({ channel: "x", who: "school" });
    expect(applyFilters(rows, zero)).toHaveLength(0);
    expect(narrowest(rows, zero)).toEqual({ key: "who", count: 2 });
  });
});

describe("days", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it("keep empty days and agree with the last-7-days count", () => {
    process.env.TZ = "UTC";
    const now = new Date("2026-09-30T15:00:00.000Z");
    const rows = [
      row({ email: "a@x.co", created_at: "2026-09-20T10:00:00.000Z" }),
      row({ email: "b@x.co", created_at: "2026-09-24T10:00:00.000Z" }),
      row({ email: "c@x.co", created_at: "2026-09-30T09:00:00.000Z" }),
      row({ email: "d@x.co", created_at: "2026-09-30T10:00:00.000Z" }),
    ];
    const buckets = dailyBuckets(rows, rows, now);
    expect(buckets).toHaveLength(11);
    expect(buckets[1].count).toBe(0);
    const lastSeven = buckets.slice(-7).reduce((n, b) => n + b.count, 0);
    const s = summary(rows, rows.length, now, null);
    expect(s).toEqual({
      total: 4,
      lastWeek: lastSeven,
      today: 2,
      newSince: null,
    });
    expect(lastSeven).toBe(3);
  });

  it("stay one bucket per local day across a DST change", () => {
    process.env.TZ = "America/New_York";
    // US clocks fall back on 2026-11-01.
    const now = new Date("2026-11-03T17:00:00.000Z");
    const rows = [
      row({ email: "a@x.co", created_at: "2026-10-30T16:00:00.000Z" }),
      row({ email: "b@x.co", created_at: "2026-11-01T16:00:00.000Z" }),
      // 23:30 on Nov 2 in New York, already Nov 3 in UTC.
      row({ email: "c@x.co", created_at: "2026-11-03T04:30:00.000Z" }),
    ];
    const buckets = dailyBuckets(rows, rows, now);
    expect(buckets.map((b) => b.key)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(buckets.map((b) => b.count)).toEqual([1, 0, 1, 1, 0]);
    expect(summary(rows, 3, now, null).today).toBe(0);
  });

  it("cap at the last 90 days", () => {
    process.env.TZ = "UTC";
    const now = new Date("2026-09-30T12:00:00.000Z");
    const rows = [row({ created_at: "2026-01-01T12:00:00.000Z" })];
    const buckets = dailyBuckets(rows, rows, now);
    expect(buckets).toHaveLength(90);
    expect(buckets.at(-1)?.key).toBe("2026-09-30");
  });

  it("draw filtered counts against the whole day's total", () => {
    process.env.TZ = "UTC";
    const now = new Date("2026-09-29T20:00:00.000Z");
    const all = [
      row({ email: "a@x.co" }),
      row({ email: "b@x.co", utm_source: "x" }),
    ];
    const [bucket] = dailyBuckets(
      all,
      applyFilters(all, filters({ channel: "x" })),
      now,
    );
    expect(bucket).toMatchObject({ count: 1, all: 2 });
  });
});

it("counts the signups since the last visit", () => {
  const rows = [
    row({ email: "a@x.co", created_at: "2026-09-29T10:00:00.000Z" }),
    row({ email: "b@x.co", created_at: "2026-09-29T14:00:00.000Z" }),
  ];
  const now = new Date("2026-09-29T15:00:00.000Z");
  expect(summary(rows, 2, now, "2026-09-29T12:00:00.000Z").newSince).toBe(1);
});

describe("CSV", () => {
  it("starts with a BOM, ends lines with CRLF and quotes per RFC 4180", () => {
    const csv = toCsv([row({ utm_campaign: 'say "hi", ok' })]);
    expect(csv.startsWith("﻿email,created_at,")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(lines[1]).toBe(
      'a@check.invalid,2026-09-29T12:00:00.000Z,2026-09-29T12:00:00.000Z,me,,,,nav,,,"say ""hi"", ok"',
    );
  });

  it.each(["=cmd@x.co", "+1@x.co", "-1@x.co", "@x@x.co"])(
    "guards a cell starting like a formula: %s",
    (email) => {
      const line = toCsv([row({ email })]).split("\r\n")[1];
      expect(line.startsWith(`'${email},`)).toBe(true);
    },
  );

  it("guards a campaign tag starting with a dash", () => {
    const line = toCsv([row({ utm_source: "-x" })]).split("\r\n")[1];
    expect(line).toContain(",'-x,");
  });
});
