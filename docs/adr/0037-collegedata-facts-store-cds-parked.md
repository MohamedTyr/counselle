# ADR 0037 — CollegeData facts store; in-process tools; CDS system parked

**Status:** Proposed / Draft. This ADR records the school-data v3 re-architecture as it lands across
Phase 0; it is not final. Phase 5 finalizes the text against the shipped system. Two of the
decisions this ADR depends on are still **owner ratifications outstanding, not yet given**: **Q5**
(the CollegeData Terms of Use / copyright legal posture, R0 below — a hard gate on Phase 1's live
crawling, though not on Phase 0's offline work) and **Q-tier** (the paid, always-on Render web
instance the crawler needs to ever run a pass — an owner cost decision required before Phase 4).
Until both are ratified, this ADR describes the intended and technically-verified design, not a
fully authorized one.

## Context

Since ADR 0032, and more recently ADR 0036, Counselle's structured school data came from the CDS
Library: an admin-curated, model-assisted extraction pipeline reading uploaded Common Data Set PDFs
into a five-view read contract (`school_profiles`, `active_cds_documents`,
`active_cds_domain_packets`, `cds_document_sources`, `cds_manifest_snapshots`), gated by a
manifest/packet-v8 anti-corruption boundary and an evidence-marker citation system.

That system, as shipped, covers 3 schools with 4 active documents out of a 2,746-school catalog —
a cold start that grows only as fast as documents are uploaded, extracted, and human-reviewed.
Structured per-school data for "any school in the database" (ADR 0002) has never actually reached
more than a handful of schools. Meanwhile, CollegeData.com publishes structured (not HTML-scraped)
JSON for 2,587 school slugs, updated on its own cadence, covering identity, admissions, cost,
financial aid, academics, student life, and outcomes data comparable in shape to a CDS's own
sections — for free, with no document upload and no per-document human review step.

The product goal this plan answers is "every school, always current" — a goal the CDS pipeline's
extraction-per-document model cannot reach at any extraction budget the business can sustain, while
a free, daily, code-side-typed scrape of CollegeData can. This is the same tension ADR 0036's own
"Extraction accuracy is not, and is not claimed to be, complete" consequence already named: recall
was measured at 65.6% on Harvard after routing fixes, on a catalog since cut to 394 metrics, with
owner acceptance of the whole pipeline still pending. School-data v3 does not attempt to fix that
number further — it changes which source answers the "every school" requirement, and retires the
CDS PDF's role in the live product while preserving everything the pipeline built.

Full technical evidence, the measured crawl constraints, the schema design, and the reviewed
CollegeData label inventory are in `plans/school-data-v3.md` (thirteen review rounds) and its
companion `plans/school-data-v3-appendix.md`.

## Decision

1. **Structured school data becomes**: the existing identity profile
   (`cds_library.schools.basic_profile`, IPEDS HD2024, 2,746 rows, unchanged) **plus** CollegeData —
   every field, every school that maps to an IPEDS institution (~2,300–2,400 of 2,587 measured
   slugs) — re-scraped daily with change detection, stored SCD2. Distributions (GPA/SAT/ACT bands,
   selection factors, class sizes, ethnicity) are stored structured for a future chancing engine;
   **no composite score is ever synthesized** from them.
2. **No RAG, no CDS corpus, no CDS packet, no manifest at runtime.** The CDS PDF plays no role in
   the live product. Scraped facts are Counselle's own data: no source label, no source tier, no
   attribution surfaced to students — lineage from snapshot to label to fact is kept internally,
   never on the wire.
3. **The CDS management + extraction system (ADR 0036) is parked, not retired.** Its code stays
   in-tree and importable, its unit tests keep passing, nothing is mounted or started at runtime,
   its live database tables are dropped, and both its DDL and its data are preserved — see
   `PARKED.md` for the exact file list, current state, and revival steps. This is a deliberate
   amendment to ADR 0036, not a reversal of the decision to build it: the pipeline is real,
   evaluated infrastructure, kept dormant for a future where a document-grounded, higher-fidelity
   source is worth its extraction cost again (`plans/school-data-v2.md` is kept open for exactly
   this future).
4. **The agent reads facts through four in-process tools**: `resolve_school`, `get_school_profile`,
   `get_facts` (new, replacing `get_domain`), and parameterized `query_database` — closures over
   `counselle_db/service.py` on the read-only pool, with no MCP child and no stdio transport.
   Citations narrow to `db` (no tier, no evidence markers) for facts-store reads, and
   `web | edu | reddit` for external search, unchanged.
