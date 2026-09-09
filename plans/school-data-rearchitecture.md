# School data re-architecture: watched web sources + CDS RAG + a compressed catalog

> **2026-09-05 update:** the design has moved to `plans/school-data-v2.md` (owner decisions of the second round: CollegeData facts are Counselle-internal data with no source label or tier; the CDS PDF is RAG-only with document-level citations; the extraction engine is parked, not lazy; the DB is nuked and rebuilt except `schools`). Keep reading this file only for the source research (§2), the measured constraints, and the decision log (§13, §13a).

**Status:** proposal (not a plan yet). Written 2026-09-04 after a full read of the
current data path. Nothing here is decided; the "Decisions for the owner" section at
the end lists what needs a call before this becomes `plans/<branch>.md`.

---

## 0. What exists today, in one screen

| Layer | What it is | Who consumes it |
|---|---|---|
| `cds_library.schools` (2,746 rows, IPEDS unitid, `basic_profile` with OPEID etc.) | Identity catalog | `resolve_school`, workspace school search, everything |
| `cds_documents` / `cds_school_years` | Immutable CDS PDFs, one active edition per school-year | Extraction engine; `cds_document_sources` view |
| `cds_manifests` (`5.1.0`, 394 metrics / 13 domains) + `cds_domain_packets` | The extracted, human-approved metric packets (packet v8) | `get_domain`, `render_viz`, the data picture, `query_database` |
| `app/cds/` + `adapters/cds_*` + `frontend/features/cds-admin` | Upload → detect → route pages → schema-constrained Gemini → validators → needs_review → approve → active | Superusers only |
| `counselle_db/` (4 MCP tools) | `resolve_school`, `get_school_profile`, `get_domain`, `query_database` | The agent |
| `adapters/tavily_tools.py` | `search_web`, `search_school_site`, `search_reddit` (Tavily search only, never fetch) | The agent |
| `frontend/features/schools/{facts,explore}` (~6k lines) | The About tab and Explore tab | **Fixtures only — no backend route serves them** |

Three facts that reframe the request:

1. **Extraction cost is not the bottleneck.** The shipped configuration is $0.21/doc
   (`config/settings.py` rationale comment, `specs/cds-pipeline/tuning/FINAL-REPORT.md`).
   Doing every school once is ~$600/yr. What actually stalled the pipeline is the
   *workflow*: a human must upload each PDF and approve each document, so after months
   of work the corpus is 4 documents from 3 schools out of 2,746. Coverage, not cost,
   is the problem — and a fixed 394-metric schema means anything else in the CDS is
   invisible to the agent.
2. **The `/schools` facts and explore tabs have no consumer to migrate.** They read
   TypeScript fixtures (`SchoolDetailRoute.tsx:128`, `explore-fixtures.ts:4-12`). The
   only CDS data that reaches a student outside chat is school identity plus one
   admissions metric on the application detail. Whatever store we build is the
   *first* real backend for that UI, and its wire type (`school-facts-types.ts`) was
   designed to be the query result.
3. **The citation machinery is already source-agnostic.** `Citation` accepts
   `source="web"|"edu"` with `url` + `vintage` + the four `source_period*` fields
   (`domain/envelope.py:40-117`); `annotate_search_results` (`app/sources.py:193`)
   registers anything shaped `{results:[{title,url,snippet,citation}]}`; `render_viz`
   already accepts web/edu markers as cells (`app/viz.py:363-372`). Scraped values do
   not need a new citation grammar — they need two small extensions (§6).

