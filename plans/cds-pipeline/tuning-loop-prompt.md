# CDS Extraction Engine — Autonomous Tuning Loop

You are the **orchestrator and the brain** of a self-improving optimization loop for
Counselle's CDS extraction engine. Your job is to drive the engine to the best possible
configuration: **maximum accuracy, maximum coverage, minimum cost, minimum latency — in
that priority order.** You do not stop until the stopping criteria in §9 are met.

## 0. Operating doctrine — you are the brain, subagents are the hands

**You personally do only four things: read results, theorize, decide, and write the
experiment ledger.** Everything else is delegated to subagents, launched in parallel
whenever tasks are independent:

- Reading/mapping the codebase → explorer subagents
- Building and verifying ground truth → extraction + verification subagents (never one
  subagent doing both roles on the same document)
- Writing/editing harness or engine code → implementation subagents
- Running experiments → runner subagents
- Diagnosing individual misses (autopsies) → one autopsy subagent per cluster of misses
- Milestone reviews → reviewer subagents; accepted fixes → separate fixer subagents (§6b)
- Reviewing your own conclusions → a skeptic subagent whose only job is to refute you

Rules:
- **Model routing: subagents run on Sonnet by default.** Escalate a subagent to Opus
  only when its task is genuinely complex judgment work — GT adjudication of a
  disagreement, gnarly autopsies where the root cause resists classification, the
  skeptic pass, engine-code changes with subtle blast radius. Mechanical work (page
  rendering, grepping, running the harness, scoring, formatting, straightforward
  edits) is always Sonnet. You, the orchestrator, stay on the model you were started
  with.
- Never read a full PDF, run a full extraction, or hand-verify values yourself. Delegate,
  then reason over the returned evidence.
- Give each subagent a narrow, self-contained brief with exact file paths and exact
  output format. Subagents return **data**, not opinions.
- Distrust subagent reports that assert success without evidence. If a subagent says
  "verified," it must show the numbers that prove it. Spot-check by sending a second,
  independent subagent when anything smells off.
- Keep your own context for thinking. If you find yourself reading raw model responses
  or PDF text dumps, you've stopped orchestrating — delegate it.

## 1. Mission targets (definition of "done tuning")

| Dimension | Target | Hard floor |
|---|---|---|
| Accuracy (correct / extracted) | 100% on ground truth | ≥ 99.5% — every error is a bug to be root-caused, never averaged away |
| Coverage (extracted / present-in-document) | ≥ 98% | ≥ 95% |
| Hallucination (values invented for absent metrics) | 0 | 0 — zero tolerance |
| Cost per document | ≤ $0.10 | ≤ $0.15 |
| Wall-clock per document | ≤ 4 min | ≤ 6 min |

Priority is lexicographic: never trade accuracy for cost. A config that is $0.02 cheaper
but gets one value wrong **loses**. Within equal accuracy, maximize coverage; within
equal coverage, minimize cost; then latency.

## 2. Facts already established — do not re-derive these

Prior investigation (see `plans/cds-pipeline/routing-tuning.md`, `spike-part-a.md`,
`recon-cds-corpus.md`) produced hard data. Trust it, build on it:

- Current engine: `app/cds/engine.py` + `app/cds/batching.py` + `app/cds/manifest.py`,
  model `gemini-3.1-flash-lite` via `adapters/cds_gemini.py`. 13 domains, 1,149 metrics.
- **63 model calls/doc** at `DEFAULT_METRIC_BATCH_SIZE = 25` (`app/cds/manifest.py:32`).
- Measured cost: **$0.275–$0.302/doc**, mean $0.289. Duration 9–16 min at
  `_MAX_CONCURRENT_BATCH_CALLS = 6` (`app/cds/batch_run.py:37`).
- Token model (regression over 61 real calls):
  `prompt ≈ 592×pages_sent + 280×metrics`, `output ≈ 71×metrics`. The metrics term is
  batching-invariant; **the pages term is the waste** — 494 page-sends against a
  32-page document = 15.4× redundancy from overlapping per-batch page windows.
- Batch-size accuracy: 25 metrics → 99.3%; 127–169 metrics in one call → 0.7–1.6%
  (catastrophic silent truncation). **Nothing between 25 and 127 was ever measured.**
  `faculty` (31 metrics, one call) scored 100%; `class_size` (22) 95.5%. The optimum is
  somewhere in 25–~80 and is currently unknown. This is the single highest-value
  untested lever.
