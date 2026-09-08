# School data v2 — CollegeData facts store + CDS PDF corpus (RAG) + parked extraction engine

> **2026-09-05 (third round):** the owner dropped the RAG corpus for now. The current plan is `plans/school-data-v3.md` (CollegeData facts store only; CDS system parked whole). This file is kept for the RAG design (§2 parser/chunker/embedding/store/rerank/eval rows and §5), which was measured on our own PDFs and should be reused verbatim when the corpus returns.

**Status:** design draft, 2026-09-05. Supersedes the source/tier/lazy-extraction parts of
`plans/school-data-rearchitecture.md` (keep that file for the source research, the
measured constraints, and the decision log; its §13/§13a are still the history). The field
inventory in `plans/school-data-field-catalog.md` remains the label reference for the mapper.

Read order after a context reset: this file → `school-data-rearchitecture.md` §13/§13a →
`school-data-field-catalog.md`.

---

## 0. Owner decisions that shape everything (2026-09-05, second round)

| # | Decision | Consequence |
|---|---|---|
| D1 | Structured school data = the basic identity profile (`schools.basic_profile`, IPEDS HD2024, 2,746 rows) + **CollegeData, every field, every school on the site**. Nothing else feeds structured facts. | The 394-metric extraction path is no longer a data source. No Navigator/Scorecard backfill, no third source. |
| D2 | The CDS PDF is **RAG only**: admin uploads a PDF, chooses school + academic year, the system parses, chunks, embeds. The agent searches any CDS, sees the year of every edition, and prefers the newest. | No structured values are ever derived from a PDF by code. A CDS number reaches a student only through the agent quoting a retrieved chunk. |
| D3 | Scraped facts are **Counselle's own data**: no source label, no tier, no attribution on the page or in chat. Citation = "Counselle's database". | Internally we still keep full lineage (snapshot → label → fact) because it is how we debug, re-derive, and detect site changes. The student never sees "CollegeData". |
| D4 | CDS citations are **document-level**: "Common Data Set 2024-25, Yale". No page, no excerpt required. | The `cds` citation carries school, year, sha. Page ranges are stored on chunks for the admin preview only. |
| D5 | Facts page: keep the six reader sections; **map every CollegeData label into them**; unmapped or absent = "not filled". The only CDS presence on the page is a link list of the uploaded CDS editions. Deadlines from CollegeData are shown. | Mapper coverage is a hard test (zero unmapped labels on the fixture captures). |
| D6 | Explore filters: whatever the CollegeData data supports and gives the best UX; server-side. | A wide `school_explore` materialized view is the filter surface. |
| D7 | Uploads are **admin-only, manual**, and must be scriptable so a coding agent can upload on the owner's behalf. No auto-ingest from `ct_index_entries`. | One documented endpoint + a CLI (`scripts/cds_upload.py`) that logs in and uploads. The Gemini identity detector is parked with the engine (no model call at upload). |
| D8 | Embeddings use **Gemini** (best quality). **No LLM anywhere in ingestion**: PDF parsing is deterministic and free (the whole point of dropping extraction was its per-document model cost). Scraping stays free. Corrupt/unreadable PDFs are skipped and flagged. | The only paid call in the corpus pipeline is the embedding batch (~25k tokens/doc ≈ $0.004). Vertex AI auth already exists (`adapters/cds_gemini.py` pattern). |
| D9 | The agent's CDS search must scope freely: one school, many schools, one year, many years, any combination. | Tools take `unitids[]` and `years[]` filters; retrieval is filtered hybrid search. |
| D10 | The compressed CDS map for the agent: minimum tokens, full knowledge of what a CDS contains. | Item-level outline (~1.5k tokens) as a skill; section-level line in the data picture. |
| D11 | The database holds nothing worth keeping except the basic profile → **nuke and rebuild `cds_library` from a new seed**; no backfill, no migration of packets. The extraction engine's code is **parked, not deleted**. | Clean ledger, clean schema, pgvector image, extraction tables dropped from the live schema (DDL parked in git). |
| D12 | "Best prebuilt tools, never reinvent the wheel" for the scraper, the RAG pipeline, and the search tools. | Tool choices in §2, with the rejected alternatives named. |

---

## 1. Target architecture in one screen

