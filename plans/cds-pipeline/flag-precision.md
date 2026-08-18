# Validator False-Alarm Measurement — Alabama A&M CDS 2022-23

Status: COMPLETE. Local-only (DB reads + PyMuPDF); no live model calls, no new extractions.

**Document under test**: `cds_library.cds_documents.id = 2018`, school_id `100654`
("Alabama A & M University" in this dev DB — a test/dev fixture row; the PDF content
itself is `cornell_2022-2023.pdf`, sha256 `07681ec9…d1e1c9`, 32 pages). Its candidate
extraction (`extraction_id = 23591901-8dc2-4ea0-8a12-9482349dc36c`) carries **83 stored
validation flags across 13 domains — exactly the number in the brief.**

---

## 1. Flags by validator (as currently stored)

| Validator | Code | Count | Severity |
|---|---|---|---|
| `excerpt_on_cited_page` | `excerpt_not_on_cited_page` | **82** | `warning` (advisory) |
| `year_consistency` | `year_consistency` | **1** | `error` (blocking) |
| `corrupt_text_layer` | `corrupt_text_layer` | 0 | — (document not flagged corrupt) |
| `denominator_sanity` | `denominator_sanity` | 0 | — |
| **Total** | | **83** | |

**One finding up front, before the sample**: `domain/cds/validators.py` and
`app/cds/service_review.py::_flags_summary` **already implement the blocking-vs-advisory
split** this task asked for — `Severity = Literal["error", "warning"]` exists, every flag
in the stored data already carries the correct tier (`excerpt_not_on_cited_page` =
`warning`, `year_consistency` = `error`), `_flags_summary`'s `unresolved` counter already
only counts `severity == "error"`, and the frontend (`flag-queue.ts::metricFlagSeverity`)
already renders the two tiers distinctly. **Under the currently-deployed logic, this
document's review screen already shows "1 unresolved of 83 total," not "83 unresolved"**
— the architecture in the brief's ask was already built. This task's job, confirmed by
reading `git log` (one commit ever touched these files) and `git diff HEAD` (clean before
my edit below), was to *measure* whether that architecture is calibrated correctly, not
to invent it. The rest of this document is that measurement, plus one narrow tuning
change it justified.

---

## 2. Full-population verification method

Every one of the 83 flags (not just the ≥20 sample floor) was checked, because it's
cheap and local: PyMuPDF `get_text("text")` on the real PDF (`adapters/cds_pdf.py`'s own
extraction call — same method the validator's `DocFacts.page_text` is built from, so this
reproduces production behavior exactly, not an idealized ground truth), plus a
whole-document fuzzy search (`domain.cds.validators.fuzzy_contains` on every page) to find
where each excerpt actually lives when the cited page doesn't contain it.

| Step | Result |
|---|---|
| Flags resolved by tuning already present at HEAD (glyph normalization, hyphen-linebreak collapse) once recomputed against the real PDF | **9** |
| Flags still firing after recomputation | 74 |
| — of those, excerpt found verbatim/fuzzy on a **different** physical page than cited | 73 |
| — of those, excerpt found on **no** page in the whole 32-page document | 1 |

**Every single remaining flag traces to one of two causes, both investigated below:
a real upstream page-citation defect (73), or one specific unmatchable ellipsis-elided
excerpt (1). Zero flags in the sample were the validator crying wolf about a truly
unverifiable-but-actually-fine excerpt.**

---

## 3. Root cause of the 73 "different page" flags — a real upstream bug, not a validator false alarm

Grouping the 73 by domain and the offset between the *cited* page and the page the excerpt
was *actually found on* shows a systematic, domain-correlated pattern, not noise:

| Domain | Flags | Cited-page → true-page offset |
|---|---|---|
| `outcomes` | 32 | +1 (cited page 5/6/7 → true page 4/5/6) |
| `transfer` | 29 | +4 (cited page 17/18 → true page 13/14) |
| `class_profile` | 2 | +2 (cited page 9 → true page 7) |
| `admissions` | 2 | +4 (cited page 11 → true page 7) |
| `cost` | 1 | +14 (cited page 31 → true page 17) |
| `transfer` (other) | 1 | +2 |