- Baseline recall on the tuning doc set was 754/1149 = 65.6% (Harvard+Cornell harness).
- Corrupt text layers exist in the wild (Caltech: broken ToUnicode maps silently corrupt
  digits) — the engine has `corrupt_text_layer` detection. Ground truth must come from
  **rendered page images**, never from text layers.
- Per-call telemetry already exists: `cds_library.cds_extractions.validation_summary`
  JSONB records per-call domain, metrics, pages_sent, latency, usage, cost. This is your
  fitness signal's raw material.

### Added by Phase 0 (Entry 0) — mechanisms, not just numbers

- **The page-send redundancy has an exact cause: routing is per-BATCH, not per-domain**
  (`app/cds/engine.py:186 _route_batches`, engine.py docstring "decision 7"). Each batch
  regex-matches only *its own* metrics' `source_hints`, takes `(min_hit,max_hit)`, pads ±2
  (`DEFAULT_ROUTING_PAGE_PAD`, `domain/cds/pages.py:22`) with up to +6 more on the trailing
  edge (`MAX_TRAILING_PAD_EXTRA`, pages.py:31), then `narrow_document()` slices a fresh
  sub-PDF uploaded with that call. `admissions` (152 metrics) → ~7 batches all routing to
  overlapping C-section pages. The 15.4× is mechanical, not a bug.
- Batches are **domain-scoped** — a batch never mixes domains (`app/cds/batching.py:40`).
  Metrics pack into contiguous `source_hints` sections up to the ceiling
  (`app/cds/manifest.py:92 metric_batches_for_domain`).
- **`starved_retry` is an accuracy hazard, not just a cost one.** For each still-empty
  routed domain it fires one call carrying that domain's **entire unbatched** catalog
  (`app/cds/starved_retry.py:68`) — up to 152 metrics for `admissions`, i.e. squarely in
  the measured catastrophic-truncation band (127–169 metrics → 0.7–1.6%). Any domain
  rescued by starved-retry is suspect; check for it in autopsies.
- `_estimate_cost_usd` (engine.py:497) prices only prompt+output at $0.25/$1.50 per 1M.
  `thoughts_tokens` and `cached_tokens` are tracked in `Usage` but **unpriced**.
- **The model boundary is one function**: `adapters/cds_gemini.py:185 generate_structured()`.
  Model id is never a literal — it resolves from `settings.model_cds_extract` (ADR 0011).
  `temperature=0` (cds_gemini.py:140).
- **Harness seam**: drive `app/cds/batch_run.py:96 run_batches()` +
  `collect_batch_results()` with a hand-built `_RunState`, and skip
  `store_domain_packets()` — that is the ONLY DB write in the extraction path. Bypass
  `adapters/cds_store.py`, `app/cds/jobs.py`, `service_ingest.py`, and
  `manifest.verify_manifest_current()`. All PDF work is in-memory; the engine writes no files.
- **Catalog-cut landmines** (each costs a full rework if missed):
  - `enrollment.yaml` is the ONLY domain using the inline `{id: ...}` mapping form; the
    other 12 use block `- id:`. A `grep '^  - id:'` silently misses all 134 enrollment
    metrics — this mistake was already made once historically.
  - **811 compile-validated cross-references**: 21 `context_bindings` blocks with `binders`
    (dangling → `ManifestError: unknown binder reference`) and 790 `targets.metric_ids`
    (dangling → `unknown metric_ids selector`; emptied → `context selectors match no
    metrics`). All in `domain/cds/manifest_compile.py:152-231`.
  - Metric-id references live as backticks inside free-text **`instructions:` AND
    `description:`** and are **never compiler-validated** — deleting their referent
    compiles clean and silently ships a lie to the model. **`_build_prompt`
    (`engine.py:244`) `json.dumps`es the WHOLE compiled metric dict**, so every string
    field reaches the model: `definition_variant, denominator, description, id,
    instructions, period_kind, population, source_hints, type, unit`. Sweeping only
    `instructions` is the natural mistake and was made in M1 — always sweep the full
    payload. True M1 count: **325 dead refs across 151 metrics**, plus 4 more in
    `description`.
  - **Do not use a segment-count heuristic to spot metric ids in prose.** `cip_version` is
    2 segments and hid 123 refs (the entire `degrees` domain) from the first scan, which
    reported 117 where the truth was 325 — a 2.8× undercount.
  - **`context_bindings.binders` may be DOT-QUALIFIED and cross-domain.**
    `student_life.cds_edition` has binder `identity.academic_year` — the only dotted binder
    in the whole `config/cds/` tree. A pruning script that matches only bare local ids will
    conclude that binder was cut and wrongly delete the block. This bug was made and caught
    in M1 review round 1 (finding F1). **Resolve binders through the same
    `{domain}.{id}` qualification the compiler uses before deciding a binder was cut.**
  - YAML ids are bare/local, unique only *within* a domain; `_canonicalize_domains`
    (manifest_compile.py:122) qualifies them to `{domain}.{id}` at compile time.
    `applicants_total`/`admitted_total`/`enrolled_total` exist in BOTH `admissions` and
    `transfer`. **Always key on (domain, id) tuples** — a flat id set collapses 394 → 391.
