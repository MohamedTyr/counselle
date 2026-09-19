// Generates vectors/spr_extraction.json — plan §8.2 "spr extraction" suite:
// `extractSprAnswerFromRationale` over every SPR rationale in the research
// corpus. Re-run over the full bank later with SAT_RESEARCH_DIR pointing at
// a directory holding every SPR item's rationale HTML (see README.md).
import { describe, expect, it } from "vitest";
import { extractSprAnswerFromRationale } from "@/db";
import { listJsonFiles, readJson } from "./lib/research";
import { writeVector } from "./lib/write-vector";

interface SprCase {
  source: string;
  rationale: string;
  extracted: string[];
}

describe("spr extraction vectors", () => {
  it("generates extractSprAnswerFromRationale vectors over every sample SPR rationale", () => {
    const cases: SprCase[] = [];

    for (const file of listJsonFiles("spr_sample")) {
      const sample = readJson<{ type: string; rationale: string }>(file);
      if (sample.type !== "spr") continue;
      cases.push({
        source: file,
        rationale: sample.rationale,
        extracted: extractSprAnswerFromRationale(sample.rationale),
      });
    }

    for (const file of listJsonFiles("detail")) {
      const base = file.split("/").pop() ?? file;
      if (!base.includes("spr")) continue;
      const detail = readJson<{ type: string; rationale: string }>(file);
      cases.push({
        source: file,
        rationale: detail.rationale,
        extracted: extractSprAnswerFromRationale(detail.rationale),
      });
    }

    for (const file of listJsonFiles("disclosed_sample")) {
      const entryList = readJson<Array<{ answer?: { style?: string; rationale?: string } }>>(file);
      const entry = entryList[0];
      if (!entry.answer || entry.answer.style?.toUpperCase() !== "SPR") continue;
      const rationale = entry.answer.rationale ?? "";
      cases.push({
        source: file,
        rationale,
        extracted: extractSprAnswerFromRationale(rationale),
      });
    }

    const result = writeVector("spr_extraction", cases);
    // eslint-disable-next-line no-console
    console.log(`wrote ${result.path} (${result.count} cases, gzipped=${result.gzipped})`);
    expect(result.count).toBeGreaterThan(0);
  });
});
