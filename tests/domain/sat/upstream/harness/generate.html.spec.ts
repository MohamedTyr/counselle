// Generates vectors/html_transforms.json — plan §8.2 "html transforms"
// suite: `preprocessSatHtml` (the lifted RichContent.tsx pipeline, patch
// hunk 2) over every distinct HTML field (stem, stimulus, rationale,
// answer-option content) in the research corpus, pre-sanitise string
// output. Re-run over the full bank later with SAT_RESEARCH_DIR (see
// README.md).
import { describe, expect, it } from "vitest";
import { preprocessSatHtml } from "@/components/RichContent";
import { listJsonFiles, readJson } from "./lib/research";
import { writeVector } from "./lib/write-vector";

interface HtmlCase {
  source: string;
  field: string;
  input: string;
  output: string;
}

function pushIfHtml(cases: HtmlCase[], source: string, field: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    cases.push({ source, field, input: value, output: preprocessSatHtml(value) });
  }
}

describe("html transform vectors", () => {
  it("generates preprocessSatHtml vectors over every distinct HTML field in the research corpus", () => {
    const cases: HtmlCase[] = [];

    for (const file of [...listJsonFiles("spr_sample"), ...listJsonFiles("rw_sample")]) {
      const sample = readJson<Record<string, unknown>>(file);
      pushIfHtml(cases, file, "stem", sample.stem);
      pushIfHtml(cases, file, "stimulus", sample.stimulus);
      pushIfHtml(cases, file, "rationale", sample.rationale);
      const options = sample.answerOptions;
      if (Array.isArray(options)) {
        options.forEach((opt, i) => {
          if (opt && typeof opt === "object") pushIfHtml(cases, file, `answerOptions[${i}].content`, (opt as Record<string, unknown>).content);
        });
      }
    }

    for (const file of listJsonFiles("detail")) {
      const base = file.split("/").pop() ?? file;
      if (base.startsWith("ibn_")) {
        const entryList = readJson<Array<Record<string, unknown>>>(file);
        const entry = entryList[0];
        pushIfHtml(cases, file, "prompt", entry.prompt);
        const answer = entry.answer as Record<string, unknown> | undefined;
        if (answer) {
          pushIfHtml(cases, file, "answer.rationale", answer.rationale);
          const choices = answer.choices;
          if (choices && typeof choices === "object") {
            for (const [key, choice] of Object.entries(choices as Record<string, unknown>)) {
              if (choice && typeof choice === "object") pushIfHtml(cases, file, `answer.choices.${key}.body`, (choice as Record<string, unknown>).body);
            }
          }
        }
        continue;
      }
      const detail = readJson<Record<string, unknown>>(file);
      pushIfHtml(cases, file, "stem", detail.stem);
      pushIfHtml(cases, file, "stimulus", detail.stimulus);
      pushIfHtml(cases, file, "rationale", detail.rationale);
      const options = detail.answerOptions;
      if (Array.isArray(options)) {
        options.forEach((opt, i) => {
          if (opt && typeof opt === "object") pushIfHtml(cases, file, `answerOptions[${i}].content`, (opt as Record<string, unknown>).content);
        });
      }
    }

    for (const file of listJsonFiles("disclosed_sample")) {
      const entryList = readJson<Array<Record<string, unknown>>>(file);
      const entry = entryList[0];
      pushIfHtml(cases, file, "prompt", entry.prompt);
      pushIfHtml(cases, file, "body", entry.body);
      const answer = entry.answer as Record<string, unknown> | undefined;
      if (answer) {
        pushIfHtml(cases, file, "answer.rationale", answer.rationale);
        const choices = answer.choices;
        if (choices && typeof choices === "object") {
          for (const [key, choice] of Object.entries(choices as Record<string, unknown>)) {
            if (choice && typeof choice === "object") pushIfHtml(cases, file, `answer.choices.${key}.body`, (choice as Record<string, unknown>).body);
          }
        }
      }
    }

    const result = writeVector("html_transforms", cases);
    // eslint-disable-next-line no-console
    console.log(`wrote ${result.path} (${result.count} cases, gzipped=${result.gzipped})`);
    expect(result.count).toBeGreaterThan(0);
  });
});