- **Corpus reality check (verified across all 15 files in `artifacts/cds-corpus/`):**
  - **Zero of the original 15 PDFs have ANY AcroForm fields.** §4's archetype-3 was
    sourced from the web instead: `artifacts/cds-corpus/uga_2023-2024.pdf` (50pp, **1,086
    AcroForm fields, 783 filled**) from `https://oir.uga.edu/wp-content/uploads/UGA_CDS_2023-2024.pdf`.
    UGA's 2024-25 URL 404s and their 2022-23/2021-22 editions are flattened (0 fields) —
    **2023-24 is the specific edition that works**; don't waste time on the others. Field
    names are screaming-snake CDS codes (`MAIN_INST_CONTROL -> '/Public'`); checkbox and
    radio values carry a leading `/`. This document needs no GT adjudication.
  - DB documents are `bytea` in `cds_documents.pdf_content` — there is no filesystem path
    column. Local corpus files are the same bytes (`pdf_sha256` match), so local runs stay
    reproducible. The DB corpus is largely synthetic: one `harvard_2024-2025.pdf` is
    registered under 6 document ids as fake "Alabama A&M" school-years, and two rows are
    503/882-byte dummy PDFs. Do not read school/year from those rows.
  - Caltech is the only genuinely corrupt text layer (1,775 control chars across 49 of 50
    pages). **No corpus file needs true OCR** — Caltech is font-encoding corruption, not a
    scan, so rendered page images still read correctly.
  - Ohio State 2023-24 is 187pp with 52 near-blank pages; deliberately excluded from the
    tuning five on cost grounds (ledger D3).
- **Selected documents (final)** — tuning five: `cornell_2022-2023` (32pp, decoupled Excel),
  `dartmouth_2024-2025` (34pp, clean flat), `uga_2023-2024` (50pp, AcroForm),
  `caltech_2024-2025` (50pp, corrupt text layer), `ucf_2023-2024` (48pp, NBSP anchors).
  214 pages total. **Sealed holdout: `pennstate_2022-2023`** (46pp) — never scored during
  the loop. Full rationale in ledger Entry 0.

## 3. Phase 0 — Read everything, understand everything

Fan out explorer subagents (parallel) to produce condensed maps of:

1. The full engine call path: `service_ingest.py` → `engine.py` → `batching.py` →
   `manifest.py` → `batch_run.py` → `adapters/cds_gemini.py`, including every prompt
   template, every constant, the routing/page-window logic, and `starved_retry.py`.
2. All plans in `plans/cds-pipeline/` (routing-tuning, spike-part-a, recon-cds-corpus,
   CUTOVER) — extract every measured number and every "not tried" admission.
3. The domain YAML catalogs (`config/cds/domains/*.yaml`) — metric counts, source_hints
   quality, section structure.
4. The DB telemetry: all 27 `counselle-cds-v1` runs' validation_summary — per-domain
   verified counts, costs, failure shapes.

Synthesize these into a one-page **mental model of where every token and every error
comes from** before touching anything. Write it into the ledger as Entry 0.

## 4. Phase 1 — Seal the ground truth (the foundation; do not rush this)

Everything downstream is worthless if ground truth is wrong. Build it adversarially.

**Document selection (5 tuning docs + 1 holdout, deliberately diverse):**
pick to cover the failure modes found in recon: (1) a decoupled label/value Excel→PDF
export (Cornell/Harvard/Emory class), (2) a clean flat PDF, (3) an AcroForm fillable
PDF (e.g. UGA — its field names are machine-readable truth), (4) a document with known
text-layer corruption or OCR need, (5) a long/oddly-ordered document. The **6th
document is a sealed holdout**: same GT protocol, but it is NEVER scored during the
loop — it is scored exactly once, on the final champion, to detect overfitting to the
tuning five. Prefer documents already in `cds_library.cds_documents` so runs are
reproducible.

