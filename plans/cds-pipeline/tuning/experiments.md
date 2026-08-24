# CDS Extraction Tuning — Experiment Ledger

Append-only. One numbered entry per experiment or milestone. Never edit a past entry
except to append a `CORRECTION:` line. Operating manual: `plans/cds-pipeline/tuning-loop-prompt.md`.

**Budget rail:** $25 cumulative model spend (§9). Every entry records cumulative spend.

---

## DECISIONS-MADE-ALONE

The user is away (§8b). Every call that would normally be escalated is logged here with
its reasoning, for review on their return.

| # | Date | Decision | Reasoning | Reversible? |
|---|---|---|---|---|
| D1 | 2026-08-23 | **`context_bindings` pruning rule for the M1 cut.** For each block: if every one of its `binders` metric ids survives the cut → keep the block and prune `targets.metric_ids` down to surviving ids (delete the block if that list empties). If ANY binder metric id is cut → delete the whole block. **Never re-add a cut metric to keep a binding alive.** | §8 makes set-equality with METRICS-KEEP.md's 394 ids the hard gate and explicitly instructs pruning dead `context_bindings` target lists. A binding whose binder metric no longer exists cannot supply its context value, so keeping it would ship a binding that silently resolves to nothing. The alternative — re-adding binder metrics — would break the 394 set equality, which §8 calls authoritative and user-approved. Conservative because it spends nothing and is a pure config revert. | Yes — `git revert` the M1 commit. |
| D3 | 2026-08-23 | **Ohio State 2023-24 (187pp) is NOT one of the 5 tuning docs**, despite being the corpus's clearest "long/oddly-ordered" case. `ucf_2023-2024` (48pp) takes archetype E instead. | Every experiment pays for every tuning doc on every run. A 187-page document — 5.8× the median corpus length, with 52 near-blank pages — would dominate both the $25 experiment budget and the GT-building effort, buying one data point at the cost of several experiments. UCF still exercises the archetype: 48pp (2nd longest practical), plus NBSP-instead-of-space headings that break the `_hit_pages_for_hints` regex anchors — the routing-miss failure mode we most need represented. Ohio State's pagination-bloat behaviour is recorded as a known, deliberate coverage gap in the final report. | Yes — it can be added as a 6th tuning doc if budget allows. |
| D4 | 2026-08-23 | **Bounded attempt to source an AcroForm CDS from the web** (~15 tool calls), rather than dropping §4's archetype-3 outright. Fallback if it fails: `michigan_2024-2025`. | §4 makes AcroForm field data a sealing condition for that document, and no corpus file has any form fields (verified: 0/15). §8b says prefer measuring over assuming, so a cheap bounded probe beats assuming it's unobtainable — but it is time-boxed so a failure costs little. Michigan is the right fallback because it exercises the `I1` vs `I-1` anchor-hyphen variance (a distinct routing-miss mode) rather than duplicating Cornell's decoupled-Excel archetype. | Yes — downloads land in gitignored `artifacts/`. |
| D5 | 2026-08-23 | **§9's $25 cap is tracked as extraction-engine model spend**, not total subagent token cost. | §9 anchors the cap with "full 5-doc eval ≈ $1.50 at baseline", which is unambiguously per-run engine spend — the number only parses that way. Orchestration/GT subagent tokens are a separate, much larger quantity that the cap was not written against. Flagging explicitly rather than silently choosing an interpretation; GT fan-out is independently bounded by scoping to the 394 kept metrics and grouping small domains per pass. | N/A — accounting choice, logged for the user's review. |
| D6 | 2026-08-23 | **Deleted the `_gender_sum_flags` validator rather than resurrecting its metrics** (review finding F1). | Its 12 hardcoded refs (`admissions.applicants_men/women/another_gender/unknown` + admitted/enrolled equivalents) were all cut, so `metrics.get(ref)` returns `None` and the check `continue`s — it silently never fires again on a live packet path (`engine.py:451`). Its tests pass only because they build synthetic packets bypassing the manifest, so the suite actively gives false confidence. The metrics are gone under METRICS-KEEP's explicit liability rule and are never coming back, so the check can never fire for any real document again. A validator that silently no-ops is precisely the silent failure AGENTS.md forbids; deleting it is the honest option and the smaller diff. | Yes — `git revert`. |
| D7 | 2026-08-23 | **Did NOT republish the manifest or bump its version, despite `config/cds/manifest.yaml` still declaring `5.0.2` while its content hash has changed** (finding F2). **ESCALATED — needs the user before ship.** | §8 explicitly forbids touching the hash-mismatch machinery or preserving the old hash, and republishing writes to `cds_library`, well outside tuning scope. It blocks nothing I'm doing: `verify_manifest_current` is called from nowhere in the repo (dead code today), and the tuning harness compiles from disk. But the *published* contract and the *authored* contract have now genuinely diverged under the same version string — a real contract violation someone must resolve deliberately. Also leaves 2 tests pinning the old hash failing; I left them failing rather than churning a pinned hash that will change again with every catalog touch this loop makes. | N/A — deliberately not done. |
| D8 | 2026-08-23 | **Accepted the loss of compiled period/cohort context in 10 of 13 domains as an unfixable consequence** (finding F4). **ESCALATED — user should know.** | `counselle_db/packets.py:428` builds a metric's vintage string by iterating `definition.contexts`; with the block deleted that tuple is empty, so the loop never runs — no error, the student-facing value just silently loses its "; entering class: Fall 2024" style suffix. `service.py:795` likewise stops join-querying binder domains. The only fix would be re-adding cut binder metrics, which breaks the 394 set equality that §8 calls authoritative and user-approved. So it cannot be fixed inside my mandate. Recording it loudly because it touches student-facing honesty about data vintage. | No — inherent to the approved cut. |
| D9 | 2026-08-23 | **Ruled on unchecked-checkbox GT semantics** (scorer finding HIGH-2). Box exists on the form but is unticked → `present`/`false`. Question absent from this document's template edition → `absent`. `blank` is reserved for empty fill-in value cells and is **never** used for checkboxes. | The schema was silent, and the two readings produce *opposite* outcomes (`hallucinated` vs `missed`) on the largest rule bucket — 85 of 394 metrics. Six independent GT authors would have split, injecting phantom hallucinations against a zero-tolerance target and phantom misses against coverage. The absent-vs-false distinction is not pedantry: METRICS-KEEP trap #1 states "An unchecked box is not a 'no' — the school may have used an older template edition," so collapsing them ships a false negative. Chose the reading that preserves that distinction. | Yes — GT is re-derivable; rule is documented in GT-SCHEMA.md. |
| D10 | 2026-08-23 | **Ruled the scorer must emit an explicit lexicographic fitness tuple** `(accuracy, coverage, -cost, -latency)`, with zero-extraction ranking **last** on accuracy rather than first. | The review proved accuracy is trivially gamed: abstain on everything → `accuracy_pct=None`; extract one correct value and abstain on the rest → **accuracy 100%, coverage 25%**. A loop ranking on accuracy alone would have selected maximal abstention — it would have optimised toward an engine that extracts nothing. The tuple order is fixed by §1 and not mine to change; what I added is the sentinel so `None` can never sort as "best". | Yes — scorer-local, versioned. |
| D11 | 2026-08-23 | **Refined D9: an unselected RADIO/enum group is `blank`, not `false`.** D9's `present`/`false` rule applies only to standalone checkboxes, where the box itself is the binary. | Raised by the UGA GT agent, and it is right. A standalone checkbox that is unticked *is* the institution's answer ("we don't offer this"). But a radio group — C8A exam choice, a C14 Yes/No pair, D10 open-admission Yes/No — with nothing selected means the institution **did not answer the question**, which is exactly the definition of `blank` (a value cell that exists but is empty). Recording it as `false` would invent an answer the school never gave and would charge the engine with a miss for correctly abstaining. | Yes — documented in GT-SCHEMA.md. |
| D12 | 2026-08-23 | **For the AcroForm document only, replaced §4's two independent model reading passes with one exact AcroForm extraction plus targeted independent verification of the risky MAPPINGS.** | §4's two-pass-plus-adjudication protocol exists to converge on a true value when reading is fallible. For UGA the *values* are machine-exact — `pypdf.get_fields()` is bit-for-bit truth, and §4 step 5 already names it the sealing condition for this document. The fallible step is not reading the value but attributing a field to a metric. So a second full model read would spend heavily re-deriving values that are already exact while leaving the actual error surface unverified. Verification is instead aimed at the mapping: the C7 off-by-one inference, the G1 nonresident/out-of-state trap, both duplicate-id pairs, 20 weighted spot-checks, and the blank-vs-absent classification — all read from 300 DPI rendered images, never the text layer. Faithful to §4's intent, cheaper, and aimed at where errors actually live. | Yes — a full second pass can still be run if verification finds real mapping errors. |
| D13 | 2026-08-24 | **Ground truth records the RENDERED value, not a hidden raw AcroForm value, where the two disagree.** UGA's two `outcomes` ratios hold raw `0.8807`/`.83534` but their widget appearance streams render as `0.88`/`0.84`; GT takes the rendered form, keeping the raw value alongside as evidence. **Rejected the suggested alternative of a rounding tolerance in the scorer.** | The engine can only ever see the rendered page, so scoring it against a precision it has no way to access measures an impossible task and would book guaranteed false negatives as engine errors. §4 mandates GT from rendered page images for exactly this class of reason. The tolerance alternative was worse on two counts: §5 forbids fuzzy credit outright, and loosening the comparator to accommodate one document would weaken every comparison the loop makes for the rest of the run — a permanent cost for a local fix. Fixing the two GT values costs nothing and keeps the scorer strict. | Yes — both raw and rendered values retained in the file. |
| D14 | 2026-08-24 | **Page-index method is chosen per document by measured text-layer health, not uniformly.** Caltech (corrupt) is indexed by reading every page as an image; UCF, Dartmouth and Cornell are indexed from their text layers and then verified against rendered images on an 8-page sample. | §4 mandates rendered images for ground truth, and the *reason* it gives is corrupt text layers. Corpus profiling measured that reason precisely: Caltech carries 1,775 control chars across 49 of 50 pages, while Dartmouth and Cornell have **zero** and UCF has 5. Reading 130 clean pages as images to guard against corruption that was measured absent spends heavily for no information. The image-verified sample keeps the check honest — and if any sampled page disagrees with the text scan, the method is unsafe for that document and I want to know immediately rather than discover it in a sealed GT file. Value extraction still comes from images everywhere, per §4; this decision covers the *index* step only. | Yes — a full image index can be run for any document if verification disagrees. |
| D15 | 2026-08-24 | **Cap image-reading subagents at ~25 pages and require incremental writes.** | Two agents stalled after 600s of no progress, both while reading large image batches — 98 pages in one, 66 in another. The work wasn't wrong, the batching was. Splitting by page range and writing output after every ~6 pages means a stall costs one batch instead of a whole document. Recorded because it will recur across the remaining GT work. | N/A — process fix. |
| D16 | 2026-08-24 | **Subagent completion status is never trusted; every agent's output is verified on disk by me before it is believed or acted on.** A `failed`/stalled notification does NOT mean the work is absent, and a `completed` notification does NOT mean the work is whole. | Five agents have now hit the 600s watchdog, and the stalls are *uncorrelated with the work landing*: the scorer agent stalled while reporting, but its fix was complete on disk (140/140 green, gate met); the Caltech agent stalled mid-batch, leaving seven placeholder page entries that a key-presence check happily accepted. Both failure modes are silent in opposite directions, so the status field carries no usable signal either way. This is the same lesson M1 taught three times — a scan is only as good as an independent re-derivation — now applied to agent bookkeeping rather than agent findings. | N/A — process fix, supersedes trusting D15's split alone. |
| D17 | 2026-08-24 | **A page index is complete only when every page entry has a non-empty `sections` list or an explicit note that the page carries no heading. Never assert completeness on the key set.** | I asserted `sorted(pages.keys()) == range(1,51)` on the merged Caltech index, called it 50/50 complete, and published a false "Caltech has no C9" finding built on seven `"pending batch 4"` placeholders. Placeholder entries satisfy every structural check that looks at keys. The property that actually matters is content, and it costs one extra line to assert. | N/A — process fix; the Caltech finding it produced is retracted in the M2 section below. |
| D2 | 2026-08-23 | **Stale `instructions` prose is reported in M1, fixed in a separate pass.** The M1 cut fixes only structural references; prose referencing deleted metric ids is inventoried, not rewritten. | ~800 backtick references live in free-text `instructions` and are never compiler-validated, so a bad bulk rewrite would ship silently-wrong extraction guidance with no gate to catch it. Splitting keeps M1 verifiable by a hard compile + set-equality check. The prose sweep then runs against a written inventory with its own review. | Yes — both passes are config-only commits. |

---

## Entry 0 — Phase 0 mental model

Cumulative spend: $0.00 (no extraction-engine model calls yet).

### Where every token comes from

The engine's cost is `prompt ≈ 592×pages_sent + 280×metrics`, `output ≈ 71×metrics`.
The `metrics` term is batching-invariant. The `pages_sent` term is the waste, and Phase 0
found its exact mechanism:

**Routing is per-BATCH, not per-domain** (`app/cds/engine.py:186 _route_batches`, engine.py
docstring "decision 7"). Each batch regex-matches *only its own metrics' `source_hints`*
against page text, takes `(min_hit, max_hit)`, pads ±2 pages (`DEFAULT_ROUTING_PAGE_PAD`,
`domain/cds/pages.py:22`) with up to +6 more on the trailing edge
(`MAX_TRAILING_PAD_EXTRA`, pages.py:31), then `narrow_document()` slices a fresh sub-PDF
that is uploaded with that call.

Batches are domain-scoped and packed to ≤25 metrics from contiguous `source_hints`
sections (`app/cds/manifest.py:92 metric_batches_for_domain`, ceiling
`DEFAULT_METRIC_BATCH_SIZE = 25` at manifest.py:32). So `admissions` (152 metrics) becomes
~7 batches, each independently routing to overlapping C-section pages, each re-uploading
substantially the same pages. That is the 15.4× page-send redundancy — it is a direct,
mechanical consequence of decision 7, not a routing bug.

Three amplifiers stack on top:
- `merge_page_ranges` merges ranges with gap ≤1 (pages.py:252), so neighbouring batches'
  windows physically overlap even though computed independently.
- Per-batch retry (`engine.py:339 _retry_clusters`) re-sends a *widened* window
  (`RETRY_WIDEN_PAGE_PAD = 6`) on zero findings or a dropped citation.
- `starved_retry` (`app/cds/starved_retry.py:30`) fires one extra call per still-empty
  routed domain, carrying that domain's **entire unbatched** metric catalog — up to 152
  metrics in a single call for `admissions`, i.e. squarely inside the measured
  catastrophic-truncation band (127–169 metrics → 0.7–1.6% accuracy).

### Where every error comes from

Prior work's taxonomy, with the mechanism now attached:
- `routing-miss` — regex anchor variance (`I1` vs `I-1`; NBSP headings on UCF) makes
  `_hit_pages_for_hints` miss, batch falls back to whole-document or wrong window.
- `truncation` — batch too large; the 127–169 band is proven catastrophic and
  `starved_retry` walks straight into it.
- `label-confusion` — Excel-export PDFs (Harvard, Cornell) emit labels and values as
  separately-ordered text blocks; C7 checkbox grids lose column position entirely.
- `corrupt text layer` — Caltech's broken ToUnicode CMap silently shifts digits. Routing
  reads the text layer, so corruption poisons routing *and* extraction.
- `citation position vs original page` — the model cites sub-PDF position rather than the
  instructed original page in >79% of narrowed calls; `citation_remap.py` compensates.

### Consequences for the plan

1. The §8 catalog cut (1,149 → 394) is not just scope reduction: metrics fall 66%, which
   drops the `280×metrics` and `71×metrics` terms directly AND cuts batch count ~63 → ~25,
   which drops `pages_sent` roughly proportionally. The cut alone may land cost near the
   $0.10 target before any tuning. Baseline must therefore be measured post-cut (§8).
2. The top two levers — per-domain routing consolidation (§7 lever 2) and raising the
   batch ceiling (§7 lever 1) — attack the *same* quantity (number of independent page
   windows). They are not additive; test them separately before combining.
3. `starved_retry`'s unbatched full-domain call is a latent accuracy hazard, not just a
   cost one. Flag for the autopsy taxonomy: any domain rescued by starved-retry on a
   large catalog is suspect.
4. `_estimate_cost_usd` (engine.py:497) omits `thoughts_tokens` and `cached_tokens`.
   Fine while thinking is off; it must be fixed before any thinking-budget experiment.