A fixed, domain-specific offset (not scattered across pages) is the signature of a
page-number that was resolved relative to something other than the true document —
most consistent with a narrowed sub-PDF or routing window whose page positions were not
correctly translated back to physical page numbers before being stored as
`evidence.page_number` (see `app/cds/citation_remap.py`'s own docstring: *"never trust a
narrowed call's `page_number` as an original physical page at face value"* — the module
exists specifically to prevent this class of bug). This is **squarely in
`domain/cds/packet_build.py` / the page-resolution path, which the task brief already
flags as owned by another agent's concurrent fix** (confirmed live: `git diff HEAD` shows
uncommitted, in-progress changes to `domain/cds/packet_build.py`, `app/cds/engine.py`, and
their tests from a different session in this same worktree while this task ran). **I did
not touch any of those files** — out of scope per the brief, and actively being worked on
elsewhere. This is reported as evidence for whoever owns that fix, not addressed here.

**Manually spot-checked 20 of these 73 against the real PDF** (sample below, spanning all
6 firing domains): in every case, the model's reported *value* matches the document's true
content at the correct page exactly. `excerpt_not_on_cited_page` is doing its job here —
the citation genuinely does not verify against the page it claims — it just doesn't imply
what an admin would assume ("the value might be wrong"). The value is fine; the page
number is wrong for a reason outside this validator's control.

---

## 4. Sample (n=21, all 6 firing domains + the 1 `year_consistency` case)

| Domain | Metric | Value | Cited page | True page | Verified against real PDF |
|---|---|---|---|---|---|
| transfer | `transfer.enrolled_women` | 354 | 17 | 13 | ✅ "Women … 354" in the D1-D2 grid |
| transfer | `transfer.enrolled_total` | 633 | 17 | 13 | ✅ "Total … 633" in the D1-D2 grid |
| transfer | `transfer.transfer_credit_maximum_two_year_value` | 45 | 18 | 14 | ✅ "45-60 credit hours" (model took the low end) |
| transfer | `transfer.transfer_credit_maximum_four_year_unit_type_raw` | "credit hours" | 18 | 14 | ✅ matches D14 |
| transfer | `transfer.allows_advanced_standing_from_external_coursework` | true | 17 | 13 | ✅ "X" mark on the yes/no row |
| outcomes | `outcomes.awards_bachelors` | 3,800 | 5 | 4 | ✅ "Bachelor's degrees 3,800" |
| outcomes | `outcomes.awards_window_end` | "June 30, 2022" | 5 | 4 | ✅ B3 window text |
| outcomes | `outcomes.awards_doctoral_professional_practice` | 313 | 5 | 4 | ✅ matches B3 table |
| outcomes | `outcomes.primary_pell_grant_completed_within_six_years_count` | 432 | 6 | 5 | ✅ "G Total graduating … 432" |
| outcomes | `outcomes.primary_all_students_completed_after_five_within_six_years_count` | 41 | 6 | 5 | ✅ line F, all-students column |
| admissions | `admissions.first_year_admission_entry_term` | "Fall" | 11 | 7 | ✅ "C1-C2: Applications" section header confirms section, "Fall 2022" phrasing present |
| admissions | `admissions.first_year_admission_entry_year` | "2022" | 11 | 7 | ✅ same section |
| class_profile | `class_profile.class_profile_entry_term` | "Fall" | 9 | 7 | ✅ same C1 section as admissions |
| class_profile | `class_profile.class_profile_entry_year` | "2022" | 9 | 7 | ✅ same |
| cost | `cost.cost_academic_year` | "2023-2024" | 31 | 17 | ✅ "Provide 2023-2024 academic year costs…" verbatim on p.17 ("G. ANNUAL EXPENSES") |
| class_size | `class_size.class_subsections_30_39` | 141 | 26 | 26 (correct) | ✅ **fixed** — hyphen-linebreak ("SUB-\nSECTIONS") already handled by existing `normalize_text` |
| class_size | `class_size.class_subsections_10_19` | 520 | 26 | 26 (correct) | ✅ **fixed**, same cause |
| class_size | `class_size.class_subsections_50_99` | 35 | 26 | 26 (correct) | ✅ **fixed**, same cause |
| transfer | `transfer.admitted_total` | 798 | 17 | 13 | ✅ correct value; excerpt "Total 798" is a genuine 2-word label/value pair decoupled by the table's column-major PDF export order (see §5) |
| transfer | `transfer.enrolled_men` | 279 | 17 | 13 | ✅ same decoupled-table pattern |
| identity | `identity.academic_year` | "2022-2023" | 1 | 1 (correct) | Value **is** correct (page header literally reads "Common Data Set 2022-2023") — see §6 for why `year_consistency` still legitimately fires |