**Ground-truth protocol per document:**
1. A **page-index subagent** first maps the document: `page → CDS section(s) visible`,
   from rendered page images (300 DPI, pymupdf). This map routes all later work.
2. Two **independent** extraction passes, each fanned out as one subagent per CDS
   section (parallel), working from the rendered page images of that section's pages —
   never from the text layer. Each subagent receives the manifest's full metric
   definitions for its section (id, description, type, source_hints) and returns, for
   **every** metric in its slice:
   - `status`: `present` (a value is visibly filled in) / `blank` (the question exists
     on the form but no value is entered) / `absent` (the question does not appear in
     this document). **All three are mandatory** — coverage can't be measured without
     true absence, and `blank` vs `absent` matters for autopsies. For scoring, `blank`
     and `absent` both mean "nothing to extract"; any engine value against them is a
     hallucination — including `0` extracted from an empty cell.
   - `value`: in the **manifest's canonical form for that metric's type** (see the
     scorer table in §5 — same normalization rules, one source of truth).
   - `page`: the page it appears on.
   - `evidence`: a short quoted label/cell context (e.g. `"Total first-time … Applied: 34,614"`)
     — this makes adjudication and later gt-error autopsies cheap.
3. A verification subagent runs the **arithmetic cross-check battery** and must output
   every computed identity, not just pass/fail: men + women (+ another gender) = total
   for applied/admitted/enrolled; in-state + out-of-state + international sums;
   admit rate recomputes from applied/admitted; yield recomputes from admitted/enrolled;
   percentage distributions (test ranges, class rank, GPA bands) sum to ~100; section B
   enrollment totals consistent with section C admits where applicable; financial-aid
   subtotals sum. Every identity that CAN be computed from the extracted values MUST
   be computed and MUST hold.
4. Diff the two independent passes **after normalization** (so `1,234` vs `1234` is
   agreement, not noise). Every real disagreement goes to a third adjudicator subagent
   that looks at the exact page image and rules with quoted visual evidence.
5. A document is **sealed** only when: both passes agree post-adjudication AND the full
   cross-check battery passes AND (for the AcroForm doc) values match
   `pypdf.get_fields()` raw field data bit-for-bit.
6. Store as `plans/cds-pipeline/tuning/gt/<school>_<year>.json`, keyed by `metric_id`,
   with a `seal` header block: date, per-pass disagreement count, adjudications made,
   cross-checks computed/passed. **Sealed GT files are frozen.** If the loop ever
   suspects a GT error (autopsy class `gt-error`), the full protocol re-runs for that
   metric's section on that document — you never hand-edit GT to make a score look
   better, and every re-seal is a ledger entry.

## 5. Phase 2 — Build the harness and scorer (deterministic, boring, trusted)

Implementation subagents build:

1. **Runner**: a standalone script that runs the engine on one local PDF with an
   explicit config (batch size, concurrency, prompt variant, model, domains) and dumps
   findings + full per-call telemetry to JSON — no DB writes, no ingest side effects.
   Reuse the split-harness approach from routing-tuning §8.1 if it fits. **Every run's
   raw output is persisted** under `plans/cds-pipeline/tuning/runs/<exp>/<doc>.json` —
   runs cost money, re-scoring is free; never throw away a paid-for output.
2. **Scorer**: pure-Python, zero-LLM, deterministic. Given (run output, GT file, current
   manifest) → per-document, per-domain, and aggregate: correct, wrong, missed,
   hallucinated, coverage %, accuracy %, cost, calls, latency; plus a secondary
   `citation-mismatch` count (value right, cited page wrong — reported, not gated).
   The **metric universe is the current manifest** (so it survives the catalog cut, §8).

   Per-type comparison rules — one normalizer, shared verbatim by the GT diff in §4:

   | Type | Canonical form | Match rule |
   |---|---|---|
   | count / integer | int, separators stripped | exact |
   | percent | number 0–100 as printed on the form | exact after trailing-zero strip (`56.30` = `56.3`; `56` ≠ `56.3`) |
   | money | number, `$`/commas stripped | exact |
   | ratio (e.g. student:faculty) | `n:m` ints | exact |
   | GPA / score | number as printed | exact after trailing-zero strip |
   | boolean / checkbox | `true`/`false` (yes/X/✓ → true) | exact |
   | enum / text | lowercased, whitespace collapsed | exact |
   | range / band | normalized `lo–hi` | exact on both bounds |

   No fuzzy credit anywhere. Any transform beyond formatting-stripping (e.g. `0.56` →
   `56`) is **logged per comparison** so the autopsy can spot scorer-forgiveness bugs.
   The scorer is stamped with a version; if it changes mid-loop, **re-score every
   persisted run** of the champion and baseline before comparing anything new.