```
                 ┌──────────────── writers (cds_library_app, COUNSELLE_DB_PIPELINE_DSN) ────────────────┐
                 │                                                                                       │
  collegedata.com JSON ──► crawl worker ──► page_snapshots (immutable, hash-diffed)                       │
                                   └──► mapper (config/facts/keys.yaml, versioned) ──► school_facts (SCD2)│
                                                                                └──► school_explore (matview)
  admin/CLI upload (PDF + unitid + year) ──► cds_documents ──► embed worker ──► pymupdf4llm + item splitter ──► cds_chunks (vector + tsv)
                 │                                                                                       │
                 └───────────────────────────────────────────────────────────────────────────────────────┘
                 ┌──────────────── readers (cds_library_reader, COUNSELLE_DB_RO_DSN) ─────────────────────┐
  views: school_profiles · current_school_facts · school_explore · cds_documents_ro · cds_chunks_ro · school_data_status
                 │                                                                                       │
  agent tools (in-process, PydanticAI Tool): resolve_school · get_school_profile · get_facts · query_database
                                             · search_cds · get_cds_items · load_skill("cds-map")
  HTTP: GET /v1/schools/{unitid}/facts · GET /v1/schools/explore · GET /v1/schools/{unitid}/cds/{doc}.pdf
                 └───────────────────────────────────────────────────────────────────────────────────────┘
  parked: domain/cds/*, app/cds/engine*, review/approve routes, manifest tables — importable, flag-off, no live tables
```

