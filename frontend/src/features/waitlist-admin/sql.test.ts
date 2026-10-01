import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it } from "vitest";
import { COUNT, DELETE_ONE, LIST } from "../../../functions/admin/api/waitlist";

// The admin reads and deletes with these exact statements against the real
// migration. Resolved from the frontend root, where vitest runs.
const MIGRATION = "migrations-landing/0001_waitlist.sql";

let db: DatabaseSync;

function insert(email: string, createdAt: string) {
  db.prepare(
    "INSERT INTO waitlist (email, side, source, created_at, updated_at) VALUES (?, 'me', 'nav', ?, ?)",
  ).run(email, createdAt, createdAt);
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(MIGRATION, "utf8"));
  insert("old@check.invalid", "2026-09-01T10:00:00.000Z");
  insert("new@check.invalid", "2026-09-29T10:00:00.000Z");
  insert("mid@check.invalid", "2026-09-15T10:00:00.000Z");
});

const emails = (limit: number) =>
  (db.prepare(LIST).all(limit) as { email: string }[]).map((r) => r.email);

it("lists the newest first", () => {
  expect(emails(10)).toEqual([
    "new@check.invalid",
    "mid@check.invalid",
    "old@check.invalid",
  ]);
});

it("respects the limit while COUNT still sees every row", () => {
  expect(emails(2)).toEqual(["new@check.invalid", "mid@check.invalid"]);
  expect(db.prepare(COUNT).get()).toEqual({ total: 3 });
});

it("returns every column the page reads", () => {
  expect(Object.keys(db.prepare(LIST).get(1) as object)).toEqual([
    "email",
    "side",
    "source",
    "plan",
    "role",
    "class_of",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "created_at",
    "updated_at",
  ]);
});

it("deletes one row, then reports nothing left to delete", () => {
  expect(db.prepare(DELETE_ONE).run("mid@check.invalid").changes).toBe(1);
  expect(db.prepare(DELETE_ONE).run("mid@check.invalid").changes).toBe(0);
  expect(emails(10)).toEqual(["new@check.invalid", "old@check.invalid"]);
});
