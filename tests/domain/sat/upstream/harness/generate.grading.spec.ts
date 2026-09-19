// Generates vectors/grading.json — plan §8.2 "grading" suite + the O7
// hand-derived cases (plan §4.3). Covers every SPR item in
// artifacts/sat-practice/research/spr_sample (and the SPR detail sample) x
// {each key, leading-zero variants, fraction<->decimal, near-misses at 1e-5
// and 1e-7, junk}, and every mcq sample x A-D.
//
// Re-run over the full bank later with SAT_RESEARCH_DIR=<raw bank dir>
// pointing at a directory with the same spr_sample/rw_sample/disclosed_sample
// layout (see README.md).
import { describe, expect, it } from "vitest";
import { checkIsCorrect } from "@/pages/Practice";
import type { SatQuestion } from "@/types/questions";
import { listJsonFiles, readJson } from "./lib/research";
import { writeVector } from "./lib/write-vector";
import { acceptsUnderO7, fraction, roundHalfAwayFromZero, truncateToward } from "./lib/o7";

interface SprSample {
  type: "spr";
  correct_answer: string[];
}

interface McqSample {
  type: "mcq";
  correct_answer: string[];
}

function minimalSpr(correctAnswer: string[]): SatQuestion {
  return {
    questionId: "x",
    skill_cd: "x",
    score_band_range_cd: 3,
    module: "math",
    type: "spr",
    stimulus: null,
    stem: "",
    answerOptions: [],
    correct_answer: correctAnswer,
    rationale: "",
  };
}

function minimalMcq(correctAnswer: string[]): SatQuestion {
  return { ...minimalSpr(correctAnswer), type: "mcq" };
}

interface GradingCase {
  suiteCase: string;
  variant: string;
  question_type: "mcq" | "spr";
  correct_answer: string[];
  answer: string;
  expected: boolean;
}

function addLeadingZero(key: string): string | null {
  if (/^-?\.\d+$/.test(key)) {
    return key.startsWith("-") ? "-0" + key.slice(1) : "0" + key;
  }
  return null;
}

function removeLeadingZero(key: string): string | null {
  if (/^-?0\.\d+$/.test(key)) {
    return key.startsWith("-") ? "-" + key.slice(2) : key.slice(1);
  }
  return null;
}

function nearMiss(key: string, delta: number): string | null {
  const n = Number(key.includes("/") ? evalFraction(key) : key);
  if (!Number.isFinite(n)) return null;
  return (n + delta).toString();
}

function evalFraction(key: string): number {
  const [n, d] = key.split("/").map(Number);
  return n / d;
}

function fractionToDecimal(key: string): string | null {
  if (!key.includes("/")) return null;
  const [n, d] = key.split("/").map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return (n / d).toFixed(9);
}