5. **Scraping is free and does not use an LLM anywhere in ingestion.** `asyncio` + `httpx` (already
   a direct dependency) + `tenacity` (already resolved transitively via pydantic-ai, promoted to a
   direct dependency — zero new resolved packages) implement the fetcher: sitemap parsing with
   stdlib `gzip`/`xml.etree`, a single token bucket at a configured crawl rate, tenacity retries on
   transport errors, a self-identifying `User-Agent` carrying a contact URL, and no browser. The
   one-off crosswalk match between CollegeData slugs and IPEDS `unitid`s is a reviewed, committed
   CSV produced by a one-time subagent-adjudicated script — not a runtime LLM step.
6. **The schema name (`cds_library`) and the writer DSN name (`COUNSELLE_DB_PIPELINE_DSN`) are kept
   unchanged**, even though the writer's actual job changes from CDS extraction to the facts crawl.
   Renaming either would touch every grant, doc, test, and `.env.example` reference for zero
   functional value; "pipeline" is redefined in prose (this ADR, `docs/DATABASE_GUIDE.md`) to mean
   the facts crawler going forward, not the retired document-extraction pipeline.
7. **The three-role, three-DSN model is unchanged.** `cds_library_reader` / `COUNSELLE_DB_RO_DSN`
   reads exactly six views (up from five) with zero base-table grants; `cds_library_app` /
   `COUNSELLE_DB_PIPELINE_DSN` writes the new facts-store base tables under the same
   `INSERT, SELECT, UPDATE`, no-`DELETE` shape it had for CDS writes (repurposed, not re-provisioned
   — mutually exclusive by design with the parked CDS worker via
   `COUNSELLE_CDS_WORKER_ENABLED=false`); `counselle_app` / `COUNSELLE_DB_APP_DSN` is unaffected in
   schema shape, though every row in it is reset once (D9 — a one-time data reset, not a schema
   change; ADR 0019's decision to use LangGraph's Postgres checkpointer in `counselle.*` is
   unaffected).
8. **Risk R0 — the CollegeData Terms of Use position — is accepted knowingly, with mitigations,
   pending final owner ratification (Q5).** See "Risk R0" below.

## Rationale

- **Coverage over fidelity, for the stated product goal.** "Any profiled school, always current"
  (ADR 0002) is a coverage claim. A free, daily, structured-JSON scrape reaches every mapped school
  in the time it takes to run a crawl pass; a human-reviewed extraction pipeline reaches the schools
  someone uploaded a document for. The pipeline's fidelity (page-cited evidence, a validated
  manifest contract) is real value, but it is not the axis this decision optimizes — coverage is.
- **Removing the MCP transport removes real operational surface for zero remaining benefit.** ADR
  0004 chose MCP as the DB transport when the intent was a reusable server other consumers might
  attach to; in practice the only consumer has always been this app's own agent loop. Once every DB
  call is in-process anyway (the four tools call `counselle_db/service.py` directly), the stdio
  child process, its supervisor, restart backoff, and health-check plumbing are a whole subsystem
  serving a single in-process caller — exactly the shallow-wrapper pattern ADR 0017 already argues
  against keeping.
- **`httpx` + `tenacity` over Crawlee, on measured evidence, not preference.** Crawlee 1.10.0's
  default `SitemapRequestLoader` drops every CollegeData school URL (the sitemap is served on
  `www.`, every `<loc>` inside it points at `stg.`, and Crawlee's URL filter runs before the rewrite
  hook that would fix this — verified against the live sitemap). Separately, `BasicCrawler.run()`
  was verified to remove the event loop's SIGINT handler and never restore it, which breaks
  uvicorn's graceful shutdown after the crawler's first pass — a correctness bug, not a style
  preference. Crawlee's default HTTP client also impersonates a browser and rotates sessions to
  evade blocking, which is the wrong posture next to R0's "no evasion" mitigation, and its `httpx`
  extra currently resolves to an unrelated package. `httpx` is already a direct dependency; adding
  `tenacity` as a direct dependency (already resolved transitively) costs zero new resolved
  packages for retry/backoff behavior Crawlee would otherwise provide. Scrapy (a second process,
  Twisted-based), Firecrawl/Apify (paid), Playwright (unneeded — the data is server-rendered JSON,
  not client-rendered HTML), and evasion-postured libraries (`curl_cffi`, `rnet`, `scrapling`,
  `botasaurus`) were all rejected for the same reason: CollegeData serves the data to a bare `curl`
  request, so nothing beyond a well-behaved, rate-limited, honestly-identified HTTP client is
  needed, and reaching for evasion tooling would be reaching for a tool built to defeat exactly the
  posture R0 commits to not taking.