Three roles and three DSNs stay exactly as they are (ADR 0036's strongest property). The
schema keeps its name `cds_library` (renaming touches every DSN, grant, doc, and test for
zero product value). The agent path stays strictly read-only through views.

---

## 2. Tool choices ("best prebuilt", with what was rejected)

| Concern | Choice | Why | Rejected |
|---|---|---|---|
| Fetching CollegeData | **Crawlee for Python** (`crawlee`, Apify, Apache-2.0) `HttpCrawler` over its httpx client, `SitemapRequestLoader` for the URL list, its session pool + retry/backoff + autoscaled concurrency + `robots.txt` respect + run statistics. Confined to `adapters/collegedata/fetch.py`; storage is ours (Postgres), not Crawlee's. | Asyncio-native (fits FastAPI/PydanticAI), maintained, does the boring reliability work (retries, backoff, per-host throttling, session rotation on 4xx/5xx bursts, sitemap parsing) so we don't hand-roll it. | Scrapy (Twisted reactor, separate process model, overkill for 15k JSON GETs); a hand-rolled httpx loop (~150 lines, the KISS alternative — see open question Q1); Firecrawl/Apify cloud/any paid crawler (owner: free only); Playwright (not needed, JSON route needs no browser). |
| Parsing the JSON tree | pydantic models for the typed `bodyContent` node types + our mapper | The tree is small and fully typed; no HTML parsing at all. | BeautifulSoup/selectolax (no HTML to parse). |
| Change detection | sha256 of canonical JSON (`orjson` with sorted keys) per page; new snapshot only on change; sitemap re-read every pass for new/removed schools | Server ignores `If-None-Match`; `lastmod` is uniform; hashing 6 KB is free. | Conditional GET (not honored), visual diffing (nonsense). |
| Scheduling | The existing Postgres-leased `Poller` pattern (`app/cds/jobs.py`) generalized to a `jobs` table with kinds `crawl_pass`, `embed_document`; a full CollegeData pass is one job that runs the Crawlee crawler; runs **daily** | Crash-safe, inspectable, already tested in this repo. | Celery/Redis (a second system), APScheduler in-process (no persistence), cron-only (no lease/retry). |
| PDF → text with structure | **`pymupdf` + `pymupdf4llm` 1.28** (`to_markdown(page_chunks=True)`): tables come out as markdown built from page geometry, so Excel exports whose text layer emits cells in scrambled order still render correctly (verified on Harvard/Pitzer/Ohio State Excel exports and Yale Word export: C1, C7 ☒-grid, C9 percentile + score-range tables all exact). ~15 s for a 43-page file on CPU, no model weights. Pre-steps: encrypted → `failed`; widgets present → `bake()` (defensive; the corpus recon found 0/15 live AcroForms); control chars in text → `skipped:corrupt_text` (Caltech-style broken CMaps yield plausible-but-wrong digits, so they must not be indexed); NBSP + Wingdings PUA (U+F000–F0FF) normalized. | Measured on our own PDFs; zero per-document model cost. | Gemini/vision transcription (**owner: that is extraction cost again**); **Docling** (measured: two 10-minute runs on one 43-page file never finished on CPU — torch + model download + ~3 s/page; TableFormer needs torch); pdfplumber (equal quality, MIT, but pymupdf is already a dependency); ColPali/ColQwen page-image retrieval (112–139 s/page on CPU, 515 KB/page, engine deprecated, returns images not citable text); LlamaParse/Reducto/Unstructured cloud (paid). |
| Chunking | **One chunk per CDS item** using **Chonkie 1.7** (MIT, ~0.5 MB, no torch): `RecursiveChunker` with a custom first level that splits on the item-code heading regex (`^\W*[A-J]\d{1,2}\b`, ranges like `C9-C12` register the range), then `TableChunker` (row-based, header repeated) only for items over 1,500 tokens. Measured on 6 documents: median item ≈ 140 tokens, p90 ≈ 820, outliers J1 (degrees by CIP, ~7k), G1 (~3.6k), I3 (Ohio State, ~10k), H14/H15/B4 (~2k). Cross-page tables are re-joined when a page opens with the same header row; page-number lines stripped. Contextual prefix from known metadata (school · CDS year · section title · item title) — Anthropic's contextual retrieval without the LLM, because the context is structural. Checkbox grids whose marks are all identical (drawn boxes, not ☒ glyphs) get a caveat line in the chunk so the agent never reads "unchecked" as "not considered". | Structure-aware beats fixed-size on a standardized form; the item code becomes a filter and a direct-lookup key; table integrity survives. | Fixed-token splitters (cut tables); semantic chunkers (structure is given); Docling HybridChunker (needs Docling); late chunking (Gemini returns pooled vectors only). |
| Embeddings | **`gemini-embedding-2`** on Vertex AI (stable on the Gemini API since 2026-04-22; **confirm Vertex GA at implementation** — the Vertex pricing page still said Preview; fallback `gemini-embedding-001`, shutdown announced 2028-05-14), `output_dimensionality=1536` (Google's table: 3072 → 68.16, 1536 → 68.17, 768 → 67.99), explicit L2 normalization (only 3072 comes pre-normalized on `-001`), `autoTruncate=false` plus our 1,800-token hard cap (8,192-token input on `-2`, 2,048 on `-001`), document format `title: {item title} \| text: {chunk}` with `RETRIEVAL_DOCUMENT`, queries with `RETRIEVAL_QUERY`; 250 texts per request, so one CDS embeds in one call. ≈ $0.20/1M tokens → ≈ $0.005/document. Model id + dims are Settings. | Owner: Gemini, best quality. 1536 is indexable by pgvector if we ever add HNSW. | 768 dims (saves storage we don't need to save); local fastembed/bge (weaker, adds CPU/memory); OpenAI/Voyage/Cohere (another vendor). |
| Vector + text store | **pgvector ≥ 0.8.3 (0.8.6 current) in the main Postgres**, `vector(1536)`, and **no ANN index at first**: every query is filtered to a few hundred rows (schools × years × items), where an exact scan is both faster and safer than HNSW (post-filtered HNSW silently returns near-empty results at low selectivity). B-tree on `(school_id, academic_year, item_code)`; `tsvector` (title weight A, body weight B) with GIN; add HNSW + `hnsw.iterative_scan = relaxed_order` only when a measured query exceeds ~200 ms. Local image `pgvector/pgvector:pg16`; prod provider must ship pgvector (Render does). | One system, one transaction, one backup; corpus ≤ ~100k chunks. | Qdrant/Weaviate/Turbopuffer (second datastore); ParadeDB `pg_search` (Neon removing it 2026-09-21, not on Render/RDS/Cloud SQL); `pg_textsearch` (real BM25, PG17+ only — revisit on a major bump); Gemini File Search / Vertex RAG Engine (vendor-locked corpus, generic chunking, no direct item lookup, ADR 0011). |
| Reranking | **Off at launch.** RRF (k=60) over vector top-40 + lexical top-40 in one SQL statement. Switch (`cds_rerank=off\|vertex`) to **Vertex AI Ranking API `semantic-ranker-fast-004`** (needs `discoveryengine.googleapis.com`) once the retrieval eval shows a gap. | A cross-encoder is the next lever after hybrid fusion, but with 30 eval questions we cannot tune weights without overfitting, and the deterministic item-code routing below removes most of the need. | Cohere Rerank 3.5 / Voyage / Jina (another vendor); local cross-encoders (torch in the image). |
| RAG framework | **None.** ~300 lines of our own glue: parse → chunk → embed → insert; search = one SQL + one rerank call. `pgvector` Python package only for the asyncpg codec. | The pipeline is CDS-specific and tiny; LlamaIndex/LangChain/Haystack would wrap three API calls in an abstraction and fight PydanticAI for the agent seam. | LlamaIndex (ingestion pipelines + PGVectorStore + rerankers — good generic kit, wrong fit), LangChain, Haystack. |
| Agent tools | **In-process PydanticAI `Tool()` functions** over `counselle_db/service.py` using the RO pool; the stdio MCP child (`counselle_db/server.py`) is deleted; ADR 0004 superseded | The child was the model's seam, but the reader role is enforced by DSN, not by process; code already calls the service in-process. Deleting it removes a process, a supervisor, stdio plumbing, and `annotate_mcp_result` special-casing. | Keeping the MCP child for "MCP-nativeness" (no consumer other than our own agent). |
| Retrieval eval | **`ranx`** (MIT) over `specs/cds-pipeline/tuning/gt/*_pageindex.json` (page → item codes, 5 docs) + ~30 hand-written questions → recall@5/@8, MRR; no LLM judge; run from `evals/`. | Free ground truth that already exists; no hosted account. | ragas/DeepEval (LLM-judge oriented), LangSmith/Braintrust (hosted accounts). |

---

## 3. Schema v2 (`cds_library`, rebuilt from a new seed; writer `cds_library_app`, reader views for `cds_library_reader`)

Kept as-is: `schools` (identity, IPEDS unitid PK, `basic_profile` jsonb, `search_name`, `aliases`, `official_domain`) and the `school_profiles` view. Everything else below is new; the extraction tables (`cds_manifests`, `cds_extractions`, `cds_domain_packets`, `ct_index_*`, and `counselle.cds_pending_edits`) are dropped from the live schema and their DDL parked at `deploy/seed/parked/cds_extraction_schema.sql`.

```sql
-- Crosswalk: versioned data asset config/facts/collegedata_crosswalk.csv, loaded into a table
collegedata_schools   (slug text PK, collegedata_id int, name text, city text, state text, zip text,
                       school_id int NULL → schools(id), match_method text, matched_at timestamptz)

-- Immutable page captures (one row per changed capture)
page_snapshots        (id bigserial PK, school_id int → schools, tab text CHECK (tab IN
                       ('overview','admission','money-matters','academics','campus-life','students')),
                       fetched_at timestamptz, http_status int, build_id text,
                       content_sha256 bytea(32), body jsonb)           -- BEFORE UPDATE/DELETE trigger: immutable
  UNIQUE (school_id, tab, content_sha256)

-- Latest capture pointer per (school, tab) + freshness (small, hot)
school_pages          (school_id, tab, latest_snapshot_id → page_snapshots, last_fetched_at,
                       last_changed_at, last_status, consecutive_failures int, PRIMARY KEY (school_id, tab))

-- Facts (SCD2; mapper output; the ONLY thing product code reads for structured facts)
school_facts          (id bigserial, school_id int → schools, fact_key text,
                       value jsonb, display text, unit text NULL,
                       section text,          -- getting-in | money | academics | campus-life | outcomes | applying
                       snapshot_id bigint → page_snapshots,      -- lineage (never shown)
                       source_path text,      -- lineage: "admission/Admission Overview/Applicants/Overall Admission Rate"
                       mapper_version text, observed_at timestamptz,
                       valid_from timestamptz, valid_to timestamptz NULL)
  UNIQUE (school_id, fact_key) WHERE valid_to IS NULL;  INDEX (fact_key) WHERE valid_to IS NULL

-- Filter surface: one wide row per school, refreshed after each pass (REFRESH MATERIALIZED VIEW CONCURRENTLY)
school_explore        (materialized view: unitid, name, city, state, region, control, size_bucket, undergrad_count,
                       admit_rate, admit_rate_in_state, admit_rate_out_of_state, yield, test_policy,
                       sat_p25, sat_p75, act_p25, act_p75, gpa_avg, cost_total_in, cost_total_out, net_price_avg,
                       need_met_pct, merit_aid_pct, grad_rate_4y, grad_rate_6y, retention, student_faculty_ratio,
                       housing_pct, greek_pct, out_of_state_pct, international_pct, gender_model, calendar,
                       application_fee, has_ed, has_ea, has_rea, rolling, deadline_regular, deadline_ed, deadline_ea,
                       majors text[], sports text[], facts_updated_at)

-- CDS corpus
cds_documents         (id bigserial PK, school_id int → schools, academic_year text ('2024-2025'),
                       pdf_sha256 bytea(32) UNIQUE, pdf_content bytea, byte_size int, page_count int,
                       uploaded_by_user_id uuid, uploaded_at timestamptz,
                       status text CHECK (status IN ('queued','parsing','embedding','ready','failed','skipped')),
                       error_code text NULL, error_detail text NULL,
                       parser_version text, embed_model text, embed_dim int,
                       item_coverage numeric NULL,        -- fraction of catalog items found (quality gate)
                       superseded_by bigint NULL → cds_documents)      -- re-upload of same school+year
  UNIQUE (school_id, academic_year) WHERE superseded_by IS NULL AND status <> 'failed'

cds_chunks            (id bigserial PK, document_id bigint → cds_documents ON DELETE CASCADE,
                       school_id int, academic_year text,           -- denormalized for filters
                       item_code text ('C9'), section_letter char(1), title text,
                       part int DEFAULT 0,                          -- split index for oversized items
                       page_start int, page_end int,                -- admin preview only
                       text text,                                   -- markdown as shown to the agent
                       embed_text text,                             -- prefix + text (what was embedded)
                       embedding public.vector(1536), tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED)
  HNSW (embedding vector_cosine_ops); GIN (tsv); INDEX (school_id, academic_year, item_code)

-- Job queue (generalized from cds_extractions; same lease semantics)
jobs                  (id bigserial, kind text CHECK (kind IN ('crawl_pass','embed_document')),
                       target jsonb, status ('queued','running','succeeded','failed'), attempts int,
                       queued_at, started_at, finished_at, lease_expires_at, error_code, summary jsonb)
  UNIQUE (kind, (target->>'document_id')) WHERE status IN ('queued','running')   -- one live embed per document
crawl_runs            (id, started_at, finished_at, build_id, schools_seen, pages_fetched, pages_changed,
                       facts_changed, errors int, unmapped_labels jsonb)   -- one row per pass; feeds admin home
```

Reader views (the grant to `cds_library_reader` becomes exactly these): `school_profiles`
(unchanged), `current_school_facts` (`valid_to IS NULL`, no lineage columns exposed except
`observed_at`), `school_explore`, `cds_documents_ro` (no `pdf_content`), `cds_chunks_ro`
(no `embedding`, no `embed_text`), `school_data_status` (per school: `facts_updated_at`,
`fact_count`, `cds_years text[]`). `query_database`'s allow-list is these six.

Immutability triggers go **into the seed file** this time (they were live-only before).
`counselle.cds_upload_files` + `cds_admin_audit` stay (yoyo-managed) for the staged upload
flow; `cds_pending_edits` is dropped by `0021`.

---

## 4. The scraper (`adapters/collegedata/`, `app/facts/`)

**Discovery.** Each pass re-reads `sitemap_index.xml` → `a-sitemap.xml.gz`, rewrites
`stg.` → `www.`, extracts `/college-search/<Slug>` slugs (2,592 today). New slugs not in
`collegedata_schools` are inserted unmatched; matched slugs are crawled; a slug absent from
the sitemap for two passes is marked `retired`.

**Fetch.** Resolve `buildId` once per pass from one HTML page's `__NEXT_DATA__`. For every
matched school × 6 tabs: `GET /_next/data/<buildId>/college-search/<slug-lower>/<tab>.json?slug=<slug>`.
404 mid-pass → refresh `buildId`, retry once. Crawlee handles pacing (target 2 req/s,
concurrency 4, max 3 retries, exponential backoff, session rotation on 403/429/5xx), a
browser-like UA, and per-pass stats. No cookie dance needed on the JSON route (verified).

**Snapshot.** Canonical JSON (`orjson`, sorted keys, `pageProps.profile` only) → sha256 →
if equal to `school_pages.latest` sha, touch `last_fetched_at` and stop; else insert
`page_snapshots`, move the pointer, set `last_changed_at`, run the mapper for that school.

**Mapper** (`app/facts/mapper.py` + `config/facts/keys.yaml`). Walks the typed tree
(`ExpandableSection` → `CategoryDivider` / `TitleValue` / `TitleLink` / `LabeledTable` /
`IconTable` / `NestedTitleValue` / `BarGraph` / `SubscreenNavigator`) and emits facts:

- Every leaf gets a `source_path` (`tab/section/category/label[/row][/column]`); `keys.yaml`
  maps `source_path` patterns → `fact_key`, `section`, `type` (`money | percent | int |
  decimal | ordinal | bool | text | date | list | table | range`), and optional `unit`.
- Values are normalized in code: "$62,250" → `62250`; "34%" → `0.34`; "Not reported" →
  a fact with `value = null, display = "Not reported"`; public schools' `[in-state,
  out-of-state]` arrays → two keys; `IconTable` marks → ordinal (`very_important |
  important | considered | not_considered`); `BarGraph` → a `table` value with buckets
  (GPA/SAT/ACT distributions, kept structured for chancing per D11/owner Q11); majors,
  master's, doctoral lists → `list`; the deadline header fields → `date`.
- **Exhaustiveness is a test**: the fixture captures (Yale, UGA, plus a public and a small
  private added at implementation) must produce zero unmapped `source_path`s. In
  production, unmapped paths are still stored (`fact_key = 'unmapped:' || source_path`,
  `section = 'other'`) and counted in `crawl_runs.unmapped_labels`, so a new CollegeData
  label never silently disappears; it surfaces on the admin home to be mapped.
- SCD2 write: for each `(school_id, fact_key)`: if current value equal → no-op; else close
  the current row (`valid_to = now()`) and insert the new one. `mapper_version` bumps
  re-derive everything from stored snapshots without re-scraping (a `remap` CLI).
- After a pass: `REFRESH MATERIALIZED VIEW CONCURRENTLY school_explore`.

**Cadence.** One `crawl_pass` job per day (Settings `facts_crawl_interval_hours=24`,
`facts_crawl_rps=2`). ≈15.5k requests ≈ 2 h ≈ 95 MB. "Always listening" is this daily
diff; CollegeData offers no push and its `changefreq` is monthly.

**Where it runs.** Same image, **separate process**: `python -m app.worker` runs the
Poller loop (crawl passes + embed jobs); the web service runs no workers in production
(`COUNSELLE_WORKER_ENABLED=false` there, `true` locally via `scripts/dev.py`). On Render
that is one Background Worker service (~$7/mo) beside the web service and the paid
Postgres. A free GitHub Actions cron running `python -m app.worker --once` is the $0
fallback (a daily 2 h pass fits the 2,000 min/month private-repo allowance only if the
pass is ≤ ~65 min, so weekly cadence there). Recommendation: the Background Worker.

**Crosswalk (one-time, versioned).** Pull the 2,588 `college-search.json` rows (130
pages) → normalized name + state + city + zip → match against `schools.search_name`,
`aliases`, `basic_profile.location`: exact normalized name+state → trigram ≥0.9 same
state+city → remainder adjudicated by subagents in batches with the candidate lists →
committed as `config/facts/collegedata_crosswalk.csv` (slug, unitid, method). Schools on
CollegeData with no unitid stay unmatched (not scraped); schools in `schools` with no
CollegeData page show "not collected" on the facts page.

---

## 5. The CDS corpus (`adapters/cds_pdf.py` reused, `app/cds/corpus.py` new)

**Upload** (`POST /v1/admin/cds/uploads`, multipart, superuser; batch = many files). Each
file: sha256 dedup against `cds_documents.pdf_sha256` → the admin **sets** school
(search) + academic year per file (required; nothing commits without both; no model-based
prefill — the identity detector stays parked with the engine) → `Commit`
creates `cds_documents(status='queued')` + a `jobs(kind='embed_document')` row. A second
upload for the same school+year supersedes the earlier document (old chunks deleted after
the new one is `ready`). **CLI:** `uv run python scripts/cds_upload.py --unitid 130794
--year 2024-2025 yale.pdf` logs in with `COUNSELLE_ADMIN_EMAIL/PASSWORD` against the
running API and calls the same endpoints — this is the coding-agent path (D7).

**Embed job (no LLM).** `pymupdf` opens the PDF (encrypted → `failed:encrypted`; widgets →
`bake()`; control characters in the text layer → `skipped:corrupt_text`). `pymupdf4llm.to_markdown
(doc, page_chunks=True)` yields per-page markdown with geometry-built tables; pages are joined,
page-number lines stripped, cross-page tables re-joined, NBSP/PUA normalized. The **item splitter**
(Chonkie `RecursiveChunker`, first level = the canonical item-code regex from the `cds-map`
outline) cuts one item per code with `page_start/page_end`; text before the first code is item
`A0`. Items over 1,500 tokens go through `TableChunker` (rows, header repeated) into `part`s.
Quality gate: `item_coverage` = codes found / codes expected (measured 83–97 per full document);
`< 0.6` → `status='skipped'`, reason `unparseable`. Checkbox items whose marks are all identical
get the caveat line. `embed_text = "title: {school} · CDS {year} · {section} · {code} {title} |
text: {chunk}"`, embedded in one 250-text request with `RETRIEVAL_DOCUMENT`, normalized,
inserted with the `pgvector` codec. Then `status='ready'`. Measured: ~15 s parse + one embedding
call ≈ $0.005 per document.