describe("grading vectors", () => {
  it("generates SPR + MCQ + O7 grading vectors", () => {
    const cases: GradingCase[] = [];

    const sprFiles = listJsonFiles("spr_sample");
    for (const file of sprFiles) {
      const sample = readJson<SprSample>(file);
      const question = minimalSpr(sample.correct_answer);

      for (const key of sample.correct_answer) {
        cases.push({
          suiteCase: file,
          variant: "exact_key",
          question_type: "spr",
          correct_answer: sample.correct_answer,
          answer: key,
          expected: checkIsCorrect(question, key),
        });

        const added = addLeadingZero(key);
        if (added) {
          cases.push({
            suiteCase: file,
            variant: "leading_zero_add",
            question_type: "spr",
            correct_answer: sample.correct_answer,
            answer: added,
            expected: checkIsCorrect(question, added),
          });
        }

        const removed = removeLeadingZero(key);
        if (removed) {
          cases.push({
            suiteCase: file,
            variant: "leading_zero_remove",
            question_type: "spr",
            correct_answer: sample.correct_answer,
            answer: removed,
            expected: checkIsCorrect(question, removed),
          });
        }

        const asDecimal = fractionToDecimal(key);
        if (asDecimal) {
          cases.push({
            suiteCase: file,
            variant: "fraction_to_decimal",
            question_type: "spr",
            correct_answer: sample.correct_answer,
            answer: asDecimal,
            expected: checkIsCorrect(question, asDecimal),
          });
        }

        const miss5 = nearMiss(key, 1e-5);
        if (miss5) {
          cases.push({
            suiteCase: file,
            variant: "near_miss_1e-5",
            question_type: "spr",
            correct_answer: sample.correct_answer,
            answer: miss5,
            expected: checkIsCorrect(question, miss5),
          });
        }

        const miss7 = nearMiss(key, 1e-7);
        if (miss7) {
          cases.push({
            suiteCase: file,
            variant: "near_miss_1e-7",
            question_type: "spr",
            correct_answer: sample.correct_answer,
            answer: miss7,
            expected: checkIsCorrect(question, miss7),
          });
        }
      }

      cases.push({
        suiteCase: file,
        variant: "junk",
        question_type: "spr",
        correct_answer: sample.correct_answer,
        answer: "not-a-number",
        expected: checkIsCorrect(question, "not-a-number"),
      });
    }

    const mcqFiles = [...listJsonFiles("rw_sample")];
    const CHOICE_LABELS = ["A", "B", "C", "D"];
    for (const file of mcqFiles) {
      const sample = readJson<McqSample>(file);
      if (sample.type !== "mcq") continue;
      const question = minimalMcq(sample.correct_answer);
      for (const label of CHOICE_LABELS) {
        cases.push({
          suiteCase: file,
          variant: "mcq_label",
          question_type: "mcq",
          correct_answer: sample.correct_answer,
          answer: label,
          expected: checkIsCorrect(question, label),
        });
      }
    }

    // --- O7 hand-derived vectors (plan §4.3(d)) ---
    // College Board's own worked table for 2/3 (verbatim from the plan).
    const v23 = fraction(2, 3);
    const table23: Array<[string, boolean]> = [
      [".6666", true],
      [".6667", true],
      ["0.666", true],
      ["0.667", true],
      ["0.66", false],
      [".66", false],
      ["0.67", false],
      [".67", false],
    ];
    for (const [entry, expected] of table23) {
      const computed = acceptsUnderO7(v23, entry);
      cases.push({
        suiteCase: "o7-college-board-2-3-table",
        variant: "o7_table",
        question_type: "spr",
        correct_answer: ["2/3"],
        answer: entry,
        expected,
      });
      if (computed !== expected) {
        throw new Error(`O7 reference implementation disagrees with the college board 2/3 table at "${entry}"`);
      }
    }

    // Every fraction key found in the SPR samples x {both truncations, both
    // roundings, with/without leading zero, negative, one digit short, one
    // digit wrong}.
    const fractionKeys = new Set<string>();
    for (const file of sprFiles) {
      const sample = readJson<SprSample>(file);
      for (const key of sample.correct_answer) {
        if (/^-?\d+\/\d+$/.test(key)) fractionKeys.add(key);
      }
    }

    for (const key of fractionKeys) {
      const [nStr, dStr] = key.replace("-", "").split("/");
      const negative = key.startsWith("-");
      const n = Number(nStr) * (negative ? -1 : 1);
      const d = Number(dStr);
      if (d === 0) continue;
      const v = fraction(n, d);

      for (const places of [3, 4]) {
        let trunc: string;
        let rounded: string;
        try {
          trunc = truncateToward(v, places);
          rounded = roundHalfAwayFromZero(v, places);
        } catch {
          continue;
        }
        const variants: Array<[string, string]> = [
          ["truncate", trunc],
          ["round", rounded],
        ];
        for (const [kind, entry] of variants) {
          const withoutLeadingZero = entry.startsWith("-0.") ? "-" + entry.slice(2) : entry.startsWith("0.") ? entry.slice(1) : entry;
          for (const [variantName, candidate] of [
            [`o7_${kind}_with_zero`, entry],
            [`o7_${kind}_no_zero`, withoutLeadingZero],
          ] as const) {
            const expected = acceptsUnderO7(v, candidate);
            cases.push({
              suiteCase: `o7-${key}`,
              variant: variantName,
              question_type: "spr",
              correct_answer: [key],
              answer: candidate,
              expected,
            });
          }
        }

        // One digit short (fails the field-width rule).
        const short = trunc.slice(0, -1);
        cases.push({
          suiteCase: `o7-${key}`,
          variant: `o7_one_digit_short_${places}`,
          question_type: "spr",
          correct_answer: [key],
          answer: short,
          expected: acceptsUnderO7(v, short),
        });

        // One digit wrong (last digit off by one).
        const lastDigit = Number(trunc[trunc.length - 1]);
        const wrongDigit = (lastDigit + 1) % 10;
        const wrong = trunc.slice(0, -1) + wrongDigit.toString();
        cases.push({
          suiteCase: `o7-${key}`,
          variant: `o7_one_digit_wrong_${places}`,
          question_type: "spr",
          correct_answer: [key],
          answer: wrong,
          expected: acceptsUnderO7(v, wrong),
        });
      }
    }

    const result = writeVector("grading", cases);
    // eslint-disable-next-line no-console
    console.log(`wrote ${result.path} (${result.count} cases, gzipped=${result.gzipped})`);
    expect(result.count).toBeGreaterThan(0);
  });
});