The one thing the codebase *forbids* is scraping: ADR 0015 ("Nothing is scraped by
us") is restated in `docs/ARCHITECTURE.md:407` and `AGENTS.md`. This proposal
supersedes that clause with a new ADR (§9).

---

## 1. The target shape: three tiers of school data, one key

```
                     ┌──────────────────────────────────────────────┐
                     │  Tier 1  IDENTITY   cds_library.schools      │  keep as-is
                     │          (IPEDS unitid = the one key)        │
                     └──────────────────────────────────────────────┘
      ┌───────────────────────────────┐   ┌──────────────────────────────────────┐
      │ Tier 2  FACTS STORE (new)     │   │ Tier 3  CORPUS + RAG (new)           │
      │ school_facts: narrow, typed,  │   │ corpus_chunks over: CDS PDFs (kept), │
      │ multi-source, versioned,      │   │ school admissions pages, aggregator  │
      │ every row → immutable         │   │ page snapshots. Hybrid dense+BM25,   │
      │ snapshot/document + evidence  │   │ section-aware chunks, page evidence  │
      │                               │   │                                      │
      │ fed by: Scorecard/IPEDS API,  │   │ fed by: the same snapshots + PDFs    │
      │ watched pages, lazy CDS       │   │                                      │
      │ extraction                    │   │                                      │
      └───────────────────────────────┘   └──────────────────────────────────────┘
                 ▲   answers "what is X"            ▲   answers "what does the CDS say
                 │   fast, typed, cited             │   about Y" — anything, not just
                 │                                  │   the 394 keys
     ┌───────────┴──────────────────────────────────┴───────────┐
     │  AGENT: resolve_school · get_school_profile · get_facts   │
     │         search_documents · query_database                 │
     │  + always-on "data map" (~500 tokens) + on-demand catalog │
     └───────────────────────────────────────────────────────────┘
```

**Tier 2 is what the `/schools` page and `render_viz` read. Tier 3 is what the agent
reads when Tier 2 has no key for the question.** The two are linked: a Tier 3 hit can
be *promoted* into a Tier 2 fact by the existing extraction engine, on demand (§4).

---

## 2. Where the data comes from — settled 2026-09-05

**Owner decisions, in order:** aggregator sites do the work (don't re-ingest raw
government datasets) → fully free, no paid scraping services → narrowed three times →
**final: scrape CollegeData only.** Niche was inventoried and dropped (see §2.3).
Current-cycle requirements/deadlines are explicitly out of scope. The TOS risk of
scraping an aggregator is knowingly accepted; mitigations are low cadence, only pages we
cite, immutable snapshots, and honest labelling (§6).

### 2.1 The source set

1. **CollegeData** `collegedata.com/college-search/<Slug>/{admission,money-matters,academics,campus-life,students}`
   — the CDS re-typed as a typed JSON tree (`<script id="__NEXT_DATA__">` →
   `props.pageProps.profile.bodyContent`). ~150 facts per school: admissions funnel by
   gender, ED/EA, waitlist, all 18 selection factors, SAT/ACT ranges **and full score
   distributions**, GPA distribution, class rank, sticker cost lines, the full need-based
   aid profile (freshman + all undergrads), merit aid, debt, faculty counts, 7-bucket
   class size, majors, special programs, curriculum requirements, headcounts, 8-category
   ethnicity, retention, 4/5/6-year graduation, housing, security, sports with
   scholarship flags. Site-wide vintage "2024-25 academic year", refreshed a few months
   after schools post the new CDS. Full field list: `plans/school-data-field-catalog.md`.
   Access: fetch the homepage first (WAF cookie), then school pages; no bot wall;
   the Overview tab is a strict subset of the five topic tabs and is never fetched.
2. **The school's own CDS PDF** — the freshest and only complete source (posted Oct–Jan;
   CollegeData lags months, IPEDS 1–2 years). Watched via the 5,946 known CDS URLs
   (`cds_library.ct_index_entries`, dead rows today) + `basic_profile.official_links`;
   a new edition is fetched into `cds_documents`, parsed **deterministically by printed
   row label** (the form is standardized) for the cells CollegeData lacks — C1 residency
   splits, C9 score bands, H2/H6 aid detail, SAT/ACT **submit percentages** (honesty-
   critical for reading any test band; CollegeData does not carry them) — and chunked
   into the RAG corpus (§5). Form-based PDFs whose text layer lies fall back to the
   existing engine (~$0.20) or stay on CollegeData's numbers.
3. **College Navigator** `nces.ed.gov/collegenavigator/?id=<unitid>` — backfill only, for
   the ~700 schools CollegeData does not list; unitid-keyed, no crosswalk, vintage always
   shown (1–2 years behind).

Precedence per fact key: CDS PDF with page evidence > CollegeData > College Navigator.
The school's own admissions site is **not** scraped; it stays the live verification
fallback through the existing Tavily `search_school_site`.

### 2.2 Chancing sources (phase 3; school-level priors come from 1 and 2)

- **School class-profile pages** ("Class of 20XX Profile") — freshest priors, Mar–Sep:
  admit rate by round, middle 50, first-gen/legacy share, geography, admit rate **by
  college/major** where published. One page per school, annual; pages vary, so
  extraction on change is a schema-constrained model call (~$0.001/page) not a parser.
- **College Kickstart** (`collegekickstart.com` ED/EA results posts) — ED/EA/RD rates per
  school per cycle, a few list pages each winter.
- **College Confidential decision threads** (Discourse → free `.json` per thread) —
  applicant-level outcomes in a post template; stored in `applicant_outcomes`, never a
  school fact, calibrated against CDS aggregates. r/collegeresults is parked (owner
  decision) — same data, higher volume, add later if needed.

### 2.3 Dropped, with the reason (so nobody re-litigates)

| Source | Why dropped |
|---|---|
| **Niche** | Fully inventoried (`artifacts/school-data/niche-fields.md`: ~250 labels, all in `window.__PRELOADED_STATE__` JSON). Measured 2026-09-04: `curl_cffi` chrome impersonation passes PerimeterX, but **11 pages in ~35 s → per-IP 403 on every fingerprint for >2.5 h and counting**. From one free IP that is a trickle, not a pass. Owner decision 2026-09-05: drop. If revisited: main page alone yields ~100 facts (15 grades, rankings, review aggregates, Q&A, headline IPEDS figures); Firecrawl is the paid fallback. |
| College Scorecard / IPEDS raw | Redundant with CollegeData + Navigator for the store; IPEDS lags 1–2 years. Scorecard's earnings-by-major is a cheap unitid-keyed add later. |
| BigFuture, Common App Explore | Deadlines/requirements — out of scope by owner decision. |
| US News, Princeton Review, Peterson's, College Essay Guy, CollegeVine, Wikidata | Redundant or deferred (essay prompts → when the Essays feature needs them). |
| CollegeSimply / PrepScholar "chances", Naviance/Scoir, CollegeVine calculator | Derived guesses or login-only. |

### 2.4 Mechanics — fully free

- **Fetch:** `httpx` (installed) + a warm session; polite 2–3 s spacing. No Playwright,
  no paid crawler. `selectolax` only as a DOM fallback for pages captured without the
  JSON shell.
- **Extract:** one parser module for CollegeData that walks the `__NEXT_DATA__` typed
  tree (`ExpandableSection` → `CategoryDivider` / `TitleValue` / `TitleLink` /
  `LabeledTable` / `IconTable` / `NestedTitleValue` / `BarGraph` / `SubscreenNavigator`)
  and emits fact rows validated against the key schema. No LLM per page. Known gotchas
  are listed in the catalog §0 (bucket sets vary and use a `-1` sentinel; public schools
  return `[in-state, out-of-state]` lists; a subsection label is reused for different
  row groups; "Merit-Based Gift" packs two facts; three distinct absence states).