**Search** (`counselle_db/service.py::search_cds`): embed the query (`RETRIEVAL_QUERY`),
then one SQL: a filter CTE (`school_id = ANY($)`, `academic_year = ANY($)`, `item_code = ANY($)`,
`status='ready'`) feeding a vector top-40 (exact cosine over the filtered rows) and a lexical
top-40 (`websearch_to_tsquery`, title weighted above body), fused by RRF (k=60), optionally
reranked (switch) to top-k (default 8). **Deterministic routing first:** if the query names an
item code, the service answers from `get_cds_items` without search. Results return the whole
item when it fits (small-to-big), else the part with its header. Returns `{school, unitid,
academic_year, item_code, title, text, document_id}` rows plus the citation. **Direct
lookup** (`get_cds_items(unitid, items[], year=None)`) returns whole items with no search
(year defaults to the newest `ready` edition; the response always states the year). The
agent sees available years via `resolve_school`'s coverage block and `school_data_status`.

**Admin UI** (reuse of `features/cds-admin`): Home = "CDS Library" table (school, years,
status, chunks, coverage %, last error) + crawl status strip (last pass, changed pages,
unmapped labels); Upload = existing drop zone + per-file school search + year select + Commit; Document = status timeline, item list with page ranges and the
page-image preview, Retry / Supersede / Delete. **Parked, not deleted:** the review/approve/
reject/metrics screens and routes (components stay in the tree; routes unregistered; a
`PARKED.md` in `features/cds-admin` and `app/cds` says why and how to revive).

