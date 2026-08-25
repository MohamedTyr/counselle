# CDS extraction tuning — final report

Branch `feat/cds-pipeline`. **Total model spend: $10.09** of the $25 rail.

This supersedes the earlier version of this file, which was written prematurely — it
declared a plateau at three non-improving experiments where §9 requires four, at 16% of
the budget, and it escalated to the user three questions of which only one was genuinely
theirs. Everything below is measured against ground truth that was itself corrected
during this session.

---

## 1. Verdict against the §1 targets

Two admissible configurations, and the choice between them is a real decision rather
than a ranking:

| dimension | baseline | **A: champion (exp15)** | **B: exp29** | target | floor |
|---|---|---|---|---|---|
| accuracy | 95.97%\* | 96.86% | **98.33%** | 100% | 99.5% |
| coverage | 55.58%\* | **97.03%** | **97.03%** | ≥98% | 95% |
| hallucinations | 12\* | 27 | **8** | 0 | 0 |
| cost / doc | $0.0607\* | **$0.0921** ✅ | $0.1876 ❌ | ≤$0.10 | ≤$0.15 |
| latency / doc | 1062s | **315.5s** ✅ | 354.2s ✅ | ≤240s | ≤360s |
| failed calls | 35 of 115 | **0** | **0** | — | — |

\* Baseline figures are untrustworthy: 35 of its 115 calls never completed, so it was
measured over 769 extractions against 1337, and it was cheap *because* a third of its
work never ran.

**Neither configuration meets the §1 accuracy floor.** Config B fails the cost floor by
25%; config A fails accuracy and hallucination by a wide margin. **B is better on every
quality axis and identical on coverage** — it wins accuracy, hallucinations and `wrong`,
and loses only cost.

**I did not crown B.** §1's floors are immutable under §8b and lexicographic priority
orders comparisons *between admissible configs* — it does not license admitting an
inadmissible one. Promoting B because it wins the axis I care most about is how a tuning
loop launders a constraint violation into a result. **That call is the user's.**

## 2. What the loop actually achieved

Against the (corrected) ground truth, from the shipped baseline:

- **coverage 55.58% → 97.03%** — three production bugs fixed
- **failed calls 35 of 115 → 0**
- **latency 1062s → 315–354s**
- **hallucinations 27 → 8** (config B), a 70% reduction
- **accuracy 96.86% → 98.33%** (config B)

Per document under config B: caltech 94.98 → **98.68**, ucf 96.59 → **98.74**,
dartmouth 98.31 → **99.15**, uga 96.60 → 97.27, cornell 97.94 → 97.94.

## 3. The three production bugs (found by running the engine, not reading it)

1. **Narrowing inflated the payload.** A 5-page slice of Caltech's 2.14MB scan measured
   **3.96MB — larger than the whole document.** Every call blew the write deadline.
   Caltech failed 23/23, UGA 9/23, UCF 3/23. Fixed with `deflate=True, garbage=4` plus a
   guard that sends the source when a slice is not smaller.
2. **Narrowing silently destroyed AcroForm values.** `insert_pdf` leaves the
   document-level form behind. UGA completed **23/23 calls with zero errors and 6.45%
   coverage** — 326 of 350 findings `not_reported`. Not a crash: a confident, empty,
   wrong answer, masked by bug 1. Fixed by `doc.bake()` before slicing.
3. **A hint literal that matched nothing.** Every CDS prints `B4-B21`; the config said
   `B4-B11`. Seven metrics had always fallen back to whole-document routing.

**The sharpest single finding:** UGA's E1 page yields **32 empty-ballot-box glyphs and
zero checked ones** to text extraction while visibly showing 15 ticked boxes. An AcroForm
tick lives in the widget's appearance stream — it renders and never becomes text. The
text layer does not omit the answer, it *asserts the opposite*, and the model quoted it
verbatim. Every provenance signal passes.

## 4. Ground truth was wrong, and correcting it cost the engine points

Two defects, both traced to decision **D12**, which replaced UGA's two independent
reading passes with mechanical AcroForm harvesting:

- **`identity.state_or_region`** — GT `GA`, page renders `Georgia`. The widget is a
  ComboBox whose stored export value differs from its display label. Audited: only this
  one metric of 76 choice widgets is affected.
- **H14 across two documents** — UGA (9 metrics) and UCF (4) recorded visibly-present
  but *unticked* checkboxes as `present`/`false`. The catalog forbids this in all twelve
  `h14_*` metrics: *"a blank cell in this or any other visible H14 coordinate is
  not_reported, **never false**."* Three independent adjudications agreed, each finding
  the same decisive in-catalog contrast: **H12 explicitly authorises false-closure**
  ("false only when the complete visible checklist is present and that named box is
  unambiguously unmarked") **while H14 pointedly does not.**

13 metrics re-sealed. **The correction made the champion look worse** (96.86% from
97.16%, hallucinations 23 → 27) — which is the point. A GT change that only ever helps
the engine should be distrusted on sight.

D12 is now 2-for-2 on producing ground-truth defects. `pypdf.get_fields()` is bit-for-bit
truth about *field contents*; it is not a substitute for reading the page against the
catalog.

## 5. The mechanisms this loop established

**Fix the evidence, not the instructions** — with an important refinement:

| lever class | outcome |
|---|---|
| wording that asserts a policy ("the text layer lies", "instructions outrank conventions", "OMIT rather than false") | **0 for 3** |
| wording that names an **observable** ("is a control drawn beside this row?") | **worked** |
| changing what the model receives (bake-before-slice, images-only for form batches, grid images) | **3 for 4** |
| reasoning budget on a batch violating an explicit rule | **worked** |

Three rules worth keeping:

1. **Wording works when it names something checkable on the page.** The failed wording
   changes had nothing for the model to verify; the successful one gave it a test.
2. **Deliberation enforces a rule the model is violating; it cannot supply a rule that is
   absent.** H14 had a rule and was ignoring it → reasoning fixed all 11. H9 had no
   applicable rule → reasoning changed nothing, and wording fixed it.
3. **`instructions` are batch-scoped, not metric-scoped.** `_build_prompt` serialises
   every metric in a batch into one payload. Two families with opposite closure rules
   cannot share a batch — with the H9 clause applied to all five `*_selected` metrics,
   H14 broke, and *rewording it did not help* because the collision is the rule's logic,
   not its phrasing. The fix was scoping.

## 6. Why cost is the blocker, precisely

`thinking_budget` on `gemini-3.1-flash-lite` is **a two-state switch wearing the costume
of an allowance**:

| setting | thoughts spent | H14 fixed |
|---|---|---|
| 1,024 / 2,048 / 4,096; level `MEDIUM` | **0** | no |
| 8,192 / 32,768 / −1; level `HIGH` | **62,914** (identical every time) | yes |

Six settings across two independent APIs, no middle tier. **$0.094/doc is the
irreducible price** of the H14 fix. There is no knob to turn.

And the surrounding waste cannot make room for it. Measured, not assumed:

```
base $0.0921/doc  =  input $0.0492 + output $0.0429
page redundancy    4.11x  (879 sends / 214 pages)  — not the 15.4x in §2; routing work already cut it
lever 2 ceiling (perfect dedup, 1 send/page):  save $0.0197
lever 5 at −50% output tokens:                 save $0.0215
base with BOTH at their theoretical maximum:   $0.0510  →  + $0.0944 = $0.1454
```

That "fits" $0.15 by 3%, but only at ceilings that are physically unreachable (batches
need overlapping context; output cannot halve for free). Realistically it lands ~$0.16.
**The cost floor and the accuracy floor cannot both be satisfied with the levers
available.**

## 7. A new failure mode config B introduces

`CdsGeminiTruncatedError` on the deliberating batch. Thinking bills against the output
budget, so 62,914 of `DEFAULT_MAX_OUTPUT_TOKENS = 65,535` are consumed before the answer
begins, leaving ~2,600 tokens for a 21-metric response. Observed once (1 of 5 failures
this session; the other four were ordinary SSL/timeout transport errors that predate
deliberation), so it is uncommon — but it **did not exist before this change**. Any
deployment should raise the output ceiling for deliberating calls or accept a retry.

## 8. Holdout — mechanical only

PennState has no ground truth (the corpus was capped at five documents by user
directive), so the §9 holdout can only test whether the champion's *mechanics* generalise
to an unseen 46-page document:

```
pennstate_2022-2023   23/23 calls succeeded, 0 errors
                      359 findings, 335 reported
                      every call narrowed; 163 pages sent
                      citations span pages 1-38, all inside the document
                      one deliberating call, 62,910 thought tokens
                      $0.190608, 220.9s
```

Zero transport failures and universal narrowing on a document the tuning never saw is
meaningful evidence that bugs 1–3 are genuinely fixed rather than fitted to the five.
**It is not evidence of accuracy on PennState**, and the five-document aggregate remains
the only scored basis for any claim here.

## 9. Where the remaining 22 errors are

Config B: 14 wrong + 8 hallucinated.

| family | count | tractable? |
|---|---|---|
| `aid_notification_*_selected` (H10) | 5 halluc | **yes** — needs the batch split so H10 stops sharing a prompt with H14 |
| formatting / value-splitting (`2022-2023 Final`, `12 15` vs `12/15`) | 4 wrong | catalog under-specification; adjudicated as genuine engine errors |
| enum precision (`required_some` vs `recommended_some`) | 3 wrong | unclear |
| genuine misreads (`988` vs `170`) | 4 wrong | no common lever |
| singletons incl. the URL typo-repair | 6 | — |

**The 99.5% accuracy floor needs errors ≤ 6.6. There are 22, and after the one tractable
family there would be 17 heterogeneous ones with no shared lever.** The floor is not
reachable from here.

Ranked next steps:
1. **Split the H10 metrics out of the H14 batch** — the one identified, mechanism-understood fix left. Worth ~5 hallucinations.
2. **Lever 2 (page-window dedup)** and **lever 5 (output schema)** — worth ~$0.041/doc combined, not enough alone but the only cost levers left.
3. Raise the output ceiling for deliberating calls (§7).
4. Re-examine the four formatting disputes as catalog specification bugs rather than engine bugs.

## 10. Errors I made, and what corrected them

- **Declared a plateau at 3 of 4 required non-improvements, at 16% of budget.** The loop
  had a further 1.47pp of accuracy and 19 hallucinations in it.
- **Nearly rewrote ground truth toward the engine.** I commissioned a "blind" re-read of
  Caltech H14 and wrote the disputed premise into its prompt ("an unticked box is
  `present`/`false`"), then treated the echo as independent confirmation. The reader even
  flagged the seam in its own "what would change my mind" section and I read past it.
  **A blind read gets the page, the catalog and the question — never the answer key's
  contested clause.**
- **Four consecutive wrong predictions** (exp25–28) about *why* fixes worked. Each
  correction sharpened the mechanism; the final rules in §5 exist only because the
  predictions failed.
- **Published a stale cost model.** Projected $0.139 for a 32,768 budget; actual $0.1798,
  because the budget is not a cap.
- **Weighted a synthetic probe over a real run.** A toy prompt showed `thinking_level`
  reaching cheap tiers (127/521/1050 thoughts); on the real batch `HIGH` spends 62,914.
  Same class of error as the `--domains` trap: probes scope a question, only a full run
  answers it.
- Earlier in the loop: blamed `clean=True` for corruption the shipped default already
  produced, and published an H9/H10 "win" that was a `--domains` windowing artifact.

## 11. Escalations that are genuinely the user's

1. **Which configuration to ship** (§1). B is better on every quality axis and busts the
   cost floor by 25%. A is compliant and materially less accurate. Cost and accuracy
   floors cannot both be met.
2. **D7** — the published manifest hash diverged from disk (expected after the catalog
   cut, but `scripts/cds_manifest_check.py` still pins the old value).
3. **D8** — the read path lost vintage context in 10 of 13 domains.
4. **D18** — the holdout is unscored because the corpus was capped at five documents.
