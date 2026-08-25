# CDS extraction tuning — final report

Branch `feat/cds-pipeline`. **Total model spend: ~$13.5** of the $25 rail.

Supersedes two earlier versions of this file, both written prematurely. The first
declared a plateau at three non-improving experiments where §9 requires four. The second
stopped with a fix I had identified, costed and understood — the H14/H10 batch split —
sitting unexecuted in its own "next steps" section, and asserted the residual was
intractable without ever enumerating it. Doing both took accuracy from 98.33% to 98.86%
and hallucinations from 8 to 4.

---

## 1. Verdict against the §1 targets — a trade curve, not a champion

Three configurations, all failure-free, all measured on the same corrected ground truth:

| dimension | **A: exp15** | **B: exp29** | **C: exp32** | target | floor |
|---|---|---|---|---|---|
| accuracy | 96.86% | 98.41% | **98.86%** | 100% | 99.5% |
| coverage | **97.03%** | **97.03%** | 96.96% | ≥98% | 95% |
| hallucinations | 27 | 8 | **4** | 0 | 0 |
| wrong | 15 | 13 | **11** | — | — |
| cost / doc | **$0.0921** ✅ | $0.1876 ❌ | $0.2088 ❌ | ≤$0.10 | ≤$0.15 |
| latency / doc | **315.5s** ✅ | **354.2s** ✅ | 419.3s ❌ | ≤240s | ≤360s |
| floors met | 3 of 5 | 2 of 5 | 1 of 5 | | |

**No configuration meets all §1 floors, and none reaches the 99.5% accuracy floor.**
Each step up the accuracy curve costs a floor: A is the only cost- *and* latency-compliant
option; B buys +1.55pp accuracy and −19 hallucinations for the cost floor; C buys a
further +0.45pp and −4 hallucinations for the latency floor as well.

**I am not choosing.** §1's floors are immutable under §8b, and lexicographic priority
orders comparisons *between admissible configs* — it does not license admitting an
inadmissible one. Which floor you are willing to spend is a product decision.

Per-document at config C: **caltech 99.56, ucf 99.37, dartmouth 99.15, cornell 98.76**,
uga 97.60. Four of five are at or above 99%; three clear the 99.5% floor individually.
**UGA is the outlier and holds 7 of the 15 remaining errors.**

## 2. What the loop achieved

From the shipped baseline (whose own figures are untrustworthy — 35 of its 115 calls
never completed, so it was scored over 769 extractions against 1337 and was cheap
*because* a third of its work never ran):

- **coverage 55.58% → 97.03%**
- **failed calls 35 of 115 → 0**
- **latency 1062s → 315–419s**
- **accuracy 96.86% → 98.86%**, **hallucinations 27 → 4** (configs A → C)

## 3. Three production bugs, found by running the engine rather than reading it

1. **Narrowing inflated the payload.** A 5-page slice of Caltech's 2.14MB scan measured
   **3.96MB — larger than the whole document.** Caltech failed 23/23 calls, UGA 9/23,
   UCF 3/23. Fixed with `deflate=True, garbage=4` plus a guard that sends the source when
   a slice is not smaller.
2. **Narrowing silently destroyed AcroForm values.** `insert_pdf` leaves the
   document-level form behind. UGA completed **23/23 calls with zero errors and 6.45%
   coverage** — a confident, empty, wrong answer, masked by bug 1. Fixed with `doc.bake()`
   before slicing.
3. **A hint literal matching nothing.** Every CDS prints `B4-B21`; the config said
   `B4-B11`.

**Sharpest single finding:** UGA's E1 page yields **32 empty-ballot-box glyphs and zero
checked ones** to text extraction while visibly showing 15 ticked boxes. An AcroForm tick
lives in the widget's appearance stream — it renders and never becomes text. The text
layer does not omit the answer, it *asserts the opposite*, and the model quoted it
verbatim. Every provenance signal passes.

## 4. Ground truth was wrong three times

All traced to decision **D12**, which replaced UGA's two independent reading passes with
mechanical `pypdf.get_fields()` harvesting:

- **H14 across two documents** — UGA (9 metrics) and UCF (4) recorded visibly-present but
  *unticked* checkboxes as `present`/`false`. The catalog forbids this in all twelve
  `h14_*` metrics: *"a blank cell in this or any other visible H14 coordinate is
  not_reported, **never false**."* Three independent adjudications agreed, each
  independently finding the decisive in-catalog contrast: **H12 explicitly authorises
  false-closure; H14 pointedly does not.**
- **`identity.state_or_region`** — GT `GA`, page renders `Georgia`. The widget is a
  ComboBox whose export value differs from its display label. (Audited: 3 of 76 choice
  widgets diverge; 1 reaches a GT metric.)

**The H14 correction made the champion look worse** (97.16% → 96.86%, hallucinations
23 → 27). That is the point: a GT change that only ever helps the engine should be
distrusted on sight.

`pypdf.get_fields()` is bit-for-bit truth about *field contents*. It is not a substitute
for reading the page against the catalog. §4's sealing rule needs amending on both counts.

## 5. The mechanisms this loop established

| lever | outcome |
|---|---|
| wording that asserts a **policy** ("the text layer lies", "instructions outrank conventions", "OMIT rather than false", "do not infer a status") | **0 for 4** |
| wording that names an **observable** ("is a control drawn beside *this row*?", "join month and day with a slash", "a status word in the year cell belongs to the status metric") | **4 for 5** |
| changing what the model **receives** (bake-before-slice, images-only for form batches, grid images) | **3 for 4** |
| **reasoning budget** on a batch violating an explicit rule | **worked** (11 errors at once) |
| reasoning budget where no rule applies | **0** — byte-identical output, $0.094 wasted |

Four rules worth keeping:

1. **Wording works when it names something checkable on the page**, and fails when it
   asserts a policy. The successful clauses all give the model a test to run.
2. **The observable must be unambiguous at the granularity it is applied.** "No control
   drawn beside it" fixed UCF (no controls anywhere in H9) but not Cornell (one control
   in the block, on a different row). Sharpening it to *"judge each row on its own; a
   control belonging to a different row is not this row's control"* fixed Cornell.
3. **Deliberation enforces a rule the model is violating; it cannot supply a rule that is
   absent.**
4. **`instructions` are batch-scoped, not metric-scoped.** `_build_prompt` serialises
   every metric in a batch into one payload. Two families with opposite closure rules
   cannot share a batch — the H9 clause applied beside H14 broke H14, and *rewording did
   not help* because the collision is the rule's logic. The fix was splitting the batch.

## 6. Why cost and latency are the blockers, precisely

`thinking_budget` on `gemini-3.1-flash-lite` is **a two-state switch wearing the costume
of an allowance**:

| setting | thoughts | H14 fixed |
|---|---|---|
| 1,024 / 2,048 / 4,096; level `MEDIUM` | **0** | no |
| 8,192 / 32,768 / −1; level `HIGH` | **62,914**, identical every time | yes |

Six settings, two independent APIs, no middle tier.

**And $0.094/doc is a floor, not a constant.** A retried deliberating call thinks twice —
125,824 tokens observed on Cornell, costing that document **$0.282**. Retries land
preferentially on that call because thinking consumes its output budget (62,914 of
`DEFAULT_MAX_OUTPUT_TOKENS = 65,535`, leaving ~2,600 for the answer), which also produces
an occasional `CdsGeminiTruncatedError` — a failure mode that did not exist before this
change.

The surrounding waste cannot make room:

```
base $0.0921/doc = input $0.0492 + output $0.0429
page redundancy 4.11x (879 sends / 214 pages)   <- not the 15.4x in §2; routing work already cut it
lever 2 ceiling (perfect dedup):  save $0.0197
lever 5 at −50% output:           save $0.0215
both at theoretical maximum:      $0.0510  →  +$0.0944 = $0.1454
```

Both ceilings are physically unreachable. **The cost floor and the accuracy floor cannot
both be satisfied with the levers available.**

## 7. The accuracy plateau, evidenced

15 remaining errors at config C, across 5 documents:

| cluster | n | lever status |
|---|---|---|
| uga `transfer_requirement_*` (`required_some` vs `recommended_some`) | 2 | **lever already applied** — `D5` is in `_COLUMN_POSITION_HINTS`, the table already gets rendered images, and the column is still misread |
| uga `aid_reporting_academic_year` / `_status` | 2 | genuine misreads (wrong year, wrong status) |
| `*_selected` survivors (cornell H10, dartmouth status) | 2 | resisted both the clause and the per-row sharpening |
| genuine misreads (`988` vs `170`, 3 booleans, 1 enum) | 5 | no common lever |
| singletons (url typo-repair, `has_application_closing_date`, `law_..._percent`, `sat_only_admission_policy`) | 4 | — |

**The floor requires ≤ 6.6 errors. There are 15, across at least 9 distinct mechanisms,
with every identified lever already applied and the one surviving pair tested against the
lever that would fix it.** This is a measured conclusion, not an estimate — which is the
difference between this statement and the one in the previous report.

## 8. Holdout — mechanical only

PennState has no ground truth (corpus capped at five documents by user directive), so the
§9 holdout tests whether the champion's *mechanics* generalise to an unseen 46-page
document:

```
pennstate_2022-2023   25/25 calls succeeded, 0 errors
                      352 findings, 334 reported
                      every call narrowed; 172 pages sent
                      citations span pages 1-38 of 46, all inside the document
                      one deliberating call, 62,909 thought tokens
                      $0.191005, 246.3s
```

Zero transport failures and universal narrowing on a document the tuning never saw is
meaningful evidence that bugs 1–3 are genuinely fixed rather than fitted to the five.
**It is not evidence of accuracy on PennState**, and the five-document aggregate remains
the only scored basis for any claim here.

## 9. Ranked next steps

1. **Fold the trailing H15 batch back in.** The split leaves a 1-metric batch; recovering
   it takes 25 calls → 24 and claws back some of the latency-floor breach. Requires
   relaxing ordering across the H14 boundary.
2. **Lever 2 (page-window dedup)** and **lever 5 (output schema)** — ~$0.041/doc combined;
   not enough alone, and the only cost levers left.
3. **Raise `max_output_tokens` for deliberating calls**, or accept the retry. Directly
   attacks both the truncation failure mode and the doubled-cost case.
4. **UGA holds 7 of 15 errors.** It is the only AcroForm document and the only one below
   99%; a focused pass there is worth more than a corpus-wide one.
5. Re-examine `aid_reporting_academic_year`/`_status` on UGA as possible catalog
   specification bugs rather than engine bugs.

## 10. Errors I made, and what corrected them

- **Stopped twice with work remaining.** First at 3 of 4 required non-improvements at 16%
  of budget; second with an identified, mechanism-understood fix listed as a "next step"
  and $15 unspent. Both times the loop had more than a point of accuracy left in it.
- **Asserted a residual was intractable without enumerating it.** 8 of the 22 were
  tractable.
- **Nearly rewrote ground truth toward the engine.** I commissioned a "blind" re-read of
  Caltech H14 and wrote the disputed premise into its own prompt, then treated the echo as
  independent confirmation. It would have handed the engine 11 free points. The reader
  flagged the flaw in its own "what would change my mind" section and I read past it.
- **Published a stale cost model twice** — projected $0.139 for a 32,768 budget (actual
  $0.1798, the budget is not a cap), then called $0.094/doc "irreducible" when a retry
  doubles it.
- **Weighted a synthetic probe over a real run.** A toy prompt showed `thinking_level`
  reaching cheap tiers; on the real batch `HIGH` spends 62,914. Same class of error as the
  `--domains` trap.
- **Four consecutive wrong predictions** (exp25–28) about *why* fixes worked — the most
  productive stretch of the loop. The rules in §5 exist because those predictions failed.
- Earlier: blamed `clean=True` for corruption the shipped default already produced, and
  published an H9/H10 "win" that was a `--domains` windowing artifact.

## 11. Escalations that are genuinely the user's

1. **Which configuration to ship** (§1) — the trade curve in §1. No option satisfies all
   floors; each accuracy step costs one.
2. **D7** — the published manifest hash diverged from disk (expected after the catalog cut
   and the instruction edits, but `scripts/cds_manifest_check.py` still pins the old value
   and its test fails).
3. **D8** — the read path lost vintage context in 10 of 13 domains.
4. **D18** — the holdout is unscored because the corpus was capped at five documents.
