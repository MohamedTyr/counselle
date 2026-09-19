# What the differential vectors do not compare, and why

Plan §3.6's G9 gate is deliberately narrow: the harness proves our port
agrees with upstream on the pieces that are genuinely ambiguous or
error-prone to re-derive from a spec description, and leaves out everything
that either isn't part of "the product" liprep users experience, or is
already pinned down elsewhere (the DB schema, `SatQuestion`'s own pydantic
validation, an explicit plan decision). This file is the complete list for
`domain/sat/normalize.py` and `domain/sat/spr_answers.py`; a difference for
`domain/sat/grading.py`, `domain/sat/stats.py` or the progress-file codec
belongs in their own owners' notes, not here.

## Normalisation (`normalize.py` vs. upstream's `normalizeQuestion` /
`normalizeDisclosedQuestion`, `db.ts`)

### Out of scope because the harness wrapper decides it, not upstream

`tests/domain/sat/upstream/harness/lib/wrapper.ts` merges each raw
stub+detail research pair into the "community dump" shape upstream's
importer expects, **before** calling `normalizeQuestion`. Two decisions
happen entirely in that wrapper and are therefore never exercised by the
vectors at all:

- **`module`.** The wrapper derives it from the stub's domain code
  (`MATH_DOMAINS = {H, P, Q, S}`). Production has no such wrapper: this port
  derives `module` from a `test` id (1 → reading, 2 → math, the actual E1
  request parameter — plan §3.1) or an already-resolved `module` key on the
  stub, whichever the caller provides (`normalize.py::_module_from_stub`).
- **Option lettering.** The wrapper pre-letters `answerOptions` (`A`–`D` by
  array position) before upstream ever sees them, so upstream's own
  `normalizeOptions` — which reads whatever `id` a community dump happens to
  carry (a letter, a UUID, anything) — is never exercised against a raw
  UUID-keyed option list by these vectors. This port letters by position
  itself (Q17), independently of what `id` the raw option carried.

Both are still implemented for real, correctly as far as manual sampling
against `artifacts/sat-practice/research/` shows (`tests/domain/sat/
test_normalize.py`'s direct tests, not the G9 vectors, cover them) — they
are just not part of what "matches upstream" means here, because upstream
never makes these decisions the way our production pipeline has to.

### Out of scope because the plan explicitly overrides upstream's behaviour

- **Reject rules: raise vs. silent `null`.** Upstream's `normalizeQuestion`
  returns `null` for every shape it can't handle (no id, no stem, an mcq
  without options or a correct answer) and the caller silently drops it.
  This port raises `NormalizeError` naming the id instead (plan §3.3:
  "nothing is dropped silently") — the vectors' six reject cases
  (`empty_stem`, `missing_question_id`, `mcq_no_options`,
  `mcq_no_correct_answer`, `not_a_record`, `null_value`) are asserted
  directly in `test_normalize.py` against `NormalizeError`, not against
  upstream's `null`.
- **A free-response key of `"0"`.** Upstream's `normalizeQuestion` treats an
  all-`"0"` `correct_answer` as "missing" and falls back to
  `extractSprAnswerFromRationale`, because community dumps use `"0"` as
  filler for an unknown key. A real College Board `correct_answer` of
  `["0"]` is a genuine answer (plan §3.3) — this port keeps it verbatim and
  never substitutes a rationale-derived guess for an official key. This is
  the plan's own stated deliberate difference, not an oversight.