---

## 6. Agent surface

| Tool | Status | Contract |
|---|---|---|
| `resolve_school(query)` | keep, coverage block rewritten | `{unitid, name, facts_updated_at, fact_count, cds_years[]}` |
| `get_school_profile(unitid, groups?)` | keep | unchanged |
| `get_facts(unitids[], keys?[], sections?[])` | **new (replaces `get_domain`)** | typed rows `{unitid, fact_key, section, value, display, unit, observed_at}`; multi-school in one call; absent keys reported as `not_collected`; citation `source="db"` |
| `query_database(sql, params)` | keep, guard simplified | over the six views; the packet/manifest rejectors are deleted; the `DISTINCT ON` ranking rule is gone because `school_explore` is one row per school |
| `search_cds(query, unitids?, years?, items?, top_k?)` | **new** | hybrid + rerank; rows carry `academic_year` and a `cds` citation |
| `get_cds_items(unitid, items[], year?)` | **new** | direct item lookup, newest year by default |
| `load_skill("cds-map")` | new skill | the compressed CDS outline (§7) |
| `render_viz` | keep | cells resolve via `get_facts`; sourced cells still accept web/edu only |
| `search_web / search_school_site / search_reddit` | keep | unchanged |
| `get_domain` | **deleted** | — |

Prompt changes: `data_picture.md` → "Counselle holds structured facts for N schools
(updated ≤ D days ago) and M Common Data Set editions for K schools (years Y1–Y2). Facts
are Counselle's own data; cite them as such. A CDS chunk is cited as the document and its
year; prefer the newest edition and say which year you used." `counselor.md` §Evidence
Routing / §CDS Recency Gates / §Database Safety rewritten for the new tools and views;
skills `db-recipes`, `school-deep-dive`, `school-comparison`, `costs-and-aid`, `chancing`,
`citation-and-recency`, `counselor-research` re-pointed; the parked `dossier-assembly`
alias untouched. Evals: the ~24 CDS-path cases get re-pointed; add 6 retrieval cases
(single school/year, multi-year comparison, multi-school item lookup, "which year", an
absent-edition honesty case, an unmapped-fact honesty case).

