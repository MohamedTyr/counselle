# School data v3 — CollegeData facts store only; CDS system parked

**Status:** current plan, 2026-09-06, **thirteenth round** (nine completed review loops; each round
the same three independent opus lenses — technical correctness, product/UX/honesty, cleanliness/blast
radius — re-read the text against the live tree and a scratch pg16 container. Round 9 is the first
round in which **every tier**, NITs included, was folded in: rounds 2–8 folded the MUST and SHOULD
tiers only, and the round-9 briefs' claim that everything had landed was inaccurate for the NIT tier
— see §11). Supersedes `plans/school-data-v2.md`, which keeps the RAG-corpus design
(parsing/chunking/retrieval decisions, measured on our own PDFs) for the day the corpus comes back —
do not delete it. Source research and measured constraints stay in
`plans/school-data-rearchitecture.md` §13/§13a; the CollegeData label inventory is
`plans/school-data-field-catalog.md` (superseded in detail by the companion appendix §E).

**Companion:** `plans/school-data-v3-appendix.md` carries the long-form material this plan cites
by letter (A–J): the complete label inventory with `fact_key`s, the `facts_sections.yaml` draft,
the explore columns and index list, the pydantic/TypeScript shapes, the worker SQL, the chip and
dashboard specs, the test/skill/eval/ADR tables, the measured crosswalk numbers. **This file wins
over the appendix wherever they differ**; the appendix header lists every known override.

Read order after a context reset: this file → the appendix → `school-data-rearchitecture.md` §13a.
All **five** `plans/school-data-*.md` files (`school-data-v3.md`, `school-data-v3-appendix.md`,
`school-data-v2.md`, `school-data-rearchitecture.md`, `school-data-field-catalog.md`) are committed
at Phase 0 (an untracked plan is one `git clean` from gone) and graduate together to
`specs/school-data-v3/` at Phase 5.

---

## 0. Owner decisions (cumulative, do not re-litigate)

| # | Decision |
|---|---|
| D1 | Structured school data = identity profile (`cds_library.schools.basic_profile`, IPEDS HD2024, 2,746 rows, unchanged) + **CollegeData, every field, every school on the site** — measured: **2,587 school slugs** (2,593 `/college-search/` slugs across `a-`/`b-sitemap` minus the six non-school pages `help`, `michigan`, `ohio`, `pennsylvania`, `texas`, `virginia`; one duplicate listing), re-scraped daily with change detection. Delivered as every school that maps to an IPEDS institution (§4.6 states the narrowing; §8 asks the owner to ratify it). Nothing else. |
| D2 | **No RAG, no CDS corpus, no CDS packets, no manifest at runtime.** The CDS PDF plays no role in the product for now. |
| D3 | Scraped facts are **Counselle's own data**: no source label, no tier, no attribution to students. Lineage (snapshot → label → fact) is kept internally. |
| D4 | Facts page keeps the six reader sections; every CollegeData label maps into them; unfilled = "Not reported". Deadlines from CollegeData are shown. No CDS anything on the page. |
| D5 | Explore filters: whatever CollegeData (plus the IPEDS profile) supports, server-side, best UX. |
| D6 | The agent reads facts through tools: `resolve_school`, `get_school_profile`, `get_facts` (new), `query_database` (over the new views). `get_domain` and the stdio MCP child are deleted. Citations: `db` (no tier, no evidence) + `web|edu|reddit`. |
| D7 | Scraping is free: httpx-class fetching, no paid services, no browser. Embeddings/Gemini are not used anywhere in this plan; **no LLM anywhere in ingestion** (the one-off crosswalk adjudication is a reviewed, committed CSV, not a runtime step). |
| D8 | The **CDS management + extraction system is parked, preserved for the future**: code stays in-tree and importable, unit tests keep passing, nothing is mounted or started, its live tables are removed, and **its DDL and its data are both preserved** (§3.5). |
| D9 | Nothing in the database beyond `cds_library.schools` is worth keeping for the product → nuke **both schemas** and rebuild from a new seed + a clean yoyo ledger, **after a restore-verified full dump copied off the workstation** (§7 Phase 0). No compatibility shims for old session/transcript shapes. Three roles / three DSNs unchanged. |
| D10 | Distributions (GPA/SAT/ACT bands, selection factors, class sizes, ethnicity) are stored structured for the future chancing engine. **No composite is ever synthesized** from them (R14). |
| D11 | Best prebuilt tools; never reinvent the wheel — **and never adopt a framework whose defaults must be disabled one by one** (that is how Q1 was decided, §2). |
| D12 | **Admin dashboard (owner, 2026-09-05):** a minimal bird's-eye view of scraping — last pass (when, outcome, duration), next scheduled pass, pages fetched/changed/failed, schools covered vs total, per-tab failures, unmapped labels, crosswalk gaps, per-pass history. One screen, replaces the CDS admin nav entry. |

---

## 1. Target architecture

```
  collegedata.com JSON ──► crawl worker (in-process, flag-gated, daily) ──► page_snapshots (immutable, hash-diffed, retained ×3)
                                     └──► mapper (config/assets/facts_keys.yaml + facts_sections.yaml, versioned)
                                            └──► school_facts (SCD2)  ──► school_explore_rows (wide) ──► fact_coverage_counts
  writer role: cds_library_app / COUNSELLE_DB_PIPELINE_DSN     reader role: cds_library_reader / COUNSELLE_DB_RO_DSN
  reader views (exactly six): school_profiles · current_school_facts · school_facts_sql · school_explore · school_data_status · fact_coverage
  agent (in-process PydanticAI tools): resolve_school · get_school_profile · get_facts · query_database
  HTTP: GET /v1/schools/{unitid}/facts · GET /v1/schools/explore · GET /v1/schools/majors
        GET /v1/admin/facts/status · GET /v1/admin/facts/unmapped · POST /v1/admin/facts/passes
        GET /v1/config/public (unauthenticated; the sign-in reset notice date only)
  parked (flag off, unmounted, no live tables, data dumped): domain/cds · app/cds · adapters/cds_* · api/routes/cds_admin.py
        · config/cds · counselle_db/packets.py · frontend features/cds-admin · deploy/seed/parked/*
```

Schema name stays `cds_library` and the writer DSN name stays `COUNSELLE_DB_PIPELINE_DSN`
(renaming touches every DSN, grant, doc, test for zero value; ADR 0037 says so, and
`docs/DATABASE_GUIDE.md` §1 says "pipeline" now means the facts crawler).

Layers (ADR 0017, inward only): `domain/facts/` (pure normalization + state + period parsing,
mypy-strict, purity-gated) ← `app/facts/` (crawl orchestration, mapper, services, jobs) ←
`adapters/collegedata/` + `adapters/facts_store.py` (HTTP + asyncpg writes) ← `api/routes/`.
**Every RO-pool read is *executed* in `counselle_db/service.py`** (`get_facts`, `explore`,
`majors`, beside `resolve_school`/`get_school_profile`), reached from `app/` through the one
sanctioned ADR 0017 deviation (`app/workspace/service_reference.py:10` is the precedent);
`app/facts/service_explore.py` *builds* the explore statement and owns the exclusion accounting but
executes nothing. Module manifest: appendix J-(i).

---

## 2. Tool choices

| Concern | Choice | Rejected (measured, appendix A) |
|---|---|---|
| Fetching | **asyncio + `httpx` (already a direct dep, 0.28.1) + `tenacity` (already resolved in `uv.lock` via pydantic-ai; promoted to a direct `pyproject.toml` dependency — zero new resolved packages)** — one ~200-line `adapters/collegedata/fetch.py`: sitemap parse with stdlib `gzip` + `xml.etree`, one token bucket at `facts_crawl_rps` shared by `facts_crawl_concurrency` (default 1) schools in flight, tenacity retries on 502/503/connection reset, per-request `facts_crawl_request_timeout_s`, a self-identifying `User-Agent` (`facts_crawl_user_agent`, default `CounselleBot/1.0 (+https://<domain>/bot)`, boot-validated to contain a URL), redirects followed only on the HTML buildId read. Returns a typed `FetchedPage`; no `Any` escapes the adapter. Robots: `robots.txt` allows `/_next/data/` and disallows only `/api/*` and HubSpot paths (re-verified 2026-09-05); the fetcher never touches `/api/*`. | **Crawlee 1.10.0** — rejected on evidence: its `SitemapRequestLoader` default drops every school URL (sitemap on `www.`, all `<loc>`s on `stg.`; the filter runs before the rewrite hook), `BasicCrawler.run()` **removes the event loop's SIGINT handler and never restores it** (proven; breaks uvicorn graceful shutdown after the first pass), its default client impersonates Firefox and rotates sessions to evade blocks (the wrong posture next to R0), its `httpx` extra now resolves to the unrelated `httpx2` package, and 404 is retried as transport error. Scrapy (Twisted, second process), Firecrawl/Apify (paid), Playwright (no JS needed), `curl_cffi`/`rnet`/`scrapling`/`botasaurus` (evasion tooling; CollegeData serves bare curl). |
| Parsing | pydantic models for the typed `bodyContent` tree (nine node types, closed key sets — appendix E-i) **plus the `pageProps.profile` header scalars** (36 keys; 34 excluding `id`/`slug` — appendix E-ii §H). No HTML parsing. | bs4/selectolax. |
| Change detection | sha256 of canonical JSON (stdlib `json.dumps(sort_keys=True, separators=(',',':'))`) of `pageProps.profile` with `chance` dropped first (it is `null` logged-out and session-derived if ever populated). Verified byte-identical across fetches ~8 h apart, so snapshots grow only on real changes. `pageProps` holds nothing else but `profile` and an `isStateList` render flag. `If-None-Match` is ignored by the server (re-verified), sitemap `lastmod` is uniform. | conditional GET, visual diff. |
| Scheduling | `app/facts/jobs.py` **copies the shape** of the parked `app/cds/jobs.py` lease loop (boot sweep, claim `FOR UPDATE SKIP LOCKED`, lease renew at lease/3, transient-error survival, loud crash log) against `facts_jobs`; **drops the semaphore** (the partial unique index already guarantees one pass) and **re-queues instead of failing forward on sweep** (§4.2 — the one deliberate divergence from `adapters/cds_store.py:636-647`); the parked module is neither imported nor edited (D8). The daily enqueue is one idempotent `INSERT … WHERE NOT EXISTS … ON CONFLICT DO NOTHING` run on every idle tick (appendix J-iii) — no timer state, no APScheduler. Runs **in-process** behind `COUNSELLE_FACTS_WORKER_ENABLED` (default **false**), started/stopped from the FastAPI lifespan where `start_cds_worker` was (ADR 0023 one-deployable intact). | Celery/Redis, APScheduler, cron-only, a second Render service. |
| Filters | `school_explore_rows` wide table (metrics + the IPEDS-derived filter columns projected from `basic_profile`; identity joined from `schools` in the view), upserted per school in that school's facts transaction; `school_explore` is the reader view. | materialized view (cannot be upserted per school; `REFRESH` needs an owner role nobody provisions), client-side filtering over a fixture array (today). |
| Agent tools | in-process PydanticAI `Tool()` closures over `counselle_db/service.py` on the RO pool, following **`app/toolset.py:216-238`'s** closure + `process_tool_result(…, tool_name=…)` + `Tool(fn, takes_ctx=False)` shape: **each tool body mints its own citation** — the MCP `process_tool_call=` hook that mints DB citations today (`app/toolset.py:93-110,135-141`) disappears with the MCP toolset and is not ported. The four tool docstrings move from `counselle_db/server.py:106-212` onto the functions before the file is deleted (appendix F-i has the edited text; its section list is six, not seven — `other` is a group). | keeping the stdio MCP child (no consumer but us). |
| Crosswalk matching | one-off `scripts/build_crosswalk.py` on **`COUNSELLE_DB_APP_DSN`** (the `counselle` schema owns `pg_trgm`, §3.4; `app/workspace/service_tasks.py:58` is the precedent — no Python reimplementation of `similarity()`), reusing `counselle_db/catalog.py::normalize_school_name` and its abbreviations asset (**no second name normalizer**): exact name+state → name+state+city → trigram ≥0.9 within state → trigram ≥0.6 + same city/zip → token containment + same city/zip → single candidate ≥0.45 + same city/zip → **≈320-row** subagent adjudication with a 3-candidate shortlist each (measured on a 283-slug random sample: 87.6% automatic). Output: `config/facts/collegedata_crosswalk.csv` (`slug,unitid,method,matched_at,note`), committed; **`app/facts/crosswalk.py` is its only loader** — the seed creates `collegedata_schools` empty and `python -m app.facts crosswalk-sync` (run by `dev.py reset-db` and the Phase 4 bootstrap) upserts the CSV; a Phase 1 test asserts every CSV `method` is in the `match_method` CHECK set. | `college-search.json?page=N` — **does not paginate** (returns the same 20 rows for every page; real paging is under robots-disallowed `/api/*`); a runtime LLM step. |

---

## 3. Schema v3 (`cds_library`, new seed; only `schools` survives)

### 3.1 Tables (nine relations: `schools` + eight new)

Shown as readable pseudo-DDL: **every `UNIQUE` shown with a `WHERE` clause or over an expression is
a `CREATE UNIQUE INDEX`, not a table constraint** — PostgreSQL has no partial *or expression* unique
constraints, so `UNIQUE (school_id) WHERE retired_at IS NULL` and `UNIQUE (lower(slug))` are both
indexes, while plain `UNIQUE (…)` over bare columns (`collegedata_id`,
`(school_id, tab, content_sha256)`) stays a constraint, which is what `ON CONFLICT` infers against.
Everything else was parsed as-is on PostgreSQL 16 (re-verified round 6: the whole block compiles with
the uniques rendered that way, including the `tab_name` domain, the `num_nonnulls` CHECK, the
cross-column `reported_period_year` CHECK, the `ON DELETE RESTRICT`/`SET NULL` edges, the
`(status='running') = (finished_at IS NULL)` CHECK and the `jsonb_object_agg` view shape).
The six tab names are declared **once**, as an `IMMUTABLE PARALLEL SAFE` SQL function
`cds_library.tab_names() RETURNS text[]`; the domain `cds_library.tab_name` is
`CHECK (VALUE = ANY (cds_library.tab_names()))` (both verified on PostgreSQL 16), the three tab
columns use the domain, and `school_data_status` defaults its six keys with
`unnest(cds_library.tab_names())` rather than a second array literal — a domain is a CHECK over a
scalar, so its members cannot be enumerated from the catalog in a view, and the view must default
every tab (`school_pages` holds a row only after an attempt). Without the function the vocabulary
would exist twice in one file with nothing asserting they agree, and a renamed tab would silently
drop a contributor from exactly the input §5.2's `fetch_state` and §5.1's
`not_fetched`/`not_published` are computed from. A Phase 1 test asserts `TabName` in
`app/facts/models.py`, `tab_names()`, and the key set of `school_data_status.tabs` for a school with
no `school_pages` rows are all the same six strings.

```sql
schools               -- unchanged (IPEDS unitid PK, basic_profile jsonb, search_name, aliases, official_domain,
                      -- profile_sha256 CHECK octet_length = 32); the schools_projection_matches trigger validates
                      -- every row; writer gets SELECT only (the mapper reads name/state/basic_profile), never INSERT/UPDATE/DELETE

collegedata_schools   (slug text PRIMARY KEY,           -- sitemap TitleCase slug; request path uses lower(slug), ?slug= keeps original
                       collegedata_id int NULL, name text NULL, city text, state text, zip text,   -- filled by the first successful fetch (§4.6);
                                                                                                   -- the crosswalk CSV carries identity resolution only
                       school_id int NULL REFERENCES schools(id),
                       match_method text NOT NULL CHECK (match_method IN ('exact','exact_city','trigram','trigram_city',
                                                                          'token_city','single_city','manual','unmatched')),
                       matched_at timestamptz, note text NULL,
                       first_seen_at timestamptz NOT NULL DEFAULT now(),
                       last_seen_in_sitemap_at timestamptz, retired_at timestamptz NULL)
  UNIQUE (school_id) WHERE retired_at IS NULL           -- one live slug per unitid (multi-campus systems: main campus wins, §4.6)
  UNIQUE (lower(slug))                                  -- casing is presentation, not identity
  UNIQUE (collegedata_id)                               -- NULLs allowed until first fetch

page_snapshots        (id bigserial PRIMARY KEY, school_id int NOT NULL REFERENCES schools(id),
                       tab tab_name NOT NULL,
                       first_seen_at timestamptz NOT NULL DEFAULT now(), http_status int, build_id text,
                       content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),   -- bytea(32) is not valid DDL
                       body jsonb NOT NULL)             -- = pageProps.profile minus `chance` (exactly what is hashed)
  UNIQUE (school_id, tab, content_sha256)
  INDEX (school_id, tab, first_seen_at DESC)            -- retention: newest N per page
  BEFORE UPDATE trigger → immutable (DELETE allowed, retention only)

school_pages          (school_id int NOT NULL REFERENCES schools(id), tab tab_name NOT NULL,
                       latest_snapshot_id bigint NULL REFERENCES page_snapshots(id) ON DELETE RESTRICT,
                       last_attempted_at timestamptz,   -- every attempt, success or failure (the resume record, §4.2)
                       last_fetched_at timestamptz,     -- last SUCCESSFUL fetch (= observed_at for this page's facts, §3.2)
                       last_changed_at timestamptz,
                       last_status text NOT NULL DEFAULT 'never_fetched'
                         CHECK (last_status IN ('ok','http_error','not_found','build_id_rotated','parse_error','never_fetched')),
                       consecutive_failures int NOT NULL DEFAULT 0,
                       PRIMARY KEY (school_id, tab))
  INDEX (last_status, consecutive_failures) WHERE last_status <> 'ok'      -- admin dashboard

school_facts          (id bigserial PRIMARY KEY, school_id int NOT NULL REFERENCES schools(id),
                       fact_key text NOT NULL,          -- two-segment "<domain>.<name>", stable semantic name (§4.4); never a year/city/code
                       tab tab_name NOT NULL,           -- the page the value came from; freshness joins on (school_id, tab)
                       section text NOT NULL,          -- id from facts_sections.yaml; deliberately no CHECK (one source of truth); mapper rejects unknown
                       label text NOT NULL,            -- the CollegeData label as printed (display only)
                       value jsonb NOT NULL,           -- {"kind": money|percent|count|decimal|bool|enum|text|date|range|list|table|matrix|distribution|address|url|ordinal, "value": …}
                                                       -- an explicit "Not reported" observation is {"kind": <kind>, "value": null} — the column is NOT NULL, the JSON carries the null
                       display text NOT NULL, unit text NULL,
                       value_type text NOT NULL,       -- the `kind` above, denormalized for SQL
                       value_num numeric NULL, value_text text NULL, value_bool bool NULL, value_date date NULL,
                       CHECK (num_nonnulls(value_num, value_text, value_bool, value_date) <= 1),   -- list/table/distribution project to none
                       reported_period text NULL,      -- verbatim from the label/section ("2025-26", "2024") or the deadline cycle; never invented
                       reported_period_year smallint NULL CHECK (reported_period_year IS NULL OR reported_period IS NOT NULL),
                       snapshot_id bigint NULL REFERENCES page_snapshots(id) ON DELETE SET NULL,
                       snapshot_sha256 bytea NOT NULL CHECK (octet_length(snapshot_sha256) = 32),   -- lineage survives retention
                       source_path text NOT NULL,      -- "<tab>/<section title>/<divider>/<node type>[#<ordinal>][/<row>[/<col>]]" or "<tab>/@profile/<key>[/0|1]"
                       mapper_version text NOT NULL,   -- sha256 prefix of facts_keys.yaml content, never hand-bumped
                       valid_from timestamptz NOT NULL, valid_to timestamptz NULL)
  UNIQUE (school_id, fact_key) WHERE valid_to IS NULL                                  -- facts page + SCD2 guard
  INDEX (fact_key, value_num) WHERE valid_to IS NULL AND value_num IS NOT NULL        -- cross-school ranking
  INDEX (fact_key) WHERE valid_to IS NULL                                             -- coverage refresh, non-numeric lookups
  INDEX (snapshot_id)                                                                 -- retention referential check
  -- deliberately NO index over valid_to IS NOT NULL: history is written now, read by nothing yet (§5.6)

school_explore_rows   (school_id int PRIMARY KEY REFERENCES schools(id),
                       <the ~100 typed nullable columns in appendix E-iv MINUS its identity columns (name/city/state/website_url,
                        which the view supplies from `schools`): CollegeData metrics PLUS the IPEDS-derived filter columns the mapper
                        projects from schools.basic_profile — region, locale, control, institution_level, gender_model,
                        religious_affiliation, hbcu, hsi, tribal, land_grant — **`size_bucket` is
                        deliberately NOT among them**: §5.3 derives it from the crawled
                        `students.undergraduate_total` alone and the appendix's
                        `basic_profile.classification.institution_size` fallback is dropped (IPEDS's
                        five bands do not nest inside the shipped four; 1,190 of 2,746 seed rows
                        straddle a boundary), so the column is null until the school is crawled and
                        its exclusion chip reads `missing`, never `not_reported`>,
                       majors text[] NULL, sports_women text[] NULL, sports_men text[] NULL, special_programs text[] NULL,
                       facts_updated_at timestamptz NOT NULL, mapper_version text NOT NULL, retired_at timestamptz NULL)
  -- NO secondary index at all: ~2,587 rows ≈ 70 pages; a seq scan wins for every filter incl. the majors containment
  -- (measured 0.7 ms; `= ANY` is not GIN-indexable anyway). Add GIN only if the table ever passes ~50k rows.
  -- The ONE stored derived ratio is `need_fully_met_pct` (`aid.need_fully_met_all_undergraduates`
                              --   ÷ `aid.received_all_undergraduates`, appendix E-iv) — computed by the mapper because
                              --   neither count is itself an explore column (§5.3).
                              -- `undergraduate_full_time` IS a column (appendix E-iv omits it and is overridden here):
                              --   undergraduates-per-full-time-faculty is computed in the explore SQL from it and
                              --   `faculty_full_time`, and BOTH inputs must be visible on `school_explore` (§5.3);
                              --   `students_per_faculty` itself is never a column;
  -- NO sat_total_* columns ever (R14).

fact_coverage_counts  (fact_key text PRIMARY KEY,        -- "<domain>.<name>" rows AND "explore.<column>" rows (§6a)
                       schools_with_value int NOT NULL, schools_total int NOT NULL, computed_at timestamptz NOT NULL)
                      -- rewritten at the end of every pass in the transaction that closes crawl_runs: INSERT … ON CONFLICT (fact_key)
                      -- DO UPDATE for every key present, then UPDATE … SET schools_with_value = 0 WHERE computed_at < <this pass>
                      -- (the writer has no DELETE grant by design: a retired key is zeroed, never removed); ~450 rows

facts_jobs            (id bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('crawl_pass','remap')),
                       status text NOT NULL CHECK (status IN ('queued','running','done','error')),
                       queued_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
                       lease_expires_at timestamptz, error_code text, error_message text)
  UNIQUE (kind) WHERE status IN ('queued','running')   -- never two concurrent passes; enqueue is ON CONFLICT DO NOTHING
  INDEX (lease_expires_at) WHERE status = 'running'    -- the sweep

crawl_runs            (id bigserial PRIMARY KEY, job_id bigint REFERENCES facts_jobs(id),
                       status text NOT NULL CHECK (status IN ('running','succeeded','partial','failed','aborted')),
                       started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz NULL,
                       CHECK ((status = 'running') = (finished_at IS NULL)),
                       error_code text, error_message text,
                       build_id text, build_id_rotations int NOT NULL DEFAULT 0,
                       sitemap_slugs int, crosswalk_matched int, crosswalk_unmatched int, schools_seen int,
                       pages_fetched int NOT NULL DEFAULT 0, pages_changed int NOT NULL DEFAULT 0, pages_failed int NOT NULL DEFAULT 0,
                       failures_by_kind jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {http_error, not_found, build_id_rotated, parse_error}
                       facts_changed int NOT NULL DEFAULT 0, snapshots_pruned int NOT NULL DEFAULT 0,
                       rate_backoffs int NOT NULL DEFAULT 0,
                       unmapped_label_count int NOT NULL DEFAULT 0,
                       unmapped_labels jsonb NOT NULL DEFAULT '[]'::jsonb)   -- bounded sample: top facts_admin_unmapped_limit by frequency, sorted
  INDEX (started_at DESC)
```

Two extra relations vs the third round: `fact_coverage_counts` (a plain `GROUP BY` view over ~800k
current rows would aggregate on **every** `query_database` call; the counts are no staler than the
facts they describe — a 1.17M-row rewrite measured 299 ms) and the renamed `facts_jobs` (a table
named `jobs` beside the parked `cds_extractions` queue, in a schema still called `cds_library`, would
be ambiguous the day CDS is revived; the column vocabulary matches `cds_extractions` exactly).

### 3.2 Views granted to `cds_library_reader` (exactly six)

- `school_profiles` — unchanged.
- `current_school_facts` — `school_facts WHERE valid_to IS NULL`, all columns including `value jsonb`,
  **plus `observed_at` = `school_pages.last_fetched_at`** joined on `(school_id, tab)`. Used only by the
  typed `get_facts` service function; **not** on the `query_database` allow-list.
- `school_facts_sql` — the same rows with `school_id, fact_key, label, section, tab, value_type, unit,
  display, value_num, value_text, value_bool, value_date, reported_period, reported_period_year,
  observed_at` and **no `value jsonb`** — the only facts relation `query_database` may touch.
- `school_explore` — `school_explore_rows r JOIN schools s ON s.id = r.school_id WHERE r.retired_at IS NULL`,
  supplying `name, city, state, official_website, official_domain` from `schools` (identity stays
  single-sourced and trigger-validated, D1) plus every metric and projected column.
