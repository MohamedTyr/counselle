import fs from "node:fs/promises";

import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.COUNSELLE_REAL_API_URL ?? "http://127.0.0.1:8000";
const VITE_URL = process.env.COUNSELLE_REAL_VITE_URL ?? "http://127.0.0.1:4173";
const UNITID = process.env.REAL_SCHOOL_UNITID;
const AUTH_STATE = path.resolve("playwright/.auth/local.json");
const factsUrl = (unitid: string) => `${API_URL}/v1/schools/${unitid}/facts`;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function isValueFact(value: unknown, key: string): value is JsonRecord {
  return (
    isRecord(value) &&
    value.key === key &&
    value.state === "value" &&
    typeof value.kind === "string"
  );
}

function finiteNumber(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function usableScalar(
  fact: unknown,
  key: string,
  min: number,
  max: number,
): boolean {
  return (
    isValueFact(fact, key) &&
    fact.kind === "scalar" &&
    finiteNumber(fact.value, min, max)
  );
}

function usableBand(
  fact: unknown,
  key: string,
  min: number,
  max: number,
): boolean {
  if (!isValueFact(fact, key) || fact.kind !== "band" || !isRecord(fact.value))
    return false;
  const { p25, p75, min: reportedMin, max: reportedMax } = fact.value;
  return (
    reportedMin === min &&
    reportedMax === max &&
    finiteNumber(p25, min, max) &&
    finiteNumber(p75, min, max) &&
    p25 <= p75
  );
}

function usableDistribution(
  fact: unknown,
  key: string,
  scale: string,
): boolean {
  if (
    !isValueFact(fact, key) ||
    fact.kind !== "distribution" ||
    !isRecord(fact.value)
  )
    return false;
  if (fact.value.scale !== scale || !Array.isArray(fact.value.buckets))
    return false;
  const buckets = fact.value.buckets.filter(isRecord);
  return (
    buckets.some(
      (bucket) => typeof bucket.pct === "number" && Number.isFinite(bucket.pct),
    ) &&
    buckets.every(
      (bucket) =>
        bucket.pct === undefined ||
        (typeof bucket.pct === "number" &&
          Number.isFinite(bucket.pct) &&
          bucket.pct >= 0 &&
          bucket.pct <= 100),
    )
  );
}

function factsFor(response: unknown): Map<string, unknown[]> {
  const facts = new Map<string, unknown[]>();
  if (!isRecord(response) || !Array.isArray(response.sections)) return facts;
  for (const section of response.sections) {
    if (!isRecord(section) || !Array.isArray(section.groups)) continue;
    for (const group of section.groups) {
      if (!isRecord(group) || !Array.isArray(group.facts)) continue;
      for (const fact of group.facts) {
        if (!isRecord(fact) || typeof fact.key !== "string") continue;
        facts.set(fact.key, [...(facts.get(fact.key) ?? []), fact]);
      }
    }
  }
  return facts;
}

function usableAcademicData(response: unknown): string[] {
  const byKey = factsFor(response);
  const anyUsable = (key: string, check: (fact: unknown) => boolean) => {
    const facts = byKey.get(key) ?? [];
    return facts.length === 1 && facts.some(check);
  };
  const missing: string[] = [];
  if (
    !anyUsable("class_profile.average_gpa", (fact) =>
      usableScalar(fact, "class_profile.average_gpa", 0, 5),
    ) &&
    !anyUsable("class_profile.gpa_distribution", (fact) =>
      usableDistribution(fact, "class_profile.gpa_distribution", "gpa"),
    )
  )
    missing.push("usable GPA average or distribution");
  if (
    !(
      anyUsable("class_profile.sat_math", (fact) =>
        usableBand(fact, "class_profile.sat_math", 200, 800),
      ) ||
      anyUsable("class_profile.sat_math_avg", (fact) =>
        usableScalar(fact, "class_profile.sat_math_avg", 200, 800),
      ) ||
      anyUsable("class_profile.sat_math_distribution", (fact) =>
        usableDistribution(
          fact,
          "class_profile.sat_math_distribution",
          "sat_math",
        ),
      )
    ) ||
    !(
      anyUsable("class_profile.sat_ebrw", (fact) =>
        usableBand(fact, "class_profile.sat_ebrw", 200, 800),
      ) ||
      anyUsable("class_profile.sat_ebrw_avg", (fact) =>
        usableScalar(fact, "class_profile.sat_ebrw_avg", 200, 800),
      ) ||
      anyUsable("class_profile.sat_ebrw_distribution", (fact) =>
        usableDistribution(
          fact,
          "class_profile.sat_ebrw_distribution",
          "sat_ebrw",
        ),
      )
    )
  )
    missing.push("usable SAT Math and EBRW data");
  if (!(
    anyUsable("class_profile.act_composite", (fact) =>
      usableBand(fact, "class_profile.act_composite", 1, 36),
    ) ||
    anyUsable("class_profile.act_composite_avg", (fact) =>
      usableScalar(fact, "class_profile.act_composite_avg", 1, 36),
    ) ||
    anyUsable("class_profile.act_composite_distribution", (fact) =>
      usableDistribution(
        fact,
        "class_profile.act_composite_distribution",
        "act_composite",
      ),
    )
  ))
    missing.push("usable ACT composite data");
  return missing;
}

async function preconditionFailures(
  request: APIRequestContext,
): Promise<string[]> {
  const failures: string[] = [];
  if (!UNITID || !/^\d+$/.test(UNITID)) {
    failures.push("REAL_SCHOOL_UNITID is unset or is not a numeric UNITID");
  }
  try {
    const response = await request.get(`${API_URL}/v1/me`, { timeout: 3_000 });
    if (response.status() === 401) {
      failures.push(
        "authenticated storage state is expired or rejected by /v1/me; refresh playwright/.auth/local.json with an approved local login",
      );
    } else if (!response.ok()) {
      failures.push(
        `authenticated identity probe at ${API_URL}/v1/me returned HTTP ${response.status()}`,
      );
    }
  } catch {
    failures.push(
      `authenticated identity probe at ${API_URL}/v1/me failed; storage state may be invalid`,
    );
  }
  try {
    if (UNITID && /^\d+$/.test(UNITID)) {
      const response = await request.get(factsUrl(UNITID), { timeout: 5_000 });
      if (response.status() === 401) {
        failures.push(
          "authenticated school-facts probe returned HTTP 401; the saved session is expired",
        );
      } else if (!response.ok()) {
        failures.push(
          `school facts at ${factsUrl(UNITID)} returned HTTP ${response.status()}`,
        );
      } else {
        const missing = usableAcademicData(await response.json());
        if (missing.length)
          failures.push(`school ${UNITID} lacks ${missing.join(", ")}`);
      }
    }
  } catch {
    failures.push(
      `school facts are unreachable at ${factsUrl(UNITID ?? "<UNITID>")}`,
    );
  }
  try {
    await fs.access(AUTH_STATE);
  } catch {
    failures.push(
      `authenticated storage state is missing at ${AUTH_STATE}; create it with an approved local login before running the real gate`,
    );
  }
  try {
    const response = await request.get(`${API_URL}/v1/health`, {
      timeout: 3_000,
    });
    if (!response.ok())
      failures.push(
        `API health at ${API_URL}/v1/health returned HTTP ${response.status()}`,
      );
  } catch {
    failures.push(
      `API is unreachable at ${API_URL}; start the local API on :8000`,
    );
  }
  try {
    const response = await request.get(`${VITE_URL}/login`, { timeout: 3_000 });
    if (!response.ok())
      failures.push(`Vite at ${VITE_URL} returned HTTP ${response.status()}`);
  } catch {
    failures.push(
      `Vite is unreachable at ${VITE_URL}; start it on the fixed Playwright port`,
    );
  }
  return failures;
}

test.describe("School Chances authenticated gate", () => {
  test.beforeAll(async ({ request }) => {
    const failures = await preconditionFailures(request);
    if (failures.length) {
      const reason = `REAL school-chances test skipped: ${failures.join("; ")}`;
      console.error(reason);
      test.skip(true, reason);
    }
  });

  test("renders the authenticated school comparison at every target width", async ({
    page,
  }, testInfo) => {
    if (!UNITID)
      throw new Error(
        "REAL_SCHOOL_UNITID was unexpectedly unavailable after preflight",
      );
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const response = await page.goto(`/app/schools/${UNITID}?tab=chances`, {
      waitUntil: "networkidle",
    });
    expect(
      response?.ok(),
      "Authenticated school route did not return a successful document",
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "How your academics compare" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("tab", { name: "Compare" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect
      .poll(() => pageErrors.map((error) => error.message))
      .toEqual([]);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(
        testInfo.outputDir,
        `school-chances-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  });
});
