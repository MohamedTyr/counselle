# CDS Extraction Spike — Part A (Evidence Verification, Accuracy, Determinism, Cost)

Status: COMPLETE (T1-T4).

Continues from the extraction spike whose raw outputs live in `artifacts/spike/results/e1_*.json`
(6 usable whole-document E1 runs: caltech, cornell, dartmouth, harvard, michigan, ucf; `amherst_test`
is a section-only PDF with 0 relevant findings, not scored; `ohiostate` timed out on write, no
result). Scripts in `artifacts/spike/scripts/`. Ground truth in `artifacts/spike/ground_truth/`.
Corpus in `artifacts/cds-corpus/`.

Reused, not regenerated: all 6 `e1_*.json` raw model outputs. This document only adds
verification/scoring on top of them, plus 2 new cheap runs for T3 (determinism) — T4 is derived
from logs already on disk plus those 2 new runs.

---

## T1 — Evidence verification (fully programmatic)

**Method.** `scripts/verify_evidence.py` (already on disk from the stalled run) opens the real
source PDF for each `e1_*.json` and, for every finding, normalizes whitespace/NBSP/case and
checks whether the claimed `excerpt` appears verbatim on the claimed `page_number`, then on
±1 neighbor pages, then via a fuzzy `difflib` ratio (≥0.6 = "real but reflowed"). I added
`scripts/verify_evidence_components.py`, which re-examines every remaining `not_found` case by
splitting the excerpt into sub-segments (sentence boundaries, and specifically the seam between
a label and a trailing number — the "`<label text> <digits>`" concatenation the model produces
for the corpus's decoupled label/value tables) and checking each segment independently against
the page. This distinguishes two very different failure shapes that a single whole-string match
cannot tell apart: (a) **composite/reconstructed** — every word of the excerpt is genuinely on
the cited page, just non-adjacent (the model stitched two real, separated page fragments into
one "excerpt" string), vs. (b) **fabricated** — no meaningful fragment of the excerpt exists on
the page at all. Per-file outputs: `results/verification/{school}.json`.

**Per-file table** (134 total findings across the 6 usable E1 runs):

| School | Findings | Verbatim | Fuzzy (real, reflowed) | Composite (real, non-adjacent) | Fabricated citation | % real evidence | % fabricated |
|---|---|---|---|---|---|---|---|
| Cornell | 25 | 10 | 15 | 0 | 0 | 100.0% | 0.0% |
| Dartmouth | 25 | 10 | 14 | 1 | 0 | 100.0% | 0.0% |
| Harvard | 19 | 10 | 8 | 1 | 0 | 100.0% | 0.0% |
| Michigan | 22 | 19 | 0 | 3 | 0 | 100.0% | 0.0% |
| UCF | 22 | 11 | 11 | 0 | 0 | 100.0% | 0.0% |
| Caltech | 21 | 0 | 11 | 0 | **10** | 52.4% | **47.6%** |
| **Overall** | **134** | **60** | **59** | **5** | **10** | **92.5%** | **7.5%** |

**Headline: 92.5% of citations are real (verbatim, reflowed, or reconstructed from genuinely
on-page fragments); 7.5% are fabricated citations — and every single fabricated citation is
concentrated in one file, Caltech.** No other file in the sample produced a single unverifiable
citation.

**The Caltech case, in detail — and why it's more interesting than "worst file."**
`recon-cds-corpus.md` §7 predicted Caltech's broken font `ToUnicode` CMaps would silently corrupt
digit/word extraction; §4c separately predicted Caltech's C7 grid has zero textual signal for
which checkbox is marked (checkmarks render as `✔`/`տ` glyphs bunched at the end of the text
stream, decoupled from row/column position). Both predictions held exactly: all 10 fabricated
citations are either (a) the two `first_year_admission_entry_term`/`_year` findings, whose
excerpt ("`...enrolled (full- or part-time) in Fall 2024.`") is clean readable English that does
**not** appear anywhere in the actual page-13 text (the real extracted text at that spot is
ROT-shift-corrupted: `...HQUROOHG\x03\x0bIXOO\x10\x03RU\x03SDUW\x10WLPH\x0c\x03LQ\x03)DOO\x03\x15\x13\x15\x17` — recon's
predicted `\x03`-space, `-29`-rot corruption, verbatim), or (b) all 8 tracked C7 factor-grid
rows, where the text layer has zero column-position signal at all — confirmed directly by
dumping Caltech page 16's raw text, which contains the four column headers once, then 54 `տ`
glyphs and 18 `✔` glyphs with no per-row/column association whatsoever.

**But — I pulled the one Caltech ground-truth image already on disk
(`ground_truth/images/caltech_2024-2025_p16.png`, the C6-C7 page) and hand-checked all 10
"fabricated-citation" values against it: every single one is correct.** `Fall`/`2024` is right
(cross-checked against the page header "Common Data Set 2024-2025" and the visible "in Fall
2024" phrasing once decoded), and all 8 C7 checkbox selections match the ground-truth image
exactly (rigor=very_important, class_rank=important, academic_gpa=important,
standardized_tests=very_important, application_essay=very_important,
recommendations=very_important, interview=not_considered, extracurricular=important). **The
model is reading Caltech's rendered page image correctly (Gemini treats each PDF page as an
image tile per recon-vertex.md §4e) even though the text layer it's asked to cite from is either
corrupted or entirely absent for these cells.** This means "fabricated citation" here is not the
same failure as "hallucinated value" — the values are right, but the excerpt-verifiability
contract (the thing this honesty gate exists to check) genuinely cannot be satisfied by any
text-layer-based check for this file, because there is no truthful text-layer excerpt to give.
**A validator that only trusts text-verified excerpts would have to either reject 100%-accurate
Caltech answers outright, or carve out an explicit "text-unverifiable, escalate to image
spot-check" status distinct from "fabricated" for corrupted-text-layer / checkbox-only findings**
— see the validator-mapping list at the end of this document.

Scripts: `scripts/verify_evidence.py`, `scripts/verify_evidence_components.py`. Raw per-finding
verdicts: `results/verification/{caltech,cornell,dartmouth,harvard,michigan,ucf}.json`.

---

## T2 — Accuracy scoring against ground truth

**Method.** Ground truth was built primarily via PyMuPDF, per the brief's efficiency
instruction, but with one methodological correction worth flagging: **plain `get_text()` is
unusable as a ground-truth source for the corpus's Excel/Quartz-exported files (Cornell,
Harvard) — their table cells extract as two disconnected blocks (all numbers, then all labels,
in creation order, not visual order) exactly as `recon-cds-corpus.md` §5 warned.** But
`page.get_text("words")`, sorted by `(y, x)`, fully recovers true visual reading order for these
same files — labels and numbers land on the same line, in the same order a human sees them. This
is a **stronger and cheaper** ground-truth method than the recon anticipated ("expensive but
possibly tractable" bbox reconstruction turned out to be one `sorted()` call). All ground truth
for Cornell/Harvard/Dartmouth's C1/C2/C21 tables and all three schools' C7 factor grids
(bare-`X`-marker family, recon §4b) was built this way — the `X`'s cell was resolved by nearest
Euclidean/x-distance to the four column-header words on the same table. **Caltech is the sole
file where ground truth required images** (`ground_truth/images/caltech_2024-2025_p{13,14,16,23}.png`),
because its C7 grid has literally no textual marker (recon §4c) and its C1/C2/C21 pages carry the
ToUnicode corruption (recon §7) — both already-reserved cases per the brief.

**A methodology note on my own process, because it changed a conclusion:** I initially
eyeballed the pre-rendered `ground_truth/images/{harvard,dartmouth}_2024-2025_p8.png` PNGs for
their C7 grids and misjudged which of the four tightly-spaced column headers several `X` marks
sat under (the four columns are visually narrow and adjacent). Cross-checking with the same
`get_text("words")` x-distance method used for Cornell caught and corrected my own misread before
it entered the ground truth. **This is itself a finding: for dense `X`-in-a-4-column-grid
layouts, sorted word coordinates are more reliable than visual inspection, even for a human/model
looking at a rendered image** — worth remembering when this becomes a real validator (see the
mapping at the end of this document).

**Scoring categories**, applied per metric per file (149 scorable metric-instances across the 6
files; 1 excluded as ground-truth-ambiguous — see Caltech below):
- **correct** — ground truth has a value, model reported the same value.
- **wrong** — ground truth has a value, model reported a different one.
- **missed** — ground truth has a value, model reported nothing.
- **hallucinated** — ground truth is structurally blank (the field genuinely isn't answerable
  from the document — e.g. no waitlist counts printed, or Early Decision dates when ED isn't
  offered), model reported a value anyway.
- **correct_abstention** — ground truth is structurally blank, model correctly reported nothing.
  This matters as much as "correct": the extraction prompt explicitly instructs the model never
  to guess a blank as `0`/`not_reported`, and this measures whether it actually complies.

**Results — script `scripts/score_accuracy.py`, raw per-metric verdicts in
`results/accuracy/{school}.json`:**

| School | Correct | Correct abstention | Wrong | Missed | Hallucinated | Excluded (ambiguous GT) | Accuracy |
|---|---|---|---|---|---|---|---|
| Caltech | 21 | 3 | 0 | 0 | 0 | 1 | 100.0% |
| Cornell | 25 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| Dartmouth | 25 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| Harvard | 18 | 6 | 1 | 0 | 0 | 0 | 96.0% |
| Michigan | 22 | 3 | 0 | 0 | 0 | 0 | 100.0% |
| UCF | 22 | 3 | 0 | 0 | 0 | 0 | 100.0% |
| **Overall (149 scored)** | **133** | **15** | **1** | **0** | **0** | **1** | **99.3%** |

**Headline: 99.3% field accuracy (148/149 scored metric-instances correct), with zero misses and
zero hallucinated values anywhere in the sample.** The one wrong value: Harvard's
`selection_factor_class_rank` — the model read the C7 grid's bare `X` marker as "Considered"
when its true x-position (364.5pt) sits almost exactly under the "Not Considered" column header
(360.8pt, 3.7pt away) rather than the "Considered" header (297.0pt, 67.5pt away) — a genuine,
unambiguous miscolumn read on a checkbox-style grid with no bounding-box awareness in the model's
own reasoning.

**This result reframes the whole spike's headline tension.** `recon-cds-corpus.md` spent most of
its length cataloguing text-layer pathologies (scrambled Excel exports, corrupted Caltech fonts,
lost checkbox columns) as reasons a *text-extraction* pipeline would struggle. **Almost none of
that pathology touched this model's actual extracted values** — Cornell and Dartmouth, two of
the recon's flagged "worst case" files, scored 25/25 and 25/25. The reason is exactly what
`recon-vertex.md` §4e already noted in passing: Gemini ingests each PDF page as an image tile, so
a broken/scrambled *text layer* mostly doesn't constrain what the model can *see*. **What the
text layer does constrain is what the model can honestly *cite*** — which is precisely why T1's
92.5%-real-citations number and T2's 99.3%-correct-values number diverge on the same file
(Caltech: 100% of scoreable values correct, 47.6% of citations fabricated). Value accuracy and
citation honesty are two different signals that must both be checked; neither substitutes for
the other, and this corpus is proof they can move independently.

**Failure modes actually observed** (verbatim, for validator design):
1. **Column-position miscall on a bare-`X` marker grid** (Harvard `class_rank`, `considered` vs.
   true `not_considered`) — the one real wrong-value error in the whole sample. Not a text-layer
   problem; the model had a clean `X` to read, and still miscounted which of 4 tightly-spaced
   columns it belonged to.
2. **Fabricated citation with a correct value, driven by a corrupted text layer** (Caltech, 10
   findings — see T1). The model's *answer* is right; its *evidence* cannot be verified against
   the text layer because the text layer itself is either corrupted (ToUnicode CMap bug) or
   entirely absent for that cell (checkbox grid with no Unicode marker).
3. **Composite/reconstructed excerpts on structurally-clean documents** (Michigan ×3, Dartmouth
   ×1, Harvard ×1) — every word of the excerpt is genuinely on the cited page, just stitched from
   two non-adjacent fragments (e.g. the C1 heading + a much-later boilerplate sentence). Correct
   value, correct page, technically-non-verbatim citation.
4. **Ground-truth ambiguity baked into the source document itself** (Caltech `applicants_total`)
   — the school left its residency-breakdown table unfilled, so the printed "TOTAL" cell reads
   literally `0`. The model declined to report this metric rather than assert an unverifiable
   `0`; a naive scorer would count that as a "miss," but it's arguably the more honest behavior
   given the source data itself doesn't cleanly resolve.
5. **Correct abstention on conditional blanks, consistently** (15 of 149 scored instances —
   Harvard's 3 waitlist counts + 3 ED fields, Michigan/Dartmouth/UCF/Caltech's ED-detail fields
   whenever `early_decision_offered=false`) — the model never guessed a `0` or invented a date
   for a field the source document leaves genuinely blank. This is a real, measurable win for the
   prompt's explicit "omit the metric, never guess" instruction and is worth protecting with a
   regression check (see validator list below), since it's exactly the kind of behavior a
   less-careful prompt revision could quietly break.
6. **Stale-year-header resistance** (Cornell) — `recon-cds-corpus.md` §8's predicted trap
   (`"Common Data Set 2021-2022"` on 78% of Cornell's pages, vs. the correct `2022-2023` on only
   2) did not fool the model; it correctly resolved `first_year_admission_entry_year=2022` from
   the in-context "Fall 2022" cohort phrasing rather than a document-wide header majority.

Script: `scripts/score_accuracy.py`. Ground truth is inline in that script (with derivation notes
in code comments); per-metric verdicts in `results/accuracy/{school}.json` +
`results/accuracy/_overall.json`.

---

## T3 — Determinism check

**Method.** Rather than spend 4 fresh model calls, I reused 2 of the already-on-disk `e1_*.json`
runs as "run A" and made exactly 1 new call per file ("run B") — same PDF, same prompt, same
`temperature=0`, same `gemini-3.1-flash-lite` — for Harvard and Dartmouth. New raw outputs:
`results/determinism/{harvard,dartmouth}_run2.json`.

| School | Run A tokens (in/out) | Run B tokens (in/out) | Run A wall-clock | Run B wall-clock | `parsed` JSON byte-identical? | Field-level diffs |
|---|---|---|---|---|---|---|
| Harvard | 19956 / 1371 | 19956 / 1371 | 38.8s | 40.8s | **Yes** | 0 |
| Dartmouth | 20996 / 1838 | 20996 / 1838 | 87.8s | 31.8s | **Yes** | 0 |

**Headline: output was byte-for-byte identical across both files, including every `raw_value`,
`page_number`, and `excerpt` string, and even the token counts matched exactly.** At
`temperature=0` on `gemini-3.1-flash-lite`, this small sample shows real determinism, not just
"low variance" — `recon-vertex.md` §4d's caution that Gemini "does not guarantee bit-identical
determinism even with `temperature=0`" did not materialize as a problem here. **This means
self-consistency voting (running N calls and taking a majority) would currently buy nothing on
this workload** — there's no disagreement between runs to vote over, so the honesty/accuracy
levers that matter are the citation-verification (T1) and validator (see below) layers, not
ensembling. Wall-clock latency, by contrast, varied substantially between runs on the same file
(87.8s → 31.8s for Dartmouth) — that's provider-side latency noise, not an output-determinism
problem, and matters for T4's latency budgeting, not for output trust.

---

## T4 — Cost / latency (measured, not estimated)

Pulled directly from the `usage_metadata` embedded in every `e1_*.json` and the 2 new T3 runs —
no estimation. Cost computed with `scripts/costs.py`'s pricing table
(`gemini-3.1-flash-lite`: $0.25/1M input, $1.50/1M output, per `recon-vertex.md` §4e).

| School | Input tokens | Output tokens | Wall-clock | Cost/call |
|---|---|---|---|---|
| Caltech | 29,316 | 1,573 | 137.3s | $0.0097 |
| Cornell | 19,956 | 1,893 | 70.2s | $0.0079 |
| Dartmouth | 20,996 | 1,838 | 87.8s | $0.0080 |
| Harvard | 19,956 | 1,371 | 38.8s | $0.0070 |
| Michigan | 16,836 | 1,726 | 308.8s | $0.0068 |
| UCF | 28,276 | 1,715 | 59.3s | $0.0097 |
| Amherst (section-only, 2pg, no C1/C2/C7/C21 present) | 4,356 | 9 | 4.6s | $0.0011 |
| Dartmouth run 2 (determinism) | 20,996 | 1,838 | 31.8s | $0.0080 |
| Harvard run 2 (determinism) | 19,956 | 1,371 | 40.8s | $0.0070 |
| **Mean (6 full-document schools)** | **22,556** | **1,686** | **117.0s** | **$0.0082** |

**Headline: ~$0.008/document (whole-document single call, no page-routing narrowing applied —
this is E1's ceiling case, not the narrowed E3 path).** This lands almost exactly on
`recon-vertex.md`'s own pre-registered estimate (§5, "$0.02–0.03/school ceiling" for the full
8-call routed pipeline; a single whole-document call at ~$0.008 is consistent with — actually
cheaper than — that per-call budget, since this spike's single call answers ~25 metrics in one
shot rather than splitting across 8 domain-group calls).

**Latency is the more interesting number here, and it's noisy and occasionally severe.** Wall
clock ranged from 4.6s (tiny Amherst section) to **308.8s (over 5 minutes) for Michigan**, with
no obvious correlation to input token count (Michigan's input, 16,836 tokens, was the *smallest*
of the 6 full documents scored, yet by far the slowest). Two files failed outright with
`httpx.WriteTimeout` before eventually succeeding on retry (`results/e1_caltech.log`,
`results/e1_ohiostate.log` — Ohio State's 187-page, 4.9MB 2023-24 file never produced a usable
result in this spike at all, consistent with `recon-cds-corpus.md`'s own flag that this file is
a pagination-bloat outlier). **Any production pipeline built on this call shape needs a generous
timeout (the successful Caltech retry alone took 137s) and a retry budget, not a fixed
low-second-count SLA** — cost is a non-issue at this price point, but tail latency is a real
operational risk this spike did not fully characterize (n=6 is too small to fit a distribution,
and I did not retry Ohio State to get it into the sample, per the "don't do too much in-context"
process rule — flagged in "could not verify" below).

---

## Validator mapping — what each observed error implies for `domain/cds/validators.py`

Every failure mode from T1/T2, mapped to a deterministic, local (non-model) check:

| # | Observed error | Deterministic validator |
|---|---|---|
| 1 | Fabricated citation on a page whose text layer is corrupted (broken ToUnicode CMap) or has zero marker signal (checkbox drawn as a vector shape) — Caltech, 10/21 findings | **`flag_unverifiable_text_layer(page_text) -> bool`**: scan the cited page's raw `get_text()` for control characters (0x00–0x1F outside `\n\t\r`) or, for checkbox/grid metrics, absence of any label-adjacent enum-bearing token. Route matches to a `text_unverifiable` status distinct from `fabricated` — do **not** auto-reject; escalate to image spot-check. This is the single most important validator this spike surfaces: without it, a strict verbatim-citation gate would reject 100%-accurate Caltech answers outright (see T1/T2's central finding). |
| 2 | Composite/reconstructed excerpt — every word genuinely on-page, just non-adjacent (Michigan ×3, Dartmouth ×1, Harvard ×1) | **Segment-level verification, not whole-string match**: split the excerpt on sentence boundaries and on the label/trailing-number seam (`verify_evidence_components.py`'s method), and accept the citation if ≥50% of its characters resolve to verbatim on-page segments. Prevents a naive whole-string checker from flagging correct, honestly-sourced answers as fabricated. |
| 3 | Wrong value on a bare-`X` checkbox-grid marker — Harvard `class_rank`, the one real value error in 149 scored metrics | **Independent spatial cross-check for any enum metric backed by a marker-in-a-column-grid `source_hint`**: re-derive the selected column locally via `get_text("words")` bbox x-distance from the marker to each column header (exactly the method used to build this document's own C7 ground truth), and flag any disagreement between the model's `raw_value` and the locally-derived column for human review. This is the *only* validator here that would have caught an actual wrong answer rather than a citation-honesty gap — worth prioritizing. |
| 4 | Ground truth itself ambiguous in the source document — Caltech `applicants_total`, an unfilled residency table printing literal `0` | **Zero-row plausibility check**: if every cell in a "TOTAL" row is exactly `0` while sibling tables on the same page/section show non-zero volume for the same cohort, tag the row `likely_unfilled_by_institution` rather than accepting `0` as a clean value. Prevents silent contamination of the dataset with a placeholder zero that looks identical to a genuine zero. |
| 5 | Correct abstention on conditional blanks (15/149 scored instances) — no case observed where this broke, but it is exactly the kind of behavior a later prompt change could silently regress | **Gate-consistency validator**: for any boolean gate metric (`early_decision_offered`, `has_waitlist_policy`) reported `false`/absent, assert all dependent detail fields (`early_decision_first_closing_date`, `*_application_count`, `*_admitted_count`, the 3 waitlist counts) are also absent — flag any case where a dependent field is populated despite a `false`/missing gate as a probable hallucination. Turns an observed-good behavior into a regression guard. |
| 6 | Stale-year-header trap — did not fool the model here, but is a predictable, catchable class per `recon-cds-corpus.md` §8 | **Year cross-check, not model-trusted**: compare the extracted `first_year_admission_entry_year` against (a) the source filename/URL year if known at ingestion, then (b) reject any extraction that instead matches a document-wide header-string majority vote. Formalizes recon §8's trust ordering as code rather than relying on the model to resolve it correctly every time. |

---

## What this spike could not verify

- **Latency tail risk is uncharacterized.** n=6 successful full-document calls is too small to
  fit a distribution; Ohio State's 187-page 2023-24 file never completed in this spike (2 timeout
  failures already on disk, not retried further per the "don't do too much in-context" rule) and
  CMU/Florida/Penn State/Spelman/Michigan-2023-24/Ohio-State-2024-25 were never attempted with the
  E1 call at all. A production rollout needs a larger latency sample before setting an SLA/timeout
  budget.
- **Page-narrowing (E3) accuracy/cost delta was not re-verified in this pass.** `scripts/run_e3.py`
  exists on disk from the earlier stalled run but I did not execute or score it here — T4's cost
  number is the E1 whole-document ceiling, not the narrowed-call price point `recon-vertex.md`
  §5 modeled as cheaper.
- **C7 vision-vs-native comparison (E4) was not re-run.** `scripts/run_e4.py` and `schema_c7.py`
  exist on disk (built for comparing native-PDF vision against a rasterized-PNG-of-just-the-C7-page
  on Caltech/CMU/Ohio-State-2024-25) but produced no results in this pass — this spike's T1/T2
  findings already show native PDF vision alone gets Caltech's C7 values 100% right despite zero
  text-layer signal, which somewhat pre-empts the original motivation for E4, but a direct
  native-vs-image comparison on cost/latency was not measured.
- **Determinism (T3) was only checked on 2 of 6 files, 2 runs each.** Both were byte-identical, but
  a claim of "fully deterministic" would need a larger n and should be re-checked on Caltech
  specifically (the file where the model appears to lean most heavily on visual reading over text,
  which is exactly the kind of call where run-to-run variance would be most likely to appear if it
  exists at all).
- **The 8-metric C7 subset is not the full 18-row grid**, and the 25-metric spike subset is a small
  slice of the ~152-metric `admissions` domain — this spike's near-perfect accuracy should not be
  read as "the full pipeline will score 99%"; it characterizes this specific metric slice on these
  6 documents, nothing broader.
- **Only 6 of 15 corpus files were scored end-to-end** (Caltech, Cornell, Dartmouth, Harvard,
  Michigan, UCF) — CMU, Florida, Ohio State (both years), Penn State, Reed, Spelman, Amherst
  (section-only, structurally has no C1/C2/C7/C21) and Michigan 2023-24 were not run through E1 in
  this spike at all, so this document's headline numbers describe those 6 files, not the full
  15-file corpus.