Citation model (`domain/envelope.py`): `SourceName = db | cds | web | edu | reddit`
(`profile` folds into `db`); `Tier` applies to web/edu/reddit only (`db`/`cds` carry
none — D2/D3); `db` citation = `{school_unitid, observed_at}`; `cds` citation =
`{school_unitid, academic_year, document_sha256, document_id, items[]}`; `EvidenceItem` and
the CDS evidence gates (`envelope.py:153-160`) are removed; the sources rail shows "Yale
University · Common Data Set 2024-25 · C7, C9" for `cds` and the school name for `db`.
Frontend `SOURCE_NAMES`, `friendlySourceName`, `SourceAvatar`, `SourcesRail`, `VizBlock`
follow; the 5 protocol golden fixtures are regenerated.

---

## 7. The compressed CDS map (D10)

`config/assets/skills/cds-map/SKILL.md` (~1.5k tokens): the ten sections A–J with every
item code and a ≤8-word gloss, e.g. `C7 factors weighed in admission (very important →
not considered)`, `C9 SAT/ACT ranges + % submitting`, `H2 need-based aid: applicants,
awarded, need fully met, avg package`, plus three lines of usage rules (newest year first;
say the year; multi-year = compare editions). The same outline is the parser's canonical
code list and the `items` enum documentation on `search_cds`/`get_cds_items`. The data
picture carries only the one-line section summary. The 394-metric YAMLs are parked with
the engine; nothing at runtime loads a manifest, and `catalog.py`'s "exactly one current
manifest" boot check is deleted.

