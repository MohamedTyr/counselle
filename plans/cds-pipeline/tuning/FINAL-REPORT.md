# CDS extraction tuning — final report

Branch `feat/cds-pipeline`. Stopped under §9's plateau criterion: three consecutive
experiments (17, 18, 19) produced no lexicographic improvement, and the lever class
that might have produced one is exhausted — see "Why this stopped" below.

**Total model spend: $3.94** of the $25 rail.

---

## 1. Verdict against the §1 targets

| dimension | baseline | **champion** | target | floor | verdict |
|---|---|---|---|---|---|
| accuracy | 95.97%\* | **97.16%** | 100% | 99.5% | **fails floor** |
| coverage | 55.58% | **96.40%** | ≥98% | 95% | under target, above floor |
| hallucination | 12\* | **23** | 0 | 0 | **fails** |
| cost / doc | $0.0607\* | **$0.0921** | ≤$0.10 | ≤$0.15 | **passes** |
| latency / doc | 1062.4s | **315.5s** | ≤240s | ≤360s | over target, inside floor |
| failed calls | **35 of 115** | **0** | — | — | — |

\* The baseline's accuracy, hallucination and cost figures are **not trustworthy** and
must not be read as "the engine got worse". 35 of its 115 calls never completed, so it
was measured over 769 extractions against the champion's 1336, and it was cheap
precisely because a third of its work never ran. **Cheap-and-fast is the signature of a
broken run.**

The only clean baseline-vs-champion comparison is the two documents whose baseline had
zero failed calls:

- **Cornell** 97.91 / 97.93 → **97.94 / 99.59**, $0.0901 → $0.0884, 643.6s → 131.3s.
- **Dartmouth** 98.33 / 94.40 → **98.31 / 94.00**, $0.0935 → $0.0912, 492.7s → 190.9s.

No regression on either; Cornell improves on all four axes. The other three documents
were unmeasurable before and measure now.

**Two of five targets met (cost, and latency within floor). Accuracy and hallucination
are not met.**

## 2. Per-document champion results

| document | accuracy | coverage | cost | latency | failed calls |
|---|---|---|---|---|---|
| cornell_2022-2023 | 97.94 | 99.59 | $0.0884 | 131.3s | 0 |
| dartmouth_2024-2025 | 98.31 | 93.60 | $0.0917 | 217.3s | 0 |
| ucf_2023-2024 | 97.83 | 98.46 | $0.0932 | 303.7s | 0 |
| uga_2023-2024 | 96.60 | 94.19 | $0.0975 | 460.9s | 0 |
| caltech_2024-2025 | 94.98 | 96.20 | $0.0897 | 464.4s | 0 |

Aggregate buckets: **1298 correct / 15 wrong / 49 missed / 23 hallucinated.**

**A caveat the aggregate hides: latency is inside the 360s floor only on average.**
Per document, UGA (460.9s) and Caltech (464.4s) both **exceed the hard floor**, and
only Cornell (131.3s) is under the 240s target. If §1's latency floor is read
per-document rather than as a corpus mean — which is the reading that matters to a
user waiting on one upload — then latency fails on 2 of 5 documents. Cost, by
contrast, holds per-document: the worst is UGA at $0.0975, still under $0.10.

## 3. The champion config

Five engine changes, all committed, all production-quality:

1. **Compress the narrowed sub-PDF** (`deflate=True, garbage=4`). The default wrote it
   uncompressed with duplicated resources.
2. **Bake form fields before slicing** (`doc.bake()` when `is_form_pdf`). `insert_pdf`
   leaves the document-level AcroForm behind.
3. **Guard against inflation** — if a slice is ≥ its source, send the source.
4. **Correct the dead hint** `B4-B11` → `B4-B21`, plus whitespace tolerance around the
   dash in `_hint_pattern`. The line-start anchor is left intact and documented as
   load-bearing.
5. **Route on the densest hit-cluster, per hint** instead of the convex hull of all of
   a batch's hits.
6. **Send page images for column-position grids** (`C7`, `C9`, `C15`, `C16`, `D5`,
   `H12`, `H13`, `H14`), and for all-boolean batches on form PDFs send the images
   **instead of** the PDF.

## 4. What was actually wrong — three production bugs, not mistuning

The mission framed this as tuning. It was mostly repair.

**Bug 1 — "narrowing" inflated the payload.** A 5-page slice of Caltech's 2.14MB scan
measured **3.96MB, larger than the whole document.** Every call uploaded megabytes and
blew the 180s write deadline. Caltech failed 23/23 calls, UGA 9/23, UCF 3/23 — and
Cornell and Dartmouth, whose slices happened to stay under source size, failed none.
Raising the timeout to 600s did not help, which is what ruled out "slow network".

