// Generates vectors/stats.json — plan §8.2 "stats" suite: 300 generated
// attempt logs (seeded PRNG) through `getUserStatistics()`, matching the
// plan's coverage table: 0-2,000 attempts; re-attempts; solvedAt ties;
// streak gaps; all 29 skills plus unknown/empty domain & skill codes and
// out-of-range bands (S17-S19); skills first seen on a non-first attempt
// (S18); <8 skills with data (S9); frozen clock away from DST dates;
// half-way rounding cases.
//
// TZ is pinned to a DST-observing zone so "frozen clock away from DST
// dates" is meaningful and reproducible (see README.md).
process.env.TZ = "America/New_York";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserStatistics, formatDateKey } from "@/db";
import { domainMap, topicCodes, topicTree } from "@/components/TopicTree";
import type { AttemptRecord } from "@/types/questions";
import { resetProgressDb, seedAttempts } from "./lib/dexie-helpers";
import { mulberry32, pick, pickInt } from "./lib/prng";
import { writeVector } from "./lib/write-vector";

const SEED = 20260919;

const DOMAIN_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(domainMap).map(([code, name]) => [name, code]),
);

interface SkillInfo {
  code: string;
  domainCode: string;
  module: "math" | "reading";
}

const ALL_SKILLS: SkillInfo[] = Object.entries(topicTree).flatMap(([moduleKey, domains]) =>
  Object.entries(domains as Record<string, string[]>).flatMap(([domainName, skillNames]) =>
    skillNames.map((name) => ({
      code: topicCodes[name],
      domainCode: DOMAIN_NAME_TO_CODE[domainName],
      module: moduleKey as "math" | "reading",
    })),
  ),
);

// Frozen "today" dates spanning both sides of US DST transitions, but never
// on the transition day itself (plan: "the vectors avoid transition dates" —
// S21/streak is intentionally adapted away from upstream's fixed-step bug).
const FROZEN_TODAYS = [
  "2026-01-15T12:00:00", // deep winter, no DST
  "2026-03-07T12:00:00", // just before spring-forward (2026-03-08 in the US)
  "2026-03-10T12:00:00", // just after spring-forward
  "2026-07-04T12:00:00", // deep summer DST
  "2026-10-29T12:00:00", // just before fall-back (2026-11-01)
  "2026-11-03T12:00:00", // just after fall-back
];

function localDateKey(date: Date): string {
  return formatDateKey(date);
}

function randomAttempt(
  rand: () => number,
  questionId: string,
  skill: SkillInfo,
  solvedAt: number,
  band: number,
): AttemptRecord {
  const isCorrect = rand() < 0.6;
  return {
    questionId,
    module: skill.module,
    primary_class_cd: skill.domainCode,
    skill_cd: skill.code,
    score_band_range_cd: band,
    userAnswer: isCorrect ? "correct" : "wrong",
    isCorrect,
    timeSpentSeconds: pickInt(rand, 15, 130),
    solvedAt,
    dateKey: localDateKey(new Date(solvedAt)),
  };
}

interface Scenario {
  label: string;
  build: (rand: () => number, today: Date) => AttemptRecord[];
}

function baselineScenario(rand: () => number, today: Date): AttemptRecord[] {
  const size = Math.floor(2000 ** rand());
  const attempts: AttemptRecord[] = [];
  const dayMs = 86_400_000;
  for (let i = 0; i < size; i++) {
    const skill = pick(rand, ALL_SKILLS);
    const daysAgo = pickInt(rand, 0, 60);
    const solvedAt = today.getTime() - daysAgo * dayMs + pickInt(rand, 0, dayMs - 1);
    const questionId = `q-${skill.code}-${pickInt(rand, 0, Math.max(1, Math.floor(size / 3)))}`;
    attempts.push(randomAttempt(rand, questionId, skill, solvedAt, pickInt(rand, 1, 7)));
  }
  return attempts;
}