---

## 8. Facts page and Explore (backend + FE wiring)

`GET /v1/schools/{unitid}/facts` → `{identity, sections: [{id, groups: [{label, facts:
[{key, label, display, value, unit, state: 'value' | 'not_reported' | 'not_collected'}]}]},
deadlines, cds_documents: [{id, academic_year, url}], facts_updated_at}`. Section/group
layout lives in `config/facts/sections.yaml` (one source of truth shared by the mapper's
`section` and the page). `SchoolFacts` in the frontend is rewritten to this source-agnostic
shape (the packet-era `Evidence`, `DomainCoverage`, `SchoolEdition`, dual lanes,
`dataWindow` go away). "Not filled" renders as a muted "Not reported" (school didn't
report) or "Not collected" (we have nothing) — two words, no colour-only state.

`GET /v1/schools/explore?state=&size=&control=&admit_min=&…&sort=&page=` runs over
`school_explore`. Filters kept (all backed by CollegeData): text query; state / region;
size bucket; control; admit rate; test policy; SAT/ACT middle-50 vs the student's score;
total cost (in/out of state by home state); average net price; need met %; merit aid %;
4y/6y grad rate; retention; student:faculty; housing %; Greek %; out-of-state %;
international %; gender model; calendar; application fee = 0; ED / EA / REA / rolling;
**major offered** (new, from the majors lists); deadline before date (new). Sort by any
numeric column. `includeMissing` stays (never silently drop a school for a missing metric).
`GET /v1/schools/{unitid}/cds/{document_id}.pdf` streams the stored PDF (public documents).