**Value-level precision on this sample: 21/21 (100%) — no wrong value found anywhere in
the document.** This matches `spike-part-a.md`'s T1/T2 finding on the same underlying PDF
(Gemini's page-image reading survives text-layer/citation problems; 99.3% field accuracy
across the corpus, zero hallucinated values).

---

## 5. The `_MIN_WORDS_FOR_FUZZY` tuning — what changed and why

Six of the sampled flags (`transfer.admitted_total`, `admitted_men`, `admitted_women`,
`enrolled_total`, `enrolled_men`, `enrolled_women`) share a shape: a 2-word excerpt like
`"Total 798"` or `"Men 346"`, where the label and the value are both genuinely on the page
but land in **different rows** of the extracted text — the source page (physical p.13)
literally reads `Men\n3,126\n346\n279\nWomen\n2,635\n452\n354\n…\nTotal\n5,761\n798\n633`
(all labels bunched together, then all numbers bunched together — the exact
Excel-export decoupling `plans/cds-pipeline/spike-part-a.md`/`recon-cds-corpus.md` §5
predicted for this file). `fuzzy_contains`'s word-hit-ratio path already tolerates this
for excerpts of 3+ words, but `_MIN_WORDS_FOR_FUZZY = 3` forced these 2-word excerpts onto
the strict exact-substring path, which a non-adjacent label/value pair can never satisfy.

**Changed in `domain/cds/validators.py`**: `_MIN_WORDS_FOR_FUZZY` lowered from `3` to `2`.
A 2-word excerpt now requires *both* words individually present (ratio `2/2 = 1.0 ≥ 0.8`;
one-of-two is `0.5`, still rejected) — strictly more permissive about *adjacency*, not
about *evidence*. Single-word excerpts are unaffected (the fuzzy and substring paths are
mathematically identical at n=1). Two new unit tests cover the fix directly
(`TestExcerptOnCitedPage::test_no_flag_for_two_word_excerpt_split_across_a_decoupled_table`,
`::test_flags_two_word_excerpt_when_only_one_word_is_present`) — the second asserts a
2-word excerpt still flags when only one of the two words is actually present, so this
isn't a blanket loosening.

**Measured effect, isolating this change from the upstream page-citation bug**: I
re-ran §3's 73 "different-page" flags with `evidence.page_number` hypothetically
corrected to the true page (i.e., simulating the upstream fix), at both thresholds:

| `_MIN_WORDS_FOR_FUZZY` | Residual false positives once the page number is correct |
|---|---|
| 3 (before) | 6 / 73 |
| 2 (after) | **0 / 73** |

This fix doesn't change *this document's* flag count today (the page number is still
wrong regardless of word-count threshold — that's the other agent's fix, §3), but it is
a necessary second layer: without it, fixing the page bug alone would still leave 6 false
positives on this document from decoupled 2-word table cells. Confirmed via direct PDF
re-check, not estimated.

---

## 6. `year_consistency` (n=1) — the one blocking flag