- **Watch:** conditional GET (ETag/Last-Modified), then a hash of the parsed facts JSON —
  a change is a changed fact. Scheduled by the existing Postgres-leased poller
  (`app/cds/jobs.py` pattern) with `next_check_at` per page.
- **Snapshots:** compressed HTML in Postgres with a sha (~100 KB/page); every fact row
  points at its snapshot + excerpt.
- **Breakage detection:** parser validates the expected key set; a daily smoke test
  fetches three known schools; a missing-key alert surfaces in the admin surface.
- **Crosswalk:** CollegeData slug = the school name in Title-Case-With-Dashes
  (`Yale-University`, `University-of-Georgia`); resolve once via the site's own search
  list page (all ~2,000 schools link from `/college-search`), store on
  `school_source_pages`, manual-override column.
- **Cost:** $0 in services. Full pass ≈ 2,000 schools × 5 tabs = ~10k pages, a few hours
  at polite spacing, once a year after the fall refresh + quarterly change checks;
  long tail fetched on first add-to-list.
- **Embeddings:** `fastembed` + `bge-small-en-v1.5` on CPU (free) or gemini-embedding-001
  ($10–60 one-time).

## 3. Change-watching: how "always up to date" actually works

Principles:
- **Watch the extracted facts, not the HTML.** Diffing raw pages produces constant
  false positives (dates in footers, nav, ads). Fetch → extract structured facts →
  hash the facts JSON → a change is a change in a fact.
- **Cadence follows the data's real change rate**, not "always": Scorecard/IPEDS
  annual; school admissions pages weekly in season (Aug–Jan), monthly otherwise;
  aggregators monthly; CDS PDF pages monthly (new edition lands Oct–Dec).
- **Every fetch is an immutable snapshot with a sha**, exactly the PDF philosophy —
  a citation points at what we saw, not at a URL that may have changed.

Tooling (never reinvent):
- **No paid crawler** (owner decision): `httpx` against CollegeData's JSON shell — see
  §2.4. Firecrawl's `changeTracking`/`/monitor` was the managed alternative and is
  recorded only as the paid fallback if a bot-walled source is ever added.
- **Tavily** (already installed) stays for live search only, unchanged.
- **Scheduler:** there is none today. Extend the existing pattern — a Postgres-backed
  job table + the in-process leased poller (`app/cds/jobs.py`) — with a `refresh_jobs`
  table and a cadence column. Stays one deployable (ADR 0023). A Render cron is the
  fallback if in-process scheduling proves flaky.
- **Fact extraction from a page:** the deterministic CollegeData parser (§2.4);
  every fact carries a verbatim excerpt (the `Finding` shape in
  `domain/cds/claims.py` already requires it). The schema-constrained Gemini call in
  `adapters/cds_gemini.py` is the optional parse-failure fallback, off by default.

Cost: $0 in services. The price is parser maintenance (code, not config). Embeddings are $0 with `fastembed` or
$10–60 one-time with gemini-embedding-001 (§5).

---

## 4. What to do with the CDS management system: freeze the workflow, keep the engine, make it lazy

The subsystem splits cleanly (verified file by file):

**Generic document-ingestion platform — keep and reuse verbatim**
- `adapters/cds_pdf.py` (PyMuPDF page text/render/narrow, AcroForm detection,
  corrupt-text-layer heuristic) — zero CDS knowledge; the corrupt-layer detector is
  hard-won and directly protects the RAG parse (§5).
- `app/cds/jobs.py` leased poller + `cds_store.claim/renew/sweep` — becomes the
  scheduler for refresh jobs too.
- Upload staging + sha256 dedupe + per-file error isolation (`service_ingest.py`).
- `adapters/cds_gemini.py` schema-constrained call — becomes the page-fact extractor.
- Audit log, superuser gating, the reader-round-trip write gate pattern.
- The review UI pattern (PDF page left, flagged claims right, keyboard flag queue) —
  re-pointed at *flagged facts* instead of *pending documents*.

**CDS-specific asset — keep, but change its job**
- `config/cds/domains/*.yaml` (394 metrics with descriptions, `source_hints`,
  instructions) is not dumped. It becomes three things:
  1. **The routing index for retrieval.** Each metric's description + `source_hints`
     (`[C1]`, `[H2]`…) maps a natural-language question to a CDS section. Embed the
     394 descriptions once; a query like "how many applied early decision" matches
     `admissions.early_decision_*` → section C21 → retrieve that chunk. This is
     query-expansion for free, and it is what makes CDS RAG precise on tables.
  2. **The on-demand extraction schema.** When a typed, cacheable number is wanted
     (facts page, `render_viz`, a comparison), the engine runs for *that metric's
     batch* against *that school's PDF* and writes a `school_facts` row with
     `source='cds'` and page evidence. No human approve gate; validator flags become
     caveats and land in an admin QA queue. Cost is paid per question asked, not per
     document, and the store fills in where students actually look.
  3. **The compressed "what can I ask" catalog** for the agent (§7).

**Freeze, don't delete**
- `cds_manifests`, `cds_extractions`, `cds_domain_packets` and the two packet views
  stay as read-only history. The 4 shipped documents' active packets are migrated
  mechanically into `school_facts` rows (source `cds`, evidence preserved, vintage =
  `CDS 2024-25` etc.) so nothing verified is lost. `scripts/cds_manifest_check.py`
  keeps guarding the published hash as long as the manifest is still the routing
  index.