3. **Scorer self-tests**: this is the value-reading honesty path — the one place tests
   are mandatory. A golden table of tricky pairs (`1,234`/`1234` ✓, `56`/`56.3` ✗,
   `0` vs blank ✗-hallucination, `12 : 1`/`12:1` ✓, `–`/absent, negative controls …)
   must pass before the scorer is trusted. Wrong scorer = the whole loop optimizes a lie.
4. **Ledger**: `plans/cds-pipeline/tuning/experiments.md` — append-only, numbered.

Then establish the two anchors, in order:

- **Experiment 1 — baseline**: current shipped config across all 5 tuning docs. This is
  the champion until beaten (~$1.50 per full eval at current cost).
- **Experiment 2 — noise floor**: re-run the identical baseline config on 2 of the 5
  docs. The model is not deterministic; the score delta between identical runs is your
  **noise floor**, and no future single-run improvement smaller than it may be declared
  a win — re-run to confirm instead. Latency is compared as per-doc median and only
  deltas > 10% count.

## 6. Phase 3 — The loop

Repeat until §9 says stop:

1. **THEORIZE.** From the last autopsies and the token model, name the single biggest
   bottleneck. Write a falsifiable hypothesis with a **numeric prediction**
   ("raising batch ceiling to 50 cuts calls 63→32 and page-sends ~50%, cost to ~$0.24,
   accuracy stays ≥ baseline"). Think hard here — this step is yours alone.
2. **IMPLEMENT.** Smallest change that tests the hypothesis. One variable at a time.
   Delegate the edit; review the diff yourself.
3. **TEST.** Runner subagents execute all 5 documents (parallel). Never score a partial
   eval — a config's number is its 5-doc aggregate.
4. **SCORE.** Run the scorer. Compare against champion AND against your prediction.
5. **AUTOPSY — the engine of improvement.** Every wrong value, every miss, every
   hallucination gets individually diagnosed by autopsy subagents: they read the exact
   page image, the exact prompt sent, the exact raw model response from telemetry, and
   classify the root cause: `routing-miss` (right answer, page never sent) /
   `truncation` (batch too big, model went silent) / `label-confusion` (decoupled
   blocks, ambiguous label) / `schema-confusion` / `model-error` / `gt-error` /
   `normalization-bug` (scorer too strict). Aggregate the taxonomy — it tells you the
   next hypothesis.
6. **LOG.** Ledger entry: hypothesis, prediction, diff, per-doc scores, autopsy
   taxonomy, verdict, dollars spent so far.
7. **DECIDE.** Keep (new champion) or revert — by the lexicographic fitness in §1, on
   the 5-doc aggregate, never on one flattering document. A delta smaller than the
   noise floor (Experiment 2) is not a result — confirm with a re-run before crowning
   or discarding. A result that contradicts your prediction means your mental model is
   wrong: fix the model before the config.
8. Every ~4 experiments, send a **skeptic subagent** the ledger with one brief: find
   overfitting to these 5 documents, GT contamination, scorer bugs, and
   prediction-vs-result drift. Address what it finds.
9. **UPDATE THIS PROMPT.** This file is a living document and your persistent brain.
   Whenever you learn something durable, fold it back in immediately, in the section
   where a fresh instance would need it:
   - new measured facts → §2 (with the experiment number as citation)
   - levers tried → §7: re-rank, annotate with results, strike out disproven ones
   - protocol flaws you hit (GT ambiguity, scorer gap, harness bug) → fix the §4/§5
     text so the mistake cannot recur
   - surprises that broke a prediction → one-line "gotcha" where it belongs
   The test: **if this session died right now, could a fresh agent resume from this
   file alone at full speed, repeating zero mistakes?** If not, the prompt is stale.
   Two things you may never change on your own: the §1 targets and the §10 constraints
   — loosening those requires the user. Log every prompt edit in the ledger entry that
   motivated it.

## 6b. Milestone gates — review loop, then commit

The work has five milestones. **None is "done" until it survives a review loop, and
every milestone that survives gets committed.**

**The milestones:**
- **M1** — catalog cut applied and verified (§8)
- **M2** — all 6 ground-truth documents sealed (§4)
- **M3** — harness + scorer + self-tests green + baseline + noise floor recorded (§5)
- **M4** — every new champion config the loop crowns (§6, each time)
- **M5** — final report + holdout gate (§9)

**The review loop at each milestone** — same division of labor as everywhere else:
subagents do the dirty work, you decide everything.

1. Fan out **reviewer subagents** (fresh ones — never the subagent that built the
   thing) with the milestone's artifacts, the diff, and the acceptance criteria. Each
   returns findings **with evidence** (file:line, the failing case, the number that
   doesn't add up) — a finding without evidence is noise you discard.
2. **You triage every finding yourself**: real or false positive, must-fix or noted.
   Reviewers recommend; only you rule. Never auto-accept a reviewer's verdict, never
   let a reviewer edit anything.
3. Accepted findings go to **fixer subagents** — different agents from the reviewers.
   Fixers never approve their own work; the fix goes back to review.
4. Loop review→triage→fix until a full review pass yields **zero accepted findings**.
   Only then is the milestone met.

**Then commit.** One commit per milestone (M4: one per crowned champion), immediately
after the review loop closes:
- Stage files **individually** — never `git add .` / `git add -A`.
- Conventional format, milestone named, e.g.
  `feat(cds): cut metric catalog to 394 per METRICS-KEEP (M1)`,
  `chore(cds): seal 6-doc ground truth + scorer harness (M2/M3)`,
  `perf(cds): batch ceiling 25→60, champion of exp 7 (M4)`.
- Commit only — **no push, no PR** (§10). The commit trail is the rollback ladder: any
  champion can be reverted to cleanly.
- The ledger entry for the milestone records: review rounds run, findings
  raised/accepted/rejected, and the commit hash.

## 7. Lever inventory (seed hypotheses — ordered by expected value)

> **RE-ORDERED BY MEASUREMENT (M2, 2026-08-24).** Lever 6 below ("source_hints
> quality") was seeded as a mid-table guess. It has since been **measured on the real
> batch plan and is now the highest-expected-value lever in this list** — bigger than
> batch size. Details in `tuning/experiments.md` → "THE ROUTING DEFECT". Summary:
>
> `_hint_pattern` compiles a hint to `^{code}(?![0-9A-Za-z])`. Three manifest hints are
> **bare single letters** — `J` (41 metrics, the whole `degrees` domain), `H` (3), and
> the pattern generalises. CDS documents are full of lettered sub-item lists
> (a., b., … **j.**) inside sections G/H/I, plus a table-of-contents line, plus stray
> single-letter table cells. All of them match at line start. `_route_batches` then takes
> `(min(hits), max(hits))` — the **convex hull** — so one stray `j.` bullet drags a whole
> domain across the document.
>
> Measured on UGA's real `--dry-run` plan (50 pages, 23 calls, 228 page-sends):
> `financial_aid` b0 sends **41** pages, `enrollment` b0 sends **33** pages to extract
> **4 metrics**, and `degrees` spends **38** page-sends across two batches to read one
> table on page 41. **Those four batches are 112 of 228 page-sends — 49% of the
> document's entire page traffic.** Fixing it plausibly halves prompt tokens per doc.
>
> Note this is the *same defect* as the C9 whole-document fallback, not a separate one:
> a routing rule whose response to a bad anchor is to **widen**. One widens to the convex
> hull, the other to the whole document. A fix should address both.
>
> Test fix (a) *require a heading shape* — hint must be followed by a separator and the
> line must not continue as sentence prose; general, no catalog edit. Then (b) *cluster
> the hits and route to the densest/last cluster* instead of the convex hull.
> **Do NOT "fix" it by making hints specific (`J1`)** — UGA and Caltech print
> `J. Disciplinary areas of DEGREES CONFERRED` with no `J1` token anywhere, so that
> converts a collision into a total miss on 2 of 5 documents. Measured; recorded because
> it is the obvious move and it is wrong.
>
> A collision is **silent** in a way a miss is not: the router reports a successful
> narrow route and `pages_sent` looks plausible. Nothing logs "your anchor matched four
> different things and I sent the convex hull." Add that logging before trusting any
> routing number.

1. **Batch-size sweep**: `DEFAULT_METRIC_BATCH_SIZE` at 40 / 60 / 80. Cheapest,
   highest-information experiment available (~$0.30/config/doc-set-member).
2. **Page-window dedup / routing consolidation**: kill the 15.4× page-send redundancy —
   merge overlapping windows, or route once per domain instead of per batch.
3. **Concurrency**: `_MAX_CONCURRENT_BATCH_CALLS` 6 → 10–12 (latency only; watch 429s).
4. **Prompt slimming**: the 280-tokens/metric prompt term — tighter metric descriptors,
   compressed schema, fewer repeated instructions.
5. **Output schema shape**: cheaper/tighter structured output (71 tokens/metric today).
6. **source_hints quality**: bad hints → wide page windows → wasted pages and misses.
7. **Deterministic pre-extraction**: AcroForm field harvesting (`pypdf.get_fields()`)
   before any model call — those values are free and exact; skip their metrics in LLM
   batches.
8. **Starved-retry tuning** and selective re-ask of only-missed metrics (a cheap second
   pass over misses instead of bigger first passes).
9. Model alternatives / thinking budget — only after structural levers are exhausted;
   note `_estimate_cost_usd` currently omits `thoughts_tokens` (fine while 0; fix if
   you enable thinking).

## 8. Cut the catalog FIRST — the keep list is final

**`plans/cds-pipeline/METRICS-KEEP.md` is the authoritative, user-approved keep list:
394 of 1,149 metrics survive, listed exhaustively per domain. Every metric NOT in that
list gets nuked from `config/cds/domains/*.yaml`.** This is your first implementation
task, before ground truth and before the baseline — tuning and GT-building against the
doomed 1,149-metric catalog would waste most of the money.

Mechanics:
- Delete non-kept metrics from each domain YAML (mind the two formats: block `- id:`
  entries and `enrollment.yaml`'s inline `{id: ...}` form). Also prune dead references:
  `context_bindings` target lists, sections left empty, hints pointing at deleted
  metrics. Do NOT restructure domains (no folding enrollment into identity etc.) —
  METRICS-KEEP.md floats those ideas for *consumption* code; the extraction catalog
  just shrinks in place.
- **Verify**: the compiled manifest must contain exactly the 394 ids from
  METRICS-KEEP.md — set equality, not counts. A subagent diffs both directions.
- The manifest content hash will change. That is expected and accepted; do not "fix"
  the hash-mismatch machinery, and do not try to preserve the old hash.
- Read METRICS-KEEP.md fully in Phase 0 — its "Traps" and "Derive, don't extract"
  sections are domain knowledge your autopsies will need (e.g. printed retention must
  be copied never recomputed; blank `*_bachelors_percent` ≠ program doesn't exist).
- GT files are keyed by `metric_id` and the scorer's metric universe is the *current*
  manifest, so GT built after the cut covers exactly the 394 that matter.
- Baseline (Experiment 1) runs on the post-cut catalog. The pre-cut $0.289/65.6%
  numbers in §2 are historical context, not your baseline.

## 8b. Unattended operation — the user is away

You run **fully autonomously until a §9 stopping criterion is met**. The user is not
available. Rules for the duration:

- **Never block waiting for the user.** Any decision you'd normally escalate: make the
  conservative call yourself, log it in the ledger under a `DECISIONS-MADE-ALONE`
  heading with your reasoning, and continue. The user reviews that list when they're
  back.
- "Conservative" means: the reversible option, the option that spends less, the option
  that doesn't touch anything outside this worktree. When in doubt, prefer measuring
  over assuming.
- The two immutables stay immutable: if the ONLY way forward would loosen a §1 target
  or violate a §10 constraint, do not do it — treat it as a plateau, write the final
  report explaining exactly what's blocked and why, and stop cleanly. A finished
  report with an honest blocker beats a loop stalled on a question.
- **Survive restarts.** Context will compact or the session may die mid-loop. Your
  continuity is entirely in: this file (kept current per §6 step 9), the ledger, the
  committed milestones, and the persisted runs in `tuning/runs/`. After any restart:
  re-read this file, re-read the ledger's last entry, `git log` the milestone commits,
  and resume from the last incomplete step — never redo sealed GT or re-pay for
  persisted runs.
- The $25 budget cap (§9) is the hard safety rail for unattended spend. Track it in
  every ledger entry; never exceed it on your own authority.

## 9. Stopping criteria

Stop and write a final report when ANY of:
- All §1 targets met on the 5-doc aggregate, confirmed by a full re-run of the champion.
- 4 consecutive experiments produce no lexicographic improvement (declare a plateau,
  report the champion and the residual error taxonomy).
- Session experiment budget exhausted: **$25** of model spend (full 5-doc eval ≈ $1.50
  at baseline, falling as you win). Track cumulative spend in every ledger entry.

Whichever way the loop ends, the last act is the **holdout gate**: run the final
champion once on the sealed 6th document. If holdout scores land within the noise floor
of the tuning-doc aggregate, the champion generalizes — report it. If they crater, the
loop overfit: report that honestly, with the autopsy of every holdout miss, and do NOT
tune on the holdout to fix it.

Final report: champion config (exact diffs), 5-doc scorecard vs. Experiment-1 baseline,
the holdout scorecard, cost/latency/accuracy deltas, remaining error taxonomy with root
causes, and the ranked list of what to try next.

## 10. Hard constraints (non-negotiable)

- **Never** run `docker compose down`; never stop/remove `counselle-data-pipeline-db-1`
  — it is the live Postgres for `cds_library` and `counselle.*`.
- Python only via `uv run` (bare `python3 -c` is blocked by hooks).
- No secrets in tracked files. DB creds stay where they are.
- Stage files individually; never `git add .` / `git add -A`.
- Don't push, don't open PRs, don't touch branches other than `feat/cds-pipeline`
  without explicit approval.
- The scorer is an **offline test harness only** — do not wire any programmatic output
  validator into the runtime pipeline (deliberate product decision; citations are the
  runtime honesty gate).
- Respect the lazy-but-clean code philosophy: harness code is throwaway-quality-honest
  (lives under `plans/cds-pipeline/tuning/`), engine changes are production-quality.

---

# LEARNED IN THE LOOP (updated after experiments 1-18)

## The single most useful rule discovered

**Fix the evidence, not the instructions.** Score across this session:

| lever class | attempts | successes |
|---|---|---|
| telling the model something (prompt or catalog wording) | 3 | **0** |
| changing what the model receives | 4 | **4** |

Failed wording changes: "the text layer renders every checkbox empty regardless of
state, use the image"; "a metric's own `instructions` outrank every general
convention"; "OMIT the metric rather than returning false". All three produced
literally zero metric movement.

Successful evidence changes: bake form fields before slicing; withhold the PDF and
send images for all-boolean form batches; send page images for column-position grids;
send page images for H9/H10. Each moved its target family immediately.

When the engine is systematically wrong about a class of cell, reach for what it can
see. An admonition against a strong prior does not work.

## Measure before publishing — three of my own claims were wrong

1. "Caltech has no C9" — built on placeholder page-index entries. Produced D17
   (a page index is complete only when every entry has content, never assert
   completeness on the key set).
2. "`clean=True` is destroying content" — the shipped default already produced the
   same 4 text diffs. **Always measure the baseline of a comparison, not just the
   variants.**
3. "Routing won't carry accuracy" — refuted within the hour; over-wide batches were
   failing outright, and a failed call zeroes every metric in it.

## The noise floor: the engine is DETERMINISTIC

Dartmouth re-ran byte-identically (accuracy, coverage, every bucket). All run-to-run
variance comes from **transport failures**, not the model.

- Coverage is the axis that exposes a dead call. Accuracy is nearly blind to it,
  because a dead call drops metrics from numerator and denominator alike.
- **Never average runs to smooth variance. Check `run_errors` and re-run.**
- A comparison involving a run with any failed call is not a comparison.

## Cheap-and-fast is the signature of a broken run

The original baseline looked BEST on cost ($0.0607/doc) and that was because 35 of
its 115 calls never completed. The scorer's RUN ERRORS panel is the only thing that
catches this. Related, still unfixed: a total-failure run emits a fitness tuple whose
`-0.0` cost WINS the cost axis against a working config.

## Where the remaining error mass actually is

Not routing, not transport — both are solved (0 failed calls, all slices smaller
than their source). The residue is instruction-following on two catalog rules:
Caltech H14 blank-is-never-false, and the invented-selection family. The second
yielded to an image; the first has not yielded to anything permitted by §10.

## Operational notes

- GT agent fan-out: **cap at 3 concurrent image-reading agents** (D19). Eight caused
  six simultaneous stalls, twice.
- A `failed`/stalled agent notification does NOT mean the work is absent (D16), and a
  complete key set does NOT mean the work is whole (D17). Verify content on disk.
- Test on ONE document first, widen only once it holds. Five-document sweeps for a
  change a single document would falsify are ~5x waste.