function unknownDomainSkillScenario(rand: () => number, today: Date): AttemptRecord[] {
  const attempts: AttemptRecord[] = [];
  const dayMs = 86_400_000;
  const variants: Array<[string, string]> = [
    ["ZZZ", "ZZZ.X."], // unknown domain + unknown skill
    ["", ""], // empty domain + empty skill (S17/S18 empty-code case)
    ["INI", ""], // known domain, empty skill
    ["", "H.A."], // empty domain, known skill
  ];
  for (const [domainCode, skillCode] of variants) {
    for (let i = 0; i < pickInt(rand, 3, 15); i++) {
      const solvedAt = today.getTime() - pickInt(rand, 0, 30) * dayMs;
      attempts.push({
        questionId: `q-unknown-${domainCode || "empty"}-${skillCode || "empty"}-${i}`,
        module: rand() < 0.5 ? "math" : "reading",
        primary_class_cd: domainCode,
        skill_cd: skillCode,
        score_band_range_cd: pickInt(rand, 1, 7),
        userAnswer: "x",
        isCorrect: rand() < 0.5,
        timeSpentSeconds: pickInt(rand, 15, 130),
        solvedAt,
        dateKey: localDateKey(new Date(solvedAt)),
      });
    }
  }
  return attempts;
}

function outOfRangeBandScenario(rand: () => number, today: Date): AttemptRecord[] {
  const attempts: AttemptRecord[] = [];
  const bands = [0, -1, 8, 99, 1, 4, 7];
  for (const band of bands) {
    const skill = pick(rand, ALL_SKILLS);
    const solvedAt = today.getTime() - pickInt(rand, 0, 10) * 86_400_000;
    attempts.push(randomAttempt(rand, `q-band-${band}`, skill, solvedAt, band));
  }
  return attempts;
}

function skillDriftScenario(rand: () => number, today: Date): AttemptRecord[] {
  // A question's skill_cd changes between attempts (the question's *current*
  // skill at each submit), so the second skill is "first seen" on a
  // non-first attempt for that question (S18).
  const attempts: AttemptRecord[] = [];
  const dayMs = 86_400_000;
  for (let i = 0; i < pickInt(rand, 2, 6); i++) {
    const [skillA, skillB] = [pick(rand, ALL_SKILLS), pick(rand, ALL_SKILLS)];
    const questionId = `q-drift-${i}`;
    const firstAt = today.getTime() - pickInt(rand, 5, 20) * dayMs;
    const secondAt = firstAt + pickInt(rand, 1, 3) * dayMs;
    attempts.push(randomAttempt(rand, questionId, skillA, firstAt, pickInt(rand, 1, 7)));
    attempts.push(randomAttempt(rand, questionId, skillB, secondAt, pickInt(rand, 1, 7)));
  }
  return attempts;
}

function fewSkillsScenario(rand: () => number, today: Date): AttemptRecord[] {
  const skills = ALL_SKILLS.slice(0, pickInt(rand, 1, 7));
  const attempts: AttemptRecord[] = [];
  const dayMs = 86_400_000;
  for (const skill of skills) {
    for (let i = 0; i < pickInt(rand, 1, 10); i++) {
      const solvedAt = today.getTime() - pickInt(rand, 0, 20) * dayMs;
      attempts.push(randomAttempt(rand, `q-few-${skill.code}-${i}`, skill, solvedAt, pickInt(rand, 1, 7)));
    }
  }
  return attempts;
}

function streakAndTieScenario(rand: () => number, today: Date): AttemptRecord[] {
  const attempts: AttemptRecord[] = [];
  const dayMs = 86_400_000;
  // A run of consecutive days (streak), then a gap, then one more day.
  const streakLen = pickInt(rand, 2, 6);
  for (let d = 0; d < streakLen; d++) {
    const skill = pick(rand, ALL_SKILLS);
    const dayStart = today.getTime() - d * dayMs;
    // Two attempts at the exact same solvedAt (tie) to exercise (solved_at, id) ordering.
    const tieTs = dayStart - pickInt(rand, 0, dayMs / 2);
    attempts.push(randomAttempt(rand, `q-streak-${d}-a`, skill, tieTs, pickInt(rand, 1, 7)));
    attempts.push(randomAttempt(rand, `q-streak-${d}-b`, skill, tieTs, pickInt(rand, 1, 7)));
  }
  // gap of several days, then one attempt further back to test streak reset.
  const gapDays = streakLen + pickInt(rand, 3, 8);
  const skill = pick(rand, ALL_SKILLS);
  attempts.push(randomAttempt(rand, "q-streak-gap", skill, today.getTime() - gapDays * dayMs, pickInt(rand, 1, 7)));
  return attempts;
}

