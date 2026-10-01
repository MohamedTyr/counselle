import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// e2e/fixtures/waitlist-seed.sql: 41 signups, 10 of them from utm_source x.
const TOTAL = 41;
const FROM_X = 10;

test.describe.configure({ mode: "serial" });

async function open(page: Page, path = "/admin/") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Waitlist", level: 1 })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
}

const count = (page: Page) => page.getByText(/^\d+ of \d+$/);

test("loads the whole list with counts that match the seed", async ({ page }) => {
  await open(page);
  await expect(page.getByText(`${TOTAL} signups`, { exact: false }).first()).toBeVisible();
  await expect(count(page)).toHaveText(`${TOTAL} of ${TOTAL}`);
  await expect(page.getByText(/^Updated /)).toBeVisible();
});

test("filters the table, chart and URL from the channel breakdown", async ({ page }) => {
  await open(page);
  const x = page.getByRole("button", { name: /^x\b/ });
  await x.click();
  await expect(x).toHaveAttribute("aria-pressed", "true");
  await expect(count(page)).toHaveText(`${FROM_X} of ${TOTAL}`);
  expect(new URL(page.url()).searchParams.get("channel")).toBe("x");

  const bar = page.locator(".recharts-bar-rectangle path").last();
  await bar.hover();
  await expect(page.getByText(/· \d+ of \d+ signups?$/)).toBeVisible();

  await page.reload();
  await expect(count(page)).toHaveText(`${FROM_X} of ${TOTAL}`);
});

test("searches by email, from the / shortcut", async ({ page }) => {
  await open(page, "/admin/?channel=x");
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search email" })).toBeFocused();
  await page.keyboard.type("person0");
  await expect(count(page)).toHaveText(`3 of ${TOTAL}`);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("person0");
  await page.keyboard.press("Escape");
  await expect(count(page)).toHaveText(`${FROM_X} of ${TOTAL}`);
});

test("exports the filtered view as a guarded CSV", async ({ page }) => {
  await open(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^acceptra-waitlist-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv.startsWith("﻿email,created_at,")).toBe(true);
  const lines = csv.slice(1).trimEnd().split("\r\n");
  expect(lines).toHaveLength(TOTAL + 1);
  expect(csv).toContain("'=formula@seed.test,");
  expect(csv).toContain(",'-dash,");

  await open(page, "/admin/?channel=x");
  const filtered = page.waitForEvent("download");
  await page.getByRole("button", { name: `Export ${FROM_X}` }).click();
  const slice = readFileSync((await (await filtered).path())!, "utf8");
  expect(slice.trimEnd().split("\r\n")).toHaveLength(FROM_X + 1);
});

test("copies the filtered emails, one per line", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "/admin/?channel=x");
  await page.getByRole("button", { name: `Copy ${FROM_X} emails` }).click();
  await expect(page.getByText(`Copied ${FROM_X} emails`)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split("\n")).toHaveLength(FROM_X);
});

test("deletes one signup after confirming, for good", async ({ page }) => {
  await open(page);
  const email = "person05@seed.test";
  await page.getByRole("button", { name: `Actions for ${email}` }).click();
  await page.getByRole("menuitem", { name: "Delete signup…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Delete ${email}?`);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Delete signup" }).click();
  await expect(page.getByText(`Deleted ${email}`)).toBeVisible();
  await expect(dialog).toBeHidden();
  // The row and its menu are gone; focus lands on the list, not <body>.
  await expect(page.getByRole("region", { name: "Signups" })).toBeFocused();

  await page.reload();
  await expect(count(page)).toHaveText(`${TOTAL - 1} of ${TOTAL - 1}`);
  await expect(page.getByText(email)).toHaveCount(0);
});

test("never scrolls sideways at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await open(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await expect(page.getByRole("radiogroup", { name: "Breakdown" })).toBeVisible();
});
