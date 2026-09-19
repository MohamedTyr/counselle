// The G9 harness wrapper (plan §3.6, G9): upstream's importer
// (`parseAndIngestJSON` -> `normalizeQuestion`) expects "community-dump" JSON
// that already carries plain fields and lettered options. Our own
// adapters/collegeboard pipeline (ported separately, not part of this
// harness) does that merge for the real bank. Here we reproduce only the
// merge step so raw stub+detail research samples can reach the *unmodified*
// upstream `normalizeQuestion` — what this function decides (module,
// per-letter ids) is therefore explicitly OUT of the G9 comparison scope;
// see DIFFERENCES.md.
const CHOICE_LABELS = ["A", "B", "C", "D"];
const MATH_DOMAINS = new Set(["H", "P", "Q", "S"]);

export interface RawStub {
  questionId: string;
  uId: string;
  primary_class_cd: string;
  skill_cd: string;
  score_band_range_cd: number;
  difficulty?: string;
  createDate?: number;
  updateDate?: number;
  ibn?: string | null;
  external_id?: string | null;
}

export interface RawDetailOption {
  id: string;
  content: string;
}

export interface RawDetail {
  type: "mcq" | "spr";
  stem: string;
  stimulus?: string | null;
  keys?: string[];
  answerOptions?: RawDetailOption[];
  rationale: string;
  correct_answer?: string[];
}

function moduleForDomain(domainCode: string): "math" | "reading" {
  return MATH_DOMAINS.has(domainCode) ? "math" : "reading";
}

/** Non-disclosed (community-dump-shaped) raw stub + detail pair. */
export function buildCommunityDumpItem(stub: RawStub, detail: RawDetail): Record<string, unknown> {
  const rawOptions = detail.answerOptions ?? [];
  const idByOriginal = new Map(rawOptions.map((opt, index) => [opt.id, CHOICE_LABELS[index] ?? opt.id.toUpperCase()]));
  const answerOptions = rawOptions.map((opt, index) => ({
    id: CHOICE_LABELS[index] ?? opt.id.toUpperCase(),
    content: opt.content,
  }));

  const correctAnswer =
    detail.type === "mcq"
      ? (detail.keys ?? []).map((k) => idByOriginal.get(k) ?? k.toUpperCase())
      : (detail.keys ?? detail.correct_answer ?? []);

  return {
    questionId: stub.questionId,
    uId: stub.uId,
    primary_class_cd: stub.primary_class_cd,
    skill_cd: stub.skill_cd,
    score_band_range_cd: stub.score_band_range_cd,
    difficulty: stub.difficulty,
    createDate: stub.createDate,
    updateDate: stub.updateDate,
    module: moduleForDomain(stub.primary_class_cd),
    type: detail.type,
    stem: detail.stem,
    stimulus: detail.stimulus ?? null,
    answerOptions,
    correct_answer: correctAnswer,
    rationale: detail.rationale,
  };
}

/**
 * Disclosed-shaped raw stub + detail pair (a released test's `_disclosed_data`,
 * or a live bluebook `ibn` lookup — both come back from College Board in the
 * same `[{item_id, section, prompt, body?, answer}]` shape).
 */
export function buildDisclosedDumpItem(stub: RawStub, disclosedEntry: unknown): Record<string, unknown> {
  return {
    _source: "disclosed",
    questionId: stub.questionId,
    uId: stub.uId,
    primary_class_cd: stub.primary_class_cd,
    skill_cd: stub.skill_cd,
    score_band_range_cd: stub.score_band_range_cd,
    difficulty: stub.difficulty,
    createDate: stub.createDate,
    updateDate: stub.updateDate,
    module: moduleForDomain(stub.primary_class_cd),
    _disclosed_data: [disclosedEntry],
  };
}