function halfwayRoundingScenario(rand: () => number, today: Date): AttemptRecord[] {
  // Counts chosen so accuracy/average lands exactly on a .5 boundary
  // (JS Math.round half-up vs Python round-half-to-even, plan §4.4).
  const attempts: AttemptRecord[] = [];
  const dayMs = 86_400_000;
  const skill = pick(rand, ALL_SKILLS);
  // 1 correct of 8 => 12.5%; 1 correct of 2 => 50%; 3 of 8 => 37.5%.
  const totals = pick(rand, [2, 4, 8]);
  const correctCount = Math.max(1, Math.floor(totals / 2) - 1);
  for (let i = 0; i < totals; i++) {
    const solvedAt = today.getTime() - i * dayMs;
    const isCorrect = i < correctCount;
    attempts.push({
      questionId: `q-halfway-${i}`,
      module: skill.module,
      primary_class_cd: skill.domainCode,
      skill_cd: skill.code,
      score_band_range_cd: pickInt(rand, 1, 7),
      userAnswer: isCorrect ? "correct" : "wrong",
      isCorrect,
      // Odd seconds so avgTime also lands on a .5 boundary sometimes.
      timeSpentSeconds: 15 + (i % 2),
      solvedAt,
      dateKey: localDateKey(new Date(solvedAt)),
    });
  }
  return attempts;
}

function emptyScenario(): AttemptRecord[] {
  return [];
}

const SCENARIOS: Scenario[] = [
  { label: "baseline", build: baselineScenario },
  { label: "unknown_domain_skill", build: unknownDomainSkillScenario },
  { label: "out_of_range_band", build: outOfRangeBandScenario },
  { label: "skill_drift_non_first_attempt", build: skillDriftScenario },
  { label: "few_skills_with_data", build: fewSkillsScenario },
  { label: "streak_and_ties", build: streakAndTieScenario },
  { label: "halfway_rounding", build: halfwayRoundingScenario },
  { label: "empty", build: emptyScenario },
];

interface StatsCase {
  index: number;
  scenario: string;
  today: string;
  attemptCount: number;
  attempts: AttemptRecord[];
  stats: unknown;
}

describe("stats vectors", () => {
  beforeEach(() => {
    // Fake only Date — faking setTimeout/queueMicrotask deadlocks
    // fake-indexeddb's internal transaction scheduling (it relies on real
    // timers to flush).
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await resetProgressDb();
  });

  it("generates 300 getUserStatistics vectors over seeded logs", async () => {
    const rand = mulberry32(SEED);
    const cases: StatsCase[] = [];
    const TOTAL = 300;

    for (let i = 0; i < TOTAL; i++) {
      const scenario = SCENARIOS[i % SCENARIOS.length];
      const today = new Date(FROZEN_TODAYS[i % FROZEN_TODAYS.length]);

      await resetProgressDb();
      const attempts = scenario.build(rand, today);
      await seedAttempts(attempts);

      vi.setSystemTime(today);
      const stats = await getUserStatistics();

      cases.push({
        index: i,
        scenario: scenario.label,
        today: today.toISOString(),
        attemptCount: attempts.length,
        attempts,
        stats,
      });
    }

    const result = writeVector("stats", cases);
    // eslint-disable-next-line no-console
    console.log(`wrote ${result.path} (${result.count} cases, gzipped=${result.gzipped})`);
    expect(result.count).toBe(TOTAL);
  }, 300_000);
});
