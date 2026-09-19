// Generates vectors/normalize.json — plan §8.2 "normalisation (G9)" suite.
// Narrow by design (plan §3.6 G9 / DIFFERENCES.md): the harness wrapper
// (lib/wrapper.ts) merges raw stub + detail research pairs and decides
// `module` and option lettering itself — that is NOT compared. What's
// compared is what `normalizeQuestion` (unmodified upstream, patched only
// with `export`) itself decides: the `type` discriminator, the
// stimulus/stem splice, the disclosed body/prompt combination, and the
// reject rules.
//
// Re-run over the full bank later with SAT_RESEARCH_DIR pointing at the raw
// stub (list/) + detail/ directories for the full corpus (see README.md).
import { describe, expect, it } from "vitest";
import { normalizeQuestion } from "@/db";
import { buildCommunityDumpItem, buildDisclosedDumpItem, type RawDetail, type RawStub } from "./lib/wrapper";
import { listJsonFiles, readJson } from "./lib/research";
import { writeVector } from "./lib/write-vector";

interface ListStub {
  questionId: string;
  uId: string;
  primary_class_cd: string;
  skill_cd: string;
  score_band_range_cd: number;
  difficulty?: string;
  createDate?: number;
  updateDate?: number;
  ibn: string | null;
  external_id: string | null;
}

function loadAllStubs(): ListStub[] {
  return listJsonFiles("list").flatMap((f) => readJson<ListStub[]>(f));
}

function firstStubByExternalId(stubs: ListStub[], externalId8: string): ListStub | undefined {
  return stubs.find((s) => (s.external_id ?? "").startsWith(externalId8));
}

function firstStubByIbn(stubs: ListStub[], ibn: string): ListStub | undefined {
  return stubs.find((s) => s.ibn === ibn);
}

interface NormalizeCase {
  pairId: string;
  kind: "community" | "disclosed";
  wrapped: unknown;
  normalized: unknown;
}

describe("normalisation (G9) vectors", () => {
  it("generates normalizeQuestion vectors over the sample stub+detail pairs", () => {
    const stubs = loadAllStubs();
    const cases: NormalizeCase[] = [];

    // --- Non-disclosed community-dump detail samples ---
    const detailFiles = listJsonFiles("detail");
    for (const file of detailFiles) {
      const base = file.split("/").pop() ?? file;
      if (base.startsWith("ibn_")) continue; // handled with the disclosed pairs below
      const detail = readJson<RawDetail & { externalid: string }>(file);
      const stub = firstStubByExternalId(stubs, detail.externalid.slice(0, 8));
      if (!stub) {
        throw new Error(`no matching stub for detail sample ${file} (externalid ${detail.externalid})`);
      }
      const wrapped = buildCommunityDumpItem(stub as RawStub, detail);
      cases.push({
        pairId: base,
        kind: "community",
        wrapped,
        normalized: normalizeQuestion(wrapped),
      });
    }

    // --- ibn (live bluebook) detail sample: same disclosed dispatch shape ---
    for (const file of detailFiles) {
      const base = file.split("/").pop() ?? file;
      if (!base.startsWith("ibn_")) continue;
      const ibn = base.replace(/^ibn_/, "").replace(/\.json$/, "");
      const detail = readJson<unknown[]>(file);
      const stub = firstStubByIbn(stubs, ibn);
      if (!stub) throw new Error(`no matching stub for ibn sample ${file}`);
      const wrapped = buildDisclosedDumpItem(stub as RawStub, detail[0]);
      cases.push({
        pairId: base,
        kind: "disclosed",
        wrapped,
        normalized: normalizeQuestion(wrapped),
      });
    }

    // --- Disclosed (released test) samples ---
    const disclosedFiles = listJsonFiles("disclosed_sample");
    for (const file of disclosedFiles) {
      const base = file.split("/").pop() ?? file;
      const entryList = readJson<Array<{ item_id: string }>>(file);
      const entry = entryList[0];
      const stub = firstStubByIbn(stubs, entry.item_id);
      if (!stub) {
        // Not every disclosed sample necessarily has a stub in this small
        // research corpus; record it against a synthesized minimal stub so
        // the normaliser vector still exists (module/domain fields it reads
        // are stub-derived and out of G9 scope anyway).
        const synthStub: RawStub = {
          questionId: entry.item_id,
          uId: entry.item_id,
          primary_class_cd: "H",
          skill_cd: "H.A.",
          score_band_range_cd: 3,
        };
        const wrapped = buildDisclosedDumpItem(synthStub, entry);
        cases.push({ pairId: base, kind: "disclosed", wrapped, normalized: normalizeQuestion(wrapped) });
        continue;
      }
      const wrapped = buildDisclosedDumpItem(stub as RawStub, entry);
      cases.push({ pairId: base, kind: "disclosed", wrapped, normalized: normalizeQuestion(wrapped) });
    }

    // --- Reject-rule cases: malformed input normalizeQuestion must reject ---
    const rejectCases: Array<[string, unknown]> = [
      ["empty_stem", { questionId: "q1", type: "spr", stem: "", correct_answer: ["1"] }],
      ["missing_question_id", { type: "spr", stem: "x", correct_answer: ["1"] }],
      ["mcq_no_options", { questionId: "q2", type: "mcq", stem: "x", correct_answer: ["A"] }],
      ["mcq_no_correct_answer", { questionId: "q3", type: "mcq", stem: "x", answerOptions: [{ id: "A", content: "a" }] }],
      ["not_a_record", "just a string"],
      ["null_value", null],
    ];
    for (const [pairId, wrapped] of rejectCases) {
      cases.push({ pairId, kind: "community", wrapped, normalized: normalizeQuestion(wrapped) });
    }

    const result = writeVector("normalize", cases);
    // eslint-disable-next-line no-console
    console.log(`wrote ${result.path} (${result.count} cases, gzipped=${result.gzipped})`);
    expect(result.count).toBeGreaterThan(0);
  });
});