- The eager "upload a batch → extract all 13 domains → approve" workflow is retired
  from the UI. The upload screen stays (it's how a CDS PDF enters the corpus); the
  coverage grid becomes "which schools have a CDS in the corpus / facts freshness".

Triggers for lazy extraction (cheap, targeted): a student adds a school to their
list (`workspace_changes` event already exists) → enqueue the "core" fact set for that
school if missing; a `search_documents` hit is used in an answer → enqueue promotion
of that metric; the facts page renders a school with gaps → enqueue.

---

## 5. The RAG layer — the 2026 recipe, no reinvention

The corpus is small per school (a CDS is 20–40 pages ≈ 30–40k tokens) and *table
heavy*. That drives every choice below.

| Step | Choice | Why / first rung that works |
|---|---|---|
| Parse PDF → markdown | `pymupdf4llm` (PyMuPDF is already a dep; tables → markdown) | Docling is more accurate on complex layouts but pulls torch into the slim image. Start with pymupdf4llm; move to Docling only if table fidelity measurably fails on the eval (below). |
| The AcroForm trap | Gate on `detect_corrupt_text_layer` + `has_form_fields` (`adapters/cds_pdf.py`) → for those docs render pages to PNG and have Gemini emit markdown | The tuning report's sharpest finding: the text layer of a form-based CDS *asserts the opposite* of what is visible (UGA: 32 empty ballot boxes, 15 visibly ticked). A RAG over that text lies confidently. This guard already exists; reuse it. |
| Chunking | **One chunk per CDS section item** (A1, B1, C1…H14, J1), whole table kept intact; regex on the section codes (`app/cds/routing.py` already has this regex) | Tables split mid-row are useless. Section-level chunks make every hit a complete table with its header. ~40–60 chunks per document. |
| Contextual prefix | Prepend "Yale University · CDS 2024-25 · Section C1: First-time, first-year applicants (table)" to each chunk before embedding | Anthropic's contextual-retrieval result (big drop in retrieval failures); costs nothing here because we *know* the context from structure. |
| Dense | `gemini-embedding-001`, `output_dimensionality=768`, L2-normalized, via `google-genai` (already installed); pgvector HNSW cosine | pgvector is **already installed on staging** (`scripts/seed_reader_db.py:34`) and `migrations/0003_field_index.sql` is a reviewed template incl. the `public.vector` search_path trap. ADR 0008's normalization lesson applies verbatim. |
| Sparse | Postgres `tsvector` + `ts_rank_cd` (BM25-ish) | Same database, no new service. Section codes and metric words ("Early Decision", "H2") are exact-match heavy — sparse matters a lot here. |
| Fusion | Reciprocal rank fusion in SQL, top-20 | Standard; one CTE. |
| Rerank | **Skip initially.** Add a cross-encoder/LLM rerank only for cross-school queries if eval shows need | Within one school the candidate set is ~50 chunks; fusion alone is enough. Don't buy precision we can't measure. |
| Single-school deep read | Because a CDS fits in context, `search_documents` can return the *whole section* (it is the chunk) and, for deep dives, a `read_document_section(document_id, section)` path loads full text; Gemini context caching makes repeat reads of one school cheap | Chunked RAG is for finding; the model still reads whole tables. |
| Freshness | `corpus_chunks.content_hash` + `embed_model` → the ADR 0008 reconcile pattern (delta re-embed on change or model swap) | Already designed once in this repo. |
| Eval | `specs/cds-pipeline/tuning/gt/` has hand-built ground truth (5 schools × metrics × **page numbers**) — a free retrieval@k golden set | Measure hit@1/hit@3 by page before touching parse/chunk choices. |

Extend the same table to page snapshots (`source_kind='page'`): a school's admissions
page chunks sit beside its CDS chunks, so one `search_documents(unitid, query)` covers
"what does this school say about X" across everything we hold.

Deep research (ADR 0009, deferred) gets a first-class retriever for free later: the
corpus is exactly the "DB must be a first-class source" that ADR wanted.

---

## 6. Honesty rules that must change (the carve-out still applies)

The data is the product; multi-source data needs three additions to the honesty spec:

1. **A third tier.** `Tier` is `official | community` today. Aggregator facts are
   neither: add `third_party` with a code-owned caveat ("as reported by CollegeData,
   retrieved …; not a school-reported figure"). Scorecard/IPEDS are `official`
   (federal, school-reported). School-site pages are `official` (already `edu`).
2. **Source precedence and disagreement, per fact key.** For a given key the code
   picks the leading value by rule (CDS with evidence > Scorecard/IPEDS > school site
   > aggregator), always carrying each source's own vintage, and emits a
   `source_disagreement` caveat when values differ beyond a tolerance — never
   silently picking one. This is the multi-source analogue of "never merge editions".
3. **Evidence for non-CDS facts.** `EvidenceItem` is CDS-only today (`app/sources.py:81`,
   `domain/envelope.py:159`). Page facts carry `{snapshot_sha, url, excerpt,
   fetched_at}`; extend the guard so the sources rail can show "says who" for a
   scraped number the same way it does for a PDF page.

New caveat kinds: `third_party_source`, `source_disagreement`, `fact_stale`
(cycle-perishable key older than its cadence window), `snapshot_unavailable`. Existing
kinds (`stale_edition`, `partial_packet`, `not_in_template_version`…) stay for `cds`
facts. The existing rule "never convert unavailable to zero" is unchanged and applies
to every source.

Vintage stays per-value: a Scorecard admission rate is "IPEDS 2023-24 (Scorecard
release 2025-10)"; a BigFuture deadline is "retrieved 2026-09-04 (BigFuture)". The
`source_period*` machinery in `tavily_tools.py` is reused to date page facts.

---

## 7. Fighting "the model doesn't know what it doesn't know"

Today the ambient data picture is ~220 tokens and lists 13 domain ids with counts.
Measured: the raw skeleton of all 394 metric ids is ~3.2k tokens; full descriptions
~10.7k. Proposal — a two-tier catalog, both code-generated from config, never
hand-written into a prompt:

**Always-on "data map" (~500–700 tokens, static, cache-friendly):**
```
## What Counselle holds (live, as of 2026-09-04)
- 2,746 schools (identity). Facts store: 2,741 with federal data (IPEDS 2023-24),
  312 with current-cycle page facts (deadlines/test policy), 4 with CDS-verified facts.
- Fact keys (get_facts): admit_rate, admit_rate_ed, sat_25_75, act_25_75, applicants,
  admitted, enrolled, yield, sticker_cost, net_price_by_income, need_met_pct, …  (≈80)
- CDS corpus (search_documents): 4 documents. A CDS has 10 sections:
  A general · B enrollment/retention/graduation · C first-year admission (applicants,
  admit, test scores, GPA, ED/EA, waitlist, factors) · D transfer · E academic
  offerings · F student life (activities, ROTC, Greek, housing) · G expenses ·
  H financial aid (need met, awards, loans, merit, international) · I faculty & class
  size · J degrees conferred by field.
  Anything a CDS answers that isn't a fact key → search_documents. Full metric list:
  load_skill("cds-catalog").
- No first-party data for a school/question → profile + web search, disclosed.
```
The CDS section map is universal (the template is standardized), so it is the
cheapest possible way to tell the model *the shape of what it can search for*.

**On-demand catalog:** `load_skill("cds-catalog")` (progressive disclosure already
exists) renders the 394 metric ids grouped by family with one-line descriptions,
generated from `config/cds/domains/*.yaml` at startup. ~3k tokens when abbreviated
(`selection_factor_{rigor,gpa,…}` collapses 11 ids into one line). Loaded only when
the model is about to do a detailed CDS read or a `render_viz`.

**Retrieval-side safety net:** because the 394 descriptions are embedded as the
routing index (§4.1), even when the model asks in its own words, `search_documents`
resolves the query to the right section — the model doesn't have to know the key.

---

## 8. Schema proposal (`cds_library`, written by `cds_library_app`, read via views)

Keep the schema name and the three-role/three-DSN isolation exactly as is (it is the
strongest safety property in the repo). Additive first; freeze later.

```sql
-- Sources and the watch list ---------------------------------------------------
sources            (id, kind CHECK IN ('scorecard','ipeds','school_site','cds_pdf',
                    'bigfuture','niche','usnews','other'), tier, base_url, tos_note,
                    default_cadence interval)
school_source_pages(id, school_id → schools, source_id → sources, url, page_kind
                    ('admissions','deadlines','test_policy','cds_index','aggregator_profile'…),
                    discovered_via, cadence interval, next_check_at, last_checked_at,
                    last_changed_at, etag, last_status, disabled_at)
page_snapshots     (id, page_id → school_source_pages, fetched_at, http_status,
                    content_sha256 bytea(32), markdown text, raw bytea NULL,
                    facts_sha256 bytea NULL)             -- immutable (BEFORE UPDATE trigger)

-- The facts store (SCD2) --------------------------------------------------------
school_facts       (id, school_id, fact_key text, source_id, value jsonb, display text,
                    unit text, vintage text, as_of date NULL,
                    snapshot_id NULL → page_snapshots, document_id NULL → cds_documents,
                    evidence jsonb  -- {page|url, excerpt, locator}, never null for reported
                    availability text ('reported','not_reported','not_applicable',…),
                    flags jsonb DEFAULT '[]', extractor_version text,
                    observed_at, valid_from, valid_to NULL)
  UNIQUE (school_id, fact_key, source_id) WHERE valid_to IS NULL
  -- fact-key vocabulary + per-source mappings live in config/facts/keys.yaml,
  -- compiled + hashed + published like the manifest (reuse manifest_compile pattern)

-- The corpus ---------------------------------------------------------------------
corpus_chunks      (id, school_id, source_kind ('cds_pdf','page'),
                    document_id NULL, snapshot_id NULL, academic_year NULL,
                    section_code text, page_number int NULL, chunk_index int,
                    context_prefix text, text text, content_hash bytea(32),
                    embedding public.vector(768), embed_model text,
                    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED)
  HNSW (embedding vector_cosine_ops); GIN (tsv); (school_id, source_kind, section_code)

-- Refresh queue (same lease pattern as cds_extractions) ---------------------------
refresh_jobs       (id, kind ('fetch_page','import_scorecard','parse_document',
                    'embed','extract_facts'), target jsonb, status, queued_at,
                    started_at, finished_at, lease_expires_at, error_code, attempts)
```

Reader views for `cds_library_reader` (replace the two packet views in the grant once
§10 phase 4 lands): `school_profiles` (unchanged), `current_school_facts`
(`valid_to IS NULL`, joined to source kind/tier and snapshot sha), `corpus_chunks_ro`
(no embedding column exposed to `query_database`), `school_source_freshness`
(per school: last checked/changed per page kind — feeds the data map).
`cds_document_sources`/`cds_manifest_snapshots` stay.

Why a narrow facts *table* instead of packet jsonb: the Explore tab needs columnar
filters ("admit rate < 20% AND state = CA AND net price < $30k"); `query_database`
recipes become one-line SQL instead of `jsonb_path_exists` probes; and multi-source
rows per key are natural. The immutable-snapshot + evidence + SCD2 columns keep the
honesty properties the packet store had.

Startup coupling to fix: `Catalog._load_snapshot` hard-fails the whole app unless
exactly one current manifest exists (`counselle_db/catalog.py:139-153`). The catalog
must load from `school_profiles` + `school_source_freshness` + fact-key config, with
the manifest optional.

---

## 9. Agent surface after the change

| Tool | Status | Notes |
|---|---|---|
| `resolve_school(query)` | keep | Coverage block now reports: facts by source tier + corpus docs + page freshness |
| `get_school_profile(unitid, groups?)` | keep | unchanged |
| **`get_facts(unitid \| unitids, keys? \| topic?)`** | **new, replaces `get_domain`** | Typed, cited rows; every row carries source, tier, vintage, evidence marker, caveats; disagreements surfaced; multi-school in one call for comparisons |
| **`search_documents(query, unitid?, kinds?, year?)`** | **new** | Hybrid retrieval over `corpus_chunks`; returns section text + page/url + excerpt; `source="cds"` with page evidence (already supported) or `"edu"`/third-party for pages |
| `query_database(sql, params)` | keep | Over the new views; simpler recipes; `db-recipes` skill rewritten |
| `search_web` / `search_school_site` / `search_reddit` | keep | Live fallback, unchanged (ADR 0015's *search* half survives; only its no-fetch clause is superseded) |
| `render_viz` | keep | Cells resolve through `get_facts` instead of `get_domain` |
| `load_skill("cds-catalog")` | new skill, no new tool | The compressed catalog (§7) |

Every new tool is a plain async function mounted via `Tool(...)` in `app/toolset.py`
like the Tavily tools (not a second MCP server); `get_facts`/`search_documents` also
belong in `counselle_db/service.py` so `render_viz` and the `/schools` routes call them
in-process, per the existing "MCP is the model's seam, code calls the service" rule.

New/changed prompt assets: `data_picture.md` (the data map), `counselor.md` §Evidence
Routing (three-source precedence), skills `db-recipes`, `school-deep-dive`,
`school-comparison`, `costs-and-aid`, `chancing` (replace `get_domain` guidance with
`get_facts` + `search_documents`). Evals: ~24 of 32 cases reference CDS tools and get
re-pointed; add retrieval cases.

**Decision record:** ADR 0037 "School data: watched web sources, facts store, corpus
RAG" — supersedes ADR 0015's no-fetch clause and ADR 0032's packet-as-only-metric-path;
amends ADR 0036 (engine becomes lazy/on-demand; approve gate retired); partially
revives ADR 0007/0008's embedding-reconcile design for the corpus.

**Number collision, not yet resolved:** this proposal is unimplemented, and the number
"0037" it reserves now collides with `main`'s real, shipped `docs/adr/0037-per-turn-agent-surface.md`
(the essay AI panel's per-turn surface decision — an unrelated subject). The school-data-v3
work that *did* ship from this same research took the next number, 0038
(`docs/adr/0038-collegedata-facts-store-cds-parked.md`), for exactly this reason. Do not
renumber this stub to 0038 — that number is taken and this RAG/watched-sources proposal is
not being built. Whoever picks this proposal back up must allocate a fresh, still-unused
ADR number before filing it for real.

---

## 10. Phasing (each phase ships value on its own)

| Phase | Deliverable | Why this order |
|---|---|---|
| **0** | ADR 0037; `config/facts/keys.yaml` v1 = the CollegeData-owned keys in `plans/school-data-field-catalog.md` | The key vocabulary is the contract everything else validates against |
| **1** | The CollegeData adapter (`__NEXT_DATA__` parser, five tabs), crosswalk from the site's search list, snapshots + `school_facts` for all listed schools (top ~500 first), College Navigator backfill for the rest; `get_facts`; wire `/schools` facts + explore tabs to real data | The store, the watch loop, and the first real backend for the existing UI land together; unblocks Explore filters |
| **2** | Watch school CDS pages; auto-fetch new editions from `ct_index_entries` + school CDS pages into `cds_documents` (upload screen stays); label-keyed deterministic PDF parser → long-tail `school_facts`; corpus + hybrid RAG; `search_documents`; data map + `cds-catalog` skill; retrieval eval on the tuning ground truth | Turns the 394-key ceiling into "anything in the CDS", and grows the corpus without human uploads |
| **3** | Chancing sources: class-profile pages, College Kickstart, College Confidential decision threads → `applicant_outcomes`; quarterly change checks + daily parser smoke test on the leased poller; `third_party` caveats; source precedence/disagreement | Round- and major-level priors plus applicant-level outcomes; keeps the store honest without a human in the loop |
| **4** | Lazy CDS extraction: engine re-pointed at `school_facts`, triggered by add-school / facts-page gaps; admin UI becomes a flagged-fact QA queue; migrate the 4 docs' packets; retire packet views from the reader grant; freeze packet tables | Keeps the expensive asset working, removes the human gate that stalled coverage |

Phase 1 is one adapter + crosswalk + the watch loop; 1+2 is the point where the agent
is materially better than today. Phases are additive — the current packet path keeps serving until
phase 4 flips the reader grant.

---

## 11. Things you didn't ask about that will bite

1. **TOS and redistribution.** CollegeData's terms restrict automated access and its
   data is licensed from Peterson's; displaying it is a second exposure beyond fetching.
   Accepted (D2). Mitigate: low cadence, only pages we cite, `third_party` labelling,
   vintage on every value.
2. **Identity crosswalk.** unitid → CollegeData slug via the site's `/college-search`
   list page (name match + city/state verify), manual-override column. Navigator and
   Scorecard are unitid-keyed and need none.
3. **Multi-source disagreement is the new "never merge editions".** Without a
   precedence rule and a disagreement caveat, three sources for one key is a
   worse honesty problem than one source.
4. **AcroForm CDS PDFs lie to text-based RAG** (tuning report). The detector exists;
   the RAG parse must use it or we ship confident wrong answers for exactly those
   schools.
5. **Immutable snapshots are non-negotiable for citations.** A "[3]" that points at
   a URL whose content has changed is a broken citation. Store what we saw, with a sha.
6. **The scheduler doesn't exist** — the CollegeData pass runs on the existing
   Postgres-leased poller; no Playwright, so the slim image stays slim.
7. **The app currently refuses to boot without a current manifest.** Decouple the
   catalog before freezing the manifest path.
8. **Evidence and tier are hard-coded to two sources** in `domain/envelope.py` and
   `app/sources.py`; both need the small extensions in §6 or scraped facts can't show
   "says who" in the rail.
9. **Retrieval quality must be measured, not assumed** — the tuning ground truth is a
   free golden set with page numbers; use it before choosing Docling vs pymupdf4llm.
10. **Prompt caching.** The data map and catalog skill are static per deploy; keep
    them at the top of the system prompt so Gemini's implicit caching hits.
11. **Change-watching cadence is a cost knob, not a correctness knob** — most of this
    data changes once a year; "always watching" means weekly-in-season for the few
    pages that are cycle-perishable, not daily for everything.
12. **`ct_index_entries` (5,946 CDS URLs) is dead weight today** — it becomes the seed
    list for auto-fetching CDS PDFs in phase 2.
13. **Explore's fit classifier (`classify-fit.ts`) needs `submitted_percent` to
    trust a test band** — CollegeData does not carry it; it comes only from the CDS PDF
    (C9) via phase 2, or Navigator/Scorecard backfill. Until then the classifier must
    treat every band as untrusted, exactly the trap it was built around.

---

## 12. Decisions for the owner

- **D1 — Direction.** Facts store + corpus RAG + lazy extraction (this doc) vs. keep
  eager packet extraction as the only metric path. Recommendation: this doc.
- **D2 — Aggregator scraping.** Decided 2026-09-04: yes, aggregator sites are the
  store's source; TOS risk accepted. Narrowed 2026-09-05 to **CollegeData only**;
  Niche dropped after the IP-block measurement (§2.3). No review text enters any store.
- **D3 — Crawler.** Decided 2026-09-04: fully free — `httpx` against CollegeData's
  JSON shell. Firecrawl recorded only as the paid fallback for a bot-walled source.
- **D4 — Human review.** Retire the approve gate (facts publish automatically with
  validator flags as caveats; admins QA a flagged queue) vs. keep it for `cds` facts
  only. Recommendation: retire; flags-as-caveats is more honest than a queue nobody
  clears.
- **D5 — Fact-key vocabulary.** Decided by the inventory: the ~150 CollegeData-owned
  keys in `plans/school-data-field-catalog.md` are v1; the 394 CDS manifest ids stay
  the retrieval index and on-demand extraction schema, promoted into the store only
  when asked for. Still open: D1 (direction — implicitly yes, this doc is the plan)
  and D4 (retire the approve gate; recommended yes).

---

## 13. Decision log (2026-09-04 → 2026-09-05) — read this first after a context reset

1. **Direction:** replace eager CDS packet extraction as the only metric path with a
   versioned multi-source facts store + a CDS PDF RAG corpus + the existing engine made
   lazy (§1, §4, §5). The `/schools` facts/explore tabs read fixtures today; the store is
   their first real backend (§0).
2. **Sources:** aggregators do the work, not raw government data → free only → narrowed
   → **CollegeData only** for the scraped store (§2.1). Niche inventoried then dropped
   for the per-IP block (§2.3). Deadlines/requirements out of scope. Chancing sources
   (class-profile pages, College Kickstart, College Confidential) are phase 3;
   r/collegeresults parked.
3. **CDS RAG stays in** (owner reversed an earlier "skip it" recommendation) because the
   school's own CDS PDF is the freshest and only complete source; CollegeData lags
   months, IPEDS years. Parse by row label first, chunk per section, hybrid retrieval in
   pgvector (already installed on staging) (§5).
4. **Scraping is $0:** `httpx` + JSON-shell parsing, conditional GET + facts-hash
   diffing, the existing leased poller as scheduler, snapshots in Postgres (§2.4, §3).
5. **Field catalog:** `plans/school-data-field-catalog.md` — every CollegeData field
   from live captures of Yale + UGA, keyed and typed, with the Niche inventory kept for
   the record and the known gaps (submit %, net price by income, residency splits,
   earnings) mapped to the CDS PDF or Navigator/Scorecard backfill.
6. **CDS admin system:** freeze the eager workflow and the approve gate, keep the engine
   (PDF adapter, poller, Gemini adapter, validators, review UI pattern) as the lazy
   on-demand extractor and QA queue; the 394-metric manifest becomes the retrieval
   index, the on-demand schema, and the compressed catalog (§4, §7).
7. **Honesty additions:** `third_party` tier, per-key precedence (CDS PDF > CollegeData
   > Navigator), `source_disagreement` caveat, evidence for non-CDS facts (§6).
8. **Measured facts:** manifest skeleton ≈ 3.2k tokens, descriptions ≈ 10.7k; 2,746
   schools in the identity table with OPEID; CollegeData school pages 502 without the
   homepage cookie and 200 with it; Niche block >2.5 h after 11 fast pages.
9. **Next step when work resumes:** ADR 0037, then phase 0/1 — `config/facts/keys.yaml`
   from the catalog, the CollegeData adapter, the `school_facts` migration, `get_facts`,
   and wiring `SchoolDetailRoute.tsx:128` / `ExplorePanel.tsx:98` to real data.

### 13a. Exploration round 2 (2026-09-05, seven codebase explorers + live probes) — corrections to the above

Owner reframing this round: structured data = identity profile + CollegeData **only**; the CDS
PDF is **RAG-only** (no extraction into structured metrics); the extraction engine is
**parked**, not made lazy; the admin upload flow is reused so "upload a CDS" = parse → chunk
→ embed, with the edition year visible to the agent. Scrape **every** field on CollegeData for
**every** school there, and keep watching for page changes.

Measured/discovered facts (full reports in the session scratchpad `explore/*.md`):
- CollegeData JSON route `/_next/data/<buildId>/college-search/<slug>/<tab>.json` works
  with no cookie/header: 3–11 KB per tab vs 83 KB HTML. ETag present but `If-None-Match`
  ignored (always 200) → change detection = hash of canonical JSON. buildId rotates on their
  deploys (404 → re-read from any HTML page). Sitemap `a-sitemap.xml.gz` lists 2,592 school
  slugs × 6 pages (overview + 5 tabs; header keys differ per tab, so fetch all 6); `lastmod`
  is one uniform timestamp (useless). `college-search.json` = 2,588 schools, 20/page, with
  id/name/slug/address. Majors/master's/doctoral lists are inline (no sub-fetch). Internal
  ids only (Yale 244) — crosswalk by name+city+state+zip to `schools` (unitid). Almost no
  vintage markers in the data (only "2025-26 Financial Aid", "2024 Graduates", deadline date).
  Full pass ≈ 15.5k requests ≈ 95 MB ≈ 2–4 h at 1–2 req/s.
- **pgvector is NOT installed and NOT available** on the local `postgres:16-alpine`
  container (`pg_available_extensions` lacks it); `seed_reader_db.py` lists `vector` as
  required but it cannot be created there. Image must become `pgvector/pgvector:pg16`.
  No embedding code exists anywhere; ADR 0007/0008 bodies hold the reusable design
  (gemini-embedding-001 `output_dimensionality` + L2-normalize; content-hash reconcile).
- `cds_library.schools.id` = IPEDS unitid (2,746 rows, HD2024, zero writers in this repo);
  `search_name`, `aliases[]` (1,218 non-empty), `official_domain`, opeid in jsonb. No slug.
  `ct_index_entries` already holds **5,946 crawled CDS-PDF index entries** (auto-ingest source).
- Live DB drift: yoyo ledger 23 rows vs 19 files on main (worktree leaks, duplicate 0019/0020);
  four immutability triggers exist live but are missing from the seed file; four roles not
  three (`cds_library_owner` NOLOGIN never created by setup script). Next migration = 0021.
- CDS engine seam is one call: `app/cds/jobs.py:129` `engine.run_extraction(...)`. PDF bytes
  live in `cds_documents.pdf_content` bytea (50 MB cap). `adapters/cds_pdf.py` = pymupdf;
  AcroForm PDFs must be `bake()`d before text extraction or field values vanish (UGA);
  `detect_corrupt_text_layer` catches broken CMaps (Caltech). Identity detection = one Gemini
  visual call on pages 1–3 → school + academic_year (already pinned on `cds_school_years`).
  `COUNSELLE_CDS_WORKER_ENABLED=false` parks everything with zero code change.
  `specs/cds-pipeline/tuning/gt/*_pageindex.json` = page→section ground truth for a retrieval eval.
- Honesty layer is closed-enum everywhere: `SourceName` 5 literals, `Tier` 2, evidence only
  for `cds` (`domain/envelope.py:159`), `EvidenceItem.page` required, viz sourced cells accept
  only web/edu; 52 gap items catalogued (scratchpad `explore/honesty.md`). Frontend
  `SOURCE_NAMES` is a runtime const; DESIGN.md §14.1 closes the badge set (no third tier).
- Agent: `get_domain` is the only metric path; `counselor.md` names tools/views literally in
  five sections; 11 skills + ~24/32 evals reference CDS tools; `catalog.py:151` hard-fails
  boot without exactly one current manifest; `app/workspace/service_reference.py` is the one
  non-agent `get_domain` caller.
- Frontend: `SchoolFacts` (`school-facts-types.ts`) is shaped as a packet-v8 result;
  `ExploreSchool`/`ExploreFilters` include a `dataWindow` CDS-edition lens that is obsolete
  under the new design; no `/schools/{id}/facts` or `/schools/explore` routes exist.
- Deploy: one Render **free** web service (sleeps when idle → a background scraper won't run
  there); `Containerfile` runs seed + yoyo + uvicorn in one process; Render free Postgres
  expiry noted for 2026-09-18.