### M1 — catalog cut applied (review in progress)

Catalog cut 1,149 → 394. Diff is **0 insertions / 13,520 deletions** — pure deletion,
nothing reordered or reformatted. New manifest content hash
`c740dd64e632b9b525baf899abbb419fc092a1f47249c222e1f8925358a92538` (was `c821b2e6…`).

Set equality verified in both directions: 394 in manifest, 394 in keep list, both
difference sets empty. Per-domain: academics 34→24, admissions 152→98, class_profile
127→36, class_size 22→17, cost 47→43, degrees 129→41, enrollment 134→4, faculty 31→4,
financial_aid 169→67, identity 50→14, outcomes 114→10, student_life 63→13, transfer 77→23.

**`context_bindings`: only 2 of 21 blocks survive.** Kept under R3b:
`cost.reporting_academic_year` (42 of 46 targets) and `financial_aid.aid_reporting_period`
(22 of 78). The other **19 were deleted under R3a** — every one of them because its binder
metric was cut. Zero R3c deletions; nothing was re-added to save a binding.

**This is a bigger consequence than "fewer metrics."** All 19 binders were reporting
scaffolding (`*_entry_term`, `*_cohort_year`, `*_reporting_term`,
`enrollment_snapshot_term_or_date`) and METRICS-KEEP cuts that family wholesale — so
**11 of 13 domains lose their compiled period-context layer entirely.** Surviving metrics
now carry period only via their own `period_kind`. This follows D1 correctly, but it is a
real behaviour change, not bookkeeping.

**117 stale prose references** survive: `instructions` text on surviving metrics that
names a now-deleted metric id. This text goes to the model verbatim in every prompt.

### M1 review round 1

**Reviewer A (independent correctness re-derivation): 0 CRITICAL, 1 HIGH, 0 MEDIUM, 0 LOW.**

Passing checks, each with a number behind it: keep-set equality re-derived with an
independent parser (394, both diffs empty); all 13 per-domain counts exact; the
`(domain, id)` duplicate trap correct in both directions (`admissions.yaml:139/157/174`,
`transfer.yaml:27/38/49`); `enrollment.yaml` inline form intact with its 4 survivors;
diff pure deletion (`git diff | grep '^\+[^+]'` → 0 matches); 20 surviving metrics diffed
field-by-field against `HEAD` with zero drift; orphan-comment class checked across all 13
files and clean; compile gate reproduces `c740dd64…`; nothing modified outside scope.

**HIGH — ACCEPTED (finding F1).** The `student_life.cds_edition` binding was deleted under
R3a, but its sole binder is `identity.academic_year` — a **cross-domain, dot-qualified**
reference that *survives* the cut. Six ROTC targets also survive, so R3c doesn't apply
either. Correct disposition was R3b: keep, prune targets 30→6. The cut script evidently
resolved only bare local ids and failed on the dotted form. `identity.academic_year` is
the only dot-qualified binder in the whole `config/cds/` tree, so this is singular, not a
pattern — Reviewer A verified that by scanning all 21 original blocks.

Consequence had it shipped: the 6 surviving ROTC metrics silently lose their CDS-edition
year context — the vintage stamp their values must be read against.

**This also falsifies a builder claim.** Its report asserted "each of the 19 deletions
genuinely had a cut binder." Corrected disposition: **18 deleted, 3 kept.** Logged as a
reminder that a subagent's summary claim is not evidence — Reviewer A caught this only
because it re-derived the rule independently rather than re-running the builder's script.

Sent to a fixer subagent (distinct from both builder and reviewer). Review re-runs after.

### M1 review round 2 — blast radius

**Reviewer B: 2 CRITICAL, 4 HIGH, 2 MEDIUM, 2 LOW.** My triage:

| # | Sev | Finding | Ruling |
|---|---|---|---|
| F1 | CRITICAL | `_gender_sum_flags` silently dead — 12 hardcoded refs all cut, `metrics.get`→`None`→`continue`, no error, on the live `engine.py:451` path. Tests pass vacuously via synthetic packets. | **ACCEPTED** → delete (D6) |
| F2 | CRITICAL | Published manifest `5.0.2` in DB carries old hash; disk now differs under the same version. `verify_manifest_current` is dead code (called nowhere); `scripts/cds_manifest_check.py` fails only on manual run, not CI-wired. | **REJECTED as fix-now, ESCALATED** (D7) |
| F3 | HIGH | Cut report misstates `cds_edition` as deleted; true count is 3 of 21 surviving, 18 deleted. | **ACCEPTED** → correct the report |
| F4 | HIGH | Read path loses vintage/context strings in 10 of 13 domains — silent, no exception. | **ACCEPTED as consequence, ESCALATED** (D8) |
| F5 | MEDIUM | `docs/DATABASE_GUIDE.md:169` worked example uses a deleted context block. | **ACCEPTED** → replace with real compiled JSON |
| F6 | HIGH | 117 stale `instructions` refs across 61 metrics, embedded verbatim into every prompt by `engine.py:244 _build_prompt` — no filtering anywhere. | **ACCEPTED** → prose sweep, blocks baseline |
| F7 | LOW | Test suite: 10 failed / 1675 passed. Reviewer stashed the cut and confirmed the same 8 fail identically → pre-existing. Only 2 new failures, both expected hash pins. No test hardcodes metric counts. | **ACCEPTED informational** |
| F8 | LOW | Old hash `c821b2e6` appears only in ADRs, plan docs, and a docstring — no live gates beyond F2/F7. | **ACCEPTED informational** |

**F6 is the one that matters for the loop.** The mechanism is now proven, not suspected:
`_build_prompt` serialises the compiled metric dicts straight into the prompt with
`instructions` included and no filtering in `batching.py` or `engine.py`. So every affected
call currently carries a self-contradictory instruction — "bind this to `X`" where `X` is
absent from the very catalog the same prompt encloses. Measuring a baseline against that
would bake my own breakage into the reference point.

Reviewer B independently arrived at the corrected 3-of-21 / 18-deleted disposition,
confirming the round-1 fix landed.

### M1 fixes applied — prose sweep found a 2.8× undercount

**The cut report's "117 refs / 61 pairs" was badly wrong. Truth: 325 dead references
across 151 (domain, metric) pairs**, repaired by 34 sentence-level rewrites across 165
substitution sites.

The report missed `degrees` **entirely** — the single largest block at 123 refs / 41
metrics, one sentence repeated across all 41 naming three dead ids. Root cause: `cip_version`
is a **2-segment id**, invisible to the 3+-segment heuristic the original scan used. Also
missed: `admissions` (36/20), `class_size` (18/17), `transfer` (6/3); `financial_aid` was
counted as 3 against a true 21.

**Lesson, and it is the second time this exact shape has bitten:** a subagent's inventory
of its own work is not evidence. Both M1 bugs so far — the dot-qualified binder and this
undercount — came from a scan heuristic that silently under-matched, and both were caught
only by instructing the next agent to *re-derive independently* rather than consume the
prior report. Every fixer brief from here on says "treat the prior report as a hint, not
as authoritative."

Verification of the sweep: 0 dead references remain; 394 metrics with all per-domain counts
intact; zero drift on any non-`instructions` field; and a clean scope proof — **of 815
added lines across the domain YAMLs, 0 fall outside an `instructions:` block.** Idempotent
on re-run. New hash `87d0bfd235878a7dac7eb4b09ff074a06bb5e6af0051e0b6329ad3c16df11a4d`.