**Bug 2 — narrowing silently destroyed AcroForm values.** `insert_pdf` drops the
document-level form. UGA completed **23/23 calls with zero errors and 6.45% coverage**:
326 of its 350 findings came back `not_reported`. Not a crash — a confident, empty,
wrong answer, invisible to every signal except ground truth, and *masked* by bug 1
while those calls were timing out.

**Bug 3 — a hint literal that matched nothing.** Every CDS prints `B4-B21`; the config
said `B4-B11`. Seven metrics had always fallen back to whole-document routing.

**The sharpest single finding:** UGA's E1 page yields **32 empty-ballot-box glyphs and
zero checked ones** to text extraction, while visibly showing 15 ticked boxes. An
AcroForm tick lives in the widget's appearance stream — it renders and never becomes
text. So the text layer does not merely omit the answer, it *asserts the opposite*. The
model read it and returned `false` with the excerpt `"☐ Accelerated program"` — a
verbatim, honest quote of a lie. Every provenance signal passes.

## 5. The rule this loop established

| lever class | attempts | confirmed on a full run |
|---|---|---|
| telling the model something (prompt or catalog wording) | 3 | **0** |
| changing what the model receives | 4 | **3** |

Failed: "the text layer renders every checkbox empty, use the image"; "a metric's own
`instructions` outrank every general convention"; "OMIT the metric rather than
returning false". Each produced **zero** metric movement.

Worked: bake-before-slice; withhold the PDF for boolean form batches; images for
column-position grids.

> **When the engine is systematically wrong about a class of cell, fix the evidence,
> not the instructions.** An admonition against a strong model prior does not work.

## 6. Why this stopped, and what would move it next

Accuracy and hallucination are blocked on **instruction-following**, not on routing or
transport — both of which are solved (0 failed calls; every slice now smaller than its
source). Roughly 18 of the 23 hallucinations sit in two catalog rules the model
declines to follow:

- **Caltech H14 (11)** — instruction says a blank cell is "not_reported, never false";
  the engine returns `false`. Three wording changes moved it by zero.
- **The invented-selection family (~7)** — the engine reports a selection state for
  H9/H10 options whose template has no selection control, inferring it from an adjacent
  filled-in date.

§10 forbids wiring an output validator into the runtime, which is the one mechanism
that would deterministically fix both. The remaining honest options, none of which I
took unattended because each changes product behaviour or the yardstick:

1. **A different model for boolean-heavy batches.** The failure is instruction
   adherence, which is a model-capability axis this loop never varied.
2. **Re-examine whether the H14 rule is right.** Caltech left the entire non-need-based
   column unmarked; "we do not use these criteria" is a defensible reading, and `false`
   might be correct. That is a product decision about what the catalog means — and
   changing ground truth to match the engine is the wrong direction to move for a
   scoring win, so it needs a human.
3. **Revisit §10's no-validator rule** for the narrow case of a metric whose own
   instructions state an encoding that the model provably will not honour.

## 7. Holdout — mechanical only, and why

The user capped ground truth at five documents, so PennState has none and the §9
holdout gate cannot produce accuracy or coverage. What it can and did test is whether
the champion's *mechanics* generalise to a document the tuning never saw:

```
pennstate_2022-2023   46 pages   23/23 calls succeeded, 0 errors
                      347 findings, 333 reported
                      every call narrowed; 163 pages sent, mean 7.1, max 13
                      citations span pages 1-38, all inside the document
                      $0.094971
```

Zero transport failures and universal narrowing on an unseen 46-page document is
meaningful evidence that bugs 1–3 are genuinely fixed rather than fitted to the five
tuning documents. **It is not evidence of accuracy on PennState, and the five-document
aggregate remains the only scored basis for any claim in this report.**

## 8. Methodology notes that changed conclusions

- **The engine is deterministic.** Dartmouth re-ran with identical accuracy, coverage
  and bucket counts. All run-to-run variance is transport failures. Coverage exposes a
  dead call; accuracy is nearly blind to one, since it drops metrics from numerator and
  denominator alike. **Re-run, never average.**
- **A `--domains`-filtered run is not representative.** `padded_domain_ranges` grows
  each window toward the next routed section's start across all routed ranges in the
  run, so filtering removes the neighbours that clamp it and every window widens. This
  produced one false positive I published and then retracted (experiment 17).
- **Measure the baseline of a comparison, not just the variants.** I nearly attributed
  content corruption to a compression flag; the shipped default already produced the
  same corruption.

## 9. Filed, not done

- Scorer hardening: a total-failure run emits a fitness tuple whose `-0.0` cost **wins**
  the cost axis against a working config.
- A config test asserting every `source_hints` literal matches ≥1 page in ≥1 reference
  document. Both dead-hint bugs would have been caught at commit time.
- Remove the `cover page` pseudo-hint (prose, not a CDS code).
- Escalations from the decision log: D7 (published manifest hash diverged from disk),
  D8 (read path lost vintage context in 10/13 domains), D18 (holdout is unscored).