- **Keeping the schema/DSN names is the smallest-diff choice, not an oversight.** `cds_library` and
  `COUNSELLE_DB_PIPELINE_DSN` appear in grants, tests, docs, `.env.example`, and the seed file.
  Renaming either changes nothing about behavior or safety; it only costs a mechanical sweep with a
  real chance of missing a reference. The house rule ("one source of truth, no magic values" and
  "change existing code by extension, smallest diff") argues directly against a rename with zero
  functional payoff.

## Alternatives considered

- **Keep the CDS pipeline as the sole structured-data source and scale up extraction volume.**
  Rejected: the pipeline is cost- and latency-bound per document and requires a human review step
  before a document counts as active; no realistic extraction budget reaches 2,300+ schools at the
  cadence "always current" requires. Coverage would remain a slow-growing subset indefinitely.
- **Run both systems concurrently — CDS for uploaded documents, CollegeData for everything else.**
  Rejected for this phase: maintaining two structured-data honesty models (packet/evidence vs.
  per-field `observed_at`) at once roughly doubles the surface every reading-rule and citation
  change has to reason about, for a benefit (CDS-only fields) no current product requirement names.
  Parking rather than deleting the pipeline keeps this option genuinely open later, at the cost of
  building it now.
- **Rename the schema and DSNs to reflect the new writer's actual job.** Rejected: see "Rationale"
  above — no functional benefit, real mechanical risk, against the house's smallest-diff rule.
- **Keep the MCP child as the DB transport and simply repoint its tools at the new schema.**
  Rejected: once the field service moves in-process (which the tool rewrite requires regardless, to
  mint citations per-tool instead of through the MCP `process_tool_call` hook this decision retires
  with the transport), there is no remaining consumer of the MCP boundary to justify keeping it —
  the transport would exist for a caller that no longer benefits from it being a transport.
- **Delete the CDS system outright instead of parking it.** Rejected on D8's own terms: the metric
  catalog, the manifest/packet-v8 contract, the admin review UI, and four re-extracted documents
  represent real, evaluated work with no cheaper way to reproduce it later. Parking costs
  bookkeeping (this ADR, `PARKED.md`, keeping tests green); deletion would cost redoing the work
  from zero if a document-grounded source is ever needed again.

## Risk R0 — CollegeData Terms of Use

CollegeData's Terms of Use (browsewrap; 1st Financial Bank USA; South Dakota venue) state that users
are prohibited from "modifying, copying, distributing, transmitting, displaying, publishing,
selling, licensing, creating derivative works, or using any content on the Site for commercial or
public purposes," and reserve "all remedies available at law and in equity ... including the right
to block access from a particular Internet address." `robots.txt` does not disallow the routes this
crawl uses. This is a **contractual** risk, not a robots-based or technical one, and it is not
eliminated by any mitigation available to this design.

**Accepted mitigations, in scope:**

- `robots.txt` is respected exactly as published; the fetcher never touches the disallowed `/api/*`
  routes or HubSpot paths.
- The `User-Agent` truthfully self-identifies (`CounselleBot/1.0 (+https://<domain>/bot)`,
  boot-validated to contain a URL) — no impersonation of a browser or another crawler.
- The crawl rate is capped at 1 request/second with adaptive backoff (Q9) — not the more aggressive
  rate an earlier draft of this plan considered.
- No evasion of any kind: no session rotation, no header spoofing, no CAPTCHA bypass, no proxy
  rotation.
- No bulk-export endpoint is built — the data is served to Counselle's own product surfaces
  (per-school facts pages, the Explore filter, agent tool calls), never as a downloadable dataset.
- Raw CollegeData snapshots (`page_snapshots.body`) are retained **only for internal lineage** — to
  answer "why did this fact change" — and are never served to a student, never exposed through any
  API, and never rendered verbatim on any page.

