import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it } from "vitest";
import { UPSERT } from "../../../../functions/api/waitlist";

// The waitlist's update rule is the data-integrity core: this runs the exact
// statement the Pages Function runs against the real migration, in SQLite.
// Resolved from the frontend root, where vitest runs.
const MIGRATION = "migrations-landing/0001_waitlist.sql";

type Row = Record<string, string | null>;
type Post = {
  email: string;
  side: string;
  source: string;
  plan?: string;
  role?: string;
  classOf?: string;
  utm?: [string, string, string];
};

let db: DatabaseSync;

function post({ email, side, source, plan, role, classOf, utm }: Post) {
  db.prepare(UPSERT).run(
    email,
    side,
    source,
    plan ?? null,
    role ?? null,
    classOf ?? null,
    ...(utm ?? [null, null, null]),
  );
}

const row = (email: string) =>
  db.prepare("SELECT * FROM waitlist WHERE email = ?").get(email) as Row;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(MIGRATION, "utf8"));
});

const first: Post = {
  email: "a@check.invalid",
  side: "me",
  source: "plan",
  plan: "monthly",
  utm: ["newsletter", "email", "launch"],
};

it("creates one row with the first signup's fields", () => {
  post(first);
  expect(row(first.email)).toMatchObject({
    side: "me",
    source: "plan",
    plan: "monthly",
    role: null,
    class_of: null,
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "launch",
  });
});

it("fills answers in on the same side and never moves first-touch fields", () => {
  post(first);
  const before = row(first.email);
  post({
    email: first.email,
    side: "me",
    source: "nav",
    plan: "yearly",
    role: "student",
    classOf: "2028",
    utm: ["twitter", "social", "other"],
  });
  const after = row(first.email);
  expect(after).toMatchObject({ role: "student", class_of: "2028" });
  for (const field of [
    "source",
    "plan",
    "created_at",
    "utm_source",
    "utm_medium",
    "utm_campaign",
  ])
    expect(after[field]).toBe(before[field]);
});

it("never replaces a stored answer with null on the same side", () => {
  post(first);
  post({ ...first, role: "student", classOf: "2028" });
  post({ email: first.email, side: "me", source: "nav" });
  expect(row(first.email)).toMatchObject({
    role: "student",
    class_of: "2028",
  });
});

it("drops the old side's answers when the side changes", () => {
  post({ ...first, role: "student", classOf: "2028" });
  post({ email: first.email, side: "school", source: "schools" });
  expect(row(first.email)).toMatchObject({
    side: "school",
    role: null,
    class_of: null,
    source: "plan",
    plan: "monthly",
  });
  post({ email: first.email, side: "me", source: "nav", role: "parent" });
  expect(row(first.email)).toMatchObject({
    side: "me",
    role: "parent",
    class_of: null,
  });
});

it("keeps a repeated email as one row", () => {
  post({ email: "b@check.invalid", side: "me", source: "nav" });
  post({
    email: "b@check.invalid",
    side: "me",
    source: "link",
    role: "student",
  });
  const { n } = db
    .prepare("SELECT count(*) AS n FROM waitlist WHERE email = ?")
    .get("b@check.invalid") as { n: number };
  expect(n).toBe(1);
});