- `school_data_status` — per school: `has_collegedata` (a live crosswalk row), `facts_updated_at`
  (`max(last_fetched_at)` over the school's `ok` tabs), `fact_count`, and **`tabs jsonb`** (consumed by §6a's `SchoolFactsStatus`, the agent's `resolve_school` result and the
  admin dashboard — **not** by the facts response, which dropped it: the page decides everything
  through the per-section `fetch_state` and the per-fact `state`) =
  `jsonb_object_agg(tab, last_status)` over `school_pages` defaulting each of the six tabs to
  `'never_fetched'` — the hyphenated tab names are data, never identifiers, and the wire shape (§6a's
  `SchoolFactsStatus`, the agent's `resolve_school` result) is the column verbatim.
- `fact_coverage` — `fact_coverage_counts` as-is (`fact_key, schools_with_value, schools_total,
  computed_at`; the `query_database` result exposes `computed_at` as `as_of`). **`schools_total` = the
  number of schools with a live crosswalk row**, not 2,746: the ~500–800 unitids with no CollegeData
  page (R6) are "Not collected", never part of a denominator.

**`observed_at` is derived, not stored.** A fact's "last confirmed present" time is
`school_pages.last_fetched_at` (last *successful* fetch) for the `(school_id, tab)` its snapshot came
from — one row per page instead of one per fact (~800k dead tuples per day for unchanged data).
Every consumer (`facts_updated_at`, `stale_facts`, `observed_at_spread`, the page freshness line)
reads a column named `observed_at` from the views with exactly that meaning. A failed attempt
advances `last_attempted_at` only, so a fetch failure never refreshes a fact's date.

All six views are **owner-owned with `security_invoker` off** (the PG default; verified live on all
five current views). That is the whole reason the reader can read them while holding zero grants on
any base table. Never add `WITH (security_invoker = true)` to a reader view; never grant the reader a
base table to "fix" a missing column.

### 3.3 Grants (the seed is the single source of every object grant)

- `cds_library_reader`: `USAGE` on schema, `SELECT` on exactly the six views. Session defaults
  unchanged (`default_transaction_read_only=on`, `statement_timeout=8s`, `search_path=cds_library, pg_catalog`).
- `cds_library_app`: `SELECT` on `schools`; `INSERT, SELECT, UPDATE` on **all eight** new tables (`collegedata_schools`, `page_snapshots`,
  `school_pages`, `school_facts`, `school_explore_rows`, `fact_coverage_counts`, `facts_jobs`,
  `crawl_runs` — §3.3 is the single source of every object grant, so an implementer working from a
  short list here would ship a crawler that hits `permission denied` at Phase 1 runtime, past the
  Phase 0 gate); `DELETE`
  on `page_snapshots` only (retention); `USAGE` on every sequence (`nextval()` needs `USAGE`; today's
  writer works only because of a live-only `ALTER DEFAULT PRIVILEGES` row the seed lacks; the new
  seed's row is `GRANT USAGE ON SEQUENCES` — not today's `rU`).
- Default privileges `FOR ROLE cds_library_owner IN SCHEMA cds_library` for tables (`arw` to the
  writer) and sequences (`U`), shipped in the seed.
- **Who runs the seed:** `COUNSELLE_DB_ADMIN_DSN`; the seed's first statements are
  `GRANT cds_library_owner TO CURRENT_USER WITH SET TRUE; SET ROLE cds_library_owner;` so every object
  is owned by `cds_library_owner` exactly as live objects are and the default-privilege rows govern
  future objects (managed providers hand the admin the grant with `SET` disabled — same trick as
  `seed_reader_db.py:151-155`). `scripts/setup_db.sql` creates `cds_library_owner NOLOGIN` (missing
  today) and `cds_library_app` (never provisioned on prod today) **before** the seed runs, and stops
  granting objects: it owns **roles** (create/reconcile, passwords, session defaults); the seed owns
  **objects** (schema, tables, views, triggers, functions, every `GRANT`, the default-privilege rows).
  `seed_reader_db.py` executes the seed and deletes its own `READER_TABLES` and
  `_grant_reader_contract` — after that it names no views. **One owner for the view list** —
  `deploy/seed/cds_library_schema.sql` — and a new `tests/test_view_contract.py` asserts the six view
  names parsed from the seed equal the list in `scripts/finish_supabase_staging.py:73-79` and the
  list in `docs/DATABASE_GUIDE.md` §1.

### 3.4 Extensions, triggers, immutability, write rules

- **Extension placement is contractual:** `vector` must live in `public`
  (`migrations/0003_field_index.sql:16` writes `public.vector(768)` on every fresh chain; `0012` drops
  the table but not the extension) and `pg_trgm` must be reachable from `counselle_app`'s
  `search_path = counselle, pg_catalog` — live it sits in schema `counselle` because `0009` created it
  under yoyo's `?schema=counselle`. A bare `CREATE EXTENSION pg_trgm` from the admin connection lands
  it in `public`, `0009`'s `IF NOT EXISTS` no-ops, and `similarity()` in
  `app/workspace/service_tasks.py:58,60` / `app/workspace/agent_tools_shared.py:444-446` stops
  resolving — silently, since boot never calls it. The bootstrap therefore runs
  `CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;` and
  `CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA counselle;` (after creating the schema), and
  `seed_reader_db.REQUIRED_EXTENSIONS` becomes `(("pg_trgm","counselle"),("vector","public"))`.
  Dev image: `pgvector/pgvector:pg16` (verified: ships `pg_trgm` too). Nothing in `cds_library`
  uses `pg_trgm` (§2 crosswalk runs on the app DSN; §5.3 majors uses `ILIKE`).
- **Triggers in the seed:** `schools_projection_matches` + `reject_school_projection_mismatch()` —
  **captured from the live catalog with `pg_get_functiondef`/`pg_get_triggerdef` in Phase 0 step 1
  and written into the v3 seed; they exist nowhere in the repo today** (verified: zero occurrences;
  `deploy/seed/cds_library_schema.sql` has zero `CREATE TRIGGER`) — plus `page_snapshots_immutable`
  and its function, and the `is_sorted_distinct_text_array()` CHECK helper (already in the seed). The
  three `cds_*_immutable` functions are captured the same way into the parked file (§3.5).
- **SCD2 write order** is close-then-insert inside one transaction per school (a partial unique index
  cannot be deferrable). **A fact that disappears from CollegeData is closed — scoped to changed
  tabs:** the mapper runs over every tab fetched `ok` this pass whose body **changed** (an unchanged
  body cannot have gained or lost a label). Any current fact whose `tab` is in that changed set and
  whose `fact_key` is absent from the new set for that tab gets `valid_to = now()` with no
  successor. Facts on tabs that were `ok` but unchanged, and facts on tabs whose `last_status` is
  not `ok`, are left untouched — neither an unchanged page nor a fetch failure is ever read as a
  withdrawal. **Diff rule:** a row is closed only when `(fact_key, value)` changes; a change in
  `display`, `unit`, `mapper_version`, `source_path` or `snapshot_id` alone is an in-place `UPDATE`
  of the current row (otherwise a mapper bump would churn the whole history table).
- **Snapshot revert:** `INSERT … ON CONFLICT (school_id, tab, content_sha256) DO NOTHING RETURNING id`
  returns no row on conflict; the writer re-`SELECT`s the existing id (`ON CONFLICT DO UPDATE` is
  rejected by the immutability trigger) and repoints `school_pages.latest_snapshot_id`.
- **Retention runs inside the pass:** after each changed page's snapshot write, delete all but the
  newest `facts_snapshot_retention_per_page` (**3**) snapshots for that `(school_id, tab)` that are
  neither `school_pages.latest_snapshot_id` (blocked by `ON DELETE RESTRICT` anyway) nor referenced
  by any `valid_to IS NULL` fact. Historical facts keep `snapshot_sha256 + source_path` after their
  snapshot row is reaped (`ON DELETE SET NULL`), so lineage (D3) survives; only the body goes.
  Count deletions in `crawl_runs.snapshots_pruned`.
- **Two running passes are impossible:** the partial unique index prevents two *queued/running rows*;
  a pass additionally takes `pg_try_advisory_lock(hashtext('facts_crawl_pass'))` (non-blocking — the
  blocking form would wait up to a whole pass) on its own connection for its whole duration, pinning
  one of the `db_pool_max` (5) pipeline connections; a worker that cannot take the lock marks its
  claim `error` with `error_code='pass_already_running'` and returns. **The one reachable contention
  path is narrow and must not be mis-stamped:** because the partial unique index leaves at most one
  queued/running row and a `running` row is not claimable, the only way two workers hold claims on one
  pass is the sweep re-queueing a row whose original worker is alive but slow. In that case the
  **newcomer** returns `pass_already_running` and the original keeps the lock and the run — the
  newcomer never stamps `error` on a `crawl_runs` row that then succeeds.

### 3.5 Parked DDL and parked data (D8 means data too)

- `deploy/seed/cds_library_schema.sql` (today's declared source of record, 465 lines) is **rewritten
  in place** as the v3 live seed (this section). Its CDS objects — the seven CDS tables
  `cds_documents`, `cds_domain_packets`, `cds_extractions`, `cds_manifests`, `cds_school_years`,
  `ct_index_entries`, `ct_index_state` (the last two are empty live but are in the seed and in
  `scripts/setup_db.sql:141-142`), the five CDS views, `is_sorted_distinct_text_array` where CDS
  needs it — move verbatim to `deploy/seed/parked/cds_extraction_schema.sql`, **completed** from a
  live-catalog diff with what the file is missing today (verified: zero `CREATE TRIGGER`, zero
  `GRANT`, zero `ALTER DEFAULT PRIVILEGES`): the three `cds_*_immutable` triggers and their functions
  (captured with `pg_get_functiondef`), the `cds_library_app` grants, the two default-privilege
  rows. It **keeps** the V-01 `cds_documents(school_year_id, pdf_sha256)` partial unique index that is
  not applied live (`TODOS.md`) — a raw `pg_dump` would drop that decided fix — and it excludes the
  retired pipeline repo's stray `cds_library._yoyo_migration` (owned by `postgres`;
  `DROP SCHEMA … CASCADE` takes it). `deploy/seed/schema.sql` (the flat-table staging bootstrap that
  `seed_reader_db.py:107` actually executes today — the file that created `school_profiles` as a
  TABLE and never `schools`) is **deleted**. One DDL file per schema generation, each header naming
  the other.
- **Data:** before the drop, `pg_dump --format=custom --data-only` of the seven CDS tables (including
  `cds_documents.pdf_content` — the four shipped PDFs) to
  `artifacts/school-data-v3/<ts>-cds-preserve/cds_data.dump`, restore-verified into a scratch
  database and **copied off the workstation** (owner's own storage; location recorded in
  `PARKED.md`); row counts and manifest `content_sha256 = 6367c0…4ae` recorded in `PARKED.md`. The
  four `deploy/seed/*cds*.csv.gz` (7.9 MB, already committed) **move to `deploy/seed/parked/`**, not
  deleted — they are the reproducible copy. `specs/cds-pipeline/tuning/` stays (ground truth +
  harness). Without this, "parked, preserved for the future" is hollow: the two untriaged `live_db`
  failures could never be triaged and the owner's pending acceptance would be deciding on evidence
  that no longer exists.
- The `counselle.*` CDS tables from migrations `0015`/`0016` stay (yoyo creates them empty; harmless;
  deleting the migrations would break the ledger for nothing).

---

## 4. Scraper and mapper (`adapters/collegedata/`, `domain/facts/`, `app/facts/`)

### 4.1 Discovery and fetch (re-measured 2026-09-05/06)

- Sitemap: `sitemap_index.xml` → `a-sitemap.xml.gz` (29,066 `<loc>`s, all on `stg.collegedata.com`
  → rewrite to `www.`) + `b-sitemap.xml.gz` (425); **15,534** raw `/college-search/<Slug>[/<tab>]`
  URLs (the rest are scholarship/auth pages — filtered out). The loader **de-duplicates**
  (`Keiser-University-West-Palm-Beach-FL` is listed twice) and **drops every slug that carries no
  tab URLs** — `help` and the five state-list pages `michigan`, `ohio`, `pennsylvania`, `texas`,
  `virginia` (they render `pageProps.isStateList` and have no `profile`); such a slug is never
  crawled and never inserted into `collegedata_schools`. Result: **2,587 school slugs / 15,522 page
  URLs** (exactly 6 per slug). The sitemap universe is authoritative for the crawl; the search list
  is not used (§2). Exact counts are asserted only against a **committed sitemap fixture**, never
  the live site.
- `buildId` from one HTML page **with redirects followed**: `www.collegedata.com/college-search/<Slug>`
  301s to `waf.collegedata.com/college-search/<slug.lower()>` (plain nginx); read `"buildId"` from
  `__NEXT_DATA__`. The JSON route is *not* redirected and stays on `www` (fronted by Azure Front Door
  + WAF, not Cloudflare).
- Six pages per school: **overview is the index route** `/_next/data/<buildId>/college-search/<slug.lower()>.json?slug=<Slug>`
  (the `…/overview.json` form 404s for every school); the other five are
  `…/<slug.lower()>/<tab>.json?slug=<Slug>`. 200 JSON 3–11 KB, no cookie or header needed.
- **Rotation vs not-found:** a 404/HTML body triggers **one** buildId re-read; if the buildId changed,
  count **one distinct transition** (concurrent 404s that resolve to the same new id are one
  rotation, re-read under a lock), retry; abort the pass after `facts_crawl_max_build_rotations`
  (3). If the buildId is unchanged, the 404 is a per-tab `not_found` (University of Phoenix has no
  `money-matters` tab) and does not count. 404 is handled by the fetcher, never retried as transport.
- **Transient failures are normal:** the first request to an uncached page is often 502 (3/3 on
  first try, 3/3 OK on retry in the sample). Retry 502/503/connection-reset with tenacity (up to 4,
  exponential backoff); only a persistent failure sets `last_status='http_error'` and increments
  `consecutive_failures`.
- **Pacing and blocks:** one token bucket at `facts_crawl_rps` (default **1**) shared by
  `facts_crawl_concurrency` schools in flight (default 1, so requests are sequential; **≈4.3 h at one request
  per page — but retries share the same bucket, and at the measured first-try-502 rate on uncached
  pages (3/3, §4.1 below) a cold pass is closer to ≈9 h**, still inside a day. Two rate halvings would
  push a pass past 24 h; that is safe by construction — the enqueue's partial unique index means the
  next day's tick finds a running row and does nothing — but it shows on the dashboard as a skipped
  day, not as an error). 2 req/s = 120/min sits above a common Azure Front Door per-IP template and
  the Terms reserve IP blocking. On any 429/403 the fetcher halves the rate for the rest of the pass
  and counts it in `crawl_runs.rate_backoffs`; three consecutive blocks abort the pass
  (`status='aborted'`, `error_code='blocked'`). No fingerprinting, no session rotation, no evasion —
  ever (R0).
- Throughput: 15,522 requests ≈ 95–101 MB decompressed across the pass; each school's six bodies are
  written inside its transaction, nothing accumulates (peak RSS ≈ `facts_crawl_concurrency` × 6 bodies).
- **New / removed slugs:** slugs new since the last pass are inserted into `collegedata_schools`
  with `school_id = NULL, match_method='unmatched'` and surfaced on the dashboard as *needs
  adjudication*; they are not crawled. Slugs absent from the sitemap for two consecutive passes get
  `collegedata_schools.retired_at` and `school_explore_rows.retired_at` set in the pass transaction
  and their current facts SCD2-closed, so the page falls back to "Not collected" rather than a stale
  value. `last_seen_in_sitemap_at` is the record.
- **Stuck pages:** at `consecutive_failures >= facts_failure_threshold` (3) the page is skipped for
  the rest of the pass (stamped `last_attempted_at` so the school can complete), its facts keep their
  last `observed_at` (never deleted), the page appears in the dashboard's stuck list, and it is
  retried next pass.

### 4.2 Pass shape, transaction boundary, resume (appendix J-iii/iv, as overridden here)

- Per school: fetch all six tabs at the paced rate, then **one transaction per school**:
  `school_pages` upserts (every tab gets `last_attempted_at = now()`; `ok` tabs also get
  `last_fetched_at`; failed tabs get `last_status` + `consecutive_failures`), snapshot inserts +
  repoints, SCD2 close/insert over the **changed** tabs including the set-based close of keys
  withdrawn **from those same tabs**, the `school_explore_rows` upsert, retention pruning. A
  school's explore row spans all six tabs, so per-tab transactions would expose a half-updated row.
  The `db_statement_timeout_ms` default (8 s, applied to every pool by `create_pool`) comfortably
  covers one school's write; the pass never holds a transaction across network I/O.
- Unchanged page (hash equal): `UPDATE school_pages SET last_attempted_at=now(), last_fetched_at=now(),
  last_status='ok', consecutive_failures=0` — **no `school_facts` write at all** (§3.2, §3.4).
- **Resume, not restart:** the sweep is **re-queue, not fail-forward** — the one deliberate
  divergence from `adapters/cds_store.sweep_expired_leases` (`:636-647`, which sets
  `status='failed'`): `UPDATE facts_jobs SET status='queued', started_at=NULL, lease_expires_at=NULL
  WHERE status='running' AND lease_expires_at < now()`, leaving the job's `crawl_runs` row `running`
  for the next claim to adopt. A claim reuses the `crawl_runs` row linked to the job and skips every
  school **all six of whose pages were attempted** (`last_attempted_at >= crawl_runs.started_at`)
  in this run. A pass killed at 50% by a deploy costs ≈50% on resume; counters continue on the same
  run row so the dashboard shows one pass. A pass is only ever closed by the worker that finishes or
  aborts it. Lease seconds ≈ 180 (three renewals), covering liveness, not the pass.
- End of pass, one transaction: rewrite `fact_coverage_counts` (§3.1), retire two-pass-absent slugs,
  close `crawl_runs` (`succeeded` / `partial` when `pages_failed > 0` / `aborted` / `failed`), mark
  the job `done`/`error`. Log one `facts_crawl_pass_finished` event with the full run summary, and a
  `facts_crawl_shape_drift` **error** when `unmapped_label_count > facts_unmapped_alert_threshold` (50).
- `python -m app.facts --once [--limit N]` enqueues **through `facts_jobs`** and runs one claim in the
  foreground (so it cannot run beside a scheduled pass: "already running" exits 0 and writes
  nothing; appendix J-iii's bypass variant is overridden); `python -m app.facts remap` runs the
  identical mapper + SCD2 block over `school_pages.latest_snapshot_id` for every school with no
  network and no `school_pages` writes (the reason snapshots are kept whole); `python -m app.facts
  crosswalk-sync` upserts the CSV into `collegedata_schools`. One `app/facts/__main__.py`, one
  `run_crawl_pass()` shared with the poller.

### 4.3 Where it runs, and every named constant

In-process behind `COUNSELLE_FACTS_WORKER_ENABLED` (default **false** — a brand-new crawler against a
third-party site must be switched on deliberately after staging verification; the CDS worker's
default-on precedent does not apply), started from the lifespan where `start_cds_worker` was. Prod
runs a single uvicorn worker (`scripts/entrypoint.sh:33`, no `--workers`); if that ever changes, the
`facts_jobs` index still bounds correctness to wasted polls. Requires an always-on paid web instance
(`render.yaml:5` is `plan: free` today — owner cost decision, §8) — a free instance sleeps and never
runs a pass. Render's zero-downtime overlap is safe by construction: the outgoing instance keeps
renewing its lease until `stop()`, the incoming one's sweep finds nothing to steal; on real death the
lease expires, the sweep re-queues, and the newcomer resumes mid-pass.

Named constants (all `Settings`, `COUNSELLE_FACTS_*`, no literals; **every one has the consumer
named here**): `facts_worker_enabled=false` (lifespan), `facts_worker_poll_seconds=30` (poller),
`facts_crawl_lease_seconds=180` (claim/renew/sweep), `facts_crawl_rps=1` and
`facts_crawl_concurrency=1` (the token bucket in `fetch.py`), `facts_crawl_request_timeout_s=20`
(the httpx per-request timeout in `fetch.py`), `facts_crawl_interval_hours=24` (the enqueue
statement), `facts_crawl_max_build_rotations=3` (§4.1), `facts_crawl_user_agent` (`fetch.py` +
boot validator), `facts_stale_days=120` (`stale_facts`, `is_stale`), `facts_spread_days=30`
(`observed_at_spread` — 120 is far too loose for "compared at different times"),
`facts_failure_threshold=3` (§4.1 stuck pages), `facts_snapshot_retention_per_page=3` (§3.4),
`facts_unmapped_alert_threshold=50` (§4.2 shape-drift error), `facts_explore_page_size=24`,
`facts_explore_max_page_size=100`, `facts_explore_max_count=3000` (§5.3 — must exceed `browsable_total`, so the cap never binds on a
real corpus; it is a runaway guard, not a display limit), `facts_admin_history_limit=20`,
`facts_admin_unmapped_limit=200` (§5.5), `get_facts_max_rows=60` (§6a), `db_reset_notice_date`
(nullable date) and `db_reset_notice_days=30` (both §5.6, both read by `GET /v1/config/public`). One non-`FACTS_` addition: `max_request_body_bytes`
(`COUNSELLE_MAX_REQUEST_BODY_BYTES`), default **`16_777_216`** = `app/workspace/models.DOCUMENT_MAX_BYTES`
(15 MiB) **plus the 1 MiB multipart headroom `api/context.py:223-225` already documents** — it replaces
the parked `cds_upload_max_bytes` at `api/context.py:228`, and the student document upload is the only
remaining upload path, so the middleware cap must stay **above** that route's own limit: at
`10_000_000` every document between 10 MB and 15 MiB would die in `MaxBodySizeMiddleware` before the
route ran, while `api/routes/documents.py:66-67,152-153` still told the user the limit is
15 MiB (the `max_mb` computation is `:66`/`:152`, the message the user reads `:67`/`:153`). A Phase 0
test posts a `DOCUMENT_MAX_BYTES`-sized document and asserts the route's own 413, not the
middleware's.

### 4.4 Mapper (`facts_keys.yaml`, the typed tree, the header block)

- **Assets live under `config/assets/`** as `facts_keys.yaml` and `facts_sections.yaml`, read with
  the existing `load_yaml_asset` (it resolves `config/assets/<name>.yaml` only, is `lru_cache`d, and
  is coupled into `reset_config_caches()`, whose docstring today reads only "Clear the application and coupled asset configuration caches together." (`config/settings.py:570-571`) — **adding the explicit "never clear only one" warning is part of the Phase 0 edit**; a second
  loader in `app/facts/` would break that invariant). Both are pre-loaded in the lifespan next to
  `step_labels` so a broken file fails at boot. `mapper_version` = the sha256 prefix of the
  `facts_keys.yaml` bytes. `app/facts/crosswalk.py` is the CSV's only loader; its `lru_cache` is
  registered in `reset_config_caches()` beside `load_yaml_asset`'s.
- **Two mapping stages.** `header:` — the 36 `pageProps.profile` scalars (cost of attendance,
  tuition, room & board, supplies, other expenses, headcounts, gender split, control, faculty counts,
  the anchored deadline, contact fields, website — **`identity.description` is not mapped at
  all**: it is deliberately absent from `facts_keys.yaml`'s `header:` stage (**33** declared scalars — 36 keys, minus `id`/`slug`, minus
  `description`; §2's "36 keys; 34 excluding `id`/`slug`" is the pre-exclusion count and appendix
  E-ii §H's "39" heading is overridden), so no `school_facts` row is ever written for it. Free-text editorial prose is the one class of
  value where D3's "our own data" and R0's posture cannot both hold, it is the single most
  copyright-exposed item in the store, and storing it would be a second copy with no reader — dead
  data under §10, enlarging the R0 surface for nothing. `page_snapshots.body` retains it verbatim for
  lineage (§3.1), which is all D3 requires; the identity strip keeps name/city/state/control/website
  from `schools` (IPEDS), as today; the public in-state/out-of-state
  split exists **only** here as 2-element arrays, e.g. UGA `attendanceCost = ['$29,566','$50,410']`)
  with `source_path = <tab>/@profile/<key>[/0|1]`; **a header key populated on more than one tab
  (`website` on all six, `cityPopulation` on `campus-life` and `students`) is declared with exactly
  one owning tab**, the mapper reads it only there, and a Phase 1 test asserts no `fact_key` is
  emitted from two tabs for one school (else the per-school transaction violates
  `UNIQUE (school_id, fact_key)`). `body:` — the nine `bodyContent` node types (`ExpandableSection`,
  `CategoryDivider`, `TitleValue`, `TitleLink`, `NestedTitleValue`, `LabeledTable`, `IconTable`,
  `BarGraph`, `SubscreenNavigator`; closed key sets verified across 11 captures) plus the academics
  tab's `headerCardContent`, a body-shaped array walked the same way. Without the header stage the
  whole Money section would render empty.
- **Stable keys, not literal paths and not ordinals.** The same table sits under different
  `CategoryDivider`s per school, section titles carry optional years, `TitleValue` titles embed the
  city ("Athens Population"), row labels embed values ("FAFSA Code is 001598"), `BarGraph` titles are
  `''`, `'Not reported'`, `'ACT Math:  28'` or `'SAT Math: 740-790 range of middle 50%'`, and the same
  fact is a `TitleValue` at one school and a `BarGraph` at another; **ordinals within a section shift
  by 1–3 positions across schools** (Phoenix omits `Application Fee`, SAITC has no wait-list rows).
  So a `facts_keys.yaml` entry is keyed by `(tab, ExpandableSection.title, CategoryDivider.value,
  node_type)` — **the divider is a hard qualifier** — plus a `match:` regex with named captures on
  the node's own title/label; `ordinal_within_divider` is a **last-resort** discriminator allowed
  only where the divider's node sequence is fixed by construction and must be declared
  `ordinal_ok: true` so it is greppable. **A named capture is never part of the `fact_key`** — it
  becomes a value (`fafsa_code`, `city`), a `reported_period`, or a sibling fact (the p25/p75/avg
  parsed from a `BarGraph` title) — and one `fact_key` may be produced by more than one node type.
  The score graphs are the worked example: within `ACT Scores of Enrolled Freshmen`, a title with an
  `ACT Math:`/`ACT Eng:` prefix keys the subscore and a title with no prefix (including `''` and
  `Not reported`) keys the composite — never position. Phase 1 tests: no `fact_key` matches `\d{4}`
  or a state/city token; a fixture with an intermediate node removed produces the **same
  `fact_key`s** for every node still present.
- **`value_shape` per key** (`scalar | list | labelled_pairs | address | dual_merit`) replaces positional
  splitting of `TitleValue.value` arrays (measured lengths 1–14; the same array means a list, parallel
  labelled facts, an address, or a two-fact pack whose arity varies by school). `dual_merit` is parsed
  by sentence pattern, never by index.
- **Node → normalization** (appendix E-i, the full table): `LabeledTable` whose `valueTitles` are an
  importance scale and whose rows carry one `X` → **ordinal** (`value_num` 0–3 + code); `IconTable`
  (`check|dollar|null` grid with repeated column titles: sports by gender, 4-col intercollegiate =
  offered+scholarship per gender, 2-col club) → **matrix** (one list fact per table; a `null` cell is
  `false`, "not offered"); every other `LabeledTable` → **table**; `BarGraph` → **distribution** with
  the D10 shape `{"kind":"distribution","scale":…,"unit":…,"buckets":[{label,lo,hi,pct|null,absence?}],
  "omitted_buckets":[…],"sums_to":…}` where `-1` → `pct: null, absence: "not_reported"` and an absent
  bucket is listed in `omitted_buckets`, **never invented as 0**; `SubscreenNavigator` → list +
  count; `NestedTitleValue` → parent + children with a dimension suffix (`_women`, `_men`,
  `_need_based_gift`); money/percent/count/decimal/bool/enum/date/range/address/url/text scalars by
  the regexes in appendix E §7 (all deterministic; the 180 free-text values are genuinely text/list).
- **Absence is one rule, five states** (§5.1): `school_facts` holds only labels actually observed —
  an explicit "Not reported"/"Not Reported"/"Not available"/"—"/"" is a real observation stored as
  `value = {"kind": <kind>, "value": null}`, all four typed columns null, **`display` keeping the word
  the source printed** in sentence case ("Not reported", "Not available"; an empty string or a dash
  renders "Not reported") — one state, never a word the source did not use; a key listed in
  `facts_sections.yaml` with no row is rendered "Not reported" by the reader, **never stored**
  (materializing ~650k null rows would also make `fact_coverage` meaningless).
- **Unmapped labels** are stored as `fact_key = 'unmapped:<source_path>'`, `section` = the tab's
  natural section, counted per run, listed on the admin dashboard, and **never rendered to students**
  (a raw `unmapped:...` label on a student page is the opposite of the design voice). The facts page's
  "Other published values" group shows only keys that are in `facts_keys.yaml` but not in
  `facts_sections.yaml` (normally none); a group with zero facts is not rendered.
- **`reported_period`:** exactly three year-bearing markers exist site-wide — the anchored regular
  deadline, the optional section title "Profile of 2025-26 Financial Aid" (which **propagates to every
  descendant fact** unless the fact carries its own), and "…of 2024 Graduates". Nothing else sets it;
  `description` prose is excluded. `reported_period_year` is the period's start year.
- **Deadlines:** only the regular deadline is anchored, and only on the **admission** tab's header
  (`admissionDeadlineDate = "2027-01-02"`; null on the other five tabs); bare month-day deadlines
  occur on `admission` **and** `money-matters` ("Application Deadline: January 1"). Rule:
  `cycle_year := YEAR(admission.admissionDeadlineDate)` is the anchor for every deadline fact on any
  tab; when the admission tab was not fetched `ok` this pass the anchor is taken from the current
  stored `deadlines.regular` fact, and if there is none no bare month-day is anchored (`value_date`
  NULL, `display` verbatim, no `reported_period`). A bare month-day resolves to `cycle_year − 1` for
  August–December and `cycle_year` for January–July; every anchored deadline fact gets
  `reported_period = "{cycle_year−1}-{cycle_year mod 100}"` (e.g. `2026-27`). When
  `admissionDeadlineDate` is null (`"Rolling"`), `value_date` stays NULL, `display` carries the
  literal, and `admissions.regular_deadline_is_rolling = true` is emitted so "deadline before date"
  can include/exclude rolling schools explicitly.
- Fact-key domains: `admissions.`, `class_profile.`, `applying.`, `deadlines.`, `costs.`, `aid.`,
  `money.`, `academics.`, `faculty.`, `class_size.`, `campus.`, `students.`, `outcomes.`, `identity.`
  (identity strip only). Two segments always (`app/viz.py` cell grammar). Full inventory: appendix
  E-ii. **No key is ever a sum of two percentile facts** (R14).

### 4.5 Fixture captures and the mapper test

`tests/fixtures/collegedata/<Slug>/<tab>.json` for **eleven** slugs, each chosen to break something
(appendix E-vi): Yale (baseline; REA-only, all-`-1` GPA bars), University of Georgia (in/out-of-state
arrays, 7-bucket graphs, both sports tables, `Athletic Conferences`, `State Loans`), Santa Monica
College ("Profile of  Financial Aid" with no year, class size as `TitleValue`, rolling notification),
University of Phoenix (for-profit, `"Rolling"` with null date, **no `money-matters` tab**), School of
the Art Institute of Chicago (ACT graph titled "Not reported"), Spelman College (women-only, both ED
and EA, `History` HS-unit row), Ohio State (branch-campus crosswalk case, biggest payloads), Berea
College (`$0` cost lines — the "fee = 0 ≠ null" case), United States Military Academy (no tuition, no
aid section), `Ohio-State-Universitity-at-Marion` (a slug typo at source), Arizona State West campus
(the multi-campus case). **65 files** (Phoenix has five), 3–12 KB each, committed (test fixtures are
source, not artifacts), plus one committed sitemap fixture. The routine-suite test asserts **zero
unmapped labels across all eleven** and is table-driven over every normalizer (in/out-of-state split,
ordinal, matrix incl. `false` cells, distribution with `-1` and omitted buckets, `dual_merit`,
address, the three period markers, the deadline year-roll incl. the cross-tab anchor, a legitimate
`0` round-tripping as a value, the one-owning-tab rule for header keys, ordinal stability).

### 4.6 Crosswalk (§2 for the method)

Built from each school's **own payload** (`profile.{name, address, alternativeName, id}`) after the
first fetch of its index route — not from a search list. Measured stages 1–6 resolve 87.6%; ≈320
rows go to one subagent adjudication pass with a 3-candidate shortlist; a meaningful share are
legitimately unmatchable (no Title-IV IPEDS row: American Islamic College, Doral College, Patrick
Henry College…). **Multi-campus systems are the cost centre** (Arizona State ×3 campuses vs IPEDS
"Campus Immersion"/"Digital Immersion"; DeVry, Rasmussen, Strayer campuses): when several slugs map
to one unitid the adjudicator picks the main campus, the rest get `retired_at` + a `note`, and the
`UNIQUE (school_id) WHERE retired_at IS NULL` index enforces it. `alternativeName` ("UG") feeds
`aliases` matching. Expect ~500–800 unitids with no CollegeData page and ~200–300 slugs with no
unitid; both are visible on the dashboard; neither is an error.

**What this narrows in D1.** The facts store is keyed by IPEDS `unitid` (`school_facts.school_id NOT
NULL`), so a CollegeData slug with no unitid cannot be crawled or stored. D1's "every school on the
site" is delivered as **every school on the site that maps to an IPEDS institution** — ~2,300–2,400
of 2,587 today. The remainder are outside the product's identity space and are surfaced on the
dashboard as *needs adjudication*, never silently dropped. The alternative (a unitid-less
`school_facts` keyed on slug, with those schools invisible to `resolve_school`, the workspace and
Explore anyway) buys nothing. **Owner ratification: §8.**

---

## 5. Product surfaces

### 5.1 Fact states — the whole set, one function

`domain/facts/state.py::fact_state(has_row, value, page_status, has_collegedata)` is the **only**
place the rule lives — `fact_state` for a fact, `section_state` for a section, both in that module,
sharing its vocabulary; the facts endpoint, the agent `get_facts`, the caveat emitter, and the explore
exclusion accounting all call it; the frontend receives the resolved state and never re-derives one.
**State is per fact, never inherited from a section.**

| state | when | student-facing word / line | source |
|---|---|---|---|
| `value` | a mapped label produced a value (a legitimate `0`/`false` renders at full weight) | the value | `school_facts` |
| `not_reported` | the tab fetched `ok` and the label is absent **or** printed "Not reported"/"Not available"/"—"/empty | the word the source printed ("Not reported" / "Not available") | reader (no row) or a null-value row |
| `not_fetched` | the key's tab has `last_status ∈ {http_error, build_id_rotated, parse_error, never_fetched}` **and no current fact row survives** | "Not checked" — section line "We couldn't read this page on the last check."; for `never_fetched` the word is "Not checked yet" and the line is "We haven't checked this page yet." The state **id** stays `not_fetched` everywhere (wire, caveat kind, docstring); only the rendered word changes — "fetched" is HTTP vocabulary on a 17-year-old's page, and "checked" is already the page's verb for the same act | `school_pages` |
| `not_published` | the key's tab has `last_status = 'not_found'` — CollegeData publishes no such page for this school (University of Phoenix, money-matters) | **"Not on file"** — section line "We don't hold this school's {section} information." (the six
section titles are title-cased — "Getting in", "Money", "Campus life" — so "a {section} page" would
read "a **Money** page", and "page" is Counselle-internal vocabulary a student has no referent for) (first person per §6d's DESIGN.md §13.4 exception: D3 forbids naming the upstream publisher, and an agentless "not published" leaves *the school* as the only actor a 17-year-old can supply — which the caveat one line down then has to deny. The state **id** stays `not_published` everywhere — wire, caveat kind, docstring — exactly as `not_fetched` keeps its id behind "Not checked") | `school_pages` |
| `not_collected` | the school has no live `collegedata_schools` row | whole-page Empty state (§5.2), never a wall of rows | crosswalk |

**A failed tab never hides a value we hold.** When a tab's last fetch failed but a current fact row
survives from an earlier pass, the fact renders in state `value` with its own (older) `observed_at`,
and the section header carries "We couldn't re-check this page on the last run — these values are
from {Month YYYY}." Only keys with no surviving row render "Not checked". Hiding a known value behind
a fetch failure asserts an ignorance we do not have.

`not_applicable`, `suppressed`, `not_in_template_version`, `no_verified_value` are retired with the
packet (no CollegeData node produces an explicit N/A marker); their frontend branches, strings, and
tokens are deleted, not left dead.

### 5.2 Facts page — `GET /v1/schools/{unitid}/facts`

- **Response (this paragraph is the contract; appendix D-A is its TypeScript rendering, appendix
  J-ii's earlier pydantic sketch is superseded):** `{identity, has_collegedata, observed_at,
  is_stale, deadlines: [{round, date, display, reported_period: string | null, state,
  observed_at: string | null}],
  sections: [{id, title, fetch_state, never_checked, line, foot, groups: [{id, label, foot, chart, facts: Fact[]}]}],
  caveats}`. Each **section** carries **`never_checked: boolean`** — the client's only consumer is the whole-page
  empty state below, which must choose between "We couldn't read {school}'s pages" and "We haven't
  checked {school}'s pages yet" and cannot get that from `fetch_state`. **Facts do not carry it:**
  `fact_state(...)` resolves the same flag internally, but a fact's word is already on the wire in
  `display` and its `not_fetched` caveat branch is already picked at the emitter, so a per-fact boolean
  would be a field nothing reads — the `bandTrusted` case §5.3 rejects. Both are resolved in
  `domain/facts/state.py` — per fact by `fact_state(...)` from the key's own tab status, and per
  section by its sibling **`section_state(tab_statuses: Mapping[str, str]) -> tuple[FetchState, bool]`**,
  which takes the statuses of **all** the section's contributing tabs and returns
  `(fetch_state, never_checked)` together, because they are two readings of one set and a
  single-`page_status` signature cannot express "every non-`ok` contributor" —
  from `school_pages.last_status == 'never_fetched'` (true only
  when *every* non-`ok` contributing tab is `never_fetched`; a mixed section is a read failure, the
  stronger claim). It is the only thing that can select between §5.1's two `not_fetched` words —
  `fetch_state` cannot, because `never_fetched` and a read failure share one state id, and
  `school_data_status.tabs` is deliberately not on this response (§3.2). Without it §5.1's "Not
  checked yet" copy has no data path and the page prints a failure line over a page nothing ever
  requested — the state of **every** school between Phase 1's deploy and its first completed pass.
  **Every student-facing fact, deadline-row and section word on this response is composed
  server-side and carried on it.** Each
  fact's `display` is never blank and is *the absence word itself* when `state != "value"` (appendix
  D-A's `FactBase.display`), and each deadline row's `display` is likewise the rendered word,
  including **"Not offered"**. Each section carries **`line: string | null`** — the resolved
  `fetch_state` sentence (the two `not_fetched` words, the `not_published` line, the three `partial`
  cause-lines, and the "We couldn't re-check this page on the last run — these values are from
  {Month YYYY}." form, whose date the client is **never given** because `observed_at` is per fact, not
  per section) or `null` when the section is `ok`. All of it is authored **once**, in
  `domain/facts/state.py`, beside `BAND_CAPTION`; the frontend composes no absence word and no section
  sentence, the rule the caveats already follow.
  `fetch_state: "ok" | "partial" | "not_fetched" | "not_published"` is **derived from the set of tabs
  the section's keys actually draw from** (sections are not 1:1 with tabs — the genuinely two-tab
  section is `campus-life`, which draws from `campus-life` and `students`; **`money` draws from
  `money-matters` alone**, because the cost header keys are owned by that tab (appendix E-ii), which
  is why University of Phoenix's Money section reads "Not on file" and not "partial"):
  `ok` when every contributing tab is `ok`; `not_fetched`/`not_published` when **all** contributing
  tabs are in that one state *class* (`not_fetched` covers `http_error`, `build_id_rotated`,
  `parse_error` and `never_fetched`, so a section mixing two of those is uniformly `not_fetched`); `partial` otherwise, **with the line naming the actual cause** — when
  the non-`ok` contributors are all `not_found`, "We don't hold part of this section for this
  school."; when they are all read failures, "Part of this section couldn't be re-checked on the last
  run."; when both occur, "We don't hold part of this section for this school, and part couldn't be
  re-checked on the last run." A "couldn't be re-checked" line about a page the source simply does not
  publish is false, and the Phase 2 exit test forbids it. A section whose only contributing tab is
  `not_found` is `not_published`, never `partial`. **The key→tab map is a third field in
  `facts_sections.yaml`, declared per key:** each entry in a group's `facts:` list carries **an authored display
  label and** its owning tab (`- {key: costs.tuition_in_state, label: "Tuition and fees, in-state",
  tab: money-matters}`). **`label:` is what the page renders for every declared key, present or
  absent** — `school_facts.label` (the source's printed wording, §3.1) stays for lineage and for
  `school_facts_sql` but is never the row label, because a key with **no row** carries none, and a
  label that changes the moment a value arrives is the same string with two homes. Without it the
  wire's required `FactBase.label` has no source for exactly the rows §4.4, `compressAbsences` and
  Phase 2's own exit gate require ("a key with no surviving row renders 'Not checked'"), and an
  implementer would title-case `fact_key` into an unreviewed student-facing string. `label:` is
  hand-authored copy under the D3 rule (it names no upstream source) and is covered by the Phase 2
  exit grep, and each section's `tabs:` is the
  **derived union** of its keys' tabs, used for `fetch_state` only. Both are **generated from
  `facts_keys.yaml`'s one-owning-tab declarations by a Phase 1 script and pinned equal to them by a
  Phase 1 test** — so the reader never loads the mapper's asset and there is still exactly one owner
  of which tab a key comes from. A section-level set alone will not do: `campus-life` draws from two
  tabs, so an absent key there would have two candidate page statuses and therefore two different
  student-facing sentences ("Not on file" vs "Not reported") chosen by nothing. Without the map
  neither `fetch_state` nor §5.1's `not_fetched`/`not_published` is computable for a key with **no
  row** at all (the row carries `school_facts.tab`; an absent key carries nothing), which is the whole
  point of the state distinction. The map is loaded **once**, into `CatalogSnapshot.sections`, so
  `counselle_db/service.get_facts` reads it from the catalog it is already handed and the HTTP route
  and the agent tool get the identical map; `app/facts/service.py` adds only layout and the deadlines
  block on top, and `fact_state`/`section_state` receive the per-tab statuses from
  `school_data_status`, **read live in the same read-only transaction as `current_school_facts`** —
  never from the catalog copy, whose `data_catalog_refresh_seconds` default of 3600
  (`config/settings.py:69,263`) would let a section print "We haven't checked this page yet" for up to
  an hour above rows the same response renders in state `value`; the catalog copy serves
  `resolve_school`/`SchoolFactsStatus` only. When a section's state is `not_fetched` but **any**
  of its facts is in state `value` (a surviving row from an earlier pass, §5.1), the header line is
  §5.1's — "We couldn't re-check this page on the last run — these values are from {Month YYYY}." —
  never the bare "We couldn't read this page on the last check.", which would deny values printed
  underneath it. **{Month YYYY} is the oldest `observed_at` among that section's surviving `value`
  rows**, never the newest and never the page-level `observed_at` — the same rule and the same reason
  as the deadline foot, since the newest re-creates exactly the freshness over-claim both lines exist
  to kill; the composer takes it as an argument beside `section_state`'s result, because
  `section_state(tab_statuses)` sees no dates. The section header summarises; it never overrides a fact's own state. **Every fact carries a `kind`** —
  `scalar | link | list | table | matrix | distribution | band | ordinal` — with the kind's payload,
  because the components §6b keeps (`FactTable`, `FactBarChart`, `FactRangeChart`, `FactOrdinal`,
  `RowsBlock/BarsBlock/BandsBlock/OrdinalBlock`) need points/bands/levels, not a display string. Two
  new render pieces and only two: a `TableBlock` (`table`/`matrix`, over `components/ui/table` with
  `overflow-x-auto` — **the one sanctioned DESIGN.md §17.6 exception**, carrying its reason as a
  comment at the site: a boolean matrix (sports × gender) loses its meaning when stacked into cards,
  and a `table` fact's row labels are short enough to read at 320px; `role="region"` + `tabindex="0"`
  + `aria-label` on the scroll container so the scroll area is keyboard-reachable (§16.1); a `true` cell is `lucide` `Check` + `aria-label="Offered"`, a `false` cell is an
  `--ink-faint` en-dash **with** `aria-label="Not offered"` and a `title`, never an empty cell —
  DESIGN.md rule 34 — and the column-header note says "A dash means the school does not offer it")
  and a `children` affordance on `FactTable` rows (`NestedTitleValue`). Each fact also carries
  `observed_at`, `reported_period`, `caveat_ids`. `is_stale` is server-computed
  (`domain.facts.state.is_stale`), never re-derived client-side; because `domain/` may import only
  stdlib and pydantic (`tests/domain/test_purity.py:20`) it can never read `Settings`, so the
  threshold is a **parameter** — `is_stale(observed_at, stale_days)` — passed by
  `app/facts/service.py` / `counselle_db/service.py` from `facts_stale_days`, and the Phase 1 purity
  gate is the exit test. `BandFact.submitted_percent` is
  always null under v3 — the seam a future source fills (§10). A section's **headline** — the shipped
  lead band, `emphasis: true`, one density step up (`school-facts-blocks.ts:161-165`) — is delivered
  as the section's **first group**, `id: "headline"`, `label: null`, with the same `foot` slot every
  other group has (the shipped `SectionConfig` carries `headlineCaveat` today,
  `school-facts-sections.ts:86`; the wire `foot` replaces it). It is a group, so the wire needs no
  fourth level and `fetch_state`/`foot` apply to it unchanged. **One key, one place:** the service
  emits each `fact_key` in exactly one group per school — a key declared in `headline:` is not
  repeated in a later group, the `seen` rule `school-facts-blocks.ts` already threads — and a key
  served through the top-level `deadlines` block appears in no group at all, headline included.
- **Layout** from `facts_sections.yaml` (six sections, ~30 groups, 19 of today's 27 group ids reused,
  appendix E-iii; its `test-detail` caveat text is dropped in favour of the single band caption
  below); section ids are **strings on the client** (`SectionId` opens up); a group may declare a
  `chart` and a `foot`, and **the yaml's group-level `caveat:` field is renamed `foot:`** (one slot;
  the shipped `GroupConfig`'s two — `caveat` above the rows, `foot` under the chart — collapse into it,
  and appendix E-iii's eight `caveat:` blocks are read as `foot:`). A group declares **either**
  `foot:` (an authored literal — **seven** of E-iii's eight `caveat:` blocks; `test-detail`'s is
  dropped just below for `foot_ref: BAND_CAPTION`) **or** `foot_ref:`, the name of a
  `domain/facts/state.py` constant resolved by `app/facts/service.py` when the section is built; the
  two are mutually exclusive and a Phase 1 test asserts every `foot_ref:` names a constant that
  exists. `getting-in/test-detail` carries `foot_ref: BAND_CAPTION` and
  `getting-in/selectivity-rating` carries `foot_ref: ENTRANCE_DIFFICULTY_NOTE`; neither sentence ever
  appears in the yaml, which is what keeps "one authored copy" true rather than merely intended —
  pasting the caption into the yaml would otherwise satisfy every gate in this plan (the D3 grep
  looks only for `collegedata`, the absence-word grep only for the five state words, and `knip`/`tsc`
  see nothing) while creating the second home the whole `ABSENCE_COPY`/`metricLabel`/`--brand-tint`
  line of reasoning exists to prevent, on the flagship honesty string. The merged slot renders **under the
  group's content** — beneath the chart when the group has one, beneath the last row when it does not —
  as one `--ink-muted` line, so a group always has exactly one place for its qualifier and a group
  without a chart is not a case with no answer. Where a qualifier would read better *before* the values
  (E-iii's "Rank bands overlap — the top tenth is inside the top quarter. They cannot be added."), the
  renderer still places it under the rows: a muted line at the end of a five-row group is inside the
  same glance, and one slot with one position beats two slots whose difference nothing on the wire can
  express. **`chart`** rides the wire verbatim
  (`null` for most groups) — `{kind: "bars", unit, refs, max_ref?}` / `{kind: "distribution", refs}` /
  `{kind: "ordinal", levels}` — because four of appendix E-iii's ten chart groups plot **scalar** facts
  against a shared maximum (`applicant-pool`, `waitlist` and the two percent groups) and no fact's own
  `kind` can express that; without the field the shipped `BarsBlock`/`FactBarChart` path dies and those
  four groups silently regress to rows. It is layout, so it travels the way every other layout decision
  on this response does, and `charts/`'s four unchanged files stay unchanged (§6b).
  **A group with zero facts is not rendered**, and a `foot_ref:` whose sentence qualifies a specific
  kind of value renders only when the group renders ≥1 fact in state `value` of that kind —
  `BAND_CAPTION` only under a rendered `band`, `ENTRANCE_DIFFICULTY_NOTE` only under a rendered
  rating — so a qualifier is never printed about a value the student cannot see (on a sparse school
  `getting-in/test-detail` still renders its declared keys as "Not reported" rows, and a caption
  explaining a band under three rows with no band in sight explains nothing). An authored `foot:`
  renders whenever its group does.
- **Deadlines** render as the first group of the **Applying** section (one row per round, `display`
  = the formatted date with its cycle label, "Not reported" when absent, `"Rolling"` verbatim). **A round the source states is not offered never
  renders as "Not reported":** the block reads the sibling facts `admissions.early_decision_offered` /
  `admissions.early_action_offered` (bool, already mapped — appendix E-i's **TitleValue** bool row
  and E-ii's two `Early Action Offered` rows; verified live in the Yale capture, which prints
  `Early Decision Offered: No` beside an Early Action date), and when
  one is `false` the round's row renders **"Not offered"** with `state: "value"` and no
  `reported_period`. "Not reported" on a round the school does not run tells a student the school has
  a deadline it withheld, and it would sit three groups above a `rounds-offered` row saying the
  opposite; `school-facts-rows.ts:221-225`'s shipped comment already states why the two must never
  collapse ("a student who reads 'not offered' stops looking"). `rounds-offered` keeps both bools —
  they answer a different question and cost one row each.
  The block carries the group `foot` "Dates last confirmed {Month YYYY} for the {cycle} cycle.
  Confirm on the school's site before you apply." — the page side of the rule §5.4 gives the
  agent (MVP1 stories 30/31). **{Month YYYY} is the oldest `observed_at` among the rendered deadline rows, never the
  page-level `observed_at`**: that field is `max(last_fetched_at)` across six tabs (§3.2) and deadline
  facts are owned by `admission` and `money-matters` (§4.4), so the page maximum would stamp this
  morning's date on a deadline last confirmed three months ago — the freshness over-claim §5.2's
  re-check line exists to prevent, on the one value where it changes what a student does. When every
  rendered row's `reported_period` is null the foot drops the cycle clause rather than rendering "for
  the  cycle". **When no rendered row carries an `observed_at` at all** — every deadline key absent,
  which happens whenever the `admission` tab failed and `money-matters` published none (Phoenix's
  shape, a committed fixture) — the foot drops the "Dates last confirmed {Month YYYY}" clause the
  same way and renders only "Confirm on the school's site before you apply."; a blank date is a
  freshness claim about nothing. No badge, no colour — a catalog date is not a status about *this* student, and
  `school-cells.tsx`'s red-date badge is a recorded DESIGN.md §14.3 violation not to be copied. The
  deadline keys are served **only** through the top-level `deadlines` block; the facts service omits
  `facts_sections.yaml`'s `applying/deadlines` group from `sections` (that group's key list is what
  feeds the block, so there is still exactly one owner of which keys are deadlines) **and drops every
  deadline key from `applying`'s `headline:` list**, so the no-double-render test holds against the
  shipped layout. The block renders **date-valued keys only**:
  `admissions.regular_deadline_is_rolling` is excluded — the row above it already says "Rolling", and
  the bool exists for §5.3's include-rolling filter and for the agent. The block's `foot` is a
  frontend literal (it names no upstream source, so D3 is untouched), not a field at all on the
  wire block. A Phase 2 test
  asserts no `fact_key` appears in both `deadlines` and `sections`.
- **Freshness (Q2 resolved):** one line under the identity meta, `--ink-muted`: **"Checked {Month
  YYYY}"** — an observation, never "updated". A fact with `reported_period` renders it as a
  `FactContext` suffix ("2025–26"); **a fact without one renders no suffix**, and the absence is
  explained **once per section** rather than ~190 times: §4.4 establishes that exactly three
  year-bearing markers exist site-wide, so an always-on 17-character muted suffix would ride the
  great majority of a ~250-fact page and bury the ~60 rows where a period genuinely *is* stated —
  the noise pattern `VerdictBand.tsx:57-63` already documents as the thing to avoid. The section
  `foot` is what makes a missing suffix readable — a `foot: string | null` on the section object,
  beside its `line` and independent of `fetch_state` (an `ok` section still needs it), emitted whenever
  the section holds at least one fact with no `reported_period`, and authored once in
  `domain/facts/state.py` beside `BAND_CAPTION`, and it names no upstream source (D3): **"Where no year is
  shown, we don't know which year the figure covers."** The long form belongs with the word it
  explains, not with each section: the page-level freshness line gains a second muted clause under it
  — **"'Checked' is when we last saw a value published, not when it was measured."** — a
  **frontend literal beside the freshness line it explains**, taking the same carve-out as the
  deadline block's `foot` and the two whole-page `Empty` states (Phase 2's absence-word grep): it
  names no upstream source (D3) and interpolates nothing, so it needs no wire field and the response
  contract gains no page-level string slot; it sits with the word "Checked" rather than in a constant
  only a section-level slot could carry. Rendered **once per page**. Below `md:`, where `SchoolFactsNavSelect` shows one
  section at a time, the section foot is the only carrier and still renders on the shown section;
  above `md:`, where all six sections sit in one scroll container, an eleven-word line six times is
  inside the noise budget a thirty-word line six times is not. The chat vintage
  string still says "reporting period unstated" **per fact** (§5.4), because a chat message has no
  section foot to carry it. When `is_stale` (`observed_at` older than `facts_stale_days`) the freshness line is
  **replaced** by "Last checked {Month YYYY} — this may be out of date" and one `stale_facts` caveat
  is attached; never two freshness claims on one page.
- **Band caption (one string, code-owned **on the backend** in `domain/facts/state.py::BAND_CAPTION`
  and delivered on the wire everywhere it appears — the facts-page group `foot`, the chat card `foot`
  (§5.4) and the Explore response's `band_caption` field — so there is exactly one authored copy of
  it; the frontend holds no band-caption literal, the same rule the caveats already follow ("the
  frontend holds **no** caveat copy; text comes from the wire"), and `classify-fit.ts` holds no
  constant):** "This band holds the middle half of the enrolled students who reported a score. We don't know how
  many reported one — treat it as context, not a cutoff." The population is **score reporters, not the
  class**: a school publishing a 740–790 band is describing the students who sent a score, and
  `submitted_percent` has no source under v3, so we cannot say what share of the class that is. The
  superseded story-33 wording — "Half of enrolled students scored inside this band" — is the claim
  `classify-fit.ts:20-23` calls **trap 1**: a band whose submitted share is under half describes the
  top of the class, not its middle, so if 45% reported then at most 22.5% of enrolled students are
  inside it, and the error runs in the direction that makes a 700-scorer believe they are below half
  of Yale's class. It is also the sentence §5.4 forbids the model from saying, and one authored string
  cannot be honest in the prompt and false on the page. The caption rides the SAT/ACT rows here, the
  Explore verdict (§5.3) and the chat `stat_block` (§5.4), and **supersedes `specs/mvp2/PRD.md` story
  33's locked wording**; ADR 0037 records it.
- **States:** pending query → `SchoolFactsSkeleton` (rail + panel, two staggered-width `Skeleton`
  bars per DESIGN.md §15.2, `aria-busy`), never a redirect (`SchoolDetailRoute.tsx:133` gains an
  `isPending` branch before its `Navigate`); failed fetch → the shared `error-card` (§6b) with
  DESIGN.md §13.1 copy "Could not load this school's facts" / "The workspace could not reach the
  school data service." / `[Try again]`, `role="alert"` — **but a 404 is not a failure**: an unknown
  unitid renders the §13.2 `Empty` primitive, **"We don't have this school"** / "Counselle doesn't
  have a school with that id. Search by name to find it." / `[Browse schools]`, matching the "We
  don't have this school" vs "No facts collected for {school}" distinction §5.4 already requires of
  the agent (MVP2's locked "not in our database → a designed honest card, not plain text"); only
  5xx/network reaches the error card, and neither reaches `SchoolDetailRoute.tsx:133`'s `Navigate`.
  `has_collegedata=false` → the §13.2 `Empty`
  primitive, one sentence + one CTA: **"No facts collected for {school}"** — no "yet": R6 measures
  ~500–800 unitids with no CollegeData page at all, and "yet" tells those students to wait for
  something that will never arrive — / "Ask Counselle and it
  will search the school's own pages." / `[Ask Counselle]` — the button opens a new chat pre-filled
  with "Tell me about {school}." (a **deliberate** change from `SchoolDetailRoute.tsx:378`'s shipped
  "What can you tell me about {name}?": the facts page already names the school, so the prompt drops
  the hedge); it replaces `NoFactsYet`
  and `NoCommonDataSet` (whose `data.edition === null` gate becomes `has_collegedata === false`);
  every tab failed → the same `Empty` primitive, **not** an error card (there is no action the
  student can take): **"We couldn't read {school}'s pages on the last check"** / "We'll try again on
  the next pass — ask Counselle to look at the school's own site meanwhile." / `[Ask Counselle]`;
  **when every tab is `never_fetched`** — the state of every school between Phase 1's deploy and its
  first completed pass, and of every newly adjudicated slug — the same primitive reads **"We haven't
  checked {school}'s pages yet"** / "We'll collect them on the next pass — ask Counselle to look at
  the school's own site meanwhile." / `[Ask Counselle]`. A page nothing has requested is never
  described as one we failed to read.
  Mobile: the existing `SchoolFactsNavSelect` swap below `md` stays.
- **Auth, caching, budget:** `Depends(current_active_user)` (same posture as `/v1/schools/search`; an
  anonymous bulk-read surface is the redistribution half of R0). `Cache-Control: private, max-age=300`
  and a weak `ETag` from `observed_at`, honouring `If-None-Match` with 304 through one shared
  `etag_response()` helper in `api/deps.py` (the app's first). Client `staleTime` 5 min (the app has no
  `staleTime` anywhere today; put the reason in a comment). Payload ≤ 150 KB uncompressed for the
  widest school, asserted by a Phase 2 test on Ohio State; if exceeded, `?sections=` fetches per
  section. Route mounted in `api/routes/schools_facts.py` **after** `applications.router` (which owns `/v1/schools/search`, `api/routes/applications.py:28` — there is no "workspace router" in `api/main.py`) and before
  the SPA catch-all, with `unitid: int` in the path; what actually keeps `explore`/`majors` from
  binding to it is the **`/facts` suffix** — three path segments against their two — since FastAPI
  would 422 a non-int rather than fall through;
  `/v1/schools/search` stays workspace-owned. Errors: `EnvelopeError` via `map_facts_errors`
  (unknown unitid → 404 "That school is not in our database."; a school with no crawl row → **200**
  with `has_collegedata=false`, never 404). Response models are real pydantic return annotations
  (the `cds_admin` convention, not the workspace `-> object` one); the frontend hand-writes matching
  snake_case types. The facts tab's URL value stays `about`.

### 5.3 Explore — `GET /v1/schools/explore` and `GET /v1/schools/majors`

- **Filters (each backed by a real field — dropped for having none: admit rate by home state, average
  net price, out-of-state %, REA-vs-EA, a published student:faculty ratio, and any SAT composite):**
  text query (`schools.search_name ILIKE`); state; **region** — the column stores `basic_profile.location.region`
  **verbatim** (whatever IPEDS OBEREG writes there; CollegeData has no region field), and the filter **matches on that
  verbatim string** — no collapse into census quadrants, because a nine-to-four mapping is a judgment
  nobody has authored and a student filtering "West" would silently lose Rocky Mountain schools. The
  `SIZE_BUCKETS` single-owner rule applies: the option list is derived once, server-side, from
  `SELECT DISTINCT region ORDER BY region`, and `explore-config.ts` holds no region literal. Each
  option is `{value: <the verbatim string>, label: <the text before the first " ("> , states: <the
  parenthesised list, or null>}`, because the seed stores the OBEREG label **with its state list
  inlined** — "Southeast (AL, AR, FL, GA, KY, LA, MS, NC, SC, TN, VA, WV)", 58 characters — which is
  not a usable option label in a multi-select, a filter chip, or the `useIsMobile()` sheet at 320px.
  The states ride the option as its `title` and as the checkbox description, so nothing the source
  says is hidden: the label is the region's name, the description is which states it means. Ten
  options exist today, two of which are not geographic ("Other U.S. jurisdictions", 80 schools;
  "U.S. Service schools", 5) and are offered under their own names rather than folded into a
  neighbour. Appendix B's four-member
  `("northeast"|"midwest"|"south"|"west")` union and its "Census region, derived from `schools.state`"
  note are both overridden; size bucket (from
  `students.undergraduate_total` **only** — there is no fallback to
  `basic_profile.classification.institution_size`: IPEDS's five bands do not nest inside the shipped
  four, `1,000 - 4,999` straddles the 2,000 boundary and `20,000 and above` straddles the 25,000 one,
  and together they are **1,190 of 2,746** seed rows, so a fallback could only guess — and a guess here
  puts a 4,500-student school inside "Under 2,000" on a card that shows no headcount to contradict it.
  A school with no undergraduate total is excluded when the filter is active and counted in an
  exclusion chip with **`reason: "missing"`** — "{count} hidden — undergraduate count not available" —
  not `not_reported`: `students.undergraduate_total` is a CollegeData fact, so a null explore column
  may be `not_reported`, `not_fetched` **or** `not_published` and the wide row carries no per-column
  state to say which, exactly the case the `missing` branch exists for; the
  bucket boundaries live **once**, in `SIZE_BUCKETS` in `app/facts/service_explore.py` —
  `explore-config.ts`'s `sizeBucketOptions` keeps `value`/`label` and **drops `min`/`max`**); control — **projected from
  `basic_profile.classification.control`, which is already three-valued and never null**: decoded
  across all 2,746 seed rows it is `Public` (893), `Private not-for-profit` (1,548) and
  `Private for-profit` (305), so the explore column is
  `enum('public','private','private_for_profit') NOT NULL` with no crawled input and no fallback.
  The **three-way distinction** is verbatim; the **string** is not — unlike `region`, which stores
  the source label itself, this column stores a fixed mapping written once beside the
  `school_explore_rows` upsert (§7 Phase 1): `Public`→`public`, `Private not-for-profit`→`private`,
  `Private for-profit`→`private_for_profit`. A fourth IPEDS value is an **unmapped label** (§4.4),
  never coerced into a neighbour — the same rule the `test_policy` bullet below states for itself,
  except that this column is `NOT NULL` with no `not_reported` member to degrade to, so the
  projection raises and that school's facts transaction aborts rather than writing a false owner;
  it is counted with the dashboard's unmapped labels and the mapping gains its member
  deliberately.
  `identity.control_reported` (CollegeData's `universityType`, appendix E-ii's `overview` /
  `universityType` row, the same three values) is a **cross-check only** — the `gender_model`
  pattern at appendix E-iv's `gender_model` row — and a
  disagreement is surfaced on the dashboard beside the unmapped labels, never allowed to move the
  column: IPEDS is the identity store (D1), it is trigger-validated, and it is complete for schools
  the crawler has never reached. The control therefore offers **three options, not two**, and **all three
  name themselves**: `explore-types.ts:15`'s `Control = "public" | "private"` gains
  `"private_for_profit"`, and `explore-config.ts:160-164`'s `controlOptions` becomes `Any` /
  `Public` / `{value: "private", label: "Private (nonprofit)"}` / `{value: "private_for_profit",
  label: "Private (for-profit)"}` — the shipped bare `"Private"` at `:163` is **renamed**, not left
  alone: over a three-value column it reads as "all private schools" and silently returns 1,548 of
  1,853, which is the same fold-under-a-contradicting-label this decision exists to remove, moved
  out of the data and into the copy. `control_counts` (`Record<Control, number>`; appendix B's
  two-key literal is overridden) gains its key. A two-option control over a three-value column has no honest reading: "Private" would either
  hide every private for-profit school with no exclusion chip and no facet count — University of
  Phoenix is a committed fixture for exactly this case — or fold them under a label the column
  contradicts. Deriving the third value from a crawled fact would do the second thing on every school
  the crawl has not reached — which on the first screen after ship is all of them, putting all 305
  for-profits inside "Private" with a facet count to match, and permanently for any school whose
  `campus-life` tab stays `http_error`/`not_found`. `private` is not a weaker form of
  `private for-profit`; it is a different, false statement about who owns the school, on the one axis
  a student uses to screen for-profits out;
  **gender model** — projected from `basic_profile.identity_and_mission.{women_only, men_only}`
  (`coed` when both are false, `women`/`men` when one is true) and **null when both are null**, which
  measured across the seed is **61 rows**. Those 61 are two different populations and only the second
  is a school: **55** carry a null `classification.category` and are IPEDS system-, district- or
  chancellor's-office records ("University of Alabama System Office", "Los Angeles Community College
  District Office"), while **6** are real degree-granting institutions open to the public whose
  survey components are simply not reported yet — all recent high-unitid IPEDS additions (498623
  Justice University; 499875 Mosdos Yaakov V'Yisroel; 499981 Southwest University of Naprapathic
  Medicine; 500290 / 500306 / 500333 Arizona College of Nursing, Chesapeake / Hartford / St Louis).
  **Null is never written as `coed`**: "admits all genders" is a claim and IPEDS makes none here, and
  the else-branch-of-two-booleans an implementer writes when told the column is "never null" would
  state a fabricated fact about six real nursing, religious and medical schools, on the one filter a
  student uses to find a women's college. Whether the 55 office rows belong in the browsable universe
  at all is a **separate** question — answered once, in the universe-line bullet below — and it is
  emphatically **not** answered by dropping the 61, which would take the six with them. Appendix
  E-iv's `gender_model` row is annotated "never null" and that annotation is **overridden**; the
  appendix's own `gender_model text NULL CHECK (gender_model IS NULL OR gender_model IN
  ('coed','women','men'))` DDL is the correct half of the contradiction. Selecting any gender excludes the null rows with `reason: "not_reported"` (the source is a
  store we hold entirely), and the same holds for the **HSI** toggle, null on the same 61 rows —
  `hbcu`, `tribal` and `land_grant` are non-null on all 2,746 and need no absence handling at all;
  **campus setting** — the control offers the **four families** IPEDS's `locale`
  names before its colon (City, Suburb, Town, Rural), matching `locale LIKE '<family>: %'`. The region
  label/description split is deliberately **not** reused here: `locale` is a two-level taxonomy —
  twelve values that are exactly `{City, Suburb} × {Large, Midsize, Small}` and
  `{Town, Rural} × {Fringe, Distant, Remote}`, measured across all 2,746 seed rows — so splitting on
  the colon would render three options reading "City", three "Suburb", three "Town" and three "Rural",
  told apart only by a description and indistinguishable in a filter chip. Collapsing to the family
  invents nothing, unlike the census quadrants rejected for region: every "City: Large" school **is** a
  city school by the source's own string, and no school moves between families. The size qualifier is
  not offered as a filter — a student asks for city-versus-rural, not for "City: Midsize" — and stays
  in the stored column for `query_database`. The two schools whose `locale` is null are excluded when the filter is
  active and counted in an exclusion chip with `reason: "not_reported"` — the projection is from
  `basic_profile`, which we hold in full for every school, so "campus setting not reported" is a claim
  about IPEDS's own row and not about a page we failed to read — never silently dropped; **religious affiliation** (`religious_affiliation`) — a `Command`+`Popover`
  combobox sourced from `filter_options`, the majors control's shape, because the seed holds **61
  distinct named affiliations** (Roman Catholic 212 … a long tail of ones) and a 61-row checkbox list
  is unusable in the `useIsMobile()` sheet. Two non-name options sit above the names: "Religiously
  affiliated (any)" and **"No affiliation on file"** — both **frontend literals in
  `explore-config.ts`**, beside `testPolicyOptions`, because neither is a value the column can
  hold and `filter_options.religious_affiliation` (a `WHERE … IS NOT NULL` query) can never carry
  them; the no-literal rule below exists to stop an option list drifting from the values a column
  holds, and these two are not values. "on file" is a claim about us, the same voice
  as "Not on file" one screen over (§5.1), where "Not stated" would be a claim about the source —
  with a wire-delivered note under the control, code-owned beside the band caption
  (`domain/facts/state.py::RELIGIOUS_AFFILIATION_NOTE`): "Counselle holds no affiliation for these
  schools. That is not the same as knowing a school has none, so this is not a list of secular
  schools." (1,923 of 2,746 rows are in it.) **The note is a statement about our column, never about
  the upstream row**: the explore column is projected from `basic_profile`'s
  `normalized_value`, and measured across all 2,746 seed rows that is `null` on 1,923 and a named
  string on 823. Each of those 1,923 nodes does carry a provenance envelope — `{status: "null",
  raw_value: -2, normalization: "decode:IC2024.RELAFFIL"}`, with **no** row carrying `-1` — but
  `raw_value` never reaches `school_explore_rows`, and the projection is deliberately the decoded
  value, not the code: reading `-2` as "this school has no religious affiliation" would make a
  filter option out of an IPEDS sentinel we do not otherwise decode anywhere, and naming the source
  in the note would make this the only student-facing string in the release that does (§6d). So the
  filter says only what Counselle holds, which is nothing. That sentence is why
  the option is offered at all: without it, "absent" is a filter whose meaning we cannot state, the
  same objection that removed the test-blind option above;
  HBCU/HSI/tribal/land-grant (`basic_profile`); **entrance difficulty** (the source's
  own five-level enum) — **the only judgment-valued field in the store**, and the one value that is
  not a number the school itself reported: it renders with the group `foot` "A published selectivity
  rating, not a measured value. The admit rate and score bands below are the evidence; this is
  someone's summary of them." Its qualifier is **one string, code-owned beside the band caption**
  (`domain/facts/state.py::ENTRANCE_DIFFICULTY_NOTE`) and wire-delivered to both renderers; because the
  qualifier must sit with the value and not above the whole section, the key **moves out of
  `getting-in`'s `headline:` into its own `getting-in/selectivity-rating` group**, whose `foot` is
  that string, and the Explore response carries the same field so the filter control renders the wire
  string rather than a second copy. Its five levels are the source's own strings, pinned by the column's CHECK and
  offered by a frontend option list beside `testPolicyOptions` — they are code, like the other closed
  CHECK sets, not data, so they do not ride `filter_options`; a source value matching none of the five
  is an **unmapped label** (§4.4), never coerced into a neighbouring level and never dropped, because
  coercion would move a school one rung up or down a selectivity ladder this plan already refuses to
  let the agent quote as a fact. It is never a default sort, and `counselor.md`'s Composition Laws gain the line that the agent never
  quotes it as a fact about the school; test policy (`admissions.test_policy_sat_or_act`; **`not_reported` is a
  value, not null** — a missing row must not read as "optional": and a row we *did* read must never be reported as missing.
  **The member set is the source's own vocabulary, not the CDS ladder:** the explore column is
  `NOT NULL DEFAULT 'not_reported'` with the CHECK set
  `('required','considered','not_required','not_reported')`, overriding appendix E-iv's nullability and its member *naming*
  (E-iv is already a four-member enum annotated "`not_reported` is a value, not null"; only the names differ), and appendix B's three-member `('required','optional','blind')`. Verified
  live: the `Examinations` table's `SAT or ACT` row prints **"Considered if submitted"**, which none
  of `required`/`optional`/`blind` can hold — a `NOT NULL` CHECK over those three would either crash
  the per-school transaction or coerce a policy we *did* read into "not reported", and then render an
  exclusion chip calling that school unreadable while its policy sits one tab away on the facts page.
  **CollegeData publishes no test-blind marker at all**, so a "Blind" option would be a filter for an
  empty set whose zero result the honesty affordances would then explain as "no test-blind schools
  exist" — a fabricated fact about the world, produced by a filter with no backing value.
  `explore-types.ts:19`'s `TestPolicy` and `explore-config.ts:175-180`'s `testPolicyOptions` become
  `Required` / `Considered but not required` / `Not required` / **`No policy on file`**; a shared URL carrying
  a retired value (`testPolicy=optional`, `testPolicy=blind`) falls back to `any` rather than erroring,
  so the preserved-URL contract holds. A source value matching none of the three real members is an
  **unmapped label** (§4.4), never coerced into one of them. The filter control offers all four, the
  fourth labelled **"No policy on file"** — a claim about us, the voice of "No affiliation on file"
  two controls up, where "Not reported" would be a claim about the school. Selecting any of the first
  three excludes those schools **visibly**, with **`reason: "missing"`** and the copy "{count} hidden
  — test policy not available [include]": the column is `NOT NULL DEFAULT 'not_reported'`, so a
  school whose `admission` tab came back `http_error` or `not_found` carries the same member as one
  we read that printed no policy, and the wide row holds no per-column state to tell them apart.
  "not reported" would assert the school published nothing when our crawler may simply have failed —
  the conflation `ABSENT_LABEL` is renamed for one screen over — and
  `admissions.test_policy_sat_or_act` is a crawled fact, so `missing` is what this bullet's own
  invariant requires. The exclusion-chip grammar applies to **every filter kind**, not only
  ranges — enum (`testPolicy`, `sizeBucket`, `campusSetting`, `gender`, `entranceDifficulty`,
  `calendar`), boolean (`noApplicationFee`, `offersEarlyDecision`, `offersEarlyAction`,
  `rollingAdmission`, `hbcu`/`hsi`/`tribal`/`landGrant`), array-containment (`major`) and date
  (`deadlineBefore`) alike: a school hidden because we hold no value is always counted and always
  offered back); **score fit per section** — an **opt-in predicate
  control**, never a side effect of typing a score: `explore-types.ts`'s `ExploreFilters` gains
  `scoreFit: "any" | "at_or_above_p25" | "inside_band" | "at_or_above_p75"`, URL param `fit`,
  **default `any`** — an `EnumKey` in `useExploreFilters.ts`'s union (`:45-52`) with its
  `ENUM_PARAMS` entry (`:54-62`) and a `SegmentedControl` in the shape `testFitOptions:166-173`
  already has, which is the ancestor `scoreFit` replaces; appendix B's `ExploreRequest.test_fit` is
  the same field under its old name. It is evaluated **per section**: `satMathScore` against
  `sat_math_p25/p75`, `satEbrwScore` against `sat_ebrw_p25/p75`, `actScore` against
  `act_composite_p25/p75`; a section the student left blank contributes no predicate, and a school
  passes when every section with an entered score passes. **Entering a score alone hides nothing** —
  the three `StudentProfile` numbers stay profile inputs (`satm`/`satebrw`/`act`) that pick which
  band a card shows and what its "you" number is; `scoreFit` is the only thing that filters, and it
  is `any` until the student sets it. A score that filtered by default would be the product using a
  middle-50 band as a cutoff on the same screen where `BAND_CAPTION`, two rows up, tells the student
  it is not one — and both strings render at once, so no wording repairs it; a filter the student
  chooses is the student's own cutoff, which is a different statement. A school whose band is null
  for an entered section is excluded while `scoreFit ≠ any` and counted in an exclusion chip with
  `reason: "missing"` — "{count} hidden — SAT Math range not available" — the same grammar as every
  other filter. The single total-SAT input is removed because no composite band exists
  and summing section bands fabricates one (R14); cost of attendance in/out of state (`home_state`
  picks the basis); **average need met %** (`aid.avg_percent_need_met_all_undergraduates`, the
  printed figure, labelled "Average share of need met") and, separately, **students whose need was
  fully met** (`aid.need_fully_met_… ÷ aid.received_…`, control label **"Students whose need was fully met"**, with
  "Counselle's calculation from the school's own counts." as the control's muted description line — a
  `RangeDescriptor.label` is what the filter control and the sort menu print
  (`explore-config.ts:34-35`) and `METRIC_LABELS` is what the exclusion chip interpolates (`:36-37`'s
  `metricLabel` moves server-side, §6b), so both hold noun phrases and neither ever holds a
  disclosure sentence (DESIGN.md §13.4, "say the noun"); `explore-types.ts:49`'s CDS-era "trap 3" comment is rewritten); merit aid %;
  4y **and** 6y grad rate (split); retention; **undergraduates per full-time faculty member** —
  computed **in the explore SQL** from the two stored facts (`students.undergraduate_full_time`,
  `faculty.full_time_count`), never a stored column (the **one** sanctioned stored derived ratio is
  `need_fully_met_pct` = `aid.need_fully_met_all_undergraduates ÷ aid.received_all_undergraduates`,
  computed by the mapper because neither count is itself an explore column — without it §5.3's
  need-fully-met filter and §6b's `RangeKey.needFullyMet` have no column *and* no inputs to compute
  from), filter/sort only, control label **"Undergraduates per full-time
  faculty member"** with "Counselle's own calculation, not the ratio the school publishes." as its
  muted description line, and `METRIC_LABELS["ratio"] = "undergraduates-per-faculty figure"`, and therefore absent from `school_explore`, so no tool ever hands
  the model a pre-computed ratio it could mistake for a published one — the two inputs stay visible on
  `school_explore`, so the agent *can* derive the quotient, and `counselor.md`'s Composition Laws gain
  the line that a student:faculty ratio it derives is its own calculation and must be labelled as one; housing %; Greek % (men/women); international %; calendar;
  application fee = 0 (`application_fee = 0` only, null ≠ 0); ED / EA / rolling; **major offered**
  (`majors @> ARRAY[$1]` — the containment form, the only one an index could ever serve — exact name
  from the majors endpoint); deadline before date (with an explicit include-rolling toggle); sort by
  any column in a code-owned `SortKey` allow-list (`dict[SortKey, sql]`, `NULLS LAST` both
  directions, tie-break `school_id`); `includeMissing` per range, **default off** — a school with no
  value for **any** active filter is excluded and counted in `exclusions`, never silently included
  at 0 and never silently dropped; a sort reports its null tail the same way. Columns: appendix
  E-iv minus identity and minus `sat_total_*`; every metric nullable, never defaulted to 0.
- **Request model:** one pydantic `ExploreQuery` bound with `Depends()`, every filter typed with
  `ge/le`, `sort` an enum, `page ≥ 1`, `page_size` defaulting to `facts_explore_page_size` and capped
  at `facts_explore_max_page_size`. `app/facts/service_explore.py` builds the parameterized statement
  and the exclusion/`narrowest` accounting; `counselle_db/service.explore()` executes it on the RO
  pool — **not** through `_guard_sql` (the guard is for model-authored SQL). `Depends(current_active_user)`,
  `Cache-Control: private, max-age=60`, client `staleTime` 60 s; `q` debounced 250 ms client-side,
  `placeholderData: keepPreviousData` so a refilter never flashes a skeleton (`SchoolResultCardSkeleton`
  only on the first load). **No rate limit** beyond auth and the caches: `api/ratelimit.py`'s three
  limiters are all on writes and auth, the query is capped, and a first read limiter for one endpoint
  is machinery for a problem we do not have — revisit if the dashboard ever shows sustained load.
- **Response:** `{schools, page, page_size, total, total_is_capped, browsable_total, catalog_total,
  exclusions: [{key, metric_label, count, reason}], sorted_null_tail: {count, metric_label} | null,
  control_counts, narrowest: {key, label, remaining_without_it} | null, filter_options,
  facts_observed_from, band_caption, entrance_difficulty_note, majors_match_note,
  religious_affiliation_note}` — the last four are the code-owned strings from `domain/facts/state.py`
  (`BAND_CAPTION`, `ENTRANCE_DIFFICULTY_NOTE`, `MAJORS_MATCH_NOTE`, `RELIGIOUS_AFFILIATION_NOTE`), and `/v1/schools/majors` carries
  `majors_match_note` too because its combobox renders before any explore response has landed — the
  honesty fields keep three **shipped** affordances alive unchanged (`NoResults`'s DESIGN.md §13.3
  sentence "{narrowest} is the narrowest filter — {N} schools match everything else." / `[Relax]`
  `[Clear all filters]`; `ExclusionChip` + "include" — **which now takes a `reason`**
  (`"missing" | "not_reported"`) and renders **"{count} hidden — {metric_label} not available"** for
  `missing` (**any** filter — range, enum, boolean, array-containment or date — over a null column **fed by a crawled fact**: we hold no value, and the wide row carries no
  per-column state, so we cannot say which of `not_reported`, `not_fetched` or `not_published` it is)
  and **"{count} hidden — {metric_label} not reported"** for `not_reported` — a value whose *source* we hold in full and
  whose field is blank there, which today is the two IPEDS projections that can be blank — `locale` (2
  rows) and `gender_model`/`hsi` (61 rows, the same 61 in both). **`not_reported` is
  only ever used where the column's source is a store we hold entirely; every column fed by a crawled
  fact takes `missing`** — `test_policy` included, because its `not_reported` member cannot
  distinguish a page we read from one we failed to read. **Neither form says "no {metric_label}":** every four-year school has an
  admit rate, a graduation rate and a retention rate, and the shipped sentence
  (`ExploreResultsHeader.tsx:137`) asserts they do not — a claim about the school where the only claim
  we can make is about our data. It is the same conflation §6b's `ABSENT_LABEL` rename removes from the
  card two rows below, and "not available" is the same DESIGN.md §13.4 word, so the chip and the card
  agree;
  `controlCounts` in the filter bar). `narrowest` is computed only when `total === 0`. `sorted_null_tail` renders as **its own chip**
  beside the exclusion chips and **without an include action**: "{count} with no {metric_label} —
  sorted to the end." Rows in a null tail are not hidden and there is nothing to include, so neither
  `ExclusionChip`'s "{count} hidden — {metric_label} not available/not reported" copy nor its
  "include" affordance is reused — that component's whole job is not saying something false about the
  list on screen, and a sorted-to-the-end row is on screen.
  `total` is `COUNT(*) OVER ()` capped at `facts_explore_max_count`, which **must exceed
  `browsable_total`** (default **3,000**) so the cap never binds on a real corpus — it exists only as
  a runaway guard. When `total_is_capped` is true the two shipped consumers say so instead of stating
  a false exact number: the `role="status"` results count renders "{N}+ schools" and the footer
  "Showing {n} of {N}+". A capped count is never rendered as an exact one — the alternative is the
  default, unfiltered screen announcing "1,000 schools" one row above a universe line that says
  2,392. **The universe is stated once** under the
  count: "Browsing {browsable_total} schools with collected facts. {catalog_total − browsable_total}
  more are in Counselle without collected facts — search for one by name." (no "yet": for the
  ~500–800 unitids with no CollegeData page, nothing is coming — R6) (Explore lists
  only schools with a live crosswalk row; a partial catalog is never presented as the catalog, MVP1
  story 19). `catalog_total` is the seeded IPEDS row count and includes **55** system-, district- and
  chancellor's-office records that are not applicable institutions (the `classification.category`
  nulls measured in the gender-model bullet above — **not** all 61 null-gender rows: six of those are
  real degree-granting schools and must stay). Nothing here is false and no per-school claim is made,
  so they are left in; if the delta ever reads oddly to the owner, filtering the category-null rows
  out of `catalog_total` is a one-predicate change, not a redesign. **`filter_options`** rides the same response — `{region: [{value, label, states}], campus_setting:
  [{value, label}], religious_affiliation: [{value, label}]}` — derived server-side in
  `app/facts/service_explore.py`: `SELECT DISTINCT region`, `SELECT DISTINCT split_part(locale, ':', 1) WHERE locale IS NOT NULL`
  (the **family**, per the collapse above — the option list is the families that actually occur, not a
  literal four) and `SELECT DISTINCT religious_affiliation WHERE religious_affiliation IS NOT NULL`,
  each `ORDER BY 1`, over `school_explore` and cached with the
  same 60 s `Cache-Control` as the rest of the payload, so an option can never exist that no school
  holds and no school can hold a value the control does not offer. It rides the response rather than a
  fourth endpoint because the filter bar and the results are one screen with one cache; while the first
  query is in flight the three controls render disabled with their `Skeleton`, the treatment the grid
  already uses. `explore-config.ts` holds no **value** literal for any of the three — the only
  frontend option strings on those controls are the non-value ones ("Any" on each, plus religious
  affiliation's "Religiously affiliated (any)" and "No affiliation on file" above); the closed CHECK-set enums
  (`test_policy`, `control`, `gender`, `size_bucket`) keep their frontend option lists, because their
  members are code, not data, and are pinned by the column's CHECK.
  `facts_observed_from` renders **only** when older than `facts_stale_days`: "Some of
  these values were last checked {Month YYYY} and may be out of date."
- **Interaction stays "Load more"** (Q18): the client appends server pages (24) under the shipped
  footer "Showing {n} of {N}"; **the existing URL param names in `useExploreFilters.ts:28-156` are the
  contract** — `ExploreQuery` fields are named to match one-for-one, and **`sort` is already in the
  codec** (`:141`), so only `page` joins it. **Five params change**, each handled explicitly so a link
  shared before the change still resolves: `data` (`dataWindow`) and `noreea` (REA-vs-EA) are
  **removed** and ignored when present; `testfit` and `greek` are **removed** with their filters;
  `sat` — the single total-SAT input R14 forbids, written at `:143` — is **replaced** by
  `satm`/`satebrw`/`act`, and a bare `sat=` is ignored rather than split across the three;
  `outofstate` disappears with `RangeKey.outOfState`. Every retired param, like `testPolicy=optional`,
  falls back to its filter's default rather than erroring. The
  `useIsMobile()` sheet swap and the `role="status"` results count are preserved.
- **Majors endpoint:** `GET /v1/schools/majors?q=` → `counselle_db/service.majors()`:
  `SELECT m, count(*) FROM school_explore, unnest(majors) m WHERE m ILIKE $1 || '%' GROUP BY m ORDER
  BY 2 DESC LIMIT 50` (no new view, no trigram), consumed by a `Command`+`Popover` combobox with
  `keepPreviousData`. **Matching is exact on the school's own printed program name** — CollegeData
  publishes each school's list with no standard vocabulary — so the results header renders **`MAJORS_MATCH_NOTE`** — the same
  code-owned string §6a's `query_database` majors rule emits, sitting beside `BAND_CAPTION` in
  `domain/facts/state.py` and delivered on both the `/majors` and `/explore` responses — under the
  major chip: "Matches schools that list this exact program name. A school may offer it under a
  different name."; the combobox is sourced from the endpoint so a student never types a name no
  school uses.
- **Band trust (honesty):** `submitted_percent` has no source under v3, so `classify-fit.ts`'s score
  branches (`shift()`, `TRUSTED_SUBMITTED_PERCENT`, the three comparisons, `FitVerdict.usedScore`)
  are **deleted, not left unreachable**; `FitVerdict` becomes `{category, reason}` — **no `bandTrusted` field is
  introduced** (none exists today: `rg bandTrusted frontend/src` is empty, and `usedScore` is the
  field that does exist and is deleted here; a new always-`false` boolean nothing reads is exactly the
  dead code §10 forbids). The seam a future source flips is the **wire** field
  `BandFact.submitted_percent`, where the missing knowledge actually lives; the wire-delivered band caption (§5.2) renders **once per screen, in
  `ExploreResultsHeader` under the `role="status"` results count (`:177`), whenever at least one
  rendered card shows a score band** — not on each of 24 cards, where a repeated 24-word sentence is
  exactly the noise `VerdictBand.tsx:57-63` was written to avoid, and **never inside
  `PersonalizationChip`'s `w-64` popup (`:71`)**, which is closed by default: a qualifier a student
  must open a filter to read does not qualify the 24 bands already on screen, and an
  `aria-describedby` pointing into an unmounted popup resolves to nothing in exactly the state the
  screen is normally in. Each card's band element carries `aria-describedby` pointing at that one
  persistently mounted node, so a screen-reader user hears the qualifier associated with the band
  without it being repeated 24 times (DESIGN.md §16.1) — one authored string, one DOM node, rendered
  whenever a band is. The score inputs stay — they pick which band each card shows and
  what its "you" number is, and they feed the opt-in `scoreFit` predicate above; on their own they
  hide nothing — and `PersonalizationChip` gains exactly one line: "Your scores pick which band each
  card shows. They only filter the list when you set a score filter." — and **no second copy of the caption** ("We don't know how many reported one —
  treat it as context, not a cutoff." — §5.2's wording verbatim; this section quotes it, it does not
  own it): two sentences saying one thing in a 256px popover is the noise this bullet is otherwise
  removing.
- Index decision (explicit): **none** (§3.1). Budget: p95 ≤ 300 ms server-side; `EXPLAIN ANALYZE` on
  state + admit-rate + major stays under 50 ms (a seq scan by design at this row count).

### 5.4 Chat — the `db` citation (Q3 resolved) and the viz cards

- **Envelope** (appendix F-iii): `SourceName = db|web|edu|reddit`; `Citation.tier: Tier | None` —
  **present and `null`** for `db` (never omitted: `app/sources.py:36` `_is_citation_shaped` requires
  the key, so an absent key would silently mint no marker) and required for the three external
  sources; `db` citations require `school_unitid`, carry `facts_updated_at`, no `url`, no web
  currentness fields; `document_sha256`, `academic_year`, `manifest_version`, `profile_sha256`,
  `source_kind`, `retrieved_at`, `EvidenceItem`, and the envelope's `evidence` field are deleted;
  the web-currentness block survives verbatim. **`source_key(db) = ("db", school_unitid,
  citation.vintage)`** — one rail entry per school **per vintage**, so an identity-profile citation
  (IPEDS snapshot, `get_school_profile`) and a facts citation (crawled, "checked {date}") never
  collapse into one entry wearing one of the two vintages (keying on the school alone would be the
  merge `counselor.md` forbids). `SourceEntry` loses `evidence`/`evidence_omitted_count` on both
  sides; golden fixtures regenerated **backend first** (`REGEN_PROTOCOL_FIXTURES=1 uv run pytest
  tests/app/test_protocol_fixtures.py`, then `npm test`).
- **`reported_period` rides the per-fact `vintage` string**, not the citation (a citation is deduped
  per school; a school's ~250 facts have different periods): code-owned strings
  `"Counselle school data · 2025–26 · checked Sept 2026"` or `"Counselle school data · reporting
  period unstated · checked Sept 2026"` — **one name for the source across every chat surface**, the
  same one the citation hover meta and the accessible name use, never "Counselle facts" beside
  "Counselle school data" in one message; the facts citation's own vintage is
  `"Counselle school data · checked {Month YYYY}"`,
  the identity citation's `"Counselle school data · identity profile from {snapshot_date}"` — the
  source name leads both, because it is the one name for this source on every chat surface and the
  hover meta line is the vintage string verbatim; `source_key` keys the rail on that vintage, so two
  forms would be two rail entries for one thing. The model copies `display` and
  `vintage` verbatim (`counselor.md`'s existing "never merge vintages" law).
- **Chip (appendix D-C, concrete):** same chip shape as every source (DESIGN.md §15.3); icon = the
  existing `SchoolIcon` glyph on **`--brand-chip`** (ink `--brand-chip-ink`) — the existing chip-ground
  role at `semantic.css:406-407`, with its contrast already measured; **no new token, DESIGN.md §2.4
  is not opened for this**, and `--brand-tint` (named in an earlier draft and in appendix D-C) does
  not exist anywhere in `frontend/src/styles/` — naming a nonexistent property in a plan that will be
  implemented literally is how a hardcoded colour gets in, which is DESIGN.md rule 1. The generic-school rung of the favicon chain,
  tinted so it cannot be mistaken for a site favicon: **the school-domain-favicon branch is skipped
  for `db` at all three sites** — `CitationRenderer.tsx:74-86`, `SourcesRail.tsx:117-127`, and
  `MessageSources.tsx:39-52` (`badgeFaviconUrl`, the most visible one) — today they put
  `harvard.edu`'s favicon on a DB citation whenever a viz block is present, exactly the
  misattribution R2 forbids; the branch stays only for viz **column headings**, where the school is
  the subject; label = the school's name (`friendlySourceName` collapses `cds`/`profile` to one `db`
  branch); no tier badge — `TierBadge` (`CitationRenderer.tsx:59-64`) today has **no
  null arm** and falls through to the word "Community", and `VizBlock.tsx:51-66` and
  `SourcesRail.tsx:219-222` carry the same ternary inline, so all three call sites gain an explicit
  `tier === null` guard that renders nothing and `VizBlock.tsx:58`'s `aria-label` stops interpolating
  the tier ("Open source {index}"). "Community" is this app's word for Reddit-tier evidence; on
  Counselle's own data it is the R2 misattribution in a word instead of a favicon; no href; hover card meta line = **the citation's own vintage
  string** ("Counselle school data · checked {Month YYYY}" for facts, "Counselle school data ·
  identity profile from {snapshot_date}" for identity — **lowercase mid-string in both**, the only
  sentence-initial form anywhere being the facts-page freshness line (DESIGN.md §13.4) — never one
  line for both); accessible name
  "{School}, Counselle school data". Rail row: flat (§15.4), same avatar, title not a link (a `db`
  row has no URL — comment the carve-out), meta line as above, **no nested evidence rows, no
  omitted-count disclosure**. `Official`/`Community` badges stay for `web|edu|reddit`. DESIGN.md
  §15.3/§15.4 are edited before this is built.
- **Viz:** `stat_block` and `comparison_table` unchanged (ADR 0024, no third card); cells resolve via
  N× `get_facts` (single-school, keeps `app/viz.py:140-167`, `tool_middleware.py:47,94`,
  `tool_overflow.py:276-283`, `steps.py:370-381` intact); `MetricCellInput.metric_ref` is **renamed
  `fact_key`** (a model-facing name that would otherwise lie — `domain/specs.py:103`, `viz.py`,
  `steps.py:657`, goldens, `test_viz_pure.py:373,374,666,667,673,844,845`, **`tests/domain/test_specs.py:78,98`**,
  **`tests/api/test_transcript.py:312` and `tests/app/test_clarify_v2_agent_seam.py:151,194`** (both
  **routine** — they hand `render_viz` a `{"metric_ref": …}` cell as `ToolCallPart` args, which
  `extra="forbid"` rejects after the rename; both are already in the C-C2 rewrite list, but were
  missing from this rename-site enumeration), **`tests/app/test_run_turn.py:2420,2429,2454,2987,3031,3092,3141,3178`
  and `tests/app/test_protocol_fixtures.py:291,345`** (the same `{"metric_ref": …}` viz-cell dicts;
  both already in the rewrite 35, so no gate breaks — but this bullet claims to be the rename-site
  list), **`tests/app/test_viz.py:51,192`** (`live_db`, constructs
  `MetricCellInput` directly — `:50` is the enclosing row's `label=metric_ref`, not a cell) — **not** `VizBlock.tsx`, which carries no `metric_ref` at all (`rg "metric_ref|metricRef" frontend/src/features/ai-chat frontend/src/api/chat` is empty: the viz wire carries resolved cells, not refs; its `foot` and badge work stays)
  — `MetricCellInput` is `extra="forbid"`, so those two cases fail at execution after the rename); `app/viz.py:128` validates
  against `catalog.snapshot.fact_keys` (not the deleted manifest metric set; `metric_choices` and the
  did-you-mean list draw from the same map); `sourceFocusForCell` → `{index}` only; unavailable cells render **the row's own state word** in
  muted italic — "not reported" / "not checked" (or "not checked yet") / "not on file" / "not collected" — never blank,
  never a dash: the five-state distinction is the point of v3 and the comparison card is the
  most-shared surface in the product, so collapsing four different absences into one inherited "not
  available" would nudge toward "the school doesn't publish it" when the truth is "our crawler
  failed" (DESIGN.md §15.5's "not available" sentence is edited in §6d accordingly); a comparison
  whose `db` cells' `observed_at` spread exceeds `facts_spread_days` carries the `observed_at_spread`
  caveat **once under the table** — which needs a slot that does not exist today: `TabularRenderSpec`
  (`domain/specs.py`) gains a **card-level `foot: tuple[Caveat | str, ...]`** carried through `ev_viz`
  (`domain/events.py:403`) and rendered by `VizBlock.tsx`, because the chat frontend renders **no**
  viz caveat anywhere today (`_apply_mismatch`'s per-cell caveats have never had a consumer), and
  both the spread caveat and the band caption need a card-level home, not a cell-level one; a `db` marker
  used as a sourced cell gets its own rejection message ("… use its fact key so the number is
  re-read from the database"), as `reddit` has; a `db` cell whose `fact_key` is a score band — the
  `class_profile.*_range` **band facts** and the `class_profile.*_p25`/`*_p75` endpoints they are
  built from — carries the band caption (§5.2) under the card — which is why `foot` is
  `tuple[Caveat | str, ...]` and not `tuple[Caveat, ...]`: a `Caveat` for `observed_at_spread`, which
  is a kind with an emitter and a `caveats.yaml` row, and the plain `BAND_CAPTION` **string** for the
  band qualifier, which is not a caveat about *this* school's data but a permanent statement about
  what a middle-50 band means. Making it a ninth kind would break §6a's pinned
  `set(yaml) == set(assertion) == set(CaveatKind)` equality and would hand the model a caveat it could
  attach to unrelated rows; the caption stays exactly what it is in its other two homes (§5.2's group
  `foot`, §5.3's `band_caption`) — one authored string, three deliveries.
- **Prompt rules (§6a for the full edit list):** a middle-50 band "describes the middle half of
  enrolled students who reported a score — never call it a cutoff, a minimum, or a requirement, and
  never say what share submitted"; the `db` deadline is context with its cycle label and for a
  current-cycle deadline question the agent **still confirms on the school's official site**
  (`specs/mvp1/PRD.md` story 31 and eval `routing-current-deadline-web` stand); **never say "not in
  our database" for a school that resolved** — `resolve_school` returns `has_collegedata=false` **and the `not_collected` caveat** (§6a) — one
  authored sentence for this situation, on the wire, in the same slot every other caveat uses;
  `resolve_school` gains no bespoke message field and `SchoolFactsStatus` no sentence field,
  and the frontend honest card distinguishes "We don't have this school" from "No facts collected
  for {school}".

### 5.5 Admin dashboard (D12) — `/app/admin/facts`

- **Backend:** `GET /v1/admin/facts/status` (router-level `dependencies=[Depends(current_superuser)]`,
  the `cds_admin.py:45-49` pattern; reads the **pipeline pool** via a `_facts_admin_parts` copy of
  `_cds_parts` with its clean 503 when the pool is `None`, because `school_pages`/`facts_jobs` are base
  tables) → `FactsStatusResponse` (appendix J-ii, with `status` unions corrected to the five schema
  values): `worker_enabled`, `next_run_at` (last `finished_at` + interval, or the queued job's
  `queued_at`, **null when the worker is disabled**), `queued_or_running`, `last_run` (the full
  `crawl_runs` summary incl. status/error/duration), `coverage` (`sitemap_slugs`, `crosswalk_matched`,
  `crosswalk_unmatched`, `schools_total`, `schools_with_facts`, `unitids_without_page`), `tab_failures`
  (`GROUP BY tab, last_status` over non-`ok`), `stuck_pages` (over threshold), `history` (last
  `facts_admin_history_limit`). `GET /v1/admin/facts/unmapped?page=` is a separate paged endpoint (a
  shape change at CollegeData can produce thousands; they must not sit in the polled payload).
  `POST /v1/admin/facts/passes` enqueues a pass (`ON CONFLICT DO NOTHING`; 409 when one is
  queued/running) — the "Run a pass now" button and the first pass on a fresh DB. All three in
  `api/routes/admin_facts.py`.
- **Frontend** (appendix D-E, concrete): route `/app/admin/facts` in `features/admin-facts/`, wrapped
  in the existing `AdminGate` (which therefore keeps its importer); `navigation.tsx:72-79`'s
  `adminShellRoutes` (its single entry object is `:73-78`, and the `:70-71` doc comment above it
  stays; `DatabaseZap` is already imported at `:10`, so the re-point needs no import change) is **re-pointed** (`{id: "facts", title: "School data", icon: <DatabaseZap/>}`)
  and `AppSidebar.tsx:45-47`'s `is_superuser` ternary is untouched — parking becomes a 3-file *swap*,
  one deletion fewer. One screen: page header ("School data", `[Run a pass now]`, which carries the `Button` `loading` prop **only while its own POST is in
  flight** and otherwise renders **`aria-disabled` with `onClick` suppressed** — never `loading` for
  a state where nothing is loading, and never a real `disabled`, because a `disabled` button is not
  focusable so neither its `title` nor its accessible name is ever announced (DESIGN.md §11.6's
  shipped pattern) — **with its reason in the accessible name whenever `worker_enabled` is false
  ("Set `COUNSELLE_FACTS_WORKER_ENABLED=true`, or run `python -m app.facts --once`, to start a
  pass") or `queued_or_running` is true ("A pass is already queued or running")**, because the
  enqueue would otherwise either succeed into a queue nothing claims — the screen reading "Queued"
  indefinitely — or return the 409 the enqueue route above documents, with nothing on screen to
  explain it; a 409 that still arrives renders as one inline `role="status"` line under the header, "A pass is already
  queued.", not an error card. Beside it the meta line reads "Last checked {date} · next pass in
  {Nh Nm}" or "Worker disabled"); four stat tiles (last
  pass + outcome badge, pages fetched/changed/failed, schools covered N of M slugs and N of `{schools_total}`
  unitids (the tile reads `FactsStatusResponse.coverage.schools_total`, never a literal, so it does
  not go wrong the first time the `schools` seed changes), needs attention: failing tabs / unmapped labels / unmatched slugs); per-tab health table
  (6 rows); recent passes table (last 20: started, duration, pages, changed, errors, rotations,
  backoffs, status); collapsed "Unmapped labels" (`ScrollArea`, paged); collapsed "Unmatched
  CollegeData schools" + "Stuck pages". **Crawl-outcome badge mapping** (DESIGN.md §14.1's closed set;
  §14.3's "the word always, the glyph when severe" — this exact table is what §6d adds to §14.2):
  `succeeded` → `success` "Completed" · `partial` → `warning` "Completed with errors" · `running` →
  `secondary` "Running" (unfilled-ring shape) · `queued` → `secondary` "Queued" (rendered from `queued_or_running`, **not** from `last_run.status`, which has only the five `crawl_runs` values — it is the badge shown when a job is queued with no `crawl_runs` row yet) · `failed` → `error`
  "Failed" + `AlertTriangle` · `aborted` → `error` "Stopped" + `AlertTriangle`. Components only from
  `components/ui/*` (`Card`, `Table`, `Badge`, `Collapsible`, `ScrollArea`, `Button`, `Skeleton`,
  `Empty`) — **zero imports from `features/cds-admin/`**; a live import would make the parked tree
  load-bearing and falsify `PARKED.md`. States: loading skeletons; the §13.1 error card; empty "No
  passes yet" / "Start a pass to populate school facts." / `[Run a pass now]` (guaranteed to occur —
  it is the first state after Phase 1 ships) — and when `worker_enabled` is false, which is the
  shipped default and therefore the *actual* first screen of a fresh deploy: "No passes yet" / "The
  crawler is switched off. Turn it on, or run `python -m app.facts --once`, to collect school facts."
  with the CTA carrying the same treatment and reason as the header's, so a fresh deploy cannot
  enqueue a pass nothing will claim; degraded row "Crawler disabled — showing the last
  completed pass". **A11y/mobile:** the stat-tile row is `aria-live="polite"` and `aria-busy` while a
  refetch is in flight (content changes without user action under polling); both tables carry
  captions and become card stacks below `md:` (DESIGN.md §17.6);
  `features/admin-facts/admin-facts-a11y.test.tsx` joins the Phase 2 a11y tests. Polling
  `refetchInterval: 30 s` **only while a run is `running`**; `staleTime` 30 s. A superuser sees **no**
  CDS surface anywhere (Q16); `/app/admin/cds/*` falls to the SPA catch-all on the backend, and the
  frontend's existing `admin/cds/*` redirect is **re-pointed at `/app/admin/facts`** rather than
  deleted — `router.tsx`'s own 12-line comment records that letting it fall through to `*` lands the
  operator on `/app/tasks` with no explanation, and the owner holds the bookmark. (For the one phase
  before `/app/admin/facts` exists — the route lands in Phase 1 — the redirect falls through `*` to
  `/app/tasks` exactly as deleting it would; accepted, and self-healing.)
- **Health:** `GET /v1/health` drops `"mcp"` and gains `"facts_worker": "disabled" | "ok" | "stale"` —
  `stale` when the last run finished more than `2 × facts_crawl_interval_hours` ago or its status is
  `failed`/`aborted` (a `partial` run is healthy — its per-tab failures are the dashboard's job, and
  with 15k pages and R11 `partial` is the steady state); `stale` degrades `status` to `"degraded"`
  (200, students are still served) so an uptime check catches a silent crawler.

### 5.6 Workspace and other flows

- **Add-school prefill (Q4 resolved, recommended default):** the confirm step offers the CollegeData
  deadline **only for a round the fact store actually distinguishes** — `ED → deadlines.early_decision`,
  `EA → deadlines.early_action`, `RD → deadlines.regular` — and offers **nothing** for `ED2`, `REA`,
  `Priority` and `Rolling`, the other four members of the shipped `Round` union
  (`frontend/src/api/workspace/types.ts:13`), which CollegeData does not publish separately: a nearby
  round's date is not this round's date, an ED II or priority date is one to three months from the
  regular one, and an unoffered field is cheaper than a wrong one. It is offered **only when the
  deadline's `reported_period` cycle matches the
  application cycle being added**, as a suggestion chip, never a pre-filled input, carrying "From
  Counselle's facts — {cycle} cycle, checked {Month YYYY}. Confirm on the school's site." When the
  cycle does not match, the deadline is `"Rolling"`, the round is one of the four unmapped ones, or
  the round has no deadline fact, **nothing is offered** — an out-of-cycle date in a field that is never re-synced (ADR 0027's user ownership
  stands) is the most expensive wrong value in the product (`specs/mvp3/workspace-design.md`: "never
  a silent guess"). `service_reference.py` gains no deadline reference.
- **Applications test-policy clarification** (`app/workspace/service_reference.py:81-89`, today a
  cycle gate): the ref is `admissions.test_policy_clarification`; v3 calls
  `get_facts(unitid, keys=["admissions.test_policy_sat_or_act"])`; the row is **available with the
  vintage "checked {date}"** when its `observed_at` is within `facts_stale_days` (CollegeData's
  admission requirements page is the school's current published policy), and **unavailable with the
  `stale_facts` caveat** otherwise; the clarification renders the source's printed phrase verbatim
  (`display`), never a re-labelled category — the gate survives as a freshness gate, not a cycle gate (test
  policy rows carry no `reported_period`). Phase 0 interim: `_compatible_test_policy` returns `None`
  while `cds_data_enabled` is false (three lines, removed in Phase 3).
- **Database reset notice (Q14, revised):** the nuke deletes every account, so there is no logged-in
  user to notify in-app and a first-time user shown "your conversations were cleared" would be told
  something false. Instead **`AuthLayout`** — which wraps both `/login` and `/register` (`LoginRoute.tsx:74`,
  `RegisterRoute.tsx:99`; the component is `frontend/src/features/auth/AuthLayout.tsx`), so there is one implementation and the user who follows "sign up again" still
  sees it — carries a dated, dismissible line while
  `db_reset_notice_date` is set and within the window: "Counselle's database was rebuilt on {date}.
  Nothing from before then was carried over — accounts, chats, college lists, essays, tasks,
  activities, honors, student profiles and uploaded documents are all gone. If you had an account
  before then, please sign up again."
  (The `counselle` schema D9 drops holds fifteen tables, essays and their change history among them;
  naming three of fifteen would tell a student by omission that their essays survived, on the one
  screen written to be honest about the loss. The leading sentence is the whole claim and the list is
  what a student recognises, so it enumerates **every workspace surface the app puts in the sidebar**
  and nothing internal. A Phase 4 checklist item asserts that every user-creatable workspace surface
  in `navigation.tsx` appears in this sentence — **not** that this list equals the deployer-facing
  runbook line, which names OAuth links, sessions and feedback no student would recognise; the two are written for different readers and are checked separately. The list stays in the **third
  person** and the instruction is **conditional**, because `AuthLayout` wraps `/register` as well as
  `/login`, so the guaranteed audience includes people who never had an account — telling them *their*
  profile is gone is the exact falsehood this notice was moved out of the app to avoid.) The date is served by a new **unauthenticated** `GET /v1/config/public` in the existing
  `api/routes/config.py` (`{"db_reset_notice_date": …}` and nothing else; the authed `/v1/config`
  payload is unchanged and stays authed) — the audience for this notice is by construction people who
  **have no account any more**, so reading the date from `Depends(current_active_user)`
  (`api/routes/config.py:91-93`) would mean it never renders for a single person it was written for.
  `AuthLayout` fetches it with `staleTime: Infinity`; dismissal is per-browser `localStorage`
  (the only store a signed-out visitor has); the window is `db_reset_notice_days` (§4.3), not a bare
  literal. The Phase 4 runbook keeps its line.
- School search in the workspace (`/v1/schools/search` over `school_profiles`) is untouched.
- History: `school_facts.valid_from/valid_to` is **written now and read by nothing** — deliberate,
  stated, and the reason there is no history index; the first reader (a "changed on {date}" line or an
  admin diff) is a later feature and a `TODOS.md` line.

---

## 6. Consequences (exhaustive; verified file:line, appendix C/D/F/I for the tables)

**Phase boundary (the rule every list below obeys):** Phase 0 nukes the database and parks CDS but
**keeps every module the agent's DB-tool surface is built from in the tree, compiling and
importable, until Phase 3** — the tools themselves go dark, and the agent is web-only on the branch
from P0 to P3 (§7) — by reusing the existing escape hatch —
`COUNSELLE_CDS_DATA_ENABLED=false` (`app/deps.py:115-122` builds no MCP toolset; `api/main.py:91-95`
installs `NoopMcpSupervisor` in its `:94` arm) — so nothing that `server.py`,
`supervision.py`, `evidence_markers.py`, `legacy_citations.py` or the frontend protocol pins is
deleted before its replacement exists. Phase 0's edit to the hatch: it collapses to
`catalog = await Catalog.load(...)` unconditionally (whose manifest block is gone, so it loads on an
empty facts store and keeps the 2,746-name index the workspace needs) with
`mcp_toolset = None if not settings.cds_data_enabled else build_mcp_toolset(settings)`, and
`EmptyCatalog:89-106` is **deleted in Phase 0, the phase that orphans it** (§10's DEAD rule; ruff's
`F` rules do not flag an unused module-level class, so nothing else would catch it).
**The data picture cannot be skipped by the hatch once a real `Catalog` is loaded** —
`app/graph.py:96` branches on `snapshot is None`, not on the flag, so `render_data_picture(snapshot)`
runs on every turn and reads `snapshot.coverage_aggregates`/`domain_counts`/`domains`/
`current_version`/`total_metrics` (`app/prompt.py:42,52,60,61`), every one of which Phase 0's catalog
rewrite removes. Phase 0 therefore **also** lands the v3 `render_data_picture` / `_DATA_SLOTS` /
`data_picture.md` rewrite (§6a's Phase 3 entry for `app/prompt.py` moves to Phase 0, minus
`section_menu`/`fact_key_count`, which render as `not yet collected` until Phase 1 ships
`facts_sections.yaml` and Phase 3 the catalog keys), and `app/graph.py`'s `_NO_CDS_DATA_PICTURE:54-59`
and **its arm `:97-99` together with the `)` at `:103` that closes the `else (` opened at `:97`**
(deleting `:97-99` alone would leave `:103` and `:104` closing one opener — a `SyntaxError` at Phase
0's own gate); the expression collapses to
`data_picture = (render_data_picture(snapshot) if snapshot is not None else state.get("data_picture", "Live data picture unavailable in this test harness."))`.
Both are deleted in
**Phase 0**, not Phase 3 — but **`:96`'s `if snapshot is not None` guard and `:100-102`'s
`state.get("data_picture", "Live data picture unavailable in this test harness.")` fallback stay**:
`tests/app/test_run_turn.py:238,618` and `tests/app/test_durability.py:128` pass a `SimpleNamespace`
catalog with no `snapshot` and run `prepare` for real, so deleting the whole `:96-104` conditional
would both leave an unclosed parenthesis and break the routine suite at Phase 0's own gate. Phase 3 deletes the hatch, the MCP
child, the supervisor, evidence and legacy modules, and mounts the in-process tools **in one commit**
with the envelope rewrite and the regenerated goldens — the agent is never tool-less on a demoable
build; between P0 and P3 it runs web-only on `feat/school-data-v3` and `main` stays the demo.

### 6a. Backend

- **Phase 0 rewrites:** `counselle_db/catalog.py` (drop `_MANIFEST_SQL`, `_COVERAGE_SQL`,
  `Catalog.domain()`, the manifest block and its boot gate at `:145/152`; **`hex_digest` moves to the live `counselle_db/formatting.py` in Phase 0** — `catalog.py:207`
  needs it for `profile_sha256`, which survives v3 long after the manifest block is gone, so leaving
  the `:18-24` import pointed at the parked `packets.py` would make `Catalog`, a boot-path module,
  a permanent runtime→parked edge (`counselle_db/service.py:751` already does the same thing inline);
  `packets.py` imports it back from `formatting.py`, a **ninth** parked→runtime edge listed in
  `PARKED.md`; keep the profile-catalog
  gate `:149-150` — it is what turns a seed that failed to load `schools` into a boot crash; load
  schools + `school_data_status`; `CatalogSnapshot` **gains `fact_keys` and `sections` in Phase 0**, both empty — the facts store has
  no rows and `facts_sections.yaml` does not exist yet — because `app/viz.py:128,352` reads
  `fact_keys` in this same commit and is typed `catalog: Catalog`; **`fact_keys` is filled in Phase 3** (from `fact_coverage`, for viz
  validation and the data picture); **`sections` is filled in Phase 2**, from the
  `facts_sections.yaml` Phase 1 ships — Phase 2's `get_facts`, facts route, and
  `fetch_state`/`never_checked`/`not_published` rendering for keys with **no row** have no other data
  path (§5.2), so an empty map would fail Phase 2's own exit tests); **`counselle_db/service.py` — `get_domain:757` (whose
  `catalog.domain()` call at `:758` would otherwise fail mypy once `Catalog.domain()` is gone),
  `_live_document:627` and `_coverage:604` are stubbed to raise `ServiceError` in Phase 0 (their
  tables no longer exist) and fully removed in Phase 3**; `app/prompt.py` + `data_picture.md`
  (moved up from Phase 3, above); `app/graph.py` (`_NO_CDS_DATA_PICTURE:54-59` + **its arm `:97-99` and the `)` at `:103`** that
  closes the `else (` at `:97`; the `:96` `snapshot is not None` guard and the `:100-102` harness
  fallback stay — see the phase boundary
  above; moved up from Phase 3); `app/deps.py:115-122`
  (collapse the hatch to an unconditional `Catalog.load`, rewrite `:74-76`'s `pipeline_pool` comment
  — it names `cds_data_enabled` and `EmptyCatalog`, both dead in this phase — keep the flag only for
  `mcp_toolset`, and
  **delete `EmptyCatalog:89-106` here**); `app/workspace/service_reference.py`
  (the three-line interim guard, §5.6); `api/main.py:49` import **and** `:277` mount of `cds_admin`,
  `:64` import + `:111-115` start + `:119-122` stop of `start_cds_worker` and `app.state.cds_poller`
  (replaced by `start_facts_worker`; `PARKED.md` lists the four lines revival re-adds);
  `config/settings.py` (`cds_worker_enabled` default → `False`; add the `facts_*` block; keep
  `supported_packet_extractor_versions:264-273` **with a `# parked (ADR 0036)` comment** — read by
  the parked `adapters/cds_store.py:468`; keep the `cds_*`/`model_cds_*` block as parked; keep
  **`_SECRET_FIELDS:46-57`** — it is live secret redaction at `:505`, not an MCP allow-list; the MCP
  env allow-list is `serialize_db_child_environment`'s body and dies in Phase 3); `api/context.py:226-229`
  (`MaxBodySizeMiddleware` reads `max_request_body_bytes`); `scripts/seed_reader_db.py` (§3.3, §6c);
  `pyproject.toml` (`tenacity` direct dependency; delete the `:112` mypy override for
  `tests.app.test_evidence_markers` in Phase 3) + `uv.lock`; `scripts/entrypoint.sh:20` (comment)
  and its `required_env` (+ `COUNSELLE_DB_ADMIN_DSN`, + `COUNSELLE_DB_PIPELINE_DSN` — under v3 the
  seed owns every object, so a missing admin DSN is not a degraded mode); `scripts/chat_cli.py:6`;
  **`tests/counselle_db/test_catalog_contract.py`** (moved up from the Phase 3 rewrite list: it is a
  routine, non-`live_db` test that drives the real `Catalog` on a fake pool, imports `compile_manifest`
  and `get_domain`, and calls `catalog.domain("enrollment")` at `:281`); **`app/viz.py:128,352`** —
  `catalog.snapshot.metrics` disappears with the manifest, so the fact-key validation and the
  `metric_choices` did-you-mean list move here as `catalog.snapshot.fact_keys` (empty until Phase 3
  fills it; an empty map rejects every metric cell, which is correct while the agent is web-only);
  **`tests/app/test_viz_pure.py` moves into Phase 0 with it — the second instance of
  `test_caveats.py`'s trap class, and the only other one in the tree.** It is a routine test whose
  catalog is `cast(Catalog, SimpleNamespace(snapshot=SimpleNamespace(…, metrics=…, …)))` at five sites
  (`:36-40`, `:49-51`, `:427-431`, `:501-505`, `:790-792`), so it is invisible to `mypy .` (the
  `cast`) **and** to this phase's `snapshot.<attr>` grep (keyword arguments); and `render_viz` reads
  `catalog.snapshot.metrics` at `:352` **unconditionally**, after the `_fetch_groups` try/except, not
  only for metric cells — so every `render_viz` case in the file raises `AttributeError` the instant
  `:128,352` switch to `fact_keys`. Phase 0 renames `metrics=` to `fact_keys=` in all five stubs and
  nothing else; its module-scope `DomainRow`/`DomainResult`/`AvailabilitySummary` imports and the
  `fact_key`-rename assertions stay in Phase 3, so this file — like `api/routes/system.py` — is
  deliberately **touched in two phases**, and the rewrite count is unchanged at 35 (it is already
  C-C2 entry 3; only its phase moves),
  while its `_apply_mismatch`/`foot`/state-word/`fact_key`-rename work stays in Phase 3;
  **`evals/runner.py`** — `build_eval_context:190-316` reads `snapshot.coverage`/`domains`/`metrics`/
  `current_version` at thirteen sites, every one an `attr-defined` error under the repo-wide `mypy .`
  (`pyproject.toml:91` excludes only `artifacts/`, `plans/`, `specs/cds-pipeline/tuning/` — **not**
  `evals/`), so the wholesale rewrite lands here — **including
  `_school:165-175`**, which reads `snapshot.coverage` from a parameter typed `Any` (invisible to
  mypy, caught only by the grep gate) and whose `EvalSchool` fields
  `domains`/`academic_year`/`currentness`/`partials` have no v3 producer — and **`get_domain` drops out of the `:38-41`
  import in this phase**, because after the `build_eval_context` rewrite its only two call sites
  (`:224`, `:283`) are gone and ruff's F401 would fail Phase 0's own lint gate;
  `_join_has_exact_document_keys` and `_ordered_column` stay, their callers being inside the
  `:486-574` block Phase 3 deletes, so the Phase 3 commit only re-points those two and the scorer
  branches; **`tests/evals/test_scorers.py`
  moves into Phase 0 with it** — the third instance of the `test_caveats.py` trap class and the only
  importer of `evals.runner` in the tree: no marker (45 routine tests), under the repo-wide `mypy .`
  with no `pyproject.toml:112-122` override, and invisible to this phase's `snapshot.<attr>` grep
  because it never touches a snapshot. It imports `_require_metric_ref` at module scope (`:18`) —
  whose only callers are inside the `build_eval_context` this phase rewrites — and its
  `make_context():69-96` fixture, which most of the file runs through, builds `EvalSchool` and
  `EvalContext` with the manifest-era fields. Phase 0 re-points those constructions and deletes
  `test_required_eval_metric_never_falls_back_to_an_unrelated_ref:1022-1025` with the helper; its
  scorer-branch work stays in Phase 3, so this file — like `tests/app/test_viz_pure.py` and
  `api/routes/system.py` — is deliberately **touched in two phases**, and the rewrite count is
  unchanged (it is already inside C-C2's 26); **`tests/counselle_db/test_foundation_regressions.py:12,15,34-35`**
  — a routine (non-`live_db`) test importing `format_cds_edition` and calling `_coverage` directly;
  **`tests/counselle_db/test_live_db.py:13,14,17,20,23,25,46` and `tests/app/test_viz.py:59`** —
  classified "dormant, untouched" in earlier rounds, which is wrong twice over: both take a **typed**
  `catalog: Catalog` and read `snapshot.{current_version, manifests, current_contract, coverage,
  domain_counts, metrics}`, and **a `live_db` marker gates pytest selection, never `mypy .`** (neither
  carries a `pyproject.toml:112-122` override), so both are `attr-defined` errors the moment Phase 0
  lands; they are rewritten **here** against the v3 six-view contract and the v3 snapshot. Both also
  import `get_domain` from `counselle_db.service` at module scope (`test_live_db.py:7`,
  `test_viz.py:21`), and `test_viz.py` additionally builds `MetricCellInput(metric_ref=…)` at `:51,192`
  and reads `DomainResult.rows`/`row.available`/`row.ref` at `:62-68`, so both are touched **again**
  in the Phase 3 commit and join appendix C-C5;
  **`tests/app/test_caveats.py:30-47`** — `test_data_picture_formats_snapshot_in_manifest_order`
  builds a manifest-shaped `SimpleNamespace`, `cast`s it to `CatalogSnapshot` and asserts on
  `render_data_picture`'s manifest sentence, so it is invisible to **both** mypy (the cast) and the
  Phase 0 `snapshot.<attr>` grep (keyword arguments, not attribute reads); it is rewritten against the
  v3 data picture in this commit, while its other two cases (`render_caveat`, `validate_prompt_assets`)
  are unaffected until Phase 3.
- **Phase 3 rewrites (26 modules + 4 assets):** `counselle_db/service.py` (the three Phase-0 stubs are deleted outright here; ~500 of 1,058 lines are the
  packet/manifest guards — `_reject_packet_projection:301`, `_reject_manifest_text_search:338`,
  `_selected_document_cte:364`, `_reject_unselected_cross_school_ranking:499`,
  `_reject_non_manifest_json_helpers:562` + 13 helpers — plus `get_domain:757`, `_live_document:627`,
  `_coverage:604`, and `resolve_school:643` whose `SchoolCoverage` (`models.py:27-37`, ten CDS fields)
  becomes `SchoolFactsStatus {facts_updated_at, fact_count, has_collegedata, tabs}`); it is then
  **split**: `counselle_db/service.py` (resolve, profile, `get_facts`, `explore`, `majors`, name
  search) and `counselle_db/sql_guard.py` (`_guard_sql`, allow-lists, `query_database`), ~300 lines
  each; `counselle_db/catalog.py` (load **`fact_coverage` filtered to non-`explore.*` rows with
  `schools_with_value > 0` into `CatalogSnapshot.fact_keys`** (`sections` was already loaded in Phase 2) — the fact-key universe for viz validation and the data picture; the class stays — it is a real
  2,746-row name index with nine `Catalog.load` fixtures: `tests/counselle_db/conftest.py:42` + eight
  `live_db` workspace fixtures); `counselle_db/models.py` (`DomainRow`, `AvailabilitySummary`,
  `DomainResult`, `SchoolCoverage` → `FactRow`, `FactsResult`, `SchoolFactsStatus`);
  `counselle_db/db.py` (docstrings only); `counselle_db/formatting.py` (docstring only — Phase 0 moves `hex_digest` in and Phase 3 moves `format_cds_edition` out, so "shared by profile and packet reads" is wrong after each); `app/tool_middleware.py` (`_normalize_db_payload:46` is a
  literal `get_domain` switch → **`{get_facts, get_school_profile, resolve_school}`** minting the
  `db` citation (the minting set and the vintage each tool mints are both decided in the
  `step_labels` bullet below; `query_database` mints none);
  `_caveats:21-40` becomes slot-driven from `caveat_catalog()` instead of a hand-list that silently
  drops an unlisted kind); `app/sources.py` (`source_key` `db` branch with vintage; delete
  `register_pending_evidence`, `promote_pending_evidence`, `pending_evidence`,
  `register_used_evidence`, `restore_pending_evidence_tokens`, the evidence branch of
  `annotate_envelopes` (**`:176-187` only** — `:174-175`, `if marker:` and
  `annotated["marker"] = marker`, is the marker assignment every citation of every source depends on
  and **stays**; deleting it leaves syntactically valid code in which no tool result ever carries a
  citation marker again), the `(page, eid)` sort and `evidence_omitted_count` in
  `entries_for_wire`); `app/transcript.py:16,144` and `app/run_handle.py:14,47` (importers of the two
  deleted modules); `app/viz.py` (`:128` fact-key validation, `_apply_mismatch:244-262` →
  `observed_at_spread`, the `db` sourced-cell message, the per-row state word on unavailable cells,
  and **the new card-level `foot: tuple[Caveat | str, ...]` on `TabularRenderSpec`** carried through
  `ev_viz` (`domain/events.py:403`) — today the chat renders no viz caveat anywhere, so both the
  spread caveat and the band caption need this slot, not the cell-level `caveats` nothing displays;
  `fact_key` rename);
  `app/prompt.py` (`_DATA_SLOTS` → `as_of, n_schools, snapshot_date, facts_updated_range,
  schools_with_facts, fact_key_count, section_menu, stale_count` — **landed in Phase 0** per the phase
  boundary above; Phase 3 only fills `fact_key_count`/`section_menu` from the catalog);
  `app/toolset.py` (delete
  `build_mcp_toolset:120-143`, `annotate_mcp_result`, `_DEFAULT_AGENT_MCP_READ_TIMEOUT_SECONDS:117`;
  add the four in-process tools); `app/agent_node.py:799,862` (`toolsets=[mcp_toolset]`);
  `app/deps.py` (delete the `cds_data_enabled` flag — the DB is never
  optional; `EmptyCatalog` is already gone in Phase 0; `AppDeps.mcp_toolset:47,58,157` (the dataclass is `AppDeps` at `app/deps.py:42`; `ToolDeps` is a different class at `app/toolset.py:56` with no such field); **`on_failure:50,60` dies with the supervisor** — its
  only producer is `api/main.py:99`, so the hook, its guarded call at `app/run_turn.py:469-478`, and
  `tests/app/test_run_turn.py:2022-2046` go); **`app/run_turn.py:469-478`** (that guarded
  `on_failure` call and its comment — the file is edited, so it belongs in the changeset list);
  `app/steps.py`; `app/tool_overflow.py`
  (`_ALLOWED_TOP_LEVEL_STR_KEYS:239`, the key list `:262`, the flattening comment `:276-278`;
  `read_tool_result` stays — tool-agnostic spill machinery); `app/caveats.py` +
  `config/assets/caveats.yaml` (below); `app/state.py`; `app/workspace/service_reference.py` (§5.6);
  `domain/envelope.py` (§5.4: the loud gate `:153-160` and the silent drop `app/sources.py:81` both
  go; **add `CaveatKind = Literal[…]`** with the eight v3 kinds — `Caveat.kind` becomes `CaveatKind`
  instead of a bare regex-validated `str` (`:24`), and it is the type side of the three-way equality
  test below, which today has only two sides because no `CaveatKind` exists anywhere in the tree), `domain/events.py`, `domain/specs.py` (`SourceConfig` names, `fact_key` at `:103`);
  `api/main.py` (the `McpSupervisor` block: `:13-14,17` docstring, `:62` import, `:78`, `:91-99`,
  `:106` `app.state.mcp_supervisor`, `:126` `aclose()`); `api/routes/system.py:20-21,26,67`
  (supervisor + `mcp` key → `facts_worker`; **this file is touched twice** — Phase 1 adds the
  `facts_worker` key, Phase 3 drops `mcp` — so the Phase 1 commit is not surprised by it); `config/settings.py` (delete `DbChildSettings:60-93`,
  `get_db_child_settings:97`, `serialize_db_child_environment:514-534`, `agent_mcp_read_timeout_s:347`,
  `source_evidence_max_items:275` (sole consumer is the evidence cap), `cds_data_enabled:259`;
  verified: no CDS field is required, so boot never rejects the parking posture); `evals/runner.py`
  (**same commit as the service rewrite**: `:38-40` still imports the two service privates `_join_has_exact_document_keys` and
  `_ordered_column` (`get_domain` left this import back in Phase 0, where its call sites died);
  `build_eval_context:190-316` is a wholesale rewrite; **`:486-574` is live, not dead** —
  `_has_selected_document_candidate_sql` is called at `:920` — so it goes together with the
  `selected_document_sql` scorer branch `:915-922`, the `expects.selected_document_sql` key on
  `denominator-most-selective`, and the `template_absence_live` scorer `:937-959`); assets
  `step_labels.yaml` (the `get_facts` row with **`tier: null`** — a `db` result
  carries no tier (§5.4), and the same edit drops `tier: official` from `resolve_school:16`,
  `get_school_profile:25` and `query_database:41` to `null`, since the timeline's tier grammar must not assert
  what the citation panel one step over declines to. **Which tools mint a citation is decided
  here:** `get_facts`, `get_school_profile` and `resolve_school` each mint one `db` citation for the
  school they name (`_normalize_db_payload`'s branch is `{get_facts, get_school_profile,
  resolve_school}`) — and **which vintage each mints is decided here too**: `get_facts` mints the
  facts vintage ("Counselle school data · checked {Month YYYY}") from that school's
  `facts_updated_at`, while `get_school_profile` **and `resolve_school`** both mint the identity
  vintage ("Counselle school data · identity profile from {snapshot_date}"), which is what collapses
  them into one rail row rather than two (`source_key` keys on the vintage, §5.4) and what keeps the
  "two rail entries with distinct vintages" gate a statement about `get_school_profile` + `get_facts`
  alone. **A facts vintage is never minted over a null `facts_updated_at`:** on a school with
  `has_collegedata=false`, or one whose every tab is `never_fetched`, `get_facts` mints the identity
  vintage instead — "Counselle school data · checked ." is the same empty-slot freshness claim about
  nothing that §5.2 strikes from the deadline foot, reappearing on the citation panel, and the
  `not_collected`/`not_fetched` caveat is what carries the real statement there. `query_database`
  mints **none**, because appendix F-iii's validator requires
  `school_unitid` and a cross-school result has no single school. Its honesty carriers are the ones
  §6a already gives it — the `coverage_denominator` caveat and the printed-name sentence — and
  `counselor.md`'s Composition Laws gain the matching law: **a number about one named school is
  never quoted from a `query_database` result; it is re-read through `get_facts` so the claim
  carries a citation**, the same rule §5.4 already enforces on viz cells. A `query_database` answer
  may name the *shape* of the result (how many schools matched, the denominator) without a
  per-school citation; it may not state a school's value without one; the field drives the timeline's icon grammar; **the `get_domain` row `:31-38` is deleted with the tool** —
  `app/toolset.py:161` feeds the whole asset into `build_tool_specs`, so a leftover row mints a
  `ToolSpec` for a tool nothing mounts — and the rewritten `tests/app/test_tool_specs.py` keeps the
  shipped **set-equality** form (`:118`, `set(specs) == mcp_tools | FUNCTION_TOOLS`) with the mounted
  in-process toolset in place of `db_server.mcp._tool_manager.list_tools()`, not a weaker "every
  mounted tool has a row": equality in both directions is the only thing that catches a stale asset
  row, and `:137`'s `specs["get_domain"].unavailable_label` assertion moves to `get_facts` with it), `caveats.yaml`, `counselor.md`, `data_picture.md`, and **`season_calendar.yaml:15-16`** — its "School-specific dates are data (CDS fields or live web), never inferred from this generic calendar" comment names a source v3 retires; it becomes "School-specific dates are crawled facts with their own `observed_at`, or live web, never inferred from this generic calendar." No gate reaches it as written: the Phase 3 prompt/skill grep walks `prompts/*.md` and `skills/**`, and the D3 `collegedata` grep names five other files, so a yaml comment is invisible to both — which is why that Phase 3 grep is widened to `config/assets/*.yaml` below. The other six `config/assets/*.yaml` were walked for the same class and are clean: `caveats.yaml` is already on this list, and `greeting_templates.yaml:2`/`season_calendar.yaml:2`'s "domain.season" names the Python package, not a CDS domain.
- **New:** `domain/facts/{models,normalize,state,period}.py` (pure; mypy strict and the purity gate
  reach only `domain/` — the honesty core must live there; imports only stdlib + pydantic),
  `adapters/collegedata/{fetch,parse}.py`, `adapters/facts_store.py` (all asyncpg writes),
  `adapters/facts_queries.py` (dashboard reads), `app/facts/{__main__,crawl,mapper,crosswalk,jobs,
  service,service_explore,service_admin,models}.py`, `app/model_selection.py` gains
  `model_name_from_setting`, `api/routes/{schools_facts,admin_facts}.py`,
  `config/assets/{facts_keys,facts_sections}.yaml`, `config/facts/collegedata_crosswalk.csv`,
  `scripts/build_crosswalk.py`,
  `scripts/build_facts_sections_tabs.py` (regenerates every `facts:` entry's `tab:` and each section's
  derived `tabs:` union from `facts_keys.yaml` — it never touches `label:`, which is authored copy; run by hand when the mapper's owning tabs change,
  never at runtime), `deploy/docker-compose.dev.yml`, `tests/test_view_contract.py`,
  `PARKED.md` (repo root), `docs/adr/0037-collegedata-facts-store-cds-parked.md`. Manifest with sizes:
  appendix J-i (rows 20/21 extended with `/majors`, `/unmapped`, `POST /passes`; the explore/majors
  execution lives in `counselle_db/service.py`); every file < 800 lines, every function < 50, both
  new `__init__.py` empty.
- **Phase 2 edits to existing files (not rewrites):** `api/routes/config.py` gains
  `GET /v1/config/public` — unauthenticated, `{"db_reset_notice_date": …}` only, mounted beside the
  existing authed `/config` at `:91-93`, which is untouched. (`api/routes/system.py` is the other such
  file: it gains the `facts_worker` key in Phase 1 and drops `mcp` in Phase 3.)
- **`get_facts` contract** (docstring in appendix F-i, section list corrected to six, **and the state
  paragraph corrected from "the three unavailable states" to four**, with `not_published` written in
  full — "`not_published` (the source publishes no such page for this school, so there is nothing to
  report — not a value the school withheld)"; `FactRow.state`'s Literal is `"value" | "not_reported" |
  "not_fetched" | "not_published" | "not_collected"`, equal to `domain/facts/state.py`'s union and
  asserted by the same Phase 3 test that pins the caveat set. The docstring **is** the model contract
  (§2), and a missing state would leave the agent to describe a `not_published` row with whichever of
  the other three it guesses — the two likeliest guesses being the two the caveat text explicitly
  says it is not): `get_facts(unitid,
  sections?|keys?)`, single-school, at most one narrowing argument; with neither it returns the
  `facts_sections.yaml` headline + group keys only (never `unmapped:*`), capped at `get_facts_max_rows`
  (60) **in the service, before the middleware**, returning `truncated: true` + the school's section
  list so the model's next move is `sections=[…]`, not a `read_tool_result` spill (the overflow cap
  is 8,000 chars and a whole school is 200–260 facts). Rows carry `key, label, section, state,
  display, value, unit, reported_period, vintage, caveat_kinds` — where `label` is
  `facts_sections.yaml`'s authored label, the same string the page renders, so the model and the
  page never name one item two ways. **One reader:**
  `counselle_db/service.get_facts` is the only code that touches `current_school_facts`; the HTTP
  facts route calls it through `app/facts/service.py`, which adds only layout and the deadlines block on top, reading the
  section/group/`tab:` map from `CatalogSnapshot.sections` (§5.2) rather than loading
  `facts_sections.yaml` itself — the asset has exactly one loader, the catalog.
- **Citation seam:** every in-process DB tool calls `process_tool_result(...)` on its own result
  (the `app/toolset.py:216-238` shape); Phase 3 asserts end-to-end that a `get_facts` result mints
  exactly one `db` citation and one registry marker, and that a turn calling `get_school_profile`
  and `get_facts` for one school yields two rail entries with distinct vintages.
- **Cross-school honesty replacement** (the packet rejectors go; what survives, in code):
  (1) `_ALLOWED_RELATIONS` = `school_profiles, school_facts_sql, school_explore, school_data_status,
  fact_coverage` — `current_school_facts` is reader-granted but **not** allow-listed; this is an
  application allow-list, not a grant, and a test asserts SQL naming `current_school_facts` or any
  base table is rejected before it reaches the pool. `school_explore` is on the list because
  `majors`/`sports` and the typed filter columns live only there — without it "which Ohio schools
  under $30k offer nursing" has no agent tool while the Explore screen answers it.
  (2) `_reject_binary_projection` kept as a backstop; `_reject_manifest_text_search` is replaced by a
  **`LIKE`/`ILIKE` on `fact_key` rejector** ("fact keys are exact; bind the key as a parameter") — the
  v3 form of the same "membership is structural, never substring" property; the jsonb helpers leave
  `_SAFE_FUNCTIONS`; the selected-document machinery has no analog. Layers 1–8 of `_guard_sql`
  (single statement, sqlglot parse, forbidden nodes, schema-qualified allow-list, contiguous `$n`,
  binary-param rejection, row cap, readonly + timeout) are unchanged.
  (3) **Denominators:** `_named_fact_keys()` collects keys from bound `params` (strings that exist in
  `snapshot.fact_keys` or are `explore.<column>`) and from string literals on the RHS of
  `fact_key = …`/`IN (…)` predicates in the AST, filtered to known keys (an unknown string can never
  fabricate a denominator); `QueryResult` gains `coverage: [{fact_key, schools_with_value,
  schools_total, as_of}]` from `fact_coverage` in the same readonly transaction; when the AST has an
  `AggFunc` or `Order` over a facts/explore column and ≥1 key resolved → `coverage_denominator`
  caveat; when it has one and **no** key resolved → the warning says "denominator unavailable — bind
  the fact key as a parameter" rather than returning an uncontextualized ranking. A `majors`-shaped
  query carries **two** statements: the `explore.majors` coverage row (how many schools published a
  list at all) **and** the code-owned sentence that the match is on the school's printed name.
- **Delete (Phase 3):** `counselle_db/server.py` (the MCP child; docstrings moved first),
  `api/supervision.py` (+ `tests/api/test_supervision.py`, `tests/api/conftest.py:153,255,286`'s
  `_FakeSupervisor`, `tests/api/test_context.py:71,78`, `tests/api/test_workspace_routes_live.py:44`),
  `app/evidence_markers.py` (4 runtime importers: `sources.py:11`, `tool_overflow.py:20`,
  `agent_node.py:64`, `run_handle.py:14`; 2 test files), `app/legacy_citations.py` (importer
  `transcript.py:16`), `scripts/mcp_smoke.py`, the `pyproject.toml:112` mypy override.
  **Delete (Phase 0):** `scripts/dispose_cds_pollution.py` (+ `tests/adapters/test_cds_disposal.py`),
  `deploy/seed/schema.sql`.
- **Park (in tree, gated, importable):** `domain/cds/`, `app/cds/`, `adapters/cds_*`,
  `api/routes/cds_admin.py`, `config/cds/`, `counselle_db/packets.py`, scripts `publish_cds_manifest.py`,
  `cds_domain_diff.py`, `verify_cds_engine.py`, `verify_cds_adapters.py`, `_cds_crash_test_worker.py`,
  `cds_manifest_check.py`, `specs/cds-pipeline/tuning/`. **Parking switch = `COUNSELLE_CDS_WORKER_ENABLED=false`
  plus the removed lifespan call**, *not* an unset `COUNSELLE_DB_PIPELINE_DSN` — the facts crawler
  needs that DSN, and with it set the untouched `start_cds_worker` would poll the dropped
  `cds_extractions` table every 3 s forever, log-spamming (`app/cds/jobs.py:184-189` gates only on
  the pool and `cds_worker_enabled`, default `True`). `counselle_db/formatting.py` is **live**, not
  parked (`format_decimal` feeds `_display_profile`, `service.py:677`); only `format_cds_edition`
  moves into `packets.py`.
- **Parked→runtime import edges that must stay stable (eight today; **nine** after Phase 0's
  `hex_digest` move, each verified):** `adapters/cds_store.py:34-35`
  → `counselle_db.models.ServiceError`, `counselle_db.packets.{compile_manifest, parse_packet_row}`;
  `counselle_db/packets.py:11-12` → `DomainRow`, `format_cds_edition` (**both move into `packets.py` in Phase 3**, in the same commit
  that deletes `DomainResult`, rewrites `app/tool_middleware.py` and `tests/app/test_viz_pure.py`, and
  retires `_coverage`/`get_domain` — moving them in Phase 0 would make `counselle_db/models.py:136`
  (`DomainResult.rows: tuple[DomainRow, ...]`) import `packets.py` while `packets.py:12` imports
  `ServiceError` back from `models.py`, a hard circular import, and would break the live
  `app/tool_middleware.py:12` import of `format_cds_edition` three phases before that file is
  rewritten; after the move the parked package is self-contained; `format_decimal` and `ServiceError`
  stay imported);
  `app/cds/service_review.py:48` → `format_decimal`; `app/cds/service_ingest.py:31` +
  `service_review_approve.py:42` → `model_name_from_setting` (**hoisted to `app/model_selection.py`**,
  all six importers re-pointed: `agent_node.py:295`, `titles.py:99`, `workspace/document_summary.py:129`,
  `evals/runner.py:27`, the two parked); `api/routes/cds_admin.py:21-26,63-66,316` → `api.auth/deps/
  ratelimit/users_db` + `runtime.{pipeline_pool, app_pool, deps.catalog}` (keep the attributes;
  `pipeline_pool` may be `None`); `adapters/cds_store.py:468` → `settings.supported_packet_extractor_versions`;
  the five parked scripts → `counselle_db.db.create_pool` + `get_settings`. After the `api/main.py`
  edits and the `hex_digest` move there is **exactly one** runtime→parked edge left — `counselle_db/service.py:32`, which dies with the packet guards in Phase 3; zero from there on (verified:
  `rg '^from (counselle_db\.packets|app\.cds|adapters\.cds|domain\.cds)'` outside `tests/`,
  `scripts/` and the parked tree returns only `counselle_db/service.py:32`, which dies with the packet
  guards in Phase 3). `tests/domain/test_purity.py:20,23` already
  whitelists `domain/cds/`.
- **Boot gates:** `app/deps.py:116 Catalog.load` → `catalog.py:145/152` (manifest — removed in Phase
  0; the profile-catalog gate `:149-150` stays); `caveat_catalog()` asserting the exact kind set
  (`caveats.py:14-29`) is untouched until Phase 3 and rewritten there. **`validate_prompt_assets()`
  (`prompt.py:94-102`) needs no code edit in either phase — it probes whatever `_DATA_SLOTS` holds —
  but its two inputs, `_DATA_SLOTS` and `config/assets/prompts/data_picture.md`, are rewritten
  together in Phase 0** (§6 phase boundary; the earlier claim that "the hatch skips the data picture"
  is refuted — `app/graph.py:96` branches on `snapshot is None`, never on the flag), so the Phase 0
  commit must land both or boot fails on the first turn. No other
  module-scope assertion depends on a manifest (verified).
- **Caveats — the final set is exactly eight, lives in `caveats.yaml`, and `app/caveats.py`'s
  literal set becomes those eight with a test asserting `set(yaml) == set(assertion) == set(CaveatKind)`:**
  keep `profile_snapshot` (`models.py:82`), `coverage_denominator` (**new emitter**, above — it has no
  code emitter today), `not_reported` (new emitter: `get_facts` on `state == "not_reported"` — **the agent tool only**; the
  facts route drops `not_reported` from `caveats`/`caveat_ids`, because on a page with ~150 unreported
  rows a marker on each is the noise DESIGN.md §13 avoids and the word in the value cell *is* the
  disclosure); add
  `not_collected` (`get_facts` + `resolve_school`: "Counselle does not collect facts for this school;
  this is not a report of zero or of the school withholding it."), `not_fetched` (`get_facts`, **two branches** chosen by the same `never_checked` flag `fact_state`
  resolves, so the model never describes an unattempted page as a failed one — expressed as **one
  templated entry**, because `app/caveats.py:25-28` requires every `caveats.yaml` entry to be exactly
  `{text, slots}` and a second entry would break the pinned eight-kind equality:
  `not_fetched: {text: "{cause}, so its value is unknown — not absent.", slots: [cause]}`, with the
  two cause clauses code-owned beside the state words in `domain/facts/state.py`
  (`NOT_FETCHED_CAUSE = "The page carrying this item could not be read on the last check"`,
  `NEVER_CHECKED_CAUSE = "Counselle has not checked the page carrying this item yet"`) and picked by
  `never_checked` at the emitter, rendering verbatim: "The page carrying this
  item could not be read on the last check, so its value is unknown — not absent." / when
  `never_checked`: "Counselle has not checked the page carrying this item yet, so its value is
  unknown — not absent."),
  `not_published` (`get_facts`: "Counselle holds no {section} page for this school, so there is
  nothing to report here — this is not a value the school withheld, and not a report of zero." — caveat copy is wire-delivered
  and rendered verbatim, so it reaches students and the model; D3 forbids naming the upstream source
  in it), `stale_facts` (`get_facts`/facts
  page: "Counselle last confirmed this value on {checked}; it may have changed since."),
  `observed_at_spread` (`app/viz.py`, threshold `facts_spread_days`: "Compared values were confirmed
  at different times: {checked_dates}."); retire `not_applicable` (no CollegeData node produces an
  explicit N/A marker — appendix F-iv's keep(4) is keep(3)), `stale_edition`,
  `edition_mismatch_comparison`, `partial_packet`, `definition_drift`, `not_in_template_version`,
  `vintage_period_unavailable` (superseded by the "reporting period unstated" clause in the per-fact
  vintage — stronger, it rides the value), `suppressed`. 3 kept + 5 added = 8; 11 − 8 retired = 3 ✓.
  Emitters of the retired kinds are all in parked `packets.py` or rewritten `viz.py`. The frontend
  holds **no** caveat copy; text comes from the wire.
- **Prompts:** `counselor.md` — delete `### CDS Recency Gates` (:179-192); rewrite `### Database
  Safety` (:193-208); edit `## The Honesty Contract` (:77; line 94 → sections/fact keys, keep :92),
  `## Community Evidence` (:98; lines 125, 127), `## The Counselor's Read` (:129; line 136 → "stored
  facts are last-confirmed observations, not this cycle's policy"), `## Evidence Routing` (:157; 163),
  `## Substantive Advice` (:209; 218), **`## Composition Laws` (:278; line 282 evidence tokens → delete;
  line 287 enumerates five retired caveat kinds → the eight v3 kinds; 288-290 → the
  `not_collected`/`not_fetched`/`not_published`/`stale_facts` rules; 293 packet-v8 keys → bound fact
  keys; + the band-is-not-a-cutoff line, §5.4)** — this section ships silently otherwise because
  `validate_prompt_assets()` probes slots, not content, and the model would then author its own
  caveat text; `## Planning And Tool Loop` (:322; 327-328), `## School Resolution Etiquette` (:430;
  the never-"not in our database" rule), `## Visualizations` (:438; 446 — **also a `metric_ref` rename site**, §5.4: `:446` instructs the
  model to "compose each cell from a `metric_ref`/`profile_field` reference", which after the rename
  produces an `extra="forbid"` rejection on every viz card, and the only thing that would otherwise
  catch it is a $3 eval run), `## Live Data Picture`
  (:462), plus the deadline rule (§5.4). `data_picture.md` full rewrite (`{domain_menu}` →
  `{section_menu}` = "getting-in (63), money (48), …"). `prompts/README.md:6,8-9` — `:8-9` is one sentence and `:9` is the half that names the retired "domain inventory or metric count"; under v3 the rule is that `data_picture.md` must not hardcode a section list or fact-key count. **Phase 3 test:** no
  prompt or skill names a caveat kind absent from `caveat_catalog()`; every view/tool name in
  `config/assets/prompts/*.md`, `skills/**/SKILL.md` **and `config/assets/*.yaml`** is in the shipped
  view list / mounted toolset; and those same three globs return zero for **`metric_ref`** (renamed
  `fact_key`, §5.4 — neither a caveat kind nor a tool name, so the older form of this test could not
  see `counselor.md:446`, `skills/school-comparison/SKILL.md:70`'s `{metric_ref}` or
  `skills/db-recipes/SKILL.md:36`'s `metric_ref_present`). The yaml glob is what puts a comment in a
  kept versioned asset — `season_calendar.yaml:15-16` was one — inside a gate at all.
- **Skills (26 `SKILL.md` + `activities.md`, `honors.md`; appendix C-F/F-v):** `db-recipes` wholesale
  rewrite (sketch in appendix F-v with `majors @> ARRAY[$1]`: typed tools first; two shapes/two
  views; always bind the key; the coverage recipe; the explore-shaped candidate filter; what never to
  select); `citation-and-recency`, `school-comparison`, `school-deep-dive` 30–50%;
  `counselor-research` 4–5 lines incl. its model-facing `description:`; `chancing`, `school-list`,
  `major-and-fit`, `costs-and-aid`, `application-rounds`, `testing-strategy`, `deep-research`,
  `essay-honesty`, **`activities.md:25`, `honors.md:25`** 1–2 lines; `essay-fit`, `focused-answer`,
  `guided-counselor` **none — as are the ten essay-library skills added above this plan's baseline
  (`essay-advanced`, `essay-brainstorm`, `essay-craft`, `essay-depth`, `essay-drafting`,
  `essay-exercises`, `essay-revision`, `essay-structure`, `essay-types`, `essay-values`), each
  grep-verified at zero hits for `get_domain`, `Common Data Set`, `cds`, `manifest`, `packet` and
  `metric_ref`; 16 dispositioned + 10 verified-clean = the 26 on disk.**
- **Evals (one partition of 32, appendix F-vi):** 17 re-point (`get_domain`/domain ids/caveat kinds →
  `get_facts`/sections/v3 kinds: e.g. `caveat-stale-partial` → `caveat-stale-facts`,
  `caveat-cross-edition` → `caveat-observed-at-spread`, `honesty-yale-mixed-vintages` →
  `honesty-mixed-observed-at`, `denominator-most-selective` also loses `expects.selected_document_sql`);
  2 delete (`caveat-template-absence-fixture`, `caveat-template-absence-live`); 9 light edits; 3
  workspace + 1 harness-only untouched. **Eight new cases:** `v3-coverage-not-collected`,
  `v3-coverage-tab-not-fetched`, `v3-coverage-tab-not-published`, `v3-honesty-stale-facts`,
  `v3-honesty-period-unstated` (the model states the period is unstated, never attaches a cycle
  year — R1), `v3-denominator-cross-school`, `v3-honesty-majors-cross-school` (`majors @> ARRAY[$1]`
  over `school_explore` carries the `majors` denominator **and** the printed-name sentence),
  `v3-honesty-deadline-current-cycle` (pivots to the web), `v3-honesty-score-band-not-a-cutoff`.
  `tests/evals/test_scorers.py` (1,315 lines) follows. Budget ≈ 3 runs ≈ $9.
- **Tests (68 of 140 backend files — the partition is by *distinct file*, no file in two groups, and
  every appendix C-C header is stale: C-C1 prints `(11, not 13)` over a 6-entry list, C-C2 prints
  `(18)` over a 26-entry list, C-C3 prints `(26)` over a **28**-entry list, of which `tests/domain/test_purity.py` is untouched rather than parked (its `:20,23` whitelist covers `domain/cds/`, which stays), and all five of C-C4's are
  already counted in another group. **6 delete + 35 rewrite + 27 parked = 68**; the rewrite set is
  C-C2's 26 **+ `tests/domain/test_specs.py`** (the `metric_ref` rename on an `extra="forbid"` model)
  **+ `tests/counselle_db/test_live_db.py` + `tests/app/test_viz.py`** (Phase 0, above) **+ the five
  this plan names inline that C-C2 omits** — `api/test_routes_unit.py:94,418`,
  `api/test_context.py`, `api/test_workspace_routes_live.py`, `api/conftest.py`,
  `app/test_run_turn.py`, **and `tests/app/test_durability.py:137`**, which passes `mcp_toolset=None`
  to `AppDeps` — a field Phase 3 deletes — and sat in none of the three groups: its `live_db` marker
  gates pytest selection but never `mypy .`, the same argument this plan already applies to
  `test_live_db.py` and `test_viz.py`. The parked set is 18 (`tests/app/cds/`) + 5 (`tests/domain/cds/`) + 4 = 27,
  counted on disk. C-C4 adds **no** new file: two of its five are inside the parked 27, one
  (`api/test_routes_unit.py`) is inside the rewrite 35, and the other two moved to Phase 0. A Phase 3
  exit assertion re-counts the three lists and fails if their union is not 68 distinct files or if any
  file appears twice, per §10):** 6 delete
  (`test_mcp_smoke`, `counselle_db/test_server`, `api/test_supervision`, `adapters/test_cds_disposal`,
  `app/test_evidence_markers`, `app/test_legacy_citations`); **35** rewrite (incl. `tests/domain/test_specs.py:78,98`, `tests/counselle_db/test_live_db.py`, `tests/app/test_viz.py`, `test_steps` 907,
  `test_steps_router` 851, `test_viz_pure` 855, `test_protocol_fixtures` 723, `test_catalog_contract`
  655, `test_foundation_regressions` 519, `tests/evals/test_scorers` 1315, `test_tool_middleware`,
  `test_toolset`, `test_sources`, `test_parked_sources`, `test_caveats`, `test_skills:332` (`edition_mismatch_comparison` in the school-comparison skill; `:377,390` assert `counselor.md`'s runtime slot set, which Phase 0 does not change),
  `test_tool_overflow:68`, `test_settings`, `api/test_routes_unit.py:94,418`, `api/test_context.py`,
  `api/test_workspace_routes_live.py`, `api/conftest.py`, `app/test_run_turn.py`,
  **`test_query_guard.py`** (keep layers 1–8 + the binary rejector; drop the
  packet/manifest/selected-document cases — it is honesty-critical guard coverage, not a delete));
  **27 parked** (`tests/app/cds/` 18, `tests/domain/cds/` 5, `test_packets.py`,
  **`test_reading_rules.py`** (tests parked `packets.py`, keep), `test_cds_admin_auth.py`,
  `test_cds_pdf.py`) of which **25** stay routine and 2 (`live_db`) go dormant — the two untriaged
  `TODOS.md:177-199` failures, still untriaged under a "parked" heading; **no additional** dormant when
  CDS tables are absent. **Rule:** markers gate selection, not import — every module-scope importer
  of a deleted symbol moves in the same commit; the collection-error list is appendix C-C5 (17 files
  incl. `test_steps.py:17`, `test_tool_middleware.py:9`, `test_viz_pure.py:15-23`,
  `test_parked_sources.py:3`, `test_catalog_contract.py:13`, `evals/runner.py:38-41`); runtime-patch
  sites that fail on execution are listed separately. Baseline before any change: ruff clean, mypy
  clean (309 files), routine pytest **1,774 passed / 0 failed**.
- **Session state:** no compatibility mapping for old `cds`/`profile` citations in checkpointed
  registries (`app/sources.py:41` re-validates strictly on resume); D9 nukes `counselle.*`
  everywhere — the runbook says so, and the sign-in notice (§5.6) tells users.
- **Keep untouched:** the workspace module; Tavily tools; turn registry; auth; `school_profiles`
  readers (13 sites read `official_domain`, no packet dependency) — **but the favicon branch on
  citation chips, rail rows and the message source strip is removed for `db`** (§5.4).

### 6b. Frontend (delete 14 files ≈ 2,900 lines; rewrite ~40; park 64 files / 16 tests, after `CdsErrorCard` is promoted out of the 65 ≈ 9,024 lines the appendix counts)

- **Protocol/citations (Phase 3, one commit with the backend envelope):** `api/chat/types.ts`
  (`SOURCE_NAMES` → `["db","web","edu","reddit"]`; drop `EvidenceItem`, `document_sha256`,
  `academic_year`, `manifest_version`, `profile_sha256`, `SourceEntry.evidence`/`evidence_omitted_count`,
  `SourceFocus.evidenceId`, `LegacySourceEntry`, `ReplaySourceEntry`; `Citation.tier: Tier | null`;
  `facts_updated_at`); `validation.ts` (one `db` branch; delete `isCurrentEvidence:203-225` and the
  evidence-coupling gates; `tierMatchesSource:111-115` returns true for `db`); `citations.ts`
  (`sourceFocusForCell:70` → index only; `citationYearLabel:147` folded into the hover meta line;
  `friendlySourceName:179` → school name for `db`; the `schoolDomainsFromBlocks` favicon precedence
  skipped for `db`); `CitationRenderer.tsx` (`:74-86` favicon branch, `:161` badge conditional);
  `MessageSources.tsx` (`:39-52` `badgeFaviconUrl` — the school-domain branch skipped for `db`, the
  third R2 site and the most visible; `:56-59` `FallbackIcon`'s `cds`/`profile` check → `db`);
  `SourcesRail.tsx` (`:62-94,244-260` evidence rows + omitted-count disclosure deleted, `:117-127`
  favicon, `:215-223` badge, the inert `db` row); `VizBlock.tsx` (`:43` `evidenceId`, `:51-66` badge
  incl. the `:58` `aria-label`; **+ render the new card-level `foot`** — a `Caveat` with DESIGN.md
  §15.3's disclosure treatment, the `BAND_CAPTION` string as the same muted card foot the facts-page
  group uses — and a
  `VizBlock.test.tsx` case pinning that a spread comparison shows the sentence exactly once); `source-config.ts` (the `/v1/config` payload's
  `default_source_config` changes even though the route's code does not);
  `features/ai-chat/components/school-data-tool-presentation.ts:4-6,9` (+test) — the literal
  `get_domain` in `SCHOOL_DATA_TOOLS`/`SchoolDataTool` → `get_facts`, else every `get_facts` step falls
  out of the school-data widget silently; `features/dev-tool-call-gallery/tool-call-fixtures.ts:32,136,145,153`.
  **`legacy-replay.ts` (343 lines) is deleted with `tests/fixtures/protocol/legacy_v1_completed_turn.json`;
  its real importers, all moved in the same commit:** `api/chat/transport.ts:26`
  (`adaptStoredTranscript`), `test/protocol-fixtures.test.ts:9` — and the fixture itself is `?raw`-imported by **three** files,
  all in the Phase 3 test list: `protocol-fixtures.test.ts:10`, `api/chat/transport.test.ts:5`,
  `AiChatPage.test.tsx:21` (a Vite `?raw` import of a deleted file fails the **build**, not a test),
  `features/ai-chat/model.test.ts:7`, `AiChatPage.test.tsx:20`, and the four `isLegacySourceEntry`
  call sites `citations.ts:15`, `MessageSources.tsx:4`, `SourcesRail.tsx:10`, `CitationRenderer.tsx:32`
  (`model.ts` and `turn-reducer.ts` do **not** import
  `legacy-replay.ts` — but they, and `AgentRunView.tsx`, *do* import the `ReplaySourceEntry` **type**
  this same bullet deletes from `types.ts`, so **all three ship in this commit**:
  `AgentRunView.tsx:11,137`, `model.ts:4,67`, `turn-reducer.ts:9,54` each drop the import and take
  `SourceEntry[]` — once `LegacySourceEntry` is gone the union has one member and the alias has no
  reason to exist; `tsc -b` type-checks source before tests, so naming only their test files would
  fail the Phase 3 gate). Golden fixtures
  `tests/fixtures/protocol/{turn_full,transcript}.json` regenerated backend-first. Keep `sse.ts`,
  `CITATION_PATTERN`, favicon helpers (for viz headings), `SourceBadge`.
- **Frontend test disposition (the C-C analogue).** Rewritten in the Phase 3 protocol commit:
  `api/chat/sse.test.ts` (`:35,590` — the validation contract test), `src/test/protocol-fixtures.test.ts`,
  `features/ai-chat/citations.test.ts`, `components/{ChatMessage,CitationRenderer (:50,61,130,145,154
  pin today's chip label),MessageSources,SourcesRail,VizBlock,AgentRunView (:390 SQL string →
  school_facts_sql)}.test.tsx`, `model.test.ts`, `turn-reducer.test.ts`, `transport.test.ts`,
  `AiChatPage.test.tsx`, `school-data-tool-presentation.test.ts`. Phase 2 owns
  `features/schools/facts/school-facts-honesty.test.tsx` (rewritten against a fixture of the new
  shape, covering `not_fetched` ≠ `not_reported` ≠ `not_published`, `0`/`false` at full weight, the
  `BarGraph` one-unplottable-member invariant — the single most valuable test in the tree — keeping its
  four `compressAbsences` cases and gaining one asserting that a `not_reported` row and a
  `not_fetched` row adjacent in a group are never merged) and
  `features/schools/explore/classify-fit.test.ts`. No frontend test file outside the parked tree may
  still name `cds`, `evidence`, `document_sha256`, `academic_year`, `manifest_version` or `get_domain`
  after Phase 3.
- **`features/schools/facts/`** (6,023 lines; Phase 2): delete `fixtures/` (10 files, 2,054) +
  `school-facts-fixtures.ts` **+ `features/dev-school-facts-gallery/SchoolFactsGalleryPage.tsx` and
  its `/dev/school-facts` route (`app/router.tsx:36-43`)** — it imports the deleted fixtures and would
  break `tsc -b`; rewrite `school-facts-types.ts` (the appendix D-A shape as overridden by §5.2;
  `SectionId` → `string`; `Evidence`, `DomainCoverage`, `SchoolEdition`, `AbsentTopic`, the lane
  types, and the retired `FactState` kinds go), `-sections.ts` (719 lines keyed by qualified CDS
  refs → driven by `facts_sections.yaml` from the wire), `-blocks.ts` (+`TableBlock`, `children`),
  `-rows.ts` (`laneRow`, `provenanceOf:78-83`, `RowProvenance:32-43` (its `:32-39` JSDoc + the type body, matching the "(comment + …)" convention used throughout this bullet — the JSDoc otherwise survives directly above `FactTableRow:45` and reads as its documentation) die; **the file header `:19-30` is rewritten**, because its "the one judgement that matters … is made once, in `factStateCopy`" sentence names a function §10 deletes and points the next reader at the frontend for the absence copy the wire now owns;
  **`compressAbsences:104` survives unchanged and is load-bearing** — under v3 every declared key
  renders a row and CollegeData is sparse for most schools, so a mid-tier page is a long run of
  identical absence words, and this is what keeps it readable. It merges only rows whose **wire `display` value** is
  identical, which is what keeps it honest — the five state words are five different strings and never
  merge into one another, so compression can never erase the state distinction v3 exists for. Its `:88-103` doc comment survives with it **minus the `:101-102` "Compare `strayRefs`, which exists to stop the same silent loss one layer up" cross-reference** — `strayRefs:264` dies with `-blocks.ts`'s wholesale rewrite (under v3 the layout and the wire come from the same `facts_sections.yaml`, so there are no strays), and a kept comment pointing at it is invisible to `tsc`, `knip` and both exit greps), `-format.ts`
  (`coverageSentence:52-74` deleted, its `:52-65` doc comment included;
  **`ABSENCE_COPY:15-31` is deleted, not shrunk** — the `:15-21` doc comment ("Six states, six
  different sentences"; v3 has five) goes with the const — the wire's `display`
  carries the word for every state (§5.2), so a second frontend copy would be the one-string-two-homes
  the D3 grep exists to prevent, and it ships today in a different casing (`"not reported"`,
  lowercase) from the words §5.1 specifies. **`ROUND_NOT_OFFERED_COPY:36` goes with it** — the deadline
  row's `display` is the wire's. Where a surface wants a different case for the same word (§5.4's viz
  cells render it lowercase in muted italic) it lowercases the wire string at the render site: a
  transform, never a second string.
  **`DERIVED_UNAVAILABLE_COPY:33-34`** (comment + const) is deleted with its last consumer, and
  **`ABSENT_TOPIC_EXPLANATION:38-39` with it** — its only consumers are `fixtures/shared.ts:10,202`
  inside the deleted fixture tree, it is the last "Common Data Set" string under `features/schools`
  outside a §6b list (so the Phase 2 exit grep fails without this), and the "absent topic" model it
  explains has no v3 successor: every declared key renders a row in one of the five states.
  `factStateCopy:41-43` and `isReported:47-50` (comment + function)/`ReportedState:45` go with `ABSENCE_COPY` — the wire's
  `display` is the only absence word (§5.2) and the v3 `FactState` union has no `"reported"` member —
  leaving `-format.ts` as `identityMeta` plus the surviving formatters **and its `:7-13` module header rewritten** — "Every string a student reads about the SHAPE of our data is decided here and nowhere else" is false the moment `ABSENCE_COPY` goes; the shape words are `domain/facts/state.py`'s and arrive as the wire's `display`, and a header still claiming this file owns them is an invitation to re-author the second copy this same bullet just deleted. It becomes the value-formatting note this file actually is),
  `SchoolFactsSection.tsx:15` (the `coverageSentence` import), `:45`
  (`const coverage = data.coverage[section.id]` — `SchoolFacts.coverage` and its `DomainCoverage`
  type both die two bullets up) and **`:59-65`** — the `:59-60` comment naming
  `coverageSentence` plus the whole `{coverage ? … : null}` element, **not the `:63` call
  alone**, which is syntactically valid and would render an empty muted `<p>` on every section,
  the half of the defect `tsc -b` cannot see — and `:80-82` (the sentence), `SchoolFactsPanel.tsx` (`:41-47` comment is false after Phase 2 →
  skeleton; `:77,113-149` `NoCommonDataSet` (the component **and** its `:113-118` JSDoc, whose `:114` carries the last uncovered "Common Data Set" string under `features/schools`) → `NoFactsCollected` / `CouldNotRead`), `FactTable.tsx`
  (the whole evidence path: `:13`'s `RowProvenance` import, `:130-134`'s
  `row.provenance.length > 0 ? <EvidenceDisclosure/> : row.value` branch — which collapses to
  `row.value` — `EvidenceDisclosure:170-233` (its `:170-182` JSDoc + the function, matching the
  "(comment + function)" convention used throughout this bullet — the JSDoc otherwise survives
  directly above `EvidenceRow` and reads as its documentation) incl. `:206`'s "Read from the school's own Common Data
  Set", and `EvidenceRow:235-274`); keep
  `charts/` (5 files) — `FactBarChart.tsx`, `FactOrdinal.tsx`, `chart-shell.tsx` and `chart-tokens.ts`
  genuinely unchanged, **but the band's whole composition path moves to the wire.** A band is a
  **fact**, not a group chart: `class_profile.sat_math_range` / `…sat_ebrw_range` /
  `…act_composite_range` (appendix E-i's **TitleValue** range row) are the `band` kind's only producers, each carrying
  `{p25, p75, min, max, submitted_percent}` (appendix D-A's `BandFact`), and `BandsBlock` renders every
  `band` fact in its group in order. CollegeData publishes `_p25`/`_p75`/`_avg` and **no median**, so
  `BandFact.p50` has no producer and appendix D-A's `p50` is **removed**, not made nullable
  (synthesising a median from p25/p75 is the R14 prohibition one field over). `min`/`max` are the
  **test's** scale (200–800, 1–36), not a value the source publishes: they are code-owned in
  `domain/facts/normalize.py` keyed by `fact_key` beside the range parser, because a scale is not
  student-facing copy and must not become a frontend literal in a file the wire now drives.
  Consequently `school-facts-sections.ts`'s `BandSpec:37-44` (type body **and** its **`:28-36`** doc comment — **not `:23-36`**: `:23` closes the file-header
  comment opened at `:3` and **`:25-26` is `FactEntry`, which stays** — every kept `GroupRender`
  arm (`:59`, `:63`) and `school-facts-blocks.ts:18` still use it; the doc comment's "`min`/`max` are
  properties of the TEST … legitimately literal here" argument is exactly what
  `domain/facts/normalize.py` now owns) and the `{chart: "bands"}` arm of `GroupRender` at **`:64`** —
  **not `:63`, which is the `ordinal` arm this plan keeps** and which §7 Phase 2's exit gate pins —
  are **deleted, not rewritten** (the wire names no band refs — a band is a fact, not a
  group chart), and
  `school-facts-blocks.ts`'s `splitBands` block `:488-530` (doc comment + function), its `groupBlock`
  bands arm `:295-302` — and because `groupBlock` is annotated `: SectionBlock | null` (`:203`)
  and that arm is its **only terminal `return`**, the `ordinal` branch at `:278-293` becomes the
  fallthrough (its `if` drops and its `return` becomes the function's last statement), or
  `tsc -b` fails TS2366 ("Function lacks ending return statement and not all code paths return a
  value") at this phase's own `npm run build`; narrowing `render` once `GroupRender` loses its
  bands arm does not rescue it, because the implicit-return check is not exhaustiveness-aware —
  and its `:17` `type BandSpec` import go with them (there is no `bandSpecs`
  identifier in the tree — naming one would be the `--brand-tint` failure mode this plan documents) —
  `BandsBlock["bands"]:98-106` becomes the wire's band payload, so `:104`'s required `p50: number`
  dies with the rest rather than as a single-field edit. Leaving that machinery in place would make
  `splitBands` return an empty array for every school and `FactRangeChart`/`BandsBlock` unreachable:
  the dead code §10 forbids, in the two components §5.2 keeps *because* they are needed.
  `getting-in/test-detail` lists the three `_range` keys and `*_avg` in its `facts:`; `*_p25`/`*_p75`
  are **not** listed there — the band renders both endpoints, and listing them again would print 740
  twice in one group — while the keys stay in the store for `query_database` and for §5.3's
  per-section score filters. `FactRangeChart.tsx:122`'s `median {band.p50}` is deleted, and `:62`'s
  screen-reader summary — which reads "middle 50% of **submitted** scores" today, the one claim
  `BAND_CAPTION` exists to deny — becomes the accessible rendering of the figure alone: "{label}:
  {p25} to {p75}, on a {min} to {max} scale." The qualifier is the group's wire-delivered `foot`,
  adjacent in the reading order; the chart's own summary states geometry and makes no claim about what
  the band means, so there is still exactly one authored sentence about middle-50 bands and it is
  `BAND_CAPTION`. Keep `SchoolFactsNav.tsx` (its `:82` `next as SectionId` cast becomes a
  `string`-to-`string` no-op once `SectionId` widens, and goes).
  `SchoolDetailRoute.tsx:128` is the seam, `:38` (`import { schoolFactsFixture }`) dies with the fixture, `:133` gains `isPending`, `:365-388` `NoFactsYet` is
  replaced. `styles/schools.css:124-132` drops the whole evidence-and-derived token
  block — `--school-fact-derived-ink:126` **and its `:124-125` comment** (zero consumers on disk
  today, and the derived lane it names dies with `DERIVED_UNAVAILABLE_COPY`),
  `--school-fact-evidence-ink:127` (its only consumers are `FactTable.tsx:191`'s
  disclosure-trigger `decoration-` and `:256`'s `EvidenceRow` locator line, both inside the two
  functions above), `--school-fact-evidence-hover:128` (already unreferenced), and
  `--school-fact-well:132` **with its `:129-131` comment**: its only consumer in the whole frontend
  is `FactTable.tsx:269`'s `<blockquote>` inside the `EvidenceRow` this same bullet deletes, and no
  v3 surface has a well — `TableBlock` renders over `components/ui/table` and the group `foot` is
  one `--ink-muted` line. A kept token with no reader is invisible to every gate in this plan
  (`knip` does not parse custom properties, `tsc` sees no identifier, neither exit grep matches its
  string), which is why it is named here rather than left to the sweep.
  `--school-fact-label/-value/-absent/-caveat/-divider` stay — all five have surviving readers in
  `FactTable.tsx` and `charts/`. **`--school-balance-track:86` and `--school-chart-grid:162` go with them** — both already have zero consumers repo-wide (they are not v3's doing, but the file is open in this commit and the value × ease rule makes them free); every other token in the file keeps a reader. `styles/README.md` needs no token edit — it enumerates no `--school-fact-*` token (its one `--school-*` mention, `:83`'s `--school-filter-chip-active-ink`, is a naming example and survives); the one-line change it does want is adding `schools.css` to the tier-3 family list at `:46-48`, which omits it today. **Exit grep (Phase 2):** `Common Data Set` under
  `frontend/src/features/schools` returns zero. **Exit grep (Phase 3):** under `frontend/src` outside
  the parked tree returns zero.
- **`features/schools/explore/`** (Phase 2): delete `explore-fixtures.ts` (412); `explore-filter.ts`
  (459) moves server-side: `runExplore:284` and `relaxFilter:415` die, and with them **thirteen
  module-locals whose only callers they are** — `withinRange:36`, `matchesQuery:44`, `matchesSize:56`,
  `matchesTestFit:80`, `matchesRounds:106`, `matchesCampusEnums:133`, `matchesDataWindow:161-175`,
  `matchesNonRangeFilters:179`, `applyRanges:213`, `deadlineTime:248`, `compareBy:257`,
  `countControls:332`, `findNarrowest:354` (`noUnusedLocals` is what enforces it). The
  `export { isRangeActive }` at `:459` goes but **the function at `:32` stays** —
  `countActiveFilters:453` calls it — so what survives is `isRangeActive` + `countActiveFilters:434`
  (chip count + stagger), ~35 lines;
  `explore-config.ts` (`dataWindowOptions:202-206` — the const is a five-line element, not one line —
  `CURRENT_CDS_YEAR`/`RECENT_CDS_YEAR_SPAN:221-223` (its `:221` comment + both consts)
  deleted; `sizeBucketOptions` loses `min`/`max`; `controlOptions` gains the for-profit member; **`RangeDescriptor` loses
  `metricLabel:37` and its `:36` template comment** — the chip renders the wire's `metric_label` from
  `METRIC_LABELS` (§6d), and a second copy here is the one-string-two-homes no gate in the repo can
  see: not the D3 grep (it says nothing about the source), not `knip` (an object property is not an
  export), not `tsc` (the field is still typed and read) — **and `read:39-40`** (comment + field), whose only consumer is
  the deleted `runExplore:284`; `rangeDescriptors` otherwise extended with
  `gradFour`/`gradSix`/`needFullyMet` and losing `outOfState`),
  `useExploreFilters.ts:57` (`data` param dropped; `page`/`sort` added), `explore-types.ts`
  (`cdsYear:67`, `DataWindow:118`, `dataWindow:155` deleted; `RangeKey` gains `gradFour`/`gradSix`/
  `needFullyMet`, loses `outOfState`; `StudentProfile` → `{homeState, satMathScore, satEbrwScore,
  actScore}`; `ExploreSchool.greekPercent` → `greekPercentMen`/`greekPercentWomen`;
  `ExploreSchool.testBand` → `satMathBand`/`satEbrwBand`/`actBand`; `Control` gains `private_for_profit` and `controlCounts` follows; `ExploreSchool.outOfStatePercent`
  and `admitRate.basis` deleted (with `classify-fit.ts:82`'s suffix); `SortKey` opens; **`ExploreFilters` gains `scoreFit`**
  (`"any" | "at_or_above_p25" | "inside_band" | "at_or_above_p75"`, URL param `fit`, default `any` —
  §5.3's opt-in score predicate and the `testFit` control's successor) and **drops three shipped
  filters whose backing data v3 removes**, each
  with its control, option list, default and URL param, so no inert control survives on screen:
  **`excludeRestrictiveEarlyAction`** (§5.3 drops REA-vs-EA for having no field) — deleting
  `ExploreFilterPanel.tsx:129-141` (the comment `:129-130` and the whole `BoolRow` element `:131-141`, whose self-closing `/>` is `:141`), `explore-config.ts:243`,
  `useExploreFilters.ts:30-43`'s `FlagKey` member and `FLAG_PARAMS.excludeRestrictiveEarlyAction:
  "noreea"`, and `explore-filter.ts:106-131`'s REA arm; **`greek`** (`GreekFilter`,
  `greekOptions:182-186`, `LITTLE_GREEK_MAX_PERCENT:217-219` (comment + const), `defaultFilters:237`, `ENUM_PARAMS.greek`,
  `ExploreFilterPanel.tsx:207-215` — the whole `SegmentedControl`; `:209` is only its `label` attribute) — replaced by the two `greekPercentMen`/`greekPercentWomen` range
  filters, so the 10% threshold dies with the enum rather than being re-authored server-side; and
  **`testFit`** (`TestFitPreset`, `testFitOptions:166-173` (comment + const), `defaultFilters:235`,
  `ENUM_PARAMS.testFit: "testfit"`, `ExploreFilterBar.tsx:282-330` — the whole `Popover`, including `:288-289`'s `profile.satScore === null` title and `:324-328`'s "Compared against your {profile.satScore}" note, both reading a field this plan deletes) — its only inputs were
  `ExploreSchool.testBand` and `StudentProfile.satScore`, both deleted, and §5.3's `scoreFit`
  predicate replaces it — the control survives in shape and moves to the new per-section bands; only
  the composite-SAT number it read is deleted. None of the three is caught by any gate — `tsc` passes because the fields stay
  typed and read, `noUnusedLocals` because they are object properties, `knip` because the option lists
  are still imported — so a student would tick "Exclude restrictive early action" forever with nothing
  behind it. `explore-config.ts`'s **`defaultProfile:225-228`** takes the new `StudentProfile` shape
  and **`defaultFilters`** loses those three members and `dataWindow`. `FitVerdict` becomes
  `{category, reason}` (`usedScore` deleted, **no `bandTrusted` introduced** — §5.3); `:49`'s trap-3
  comment rewritten), `ExploreFilterBar.tsx`/`ExploreFilterPanel.tsx` (`:168`
  CDS help text; new controls — region, entrance difficulty, 4y/6y split, need-fully-met, the `scoreFit`
  predicate control (the `SegmentedControl` shape `testFitOptions` already has, reading the scores
  entered in `PersonalizationChip` — the three score **numbers** live only there and are not
  duplicated in the bar), major combobox, deadline-before calendar, include-rolling — from installed primitives
  only: `command`+`popover`, `calendar`, `select`; **no slider** — `RangeFields` number pairs already
  express "no maximum"), `ExplorePanel.tsx:95-103` (the swap seam; `:105-125`'s synchronous-memo
  comments go; "Load more" stays), `ExploreResultsHeader.tsx` (+ `ExclusionChip`'s two-reason copy (§5.3), the universe line, the majors note,
  the null-tail chip, the wire-delivered band caption rendered **once** here, and
  `PersonalizationChip`'s `NumberField:100-114` replacing its single "SAT total" `NumberField` (400–1600) with
  **SAT Math / SAT EBRW / ACT** fields whose `You:` summary renders dot-joined, e.g.
  "You: MA · SAT 740 M / 730 EBRW · ACT 33"); `explore-format.ts` (**`admitLabel:87-92` deleted (its doc comment and closing brace included)** — its input `admitRate.basis` no longer
  exists; `formatTestBand:64` **replaced, not deleted**, by `formatBand(label, band)` — its shipped
  body hardcodes a `SAT ` prefix and would print "SAT 32–35" over an ACT band — so the label rides the
  band the rule picked ("SAT Math 740–790", "ACT 32–35"); `costLabel` stays; and **`ABSENT_LABEL:11`
  changes from `"not published"` to `"not available"`**, with the reason as a comment at the site:
  under v3 `not_published` is a *defined* fact state meaning the source publishes no such page (§5.1),
  while `school_explore_rows` carries no per-column state — so a null explore column may be
  `not_reported`, `not_fetched` **or** `not_published`, and printing the one specific claim over all
  three is exactly the conflation §5.4 removes from viz cells, on the default schools screen that
  renders it 24 cards at a time. "not available" is DESIGN.md §13.4's neutral absence word and asserts
  nothing we cannot back. Its three call sites (`SchoolResultCard.tsx:52`, `VerdictBand.tsx:78,158`)
  are otherwise unchanged, and the module comment at `explore-format.ts:1-7` — which
  names the old word — is rewritten with it, as are `SchoolResultCard.test.tsx:13`'s header comment
  and **`explore-types.ts:7`'s "see `SchoolResultCard`'s `not published` treatment"**, which names
  the retired word in backticks and so escapes the Phase 2 grep's quoted form, and
  **`explore-format.ts:70-75`'s block comment**, which opens "The two basis labels below encode a
  qualifier INTO the label" and would describe **one** label once `admitLabel:87-92` goes;
  the Phase 2 grep is an absolute zero, with no "outside comments" qualifier. **The rule:** where a surface knows the fact's state — the facts page, viz
  cells — it renders that state's word; where it does not — Explore's wide row — it renders "not
  available"); `ExploreFilterPanel.tsx:224-228`'s out-of-state range control and
  `explore-config.ts:121-129`'s `outOfState` descriptor go with `RangeKey.outOfState`; the **whole
  `dataWindow` group** goes with `DataWindow` — `ExploreFilterPanel.tsx:290-308` (the `Data` label
  `:292-294`, the `SegmentedControl` `:295-302` and the paragraph `:304-307`, "Admit rates from
  different reporting years aren't comparable…", which names a per-edition concept D2 removes) plus
  its `:18` `dataWindowOptions` and `:32` `DataWindow` imports and `useExploreFilters.ts:52`'s
  `EnumKey` member; only the `SegmentedControl` is compiler-forced, and no repo gate — not the Phase 2
  `Common Data Set` grep, not the D3 `collegedata` grep, not `knip`, not `noUnusedLocals` — can see
  the label or the paragraph;
  `SchoolResultCard.test.tsx` (imports the deleted `explore-fixtures` at `:4` and pins `testBand` at
  `:42,69,84`); `VerdictBand.tsx` (`:11,71-72` switch off `school.testBand`; `:166`'s `admitLabel`
  call and its qualifier go with `admitRate.basis`; **`EvidenceLine` is rewritten** to render **one** band, chosen by a fixed
  stateless rule the `StudentProfile` shape actually supports: `satMathScore` set → the SAT Math band
  and that score; else `actScore` set → the ACT composite band and that score; else the SAT Math band
  with no "you" part. ("Most recently entered" is not implementable —
  `{homeState, satMathScore, satEbrwScore, actScore}` carries no ordering, and an ordering field would
  not survive `useExploreFilters.ts`'s shared-URL codec, so two students opening one link would see
  different bands.) `profile.satScore` is deleted and a card cannot show three bands; when the chosen
  band is null the line reads "test range not available"; **`SEVERE_CAVEAT:46-47` is deleted**
  with `classify-fit.ts:121-140`'s `caveatSeverity` (its `:121-127` "caveat ladder" doc
  comment + the function) — **and `CaveatSeverity:119` with it**, the exported union whose only
  consumer is that function's return annotation (the identically-named type at
  `facts/school-facts-types.ts:70` is a different type in a different file and stays); `knip` reports
  an unused export at the Phase 2 exit, so it belongs in appendix D-F's predicted list.
  `TRUSTED_SUBMITTED_PERCENT:33-35` and `shift():51-60` likewise take their `:33-34` and `:51`
  comments — **`:51-60`, not `:51-52`**: `:52` is only the signature and `:53-60` is the body,
  which deleting the two lines alone would strand at module scope (a bare `return` and an
  unmatched `}`, a parse error `tsc -b` and Vite both stop on) — **and the `LADDER` const at
  `:37` goes with `shift()`**, its only two readers being that function's `:53` and `:59`; it is
  not exported, `categoryFromAdmitRate` never touches it, and `noUnusedLocals` is what enforces
  it. `classify-fit.ts`'s file-header rule 2 (`:16-24`) is **rewritten** with the branches:
  it names `usedScore` and the caveat ladder, both deleted here, and would otherwise be the file's
  largest block of prose describing code that no longer exists — its trap-1 argument survives as
  `BAND_CAPTION`'s rationale (§5.2), not as a comment about a deleted field. `caveatSeverity` returns `"severe" | "mild" | "none"` purely
  from `submittedPercent` and would be a constant `"none"` under v3 — a dead severity ladder and an
  unreachable honesty string are exactly what §10 forbids); keep `SchoolResultCard.tsx`,
  `classify-fit.ts` (score branches deleted, §5.3), `SchoolResultCardSkeleton.tsx` (already used at `ExplorePanel.tsx:209`; now first-load only). Casing the FE
  absorbs: `metricLabel`→`metric_label`, `controlCounts`→`control_counts`,
  `remainingWithoutIt`→`remaining_without_it`.
- **`features/schools/AddSchoolDialog.tsx` (+ `AddSchoolDialog.test.tsx`), Phase 2** — the §5.6
  prefill's only implementation site, and named nowhere in the fifth-round text although the Phase 2
  exit test asserts its behaviour: a suggestion chip under the `Deadline` `Input` (`:244-252`), shown
  only for `ED`/`EA`/`RD` with an in-cycle deadline fact, never a pre-filled input, carrying §5.6's
  offer line; nothing rendered for the other four `Round` values (`:38-46`). Its **Fall enrollment
  year** helper `:275-278` — "This selects the correct admissions-cycle catalog. It cannot be guessed
  safely." — becomes "This is the cycle you're applying in. It cannot be guessed safely." (D2 removes
  every per-cycle catalog, so the shipped sentence would name a thing that no longer exists; the field
  stays because the duplicate-cycle check and the deadline-cycle match both need it). The test file
  gains the `ED2`/`REA` case.
- **Parking cds-admin is a 3-file swap (Phase 0), executed on a copy and measured:** delete
  `router.tsx:15-17` (the three `Cds*Page` imports) and `:134-157`'s three `Cds*Page` route entries (`:158-173` **is** the redirect this same sentence keeps) — **the
  `admin/cds/*` redirect stays and is re-pointed at `/app/admin/facts`** (§5.5; its own 12-line
  comment records that deleting it lands the operator on `/app/tasks` with no explanation) — **`:1`'s `Navigate` stays** (four other call sites at
  `:63,87,176,190`), but **`:3`'s `AdminGate` import is deleted in Phase 0 and re-added in Phase 1**
  with the `/app/admin/facts` route: `AdminGate`'s only three uses are `:137,145,153`, inside the
  block Phase 0 removes, and `tsconfig.app.json`'s `noUnusedLocals: true` makes an orphaned import a
  `tsc -b` failure. `app/auth/AdminGate.tsx` itself is **not** deleted — it is unimported for exactly
  one phase, so the Phase 0 `knip` **baseline** records it and the Phase 2 gate (after Phase 1
  re-imports it) is the first one it must satisfy. Likewise `navigation.tsx:72-79` at `/app/admin/facts` **in Phase 1, with the
  route** — re-pointing it in Phase 0 would leave the superuser nav entry falling through
  `router.tsx`'s `*` to `/app/tasks`; leave `AppSidebar.tsx:45-47`; **64** admin files keep compiling after `CdsErrorCard` is promoted out of the
  tree (the three parked pages `pages/cds-{upload,review,coverage}-page.tsx:8/16/17` are edited in
  Phase 0 to import it from `components/ui/error-card.tsx`), their 16 tests stay green with zero edits, bundle −82 kB raw / −23 kB gzip, `noUnusedLocals`
  does not flag exported declarations. **Run `npm run build`** (tsc -b + vite's module resolution).
  Baseline measured: build green, 93 test files / 1,010 tests. **Parked means parked in the frontend
  too:** the new admin screen imports nothing from `features/cds-admin/` or `api/cds-admin/`.
- **Promote before parking:** `features/cds-admin/CdsErrorCard.tsx` (the only DRY copy of the
  DESIGN.md §13.1 error card, hand-rolled in **six** other places) → `components/ui/error-card.tsx`,
  rewritten to the §10.3 primitive conventions (kebab-case file, `data-slot`, `cva` variants); the
  six call sites (`SchoolsRoute.tsx:153-166`, `SchoolDetailRoute.tsx:328-342`,
  `TasksRoute.tsx:382`, `EssaysRoute.tsx:219`, `pages/essay-editor-page.tsx:33`, and
  **`features/activities/ActivitiesRoute.tsx:197-211`** — a byte-for-byte clone whose tests assert text
  and role only (`ActivitiesRoute.test.tsx:421,424,478,480`), so it re-points with no test edit)
  re-point; `features/ai-sidebar/ChatSessionList.tsx:122` is deliberately **not** re-pointed — it is a
  one-line inline `<p role="alert">`, not a §13.1 card; the parked screens import it from its new home (a listed edge). Each re-pointed
  site keeps its own heading, body sentence and button label verbatim — they are per-surface copy, not
  the primitive's — so the promotion is a markup change with an unchanged accessible name;
  `SchoolWorkspace.test.tsx:35` and `EssaysRoute.test.tsx:2072` pin two of them by text, and Phase 0's
  "`npm test` green" gate is what proves it.
- **New:** `api/schools/{facts,explore,majors}.ts` + `hooks.ts` (explicit `staleTime` per query — the
  app's first) + `keys.ts` (mind `schoolSearch*` in `api/workspace/keys.ts:39-41`),
  `api/config/public.ts` + the `AuthLayout` reset-notice banner
  (`staleTime: Infinity`, `localStorage` dismissal), `api/admin/facts-status.ts`, `features/admin-facts/` (`AdminFactsRoute`, `FactsStatusHeader`,
  `TabHealthTable`, `CrawlHistoryTable`, `UnmappedLabelList`, `CrosswalkGaps`), `SchoolFactsSkeleton`,
  `TableBlock`, the sign-in reset notice. Registry check (appendix D-D, plus COSS walked for the stat
  tiles and history table — nothing beat the installed `Card`/`Table`): nothing new to install; the
  shadcn MCP was down this session, re-run the search before building. Comment-only sweep:
  `inline-citation.tsx:64`, `sidebar-icons.tsx:33`, `charts/FactOrdinal.tsx` header, and
  `CitationRenderer.tsx:183-184` (it documents the old favicon precedence — "real school favicon for
  CDS/profile when a matching viz table exists" — which §5.4 deletes).
- **Dead-code gate:** add `knip` as a devDependency with `knip.json` ignoring `features/cds-admin/**`,
  `api/cds-admin/**`, `pages/cds-*`, `components/ui/**`, **plus an explicit entry for
  `frontend/src/config.ts`'s `CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS`** (its only consumers are in the
  parked tree; `DEFAULT_REQUEST_TIMEOUT_MS` in the same file stays live, so the file is not ignored
  wholesale; `PARKED.md` lists the export); record the baseline at Phase 0; **Phase 2 and Phase 3 exits** = no unused
  file or export outside the ignore list (predicted list: appendix D-F). Phase 3 needs its own run:
  its deletions orphan `isCurrentEvidence`, `citationYearLabel`, `isLegacySourceEntry` and the
  `SourceFocus.evidenceId` helpers, and nothing else checks them. (`TRUSTED_SUBMITTED_PERCENT:35` and
  `shift():52` are **Phase 2** and are module-locals, not exports — `noUnusedLocals` catches them at
  `tsc -b`, not `knip`.)
- **A11y:** Phase 2 adds `schools-facts-a11y.test.tsx` and `explore-a11y.test.tsx` (landmarks, the
  live region, focus rings on filter controls, status-never-colour-alone); `SchoolFactsPanel`'s
  loading state sets `aria-busy` (closing DESIGN.md §16.2 gap 2). DESIGN.md §13.4 gains a sanctioned
  exception: an honesty disclosure about what Counselle does or does not hold is written in first
  person plural ("We couldn't read…"), because the subject genuinely is us.
- **`/v1/config`** code is clean; `is_superuser` stays on `MeData` and still gates the backend.

### 6c. Database, seed, deploy, scripts

- `pgvector/pgvector:pg16` stays the dev image (§3.4); migrations untouched.
- **Seed rewrite:** the v3 `deploy/seed/cds_library_schema.sql` creates the `schools` base table
  (`deploy/seed/schema.sql` — the file `seed_reader_db.py:107` executes today — created
  `school_profiles` as a TABLE and never `schools`; `school_profiles.csv.gz` is a 20-column headerless
  extract of the *view*), `COPY`s the CSV — renamed `schools.csv.gz` — with the explicit column list
  while the `schools_projection_matches` trigger revalidates all 14 derived columns for 2,746 rows
  (the first time that round-trip is ever exercised; no `DISABLE TRIGGER`), creates `school_profiles`
  as a view, the eight tables, six views, the `tab_name` domain, triggers, functions, grants, default
  privileges. `seed_reader_db.py`'s bare `COPY:116` and `READER_TABLES` go.
- **Idempotent boot (appendix G-i):** `seed_reader_db.py` splits into always-run role reconciliation
  (now incl. `cds_library_app` and `cds_library_owner`), always-run DDL (every statement
  `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS; CREATE TRIGGER`), the once-only
  `schools` data load behind the existing emptiness check, `crosswalk-sync`, and always-run grants —
  so a schema change after first deploy is never silently skipped (the drift class the unapplied
  sha256 index lives in today). Only `scripts/dev.py reset-db` ever drops. **`seed_reader_db.py:178-181`'s
  silent "COUNSELLE_DB_ADMIN_DSN unset; skipping database bootstrap" exit becomes a non-zero exit** —
  under v3 the seed owns the whole schema (§3.3), so skipping it is not a degraded mode, and the DSN
  is in `entrypoint.sh`'s `required_env` (§6a).
- **Local dev:** `deploy/docker-compose.dev.yml` (image `pgvector/pgvector:pg16`, container
  `counselle-db-v3`, volume `counselle_v3_postgres_data`, `127.0.0.1:${COUNSELLE_DB_PORT:-5433}`,
  healthcheck; no init-script mount — bootstrap is host-side). `scripts/dev.py` (today only
  `start|stop`, discovers the container by published port and requires exactly one match) gains
  `reset-db`: require `COUNSELLE_DB_ADMIN_DSN` → compose up → wait → `DROP SCHEMA cds_library, counselle
  CASCADE` (the one destructive step) → `setup_db.sql` (roles) → the seed → `schools.csv.gz` →
  `crosswalk-sync` → yoyo from a clean ledger (runs 0001→0019 on an empty schema for the first time;
  `0002` survives only via `check_function_bodies = off`) → the Phase 0 grant verification. It
  discovers the container by **name first, port second**. **Owner step, named not implied:**
  `docker stop counselle-data-pipeline-db-1` before the new compose claims 5433; the old container and
  its volume `counselle-data-pipeline_postgres_data` are **left untouched until Phase 5 sign-off**
  (they are the pre-nuke copy) and their removal is a Phase 5 checklist line. The README fresh-DB
  recipe (`README.md:37-56`, which never loads school rows) becomes `dev.py reset-db`.
- **Ledger:** 23 rows vs 19 files; `0019` *is* applied (contrary to commit `13a6656`). The 4 orphans
  (`0015_essay_change_sets`, `0019_tasks_redesign`, `0020_task_sort_order`, `0020_essay_sessions`)
  left `counselle.essay_change_sets` (0 rows) and `counselle._task_migration_0019_waiting_ids` (2 rows)
  behind, referenced by nothing on `main` — the nuke loses nothing. But the unmerged worktrees
  (`.worktrees/tasks-redesign`, `.worktrees/essay-ai-panel`) number their migrations `0019_`/`0020_`,
  colliding with `main`'s `0019_drop_school_requirements`: **renumber to `0020+` at merge** and re-run
  their chain after the nuke. No migration references any `cds_library` object.
- **`.env.example`:** gains `COUNSELLE_DB_ADMIN_DSN`, `COUNSELLE_MAX_REQUEST_BODY_BYTES`,
  `COUNSELLE_DB_RESET_NOTICE_DATE` and the whole `COUNSELLE_FACTS_*` block; loses
  `COUNSELLE_AGENT_MCP_READ_TIMEOUT_S`, `COUNSELLE_SOURCE_EVIDENCE_MAX_ITEMS`, `COUNSELLE_CDS_DATA_ENABLED`
  (Phase 3), the `COUNSELLE_SETTINGS_NO_ENV_FILE` MCP-child paragraph; retitles the "CDS reader
  catalog and packet contract" section; rewrites the `COUNSELLE_DB_PIPELINE_DSN:89-94` comment
  ("pipeline" = facts crawler; `COUNSELLE_CDS_WORKER_ENABLED=false`).
- **Deploy scripts (Phase 4):** `finish_render_staging.py:170-171` PUTs the whole env list (drops
  anything not in its fixed dict on every re-run) → merge, and the fixed dict gains
  `COUNSELLE_DB_ADMIN_DSN`, `COUNSELLE_DB_PIPELINE_DSN`, `COUNSELLE_CDS_WORKER_ENABLED=false`,
  `COUNSELLE_FACTS_WORKER_ENABLED`; its hardcoded `"plan": "free"` (`:117-153`) becomes a parameter;
  `DEFAULT_BRANCH:29` reconciled; `finish_supabase_staging.py:73-79` hardcodes the five old view
  names → the six new ones (kept equal to the seed by `tests/test_view_contract.py`), and `:124-125`
  never provisions `cds_library_app` → does; `render.yaml:5 plan: free` → the owner's paid tier (§8).
  `docs/DEPLOY.md:79,170` reference a `/v1/ready` that does not exist — fixed while there. Backups:
  the managed provider's snapshots, stated in `DEPLOY.md`. Storage budget: first pass ≈ 95 MB of
  jsonb; steady state + changed pages, retention-capped at 3/page ≈ 300 MB worst case; Phase 4
  verifies the provider plan ≥ 2 GB.

### 6d. Docs, ADRs (appendix I for the section tables and replacement text)

- **ADR 0037** `0037-collegedata-facts-store-cds-parked.md` (outline in appendix I-iii): supersedes
  0032 (five views/four tools/manifest/packet-v8/evidence markers — saying which of its properties
  survive: reader-role/view boundary, code-owned availability and caveats, the viz provenance
  boundary) and 0004 (MCP as DB transport; its "the service layer is the real API" note is promoted,
  not superseded); narrows 0015 (the no-fetch clause appears at `:6`, `:9`, `:19`, `:24` — all four
  named; the search half stands); amends **0002** (its ADR-0032 old-data note at `:7` names
  `active_cds_documents`, the selected edition and current-manifest packets — replaced by per-fact
  presence, `has_collegedata` + `fact_count`, no edition or tier ladder), 0005, 0006 (its "DB results
  are `official`" clause → no tier), 0012, 0014 (`get_domain` → `get_facts`; the R3 reddit
  clarification restated), **0017** (its MCP-tool-loop-only carve-out is vacuous once every DB call is
  in-process), 0018 (bucket-3 examples) with a facts-store-generation old-data note; amends **0036 as
  parked, not retired** (following its own 2026-08-27 amendment pattern; the `parse_packet_row()`
  invariant survives only because `packets.py` stays importable — load-bearing); states **0019
  unchanged** (D9 is a one-time data reset), **0023 unchanged** (poller state lives in `facts_jobs`,
  the ADR 0036 precedent), **0027 untouched and facts changes deliberately publish no `ChangeEvent`s**;
  records that the band caption supersedes `specs/mvp2/PRD.md` story 33's wording; names
  `specs/school-facts/`, `specs/db-rewire/`, `specs/school-data-tool-call-polish/` as superseded
  records; records the legal posture (R0), the D1 narrowing (§4.6), and the schema/DSN-name
  decisions (Q6/Q7). 0024/0026 untouched. `docs/adr/README.md` row added; `README.md:161`'s
  "32 ADRs" → 37 (36 exist today; the line is already stale).
- **`docs/ARCHITECTURE.md`:** rewrite §8, §9, §10, §11, §17, §38 (→ "parked"); amend **§1, §2 (the
  top-of-doc diagram and flow narrative name the MCP box and `get_domain`), §3, §4, §5, §14, §16 ("every
  named DB fact carries registered evidence" is false under v3), §18, §19 (+ the health key and the
  `facts_crawl_pass_finished`/`shape_drift` events), §20, §21, §22, §24, §30 (read caching), §31
  (`staleTime`)**; the rest untouched. **`docs/DATABASE_GUIDE.md`:** §1/§3/§4/§5 replaced (eight
  relations, six views, grants, "pipeline" = crawler); §6/§7/§9 adapted (five states, per-`observed_at`,
  no evidence); §2 reused; §8 recipes rewritten. Both stay version-agnostic (no v3/date labels; status
  lives only in `CLAUDE.md`).
- **`DESIGN.md`:** §15.4 rewritten (the rail is flat rows only — no evidence rows, no omitted-count
  disclosure) and its "**the row is the link**" stretch-anchor rule (`:1136-1138`) gains a carve-out:
  a `db` row has no URL, so it renders no anchor and no hover affordance implying one, §15.3 amended (tier badge for `web|edu|reddit` only; the `db` chip's Counselle mark
  specified before it is built; no new icon family), **§1.1's absence bullet is amended first**, because it is the
  non-negotiable rule §19 rule 37 merely restates: "A value we do not have renders as **words**, never
  blank, never a dash, never a plausible-looking zero — and where we know *which kind* of absence it
  is, the words say which (§5.1's five states); where we do not, they say 'not available' and claim
  nothing more."; **§18's** "availability/'not available' rendering" bullet (`:1257`) becomes
  "availability rendering — the five state words and 'not available'"; §15.5's "not available"
  sentence replaced by the per-row state word on unavailable viz cells (§5.4); **§19 rule 37** ("An unavailable value renders 'not available'")
  amended to "An unavailable value renders words. Where the surface knows the fact's state — the facts
  page, viz cells — it renders that state's word (§5.1); where it does not — Explore's wide row has no
  per-column state — it renders 'not available'." (§21's checklist line is unchanged); §13 copy templates gain the five fact-state
  words ("Not checked" for `not_fetched`, "Not on file" for `not_published`) and section lines, "Checked {Month YYYY}", the
  section-level period foot, the stale line, the deadline
  foot, the two empty states, the admin empty/disabled strings, the universe line, the majors note,
  the band caption, the sign-in notice, and the §13.4 first-person-plural exception, plus the rule that **no student-facing string names the
  upstream source** (D3) — a Phase 2 exit grep asserts `grep -rin collegedata frontend/src
  config/assets/facts_sections.yaml config/assets/caveats.yaml domain/facts/state.py config/assets/step_labels.yaml app/facts/service_explore.py` outside comments
  returns zero — §5.2 gives the frontend no caveat and no band-caption literal, so **every
  student-facing string now lives in one of those six places**: the frontend, the two
  `config/assets` layout/caveat files, `config/assets/step_labels.yaml` (the activity-timeline voice,
  which this plan edits), and the code-owned constants in `domain/facts/state.py` (`BAND_CAPTION`,
  `ENTRANCE_DIFFICULTY_NOTE`, `MAJORS_MATCH_NOTE`, `RELIGIOUS_AFFILIATION_NOTE`, the five state words,
  the two `not_fetched` cause clauses, the section `fetch_state` lines and the section period
  foot; the DESIGN.md §13 template list additionally carries two strings this list does not
  reach — the page-level "'Checked' is when we last saw a value published" gloss, which is a frontend
  literal beside the freshness line and the only one of the two authored outside `state.py`, and
  `RELIGIOUS_AFFILIATION_NOTE`'s rendered sentence, whose **constant** is named here while its
  **copy** belongs in the template list) plus `app/facts/service_explore.py`'s `METRIC_LABELS` (the `metric_label`s the exclusion and
  null-tail chips render, for range and enum filters alike, which move server-side this round and live beside `SIZE_BUCKETS`; **noun phrases only** — a Phase 2 test asserts no entry ends in a period or exceeds four words, so a disclosure sentence can never reach "{count} hidden — {metric_label} not available", §5.3) — a frontend-only
  grep would check the one place the copy no longer is, and a three-path grep would pass with
  `BAND_CAPTION = "…CollegeData…"` sitting in the fourth; §14.2 gains the
  crawl-outcome badge mapping (§5.5); **§14.3's worked example is re-pointed** — `VerdictBand`'s
  severe-caveat treatment is deleted with `caveatSeverity` (§6b), so the "word plus glyph where
  severity matters" rule takes the admin dashboard's `failed`/`aborted` badges (`error` variant + the
  word + `AlertTriangle`) as its example instead, and the `school-cells.tsx` known-violation note is
  unchanged; **§13.4 `:988`** ("Never render an absent value as blank" + its four examples) gains the
  five state words and the where-the-surface-knows rule; **§16.2's gap 2** is **narrowed, not struck**: "No
  `aria-busy` anywhere" becomes "No `aria-busy` on the chat's streaming regions — screen readers
  announce partial updates. The facts panel's loading state and the admin stat tiles set it (§6b); the
  streaming surfaces do not." §20's debt row 15 (`No aria-busy on streaming regions | ai-chat`) is
  unchanged and now agrees with it. §14.1's five-variant contract
  is untouched.
  `frontend/src/styles/README.md` gains `schools.css` in its tier-3 family list (`:46-48`); it holds no `--school-fact-*` token to drop.
- **`CLAUDE.md`** (a symlink to `AGENTS.md`; edits land there): "What we're building" ¶2; **Status** —
  every CDS paragraph stands and gains an appended "superseded by ADR 0037 — parked, not deleted"
  note, plus one new dated paragraph when v3 ships; "Commands" (`cds_manifest_check.py` under a
  "parked" heading; add `python -m app.facts --once`, `dev.py reset-db`); the **Documentation map** rows
  for `ARCHITECTURE.md`, `DATABASE_GUIDE.md`, `deploy/seed/cds_library_schema.sql`, plus `PARKED.md` and
  the appendix; "The stack" (Database access, Catalog, Reading rules — drop "source-tiered" for `db`,
  DB bullets); "Scope guardrails" (six views, ADR 0037). Replacement text: appendix I-iv.
- **`README.md`** (`:3,7-8,17,37-56,58-62,69,160-161`), **`docs/DEPLOY.md`** (`:15-17,25-32,79,96,105-109,163-173`),
  **`TODOS.md`** (CDS-admin items and the two `live_db` failures under "parked — dormant, untriaged";
  the sha256-index item's file pointer → the parked path; `cds_max_pages_per_call` and per-metric-recall
  items closed as moot; new lines for the first SCD2-history reader and for the retention setting's
  owner), **`specs/README.md`** (State cells for `cds-pipeline/`, `db-rewire/`, `school-facts/`,
  `school-data-tool-call-polish/` → "superseded / parked, see ADR 0037"; a `school-data-v3/` row at
  graduation).
- **`PARKED.md`** at the repo root (linked from `CLAUDE.md`'s map and ADR 0036): what is parked and why;
  every parked path (backend, scripts, frontend incl. `config.ts`'s `CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS`,
  `specs/cds-pipeline/tuning/`); the preserved data (dump path incl. the off-workstation copy, CSVs,
  row counts, manifest hash); the nine import edges; a **known stale pointers** section
  (`app/cds/jobs.py:182`'s comment, which names both `cds_data_enabled` and
  `EmptyCatalog` — dead in Phase 0; `adapters/cds_gemini.py:88`'s docstring "Duplicated from `app.agent_node.model_name_from_setting`"
  after the Phase 0 hoist; `adapters/cds_store.py`'s docstring reference to `deploy/seed/cds_library_schema.sql` now means
  `deploy/seed/parked/cds_extraction_schema.sql`; the comment is deliberately not edited, D8); the
  revival steps in order (apply the parked DDL, restore the dump or `COPY` the CSVs, set the DSN, flip
  `COUNSELLE_CDS_WORKER_ENABLED=true`, re-add the four `api/main.py` lines, mount the router, re-add the
  three frontend routes); the dormant tests and the two untriaged failures; what must not be deleted.
- Out of scope, do not sweep into any v3 commit: **`mvp3-frontend/`** (166 tracked files, 110
  basenames shared with `frontend/` — it is the ADR 0026 prototype, is not part of v3's disposition,
  and is the reason every §6b filename must be read as `frontend/src/...`), `plans/backend-hardening.md`, `plans/tasks-redesign-*.md`,
  `plans/essay-ai-panel.md`, `plans/essay-skill/extracts/`, and the two untracked PDFs in
  `docs/research/` — `College Essay Essentials - Ethan Sawyer.pdf` and `Mohamed Abdelhamid_ PRPC
  Petition Response 8_30_2026.pdf` (both strays in `docs/`; move both to `artifacts/` when
  `docs/research/` is next touched, so the "generated artifacts go in `artifacts/` only" house rule
  has one statement covering both).

---

## 7. Phasing

**Branch and demo strategy.** One long-lived branch `feat/school-data-v3` off `main`; each phase is
its own squashed commit with the phase's exit tests green; `main` stays shippable and **is the
demoable build until Phase 3 lands** (§6 phase boundary). Optional but recommended: a second worktree on
`main` against a second container (5434) restored from the pre-nuke dump. **Abort path:** P0/P1 —
restore `full.dump`, reset the branch; P2/P3 — revert the phase commit (the DB is forward-compatible,
the old page is not); P4/P5 — revert only. **What the owner can demo after each phase:** P0 — the
app boots on an empty v3 schema against the new seed, the routine suite is green; the facts page still
renders its committed fixtures and the agent runs **web-only** (the hatch); P1 — the admin dashboard
shows a completed pass over real data ("No passes yet" before the first one); P2 — Yale, UGA, Berea
and Phoenix facts pages and Explore, fully real; P3 — the agent answers from facts with `db`
citations; P4 — a fresh managed Postgres bootstraps; P5 — docs.

| Phase | Deliverable | Exit test |
|---|---|---|
| **0 Foundation** | **Step 1, before anything drops:** capture the four live-only trigger functions and triggers to source (`pg_get_functiondef`/`pg_get_triggerdef`); `pg_dump --format=custom --no-owner --no-acl` of both schemas to `artifacts/school-data-v3/<ts>-prenuke/full.dump` + the seven-table CDS data-only dump (§3.5), both restore-verified into a scratch DB and **copied off the workstation**. Commit the five `plans/school-data-*.md`. `deploy/docker-compose.dev.yml`; `scripts/setup_db.sql` (roles incl. `cds_library_owner`, `cds_library_app`; object grants removed); the v3 seed (§3; `SET ROLE`; `tab_name` domain; extensions in the right schemas); `deploy/seed/parked/cds_extraction_schema.sql` (moved + completed, V-01 index kept); the four CDS CSVs moved to `deploy/seed/parked/`; `schools.csv.gz`; `deploy/seed/schema.sql` deleted; `scripts/dev.py reset-db`; `seed_reader_db.py` idempotent split; `tests/test_view_contract.py`; `.env.example`; `COUNSELLE_CDS_WORKER_ENABLED=false` + `api/main.py` CDS lifespan/import/mount removal + `start_facts_worker` stub; **`COUNSELLE_CDS_DATA_ENABLED=false`, the hatch collapsed to an unconditional `Catalog.load`** (manifest block removed), `EmptyCatalog` deleted, the v3 `render_data_picture`/`_DATA_SLOTS`/`data_picture.md` rewrite and `_NO_CDS_DATA_PICTURE` removal moved up here (§6 phase boundary), `counselle_db/service.py`'s three orphaned readers stubbed to raise, `test_catalog_contract.py` and `tests/evals/test_scorers.py` re-pointed onto the v3 `EvalContext`/`EvalSchool`, plus `app/viz.py:128,352`, `evals/runner.py`'s `build_eval_context`/`_school`, and the routine tests §6a names here (`test_viz_pure.py`, `test_caveats.py`, `test_foundation_regressions.py`, `test_live_db.py`, `test_viz.py`) + the `service_reference` interim guard; frontend 3-file swap + `error-card` promotion + `knip` baseline; `PARKED.md`; hoist `model_name_from_setting` (defined at `app/agent_node.py:247`; `:295` re-exports it into that module's namespace **deliberately** — `tests/app/test_profile_memory_services.py:637,650` imports it from there inside a test body); **the `DomainRow`/`format_cds_edition` move into `packets.py` is Phase 3, not Phase 0** (§6a); delete `dispose_cds_pollution.py` + its test; `tenacity` in `pyproject.toml`; ADR 0037 draft | fresh DB boots the API **with `COUNSELLE_DB_PIPELINE_DSN` set and no CDS poll attempted**; `select count(*) from cds_library.schools` = 2,746 with the projection trigger enabled throughout; `yoyo apply` runs 0001→0019 clean on an empty `counselle`; a task-title search returns rows (proves `similarity()` resolves); `select '[1,2,3]'::public.vector` succeeds and `select 'public.vector'::regtype` resolves; `cds_library_reader` selects all six views and is denied by name on all **nine** base tables; `cds_library_app` inserts one row into each of the **eight** new tables in FK order, deletes from `page_snapshots`, is denied `DELETE` on **the other seven** and `INSERT/UPDATE/DELETE` on `schools`; a direct `UPDATE` on `page_snapshots` raises; `test_view_contract.py` passes (seed = `finish_supabase_staging.py` = `DATABASE_GUIDE.md` §1); the preserve dump restores and `cds_manifest_check.py` prints the same hash; routine suite green with the CDS tests parked; `mypy` + `ruff` clean; `npm run build` + `npm test` green (the only rendered change is the promoted error card, whose per-site copy and `role="alert"` are preserved — `SchoolWorkspace.test.tsx:35`, `EssaysRoute.test.tsx:2072`); `knip` baseline recorded; workspace school search still returns 2,746 names; **no module outside the Phase 0 changeset reads a removed `CatalogSnapshot` field** — `rg 'snapshot\.(metrics|domains|coverage|coverage_aggregates|current_version|total_metrics|domain_counts|manifests)' --glob '!plans/**'` returns **nothing** — `catalog.py`'s three matches (`:294,297,299`) all live inside
`Catalog.domain()` at `:293`, which this phase deletes, and `tests/counselle_db/test_live_db.py` and
`tests/app/test_viz.py` are rewritten in this phase for the same reason (a `live_db` marker gates
pytest selection, never `mypy .`) — and the grep is **necessary but not sufficient**: a fixture supplying the
removed fields as keyword arguments through a `cast` — `tests/app/test_caveats.py:45` and `tests/app/test_viz_pure.py:40,51,431,505,792`, the only two such fixtures in the tree — is caught only by
running the routine suite; **a live turn on the empty v3 schema completes with the v3 data picture rendered** (no `AttributeError` in `prepare`) |
| **1 Facts store** | `scripts/build_crosswalk.py` + the adjudicated CSV; `adapters/collegedata/{fetch,parse}.py` (httpx loop, index-route overview, rotation-vs-not-found, 502 retries, 429/403 backoff, UA validation, sitemap filter/dedup); `domain/facts/*`; `app/facts/{models,mapper,crawl,crosswalk,jobs,service_admin,__main__}.py`; `adapters/{facts_store,facts_queries}.py`; `facts_keys.yaml` + `facts_sections.yaml` + `scripts/build_facts_sections_tabs.py` (the `tab:`/`tabs:` generator its exit pin re-runs); the eleven fixture captures + the sitemap fixture; SCD2 writer incl. the changed-tab-scoped close and the diff rule; retention in-pass; `school_explore_rows` + `fact_coverage_counts` upserts; `facts_jobs`/`crawl_runs` + the in-process worker (re-queue sweep) + `--once`/`remap`/`crosswalk-sync`; `/v1/health` `facts_worker`; `GET /v1/admin/facts/{status,unmapped}` + `POST …/passes` + `features/admin-facts/` (+ its a11y test) | sitemap loader yields 2,587 ± 5% school slugs and exactly 6 URLs per slug, de-duplicates, and excludes every slug with no tab siblings (on the committed fixture); zero unmapped labels across the eleven fixtures; the table-driven normalizer tests (§4.5) pass; no `fact_key` matches `\d{4}` or a city/state token; no `fact_key` is emitted from two tabs for one school; every `facts_sections.yaml` `tab:` equals `facts_keys.yaml`'s owning tab for that key and every section's `tabs:` is exactly the union of its keys' tabs (the generator is re-run in the test and its output compared byte-for-byte with the committed file); every `facts:` entry declares a non-empty `label:`; every group declares at most one of `foot:`/`foot_ref:`, and every `foot_ref:` names a module-level constant that exists in `domain/facts/state.py` and is a non-empty `str`; and every `fact_key` the mapper can emit into a listed group is listed exactly once; a fixture with an intermediate node removed produces the same `fact_key`s; no explore column or `fact_key` is the sum of two percentile facts; every CSV `method` is in the CHECK set; one full pass completes against the live site; a second pass writes zero new snapshots and **zero `school_facts` rows and closes zero facts**; a rotation that 404s N in-flight requests increments `build_id_rotations` by 1; a school missing one tab yields `last_status='not_found'` and no facts for that tab; a label removed from a fixture between two remaps is closed with no successor, and a label on an unchanged tab is not; a page reverting to a previously seen body repoints without inserting and without reopening a closed fact; a fourth distinct body leaves exactly three snapshots and orphans no live fact's `snapshot_id`; killing the worker at 50% and restarting completes the pass with ≈50% of the requests on the same `crawl_runs` row; a school with one permanently failing tab is marked complete; two pollers racing the enqueue tick produce one queued row; `--once` while a pass runs exits "already running" and writes nothing; with the worker flag off `next_run_at` is null, the screen says "Worker disabled", and **both** `[Run a pass now]` instances — the header's and the empty state's — render `aria-disabled` (not `disabled`, so they stay focusable and announce their reason), carry that reason in the accessible name, and enqueue nothing on click; with a pass already queued they carry the queued reason instead, and neither ever renders `loading` while no POST is in flight; an aborted pass renders "Stopped", a partial pass "Completed with errors", never "Completed"; `domain/facts/` passes `test_purity.py` and mypy strict with no override; `TabName`, `cds_library.tab_names()` and `school_data_status.tabs`' key set for a school with no `school_pages` rows are the same six strings. **Static gates, every phase:** `uv run pytest -m "not live_llm and not live_search and not live_db"` green; `uv run ruff check .` and `uv run mypy .` clean (the 309-file baseline); `npm run build` + `npm test` green. |
| **2 Product on facts** | `counselle_db/service.{get_facts,explore,majors}` (the one reader); `counselle_db/catalog.py` loads `facts_sections.yaml` into `CatalogSnapshot.sections` (**the whole parsed `facts_sections.yaml`** — sections (id, title, `headline:`, derived `tabs:`) and their groups (id, `label`, `chart`, `foot`/`foot_ref`, and each `facts:` entry's `key`/`label`/`tab`) — so `app/facts/service.py` builds every layout field from the catalog and the asset keeps exactly one loader, §5.2) + `app/facts/{service,service_explore}.py`; `GET /v1/schools/{unitid}/facts` (+ETag); `GET /v1/schools/explore` + `/majors` (`ExploreQuery`, exclusion accounting, `narrowest`, null tail, universe counts); `api/routes/schools_facts.py`; frontend facts rewrite (typed kinds, `TableBlock`, skeleton, `error-card`, empty states, freshness line + the section-level period foot, deadlines group + foot, wire-delivered band caption) + explore rewrite (URL contract preserved, "Load more", new controls, universe line, majors note, `classify-fit` cut) + `api/schools/*` hooks with `staleTime`; the sign-in reset notice; `AddSchoolDialog.tsx` + its test (the §5.6 prefill); a11y tests; `SIZE_BUCKETS` single owner | render set of **four** schools from the live DB: Yale, UGA (in/out-of-state), a school with no crosswalk row (Empty state), a school with one tab at `http_error` (that section's previously observed values render with their older dates and the re-check line; a key with no surviving row renders "Not checked"); University of Phoenix's Money section renders "Not on file", never "We couldn't read this page"; **honesty tests:** `not_fetched`, `not_published` and `not_reported` render distinct words; a reported `0`/`false` renders at full weight; a `BarGraph` bucket with `-1`/omitted never renders a zero-width bar; a `false` matrix cell renders a dash with `aria-label`; every deadline row **with a date** carries a cycle label, a rolling deadline renders "Rolling", a round the source marks not offered renders "Not offered", and the group foot renders; a fact with no `reported_period` renders **no suffix** and its section carries the period foot exactly once; no `fact_key` appears in both the top-level `deadlines` block and `sections`; the unfiltered explore response is **not capped** and its results count equals `browsable_total`; a section whose non-`ok` contributors are all `not_found` renders "We don't hold part of this section", never "couldn't be re-checked"; a section at `not_fetched` that still holds a `value` row renders the re-check line, not the bare "We couldn't read this page"; a school with every tab `never_fetched` renders "We haven't checked {school}'s pages yet", never "We couldn't read", a section mixing `never_fetched` and `http_error` renders the read-failure line, and the two `not_fetched` caveat texts are selected by the wire's `never_checked`, never by the client; a 404 renders the "We don't have this school" `Empty`, never the error card; no **fact or section** absence word is a frontend literal — `grep -rn 'Not reported\|Not checked\|Not on file\|Not offered\|We couldn.t read this page\|We don.t hold\|We haven.t checked this page' frontend/src/features/schools` returns only test files (the two whole-page `Empty` states, "We couldn't read {school}'s pages on the last check" and "We haven't checked {school}'s pages yet", are deliberately **not** on the wire — like the deadline block's `foot` they interpolate only data the response already carries and ship beside their own CTA label; they are pinned by `schools-facts-a11y.test.tsx`); every option the region, campus-setting and religious-affiliation controls offer matches ≥1 school, and every distinct value in `school_explore`'s `region`, `locale` and `religious_affiliation` is matched by exactly one **value** option — a `region` by its own name, a `locale` by its family (`split_part(locale, ':', 1)`, over the non-null rows), and a named affiliation by itself — while the religious-affiliation control's two **non-value** options are asserted separately, because each deliberately spans many rows: "Religiously affiliated (any)" matches every non-null `religious_affiliation` row and "No affiliation on file" every null one — the only unmatched rows being those whose `locale` is null (two of the 2,746 seeded schools; fewer if the crawl has not reached them), which the exclusion chip counts; asserted from one query over the same view the controls are built from, so the option list and the data cannot drift; Yale's `getting-in` renders the SAT and ACT bands through `FactRangeChart` with the group's band-caption `foot`, its applicant-pool group as a bar chart against `admissions.applicants_total`, and its selection factors through `FactOrdinal`, and no `*_p25`/`*_p75` value is printed twice in one group; Yale's Early Decision deadline row reads "Not offered", never "Not reported", while a school offering both reads dates; `grep -rn '"not published"' frontend/src/features/schools/explore` = 0; a card for a student with only an ACT score renders the ACT band labelled "ACT", never a "SAT" prefix, and two browsers opening the same Explore URL render the same band on the same card; filtering to test-optional reports those schools as an exclusion chip reading "{count} hidden — test policy not available", never "not reported" and never "no test policy", and includes them on "include"; the control filter offers three options and `control_counts` carries three keys; no control option is labelled with a bare "Private" — the three read "Public", "Private (nonprofit)" and "Private (for-profit)"; filtering to "Private (nonprofit)" returns no school whose `control` is `private_for_profit`; on the unfiltered screen the three facet counts sum to `browsable_total`; and **`control` is non-null on every `school_explore` row and equals that school's `basic_profile.classification.control` verbatim, on a database where no `school_facts` row for `identity.control_reported` exists at all** — the column takes no crawled input, so the for-profit count is never zero and never folded into "Private" (305 of the 2,746 seeded schools carry `Private for-profit`; the facet counts are over the browsable subset, not the seed); the rendered band caption names *students who reported a score*, never "enrolled students" unqualified (`grep -rn 'Half of enrolled students' .` returns only `specs/mvp2/PRD.md` and this plan's supersession note); no exclusion chip renders the word "no" before a metric label — the chip's wording is chosen by `reason`, not by control kind — every range, `sizeBucket`, `testPolicy`, `entranceDifficulty`, `calendar`, `major`, `deadlineBefore` and every boolean toggle (columns fed by a crawled fact) carry `reason: "missing"` and read "{metric_label} not available", while the filters over stores we hold entirely — `campusSetting`'s two null `locale` rows, and `gender` and `hsi`'s 61 — carry `reason: "not_reported"` and read "{metric_label} not reported"; filtering to a major reports the schools whose `majors` is null as a chip, never as a silent absence — and `grep -rn 'hidden — no' frontend/src` returns zero; `grep -rin collegedata frontend/src config/assets/facts_sections.yaml config/assets/caveats.yaml config/assets/step_labels.yaml domain/facts/state.py app/facts/service_explore.py` outside comments = 0; `grep -n 'middle half\|A published selectivity rating' config/assets/facts_sections.yaml` = 0 (both group footers reach the page through `foot_ref:`); the deadlines foot's date is the **oldest** `observed_at` among the rendered rows — a school whose `admission` tab last succeeded before its other tabs renders the older month, not the page's `observed_at`; a school with no anchorable cycle renders the foot with no cycle clause; and a school whose deadline-bearing tabs are all non-`ok` renders the foot as exactly "Confirm on the school's site before you apply." — the "Dates last confirmed {Month YYYY}" clause is what drops rather than being rendered with an empty date, and the instruction to confirm is never the clause that goes; no TypeScript file holds a band-caption literal (`grep -rn 'middle half' frontend/src` returns only test files); a fact older than `facts_stale_days` swaps the freshness line and carries `stale_facts`; a pending query renders the skeleton, never a redirect; the explore response lists excluded-for-missing counts per range, the null tail, `control_counts`, `browsable_total`/`catalog_total`, and `narrowest` on a zero result; `includeMissing` defaults off and reports the count; a shared pre-change explore URL resolves; typing an SAT or ACT score with `scoreFit` at its default changes the results count by zero — a score never hides a school on its own — while setting `scoreFit` filters per section and reports every school with no band for an entered section as an exclusion chip reading "{metric_label} not available"; a shared URL carrying the retired `testfit=` param falls back to `fit=any`; the band caption renders exactly once per Explore screen, in `ExploreResultsHeader`, never on a card and **never inside `PersonalizationChip`'s popover** — it is present on first paint with the popover closed, and every `VerdictBand` showing a score band resolves its `aria-describedby` to that mounted node; add-school offers no deadline when the fact's cycle differs from the application cycle, **adding a school with round `ED2` or `REA` offers no deadline chip**, and the offer line always names the cycle; `EXPLAIN ANALYZE` on state + admit-rate + major (containment form) stays under 50 ms; Yale's and Ohio State's payloads ≤ 150 KB; `grep -r "Common Data Set" frontend/src/features/schools` = 0; `npx knip` clean outside the ignore list. **Static gates, every phase:** `uv run pytest -m "not live_llm and not live_search and not live_db"` green; `uv run ruff check .` and `uv run mypy .` clean (the 309-file baseline); `npm run build` + `npm test` green. |
| **3 Agent on facts** | in-process tools with the moved docstrings and in-body citation minting; delete the MCP child, `api/supervision.py`, `build_mcp_toolset`/`AppDeps.mcp_toolset`, `on_failure`, `evidence_markers.py`, `legacy_citations.py`, the hatch (`cds_data_enabled`, `EmptyCatalog`, `_NO_CDS_DATA_PICTURE`), `mcp_smoke.py`, the mypy override — **same commit**; `counselle_db/sql_guard.py` split; `resolve_school` v3 + the never-"not in our database" rule; `get_facts` (capped, `truncated`); `query_database` over the five-relation allow-list + the `LIKE`-on-`fact_key` rejector + `_named_fact_keys` denominators + the majors two-statement rule; envelope `db` (+`source_key` with vintage, `tier` present-and-null); `fact_key` rename; caveats (eight kinds, slot-driven `_caveats`); `step_labels` `get_facts` row added and the `get_domain:31-38` row deleted + the set-equality tool-spec test; catalog `fact_keys`/`sections`; prompts/skills re-pointed (incl. `Composition Laws`, the band line, the deadline rule); evals re-pointed + eight new (runner in the same commit); `service_reference.py` on `get_facts` (interim guard removed); the frontend protocol rewrite + test disposition (§6b) + protocol goldens regenerated backend-first; `/v1/health` without `mcp` | evals ≥ the 2026-07-16 baseline on the re-pointed cases **and** all eight new cases pass; **honesty tests:** `query_database` rejects `current_school_facts`, any base table, and a `LIKE` on `fact_key`; cannot project `value` jsonb; a cross-school aggregate result carries `schools_with_value/schools_total` and the caveat, and an aggregate with no bound key says the denominator is unavailable; `majors @> ARRAY[$1]` over `school_explore` returns rows with the `majors` denominator and the printed-name sentence; a comparison with spread `observed_at` carries the caveat once; a `comparison_table` whose cells are `class_profile.sat_math_range` carries `BAND_CAPTION` under the card exactly once, and so does one built from `class_profile.sat_math_p25`/`_p75`; a `get_facts` result mints exactly one `db` citation (`tier` present and `null`, `school_unitid` set) and one marker end-to-end; `resolve_school` mints exactly one `db` citation and `query_database` mints **none** — a turn whose only DB call is `query_database` registers no `db` source, and an eval answer that quotes one named school's value from such a result fails `v3-denominator-cross-school`; a turn calling `get_school_profile` and `get_facts` for one school yields two rail entries with distinct vintages, while `get_school_profile` + `resolve_school` in one turn yield exactly **one**; no `db` citation ever renders a vintage with an empty date slot — a `get_facts` call on a school with `has_collegedata=false` mints the identity vintage, never "checked ."; no viz-cell state word is a frontend literal — the cell lowercases the wire's `display` at the render site (§5.4) — and `grep -rniE 'not reported|not checked|not on file|not collected' frontend/src/features/ai-chat` returns only test files, `explore-format.ts`'s `ABSENT_LABEL` staying the app's only sanctioned frontend absence literal; no `db` citation renders a tier badge at any of the three sites and no viz cell's badge or `aria-label` names a tier for a `db` cell; a `db` chip in a message that also renders a viz shows the Counselle mark at all three sites (`CitationRenderer`, `SourcesRail`, `MessageSources` tests); an application whose test-policy fact is stale renders unavailable with a disclosure; no prompt/skill names a retired caveat kind or an unshipped view/tool; `set(build_tool_specs(step_labels)) == the mounted toolset` — equality in both directions, so a label row for an unmounted tool fails (`test_tool_specs.py:118` form, §6a); `grep -r "Common Data Set" frontend/src` outside the parked tree = 0; no frontend test outside the parked tree names the deleted protocol vocabulary — including the incidental narration prose in `turn-reducer.test.ts:559,565,588,595,601` ("Checking the CDS.") and `model.test.ts:198,221` ("Reading CDS"), both already in the rewrite list and renamed with it, so the grep is an absolute zero; `npx knip` clean outside the ignore list; the three test lists' union is 68 distinct files with no file in two groups (§6a). **Static gates, every phase:** `uv run pytest -m "not live_llm and not live_search and not live_db"` green; `uv run ruff check .` and `uv run mypy .` clean (the 309-file baseline); `npm run build` + `npm test` green. |
| **4 Deploy scripts** | `seed_reader_db.py` provisions `cds_library_app`/`cds_library_owner` and runs `crosswalk-sync`; `finish_render_staging.py` merges env + plan-tier parameter; `finish_supabase_staging.py` six views + `cds_library_app`; `scripts/entrypoint.sh` `required_env`; `render.yaml` paid tier (owner); `docs/DEPLOY.md` (env matrix incl. the `FACTS_*` block, provisioning, backups, storage check, `/v1/ready` fix) and the runbook line: "this deploy drops the entire `counselle` schema — **all accounts, OAuth links, student profiles, workspaces, feedback, and sessions** — every user re-registers, `db_reset_notice_date` is set, and `scripts/promote_admin.py --email …` must be re-run for each admin before `/app/admin/facts` is reachable" | a fresh managed Postgres bootstraps end to end (roles → seed → schools → crosswalk → yoyo → grant checks) and the container boots twice without re-loading `schools`; the staging env after a second `finish_render_staging.py` run still carries every DSN and flag. **Static gates, every phase:** `uv run pytest -m "not live_llm and not live_search and not live_db"` green; `uv run ruff check .` and `uv run mypy .` clean. |
| **5 Docs** | ADR 0037 final + `docs/adr/README.md`; `DATABASE_GUIDE.md`, `ARCHITECTURE.md` (the full section list in §6d), `DESIGN.md`, `CLAUDE.md`/`AGENTS.md`, `README.md`, `DEPLOY.md`, `TODOS.md`, `specs/README.md`, `styles/README.md`, `PARKED.md` final; graduate the plan + appendix + the three research files to `specs/school-data-v3/{PRD.md,appendix.md,research/}`; the old container/volume removal checklist line | docs describe the running system with no version/date labels in `ARCHITECTURE.md`/`DATABASE_GUIDE.md`; every file:line this plan cites in `docs/` is re-verified; one eval run for the record |

---

## 8. Owner decisions still open (recommended default in bold; everything else in this plan is decided)

- **Q5 Legal / Terms of Use (R0 — must be answered before Phase 1 fetches anything).** CollegeData's
  Terms (browsewrap, 1st Financial Bank USA, South Dakota venue) state: *"All content on the Site is
  protected by copyright. Users are prohibited from modifying, copying, distributing, transmitting,
  displaying, publishing, selling, licensing, creating derivative works, or using any content on the
  Site for commercial or public purposes,"* and reserve *"all remedies available at law and in equity
  … including the right to block access from a particular Internet address."* `robots.txt` does not
  disallow the route we use. The original brief accepted this risk with four mitigations; D1 (whole
  site, daily) and D3 (no label, no attribution) remove two of them. **Recommended: accept knowingly,
  with the mitigations that remain in scope — robots respected, a truthful identifying UA with a
  contact URL, 1 req/s, no evasion, no bulk-export endpoint (authenticated, paginated, capped), snapshots
  retained only for lineage and never served — recorded as R0 in ADR 0037.** Alternatives: attribute
  the source (reopens D3), restrict to non-copyrightable facts, seek a licence, add a second source.
- **Q-D1 Narrowing** — "every school on the site" is delivered as every school that maps to an IPEDS
  institution (~2,300–2,400 of 2,587); the rest are visible on the dashboard, never crawled (§4.6).
  **Ratify.**
- **Q2 Freshness wording** — resolved as §5.2 ("Checked {Month YYYY}", per-fact period suffix or
  the section-level period foot, the stale line replaces it). **Confirm.**
- **Q3 `db` chip** — resolved as §5.4 (Counselle mark = the `SchoolIcon` glyph on `--brand-chip`, school as
  subject, no tier, no favicon at any of the three sites). **Confirm.**
- **Q4 Deadline prefill** — resolved as §5.6 (offer once per selected round, only when the cycle
  matches, as a suggestion chip, never re-synced). **Confirm or say "leave add-school alone".**
- **Q9 Crawl rate** — **1 req/s** (≈4.3 h of page requests, ≈9 h with the measured retry rate) with adaptive backoff, not 2. Confirm.
- **Q-tier Render web instance** — the crawler needs an always-on paid instance (`render.yaml` is
  `free`); a free instance sleeps and never runs a pass. **Owner cost decision before Phase 4.**
- **Q8 Old dev container/volume** — **stop the container at Phase 0, remove container + volume only
  at Phase 5 sign-off** (they are the pre-nuke copy until then).
- Decisions this plan makes that the owner may veto (defaults applied): schema name and DSN names
  stay (Q6/Q7); snapshot retention **3** (Q10); `facts_stale_days` 120 / `facts_spread_days` 30 (Q11);
  unmapped labels never rendered to students (Q12); the score-band card stays removed and one band
  caption (superseding PRD story 33's wording) rides the SAT rows, the verdict band and the chat card
  (Q13); the sign-in reset notice (Q14); a superuser sees no CDS surface (Q16); snapshots store
  CollegeData's content for lineage, never served (Q17); Explore keeps "Load more" (Q18); `staleTime`
  5 min / 60 s / 30 s (Q19); the facts tab URL stays `about` (Q20); the interim web-only agent on the
  feature branch between P0 and P3 (§6).

---

## 9. Risk register

| # | Risk | Handling |
|---|---|---|
| R0 | **Terms of Use / copyright (owner-accepted, re-confirmed under D1+D3 — Q5).** Contractual, not robots-based. | Mitigations in scope (Q5); no evasion ever; owner decision recorded in ADR 0037 before Phase 1. |
| R1 | **Freshness vs vintage (honesty).** CollegeData carries three data-year markers site-wide; "updated Sept 2026" beside a value derived from a 2023-24 CDS reads as this year's number. | `reported_period` where a label carries one (propagating from section titles), the deadline cycle rule, the section-level period foot on the page and the code-owned "reporting period unstated" vintage string in chat, "Checked" never "updated", the agent told explicitly. |
| R2 | **Misattribution (honesty).** A school's favicon on a `db` chip implies the school published the value — and today's code does exactly that at three sites when a viz is present. | Counselle mark on `db` chips, rail rows and the message source strip; the favicon branch skipped for `db` at all three sites; `CitationRenderer`/`SourcesRail`/`MessageSources` tests pin it. |
| R3 | CollegeData changes its JSON shape or the route. | Typed parser fails loudly per node type; unmapped labels counted, alerted past a threshold, listed on the dashboard; snapshots re-derive via `remap`; the HTML `__NEXT_DATA__` carries the same JSON as a fallback path. |
| R4 | buildId rotation mid-pass. | Distinct-transition counting, one re-read, abort after 3; not-found is distinguished. |
| R5 | Snapshot growth. | Byte-stable payloads (verified) → growth only on change; in-pass retention to 3/page; budget ≈ 95 MB first pass, ≈ 300 MB worst case; provider plan checked in Phase 4. |
| R6 | Two id spaces (~200–300 slugs without unitid, ~500–800 unitids without a page — measured, not ~350). | Visible on the dashboard; "Not collected" page state; the Explore universe line; excluded from every denominator; neither is an error. |
| R7 | Parked code — and data — rots silently. | Unit tests stay in the routine suite; the dump (+ off-workstation copy) and CSVs preserved and restore-verified; `PARKED.md` at the root lists paths, edges, data, stale pointers, revival steps. |
| R8 | The prod web instance sleeps (free tier) → no passes, silently. | Paid instance (owner); `/v1/health` `facts_worker: stale` degrades status; `--once` for manual runs. |
| R9 | Render free Postgres expiry (2026-09-18) before Phase 4. | Prod DB provisioning is owner-driven; nothing in-repo hardcodes the expiring host (verified). |
| R10 | Per-IP rate limiting / block by the Azure Front Door WAF in front of the data path. | 1 req/s default, halve on 429/403, abort after three blocks, counted on `crawl_runs`, visible on the dashboard. |
| R11 | Transient 502s are the normal first response on an uncached page. | tenacity retries with backoff; only persistent failure marks `http_error`; `partial` pass status is healthy in `/v1/health`. |
| R12 | The nuke is irreversible. | Restore-verified full dump before step 1, copied off the workstation; the old container/volume kept until Phase 5; per-phase abort paths (§7). |
| R13 | A crawler running against a third-party site by default on the first deploy that sets the DSN. | `facts_worker_enabled` defaults **false**; switched on deliberately after staging verification. |
| R14 | **A composite SAT band is easy to synthesize from the two section bands and is wrong** (the 25th percentile of a total is not the sum of two section 25th percentiles; PRD story 33 forbids a summed 1600). | No `sat_total_*` column or `fact_key` exists; score filters are per section; a Phase 1 test asserts no column or key sums two percentile facts. |
| R15 | The mid-swap interim (P0 until Phase 3 lands) ships a web-only agent on the feature branch. | Deliberate and stated; `main` stays the demoable build; Phase 3 lands the tools, envelope, goldens and frontend protocol in one commit. |

---

## 10. Definition of "nothing dead" (the disposition rule, appendix H-iv for the table)

`PARKED` = kept in-tree, unreachable at runtime, listed in `PARKED.md` with a revival step. `DEAD` =
deleted in the phase that orphans it. `LIVE` = load-bearing. Everything this plan touches is in
exactly one state: parked — the seven CDS packages, six scripts, 26 tests, 64 frontend files +
`config.ts`'s one export, the tuning corpus, `supported_packet_extractor_versions` (commented), the
CDS CSVs and dump; dead — the MCP child, supervision, the `on_failure` hook, evidence markers,
legacy citations, `EmptyCatalog` (deleted in Phase 0, the phase that orphans it), `cds_data_enabled`,
`_NO_CDS_DATA_PICTURE` (Phase 0), `caveatSeverity` + `SEVERE_CAVEAT`, `LADDER` (`classify-fit.ts:37` — its only readers are the deleted `shift()`'s `:53`/`:59`), `formatTestBand` (superseded by `formatBand`), `admitLabel`,
`BandFact.p50` / `BandsBlock`'s `p50` (CollegeData publishes p25/p75/avg and never a median — no
v3 producer, and unlike `BandFact.submitted_percent` it is not a stated seam), `BandSpec`,
`splitBands`, `GroupRender`'s `{chart:"bands"}`
arm, `FactRangeChart`'s median row, `ABSENT_TOPIC_EXPLANATION`, `factStateCopy`, `isReported`,
`excludeRestrictiveEarlyAction`/`GreekFilter`/`TestFitPreset` and their controls (no v3 backing
field — §5.3; caught by no gate),
the `start_cds_worker`
call, `deploy/seed/schema.sql`, `dispose_cds_pollution.py`, the facts/explore fixtures, the dev facts
gallery, `legacy-replay.ts` + its fixture, `classify-fit.ts`'s score branches, `CaveatSeverity`, the evidence and
derived CSS tokens (`--school-fact-derived-ink`, `-evidence-ink`, `-evidence-hover`, `-well`),
the retired absence strings, the settings and `.env.example` entries named in §6a/§6c, the mypy
override; live — `counselle_db/formatting.py`, `Catalog`, `read_tool_result`, `AdminGate` (guards the
new route), `error-card` (promoted), `SchoolResultCardSkeleton` (already used at `ExplorePanel.tsx:209`; stays, now on first load only), `_SECRET_FIELDS`,
`BandFact.submitted_percent` (always null under v3 — the wire seam a future source fills, stated,
not dead), `school_explore_rows.institution_level` (**stored, not filtered** — a single value,
`Four or more years`, across all 2,746 seed rows, so a control over it would offer one option; it
stays a projected column because `school_explore` is on the `query_database` allow-list and the agent
may need it the day the seed widens. Stated, not dead), the SCD2 history columns (written now, read
later — stated, and the reason there is no history index). Every `Settings` field in §4.3 has a named consumer.

---

## 11. Review resolution

**Thirteenth round (review loop round 9): all three lenses returned NOT PERFECT.** The product lens
raised the round's only blocker, and it was a placement I introduced in round 8: §5.3 put the
wire-delivered band caption "beside the score inputs", and those inputs live inside
`PersonalizationChip`'s `w-64` `PopoverPopup` (`ExploreResultsHeader.tsx:71,100-114`, verified), which
is closed by default — so the default Explore screen would show up to 24 score bands with the release's
flagship honesty string behind a closed popover, and every card's `aria-describedby` pointing into an
unmounted node. That is a net regression against the shipped `SEVERE_CAVEAT` it replaces; the caption
now renders in the results header, always mounted. Two lenses independently found the Phase 2 control
gate unsatisfiable (893+1,548+305 = 2,746 is the *seed* total, which `browsable_total` can never equal),
and its "no `campus-life` tab fetched" condition was a fossil of the derivation round 8 deleted. The
technical lens found the `app/sources.py` delete range `:174-187` swallowing `if marker:` and
`annotated["marker"] = marker` — taken literally, no tool result would ever carry a citation marker
again, on the app's sole honesty gate (correct range `:176-187`), and a twelfth deletion orphan
(`evals/runner.py:41`'s `get_domain`, which fails Phase 0's own ruff gate). The cleanliness lens found
a **thirteenth orphan of a class no prior round had walked**: `--school-fact-well`, a CSS custom
property the plan explicitly instructed be *kept*, whose only consumer is the `EvidenceRow` blockquote
the same commit deletes — invisible to `knip` (it does not parse CSS), to `tsc`, and to both exit
greps. Three separate lenses independently caught the same wrong `navigation.tsx` range (`:70-77`,
mid-array; correct `:72-79`) — the sixth mid-element delete range this loop has corrected. Two
measurement corrections were settled by decoding the seed directly: `control` is confirmed at
893/1,548/305 with zero nulls (my round-8 fix stands, and the technical lens reproduced it on a pg16
container), while my round-8 claim that the 1,923 null `religious_affiliation` rows carry no IPEDS
code was **wrong** — all 1,923 carry `raw_value: -2`, zero carry `-1`; the error was an artifact of
parsing a headerless CSV with `DictReader`. The note's conclusion survives (the column projects
`normalized_value`, not the code) but its justification is rewritten to claim only what was measured.
Process correction: the round-9 briefs told all three reviewers every prior finding had been folded
in; verified false for the NIT tier — only 1 of round 8's 12 technical NITs had landed. All eleven
remaining were folded in this round, and no future brief asserts a fold-in state without re-grepping
it first.

**Twelfth round (review loop round 8): the technical lens reported **no blocker** for the first time
("nothing here is a design that cannot work"), and all three lenses confirmed their round-7 findings
resolved with none regressed.** The decisive twelfth-round changes: **the `control` filter's
derivation reversed** — the round-7 text made `private_for_profit` depend on a crawled `campus-life`
fact, but decoding all 2,746 seed rows shows IPEDS already publishes three values with zero nulls
(Public 893 / Private not-for-profit 1,548 / Private for-profit 305), so on the first Explore screen
after ship all 305 for-profits would have sat inside "Private" with a facet count to match, and
permanently for any school whose `campus-life` tab never reads; the column is now projected verbatim
and `identity.control_reported` is a cross-check only. `tests/evals/test_scorers.py` moved to Phase 0
as the **third** instance of the `cast`/keyword-argument trap class (no marker, 45 routine tests, the
only importer of `evals.runner`), and `tests/app/test_durability.py` added to the rewrite set, taking
the partition to 6/35/27 = 68 — it passes `mcp_toolset=None` to a field Phase 3 deletes and sat in no
group at all. Three Explore-control delete ranges corrected after both lenses independently measured
them cutting mid-JSX; the `BandSpec` doc-comment range corrected from `:23-36` to `:28-36`, since
`:23` closes the file header and `:25` is `FactEntry`, which every surviving `GroupRender` arm uses;
the `locale` option query given an `IS NOT NULL` guard, without which `campus_setting` carries a null
option and Phase 2's own drift gate fails; a group `foot_ref:` added so a code-owned honesty string
reaches the page without a second copy landing in the yaml; `RELIGIOUS_AFFILIATION_NOTE` rewritten to
claim about our column rather than about IPEDS (the seed stores those 1,923 rows as a bare null with
no code behind it, so the original sentence asserted what our own data cannot support); the deadlines
foot given its own `observed_at` rather than the page-level max across six tabs; and the band
caption's viz trigger extended to the `class_profile.*_range` band facts, the shape round 6 moved the
band to.

**Eleventh round (review loop round 7): all three lenses read a frozen file and each verified its own
prior findings against the tree before looking for new ones. Three blockers, eight must-fixes, and the
rest.** The decisive eleventh-round changes: **`BAND_CAPTION` corrected** — the release's flagship
honesty string said "Half of enrolled students scored inside this band", but a CollegeData middle-50
band covers only the enrolled students who *reported* a score, which is what §5.4's prompt rule tells
the model to say and what `classify-fit.ts:20-23` calls trap 1; the caption's own second clause ("we
don't know how many submitted scores") was the reason its first clause could not be said, and the
error ran in the direction that makes a 700-scorer believe they are below half of Yale's class.
**Three shipped Explore controls given a disposition** — `excludeRestrictiveEarlyAction`, `greek` and
`testFit` all lose their backing data in §5.3 and were named in no list, and no gate could see it
(`tsc` passes on a still-typed field, `noUnusedLocals` on an object property, `knip` on a
still-imported option list), so a student would have ticked "Exclude restrictive early action" forever
with nothing behind it; the URL-contract sentence was wrong in the same place, disproved by its own
cited range. **`facts_sections.yaml` entries gain an authored `label:`** — the wire's required
`FactBase.label` had no source for a key with no row, which is exactly the row §4.4,
`compressAbsences` and Phase 2's exit gate all require. Plus: the exclusion chip's two reasons
re-sorted so a crawled-fact null takes `missing` and only a store we hold entirely takes
`not_reported`; the `control` filter opened to three options so "Private" stops silently dropping
every for-profit school; `religious_affiliation_note` and the section-level period `foot` given wire
fields; `Fact.never_checked` dropped as a field nothing reads (the `bandTrusted` case); `ABSENT_TOPIC_EXPLANATION`
found as the eighth deletion orphan and the last uncovered "Common Data Set" string;
`GroupRender:63` corrected to `:64` (`:63` is the `ordinal` arm this plan keeps); the Phase 2
absence-word grep narrowed so §5.2's own page-level `Empty` strings stop failing it; and
`explore-filter.ts`'s blast radius restated from three exports to three exports plus thirteen
module-locals.

**Tenth round (review loop round 6): the product lens reported no blocker for the second round
running and 15 findings; the technical and cleanliness lenses hit an API session limit mid-read and
were re-run against this text.** The decisive tenth-round changes: `line: string | null` added to the
enumerated section contract — it is the sole carrier for all seven section disclosure sentences and
the prose mandated it while the contract an implementer copies omitted it; `filter_options` added to
the explore response, because region, campus setting and religious affiliation were all forbidden
from holding frontend option lists and nothing carried them; `entrance_difficulty_note` and
`majors_match_note` added for the same reason; the campus-setting control collapsed to IPEDS's four
`locale` families after the seed showed twelve values in four families of three, which the region
label/description split would have rendered as three checkboxes each reading "City"; the size-bucket
fallback dropped, because IPEDS's five bands straddle two `SIZE_BUCKETS` boundaries across 1,190 of
2,746 rows and every mapping misclassifies someone; the exclusion chip's `missing` branch changed
from "no {metric_label}" to "{metric_label} not available" — every four-year school has an admit rate,
so the shipped sentence asserts something false about the school on the same screen where
`ABSENT_LABEL` was renamed for exactly that reason; and the score band moved wholly to the wire as a
`band` **fact**, since §6b was editing client-side `p25`/`p75` ref machinery that the wire's `chart`
union has no arm to populate, which would have left `FactRangeChart` unreachable on the one surface
`BAND_CAPTION` exists to qualify.

**Ninth round (review loop round 5): the file was frozen for the whole round. All three lenses
confirmed their round-4 findings resolved and raised 14 (product) + 10 (cleanliness) + 19 (technical)
new ones, all folded in here. The product lens reported no blocker for the first time.** The decisive
ninth-round changes: `BandFact.p50` deleted — CollegeData publishes p25/p75/**avg** and never a
median, `school-facts-blocks.ts:507-510` refuses to emit a band without all three, so
`FactRangeChart`/`BandsBlock` would have gone unreachable (or printed a fabricated median, the R14
prohibition one field over), and `FactRangeChart.tsx:62`'s "middle 50% of **submitted** scores" was a
frontend-authored sentence denying the very `BAND_CAPTION` §5.2 makes code-owned;
`tests/app/test_viz_pure.py` moved to Phase 0 as the second `cast(Catalog, SimpleNamespace(…))`
fixture — invisible to mypy through the cast and to the grep gate through keyword arguments, exactly
the trap class the plan already documents for `test_caveats.py`; `CatalogSnapshot.sections` filled in
Phase 2 rather than Phase 3, since Phase 2 ships every consumer of the key→tab map and its exit tests
depend on it; the `app/graph.py` arm's closing paren at `:103` deleted with it (the round-4 narrowing
was right about scope and left a `SyntaxError`); every absence word and section line composed
**server-side** and carried on the wire, with `ABSENCE_COPY` and `ROUND_NOT_OFFERED_COPY` deleted
rather than kept in a second casing; a `line: string | null` per section, because one of the eight
sentences interpolates a per-section month the client is never given; group `chart` added to the wire
(four bar charts over scalars with a shared max cannot be derived from any fact's `kind`); the
exclusion chip given a `reason`, so an enum exclusion reads a chosen absence word instead of the
shipped component's "no test policy" (round 9 settled which word: `test_policy` is a crawled fact, so
it takes `reason: "missing"` and reads "test policy not available"); the region option split into label and states (the seed stores
the OBEREG name with its state list inlined, 58 characters); `TierBadge` given a null arm, since it
falls through to the word "Community" on Counselle's own data; the `not_fetched` caveat expressed as
one templated entry, because `app/caveats.py:25-28` accepts exactly `{text, slots}` per kind;
`section_state()` split out because a single-`page_status` signature cannot express "every non-`ok`
contributor"; `school_data_status` read live rather than from a catalog copy that
`data_catalog_refresh_seconds=3600` could leave an hour stale; `undergraduate_full_time` added as an
explore column (the students-per-faculty filter had no numerator); and the reset notice returned to
the third person, because `AuthLayout` wraps `/register` and telling a first-time visitor *their*
profile is gone is the falsehood that notice was moved out of the app to avoid.

**Eighth round (review loop round 4): all three lenses re-read a frozen file. Each confirmed every
one of its round-3 findings resolved; they raised 19 (product) + 16 (cleanliness) + 26 (technical)
new ones, all folded in here.** The decisive eighth-round changes: the test-policy filter's members
corrected to the **source's** vocabulary (`required|considered|not_required|not_reported`) — the live
capture prints "Considered if submitted", which no member of the CDS-era set could hold, so the
mapper would have crashed or lied, and "Blind" was a filter option for an empty set whose zero result
the honesty affordances would have explained as "no test-blind schools exist"; `never_checked` added
to the wire, because `fetch_state` has one member for both causes and dropping `tabs` in round 2
removed the data path — without it every school between Phase 1's deploy and its first pass would
read "We couldn't read {school}'s pages" about pages nothing ever requested; the section **headline**
given a wire slot as the first group (the shipped page's lead band had none, and the appendix's own
`headline:` lists would have rendered Yale's Regular deadline twice, failing the plan's own
no-double-render test); `TabularRenderSpec.foot` widened to `tuple[Caveat | str, ...]` so the band
caption is not forced to become a ninth caveat kind against the pinned eight-kind equality;
`tests/counselle_db/test_live_db.py` and `tests/app/test_viz.py` moved into Phase 0 — classified
"dormant, untouched" for three rounds, but a `live_db` marker gates pytest selection and **never**
`mypy .`; Phase 0's grep gate corrected to expect **nothing** (its stated expectation,
`counselle_db/catalog.py`, matches only inside the `Catalog.domain()` the same phase deletes); only
the flag *arm* of `app/graph.py`'s ternary deleted, since the cited `:96-104` range would have left an
unclosed paren and removed the `snapshot is None` guard two routine tests depend on;
`max_request_body_bytes` raised to 16 MiB after it was found to sit *below* the 15 MiB document limit
it exists to protect; the key→tab map made per-key, because a section-level set leaves an absent key
in the two-tab `campus-life` section with two candidate states; the six tab names given a single
function-backed home (`tab_names()`) so the status view stops needing a second literal copy;
`ReplaySourceEntry`'s three runtime importers named; static gates (`pytest`/`ruff`/`mypy`/`npm`) added
to Phases 1–3, which had none; the backend test partition recounted on disk to 6/34/27 = 67 distinct (**68** since round 13 moved `tests/app/test_durability.py` into the rewrite set);
and the D3 no-source grep extended to `domain/facts/state.py`, the fourth home this round's own fixes
created.

**Seventh round (review loop round 3): all three lenses reported. Technical confirmed all 52 of its
round-1 findings resolved (it did not run in round 2 — an API rate limit killed it); product and
cleanliness each confirmed every previous finding resolved. New: 15 (product) + 20 (cleanliness) +
27 (technical), all folded in here.** Technical's decisive catches: the schema has **eight** new
tables, not seven, and §3.3 — declared the single source of every object grant — granted seven, a
miss that would surface as a Phase-1 `permission denied` past the Phase 0 gate; `UNIQUE (lower(slug))`
is not legal as a table constraint (proved on pg16 — PostgreSQL has no expression unique
*constraints*), while the §3.1 preamble claimed everything but partial uniques parsed as-is; nothing
owned the key→tab map, so `fetch_state` and `not_fetched`/`not_published` had no data path for a key
with **no row** (now a `tabs:` field in `facts_sections.yaml`, generated from the mapper's asset and
pinned equal to it); and `tests/app/test_caveats.py` is a routine test that drives
`render_data_picture` through a `cast`ed `SimpleNamespace`, so it is invisible to mypy *and* to the
Phase 0 grep gate added the round before — the gate is necessary but not sufficient. It also caught
that the ≈4.3 h/pass figure ignores the plan's own measured 100% first-try-502 rate (≈9 h cold), that
"the agent can never quote" the derived student:faculty ratio is not delivered by the design (both
inputs stay on `school_explore`), and 15 verified off-by-one citations — including one this round's
own edits introduced (`test_catalog_contract.py:280` → `:281`, where the cleanliness reviewer's
correction was itself wrong).

The product and cleanliness lenses' decisive seventh-round changes: `explore-format.ts`'s shipped `ABSENT_LABEL = "not published"` renamed to
"not available" (under v3 that phrase is a *defined* fact state, and `school_explore_rows` carries no
per-column state, so the default screen would assert one specific false claim over three different
absences, 24 cards at a time); the rule that a surface renders a state word only where it knows the
state; a round the source marks **not offered** rendering "Not offered" instead of "Not reported"
(Yale publishes the flag, the plan already maps it, and the contradicting row already sits three
groups below); the reset notice enumerating what D9 actually deletes, essays included; the D3
no-source grep extended to the backend assets where every student-facing string now lives; an
implementable `EvidenceLine` rule plus `formatBand` (deleting `formatTestBand` would have printed a
`SAT ` prefix over an ACT band); `AddSchoolDialog.tsx` named as §5.6's only implementation site;
"Not on file" replacing "Not published" as the rendered word (D3 leaves *the school* as the only
actor an agentless "not published" can suggest, which the caveat then has to deny); `test_policy`
made `NOT NULL` with a fourth member so a school we could not read is never silently dropped; and on
the cleanliness side, three more live readers of the deleted `CatalogSnapshot` fields moved into
Phase 0 (`app/viz.py`, `evals/runner.py`, `test_foundation_regressions.py` — `mypy .` covers `evals/`),
the `DomainRow`/`format_cds_edition` move deferred to Phase 3 (in Phase 0 it is a circular import
that also breaks the live `app/tool_middleware.py`), `hex_digest` moved to `formatting.py` so
`Catalog` is not a permanent runtime→parked edge, the `AdminGate` import deleted in Phase 0 and
re-added with its route in Phase 1 (`noUnusedLocals`), `FitVerdict.bandTrusted` dropped because it
does not exist, and `identity.description` not mapped at all (a second copy of the most
copyright-exposed value in the store, with no reader). The decisive sixth-round changes: the add-school prefill offers a deadline only for `ED`/`EA`/`RD`
and nothing for `ED2`/`REA`/`Priority`/`Rolling` (the `else` branch would have offered the Regular
date for an ED II round); no student-facing string names the upstream source (D3), including the
wire-delivered `not_published` caveat; the explore count cap raised above the corpus and rendered
"{N}+" when it binds; "period not stated" dropped as a per-row suffix and explained once per section;
the reset notice moved to an unauthenticated `GET /v1/config/public` (its audience has no account);
`partial` sections name their actual cause and `money` draws from one tab, so Phoenix passes the gate
the plan itself set; the `get_facts` docstring's four unavailable states; the explore blast radius
made real (`caveatSeverity`, `SEVERE_CAVEAT`, `EvidenceLine`, `explore-format.ts`,
`PersonalizationChip`, `SchoolResultCard.test.tsx`); the band caption given one backend home; the
Phase 0 boundary made buildable (the hatch cannot skip the data picture once a real `Catalog` loads,
so the prompt/graph rewrite and `EmptyCatalog`'s deletion move to Phase 0); `CaveatKind` created so
the three-way caveat equality has three sides; the card-level viz `foot` that the spread caveat and
band caption need; `router.tsx:3` kept (it is `AdminGate`); `COUNSELLE_DB_ADMIN_DSN` required at boot;
`knip` run at Phase 3 too; and the per-row state word on unavailable viz cells. The decisive
fifth-round changes: the SCD2 close scoped to changed tabs (the literal fourth-round text would have
withdrawn every fact nightly); the true scope numbers (2,587 / 15,522) and the state-list pages
excluded; divider-qualified keys instead of ordinals; header keys with one owning tab; the sweep
that re-queues instead of failing forward and `last_attempted_at` for resume; the live-only trigger
functions captured to source before the drop; the phase boundary made buildable by reusing the
`cds_data_enabled` hatch until Phase 3; the `on_failure` hook and the supervisor sites deleted
together; the frontend test disposition; a fifth fact state (`not_published`) and the rule that a
failed tab never hides a held value; "period not stated" on the page; the vintage-aware dedupe key
and the third favicon site; no composite SAT anywhere (R14); no stored derived ratio; deadlines
prefilled only in-cycle; the reset notice on the sign-in screen; the crawl-outcome badge mapping; the
universe line on Explore; `tier` present-and-null; `pg_try_advisory_lock`; no GIN; the crosswalk on
the app DSN with the existing normalizer; the CSV/DDL aligned with one loader; one owner for the
view list, the size buckets and the band caption. Verified baselines: ruff clean, mypy clean (309
files), routine pytest 1,774 passed, `npm run build` green, 93 frontend test files / 1,010 tests, the
3-file frontend parking edit executed on a copy, the §3.1 DDL parsed on pg16, a 1.17M-row coverage
rewrite in 299 ms.

Third round: the adversarial review (53 findings) is folded in. Fourth round: ten verification agents
(scraping tools A, database B, backend C, frontend/UX D, field mapping E, agent honesty F, deploy/ops
G, product gaps H, docs I, API/modules J — reports in the session scratchpad, appendices in the
companion file) produced ~200 findings, all resolved. **Fifth round: three independent reviewers
(technical correctness; product/UX/honesty; cleanliness/blast radius) read the fourth-round text
against the live tree, the live database, a scratch pg16 container, and the captures — 52 + 33 + 24
findings, every BLOCKER/MUST-FIX/SHOULD-FIX and every NIT that touches the main plan resolved here;
appendix-only line-number nits are covered by the appendix header's precedence rule.**
**Sixth round (review loop round 2): the same three reviewers re-read the fifth-round text against
the tree; both completed reports confirmed every one of their round-1 findings resolved in substance,
and raised 26 (product/UX/honesty) + 14 (cleanliness/blast radius) new ones — all folded in here.**
