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