- **G4's mcq shape (exactly 4 options, exactly one correct letter, and the
  `keys[0]`-position cross-check) is enforced as a hard reject here.**
  Upstream has no equivalent of the `keys[0]` cross-check at all (it never
  sees the raw `keys` array — only the wrapper-lettered `correct_answer`).
  Any adjudicated exception to "exactly 4 options" (plan §3.6 G4: "the list
  must be empty or each adjudicated") lives in `AUDIT.md`'s allow-list at
  the `build` layer, not in this function — `normalize_qbank`/
  `normalize_disclosed` themselves never special-case an id.
- **The array branch of `normalizeOptions` (qbank `answerOptions`).**
  Upstream's array branch (`db.ts`, used for both the qbank and disclosed
  paths) drops a raw option whose content is empty; this port's qbank
  equivalent (`_qbank_answer_options`) keeps it — a real detail with an
  empty-content option among its 4 raw options would normalize to 4
  options here but 3 upstream. In practice this is masked by G4's own
  "exactly 4 options" reject, which fails that same detail anyway (just
  for the wrong reason: our count matches, upstream's does not).

### Out of scope because it's a separate, already-decided concern

- **Renamed fields.** Upstream's `SatQuestion` type uses
  `primary_class_cd`/`score_band_range_cd`/`createDate`/`updateDate`/
  `correct_answer` (singular); this repo's `SatQuestion`
  (`domain/sat/types.py`) uses `domain_cd`/`score_band`/`cb_created_at`/
  `cb_updated_at`/`correct_answers` (plural). A field rename carries no
  behaviour to differentially test.
- **`difficulty`: words vs. codes.** Upstream converts the stub's `E`/`M`/`H`
  code to `"Easy"`/`"Medium"`/`"Hard"` (and derives it from the score band
  when absent, via `getDifficultyTierFromScoreBand`). This port keeps the
  single-letter code the real E1 stub already carries
  (`SatQuestion.difficulty: Literal["E", "M", "H"]`) and raises rather than
  deriving one from the band when it's missing or malformed — a difficulty
  that has to be guessed from the band is a data problem to surface, not
  paper over.
- **The score-band clamp.** Upstream clamps `score_band_range_cd` to
  `[1, 7]` with `Math.min(7, Math.max(1, …))` rather than reject an
  out-of-range value. `SatQuestion.score_band` is a pydantic
  `Field(ge=1, le=7)` — an out-of-range band raises (wrapped as
  `NormalizeError`) instead of being silently coerced into range.
- **The id fallback chain.** Upstream's `questionId` resolution tries
  `value.questionId || value.uId || baseContent.questionId ||
  baseContent.uId || value.id` — five fallbacks, because a community dump's
  shape is unpredictable. Our own fetch pipeline controls the exact E1 stub
  shape, so `normalize_qbank`/`normalize_disclosed` read `questionId`
  (and, separately, `uId`) directly and raise if either is absent, rather
  than guessing from a pile of alternatives.
- **SPR keys (§3.5).** Upstream folds `extractSprAnswerFromRationale`'s
  output directly into `correct_answer` inside `normalizeQuestion` itself,
  unconditionally and untrusted. This port keeps normalisation and
  extraction as two separate concerns: `normalize_qbank`'s
  `spr_additions` parameter and `normalize_disclosed`'s
  `reviewed_spr_keys` parameter both take **pre-reviewed** input from
  `config/assets/sat/spr_keys.yaml` (§3.5's "a person confirms every key")
  — `extract_spr_candidates`/`cross_check` (`spr_answers.py`) are what
  produce the proposals a human reviews before they ever reach either
  normalise function's arguments.
- **Duplicate-id renaming.** Upstream's `parseAndIngestJSON` renames a
  colliding `questionId` on import (appending a suffix) so a Dexie
  `put` never clobbers an existing row. This port's `choose_canonical`
  implements the plan's own replacement rule instead (§3.3: canonical =
  liprep's Bluebook id if either duplicate is one, else the
  lexicographically smaller; the other becomes a `sat_question_aliases`
  row) — a structurally different mechanism for a structurally different
  storage model (one canonical row + alias table, not two renamed rows in
  an IndexedDB store).
- **`DomainPerformance.skills` (S22).** Not a normalisation concern at all —
  noted here only because `domain/sat/types.py`'s own docstring points here
  from the stats side. Upstream's optional field is computed by a fallback
  clause that can never actually run and is read by nothing; it is not
  ported anywhere in this codebase.

## SPR extraction (`spr_answers.py` vs. upstream's
`extractSprAnswerFromRationale`, `db.ts`)

- **Implementation strategy, not behaviour.** This is a *literal*,
  statement-for-statement regex port (see the module docstring) rather than
  an HTML-tree walk, specifically so it reproduces the exact same
  edge-case ordering the vectors were generated from (LaTeX `\frac` before
  tag-stripping; `<img alt>` and MathML `alttext` folded into the same
  plain-text pass; the "Note that …" / "the correct answer(s) is/are …"
  phrase matching running on the fully-stripped, whitespace-collapsed
  text). All 38 `vectors/spr_extraction.json` cases pass with this
  approach; behaviourally there is no known difference.
- **The "all `"0"`" filter inside `extractSprAnswerFromRationale` itself is
  ported as-is** (a rationale that only mentions "0" still proposes `["0"]`;
  a rationale mentioning "0 and 5" proposes only `["5"]`). This is a
  different rule from — and not to be confused with — the "0"-is-a-real
  -official-answer rule in `normalize.py` above: this one governs what a
  *proposal mined from prose* looks like, never the official key itself.
- **`cross_check`'s `accepts` callable has no upstream equivalent to
  differ from.** Upstream folds extraction straight into `correct_answer`
  with no cross-check step (see "SPR keys" above) — `cross_check` (G10) is
  new port-side machinery for the plan's "a person decides" rule, not a
  port of any upstream function.