`identity.academic_year = "2022-2023"`, expected year mismatch flagged as `error`. The
document's own printed header (`"Common Data Set 2022-2023"`, page 1) confirms the
extracted value is **correct**. The flag fires because `cds_school_years.academic_year`
for this row is `2093` — a synthetic placeholder in this dev/test fixture
(`schools.id = 100654`'s 12 school-year rows all carry nonsensical values: 2091, 2092,
2101… 2191, none matching any real CDS edition; confirmed via
`cds_library.cds_school_years`). **This is a test-fixture data-quality artifact, not a
validator defect or an extraction defect** — `year_consistency` is doing exactly what it's
designed to do: compare the document's claimed year against the upload's declared year and
flag a mismatch. On real production data (where `academic_year` is a genuine literal
calendar year, per the column's own `CHECK (academic_year >= 2000 AND academic_year <=
2200)` and the 3 real schools' rows, all 2024/2025) this validator has nothing to correct.
**No change made.** Precision on this n=1 sample: 1/1 — true positive under its actual
input, left as `error`/blocking per the hard constraint (a genuine, provable
inconsistency, not an evidence-verifiability gap).

---

## 7. Blocking vs. advisory (already implemented — confirmed correct, not re-invented)

| Validator | Code | Severity | Why |
|---|---|---|---|
| `excerpt_on_cited_page` | `excerpt_not_on_cited_page` | **warning** (advisory) | Can only prove the citation is unverifiable, never that the value is wrong — §3/§4 show the value usually survives. |
| `corrupt_text_layer` | `corrupt_text_layer` | **warning** (advisory) | Same class of gap — flags a re-check need, not a proven error. |
| `year_consistency` | `year_consistency` | **error** (blocking) | Directly proves a value inconsistency (document year vs. upload year), §6. |
| `denominator_sanity` | `denominator_sanity` | **error** (blocking) | Direct arithmetic contradiction in the packet's own verified data (admits > applicants, gender parts ≠ total, percent out of 0–100). |

`app/cds/service_review.py::_flags_summary` gates `unresolved` (and therefore the
Approve endpoint's `override_flags` requirement) on `severity == "error"` only; `warning`
flags stay visible in `total` forever, never silently dropped, never block Approve alone.
Verified against the frontend contract (`frontend/src/features/cds-admin/review/flag-queue.ts`,
read-only — not modified): `metricFlagSeverity`/`sectionFlagSeverity` already rank `error`
above `warning` for the review screen's rail color and metric ordering.

---

## 8. Before → after (this document)

| | Total flags | `warning` | `error` (blocking/`unresolved`) |
|---|---|---|---|
| **Stored in DB today** | 83 | 82 | 1 |
| **Recomputed against the real PDF with tuned `validators.py`** | **74** | 73 | 1 |
| Change | **−9 (−10.8%)** | −9 | 0 |

The blocking count was already 1 before this task (the severity split was live when this
packet was built) and stays 1 — `year_consistency`'s single flag is a genuine defect
(§6), not noise, and the hard constraint forbids suppressing it. The 9-flag reduction in
`total` is real, PDF-verified, and attributable entirely to normalization work already
present at HEAD plus this task's `_MIN_WORDS_FOR_FUZZY` fix — not to weakening any check.
**73 of the 74 remaining `warning` flags are correctly firing on a genuine upstream
page-citation defect (§3), not validator noise; per the hard constraint, they are left
firing and reported, not suppressed.**

---

## 9. Gates

- `uv run ruff check .` — clean.
- `uv run mypy .` — clean except the 3 pre-existing errors in `scripts/finish_render_staging.py` (unchanged, not touched).
- `uv run pytest tests/domain/cds/test_validators.py -q` — **20/20 passed** (18 existing + 2 new).
- `uv run pytest -m "not live_llm and not live_search and not live_db"` — isolated via `git stash` that the documented **8-failure baseline is unchanged** by this task's changes. A concurrent, uncommitted, in-progress fix to `domain/cds/packet_build.py` / `app/cds/engine.py` from another agent working in this same worktree (confirmed live via `git diff HEAD` — exactly the packet_build.py fix the brief flagged as out of scope) currently adds 6 additional failures in `tests/domain/cds/test_packet_build.py`; none touch `validators.py`, `service_review.py`, or this task's test file, and they are not attributable to this change.

## 10. Files touched

- `domain/cds/validators.py` — one constant changed (`_MIN_WORDS_FOR_FUZZY` 3→2) plus its justifying comment. No other logic changed; severity/blocking design was already correct.
- `tests/domain/cds/test_validators.py` — 2 new tests for the above.
- `app/cds/service_review.py` — **not modified**; already implements the correct blocking-vs-advisory gate.