**What is not mitigated:** the Terms' prohibition on "using any content on the Site for commercial
or public purposes" is not narrowed by any of the above — Counselle is a commercial product
republishing CollegeData-sourced facts (as Counselle's own data, per D3, with no attribution) to
paying and prospective users. This is a knowing, owner-accepted risk, not a resolved one. **Q5,
which ratifies this acceptance, is an outstanding owner decision** — Phase 1's live crawl work does
not begin until it is confirmed; the offline mapper and fixture-based tests may proceed without it,
since they touch no live traffic.

## Relationship to earlier decisions

- **Supersedes ADR 0032** (five reader views, four LLM-facing tools, the dynamic manifest, the
  packet-v8 anti-corruption boundary, evidence markers) for the read path in full. ADR 0032's
  properties that survive into this decision are named explicitly, not left implicit: the
  reader-role/view boundary pattern (now six views, not five), code-owned availability and caveat
  rules (now keyed on per-field `observed_at` rather than packet/edition state), and the viz
  provenance boundary (a tool result mints its own citation; the model never manufactures one).
- **Supersedes ADR 0004** (DB access as an MCP server) in full — see "Rationale" above. ADR 0004's
  own alternative-considered note, that the service layer could be the real API with MCP only for
  the LLM's tool loop, is what this decision adopts once even that last MCP-only caller goes
  in-process.
- **Narrows ADR 0015** (external search via Tavily). Its "we never fetch or scrape pages ourselves"
  clause no longer holds — this ADR's own crawler fetches and scrapes CollegeData directly. The
  search half of ADR 0015 (Tavily for web/.edu/Reddit, GPT-Researcher underneath) is unchanged.
- **Amends ADR 0002, 0005, 0006, 0012, 0014, 0017, 0018** with a facts-store-generation "old-data"
  note each, following the pattern each already carries from its ADR-0032-era amendment: the
  mechanism nouns change (manifest → facts-store fields, `get_domain` → `get_facts`, five views →
  six), the underlying principle each ADR states does not.
- **Amends ADR 0036 as parked, not retired** — following the exact precedent of ADR 0036's own
  2026-08-27 amendment (the metric-catalog cut), this decision is recorded as a dated amendment to
  ADR 0036 itself, not a supersession, because ADR 0036's central claim (`domain/cds`, `app/cds`,
  `adapters/cds_*` follow ADR 0017's four-layer discipline, and the write path is role-isolated from
  the agent's own connections) remains true of the parked code; only its runtime mounting changes.
  `parse_packet_row()`'s invariant survives specifically because `counselle_db/packets.py` stays
  importable — this is load-bearing for the parked write path's own internal consistency, not
  decorative.
- **ADR 0019 (platform-ready sessions) is unaffected in decision** — D9's one-time reset of
  `counselle.*` is a data event, not a reversal of the choice to use LangGraph's Postgres
  checkpointer there.
- **ADR 0023 (one deployable) is unaffected** — the facts crawler's worker runs in-process from the
  same FastAPI lifespan the CDS poller used, per the same one-deployable constraint.
- **ADR 0027 (workspace service + change events) is untouched**, and this decision's facts-store
  writes deliberately publish no `ChangeEvent`s — the facts crawl is not a workspace mutation and
  has no per-user actor.

## Consequences

- Counselle's structured school-data surface changes shape: from "a curated, evidence-cited,
  document-grounded packet for a handful of schools" to "a broad, code-typed, per-field scrape for
  every mapped school, carrying no source label and no evidence markers." Any future reasoning about
  "does Counselle have data on school X" now asks a coverage question (`school_data_status`,
  per-field presence) rather than an edition question (which document, which manifest version).
- The MCP child process, its supervisor, and the stdio transport are deleted (Phase 3), not parked —
  they are dead code once every DB call is in-process, per ADR 0017's no-shallow-wrapper rule. This
  is a `DEAD`, not `PARKED`, disposition (see `plans/school-data-v3.md` §10).
- The CDS pipeline's parked code is a maintenance liability of a specific, bounded kind: its own
  unit tests must keep passing as the rest of the codebase evolves around it, and any refactor that
  would break a parked import edge (`PARKED.md` lists the nine that matter) must either preserve the
  edge or update `PARKED.md` and the parked side together. It is not free to ignore.
- `cds_library`'s schema keeps its name and continues to host two logically separate roles over
  time — the parked write path (dormant) and the facts-store write path (live) — sharing one DSN
  name whose comment now needs to say plainly which system "pipeline" refers to
  (`docs/DATABASE_GUIDE.md` §1, updated in this same re-architecture).
- Accepting R0 without full mitigation is a real, ongoing legal exposure the business carries
  knowingly rather than one this ADR resolves. If CollegeData ever objects formally, the mitigations
  above are the evidence of good-faith, non-evasive operation — they do not immunize against a
  contractual claim.
- Reviving the CDS system later (`PARKED.md`'s revival steps) is a bounded, listed procedure, not a
  rebuild — this is the entire point of parking instead of deleting, and its cost is paid continuously
  (keeping the parked tests green) rather than once at revival time.

## Amendment log

- This ADR is filed as **Proposed / Draft** at Phase 0. Phase 5 replaces this status line with
  **Accepted** once Q5 and Q-tier are ratified and the full re-architecture (Phases 1-4) has shipped
  against this decision, or amends this ADR if either ratification changes the design materially
  (e.g., Q5 is declined, which would require re-opening the crawl-vs-no-crawl question entirely).