---

## 9. Phasing

| Phase | Deliverable | Exit test |
|---|---|---|
| **0 Foundation** | `deploy/docker-compose.dev.yml` with `pgvector/pgvector:pg16` on 5433 (replaces the retired repo's container); `scripts/dev.py reset-db` (drop → seed v2 → schools from `deploy/seed/school_profiles.csv.gz` → yoyo from a clean ledger); seed v2 with triggers; `0021` drops `cds_pending_edits`; parked DDL file; worker flag + route unregistration + `PARKED.md`; ADR 0037 (school data v2, supersedes 0032's packet path, 0015's no-fetch clause, 0004; amends 0036) | app boots with no manifest; routine suite green; `CREATE EXTENSION vector` works locally |
| **1 Facts store** | crosswalk CSV; Crawlee fetcher; snapshots; mapper + `keys.yaml` + `sections.yaml`; SCD2 writer; `school_explore`; `jobs`/`crawl_runs`; `python -m app.worker`; admin crawl strip | zero unmapped labels on fixtures; a full pass completes; second pass writes zero new snapshots for unchanged pages |
| **2 Product on facts** | `/schools/{id}/facts`, `/schools/explore`; FE rewrite of facts + explore types and wiring; deadlines on the page | Yale/UGA pages render every mapped section from the DB; explore filters run server-side |
| **3 Agent on facts** | in-process tools; MCP child deleted; `get_facts`; simplified SQL guard; envelope `db`; prompts/skills/evals re-pointed; `service_reference.py` moved to `get_facts` | evals ≥ current baseline on the re-pointed cases |
| **4 CDS corpus** | upload flow + CLI; deterministic item parser; chunks; embeddings; `search_cds` / `get_cds_items`; rerank switch; `cds-map` skill; facts-page CDS links; retrieval eval on the page-index ground truth | recall@8 of the right item ≥ 0.9 on the ground-truth set; a coding agent uploads via the CLI end to end |
| **5 Docs** | `docs/DATABASE_GUIDE.md` §1/§3–§5 rewritten around the six views; `docs/ARCHITECTURE.md` §8–§11, §17, §38; `CLAUDE.md` status + commands; `TODOS.md` items closed; plan graduates to `specs/school-data-v2/` | docs describe the running system |

---

## 10. Risks and the things to keep an eye on

1. **CollegeData changes its JSON shape or blocks the JSON route.** Mitigation: the typed
   parser fails loudly per node type; `crawl_runs.errors` + unmapped labels on the admin
   home; snapshots are immutable so a fixed mapper re-derives. If the route disappears, the
   HTML `__NEXT_DATA__` path is the same JSON (the fetcher has both).
2. **No data year on CollegeData.** We show `Data updated <month year>` per school (a
   freshness date, not a source label — owner may strike it). The agent is told the facts
   are "current as of `observed_at`" and that the CDS PDF is the authority when both exist.
3. **Numbers quoted from CDS chunks are model-read at answer time** (the agent reads the
   retrieved text). Accepted by the owner (D2/D4). The chunk text itself is a verbatim
   deterministic extract of the PDF, so what the agent reads is what the PDF says; the
   `item_coverage` gate keeps unparseable files out of the corpus.
4. **Storage growth.** PDFs as bytea: ~1 MB each; a few hundred uploads is fine on a paid
   DB; the `pdf_content` column is the one place to swap for object storage later.
   Chunks: ~120/doc × 1536 dims ≈ 0.8 MB/doc with index.
5. **Ledger hygiene.** The nuke resets the yoyo ledger; in-flight branches carrying `0019`/
   `0020` migrations must renumber on rebase.
6. **Two id spaces.** ~200 CollegeData schools will have no unitid and ~350 unitids no
   CollegeData page; both are visible on the admin home, neither is an error.
7. **Vertex Ranking API** needs the Discovery Engine API enabled on the project; the
   switch defaults to `off` until it is.

---

## 11. Open questions for the owner (the last ones)

- **Q1 Fetcher:** Crawlee (recommended, §2) or the ~150-line httpx loop? Both are confined
  to one adapter file; the choice is cheap to reverse.
- **Q2 Freshness line:** keep "Data updated <month year>" on the facts page (my call, not a
  source label), or nothing at all?
- **Q3 Prefill deadlines** into the add-school dialog from the facts (one-line change
  after phase 2), or leave add-school untouched?
- **Q4 Reranker:** enable the Vertex Ranking API now, or ship RRF-only and turn it on
  after the retrieval eval shows the gap?