Meaning preservation was handled case-by-case rather than by blanket deletion — dead
*bindings* were removed, but dead ids serving as descriptive scope were rephrased to keep
the constraint (e.g. `degree_award_window_start/end` → "the degree-award window printed on
the form"), and mixed live/dead clauses kept their live half. That judgment is exactly what
the Opus reviewer is now auditing.

**Also fixed:** `_gender_sum_flags` + `_GENDER_GROUPS` deleted from
`domain/cds/validators.py` with their 2 vacuous tests (D6); `denominator_sanity` confirmed
still live via `_order_flags` and `_percent_range_flags`. Cut report corrected to
3-of-21 surviving. `docs/DATABASE_GUIDE.md` worked example replaced with real compiled JSON.
Test suite 10 failed / 1673 passed — the 2 fewer passes are exactly the 2 deleted tests.

### M1 review round 3 — two reviewers, one shared blocker

Ran a meaning-preservation reviewer (Opus) and a mechanical acceptance gate (Sonnet) in
parallel. **Both independently found the same 4 sites, and nothing else blocking.**

**The finding: `description` is in the prompt too.** `_build_prompt` (`engine.py:244`)
`json.dumps`es the *whole* compiled metric dict, so the model receives
`definition_variant, denominator, description, id, instructions, period_kind, population,
source_hints, type, unit`. The sweep was scoped to `instructions` only, leaving 4 dangling
refs in `outcomes.yaml` descriptions (lines 141, 164, 165, 185) to
`first_year_retention_entering_term` / `_followup_term`.

Worse than a plain leftover: those are the *same three metrics* whose `instructions` were
just repaired. So one payload now carries a resolved anchor in `instructions` and an
unresolvable backticked id in `description` — actively inviting the model to hunt for a
field that does not exist. Sent to a fixer, together with 3 LOW consistency items
(restore the I-1 anchor on the 4 `faculty` metrics, the A1 pointer on
`identity.admissions_email`, and the literal `"Ugrad Ratio"` label on
`class_size.students_per_faculty`).

**Meaning preservation verified, not assumed.** The Opus reviewer diffed every rewrite:
**58 of 58 preserve the extraction instruction; 0 changed the targeted cell, row, column,
section, unit, rounding, or availability semantics.** It checked all 58 negative
constraints ("never recompute", "do not redistribute", "must not be confused with", …)
survive verbatim, and confirmed every paraphrased anchor against the *deleted* metric's own
HEAD definition — no paraphrase invents an anchor the dead metric didn't have.

Reviewer count reconciliation: the meaning reviewer counted 299 refs / 148 pairs vs the
fixer's 325/151 (a 26-ref gap in `admissions`, tokenizer/double-count). Both agree the
remaining count is **0**. Immaterial — noted so the discrepancy isn't rediscovered later.

Gate result: **0 CRITICAL, 1 HIGH, 0 MEDIUM, 0 LOW → GATE: FAIL** on that single blocker.
All other checks PASS. Re-gate after the fix lands.

### M1 — CLOSED AND COMMITTED ✅

**Commit `91d07a2`** — `feat(cds): cut metric catalog to 394 per METRICS-KEEP (M1)`.
3,616 insertions / 14,691 deletions, 26 files. Not pushed (§10).

**Closing gate, re-run from scratch on the final tree: 13/13 checks PASS.**
`VERDICT: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW → GATE: PASS`. The single LOW was a stale
hash inside the cut report, corrected before the commit, so the milestone closed at **zero
open findings** as §6b requires.

Final state: 394 metrics, per-domain 24/98/36/17/43/41/4/4/67/14/10/13/23. Manifest
`content_sha256 = 82e4a82d188cac0d164ba42696abda2914d7b7c7ef05a676650bc3465586c4b8`.
Full-payload dead-reference sweep across all 4,367 string leaves of the compiled manifest:
**0 hits.** Test suite 10 failed / 1673 passed — the 8 pre-existing failures plus exactly
the 2 by-design hash pins, nothing new. ruff and mypy clean. Zero secrets in the diff.

**Review effort: 3 rounds, 4 reviewers, 5 fixers, 5 accepted findings.** Round 1 caught the
dot-qualified binder; round 2 the dead validator and the prompt-embedded prose; round 3 the
`description` field and anchor-specificity losses.

**The recurring lesson, three for three:** every M1 defect came from a scan heuristic that
silently under-matched, and *none* was caught by re-running the tool that produced it. The
dotted binder, the 2-segment `cip_version` id hiding 123 references, and the `instructions`-only
scope that missed `description` — all three surfaced only because the next agent was told to
re-derive independently. Cost of that discipline: ~4 extra subagent rounds. Value: the
catalog the entire tuning loop is measured against is correct.

### Correction to D2 — prose sweep moves BEFORE the baseline

D2 deferred the stale-prose fix to "a separate pass" without saying when. That ordering is
wrong and I'm correcting it now: the sweep must land **before Experiment 1**, not after.

Reason: the baseline is supposed to measure the config we intend to tune from. If 117
prompts still instruct the model to bind values to metrics that no longer exist, the
baseline is artificially depressed by damage the cut itself introduced — and every later
"improvement" would be partly just repairing that damage, corrupting every delta the loop
measures. §8 already requires pruning "hints pointing at deleted metrics"; this is that.
D2's *split* (structural fix and prose fix as separate reviewed passes) still stands —
only its position relative to the baseline changes.

### M3 (partial) — offline runner built, first structural numbers

`plans/cds-pipeline/tuning/harness/run_extraction_offline.py`. No DB access (grep-verified:
zero uses of `cds_store`/`asyncpg`/`pool`). Output contract
`runs/<label>/<docname>.json`; refuses to overwrite an existing run file (runs cost money);
dumps partial results even on hard failure.

**Dry-run on `dartmouth_2024-2025` (34pp), post-cut, zero model calls: 23 planned calls,
228 planned page-sends.** Against the pre-cut 63 calls / 494 page-sends on a 32-page doc,
the catalog cut alone takes calls 63→23 and page redundancy 15.4×→6.7×. Extrapolating with
the §2 token model (`592×228 + 280×394` prompt, `71×394` output) puts this doc at roughly
**$0.10/doc — already at the §1 target before a single tuning experiment.** Treat as a
projection until Experiment 1 measures it.

**First real routing miss found for free:** two `class_profile` batches (hint `C9`) fell
back to **whole-document** on Dartmouth. The corpus profile independently found Dartmouth
is missing the C9 anchor (14/15 anchors, C9 the absent one). Those 2 batches alone account
for 68 of the 228 page-sends — **30% of this document's total page traffic is one failed
regex anchor.** This is the `routing-miss` class, and it is expensive rather than merely
inaccurate. Candidate hypothesis for the loop.

**Live smoke test** (`--domains faculty`, 4 metrics): 1 call, 4/4 findings, **$0.002694**,
137.7s. Cumulative spend: **$0.0027**.

**Two engine seam gaps found (not fixed — harness works around both):**
1. `app/cds/manifest.py:92 metric_batches_for_domain` already accepts `max_batch_size`, but
   `app/cds/batching.py:40 batches_for_domains` never forwards it. The harness reimplements
   the ~10-line loop locally. A one-line parameterization would let the real engine take a
   batch-size config — **this becomes a required engine change if the batch-size sweep wins**,
   since a champion must be expressible in the shipped engine, not just the harness.
2. `app/cds/batch_run.py:37 _MAX_CONCURRENT_BATCH_CALLS` is a module constant, overridden by
   runtime monkeypatch from the harness. Same story: fine for measuring, needs threading
   through `run_batches` to ship.

Not yet exercised: `--prompt-variant`, `--starved-retry`, and non-default `--batch-size`
end-to-end (structurally exercised in dry-run only). These need proving before any
experiment relies on them.

### M3 (partial) — scorer + golden self-tests built

`harness/scorer.py`, `harness/test_scorer.py`, `harness/GT-SCHEMA.md`.
`SCORER_VERSION = "1.0.0"`, stamped into every report — a bump invalidates every persisted
report, and champion + baseline must both be re-scored before any new comparison (§5).

**74 golden self-tests pass**, and the builder did not stop at green: it mutation-tested
its own suite. A degenerate always-true comparator fails 35 cases; a "forgiving percent"
(round to int) mutant fails exactly the 2 precision cases (`56` vs `56.3`,
`56.3` vs `56.30001`). That is the evidence that the table actually bites.
`testpaths = ["tests"]` in `pyproject.toml` keeps these out of the routine suite.

**Key design call: rules key on manifest `unit`, not `type`.** `type` is too coarse —
the 58 percent-semantic metrics are typed `string` (deliberately, to preserve `"<1%"`),
so only `unit` routes `number`- and `string`-typed percents to the same rule. A test
asserts the mapping is **total** over the live 394-metric manifest, so the catalog cut
cannot silently drop a metric into an unhandled bucket.

Documented semantics: accuracy denominator = correct+wrong+hallucinated (hallucinations
are extracted values, so §1's "correct / extracted" charges them — correct reading);
coverage = (correct+wrong)/(correct+wrong+missed); only `availability_status ==
"reported"` counts as an extraction; `0` is never an absent token; `/Yes`→true but numeric
`1`/`0` rejected as booleans; `0.56` on a percent metric is NOT rescaled to 56 (scores
wrong, logs `percent_fraction_suspected_not_rescaled`).

**Flagged to watch, not yet a finding:** the scorer charges the *engine* for a GT `present`
value that fails to normalize (its decision 6). Strictness is right per §5, but during GT
building this could inflate `wrong` with what are really GT authoring errors. It is tagged
per-comparison, so autopsies can separate them. Watch the tag counts in Experiment 1.

Under adversarial review before any GT is authored against `GT-SCHEMA.md` — a schema error
found later would invalidate all six ground-truth documents.

### M3 — scorer hardened to v1.1.0 after adversarial review

**126 self-tests (was 74). 17 mutants, 17 killed.** The three that previously SURVIVED are
now dead: `M6_substring_equality` (8 failed), `M7_case_insensitive_numeric` (3 failed),
`M10_swallow_compare_errors` (1 failed). All golden rows now drive the production
`compare_metric` in **both** directions, so the trust gate finally guards the equality line.

**`SCORER_VERSION = "1.1.0"`.** Per §5 every persisted run of champion and baseline must be
re-scored before comparing anything new — currently only the faculty smoke run exists, so
the cost is nil. Worth noting the rule now has teeth.

Fixes landed: unknown `availability_status` now **buys no abstention** (a hallucination
stays `hallucinated`) and is pinned against `get_args(AvailabilityStatus)` so a sixth engine
status fails the suite; GT keys outside the manifest are blocking with exit 3; new
`unreadable` bucket, never charged and excluded from every denominator; unwinnable
`present` GT routed to a `gt_error` bucket instead of being charged to the engine; run
errors printed loudly so a half-dead run can't read as clean; adversarial bucket-totality
test asserting all 394 metrics land in exactly one bucket.

**Fitness is now explicit** (D10): `("accuracy_pct", "coverage_pct", "-cost_per_doc",
"-latency_per_doc")`, order test-pinned. Zero-extraction sentinel `-1.0` sorts strictly
below every real percentage including `0.0`, so abstain-everything always ranks last —
verified against the live 394-metric manifest: abstain-all loses to 1-of-4, which loses to
extract-all on the coverage tiebreak.

**It found a real defect on first use.** Re-scoring the smoke run exited 3 on
`['faculty.minority_faculty_full_time', 'faculty.student_faculty_ratio']` — two GT keys
naming metrics the cut removed (`student_faculty_ratio` now lives at
`class_size.students_per_faculty`). Under v1.0.0 that scored **exit 0 with a silently
shrunken denominator**. Exactly the failure mode MEDIUM-1 predicted.

**Gap I caught in the report and sent back:** the fitness tuple was computed per-document,
but §6 requires every keep/revert decision on the **5-doc aggregate**. Requested aggregation
with one hard constraint — aggregate accuracy/coverage must come from **summed buckets, not
averaged per-document percentages** — plus a refusal to certify a partial eval.

**CORRECTION to my own framing.** I justified this by saying a config could improve on every
document and still show a worse average. That is arithmetically impossible: if B beats A on
every document, B's mean of percentages is necessarily higher too. The subagent caught it and
declined to ship a test whose docstring asserted something the arithmetic forbids — the right
call. The trap is real but needs *mass-weighting divergence*, not dominance: a config much
better where the metric mass sits and slightly worse on the small documents.

Its worked example, now pinned as `test_summed_buckets_beat_averaged_percentages`
(one 300-metric doc + four 4-metric docs):

| | per-doc percentages | naive average | summed buckets |
|---|---|---|---|
| config A | 50, 100, 100, 100, 100 | **90.0** | correct=166 wrong=150 → **52.53** |
| config B | 90, 75, 75, 75, 75 | **78.0** | correct=282 wrong=34 → **89.24** |

Naive averaging crowns A; summed buckets crown B — a **37-point inversion**. Averaging four
4-metric documents equally against one 300-metric document is what does it.

**Aggregation delivered:** 140 tests (from 74), **16/16 mutants killed** including
`M21_aggregate_averages_percentages` — the exact bug — which dies with 3 failures. Rate math
funnelled through a single `ratios_from_counts()`, so the averaged number is never computed
and never exposed. Fitness consumes **mean** cost/latency per document, declared in-band.
Refuses to certify on: wrong document count, duplicate document, any run carrying `errors`,
any propagated per-document blocking issue, mixed scorer version, mixed manifest hash, or two
configs folded together. Sentinel holds at aggregate level. `SCORER_VERSION` stays 1.1.0 —
aggregation is purely additive and single-doc semantics are byte-identical, so **no re-score
is required**.

### M2 — UGA sealed (pending one anomaly)

`gt/uga_2023-2024.json`. **394/394 metric keys**, matching the compiled manifest exactly in
both directions. `status_counts`: present 310, blank 78, absent 6 → 394. Scorer reports
zero blocking issues, zero GT-outside-manifest, zero authoring errors.

Provenance: **392 values from AcroForm fields, 2 from rendered text** (`identity.academic_year`
= 2023-2024 from the cover; `cost.cost_academic_year` = **2024-2025** from the Section G
preamble — genuinely different years, which is exactly the distinction that metric exists to
capture). Two `outcomes` ratios superseded by their rendered form per D13, with the raw
AcroForm value retained alongside as evidence.

**Independent visual verification: 24 spot-checks across all 13 domains, 0 disagreements.**
The three highest-risk attributions all confirmed correct against rendered pages:
- **C7 row 10** — field `Q112_10` genuinely does not exist; fields run `1..9, 11, 12, 13`
  against 12 printed rows. Verified label-baseline vs widget-y for all 12: no row shift.
  Had the mapper been off by one, "Volunteer work" would have inherited "Not Considered";
  the image shows it Considered.
- **G1 residency trap** — `TUIT_NRES_*` sits on the printed **Out-of-state** row (28830) and
  `TUIT_INTL_*` on **Non-resident** (empty). The field names invite exactly the inverted
  reading; the mapper didn't take the bait.
- **`BACH_PSY` vs `BACH_PSYCH`** — physical sciences (.96) vs psychology (6.84), correct.

All 6 `absent` classifications confirmed as genuine template-edition gaps (e.g. this edition
prints ONE combined "28 and 29" military-science row, so the separate CIP-28/CIP-29 metrics
genuinely do not exist here), and 10 sampled `blank`s confirmed as real empty cells.

**Deliberately NOT corrected:** `identity.application_url = "ttps://apply.uga.edu/apply/"`.
The missing `h` is genuinely printed in the document. GT is faithful to the page; an
extractor that "helpfully" repairs it should score wrong.

### The `wrong: 6` anomaly — a scorer parser bug, not "noise"

Scoring UGA's GT against an *empty* run yielded `wrong: 6`, which should be impossible with
zero findings. It was handed to me as "expected empty-run scorer noise." **That was wrong,
and accepting it would have been expensive.**

**Root cause:** `_num_canon()` (`scorer.py:~250`) parses numbers with `-?\d+(\.\d+)?`, which
requires a digit *before* the decimal point. A bare leading-dot decimal like `.48` fails to
match → `normalize_text(..., "percent")` returns `unparseable=True` → `compare_metric`
(`~line 785`) short-circuits `gt_norm.unparseable` to `outcome = "wrong"` **before the
engine's finding is consulted at all.**

**Proof of unwinnability:** 6 `degrees` metrics hold `.48`, `.19`, `.87`, `.69`, `.96`,
`.45`. Fed 10 candidate engine values each — including each GT's own literal string and its
`0.`-prefixed form — **60/60 scored `wrong`.** No engine output could ever score correct.

**Why this is a parser bug and not desirable strictness.** `.48` and `0.48` are the same
number written two ways; accepting both is formatting normalization, which §5's table
mandates. Critically it is **not fixable in the GT alone and cuts both ways**: real CDS
documents print leading-dot decimals, so the engine will faithfully emit `.48` and be scored
wrong for being right. Patching the 6 GT values would have left the engine-side failure live
and permanently invisible — a silent accuracy tax on every experiment for the rest of the run.

**Two fixes ordered:** (1) the parser accepts leading-dot decimals across *every* numeric
rule, with `56` ≠ `56.3` and `.5` ≠ `5` pinned as invariants; (2) the systemic half —
`gt_authoring_errors()` was only quarantining absent-token `present` values, so
numeric-but-unparseable ones slipped past load-time checks and landed silently in `wrong`.
Now they are a loud, blocking GT authoring error and are **never charged to the engine**.
GT values stay faithful to the printed page (D13) — they are not rewritten to `0.48`.

**Lesson for the ledger:** the scorer's own diagnostics were reported as noise by the agent
that produced them. Anomalies in the fitness function get investigated, never explained away
— this one was a permanent 6-metric accuracy tax hiding behind a plausible dismissal.
**UGA is not sealed until `wrong == 0` on an empty run.**

### M2 — UGA SEALED ✅ (gate met)

Scorer v1.2.0, 140/140 tests green. UGA GT scored against a shape-valid empty run
(zero findings, zero calls):

```
correct=0  wrong=0  missed=310  hallucinated=0  correct_abstention=84
uncovered=0  unreadable=0  gt_error=0
```

The gate is met on three counts, not one:
- `wrong == 0` — the 6 formerly-unwinnable leading-dot metrics are now winnable.
- `gt_error == 0` — no residual GT authoring errors were quarantined; the two
  unwinnable shapes `gt_authoring_errors()` guards against are both absent here.
  A nonzero `gt_error` would have meant the quarantine was masking, not fixing.
- The buckets **reconcile exactly** against the sealed status counts:
  310 missed = 310 `present`; 84 correct_abstention = 78 `blank` + 6 `absent`;
  310 + 84 = 394 = the full metric universe. No metric is unaccounted for, which
  is the check that would have caught a silent key-matching failure between GT
  keys and manifest ids. An empty run scoring 0/0/0 everywhere can also be
  produced by matching *nothing*; only the reconciliation distinguishes the two.

Fixture kept at `scratch-review/empty-run-fixture/` (gitignored), deliberately
NOT under `runs/` — a zero-finding run file sitting in the runs tree would be
silently swept into a future `--aggregate` and would drag an aggregate to 0%.

### M2 — Caltech page index merged, then RETRACTED and re-opened

`gt/caltech_2024-2025_pageindex.json` — merged from the two half-range files.

**I published a false finding here and caught it one step later. Recording both.**

I claimed "Caltech has no C9 anchor — the sequence runs C8 → D18", making it a
third document with the whole-document routing fallback. **That is wrong.**
Caltech page 19 carries the banner `C9-C12: First-time, first-year Profile`
followed by a `C9.` heading and the SAT/ACT percentile table.

Two compounding causes, both worth keeping:

1. **The Caltech p01-25 index was never finished.** Pages 19-25 held placeholder
   entries `{"sections": [], "notes": "pending batch 4"}` — the agent stalled at
   exactly that batch. The merge then produced a `section_index` built from
   placeholders, and C9 fell out of it because page 19 was empty, not because
   the document lacks C9.
2. **I verified the wrong property.** My completeness check asserted
   `sorted(pages.keys()) == range(1,51)` — page *presence*, not page *content*.
   Placeholders passed it. A structural check that a partially-written file
   satisfies is not a completeness check.
   **Rule going forward: a page index is complete only when every entry has a
   non-empty `sections` list OR an explicit note saying the page genuinely has
   no section heading (cover, blank, continuation).** Never assert on key sets.

**The corrected C9 census** (direct token scan over all six PDFs, mine, not an
agent's):

| document | `C9` token pages | percentile-table page |
|---|---|---|
| dartmouth_2024-2025 | *(none)* | *(none)* |
| caltech_2024-2025 | 19 | 19 |
| ucf_2023-2024 | 14 | 14 |
| uga_2023-2024 | 19 | 19 |
| cornell_2022-2023 | 9, 10 | 10 |
| pennstate_2022-2023 (holdout) | 13 | 13 |

So **only Dartmouth lacks C9**, and it lacks it genuinely: its section run is
C8/C8A-C8G → C10, C11 with no score-percentile table anywhere in the document.
Verified independently by scanning every Dartmouth page for `SAT|Percentile`.

**Consequence — the hypothesis is downgraded but not dropped.** "Three of five
documents" would have made anchor-miss a systemic cost driver; one of six makes
it a document-specific one. 28 of 36 `class_profile` metrics anchor on
`source_hints: [C9]` (config/cds/domains/class_profile.yaml), so on Dartmouth
alone all 28 route to whole-document — still the 68-of-228 page-send burn already
measured, still worth fixing, no longer the headline.

**The better hypothesis the retraction exposed.** The defect is not "C9 is
missing", it is *what the router does when an anchor misses*: it falls back to
the entire document. On Dartmouth, C8 sits on page 9 and C10/C11 on pages 9-10 —
the missing C9's content would be right between two anchors that ARE present.
A fallback that interpolates the span between the nearest present lower and
higher item codes would route those 28 metrics to ~2 pages instead of 35. That
fix generalizes to every future anchor miss, which a C9-specific hint patch
would not. This is the Experiment candidate to carry forward, not the hint edit.

Caltech also carries a J1 shape hazard worth recording before extraction: the
"Military science and military technologies" row prints as a SINGLE combined row
labelled `CIP 28 and 29`, not two rows. Expected-row-count checks on J1 must not
assume one row per CIP code.

### M2 page-indexing — two findings that generate hypotheses

**1. Caltech's text-layer corruption reaches DIGITS, including partially within one number.**
Page 39 body prose: `get_text()` returns `"Report the Fall 202\x17 rat[io...]"` where the page
visibly reads `"Report the Fall 2024 ratio..."`. **Only the final digit is corrupted.** Page
26's header returns `"&RPPRQ\x03'DWD\x036HW\x03\x15\x13\x15\x17\x10\x15\x13\x15\x18"` for
"Common Data Set 2024-2025" — all 8 digits corrupted.

This is worse than whole-page garbling, which at least fails loudly. A partially-corrupted
number is a **plausible-but-wrong value with no error signal.** The engine routes off
`extract_routing_text()` and its prompt embeds no page text, but any text-derived number on
this document is untrustworthy. Consequences: (a) routing regex anchors on Caltech may match
corrupted section codes, (b) `corrupt_text_layer` detection is doing real work and its
threshold matters, (c) GT for Caltech must be image-only with **no text-layer fallback
anywhere** — already enforced.

Other Caltech layout hazards recorded: "Not Applicable" cells rendered white-on-black
(a naive read could take them as data or as empty), checkbox lists in 2–3 independent
columns that must be read column-wise not row-wise, four tables split across page breaks
(H1 32→33, H2 33→34, I-3 39→40, J1 41→42), and page 36's header printing
**"2023-2024"** while every other page says 2024-2025 — a genuine source anomaly, same
family as Cornell's stale header.

Section J on Caltech prints ONE combined "28 and 29" military-science row (same as UGA), and
percentages **with** a leading zero (`0.90`) — unlike UGA's `.48`. Both forms occur in the
wild, which is precisely why the leading-dot parser fix was necessary rather than cosmetic.

**2. UCF: 2 of 9 image-verified pages disagreed with the text scan — and the disagreement is
the engine's own routing failure mode.** Both were false positives from *prose*, not headings:
page 27 matched "H1"/"H2" inside the financial-aid glossary ("questions H1 and H2..."), when
the real H1/H2 tables are on page 28; page 29 matched "B1" inside a parenthetical citation
("CDS Item B1 if reporting on Fall 2023 cohort") sitting in an H2-continuation row.

This is a live hypothesis for the loop, not just a GT caveat. The engine's
`_hit_pages_for_hints` regex-matches section codes against page text to choose which pages to
send. If a glossary mention can pull a section anchor onto the wrong page, batches route to
pages that merely *talk about* a section instead of containing it — wasting page-sends and
risking misses. The engine's `_hint_pattern` anchors at line start, which may or may not
save it; **worth testing directly.** Note the extraction prompt already tells the model to
"Ignore Common Data Set Definitions pages and glossary prose" — evidence someone hit this
before, but that instruction cannot fix *routing*.

**CORRECTION to an earlier assumption.** I recorded UCF's NBSP headings as breaking the
engine's regex anchors. Measured: 12,966 NBSP characters, document-wide rather than
heading-only, and 35 of 88 headings use NBSP as the code-to-title separator — but **code-token
matching is unaffected**, because no whitespace sits between the letter and the digits
(`H1`, not `H 1`). Only title-text association after the code is at risk. UCF still earns its
slot as the odd-formatting document, but not for the reason I first wrote.

**UCF structural absences:** B5–B11 and J1. Not extraction failures — UCF replaces the
per-gender B4–B11 grid with a single combined "B4 - B21. Graduation Rates" table in the newer
IPEDS GRS format, and its Section J table carries no "J1." prefix at all. Both make their
metrics `absent`, not `blank`. **The missing J1 anchor means `degrees` batches have nothing
to route on for this document** — expect whole-document fallback, the same expensive pattern
already seen with Dartmouth's C9.

### M2 — Caltech's text layer emits fake digits from checkmark glyphs

Beyond the digit corruption already recorded, Caltech page 19 extracts standalone
`9` characters on their own lines:

```
C9. Percent and number of first-time, first-year students ... test scores.
9
Include information for ALL enrolled, degree-seeking, first-time, first-year ...
9
Do not include partial test scores ...
```

Those `9`s are not data. They are Wingdings/Symbol **checkmark bullets** whose
glyph index decodes to the ASCII digit nine. Each one prefixes an instruction
bullet, not a value.

This is a strictly worse failure mode than the `\x17` corruption, because `\x17`
is *visibly* broken and a control character can be detected mechanically, whereas
a bare `9` is a well-formed number sitting adjacent to a numeric question about
percentages and counts. Any text-layer read of this page can silently harvest
`9` as the answer to "percent submitting SAT scores".

Two consequences:
- Caltech GT is image-only with **no text-layer fallback whatsoever** — already
  decided, now over-determined.
- `corrupt_text_layer` detection keying on control characters would NOT catch
  this page's fake digits on its own. Worth checking whether the engine's
  detector is control-char-based; if it is, glyph-decoded digits are a blind spot
  it cannot see. Filed as a question for the engine review, not yet verified.

### M2 — Cornell page index, pages 1-17 (verdicts)

**Header year: the filename is right, the header lies.** Pages 1-2 read
"Common Data Set 2022-2023"; **pages 3-17 all carry a stale "Common Data Set
2021-2022"** running header. The data is unambiguously the 2022-2023 cycle —
Oct 19 2022 enrollment date, Fall 2022 admissions cohort, an "IPEDS GRS 2022-2023
Survey" citation, and forward-looking 2023-2024 costs in section G. Cornell reused
prior-year template pages for sections B onward without updating the header.

This matters beyond bookkeeping: `student_life.cds_edition` and
`identity.academic_year` are exactly the metrics a model would fill from a running
header, and 15 of 17 pages would feed it the wrong year. It is a live hallucination
trap with a plausible-looking wrong answer, and Cornell's GT must record the
*correct* year while the document's own header disagrees on most pages.

**C7 marker semantics: the mark is meaningless, the column carries everything.**
Verified from the page 8 image. Every mark is an identical typed `X`; meaning
comes solely from which of the four columns it sits in (Very Important /
Important / Considered / Not Considered). The text layer emits each row's `X`
immediately after its label with **no coordinate or column data at all**, so
reading-order extraction cannot recover the answer — it can only recover that
*some* answer was given. C7 therefore requires word-bbox extraction or image
reading. The same hazard plausibly applies to C8A-C8G, D5 and D18 (not
individually verified).

This is the second document to show column-position encoding (Caltech's index
flagged it on E1/E3/F2/F4/H12/H13), which makes it a corpus-wide pattern rather
than a Cornell quirk, and a strong candidate explanation for any `class_profile`
or `admissions` accuracy floor the baseline turns up.

**Also flagged:** `B4-B11` never appears as a literal label in Cornell — only as
prose "(formerly CDS B4-B11)" and as generic row letters A-D under a combined
`B4-B21` heading. Same structural shape as UCF's B4-B21 collapse.

### M2 → M4 — THE ROUTING DEFECT: bare single-letter hints collide with lettered sub-items

This is the strongest cost hypothesis found so far, it is **measured not theorised**,
and it displaces the C9 story as the headline. It was found by chasing a *wrong*
hypothesis and measuring instead of publishing.

**How I got here.** Cornell's indexer reported `H1` mentioned in prose on pages 20,
21, 22 and 32 while its heading is on page 19 — suggesting glossary prose stretches
a batch's page span. I ran the engine's own `_hit_pages_for_hints` over the corpus
to confirm. **The hypothesis was wrong**: `_hint_pattern` anchors at line start
(`^{code}(?![0-9A-Za-z])`), so mid-sentence mentions like "see CDS Item B1" never
match. The anchor is doing its job. But the same measurement exposed a different,
worse defect.

**The defect.** Three hints in the compiled manifest are *bare single letters* —
`J` (41 metrics), `H` (3), and the pattern generalises. `_hint_pattern('J')`
compiles to `^J(?![0-9A-Za-z])`, which matches any line starting with `J` followed
by a non-alphanumeric. CDS documents are full of **lettered sub-item lists**
(a., b., … i., j.) inside sections G, H and I, plus a table-of-contents entry, plus
stray single-letter table cells. All of them match.

Actual matching lines, verbatim:

```
UCF   p1  'J. DEGREES CONFERRED'                                     <- table of contents
UCF   p29 'J. The average financial aid package of those in line'    <- sub-item (j) in section H
UCF   p35 'J. Total number in stand-alone graduate/professional...'  <- sub-item (j) in section I
UCF   p37 'J. DISCIPLINARY AREAS of DEGREES CONFERRED'               <- the REAL section J
UGA   p33 'J'                                                        <- bare single-letter table cell
UGA   p39 'J'                                                        <- bare single-letter table cell
UGA   p41 'J. Disciplinary areas of DEGREES CONFERRED'               <- the REAL section J
```

`_route_batches` then takes `(min(hits), max(hits))` — a **contiguous span from
first to last hit** — so one stray `J` drags the whole `degrees` domain across the
document.

**Measured blast radius, all five tuning documents:**

| document | pages | `J` hits | span sent | real section J |
|---|---|---|---|---|
| ucf_2023-2024 | 48 | 1, 29, 35, 37 | **37** | p37 |
| uga_2023-2024 | 50 | 33, 39, 41 | 9 | p41 |
| caltech_2024-2025 | 50 | 33, 39, 41 | 9 | p41 |
| cornell_2022-2023 | 32 | 20, 25, 27 | 8 | p27 |
| dartmouth_2024-2025 | 34 | 20, 25, 26 | 7 | p26 |

`H` (3 metrics) is inflated the same way on every document: spans of 20, 21, 31,
31 and 35 pages.

**Why this beats the C9 finding.** C9 affects 28 metrics on **one** document
(Dartmouth). `J` affects **41 metrics — the entire `degrees` domain, 10.4% of the
whole 394-metric universe — on all five documents plus the holdout.** UCF sends 37
of 48 pages to read a table that lives on one page. That is a whole-document
fallback in all but name, except it does not even register as a fallback because
the router thinks it succeeded.

**Why it is invisible.** A miss (`C9`) is loud — zero hits, explicit fallback. A
*collision* is silent: the router reports a successful narrow route and the run
logs a plausible `pages_sent`. Nothing in the pipeline says "your anchor matched
four different things and I sent the convex hull."

**Two consequences beyond cost.** Sending 37 pages when 1 is relevant is not only
expensive, it is an accuracy risk: `degrees` metrics are CIP-coded rows, and pages
29/35 carry *financial-aid* and *faculty* tables with numeric rows that a model
could plausibly mine for the wrong answer. So this hypothesis is testable on both
axes — it should move cost **and** `degrees` accuracy. That makes it a §1
lexicographic win candidate, not just a cost trim.

**Candidate fixes, to be tested as experiments — not yet applied:**
1. Require a heading shape, not just a prefix — e.g. the hint must be followed by a
   separator and the line must not continue as sentence prose. Cheap, general,
   fixes `J` and `H` together.
2. Cluster the hits and route to the densest/last cluster instead of the convex
   hull `(min, max)`. Also fixes the C9 case if paired with neighbour interpolation.
3. Make the hints specific (`J1`). **Rejected on evidence** — UGA and Caltech print
   `J. Disciplinary areas of DEGREES CONFERRED` with no `J1` token anywhere, so a
   `J1` hint converts a collision into a total miss on 2 of 5 documents. Recorded
   because it is the obvious fix and it is wrong.

Fix (1) is the one to try first: it is a pure routing change, touches no catalog
YAML, and is measurable against the existing baseline on every document at once.

**Confirmed end-to-end on the real batch plan (UGA, `--dry-run`, zero model calls).**
The theory above is not inferred from `_hit_pages_for_hints` in isolation — the
runner's own plan shows it. UGA: 50 pages, 23 calls, **228 planned page-sends**.

| domain / batch | hints | routed pages | pages_sent | where the data actually is |
|---|---|---|---|---|
| financial_aid b0 | `H`, H2, H2A, H4 | 7-47 | **41** | ~p33-39 |
| enrollment b0 | B1, B2 | 3-35 | **33** | p3-5 (4 metrics!) |
| degrees b0 | `J` | 31-49 | **19** | p41 |
| degrees b1 | `J` | 31-49 | **19** | p41 |
| class_size b0 | I-2, I-3 | 37-48 | 12 | — |
| admissions b3 | C13-C18, C8A, C8F | 15-25 | 11 | — |

**Those four polluted batches are 112 of 228 page-sends — 49% of the document's
entire page traffic.** `degrees` spends 38 page-sends across two batches to read a
single table on page 41. `enrollment` sends 33 pages to extract **4 metrics**,
because `B1` hits both its real heading (p5) and a stray line on p33, and the
convex hull swallows everything between.

This also revises the earlier Dartmouth figure in context: the C9 whole-document
fallback (68 of 228 page-sends) and the anchor-collision waste are *the same
underlying defect* — a routing rule that responds to a bad anchor by widening.
One widens to the convex hull, the other widens to the whole document.

A rough ceiling on the prize: if the four polluted UGA batches routed to their
true spans (~5-6 pages each), UGA falls from 228 to roughly 120 page-sends. Since
`prompt ≈ 592 × pages_sent + 280 × metrics`, that is close to a **halving of
prompt tokens per document** — the largest single cost lever identified so far,
and it is a pure engine change with no catalog edit.

Not yet applied. It is an M4 experiment and must be measured against a sealed
baseline, not assumed.

### M2 — Dartmouth GT: my double-prefix bug, caught by the adjudicator

Built `harness/gt_adjudicate.py` to diff the two independent GT passes. Design rule
copied from the scorer: **it does not define its own equality** — it calls
`scorer.normalize()` and `scorer.manifest_universe()` verbatim, so "the two passes
agree" means exactly "these two passes would score identically against a run." A
private comparator here would let GT drift from the yardstick that consumes it.

That rule immediately caught a bug **I** introduced. My `_specs` generator wrote

```python
key = f"{dom['id']}.{m['id']}"          # WRONG
```

but `manifest_compile._canonicalize_domains` has *already* qualified every id, so
`m['id']` is `student_life.out_of_state_percent_undergraduates`. Every spec key came
out **double-prefixed** (`student_life.student_life.…`), and all 10 GT pass files
written from those specs inherited it.

**How it surfaced.** The adjudicator reported 6 `value_conflict`s in `student_life`
where pass A wrote `'85%'` and pass B wrote `'85'` — and printed `unit=None`. Both
passes had read the same number off the same page; they could not both be wrong in
the same direction. The `unit=None` was the tell: the manifest lookup was *failing*,
so the scorer fell back to a text rule under which `85%` ≠ `85`. The real metric has
`unit='percent'`, which normalizes them together.

Fixed the generator (`key = m['id']` when already qualified) and repaired all 10
pass files in place: **394 valid keys, 545 keys renamed, 0 unknown** — the clean
zero confirms the prefix was the *only* defect, not a symptom of a deeper mismatch.
Re-adjudicated: `def` went from 88.33% to **98.33%** agreement, all 6 phantom
conflicts gone.

Two lessons:
- **A "conflict" between two independent passes that both read the same page the same
  way is not a conflict — it is a bug in the comparator or its inputs.** Disagreement
  should look like disagreement. Six identical-shaped conflicts in one domain is a
  systematic signature, not six independent misreadings.
- Had I not built the adjudicator and instead concatenated the passes into a sealed
  GT file, all 394 keys would have been unmatchable against the manifest and every
  metric would have scored `uncovered` — a silently useless ground truth.

Any GT pass produced by an agent that read the specs *before* this fix must be run
through the repair step again; the repair is idempotent.

### M2 — Dartmouth `def` adjudicated: metric instructions beat general rules

One real conflict survived: `transfer.transfer_rolling_admission_fall`.
Pass A said `blank`; pass B said `present`/`false`, applying the brief's general
"an unticked standalone checkbox is `present`/`false`" rule.

**Pass A is right.** That metric's own compiled `instructions` read: *"Extract only a
direct explicit Yes/No or an authoritative visibly unchecked D9 Fall rolling-admission
control. A blank/empty mark cell remains not_reported or unresolved."* The catalog
author already anticipated this exact cell and ruled it out.

Adjudicated to `blank`, and the brief now states the general principle it was missing:
**a metric's own `instructions` override every general rule in the brief.** This is not
a one-off — 394 metrics carry hand-written instructions and the brief has ~10 general
rules, so the general rules will keep losing to specific ones. Worth noting the two
passes disagreed *because* one read the spec's instructions and the other followed the
brief; that is the double-pass protocol working exactly as intended.

### M2 — Dartmouth adjudication status, and a caveat on the 100%s

| group | metrics | agreement | conflicts |
|---|---|---|---|
| class_profile | 36 | **100%** | 0 |
| ij (faculty+class_size+degrees) | 62 | **100%** | 0 |
| def (transfer+academics+student_life) | 60 | 98.33% | 1 status, adjudicated |
| ab, admissions, cost, financial_aid | — | in flight | — |

**`harness/gt_repair_keys.py` must be run after every batch of passes lands.** Agents
that read `_specs` before the double-prefix fix keep emitting stale keys until they
finish, so pass files arrive with mixed key forms for as long as anything is in
flight. The script is idempotent, reports anything it cannot resolve, and **never
drops an unresolvable key** — a key that maps to nothing is an authoring error worth
looking at, and deleting it would hide a missing metric. It also refuses to collapse
two source keys onto one target. Confirmed in practice: on the second run, `ij` passA
needed 62 renames while passB needed 0, purely from when each agent read the specs.

**Caveat on the two 100% agreements — they are weaker evidence than they look.**
I primed both `class_profile` passes with "Dartmouth appears to have no C9, verify it
yourself", so their agreement on 28 `absent` values is not fully independent. Both did
report reading the page images directly and each traced C8G → C10 itself, which is the
verification I asked for, and the C9 absence is independently corroborated by my own
token scan across all six PDFs. But the *protocol* was compromised: a shared prior
from the orchestrator is exactly the kind of correlated error two independent passes
are supposed to catch. Recorded so a later skeptic pass knows not to treat
`class_profile` agreement as clean corroboration.

Rule going forward: **state the hypothesis to at most ONE of the two passes**, or to
neither. Where a document-level fact must be shared (corrupt text layer, which pages
to read), share it; where a *value or status conclusion* is at stake, do not.

### First real run (`baseline-smoke`, UGA) — INVALID, and the scorer caught it

Not an experiment. A harness end-to-end validation on the one sealed document,
deliberately run before spending on four more GT seals. It paid for itself.

```
findings=115  calls=23  cost=$0.027741  duration=1511.5s
correct=2  wrong=6  missed=302  hallucinated=0  correct_abstention=84
coverage=2.58%  accuracy=25.0%
  !! RUN ERRORS (15) -- THIS RUN IS INCOMPLETE
```

**15 of 23 calls failed.** Two error classes: `SSL: UNEXPECTED_EOF_WHILE_READING`
(6 calls, admissions + class_profile) and `WriteTimeout` (9 calls). This run must
never be used as a baseline, and the scorer's `RUN ERRORS` panel is the only reason
that is obvious — the headline numbers (accuracy 25%, coverage 2.6%) look like a
catastrophically bad *engine*, when in fact the engine barely ran. **Without that
panel I would have booked a fabricated baseline and every later experiment would
have been measured against noise.** That panel is now load-bearing; do not remove it.

**The size correlation, stated honestly.** Every one of the 8 successful calls sent
**≤6 pages**. Every call that the plan says would have sent ≥7 pages failed.
Tempting, but **I am not yet claiming payload size is the cause**, for three reasons:
- Failed calls record `pages_sent: null`, so the sizes are inferred from the dry-run
  plan, not observed.
- `admissions` b2 was planned at 5 pages and still failed (SSL class).
- The successful small calls were themselves *very* slow — 125s to 381s for 5-6
  pages — which indicates a degraded network path independent of payload.

So the live hypotheses are (i) large uploads time out, (ii) concurrency 6 saturates
the connection, (iii) transient upstream instability. Re-running at `--concurrency 3`
to separate them. Cost of being wrong here is trivial ($0.028/run); cost of guessing
and moving on is a poisoned baseline.

**What this does support.** If (i) or (ii) holds, the routing defect is not merely a
cost problem — the oversized page windows would be *causing call failures*, and each
failed call is a whole batch of metrics scored as `missed`. That would make the
routing fix an **accuracy and coverage** lever, i.e. it would move the top two
entries of the §1 lexicographic tuple, not just cost. Worth confirming precisely.

**Latency is the real §1 exposure, not cost.** Even on the 8 calls that worked, cost
extrapolates to well under the $0.10/doc target, but wall-clock was **1511s ≈ 25
minutes** against a §1 target of ≤4 min and a hard floor of 6 min. Cost is
comfortably won; **latency is the constraint that is currently failing by ~4×** and
deserves proportionate attention in the loop. Adjust §7 lever priorities accordingly.

### M2 — DARTMOUTH SEALED ✅ (2 of 6 documents)

394/394 metrics, `present` 252 / `blank` 108 / `absent` 34. Seal gate passed:
`wrong=0  hallucinated=0  gt_error=0`, and 252 missed + 142 correct_abstention = 394,
reconciling exactly against the status counts (108 + 34 = 142).

Pass agreement before adjudication: **390/394 = 98.98%**, 6 adjudications applied.

| group | metrics | agreement |
|---|---|---|
| admissions | 98 | 100% |
| class_profile | 36 | 100% |
| cost | 43 | 100% |
| ij | 62 | 100% |
| financial_aid | 67 | 98.51% |
| def | 60 | 98.33% |
| ab | 28 | 92.86% |

**The most important adjudication overturned BOTH passes.**
`financial_aid.aid_reporting_status`: both passes independently wrote `estimated`,
reasoning from CDS convention that a checked "2024-2025" column (vs "2023-2024 Final")
implies estimated. Neither found the word "Estimated" printed anywhere. The metric's
own instructions say: *"Do not infer a status when the control is blank or
unresolved."* Ruled **`blank`**.

This is the case the two-pass protocol cannot catch by itself: **two independent
readers making the same reasonable inference agree, and agreement looks like
confirmation.** It was caught only because one pass set `ambiguous: true` and the
adjudicator surfaces ambiguous flags *even when the passes agree*. That design choice
— review flagged items regardless of agreement — is now proven load-bearing and must
not be optimised away.

**Second ruling, a deliberate deviation.** `admissions.housing_deposit_deadline` is
`unit: date` and the document literally prints `na`. The metric instruction says "copy
exactly as printed", but an unparseable `present` GT value is quarantined by the
scorer as `gt_error` — charged to no one, permanently unwinnable, effectively deleting
the metric from the universe. Ruled **`blank`** with the raw token kept in
`raw_printed`. This is the one place in the document where a printed token is not
transcribed verbatim; it is recorded in the GT entry itself, not just here.

**Note on how the gate found it.** The empty-run gate is not a formality — it
*refused to certify* the first assembly, naming the offending key. Without it this
would have shipped as a silently unscoreable metric.

**Process defect to avoid repeating.** I launched a retry for `financial_aid` passA
while the original agent was still alive; both wrote the same file, and one reported
seeing it truncated to 22 entries mid-task. The final file validates at 67/67 and
agrees with passB at 98.51%, so the content appears sound, but **passA's provenance
for that group is a merge of two agents rather than one clean pass.** Before relaunching
a stalled agent, confirm it is actually dead, or write to a distinct filename.

### M4 candidate, measured offline: FIX 1 FAILS, FIX 2 CUTS 26.3% CORPUS-WIDE

Both routing fixes prototyped and measured with **zero model calls** — page spans
recomputed from the real batch plan over all five documents. This is the cheapest
experiment available and it killed my preferred fix outright.

**Fix 1 (require a heading shape) — REFUTED.** I proposed requiring the hint to be
followed by a separator and a non-lowercase continuation, to distinguish a section
heading from a lettered sub-item. Measured:

```
uga        -13%   (helped only via enrollment's B1, not via J at all)
dartmouth   +0%
cornell     +0%
caltech     +0%
ucf         +0%
```

It fails because the discriminator does not exist. UCF's colliding line is
`J. The average financial aid package of those in line` — capital `T`, so it passes any
"heading-shaped" test just as `J. DISCIPLINARY AREAS of DEGREES CONFERRED` does. There
is no lexical feature separating a sub-item from a heading. **This was my
first-choice fix and the one I recorded as "the one to try first"; it is worthless.**

**Fix 2 (drop the convex hull, keep the densest cluster) — CONFIRMED, and large.**
Group hit pages into clusters separated by more than a 3-page gap, keep the largest
cluster (ties → the later one, since CDS sections run in order and stray matches are
usually TOC or prose earlier in the document):

| document | pages | hull | cluster | delta |
|---|---|---|---|---|
| uga_2023-2024 | 50 | 204 | 134 | **−34%** |
| dartmouth_2024-2025 | 34 | 210 | 187 | −11% |
| cornell_2022-2023 | 32 | 159 | 131 | −18% |
| caltech_2024-2025 | 50 | 177 | 134 | −24% |
| ucf_2023-2024 | 48 | 226 | 133 | **−41%** |
| **corpus** | | **976** | **719** | **−26.3%** |

It improves **every** document, and the worst case is still −11%.

**The correctness cross-check matters more than the size cut.** Page-send reduction is
worthless if it drops the page the data is on. Checking the kept cluster against the
sealed page indexes, for the `degrees` batches:

| document | hits | kept | true section J page |
|---|---|---|---|
| ucf | 1, 29, 35, 37 | 35, 37 | **37** ✓ |
| cornell | 20, 25, 27 | 25, 27 | **27** ✓ |
| uga | 33, 39, 41 | 39, 41 | **41** ✓ |
| caltech | 33, 39, 41 | 39, 41 | **41** ✓ |
| dartmouth | 20, 25, 26 | 25, 26 | **26** ✓ |

**5 of 5 keep the true page and discard the stray.** UCF is the clearest case: the
p1 table-of-contents hit and the p29 lettered sub-item are both dropped, taking
`degrees` from 39 pages to 7.

**The open risk, stated before running it.** Clustering can drop a page a batch
genuinely needs. UGA's `financial_aid#0` goes 35 → 9 by keeping [31,33,34,35] and
discarding p39. That batch's hints are early-H items (H, H2, H2A, H4) so p39 is
plausibly irrelevant to it — but "plausibly" is not measured. **This is a
coverage-risk change, not a free win, and it must be validated against sealed ground
truth on the accuracy and coverage axes, not on page counts.** Page-count math is the
hypothesis; the scored run is the evidence. Three documents are now sealed, which is
enough to run it.

**Gap parameter swept (free, offline). Corpus total page-sends:**

| gap | total |
|---|---|
| 2 | 716 |
| **3** | **719** |
| 5 | 766 |
| 8 | 802 |

gap=2 buys 3 pages (0.4%) over gap=3 while cutting more aggressively — not worth the
extra drop risk. **Keep gap=3.** The curve is flat below 3 and rises steeply above 5,
so the parameter is not delicately tuned, which is what you want in a routing rule.

**Coverage risk measured against the sealed page indexes — and my first reading of it
was wrong.** For each batch I computed the pages its hint sections *actually occupy*
(from `section_index`) and asked whether the routed window drops any.

I first measured only `truth − cluster` and reported "Caltech `outcomes#0` loses pages
8, 9" as a clustering regression. **That was an attribution error: I never compared
against the hull.** Re-measured properly, `truth − hull` vs `truth − cluster`:

| document | true pages missed by hull | by cluster | **added by clustering** |
|---|---|---|---|
| dartmouth_2024-2025 | 0 | 0 | **0** |
| cornell_2022-2023 | 0 | 0 | **0** |
| ucf_2023-2024 | 0 | 0 | **0** |
| caltech_2024-2025 | 2 | 2 | **0** |
| **corpus** | **2** | **2** | **0** |

**Clustering introduces zero coverage loss.** The −26.3% page-send cut is free on this
evidence. The lesson is the one this run keeps teaching: a delta is only a regression
if you measure the baseline too, and I published a regression I had not baselined.

**What the mistake uncovered is a separate, pre-existing bug.** Caltech's 2 missed
pages are not a routing-rule artifact — the hint literal **`B4-B11` matches nothing at
all in Caltech's text**. Only `B22` hits (p12), so the window is p10-14 while the true
B4-B11 grid is on **pages 8, 9, 10**. Two of the three pages holding the graduation-rate
grid are never sent, under the current routing *and* under the fix.

Chased it. **The hint literal is simply wrong, on every document in the corpus.**

Every CDS in the corpus prints the heading as **`B4-B21`**, never `B4-B11`:

```
caltech_2024-2025   p8  'B4-B21: Graduation Rates'
uga_2023-2024       p8  'B4-B21: Graduation Rates'
dartmouth_2024-2025 p4  'B4-B21: Graduation Rates'
cornell_2022-2023   p4  'B4-B21: Graduation'
ucf_2023-2024       p7  'B4 ‐ B21. Graduation Rates'     <- note U+2010 dash AND spaces
```

`_hit_pages_for_hints` with the shipped hint returns **no hit on all five documents**,
so all 20 metrics carrying it (`config/cds/domains/outcomes.yaml`) fall back to
whole-document routing on every document. Swapping the literal to `B4-B21` hits
immediately on 4 of 5:

| document | hint `B4-B11` | hint `B4-B21` |
|---|---|---|
| caltech | no hit → whole doc | **[8]** |
| uga | no hit → whole doc | **[8]** |
| dartmouth | no hit → whole doc | **[4]** |
| cornell | no hit → whole doc | **[4]** |
| ucf | no hit → whole doc | still none |

**UCF still misses, and the reason is a second, separate defect.** UCF prints
`B4 ‐ B21` — a U+2010 hyphen **surrounded by spaces**. `_hint_pattern` already tolerates
dash variants (`_HINT_DASH_CHARS`) but compiles the dash as `[-…]?` with **no
whitespace tolerance**, so `B4 ‐ B21` cannot match a `B4-B21` hint. One-character fix:
allow optional whitespace either side of the dash.

**This is the highest-confidence, lowest-risk fix found so far** and it is independent
of the clustering change:
- It is a *correctness* fix, not a heuristic — the literal does not exist in any real
  document, so nothing can regress by correcting it.
- It converts 20 metrics from whole-document fallback to a 1-page route on 5 of 5
  documents (4 by the config edit, the 5th by the whitespace tolerance).
- It should move **coverage and accuracy**, not just cost: those metrics are currently
  asked for against the entire document, which is both the most expensive and the most
  error-prone way to ask.

Ordering for the loop: land this first (it is unambiguous), re-baseline, then test
clustering on top. Testing them together would confound a certain win with a
heuristic one.

**Full hint audit — the good news, and it bounds the problem.** I ran every hint
literal in the compiled manifest against all six PDFs. 67 distinct hints over 395
metric-hint pairs:

```
DEAD (match nothing in any of the 6 documents -> always whole-document fallback):
   B4-B11        7 metrics
   cover page    1 metric

PARTIAL (match in some documents but not all):
   C9    28 metrics  5/6 docs   (Dartmouth genuinely has no C9 -- expected)
   C8A    4 metrics  5/6 docs
   C8F    1 metric   5/6 docs
   A2     1 metric   5/6 docs
```

**61 of 67 hints match in all six documents.** The routing problem is *concentrated*,
not pervasive — which is worth stating plainly because my earlier framing ("bare
single-letter hints… the pattern generalises") implied a broad rot that the data does
not support. Two dead literals and four partials, with the partials all explicable as
genuine template variation rather than config error.

`cover page` is not a CDS item code at all — it is prose sitting in a `source_hints`
list, so that metric routes whole-document on every document, forever. One metric, so
low impact, but it is the same class of defect and should go.

**How it stayed hidden.** A wrong hint literal produces zero hits, which the router
treats as "no routing information" and silently answers with the whole document — the
same silent-widening failure mode as the convex hull. Nothing logs "this hint matched
nothing anywhere." Both defects would have been caught years ago by a single startup
assertion that every `source_hints` literal matches at least one page in at least one
reference document. **Recommend adding that check to the config test suite** — it is
cheap, and it is the class of bug that costs 49% of a document's page traffic while
looking like normal operation.

So the offline evidence is: **−26.3% page-sends, correct section page retained on 5 of
5 for `degrees`, and exactly one identified coverage regression.** That is a strong
enough case to spend a scored run on — but the scored run against sealed GT remains
the evidence, because page-count math cannot see whether the model actually still finds
the values. Cost and coverage are the axes to watch; accuracy should be unchanged or
better (fewer irrelevant pages to mine wrong numbers from).

### M2 — CORNELL SEALED ✅ (3 of 6), and the seal guard that generalises the rulings

394/394. `present` 241 / `blank` 133 / `absent` 20. Gate passed: `wrong=0
hallucinated=0 gt_error=0`, 241 missed + 153 correct_abstention = 394, reconciling
against 133 + 20 = 153. Zero seal drift on a late-finishing pass.

Pass agreement by group: admissions **100%**, def **100%**, ij **100%**,
financial_aid 98.51%, cost 97.67%, class_profile 94.44%, ab 92.86%. 6 adjudications.

**The seal assembler now carries a general guard, and it should stay there.** Rather
than hand-listing the 12 ACT `n/a` cells, the assembler runs every `present` value
through `scorer.normalize()` and converts any that come back `unparseable` or `absent`
into `blank` with the printed token preserved in `raw_printed`. It caught all 12
automatically and reported them.

This matters because it makes the invariant *structural* instead of a checklist item:
**no sealed GT can contain a value the scorer would quarantine**, regardless of which
document or which agent produced it. The Dartmouth `na` date and Cornell's `n/a` ACT
cells were found by hand and by gate failure respectively; on UCF, Caltech and the
holdout they will be caught before the gate ever runs. Note it fires on
`normalize()`, the same function the scorer uses — so it cannot drift from what the
gate enforces.

**Two `blank` vs `absent` adjudications, both to pass B, both on consistency grounds:**
- `cost.tuition_per_credit_public_out_of_state` → `absent`. G6 prints only an
  undifferentiated "PUBLIC INSTITUTIONS:" row. Pass A mapped this one metric onto that
  generic row while marking its three siblings `absent` for the identical reason;
  `absent` is the internally consistent treatment.
- `financial_aid.aid_reporting_status` → `absent`, **and this is deliberately
  different from the Dartmouth ruling of `blank` for the same metric.** Not an
  inconsistency: Dartmouth's table prints a "2023-2024 Final" column label, so the
  control exists and merely went unanswered (`blank`); Cornell prints no
  Estimated/Final control anywhere, so the question is not in its template (`absent`).
  Same metric, different template editions, different correct answers — exactly the
  distinction `blank`/`absent` exists to carry.

### M2 — Cornell rulings, and the principle behind them

Adjudicated so far: admissions **100%** (98), ij **100%** (62), class_profile 94.4%.
Remaining groups in flight.

**Ruling 1 — the 12 ACT `n/a` cells become `blank`.** Cornell prints the literal token
`n/a` in 12 integer-typed ACT sub-score cells. Verified directly against the scorer:
`normalize("n/a")` returns `absent=True` on a `present` metric, which is precisely the
shape `gt_authoring_errors()` quarantines as `gt_error` — charged to no one, never
scoreable. Left as-is, Cornell's seal gate fails with 12 authoring errors. Ruled
`blank` with `raw_printed: "n/a"`, matching the Dartmouth `na` date ruling. Now written
into GT-EXTRACTION-BRIEF.md so the remaining documents get it right the first time.

**Ruling 2 — the C12 GPA cells stay `present`, against pass B.** Cornell prints
`0.00%` in both C12 boxes (average GPA and percent-submitted), and the C11 distribution
table above is entirely empty — the classic signature of an unfilled CDS spreadsheet
whose formula cells default to zero. Pass B read that correctly as an artifact and
recorded `blank`. Pass A recorded the printed value. **Pass A wins, and the reasoning
matters more than the outcome.**

Ruling `blank` here would recreate the exact defect I flagged earlier in this ledger:
an engine that reads the page correctly and reports `0.00` would be scored **wrong for
being accurate**. Diagnosing that a number is a spreadsheet artifact requires an
inference the engine has no way to replicate from the page, so encoding that inference
into ground truth measures something other than extraction quality. Confirmed
winnable: `normalize("0.00%")` → canonical `'0'`, not unparseable, so `present` costs
nothing.

**The principle — first statement was incomplete, here is the correct one.**

I initially wrote: *"Ground truth describes what the page shows, and deviates only when
faithfulness would make the metric unwinnable."* Cornell immediately produced a case
that breaks it. Its pass A recorded the B11 graduation rates as `92.70` / `95.28`
because that is what the page prints — faithful, and perfectly parseable, so the
"unwinnable" escape hatch does not apply. Yet those metrics are `unit: ratio` with
instructions saying *"as the printed 0-1 ratio ... never as a percent"*, exactly as on
Dartmouth. Under the incomplete principle, Cornell would be sealed at `92.70` and
Dartmouth at `0.96` — **the same metric, encoded two different ways, on the same
benchmark.** That alone proves the rule wrong.

The correct principle:

> Ground truth records **what a correctly-behaving engine, following the catalog
> instructions it is given, should emit for that cell.** The engine receives each
> metric's `instructions` in its prompt, so GT and engine are held to the same
> contract. Where the instructions demand a transformation (percent → 0-1 ratio), GT
> applies it. Where they demand none, GT records what the page prints. GT departs from
> the printed token only for that reason, or when faithfulness would make the metric
> unwinnable (unparseable/absent-token values the scorer quarantines).

This resolves all four rulings coherently:
- `n/a` in an integer cell → `blank`. Unwinnable otherwise.
- `0.00%` in the GPA cell → **stays `present`**. No instruction demands a transform, it
  parses cleanly, and "recognise this is a spreadsheet artifact" is an inference the
  engine cannot make from the page — encoding it would score a correct engine wrong.
- B11 rates → **`0.927` / `0.9528`** on Cornell, matching Dartmouth's `0.96` / `0.93`.
  The instruction demands the transform, and the engine is given that instruction.
- H9/H10 selection booleans with no visible control → `absent`. The instructions
  require a visible control; none exists.

The test to apply is therefore never "what does the page say" alone, but **"what would
a good engine, holding this metric's instructions, write here?"** Cross-document
consistency of a single metric is the check that catches violations.

**Action at Cornell seal time:** convert the two B11 rates to 0-1 form, preserving the
printed `92.70%` / `95.28%` in `raw_printed`.

**Also found: a page-index error, caught by independent verification.** The Cornell
index recorded C3's high-school-completion mark on "Diploma required, GED accepted".
The admissions pass read the page image and found the X on the third option, "High
school diploma or equivalent is not required", and flagged the discrepancy rather than
deferring to the index. Page indexes are navigation aids, not evidence — values always
come from the image. Third time in this run that re-deriving beat trusting a prior
artifact.

**Corpus note: Cornell's entire Section G is blank.** Both cost passes confirm no
numeric values anywhere in G0-G6, from images and text layer alike — the page index had
flagged this as a possible false negative and it is real. 37 `blank` / 4 `absent` /
2 `present` out of 43. This is a valuable corpus case: a document where a whole domain
is legitimately empty, so it directly tests correct abstention rather than extraction.

### The unit/printed-form hazard is NARROW, not systemic — concern downgraded

I flagged the ratio-vs-percent mismatch as possibly setting "a false accuracy ceiling
on every experiment" and said it needed a sweep before any baseline is believed.
**Swept. It does not.**

Unit distribution across all 394 metrics: `boolean` 85, `percent` 62, `usd` 48,
`students` 38, `category` 37, `carnegie_units` 24, `score` 24, `date` 21,
`sections` 14, `text` 13, … and **`ratio` just 3**.

Scanning both sealed GTs for `unit: ratio` metrics whose evidence cites a printed `%`
or whose value exceeds 1, plus `unit: percent` metrics recorded in 0-1 form:

- UGA: **0 suspects** of 310 present.
- Dartmouth: 3, all benign — the two B11 graduation rates (already adjudicated to
  0-1 form) and `class_size.students_per_faculty = 6.3`, which is a legitimate 6.3:1
  student:faculty ratio, not a percent in disguise.

The 62 `percent`-unit metrics produced **zero** suspects across both documents. So
the conversion burden falls on 2 metrics, not on a broad class. Correcting my earlier
framing: this is a footnote, not a ceiling.

**The genuinely systemic version of this hazard is different and is confirmed: a
non-numeric token printed in a numerically-typed cell.** Two instances so far:
- Dartmouth `admissions.housing_deposit_deadline` (`unit: date`) prints `na`.
- Cornell prints the literal token `n/a` in **12** ACT sub-score cells whose spec type
  is `integer`.

Every one of these is an unparseable `present` GT value → `gt_error` → quarantined,
unwinnable, silently removed from the scored universe. The standing ruling (set on
the Dartmouth case) is: **record `blank`, preserve the literal token in
`raw_printed`, and state the deviation in `evidence`.** Cornell's 12 ACT cells must
get the same treatment at seal time or its gate will fail with 12 `gt_error`s.

### M2 — Dartmouth seal amended: a second override of BOTH passes

After the seal, a late-finishing `financial_aid` passA raised two new `ambiguous`
flags. Zero seal drift on the other 65 keys, and group agreement rose to 100% — but
the flags were right to review.

`aid_priority_date_selected` and `aid_deadline_selected`. **I read page 22 myself**
rather than adjudicate from agent reports. H9 in this template is two fill-in date
LINES (priority: empty; deadline: `1-Feb`) plus ONE standalone checkbox ("No deadline
for filing required forms", unticked). **There is no per-line selection control at
all.** Both metrics require "true only when the control is visibly selected" and
"false only when the complete visible checklist shows it unambiguously unmarked" —
neither is satisfiable when no control exists. Both passes had inferred from whether
the *date line* was filled, which `aid_priority_date_selected`'s instructions
explicitly forbid ("independently of the date value ... even if the two are
inconsistent").

Ruled **`absent`** for both, matching the ruling both passes had independently reached
for the sibling metric `aid_has_deadline` on identical grounds.

Seal re-gated: `wrong=0  gt_error=0  hallucinated=0`, 250 missed + 144 abstention =
394. Final counts `present` 250 / `blank` 108 / `absent` 36, 8 adjudications.

**This is the second time reviewing an `ambiguous` flag on which the two passes AGREED
has overturned both of them.** Agreement between independent readers is worth much
less than it looks when both are reasoning from the same convention. The
adjudicator's decision to surface ambiguous flags regardless of agreement has now paid
for itself twice; treat it as a hard requirement, not a nicety.

### `baseline-c3` — concurrency hypothesis REFUTED; the network is the problem

Re-ran UGA identically except `--concurrency 3` (down from 6), to separate "large
uploads time out" from "concurrency 6 saturates the link".

```
calls=23  cost=$0.0  duration=4234.3s (70.6 min)
!! RUN ERRORS (23) -- THIS RUN IS INCOMPLETE
```

**All 23 calls failed, every one a `WriteTimeout`. Zero findings, zero cost, 70
minutes.** Lowering concurrency did not help — it got strictly worse (15/23 failures
became 23/23, 25 min became 70 min).

Conclusions, in order of confidence:
1. **The concurrency hypothesis is dead.** Halving in-flight requests made it worse,
   which is the opposite of contention.
2. **The payload-size hypothesis is also not supported as the primary cause.** In the
   c6 run every ≤6-page call succeeded; here the *same* small calls (academics at 5
   pages, faculty at 5) failed too. Size cannot explain a failure that a smaller
   payload also hits.
3. **What is left is the environment**: a degraded upload path to the model endpoint,
   worsening over the ~2h between the two runs. `WriteTimeout` is an upload-side
   failure, consistent with that.

**This is the most important operational fact in the run right now: latency and
completion are currently dominated by network conditions, not by engine
configuration.** Consequences that must shape the loop:

- **Any latency comparison between two experiments run at different times is
  confounded.** §1's ≤4 min/doc target cannot be honestly evaluated in this
  environment until a noise floor exists. §6's Experiment 2 (noise floor) is
  therefore not optional bookkeeping — it is a precondition for trusting *any*
  latency number, and it must be re-measured near each experiment, not once.
- **Cost figures remain trustworthy** (they are token-derived, not clock-derived),
  and cost was already comfortably inside target.
- A champion must never be crowned on a run with a non-empty `RUN ERRORS` list.
  Consider making the scorer refuse to emit a fitness tuple at all when errors exist,
  rather than emitting one that ranks last — right now `baseline-c3` produces a
  well-formed tuple `(-1.0, 0.0, -0.0, -4234.3)` whose `-0.0` cost would *win* the
  cost axis against a real run. A zero-cost total failure must not be able to beat a
  working config on any axis. **Filed as a scorer hardening item.**

Do not re-run the baseline until a call spot-check succeeds; burning 70 minutes per
attempt on a dead link is the worst possible use of the wall clock.

### `netprobe` — the endpoint is alive, and latency has a hard structural floor

One call, one domain (`faculty`), `--concurrency 1`:

```
findings=4  calls=1  cost=$0.002578  duration=350.1s
```

**It succeeded.** So the endpoint is reachable and the earlier total failure was not a
dead link. But 350 seconds for a single 5-page call returning 4 metrics is the real
headline, and it reframes the §1 latency target structurally rather than as a tuning
problem:

```
wall_clock  ≈  (calls / concurrency) × per_call_latency
```

Observed `per_call_latency` is **~140-350s** and does not scale down with payload —
the 5-page, 4-metric `faculty` call took 141s in the earlier smoke and 350s now, while
a 25-metric call took 173s. Per-call latency is dominated by a fixed overhead, not by
tokens.

With 23 calls and the §1 target of 240s, that equation demands
`23 / concurrency × ~200s ≤ 240s`, i.e. **concurrency ≈ 20** — every call in
essentially one wave. That is not reachable by tuning at the margin.

**So the only real latency levers are the two that change the equation's numerator or
denominator:**
- **Fewer calls** — larger `DEFAULT_METRIC_BATCH_SIZE` (§7 lever 1). Going 25 → 60
  takes UGA from 23 calls to ~9, a 2.5× wall-clock cut for free.
- **Higher concurrency** (§7 lever 3), which the failed runs suggest the current
  network cannot absorb — and which trades against reliability, not just 429s.

Note these interact badly with the routing defect: bigger batches merge more
`source_hints` per batch, and since routing takes the convex hull of a batch's hints,
**a larger batch size will widen page spans further** unless the routing fix lands
first. Ordering matters — fix routing, then sweep batch size, or the batch-size result
will be contaminated by exploding page-sends.

**Revised read on the failures.** c6 → 8/23 succeeded, c3 → 0/23, c1 → 1/1. That is
not a clean monotonic story in either direction, and the c3 run sat in the worst
window. I am no longer confident concurrency is exonerated; the honest statement is
**concurrency and network health are confounded across these three runs**, and they
cannot be separated without running them back-to-back. Deferred until a run is needed
anyway — it is not worth 70 minutes of wall clock to settle on its own.

### M2 — the ratio/percent GT conflict, and an engine hazard it exposes

`ab` adjudication: 26/28 agreed; the 2 conflicts were both B11 graduation rates.

| | value | reasoning |
|---|---|---|
| pass A | `96`, `93` | applied the brief's "record as printed, do not convert" rule |
| pass B | `0.96`, `0.93` | applied the metric's own `instructions` |

**Pass B is correct.** Both metrics are `unit: ratio`, `type: number`, and their
compiled instructions read *"as the printed 0-1 ratio (for example 0.94), never as a
percent"*. Metric instructions override the brief (the rule established by the D9
adjudication). Adjudicated to `0.96` / `0.93`, with the printed `96%` / `93%` kept in
`evidence`.

**The engine hazard this exposes.** Dartmouth *prints* `96%`. The catalog *demands*
`0.96`. So the engine must perform a unit conversion the page does not show, and if
it faithfully transcribes what it sees it scores **wrong for being accurate**. This
is the same shape as the leading-dot parser bug: a guaranteed, silent accuracy tax
that looks like a model failure. Unknown how many of the 394 metrics have a
`unit`/printed-form mismatch — **worth a systematic sweep before the baseline is
believed**, since it would set a false accuracy ceiling on every experiment.

### Process error: never repair pass files while their agents are still writing

`gt_repair_keys.py` rewrote `ab__passA.json` while its agent was still working. The
agent saw its file change under it, was told the change was intentional, judged that
it contradicted the spec format it had been given, and **restored the double-prefixed
keys** — correctly, on the information it had. I then had to repair the file a second
time.

The agent was not wrong; my sequencing was. **Run the repair only after every agent
touching a document has finished**, and treat "renamed > 0 on a file whose agent has
already reported done" as the normal case rather than a signal. Recorded because the
same collision will occur on UCF, Cornell and Caltech if the repair is run eagerly.

### Harness operating notes (read before running anything)

**The runner MUST be invoked from the repo root**, not from `harness/`:

```
cd /home/saifuddin/Projects/counselle/.worktrees/cds-pipeline
uv run python plans/cds-pipeline/tuning/harness/run_extraction_offline.py \
    --pdf artifacts/cds-corpus/<doc>.pdf --label <label>
```

`config/settings.py` declares `SettingsConfigDict(env_file=".env")`, and pydantic
resolves that **relative to the process CWD**. Launched from `harness/`, `.env` is
not found and `get_settings()` dies on missing `COUNSELLE_DB_RO_DSN` /
`COUNSELLE_DB_APP_DSN` / `COUNSELLE_JWT_SECRET`.

Two traps this hides:
- `--dry-run` **does not** call `get_settings()`, so a dry-run succeeds from any
  directory. A green dry-run is therefore NOT evidence that the real run will
  start. Do not use it to validate invocation.
- The failure names three DB/JWT variables, which reads like the offline harness
  wants a database. It does not — `get_settings()` validates the whole settings
  object eagerly, including fields this code path never touches. Do not "fix" it
  by giving the harness DB access; fix the CWD.

Output lands at `plans/cds-pipeline/tuning/runs/<label>/<docname>.json` regardless
of CWD (resolved from the runner file's own location), and the runner refuses to
overwrite an existing run file.

### Harness seam chosen

Offline runs will drive `app/cds/batch_run.py:96 run_batches()` +
`collect_batch_results()` with a hand-built `_RunState`, skipping `store_domain_packets()`
— that is the only DB write in the extraction path. `adapters/cds_store.py`,
`app/cds/jobs.py`, `service_ingest.py`, and `manifest.verify_manifest_current()` are
bypassed entirely. The model boundary is the single function
`adapters/cds_gemini.py:185 generate_structured()`.

### Ground-truth corpus and document selection

15 PDFs live at `artifacts/cds-corpus/` (gitignored). **All 15 have zero AcroForm fields**
— archetype C has no in-corpus candidate (see D4).

Documents in `cds_library.cds_documents` are stored as `bytea` in `pdf_content`; there is
no filesystem path column. But the local corpus files are the same bytes (confirmed via
`pdf_sha256` reuse), and the harness runs on local PDFs anyway, so local runs remain
reproducible against DB documents. Note the DB corpus is largely *synthetic*: one
`harvard_2024-2025.pdf` is registered under six document ids as fake "Alabama A&M"
school-years, and two rows are 503/882-byte dummy PDFs.

**The 5 tuning documents + 1 sealed holdout:**

| # | Archetype | Document | Pages | Why it earns its slot |
|---|---|---|---|---|
| 1 | A — decoupled label/value Excel export | `cornell_2022-2023` | 32 | Excel-for-M365 producer; labels and values in separately-ordered text blocks; bare-X C7 column position lost; stale "2021-2022" header on 78% of pages. In DB (docs 2011/2018/2023). |
| 2 | B — clean flat PDF | `dartmouth_2024-2025` | 34 | 0 control chars, single Adobe toolchain, values inline next to labels, 14/15 anchors. The control case. In DB (doc 2020). |
| 3 | C — AcroForm fillable | **`uga_2023-2024`** ✅ sourced | 50 | 1,086 AcroForm fields, 783 filled. `pypdf.get_fields()` gives exact machine-readable truth, making this the one document whose GT needs no adjudication. From `oir.uga.edu`. NOT in DB — local-only. |
| 4 | D — corrupt text layer | `caltech_2024-2025` | 50 | 1,775 control chars across 49 of 50 pages; broken ToUnicode CMap renders "2024-2025" as "202\x17-202\x18". Routing reads the text layer, so this poisons routing *and* extraction. In DB (doc 2015). |
| 5 | E — long / oddly formatted | `ucf_2023-2024` | 48 | 2nd-longest practical document; headings use NBSP (U+00A0) instead of spaces, breaking regex anchors. Ohio State 187pp deliberately excluded — see D3. |
| **H** | **sealed holdout** | `pennstate_2022-2023` | 46 | Full CDS, all 15 anchors, Adobe PDFMaker-for-Excel (a producer family absent from the tuning five), values inline. **Scored exactly once, on the final champion.** |

Total tuning-doc pages: 214 (excluding holdout).

**D4 resolved — SUCCESS.** `artifacts/cds-corpus/uga_2023-2024.pdf`, 50pp, 1,086 AcroForm
fields / 783 filled, from `https://oir.uga.edu/wp-content/uploads/UGA_CDS_2023-2024.pdf`.
UGA's 2024-25 URL 404s and their 2022-23 / 2021-22 PDFs are flattened (0 fields), so
2023-24 is the specific edition that works. Field names are screaming-snake CDS codes
(`MAIN_INST_CONTROL -> '/Public'`, `CDS_ZIPCODE -> '30602'`); checkbox/radio values carry a
leading `/`. The fallback `michigan_2024-2025` is not needed.

---

## M2 — UCF sealed (2026-08-24)

`gt/ucf_2023-2024.json` — 324 present / 59 blank / 11 absent = 394.

**Adjudication was unusually clean: all seven groups at 100% agreement, zero
value_conflict, zero status_conflict, zero coverage_gap.** Five `ambiguous` flags
(3 admissions, 2 ij), all reviewed and resolved as keep-as-is:

- `open_admission_all_students` — C6 dropdown empty → `blank` (per D11).
- `other_units_recommended` / `other_units_required` — empty free-text box → `blank`.
- `class_sections_50_99` / `class_subsections_50_99` — UCF prints the band label
  "50 - 59" with no 60-99 band, but its seven bands sum exactly to the printed
  totals 3171/308, so it is positionally the 50-99 slot with a label typo. Kept
  `present` 416 / 30.

**Seal-guard conversions: 0.** This is the first document where the guard fired on
nothing. The brief now carries the non-numeric-token rule explicitly and both passes
applied it at authoring time instead of leaving it to the seal. Evidence the brief
edits paid off, not evidence the hazard went away.

**Ruling — H3 status when the control is a free-text box (UCF).** UCF prints the
aid-reporting year and status as ONE combined box reading `2022-2023 Final`, rather
than a year field plus an Estimated/Final selection control. The metric instruction
says *"matched to the single selected status control ... Do not infer a status when
the control is blank or unresolved."* Both passes independently split it to
year=`2022-2023`, status=`final`. Kept.

Rationale, and how it differs from the Cornell case: the prohibition is against
*inferring* a status that the page does not state. UCF's page states it — the word
"Final" is printed. Cornell had neither a control nor the word. The distinction is
"is the answer visible on the page", not "is the answer inside a checkbox".

Gate: empty-run fixture scored `wrong=0 hallucinated=0 gt_error=0 uncovered=0`,
324 missed + 70 correct_abstention = 394. PASS.

## PennState holdout page index — four verdicts

Indexed, 46 pages, D17-complete (every entry has non-empty `sections`).

- **(a) header year** — `Common Data Set 2022-2023` identical on all 46 pages. No
  drift. (Contrast Cornell, which carries three different years in its headers.)
- **(b) the B4-B21 heading** — `B4-B21: Graduation Rates`, plain ASCII hyphen-minus
  U+002D, no surrounding spaces. **This is the sixth document, and the sixth to
  print B4-B21.** The shipped hint literal `B4-B11` now matches nothing in 6 of 6.
- **(c) Section J** — page 38, section band `J. Disciplinary areas of DEGREES
  CONFERRED`, item labelled `J1` with no period (contrast Section I's `I-1.` style
  in the same document).
- **(d) prose-only code mentions** — `B4-B11` p4 ×2 in the parenthetical
  "(formerly CDS B4-B11)"; `H1`/`H2` p46 glossary cross-reference; `H3` p28
  "(Formerly H3)". Glossary appendix = pages 39-46.

**Verdict (d) is the interesting one and it strengthens an earlier refutation.**
PennState is the ONLY document in the corpus where the string `B4-B11` appears at
all — and it appears exactly where the refuted glossary-prose hypothesis predicted
trouble. It still does not match, because `_hint_pattern` anchors at `^` and the
mention is mid-line inside a parenthetical. So:

- The line-start anchor is **load-bearing**, not incidental. Removing it (e.g. as
  part of "make hints more tolerant") would immediately start routing PennState's
  outcomes batch to page 4 on a prose mention. Do not relax the anchor.
- The `B4-B11` → `B4-B21` correction remains safe on all six documents: the old
  literal matches zero headings, and on the one document where the string exists at
  all it is structurally unmatchable.

Also worth noting for verdict (c): the bare hint `J` compiles to
`^J(?![0-9A-Za-z])`, which does NOT match `J1` — the `1` is excluded by the
lookahead. PennState's real Section J is reachable only via its section band line
`J. Disciplinary areas...`. That is one line on one page carrying the entire
41-metric `degrees` domain.

### D18 — corpus capped at 5 documents (user directive, 2026-08-24)

Ground truth stops at the five tuning documents: uga, dartmouth, cornell, ucf,
caltech. **No PennState ground truth will be authored.**

Consequence, stated plainly so the final report does not overclaim: §9's holdout
gate was specified as running the champion once on the sealed sixth document. With
no GT for PennState, that gate can no longer produce accuracy or coverage numbers.
What remains runnable on PennState is an unscored smoke — does the champion config
complete, at what cost and latency, with well-formed output — which tests
generalization of the *mechanics* but not of the *accuracy*. The five-document
aggregate is therefore the only scored evidence backing any champion claim, and the
final report must say so rather than implying an independent holdout confirmed it.

The PennState page index (already authored) is kept: it cost nothing further and
its verdicts are what confirmed the B4-B21 finding on a sixth document.

## M2 — Caltech adjudication rulings (partial: cost, class_profile, def)

| group | keys | agreement | conflicts | ambiguous |
|---|---|---|---|---|
| cost | 43 | 97.67% | 1 value_conflict | 1 |
| class_profile | 36 | 100% | 0 | 0 |
| def | 60 | 100% | 0 | 1 |

### Ruling — `cost.cost_academic_year` on Caltech = `2024-2025` (pass B)

The page is genuinely self-contradictory and both passes flagged it, which is the
protocol working. Page 29 prints, in this order:

1. `G0.` net price calculator URL question,
2. bolded lead-in: **"Provide 2024-2025 academic year costs of attendance..."**,
3. an UNCHECKED box: "Check here if your institution's **2025-2026** ... costs are
   not available at this time...",
4. `G1.` instructional text: "for the **FULL 2025-2026** academic year",
5. G1 column headers: `FIRST-YEAR` / `UNDERGRADUATES` — **no year at all**.

Pass A took (4) → `2025-2026`. Pass B took (2) → `2024-2025`.

The instruction reads *"Copy the G0 cost-year label exactly as printed (the year
printed in the G1 tuition/fee/room/board column headings)."* The parenthetical is a
**locator for the primary designation, not a competing source** — and it does not
resolve on this document, because the G1 headers carry no year. Falling back to the
primary designation ("the G0 cost-year label") gives the bolded lead-in directly
under G0: `2024-2025`. The metric's `source_hints` is `['G0']` and its description
says "from the G0 heading", so three independent signals point the same way.

Recorded `2024-2025`. Pass A's reading is defensible about the *document* — Caltech
really did print a contradiction — but wrong about the *contract*.

`cost.final_costs_not_available` = `present`/`false` (both passes): the instruction
allows `false` "only when the complete visible G0 checklist shows that control
unambiguously unmarked", and the single box is plainly visible and empty. Correct.

Both passes marked the three G5 `transportation_*` metrics `absent`. Caltech's G5
prints six rows (Books and supplies / Housing only / Food only / Food and housing
total / Living expenses / Other expenses) with **no Transportation row**. Pass A
raised whether the populated "Living expenses**" row is this edition's successor.
Kept `absent`: the label differs, the metric's hints and description target
"Transportation" specifically, and treating a differently-named row as equivalent is
an inference the engine cannot make from the page.

### Ruling — `student_life.air_force_rotc_on_campus` = `false`, flag dismissed

Both passes recorded `false` and both flagged the same anomaly: the F3 Air Force
"On campus" box renders as a solid gray square unlike ordinary white empty boxes,
raising the possibility that a checked state was obscured. Checked the page image
directly, since agreed-but-flagged items have twice overturned both passes.

**The gray is AcroForm widget-background styling, not a mark.** The discriminator on
this page is the `✓` glyph, not the fill. Decisive evidence: all three Naval ROTC
boxes are gray-filled and unchecked, and Naval ROTC is plainly not offered (its
cooperating-institution name field is empty). Meanwhile Army and Air Force "At
cooperating institution" are gray-filled AND carry a `✓`, with populated name
fields (`USC`; `USC, CSUSB, LMU, UCLA`).

So gray ≠ checked, and `false` stands. Worth stating as a general hazard: **on
AcroForm-derived CDS pages, widget background fill is styling and carries no
semantics — only the glyph does.** Distinct from the column-position hazard, where
the glyph is identical and position carries meaning.

### D19 — GT agent fan-out is capped at 3 concurrent image-reading agents

Launched 8 Caltech GT agents at once; **6 stalled at the 600s watchdog within the
same window**, including both halves of three different groups. The identical
pattern hit an earlier 6-agent UCF wave. Two waves, same shape: this is a
throughput ceiling on concurrent image reading, not eight independent failures.

Standing rule: **at most 3 concurrent agents when the work is page-image reading.**
Text-only agents are not known to be affected.

D16 earned its keep again. Of the six "failed" agents:
- `ij` passes A and B were **both complete on disk** (62/62, real values with
  specific figures like `31.10`/`14.50`, not placeholders). They finished, wrote,
  and then stalled on a redundant re-read.
- `ab` passA was complete (28/28); `ab` passB had 14/28.
- `admissions` had 63/98 and 69/98; `financial_aid` passA had 23/67 and passB had
  no file at all.

Had I trusted the notification status, I would have thrown away two finished passes
and re-paid for them. Conversely the key-count check alone would have been unsafe —
`ij` reaching 62/62 while its agent was mid-"reading pages 41-42" is exactly D17's
shape, so the evidence strings were checked for real figures before accepting.

Resumed agents are told to read their OWN existing partial file and keep it. That
preserves two-pass independence: a resumed pass A never sees pass B.

### Caltech `ij` — 100% agreement, Section J sum 100.2

Both passes: 27 present / 33 blank / 2 absent, zero conflicts, zero ambiguous.

Six populated Bachelor's disciplines summing to **100.2**, not 100.0. Recorded as
printed on both passes; not corrected. Caltech grants degrees in few fields, so
each printed percentage is large and its rounding error is correspondingly visible.
Per the brief, GT never computes or reconciles a value the document does not print —
"fixing" the sum would score a correct engine wrong.

---

# EXPERIMENT 1 — BASELINE (shipped config), first document

`baseline-01`, cornell_2022-2023, shipped defaults (batch size and concurrency
unchanged), model unchanged. **The API is healthy again** — a single-call probe
returned in 68.4s versus 350.1s on the pre-compaction probe. Every latency number
below is therefore NOT comparable to the earlier failed runs, and Experiment 2
(noise floor) is a precondition for reading any latency delta as signal.

```
accuracy 97.91%   coverage 97.93%   cost $0.090096   latency 643.6s   calls 23
correct=234 wrong=2 missed=5 hallucinated=3 correct_abstention=150
uncovered=0 unreadable=0 gt_error=0 citation-mismatch=0
```

Against the §1 targets:

| dimension | measured | target | floor | verdict |
|---|---|---|---|---|
| accuracy | 97.91% | 100% | 99.5% | **below floor** |
| coverage | 97.93% | ≥98% | 95% | just under target, above floor |
| hallucination | 3 | 0 | 0 | **fails, zero tolerance** |
| cost/doc | $0.0901 | ≤$0.10 | ≤$0.15 | passes, little headroom |
| latency/doc | 643.6s | ≤240s | ≤360s | **fails by 1.8×** |

`gt_error=0` and `uncovered=0` — the sealed Cornell GT is fully exercised by this
run and nothing is quarantined. The measurement is trustworthy.

## Autopsy — every one of the 10 errors

**The three hallucinations are one family, and they are real.** All are H9/H10
selection booleans that GT marks `absent`. Because §1 tolerates zero hallucination,
the whole score hangs on that one ruling, so I verified it against page 23 directly
rather than trusting the sealed value:

- H9 prints `Priority date for filing...: ______` and `Deadline for filing...: ______`
  as **bare rules with no checkbox**. `aid_priority_date_selected` and
  `aid_deadline_selected` are correctly `absent`. Engine emitted `False` for both —
  asserting an unticked box that does not exist.
- H10 prints `a) Students notified on or about (date):` with `15-Apr` on a bare
  line, no control. GT `absent`. **Engine emitted `True`** — it inferred "this
  option is selected" from the fact that the adjacent date is filled in.

That third one is the systematic pattern worth naming: **the engine manufactures a
selection state for a control that does not exist whenever neighbouring data is
populated.** The metric's own `instructions` already forbid exactly this inference,
and the engine is given those instructions, so this is not a catalog gap — it is the
model disregarding a negative instruction. Independent confirmation that the ruling
discriminates properly: the Caltech pass B agent, holding the same ruling, recorded
Caltech's H9/H10 as ordinary `present` booleans *because Caltech prints real
per-line checkboxes*. The rule fires on template shape, not blanket.

**`financial_aid.aid_reporting_academic_year` — wrong: engine `2021-2022`, GT
`2022-2023`, both citing page 19.** Cornell's running header on pages 3-27 prints a
stale `2021-2022` while the document is the 2022-2023 cycle. The engine took the
year from the running header. This is header-year contamination — the exact hazard
the GT brief warns human readers about, now observed in the engine.

**Two `missed` with `page=None`: `h2_i_average_percent_need_met_all_full_time` and
`h2_j_average_aid_package_all_full_time`, both on GT page 20.** The engine never
saw the page. Routing, not reading.

Remaining: `admissions.open_admission_selective_programs` wrong (True vs False);
`sat_only_admission_policy`, `cost.final_costs_not_available` and
`transfer.minimum_prior_credit_threshold_applies` abstained with
`availability_status='not_reported'` where GT has a real value.

**Reading the whole picture:** cost is nearly won and latency is the worst failure,
but accuracy and hallucination are what actually block the §1 floor, and they are
NOT dominated by routing. Two of the three failure families here (invented selection
states, header-year contamination) are instruction-adherence problems that no amount
of page-narrowing will fix. Routing explains the two `page=None` misses and is worth
fixing on cost/latency grounds, but I should stop expecting it to carry accuracy.

### Ruling — Caltech H14: all 11 conflicts go to pass A (`blank`, not `present`/false)

`financial_aid` adjudicated at 83.58% — the worst agreement of any group so far, but
**every one of the 11 conflicts is the same disagreement repeated**: pass A wrote
`blank`/None, pass B wrote `present`/false, for eleven H14 grid cells.

Pass A is correct. The metric instruction states it in terms that leave no room:

> *"Every H14 cell is independent of every other cell; a blank cell in this or any
> other visible H14 coordinate is **not_reported, never false**, and must not be
> inferred from another cell."*

Pass B applied the brief's general rule (an unticked standalone checkbox is
`present`/false). That general rule is explicitly subordinate to a metric's own
`instructions`, and this is the second family to exercise the override — the first
was `transfer.transfer_rolling_admission_fall`.

Worth generalising, because it will recur: **a "blank is not_reported, never false"
instruction turns an empty checkbox from an answer into a non-answer.** The
distinction is substantive rather than clerical — it decides whether an abstaining
engine scores `correct_abstention` or `missed`, and whether an engine emitting
`false` scores `correct` or `hallucinated`. Getting it backwards on 11 cells would
have silently moved 11 metrics between buckets on every future Caltech measurement.

Note the asymmetry in blast radius: pass B's reading would ALSO have made an engine
that emits `false` look correct on all 11, which is the more dangerous direction —
it would have credited exactly the invented-selection-state behaviour that the
Cornell baseline just caught the engine doing.

No override needed at seal time: pass A is the merge source and already holds the
correct values.

### Ruling — Caltech `cost.cost_academic_year` override at seal

Pass A (merge source) holds `2025-2026`; the adjudicated value is `2024-2025`.
This is the one `ADJ` override applied when assembling the Caltech seal.

## EXPERIMENT 1 — BASELINE, full 5-document corpus: two of five runs are INVALID

| document | acc | cov | cost | latency | w/h/m | failed calls |
|---|---|---|---|---|---|---|
| cornell | 97.91 | 97.93 | $0.0901 | 643.6s | 2/3/5 | **0** |
| dartmouth | 98.33 | 94.40 | $0.0935 | 492.7s | 1/3/14 | **0** |
| ucf | 93.96 | 79.94 | $0.0729 | 894.1s | 10/6/65 | **3 of 23** |
| uga | 76.92 | 8.39 | $0.0469 | 1239.1s | 6/0/284 | **9 of 23** |

**UGA and UCF are not measurements and must not be booked as baseline accuracy.**
UGA's 8.39% coverage is 9 dead calls, not a model that failed to read. The scorer's
RUN ERRORS panel is the only reason this was caught — the headline numbers look like
a catastrophically bad engine, and cost/latency look *better* on UGA than anywhere
else precisely because a third of its calls never completed. **A cheap fast run is
the signature of a broken one.** (This is the same trap as the filed scorer
hardening item: a total failure emits `-0.0` cost and wins the cost axis.)

### The failures are the routing defect, and this CORRECTS what I wrote earlier

I wrote, in the Cornell autopsy above: *"Routing ... is worth fixing on cost/latency
grounds, but I should stop expecting it to carry accuracy."* **That is wrong, and
the corpus-wide data refutes it.** Retracted.

Errors are all `WriteTimeout: The write operation timed out` and one
`ReadError: SSL UNEXPECTED_EOF` — failures *uploading the request*, i.e. payload
size, not model behaviour.

Join the failures against the batches that succeeded:

```
uga        successful calls: max pages_sent = 6,  mean 5.4
           failed: admissions 0,1,3 | class_size 0 | cost 0
                   degrees 0,1 | enrollment 0 | financial_aid 0
ucf        successful calls: max pages_sent = 12, mean 6.1
           failed: degrees 0,1 | financial_aid 0
dartmouth  successful calls: max pages_sent = 34, mean 9.9   failed: none
cornell    successful calls: max pages_sent = 30, mean 7.8    failed: none
```

Two things fall out:

1. **The oversized batches are absent from the successful set entirely.** UGA's
   recorded dry-run plan has `financial_aid` b0 sending 41 pages and `enrollment`
   b0 sending 33 pages for 4 metrics; no UGA call above 6 pages survived. The
   over-wide calls are exactly the ones that died.
2. **`degrees` and `financial_aid` fail on BOTH affected documents.** Those are
   precisely the two domains the routing audit named — `degrees` via the bare `J`
   hint matching TOC lines and lettered sub-items, `financial_aid` via the widest
   convex hull. This is not a coincidence of network weather.

It is not a flat page threshold — Dartmouth and Cornell each succeeded at 30-34
pages. It is that UGA's and UCF's worst batches are far wider still, and those are
the ones that time out on upload.

**So the convex-hull fix changes category.** It was justified as a 26.3% page-send
reduction (cost and latency). It is now also the largest available *coverage* lever,
because over-wide batches do not merely cost more — they fail outright, and a failed
call zeroes every metric in it. That makes the ordering question sharper, not looser:
land the certain correctness fix first, re-baseline, then clustering, so the two are
never confounded.

**Only cornell and dartmouth are usable baseline accuracy numbers.** On those two,
clean: accuracy 97.91 / 98.33 (floor 99.5 — both below), hallucination 3 / 3
(tolerance 0 — both fail), cost $0.090 / $0.094 (target $0.10 — both pass, thin
headroom), latency 643.6s / 492.7s (target 240s — both fail).

Dartmouth's 14 `missed` against Cornell's 5, with zero failed calls on both, is a
real coverage difference worth an autopsy of its own rather than an assumption.

---

# THE REAL BLOCKER WAS NEVER THE ROUTING HULL

Two bugs in `adapters/cds_pdf.py:_narrow_document_sync`, both found by running the
engine instead of reasoning about it. Between them they explain every invalid
baseline. Neither is a tuning knob; both are production defects.

## Bug 1 — "narrowing" INFLATED the payload

`sub.tobytes()` with default options writes an **uncompressed** document, and the
per-page `insert_pdf` loop copies each page's whole resource tree. Result: a slice
could be larger than the document it was cut from.

```
5-page slice          full doc     slice     ratio
caltech_2024-2025    2,143,966  3,956,646   1.85x   <- slice BIGGER than the document
ucf_2023-2024          721,635    851,103   1.18x
uga_2023-2024        2,031,967  1,297,270   0.64x
dartmouth_2024-2025    770,516    506,233   0.66x
cornell_2022-2023      720,763    357,155   0.50x
```

That ordering is exactly the baseline failure ordering: caltech 23/23 calls failed,
uga 9/23, ucf 3/23, dartmouth and cornell 0. Every error was `WriteTimeout` — the
upload, not the model. Raising the timeout 180s -> 600s did NOT help (a single
Caltech call still failed after 1816s ~= 3 x 600s), which is what ruled out "slow
network" and pointed at payload size.

`deflate=True, garbage=4` cuts the 5-doc slice total 7,196,574 -> 2,095,394 (**3.4x**).

**`clean=True` looked even better (another 2x) and I nearly shipped it.** The
control saved me: the SHIPPED default already produced 4 text diffs and 10 render
diffs on those slices, and `deflate+garbage=4` produced *exactly the same* 4 and 10.
So `clean` was not the thing corrupting content — the corruption pre-dated all of
it, and I had briefly blamed the wrong flag. Measuring the baseline of a comparison,
not just the variants, is what caught it.

## Bug 2 — narrowing silently DESTROYED AcroForm field values

The pre-existing 4 text diffs were the real prize. `insert_pdf` copies page content
but leaves the **document-level AcroForm** behind, so interactive form fields lose
their values. UGA (whose ground truth is AcroForm-exact) loses text on 4 of 5 sampled
pages — p20 goes 937 -> 675 characters.

Consequence, from the exp02 run: UGA completed **23 of 23 calls with zero errors**
and still scored 6.45% coverage. Not a crash — 350 findings came back, and
**326 of them said `not_reported`**, with excerpts like `☐ Accelerated pro...`
showing an EMPTY checkbox glyph. The model was handed a blanked-out document and
truthfully reported that nothing was filled in.

This is the more dangerous of the two bugs by a wide margin: bug 1 raises an
exception, bug 2 produces a confident, plausible, wrong answer. It is invisible to
every signal except ground truth. Note also that it was **masked** by bug 1 — while
UGA's calls were timing out, its low coverage looked like the timeouts.

Fix: `doc.select(pages)` on a copy of the source instead of `insert_pdf` into a
fresh document. Measured 5-doc fidelity: `insert_pdf` 4 text diffs / 10 render
diffs; `select` **0 and 0**.

Cost of the fix: `select` retains more of the source, so slices get bigger again
(uga 5-page slice = 3.05MB, larger than the 2.03MB source). Correctness first —
size is then a tuning problem, and the convex-hull/cluster work is what addresses
it. Filed: a guard that sends the original document whenever the slice would exceed
it, since a slice bigger than the source is never worth building.

## Experiment 2 — payload fix + B4-B21 hint fix (5 docs)

| doc | acc | cov | cost | latency | failed calls (was) |
|---|---|---|---|---|---|
| caltech | 99.44 | 74.68 | $0.0653 | 1263.7s | 4 (was 23) |
| cornell | 97.66 | 69.71 | $0.0740 | 314.1s | 4 (was 0) |
| dartmouth | 98.25 | 90.00 | $0.0906 | 362.9s | 1 (was 0) |
| ucf | 95.71 | 99.07 | $0.1047 | 352.1s | 0 (was 3) |
| uga | 100.0 | 6.45 | $0.0932 | 743.9s | 0 (was 9) |

Caltech went from a total loss to a scoring run, UCF coverage 79.94 -> 99.07, and
Cornell latency halved (643.6s -> 314.1s). But cornell/dartmouth picked up new
failures they did not have before, so transport is still flaky and **run-to-run
variance is real** — Experiment 2's noise floor remains a precondition before any
of these deltas is treated as signal. Do not crown anything on this table.

## Process correction (user directive)

Test on ONE document first and widen only once it holds. I ran 5-document sweeps
for changes that a single document would have falsified just as fast and ~5x
cheaper.

## The fix that actually works: bake, then slice

Iterating on bug 2 produced three candidates. Recording all three, because the
first two each looked correct in isolation and were wrong on a different axis.

| approach | fidelity | UGA 5pp slice | verdict |
|---|---|---|---|
| `insert_pdf` (shipped) | 4 text diffs | 525KB | small, silently corrupts form values |
| `select` on a copy | 0 text diffs | 3.05MB (> 2.03MB source) | correct, reinflates payload |
| **`bake()` then `insert_pdf`** | **0 text diffs** | **539KB** | correct AND small |

`select` was measured in a real run before being discarded: UGA came back **23/23
calls failed, $0.00, 2434s** — straight back to the WriteTimeouts that bug 1 caused,
because a 3.05MB slice is worse than sending the 2.03MB document. Fixing fidelity by
reinflating the payload just trades one bug for the other.

`doc.bake()` converts interactive field appearances into ordinary page content
*before* slicing. Slicing preserves page content, so the values survive the cheap
`insert_pdf` path. Applied only when `doc.is_form_pdf` — of the six corpus
documents only UGA is one (1228 widgets; the other five have zero), so nothing else
pays for it.

Final measured state, all five documents faithful and every slice now smaller than
its own source:

```
uga        2,031,967 -> 538,936  0.27x   text_diffs=0
cornell      720,763 ->  87,284  0.12x   text_diffs=0
ucf          721,635 -> 258,575  0.36x   text_diffs=0
caltech    2,143,966 -> 970,479  0.45x   text_diffs=0   (was 1.85x, i.e. 4.1x smaller)
dartmouth    770,516 -> 253,599  0.33x   text_diffs=0
```

Plus a guard: if a slice ever comes out >= its source, send the source with an
identity page map. A slice bigger than the document is strictly worse on every axis,
and this keeps any future document from silently re-entering the bug-1 regime.

**Method note.** Three candidate fixes, three different failure modes, and the only
reason the wrong two were caught is that each was measured — one against a fidelity
control, one against a real run — rather than reasoned about. The `select` attempt
in particular passed every offline check I had and still failed in production.

## UGA's checkboxes: the text layer does not omit the answer, it ASSERTS THE WRONG ONE

Chain of four experiments on one document, `academics` (24 all-boolean E1/E3
checkbox metrics). Recorded in full because the first three each looked like the
obvious fix and each failed for a different reason.

| # | change | academics result |
|---|---|---|
| baseline-01 / exp02 | (shipped) | 0 correct, **24 missed** |
| exp04 | bake + cluster | 0 correct, **24 wrong** |
| exp05 | + page image attached | 0 correct, 24 wrong |
| exp06 | + explicit "the text layer lies" prompt note | 0 correct, 24 wrong |
| **exp07** | **images only, PDF withheld** | **24 correct, 0 wrong** |

**The diagnosis.** An AcroForm checkbox's tick is drawn in the widget's appearance
stream. It renders correctly and never becomes text. UGA's E1 page yields
**32 U+2610 (EMPTY ballot box) glyphs and zero checked glyphs** — identical before
and after baking — while the rendered page plainly shows 15 ticked boxes.

So the text layer is not merely silent about the answer. It states, in characters,
that every box is empty. The model read it, believed it, and returned
`false` with the excerpt `"☐ Accelerated program"` — a verbatim, honest quote of a
lie. Every downstream honesty signal passes: the excerpt is real, on the cited page,
and faithfully transcribed. Only ground truth catches it.

**Why exp05 and exp06 failed.** Attaching a truthful image did nothing. Adding an
explicit instruction — *"this document's text layer renders EVERY checkbox as ☐
regardless of state; use the image only"* — also did nothing; the model kept quoting
the ballot box. Given contradictory evidence plus a warning, it still preferred the
text. **Misleading evidence has to be absent, not contradicted.**

**The fix.** For a batch whose metrics are ALL boolean, on a document where
`is_form_pdf`, send the routed page images and withhold the PDF. The model then has
only the truthful witness. 0/24 -> 24/24, and it is *cheaper and faster* than the
broken path ($0.0042 vs $0.0056, 17.5s vs 35.1s) because a couple of PNGs cost less
than a multi-page PDF.

Deliberately narrow: all-boolean batches only (a mixed batch still needs the text for
its numbers), form PDFs only (1 of 6 corpus documents), routed pages only, capped at
4. This does not touch the C7 path, which already had its own image supplement.

**This retroactively explains the shipped design.** Spike part B found a real gain
from sending a C7 page image and kept the PDF alongside it. The corpus recon warned
the text layer "can be silently, plausibly wrong". Both were circling this bug; C7
was simply the first place it was noticed. It was never C7-specific.

---

# CHAMPION vs BASELINE — full corpus, 5 documents

Config: compressed slices, bake-before-slice, densest-cluster routing, B4-B21 hint
+ whitespace tolerance, images-only for all-boolean form batches.

| document | accuracy | coverage | cost | latency | failed calls |
|---|---|---|---|---|---|
| cornell | 98.34 | 98.76 | $0.0853 | 147.5s | 0 |
| dartmouth | 98.33 | 94.40 | $0.0910 | 215.1s | 0 |
| ucf | 95.69 | 98.77 | $0.0920 | 203.3s | 0 |
| uga | 94.90 | 94.19 | $0.0929 | 330.3s | 0 |
| caltech | 91.98 | 95.36 | $0.0842 | 572.2s | 0 |

| aggregate | baseline-01 | champion | delta |
|---|---|---|---|
| correct | 738 | **1280** | +542 |
| missed | 605 | **50** | -555 |
| coverage | 55.58% | **96.33%** | +40.75pp |
| accuracy | 95.97% | 95.81% | -0.16pp |
| hallucinated | 12 | 24 | +12 |
| cost/doc | $0.0607 | $0.0891 | +$0.0284 |
| latency/doc | 1062.4s | **293.7s** | -3.6x |
| **failed calls** | **35** | **0** | -35 |

## Read this table honestly

**The baseline is not a valid comparator and its "wins" are artifacts of being
broken.** Its cost/doc is lower because 35 of its 115 calls never completed, and its
accuracy is computed over 769 extractions against the champion's 1336. A cheap, fast,
accurate-looking run that answered barely half the questions is not a better run.

The only clean same-config comparison is the two documents whose baseline had zero
failed calls:

- **cornell** 97.91/97.93 -> **98.34/98.76**, $0.0901 -> $0.0853, 643.6s -> 147.5s.
  Better on all four axes at once.
- **dartmouth** 98.33/94.40 -> **98.33/94.40** (identical), $0.0935 -> $0.0910,
  492.7s -> 215.1s. No accuracy or coverage movement, cheaper, 2.3x faster.

So: no regression on either clean document, a strict improvement on one, and the
three previously-unmeasurable documents now measure.

**Hallucinations doubled, 12 -> 24, and that is a real cost, not only an artifact.**
Some of it is surface area — the engine now answers 1336 questions instead of 769,
so there is simply more to get wrong. But §1 tolerates zero, so the direction is
wrong regardless of the denominator. Caltech alone contributes 11.

## Against the §1 targets — NOT met

| dimension | measured | target | floor | verdict |
|---|---|---|---|---|
| accuracy | 95.81% | 100% | 99.5% | **fails floor** |
| coverage | 96.33% | >=98% | 95% | under target, above floor |
| hallucination | 24 | 0 | 0 | **fails** |
| cost/doc | $0.0891 | <=$0.10 | <=$0.15 | passes |
| latency/doc | 293.7s | <=240s | <=360s | over target, within floor (caltech 572s is not) |

Cost is won. Latency is nearly won. **Accuracy and hallucination are the blockers**,
and they are no longer routing or transport problems — they are reading problems.

## UGA error autopsy (13 wrong, 2 hallucinated) — the next levers

- **outcomes, 6 wrong.** Engine cites page 10 every time; GT is on pages 8-9. UGA
  prints more than one B4-B21 cohort grid and the engine read the wrong one. The
  metric says "first/most recent visible" grid — the window now spans all of them
  and nothing tells the model which. Highest-value single fix left.
- **transfer, 2 wrong.** `required_some` vs `recommended_some` on the D5 grid —
  column-position misreads, the known checkbox-grid class, on a non-boolean metric
  so the images-only path does not cover it.
- **financial_aid, 3 wrong.** Wrong aid year (`2022-2023` vs `2023-2024`) and status
  (`final` vs `estimated`) on the same page — the same header/label contamination
  seen on Cornell — plus `12 15` vs `12/15`, a separator dropped.
- **identity, 2 wrong, and one is the engine being "helpful".**
  `state_or_region`: engine expanded `GA` to `Georgia`. `application_url`: GT says
  `ttps://apply.uga.edu/apply/` and the engine answered `https://...`. **The page
  really does render `ttps://` — UGA typo'd its own URL.** Verified in the baked
  text layer. Ground truth is right and the engine silently corrected a source
  typo. It is a small error with a large implication: an extractor that repairs
  what the document says is no longer reporting what the document says.
