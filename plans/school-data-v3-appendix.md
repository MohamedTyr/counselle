# School data v3 — companion appendix (verification-round material)

**Status:** companion to `plans/school-data-v3.md` (thirteenth round, 2026-09-06). This file carries the
long-form material produced by the ten verification agents: the complete CollegeData label
inventory and proposed `fact_key`s, the `facts_sections.yaml` draft, the `school_explore_rows`
columns and index list, the API/pydantic and TypeScript shapes, the worker/SCD2 SQL, the citation
chip spec, the admin dashboard spec, the test/skill/eval/ADR disposition tables, and the measured
crosswalk numbers. It graduates with the plan to `specs/school-data-v3/appendix.md`.

**Precedence rule:** the main plan wins over any sentence here, and **within this header the newest
block wins**. Blocks are ordered newest first. These appendices were written before the final
decisions were taken; a superseded bullet is rewritten in place with a "supersedes …" note, never
left standing beside its replacement.

**Thirteenth-round overrides (review loop round 9):**
- The religious-affiliation option above the 61 names is **"No affiliation on file"**, not "Not
  stated" — a claim about us, not about the source; the tenth-round block's `"Religiously affiliated
  (any)" and "Not stated" above the 61 names` is superseded (plan §5.3).
- The one name for this source on every chat surface is **"Counselle school data"**; appendix
  F-iii's rows rendering `citation.vintage` and the per-fact `vintage` as "Counselle facts · …"
  are superseded — both rows of F-iii's field table, named there rather than by line (plan §5.4).
- The vintage is **lowercase mid-string** — "Counselle school data · checked {Month YYYY}" and
  "… · identity profile from {snapshot_date}" — so appendix D-C's "· Checked {Month Year}" meta
  lines — all four of them, across D-C's chip, hover-meta and rail-row
  specs — are superseded; the only sentence-initial "Checked"
  anywhere is the facts-page freshness line (plan §5.2/§5.4, DESIGN.md §13.4).
- The backend test partition is **6 delete / 35 rewrite / 27 parked = 68 distinct of 140**
  (`tests/app/test_durability.py` joins the rewrite set); the two earlier "67" bullets — the
  **C-C headers are all stale** bullet in the eighth-round block and the C-C1/C2 header note in the
  earlier-overrides block, neither at the line numbers this bullet used to name — are rewritten in
  place to agree, per this header's own rule that a superseded bullet never stands beside its
  replacement (plan §6a).
- The **fourth test-policy option is "No policy on file"** and its exclusion chip reads "test policy
  not available" with `reason: "missing"` — `test_policy` is a crawled fact, so "not reported" would
  assert the school published nothing when our crawler may simply have failed (plan §5.3).
- `styles/schools.css`'s **`--school-fact-well` is deleted, not kept**, together with
  `--school-fact-derived-ink`: its only consumer is the `EvidenceRow` blockquote the same commit
  removes, and no gate in the plan can see a CSS token with no reader (plan §6b/§10).
- The band caption renders **in `ExploreResultsHeader`, never inside `PersonalizationChip`'s
  popover** — a popup that is closed by default cannot carry a qualifier for 24 bands already on
  screen, and an `aria-describedby` into an unmounted node resolves to nothing (plan §5.3).
- `query_database` mints **no** `db` citation (the validator requires `school_unitid`); `get_facts`,
  `get_school_profile` and `resolve_school` each mint one (plan §6a).
- The seed's 1,923 null `religious_affiliation` rows each carry `raw_value: -2` with zero `-1`s —
  the round-8 claim that they are bare nulls with no code is **withdrawn as measured-wrong**; the
  conclusion is unchanged, because the column projects `normalized_value`, not the code (plan §5.3).
- Appendix B's **`ExploreRequest.test_fit` is renamed `scoreFit`** with members
  `any|at_or_above_p25|inside_band|at_or_above_p75`, evaluated per section against
  `sat_math_*`/`sat_ebrw_*`/`act_composite_*` and **defaulting to `any`**, and **`sat_score` is
  replaced by `sat_math_score` and `sat_ebrw_score`** beside the `act_score` already there — all
  three profile numbers filter nothing on their own (plan §5.3).
- Appendix **F-iii's `tool_name in {"get_facts","get_school_profile"}` minting branch is
  superseded**: `resolve_school` is in the minting set and `query_database` is not; `get_facts`
  mints the facts vintage, `get_school_profile` and `resolve_school` the identity vintage, and a
  facts vintage is never minted over a null `facts_updated_at` (plan §6a).
- Appendix **E-iv's `gender_model` row is annotated "never null" and that annotation is superseded**
  — `women_only`/`men_only` are both null on 61 seed rows and the derived column is null there,
  **never `coed`**; the appendix's own nullable `gender_model text NULL CHECK (…)` DDL is the correct
  half. Of the 61, **55** are IPEDS system-/district-office records (null `classification.category`)
  and **6 are real degree-granting schools** whose survey components are unreported, so the 61 are
  never dropped as a block; `hsi` is null on the same 61, `hbcu`/`tribal`/`land_grant` on none
  (plan §5.3).
- **Every cross-reference names its target by content, never by a body line number** — a header
  bullet pointing into this file's body, and the main plan's cites into any appendix section alike.
  This header grows every round and pushes the whole body down, so a numeric cite is stale by the
  next round — which is exactly what happened to the bullets above, and to five cites in the main
  plan, before they were rewritten to name the table, row, symbol or heading they mean. The
  eleventh-round "appendix-internal line numbers are advisory, the content wins" rule stands and
  extends to the plan→appendix direction; naming the content is how both are honoured from here.
  Source-file cites (`path.py:123`) are unaffected — they point at the tree, which this header
  does not move.

**Twelfth-round overrides (review loop round 8):**
- Appendix **E-iv's `control` row is projected verbatim from `basic_profile.classification.control`**
  — three IPEDS values, zero nulls across all 2,746 seed rows (Public 893 / Private not-for-profit
  1,548 / Private for-profit 305); `identity.control_reported` is a cross-check, never the source of
  the column, and the explore enum is `('public','private','private_for_profit') NOT NULL`
  (plan §5.3). `control_counts` carries three keys.
- Appendix **D-A's `FactGroup` gains `chart`** and its `FactSection` the fields already listed; the
  group `chart` union carries no `bands` arm — a band is a **fact** (plan §5.2/§6b).
- Appendix **E-iii's group `foot:` may instead be `foot_ref:`**, naming a `domain/facts/state.py`
  constant; `getting-in/test-detail` uses `foot_ref: BAND_CAPTION` and
  `getting-in/selectivity-rating` `foot_ref: ENTRANCE_DIFFICULTY_NOTE`, so neither sentence is ever
  written into the yaml (plan §5.2).
- The deadline row carries **`observed_at: string | null`** and **`reported_period: string | null`**
  — appendix D-A's `DeadlineRow` still shows neither — and the block's foot renders
  the **oldest** `observed_at` of them, never the page-level `observed_at`; it drops its cycle
  clause when every rendered row's `reported_period` is null and its confirmation clause when no
  rendered row carries an `observed_at` at all (plan §5.2).

**Eleventh-round overrides (review loop round 7):**
- Appendix **E-iii's `facts:` entries carry an authored `label:`** beside their `tab:` — it is what
  the page renders for every declared key, present or absent; `school_facts.label` stays for lineage
  only (plan §5.2/§4.4).
- Appendix **D-A's `FactSection` also gains `foot: string | null`** (the section-level reporting-period
  sentence, needed on `ok` sections too); **`FactBase` does not gain `never_checked`** — only the
  section carries it (plan §5.2).
- Appendix **B/D's `exclusions` entry is `{key, metric_label, count, reason}`**, and its `key` is no
  longer `RangeKey`: the enum filters (`testPolicy`, `sizeBucket`, `campusSetting`) produce exclusions
  too (plan §5.3). Appendix **B's explore response also carries `religious_affiliation_note`** and
  `control_counts` gains a `private_for_profit` key (plan §5.3).
- Appendix **D-F's `school-facts-format.ts` bullet — "`ABSENCE_COPY` … and
  `ABSENT_TOPIC_EXPLANATION` shrink to the four v3 states" — is overridden**: both are
  **deleted outright**, not shrunk (plan §6b).
- **Appendix-internal line numbers are advisory.** The header grows each round and pushes the body
  down; where a bullet's cite and its quoted content disagree, the content wins. The drift list this
  bullet used to carry (`BandFact`, the `size_bucket` fallback, the two null-semantics comments,
  `identity.description`) went stale a second time and is gone: those bullets now name their rows.

**Tenth-round overrides (review loop round 6):**
- Appendix **D-A's `FactSection` gains `never_checked: boolean` and `line: string | null`** — the
  resolved `fetch_state` sentence, composed server-side (plan §5.2). Appendix **B's explore response
  gains `filter_options`, `entrance_difficulty_note` and `majors_match_note`** (plan §5.3).
- Appendix **D-A's `BandFact` is the band's only shape** — the group `chart` union carries no `bands`
  arm, and `school-facts-sections.ts`'s `BandSpec` / `{chart:"bands"}` and `school-facts-blocks.ts`'s
  `splitBands` are deleted; `BandFact.min`/`max` are the test's scale, code-owned in
  `domain/facts/normalize.py` (plan §6b).
- Appendix **E-iv's `size_bucket` fallback to `basic_profile.classification.institution_size`
  is dropped** — IPEDS's five bands do not nest inside the four `SIZE_BUCKETS` (`1,000 - 4,999` and
  `20,000 and above` straddle two boundaries, 1,190 of 2,746 rows); the column is null whenever
  `undergraduates` is null (plan §5.3).
- **`locale` is filtered by family** (City/Suburb/Town/Rural via `LIKE '<family>: %'`), not by its
  twelve two-level values; **`religious_affiliation`** is a combobox over `filter_options` with
  "Religiously affiliated (any)" and "Not stated" above the 61 names (plan §5.3).

**Ninth-round overrides (review loop round 5):**
- Appendix **D-A's `BandFact.p50` is deleted**, not made nullable — there is no
  `class_profile.*_p50` fact key under v3 (CollegeData publishes p25/p75/avg, never a median), so it
  has no producer and `splitBands` would return an empty array for every school (plan §6b).
- Appendix **E-iii's `getting-in/test-detail` group gains `class_profile.sat_math_range`,
  `…sat_ebrw_range` and `…act_composite_range`** (appendix E-i's **TitleValue** range row) —
  the `band` kind's only producer, and the rows the band caption qualifies; its group-level
  `caveat:` fields are read as `foot:` (the headline-as-first-group rule is stated once, in the
  eighth-round block below).
- Appendix **E-iv gains `undergraduate_full_time`** (`students.undergraduate_full_time`, int) and
  **drops `students_per_faculty`** as a stored column — the ratio is computed in the explore SQL and
  both inputs must be visible on `school_explore`; `need_fully_met_pct` is the one stored derived
  ratio (plan §3.1/§5.3).
- Appendix **B/E-iv's `region` is stored verbatim** (the IPEDS OBEREG label with its state list
  inlined) and the filter's option list is derived server-side from `SELECT DISTINCT region`, split
  into `{value, label, states}`; appendix B's four-member census union and its "derived from
  `schools.state`" note are both overridden (plan §5.3).

**Eighth-round overrides (review loop round 4):**
- Appendix **E-iv/B's `test_policy` members are `('required','considered','not_required','not_reported')`**,
  `NOT NULL DEFAULT 'not_reported'` — never `optional`/`blind`: the live source prints "Considered if
  submitted" and publishes no test-blind marker (plan §5.3).
- Appendix **E-iii's `headline:` list is emitted as each section's first group** (`id: "headline"`,
  `label: null`, with a `foot`), and `applying/headline:` drops `deadlines.regular` and the two
  `*_offered` bools — they are served by the top-level `deadlines` block and by `rounds-offered`
  (plan §5.2).
- Appendix **E-iii moves `admissions.entrance_difficulty` out of `getting-in`'s `headline:`** into its
  own `getting-in/selectivity-rating` group — because the qualifier must sit with the value and not
  above the whole section, not because a headline lacks a `foot` slot (it has one, as the section's
  first group); its `applying/deadlines` group `caveat:` is dropped (it names CollegeData, D3)
  (plan §5.2/§5.3).
- Appendix **E-iii's `facts:` entries carry a per-key `tab:`**, and each section's `tabs:` is the
  derived union — a section-level set alone leaves an absent key in the two-tab `campus-life` section
  with two candidate states (plan §5.2).
- Appendix **E-iv's null-semantics comments must not say "not published"** (its `admit_rate` and
  `majors` rows): the wide row carries no per-column state, so a null is `not_reported`,
  `not_fetched` **or** `not_published` (plan §6b).
- Appendix **C-C headers are all stale** — C-C1 prints `(11, not 13)` over 6, C-C2 `(18)` over 26,
  C-C3 `(26)` over 28 (of which `tests/domain/test_purity.py` is untouched, not parked), and
  C-C4's five are each already counted elsewhere; the partition is 6 delete / 35 rewrite /
  27 parked = **68 distinct** of 140 (plan §6a). This supersedes the sixth-round "63 of
  140" and "27 / 64" bullets.
- Appendix **§H's "39" header-scalar heading is overridden**: 33 declared scalars (plan §4.4).
- `max_request_body_bytes` default is **16,777,216**, not 10,000,000 (plan §4.3).

**Seventh-round overrides (review loop rounds 2–3):**
- Appendix **D-C's `--brand-tint` does not exist** — the `db` chip, rail avatar and message-source
  badge use `--brand-chip` / `--brand-chip-ink` (`frontend/src/styles/semantic.css:406-407`); no new
  token (plan §5.4).
- Appendix **F-i's `get_facts` docstring** ships with **four** unavailable states, not three:
  `not_published` is written in full, and `FactRow.state`'s Literal is
  `"value" | "not_reported" | "not_fetched" | "not_published" | "not_collected"` (plan §6a).
- Appendix **F-i's `SchoolFactsStatus` carries no sentence field**; the "identity but no facts"
  message is the `not_collected` caveat on the wire (plan §5.4).
- Appendix **D-A's response drops `tabs`** — it had no consumer; every rendered decision goes through
  the per-section `fetch_state` and the per-fact `state` (plan §5.2).
- Appendix **E-iii's `applying/deadlines` group is not emitted in `sections`** — its key list feeds
  the top-level `deadlines` block and nothing else, so no deadline renders twice (plan §5.2).
- Appendix **E-ii's `overview` / `description` row and E-iii's "Labels that fit no section" mention
  of `identity.description` are dropped** — it is **not mapped at all**: absent from
  `facts_keys.yaml`'s `header:` stage, no `school_facts` row is ever written for it, and
  `page_snapshots.body` retains it for lineage (plan §4.4). This supersedes
  the earlier "stored and never rendered" wording.
- Appendix **C-C2's REWRITE list gains `tests/domain/test_specs.py:78,98`** — it pins
  `metric_ref` on an `extra="forbid"` model (plan §5.4).
- `facts_explore_max_count` default is **3,000**, not 1,000, and a capped `total` renders as "{N}+"
  (plan §5.3); `db_reset_notice_days=30` is new, and the reset-notice date is served by an
  unauthenticated `GET /v1/config/public` (plan §5.6).
- The band caption is **backend-owned** (`domain/facts/state.py::BAND_CAPTION`) and wire-delivered;
  the Explore response carries `band_caption`; no TypeScript constant holds it (plan §5.2/§5.3).
- `TabularRenderSpec` gains a **card-level `foot: tuple[Caveat | str, ...]`** carried through `ev_viz`
  — a `Caveat` for `observed_at_spread`, the plain `BAND_CAPTION` **string** for the band qualifier,
  because a ninth caveat kind would break the pinned eight-kind equality; unavailable viz cells render
  the row's own state word, not "not available" (plan §5.4). *Supersedes this bullet's earlier
  `tuple[Caveat, ...]` form.*
- The rendered word for `not_fetched` is **"Not checked"** ("Not checked yet" for `never_fetched`);
  the state id is unchanged everywhere (plan §5.1).

- Appendix **E-iv's `test_policy` column is `NOT NULL DEFAULT 'not_reported'`**, and appendix D-A's
  TypeScript follows (plan §5.3). *Superseded on the member set by the eighth-round bullet above:
  the four members are `('required','considered','not_required','not_reported')` — the source's own
  vocabulary — never `optional`/`blind`.*
- The rendered word for `not_published` is **"Not on file"** ("We don't hold this school's {section} information."; earlier drafts said "a {section} page for this
  school"); the state id is unchanged everywhere (plan §5.1).

- Appendix **§A's "15,533 fixed URLs" is 15,522** (2,587 slugs × 6, after the `help` page and the
  five state-list pages are excluded), and the schema has **nine relations — `schools` + eight new**,
  not seven (plan §3.1/§3.3).

**Earlier overrides (verification rounds):**
- Any mention of **Crawlee** — the fetcher is the asyncio + httpx + tenacity loop (plan §2).
- Any **`observed_at` column on `school_facts`** — it is derived from `school_pages.last_fetched_at`
  through the views (plan §3.2); `school_facts` carries `tab` instead; `school_pages` also has
  `last_attempted_at` (the resume record).
- `config/facts/keys.yaml` / `sections.yaml` — the files are `config/assets/facts_keys.yaml` and
  `config/assets/facts_sections.yaml` (plan §4.4); the crosswalk CSV loader is `app/facts/crosswalk.py`
  and is the CSV's only loader.
- The table named `jobs` is `facts_jobs`; `crawl_runs` has the wider column set in plan §3.1; the
  `crawl_runs.status` union is `running|succeeded|partial|failed|aborted` everywhere (appendix D-E's
  `completed` does not exist).
- The lease **sweep re-queues** (`status='queued'`), it does not fail forward — appendix J-iii's
  "copy the sweep exactly" is overridden; `--once` goes **through** `facts_jobs` (J-iii's bypass
  variant is overridden); the resume predicate uses `last_attempted_at`.
- `facts_snapshot_retention_per_page` default is **3**; `facts_crawl_rps` default is **1**;
  `observed_at_spread` uses `facts_spread_days` (30), not `facts_stale_days`.
- Fact states are exactly `value | not_reported | not_fetched | not_published | not_collected`
  (plan §5.1); `not_applicable` is **retired** (appendix F-iv's keep(4) is keep(3); the final caveat
  set is the eight in plan §6a).
- Appendix D-A is the TypeScript rendering of plan §5.2's contract with these corrections: the field
  is `observed_at` (not `facts_updated_at`), the response also carries `is_stale` (**`tabs` is
  dropped** — superseded by the seventh-round bullet above),
  `FactSection.fetch_state` is `ok|partial|not_fetched|not_published`, `FactState` includes
  `not_published`, and the chip hover meta line is the citation's own vintage string. Appendix
  J-ii's earlier pydantic facts sketch is **superseded** (it predates `kind`, `fetch_state`, group
  `id`/`foot`, per-fact `caveat_ids`, the deadline `round`/`state`, the open `SectionId`, and omits
  `not_found` from `PageStatus`).
- The seven-view / `facts_crawl_status` proposals are **not** adopted: six reader views; the admin
  route reads the pipeline pool. `school_data_status` exposes `tabs jsonb`, not per-tab columns.
- `fact_coverage`'s timestamp column is `computed_at`, exposed as `as_of` in the `query_database` result.
- `get_facts_max_rows` default is **60**; the `get_facts` docstring's section list is **six** (no `other`).
- Explore keeps client-side "Load more" over a server `page`/`page_size` (24). **No `sat_total_*`
  column, key, sort or filter exists** (R14); appendix E-iv's `sat_total_p25/p75` rows and its
  `students_per_faculty` stored column are overridden (the ratio is computed in the explore SQL and
  never exposed to the agent). E-iv's identity columns (`name/city/state/website_url`) live on the
  view, not the table; its column count is ~100.
- The majors filter is `majors @> ARRAY[$1]` (containment), and there is **no GIN index** (appendix
  B's index list is overridden: `school_explore_rows` has no secondary index).
- `MetricCellInput.metric_ref` is renamed `fact_key`; `domain/specs.py:103` (`:102` is `model_config`). `VizBlock.tsx` is **not** a rename site — the viz wire carries resolved cells, not refs.
- `source_key(db) = ("db", school_unitid, vintage)`; `tier` is present-and-null for `db`.
- The citation-seam pattern is `app/toolset.py:216-238`, not `adapters/tavily_tools.py`.
- Appendix J-iii's `api/main.py:126-127`/`:132-134` are stale: start `:114-115`, stop `:121-122`.
- Appendix E-iii's `test-detail` caveat text is dropped in favour of the single band caption (plan §5.2).
- Appendix C-C1/C2 headers read DELETE (6) and REWRITE (26) — *superseded, see the **C-C headers
  are all stale** bullet above: the partition is 6 / 35 / 27 = 68 distinct of 140.*
- Appendix D-F's "facts fixtures 11 files / 2,083" is 10 files / 2,054; the parked frontend count is
  65 files / 9,024 lines.
- Appendix F-ii's `school_facts_sql` column list also carries `value_type`, `tab`,
  `reported_period_year`; the sports columns are `sports_women`/`sports_men`.
- Line-number nits in appendix J (ruff/mypy/marker/bandit config lines are `pyproject.toml:67/74/78/93-95/148/157`;
  `load_yaml_asset` is `config/settings.py:562-567`, `reset_config_caches` `:570-575`;
  `tests/domain/test_purity.py` roots `:20`, carve-out `:23`) and in appendix D (`VizBlock.tsx:43`,
  `schools.css:127-128`, `DataWindow:118`, `matchesDataWindow:161-175`, `RowProvenance:40-42`,
  `provenanceOf:78-83`, `shouldStagger:125`) are corrected in the main plan where cited.
---

## A — Fetcher comparison and verdict (Q1 resolved)

### Tool comparison (honest)

Constraints being scored: free, no browser, Python, **in-process inside a running uvicorn event
loop**, single host, 15,533 fixed URLs, 1–2 req/s, self-identifying UA, no persistent local
storage (root-owned `/app`, `USER counselle` — `Containerfile:23,44,46`).

| Option | Fit | In-process w/ uvicorn | New packages | Maintenance |
|---|---|---|---|---|
| **asyncio + httpx + tenacity (+protego)** | Everything needed, nothing else. httpx 0.28.1 is already a direct dep; **tenacity 9.1.4 is already in `uv.lock`** (pulled by `google-genai`, `langchain-core`, `pydantic-ai-slim`) — declaring it direct adds **0 packages**. `protego` for robots is optional (robots allows everything, finding 6). Sitemap parse = stdlib `gzip` + `xml.etree`. | Clean. No signal handlers, no global service locator, no storage, no own loop. | **0** (or 1 with protego) | ~150 lines in `adapters/collegedata/fetch.py`, all of it code we'd have to read anyway to understand the crawl |
| **Crawlee 1.10.0** | Genuinely useful bits: `SitemapRequestLoader` streaming + `transform_request_function` (which elegantly injects the *current* buildId at pull time, so a mid-pass rotation self-heals for un-pulled URLs), retries, robots, stats. Unused/unwanted bits: autoscaling, session pool, browser fingerprinting, proxy rotation, `retry_on_blocked`, datasets, KV stores, four storage backends. | **Breaks graceful shutdown (finding 2, proven).** Also: global `service_locator` singleton with `ServiceConflictError` if `Configuration` is set after first read; autoscaler snapshots whole-process CPU/event-loop delay (`max_event_loop_delay=50 ms`) so API traffic throttles the crawler and vice-versa. | **7** (+`impit`, a 4.1 MB Rust wheel) | Low code, but 3 of the 17 findings above are Crawlee-default footguns (1, 8, 12) that only surface at runtime |
| Scrapy | Twisted reactor; cannot share uvicorn's asyncio loop without `asyncioreactor` gymnastics; wants a separate process. Violates ADR 0023 one-deployable. | ✗ | ~15 | High |
| aiohttp only | Already transitive (3.14.1) but the repo standardised on httpx; two client stacks for no gain. | ✓ | 0 | Same as httpx option |
| `curl_cffi` / `rnet` / `scrapling` / `botasaurus` | All exist to *evade* bot detection (TLS impersonation, fingerprint spoofing, browser drivers). CollegeData needs none of it — the JSON route serves a bare `curl` with no cookie or header (finding 6) — and evasion is the wrong posture next to finding 4's ToS. `botasaurus`/`scrapling` also pull browsers. | ✗ / n/a | 1–many | n/a |
| `changedetection.io`-class | A separate service with its own UI and datastore, built for HTML diffing of a handful of pages, not 15.5k JSON documents into Postgres SCD2. Second deployable. | ✗ | n/a | High |

---

### Verdict on tool choice

**Resolve open question Q1 to the ~150-line asyncio + httpx + tenacity loop, and drop Crawlee.**

The deciding reason is finding 2: `BasicCrawler.run()` calls
`asyncio.get_running_loop().remove_signal_handler(signal.SIGINT)` in its `finally` block
(`_basic_crawler.py:761`) and never restores what was there — proven in a probe to leave the loop
with no SIGINT handler after a single pass. Since `scripts/entrypoint.sh:33` runs one uvicorn in
the main thread and the plan runs the crawler from that same lifespan, the first daily pass
permanently disables uvicorn's graceful shutdown, and the only repairs are running outside the
main thread (defeats the in-process design) or reaching into uvicorn's internals to re-install
its handler (exactly the "wrap the stack's seam" that ADR 0017 forbids). Everything else only
reinforces it: the plan's stated reason for choosing Crawlee — "`HttpCrawler` (httpx client)" —
is no longer true (finding 3); the sitemap loader's default silently yields zero URLs against
this specific sitemap (finding 1); and the default client actively impersonates Firefox and
rotates sessions to evade blocks (finding 12), which is the wrong posture given the Terms in
finding 4. Against that, the features actually being bought are retries (tenacity, **already in
the lock — zero new packages**), robots (Protego, 5 lines, and robots permits everything anyway),
sitemap streaming (stdlib `gzip` + `xml.etree` over a 7.5 MB file), and rate limiting (a
semaphore plus a sleep, for a *fixed* 1 req/s that makes Crawlee's autoscaler pure overhead).
Crawlee's one real gift — `transform_request_function` injecting the live buildId at pull time —
is six lines to reproduce when you own the queue.

"Never reinvent the wheel" (principle 2) is about not hand-rolling *solved, hard* problems. A
single-host, fixed-rate, 15.5k-URL, no-JS, no-auth, no-evasion fetch is not that problem; the
hard parts of this feature are the mapper, SCD2, and the honesty rules, none of which Crawlee
touches. Adding 7 packages including a 4.1 MB Rust binary to get a framework whose defaults must
then be disabled one by one — `enqueue_strategy`, `browser`, `retry_on_blocked`,
`configure_logging`, `ignore_http_error_status_codes`, `storage_client` — is the more-code
outcome, not the less-code one.

**If the owner overrides and keeps Crawlee**, findings 1, 2, 3, 8 and 12 are all mandatory plan
edits before Phase 1, and finding 2 needs a test that asserts the SIGINT handler survives a pass.
Findings 4–11 and 13–16 apply to *either* fetcher and must be made regardless.

---

## B — `school_explore_rows` DDL draft and complete index list

> Identity columns are absent by design (the view joins `schools`). Column names in appendix E-iv are the authoritative list; this DDL shows types/CHECKs/index policy.

### Appendix A — Proposed complete `school_explore_rows` column list

Derived from §5's Explore filter list and the frontend read model
`frontend/src/features/schools/explore/explore-types.ts` (`ExploreSchool` `:33-69`,
`ExploreFilters` `:141-160`, `RangeKey` `:128-139`, `SortKey` `:163-164`). Identity columns are
deliberately **absent** (finding 17) — the `school_explore` view joins `schools` for
`name/city/state/official_website`.

```sql
CREATE TABLE cds_library.school_explore_rows (
  school_id            integer PRIMARY KEY REFERENCES cds_library.schools(id),

  -- size / control  (filters: size bucket, control; sort: size)
  undergraduates       integer  NULL,
  control              text     NULL CHECK (control IS NULL OR control IN ('public','private')),
  region               text     NULL,          -- Census region, derived from schools.state (§5 "state / region")

  -- admissions  (filters: admit rate overall/in-state/out-of-state; sort: admit)
  admit_rate           numeric  NULL CHECK (admit_rate           IS NULL OR admit_rate           BETWEEN 0 AND 1),
  admit_rate_in_state  numeric  NULL CHECK (admit_rate_in_state  IS NULL OR admit_rate_in_state  BETWEEN 0 AND 1),
  admit_rate_out_state numeric  NULL CHECK (admit_rate_out_state IS NULL OR admit_rate_out_state BETWEEN 0 AND 1),

  -- testing  (filters: test policy, SAT/ACT middle-50 vs the student's score)
  test_policy          text     NULL CHECK (test_policy IS NULL OR test_policy IN ('required','optional','blind')),
  sat_total_p25        integer  NULL,
  sat_total_p75        integer  NULL,
  act_composite_p25    integer  NULL,
  act_composite_p75    integer  NULL,
  test_submitted_pct   numeric  NULL,          -- honesty trap 1: below 0.50 the band describes the top third

  -- cost & aid  (filters: total cost in/out of state, average net price, need met %, merit aid %; sort: cost)
  cost_total_in_state  numeric  NULL,
  cost_total_out_state numeric  NULL,
  net_price_average    numeric  NULL,
  need_met_pct         numeric  NULL,          -- derived h2_h/h2_c, never the printed h2_i (trap 3)
  merit_aid_pct        numeric  NULL,
  application_fee      numeric  NULL,          -- filter "application fee = 0"

  -- outcomes  (filters: 4y/6y grad rate, retention; sort: gradRate)
  grad_rate_4y         numeric  NULL,
  grad_rate_6y         numeric  NULL,
  retention_rate       numeric  NULL,

  -- campus  (filters: student:faculty, housing %, Greek %, out-of-state %, international %, gender model, calendar)
  students_per_faculty numeric  NULL,
  housing_pct          numeric  NULL,
  greek_pct            numeric  NULL,
  out_of_state_pct     numeric  NULL,          -- trap 9: excludes international from both sides, not additive
  international_pct    numeric  NULL,
  gender_model         text     NULL CHECK (gender_model IS NULL OR gender_model IN ('coed','women','men')),
  calendar             text     NULL CHECK (calendar     IS NULL OR calendar     IN ('semester','quarter','trimester')),

  -- rounds & deadlines  (filters: ED / EA / REA / rolling, deadline before date; sort: deadline)
  offers_ed            boolean  NOT NULL DEFAULT false,
  offers_ea            boolean  NOT NULL DEFAULT false,
  offers_rea           boolean  NOT NULL DEFAULT false,   -- restrictive EA / SCEA
  offers_rolling       boolean  NOT NULL DEFAULT false,
  earliest_deadline    date     NULL,                     -- min over rounds; the "deadline before date" filter + sort key
  rounds               jsonb    NOT NULL DEFAULT '[]'::jsonb
                         CHECK (jsonb_typeof(rounds) = 'array'),   -- [{code, deadline, restrictive}] per RoundOffer

  -- lists  (filter: "major offered")
  majors               text[]   NOT NULL DEFAULT '{}'::text[],
  sports               text[]   NOT NULL DEFAULT '{}'::text[],

  -- bookkeeping
  facts_updated_at     timestamptz NOT NULL,   -- max(school_pages.last_fetched_at) over this school's ok tabs
  mapper_version       text     NOT NULL,
  retired_at           timestamptz NULL        -- set when the school's collegedata_schools row is retired
);
```

Notes on types:
- Every metric is **nullable and never defaulted to 0** — `explore-types.ts:3-11` makes this an
  explicit honesty rule ("a blank cell reads as zero, and zero is a lie"). Only the four round
  booleans and the two arrays are `NOT NULL`, because "no ED offered" is a real observation once the
  admission tab fetched `ok`; when the tab did **not** fetch ok, the school has no
  `school_explore_rows` row at all rather than a row of falses.
- Rates are stored as fractions `0..1` (matching `ExploreSchool.admitRate.value`), percentages are
  not mixed in — one convention, enforced by CHECK where the range is known.
- `cdsYear`/`dataWindow` from `explore-types.ts:66` and `:117` are **dropped** (§6b) and have no
  column here.

### Appendix B — Proposed complete index list (`cds_library`, v3)

```sql
-- schools (unchanged, already live)
--   schools_pkey PRIMARY KEY (id)
--   schools_search_name_idx (search_name, id)

-- collegedata_schools
ALTER TABLE collegedata_schools ADD PRIMARY KEY (slug);
CREATE UNIQUE INDEX collegedata_schools_live_school_idx
  ON collegedata_schools (school_id) WHERE retired_at IS NULL;      -- §3, one live slug per unitid
CREATE UNIQUE INDEX collegedata_schools_lower_slug_idx
  ON collegedata_schools (lower(slug));                             -- finding 13
CREATE UNIQUE INDEX collegedata_schools_cd_id_idx
  ON collegedata_schools (collegedata_id);

-- page_snapshots
ALTER TABLE page_snapshots ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX page_snapshots_body_idx
  ON page_snapshots (school_id, tab, content_sha256);               -- §3, the hash-diff guard
CREATE INDEX page_snapshots_retention_idx
  ON page_snapshots (school_id, tab, first_seen_at DESC);           -- retention: keep the newest N per page

-- school_pages
ALTER TABLE school_pages ADD PRIMARY KEY (school_id, tab);
CREATE INDEX school_pages_failing_idx
  ON school_pages (last_status, consecutive_failures)
  WHERE last_status <> 'ok';                                        -- §5 admin status screen

-- school_facts
ALTER TABLE school_facts ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX school_facts_current_idx
  ON school_facts (school_id, fact_key) WHERE valid_to IS NULL;     -- facts page + SCD2 guard
CREATE INDEX school_facts_key_num_idx
  ON school_facts (fact_key, value_num)
  WHERE valid_to IS NULL AND value_num IS NOT NULL;                 -- finding 16, cross-school ranking
CREATE INDEX school_facts_key_idx
  ON school_facts (fact_key) WHERE valid_to IS NULL;                -- non-numeric lookups, coverage refresh
CREATE INDEX school_facts_snapshot_idx
  ON school_facts (snapshot_id);                                    -- finding 3, retention referential check
-- deliberately NOT created: any index over valid_to IS NOT NULL (history is unread, §5/§6a)

-- school_explore_rows
ALTER TABLE school_explore_rows ADD PRIMARY KEY (school_id);
CREATE INDEX school_explore_rows_majors_idx ON school_explore_rows USING GIN (majors);
CREATE INDEX school_explore_rows_sports_idx ON school_explore_rows USING GIN (sports);
-- deliberately NOT created: per-metric btrees. ~2,592 rows / ~70 pages; seq scan + sort wins (finding 18)

-- fact_coverage_counts (finding 8)
ALTER TABLE fact_coverage_counts ADD PRIMARY KEY (fact_key);

-- jobs
ALTER TABLE jobs ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX jobs_one_live_pass_idx
  ON jobs (kind) WHERE status IN ('queued','running');              -- §3
CREATE INDEX jobs_lease_idx
  ON jobs (lease_expires_at) WHERE status = 'running';              -- finding 11, the sweep

-- crawl_runs
ALTER TABLE crawl_runs ADD PRIMARY KEY (id);
CREATE INDEX crawl_runs_recent_idx ON crawl_runs (started_at DESC); -- §5 admin "last crawl runs"
```

---

## C — Backend symbol map, import edges, test lists, settings, scripts/evals, skills

## Appendix A — symbol → files → plan disposition

Runtime files only (parked packages collapsed to one row). ✓ = accounted for in §6a;
**✗** = unaccounted (a finding).

| Symbol | Files (file:line) | Plan disposition |
|---|---|---|
| `get_domain` | `counselle_db/service.py:34,757`; `counselle_db/server.py:159`; `app/viz.py:17,163,296`; `app/workspace/service_reference.py:10,40`; `app/steps.py:224,352,457`; `app/tool_middleware.py:46`; `app/tool_overflow.py:277`; `app/graph.py:56`; `evals/runner.py:41,224,283,776`; `config/assets/step_labels.yaml:31`; `scripts/mcp_smoke.py:16`; `config/assets/prompts/counselor.md:193-208`; 6 skills | ✓ all |
| `DomainRow` | `counselle_db/models.py:99`; `counselle_db/packets.py:12` (parked) | ✓ move into `packets.py` |
| `DomainResult` | `counselle_db/models.py:122`; `service.py:757`; `app/viz.py:18,170` | ✓ |
| `AvailabilitySummary` | `counselle_db/models.py:112`; `service.py:882-918` | ✓ |
| `SchoolCoverage` | `counselle_db/models.py:27-37`; `service.py:604-624,661` | ✓ |
| `Catalog` / `CatalogSnapshot` | `counselle_db/catalog.py:88,108`; `app/deps.py:35,116`; `app/graph.py:36,44`; `app/viz.py:15`; `app/prompt.py:9`; `app/toolset.py:64,74,188`; `app/agent_node.py:318,887`; `adapters/tavily_tools.py:400-417`; `app/workspace/service_utils.py:23`; `service_applications.py:531`; `api/routes/workspace_common.py:23`; `api/routes/cds_admin.py:316` (parked) | ✓ |
| `EmptyCatalog` | `app/deps.py:89-106`; `app/cds/jobs.py:182` (comment only, **not** an import) | ✓ |
| `compile_manifest` | `counselle_db/catalog.py:18,167`; `counselle_db/packets.py`; parked (`adapters/cds_store.py:35`, `app/cds/manifest.py`, `domain/cds/manifest_compile.py`, 4 scripts) | ✓ |
| `parse_packet_row` | `counselle_db/service.py:32`; `counselle_db/packets.py`; parked (`cds_store.py:35`, `app/cds/manifest.py`, `service_review_approve.py`, 2 scripts) | ✓ |
| `manifest` / `packet` / `edition` | `catalog.py:40-42,46-52,152-167`; `service.py` (18 guards + `get_domain`); `models.py:99-138`; `prompt.py:12-24,36-68`; `viz.py:182,249,255`; `tool_middleware.py:31,50-57`; `caveats.py:19`; `caveats.yaml`; `data_picture.md:4-7`; `counselor.md:179-208`; `counselle_db/db.py:1-9` **✗** | ✗ `db.py` |
| `evidence` / `eid` | `domain/envelope.py:28-37,130,153-160`; `domain/events.py:13,286`; `app/sources.py:14,42,79-91,121-138`; `app/state.py:19,38-39`; `app/tool_middleware.py:14,73`; `app/viz.py:18,185`; `app/workspace/service_reference.py:11,68`; `app/evidence_markers.py`; **`app/run_handle.py:14,47` ✗**; `config/settings.py:275` **✗**; `counselle_db/service.py:123` | ✗ ×2 |
| `document_sha256`/`academic_year`/`manifest_version`/`profile_sha256` | `domain/envelope.py:51-87`; `app/sources.py:28-31`; `app/tool_middleware.py:50-57,101`; `app/viz.py:182,213`; `service_reference.py`; `counselle_db/{models,service,catalog}.py`; `evals/runner.py` | ✓ |
| `metric_ref` | `app/viz.py:127-132,352,388`; `domain/specs.py:98-109`; `app/steps.py:654-660`; `evals/runner.py` | ✓ (but see S1) |
| `qualified_ref` | *(no occurrences anywhere in the repo)* | — plan never uses the term in §6a |
| `SourceName` / `Tier` | `domain/envelope.py:14,15` (`Tier` also `adapters/tavily_tools.py`, survives) | ✓ |
| `legacy_citations` | `app/legacy_citations.py`; **`app/transcript.py:16,144` ✗**; `tests/app/test_legacy_citations.py:7` | ✗ |
| `evidence_markers` | `app/sources.py:11`; `app/tool_overflow.py:20`; **`app/run_handle.py:14` ✗**; `app/agent_node.py:64`; `tests/app/test_evidence_markers.py:1`; **`tests/app/test_tool_middleware.py:9` ✗** | ✗ ×2 |
| `_NO_CDS_DATA_PICTURE` | `app/graph.py:54-59` | ✓ |
| `data_picture` | `app/prompt.py:12-24,36-68,94`; `config/assets/prompts/data_picture.md`; `counselor.md:462` | ✓ |
| caveat kinds (`stale_edition`, `edition_mismatch_comparison`, `partial_packet`, `definition_drift`, `not_in_template_version`, `vintage_period_unavailable`, `suppressed`) | `app/caveats.py:18-24`; `config/assets/caveats.yaml:1-33`; `app/tool_middleware.py:22-39`; `app/viz.py:196-256`; `app/workspace/service_reference.py:77`; emitted from `counselle_db/packets.py:357-359,473` (parked); **`tests/app/test_skills.py:332` ✗**, **`tests/app/test_tool_overflow.py:68` ✗** | ✗ ×2 tests |
| `MCPServerStdio` / `counselle_db.server` | `app/toolset.py:120-142` (`MCPToolset`+`StdioTransport`; there is **no** `MCPServerStdio` symbol in this repo); `scripts/mcp_smoke.py`; tests `test_steps.py:17`, `test_tool_specs.py:7`, `test_toolset.py:20,280`, `test_server.py:6` | ✓ (see M6) |
| `supervision` | `api/supervision.py`; `api/main.py:62,91-99,106`; `api/routes/system.py:20-21,26,67`; `app/deps.py:60` (`on_failure`); `tests/api/test_supervision.py`; `tests/api/test_routes_unit.py:418` **✗** | ✗ ×2 |
| `cds_data_enabled` | `config/settings.py:259`; `app/deps.py:115`; `app/graph.py:99`; `.env.example`; 2 tests | ✗ (S4) |
| `DbChildSettings` / `get_db_child_settings` / `serialize_db_child_environment` / `agent_mcp_read_timeout_s` | `config/settings.py:60-98,347,514`; `app/toolset.py:117,132,134`; `counselle_db/server.py`; `counselle_db/db.py:45-52` (docstring) **✗**; `scripts/mcp_smoke.py`; `tests/test_settings.py:12`, `test_toolset.py`, `test_mcp_smoke.py`, `tests/api/test_routes_unit.py:94` **✗**, `tests/app/test_run_turn.py` **✗** | ✗ ×3 |
| `pipeline_pool` / `start_cds_worker` / `cds_admin` / `COUNSELLE_DB_PIPELINE_DSN` / `COUNSELLE_CDS_WORKER_ENABLED` | `app/deps.py:74-84,127-142`; `api/main.py:49,64,111-115,119-122,277`; `app/cds/jobs.py:179-192` (parked); `api/routes/cds_admin.py:63-66` (parked); `config/settings.py:257,381-393` | ✗ (M2, M3) |
| `supported_packet_extractor_versions` | `config/settings.py:70,264`; `counselle_db/service.py:825,831` (inside `get_domain`); `adapters/cds_store.py:468` (parked) | ✓ keep on `Settings`, delete the `DbChildSettings` copy |
| `model_name_from_setting` | `app/agent_node.py:247,295`; `app/titles.py:99`; `app/workspace/document_summary.py:129`; `evals/runner.py:27`; parked `app/cds/service_ingest.py:31`, `service_review_approve.py:42`; `tests/app/test_profile_memory_services.py:637` | ✓ (S7: name the 5 extra sites) |
| `format_cds_edition` | `counselle_db/formatting.py:16`; `app/tool_middleware.py:12,61,69`; `counselle_db/packets.py:11,437`; `counselle_db/service.py:16,615`; `tests/counselle_db/test_foundation_regressions.py:12,34` | ✓ move into `packets.py` |
| `format_decimal` | `counselle_db/formatting.py:6`; `counselle_db/service.py:16,677` (**live**); `counselle_db/packets.py:387` (parked); `app/cds/service_review.py:206` (parked) | ✗ (S9 — stays live) |
| `ServiceError` | `counselle_db/models.py:11`; `catalog.py`, `service.py`, `server.py`, `app/viz.py`; parked `adapters/cds_store.py:34` | ✓ keep name+location |
| `read_tool_result` | `app/agent_node.py`; `app/state.py`; `app/tool_overflow.py`; `evals/runner.py`; `step_labels.yaml` | ✓ keep (Q9.3) |

---

## Appendix B — import edges, both directions

**Parked → runtime (must stay stable).** The plan names six; all six verified. Two more exist:

| # | Edge | Verified | In plan |
|---|---|---|---|
| 1 | `adapters/cds_store.py:34` → `counselle_db.models.ServiceError` | ✓ | ✓ |
| 2 | `adapters/cds_store.py:35` → `counselle_db.packets.{compile_manifest, parse_packet_row}` | ✓ | ✓ |
| 3 | `counselle_db/packets.py:11-12` → `counselle_db.formatting.{format_cds_edition, format_decimal}` + `counselle_db.models.{DomainRow, ServiceError}` | ✓ (note: `ServiceError` too, and `format_decimal` too — the plan names only `DomainRow`/`format_cds_edition`) | partial |
| 4 | `app/cds/service_review.py:48` → `counselle_db.formatting.format_decimal` | ✓ | ✓ |
| 5 | `app/cds/service_ingest.py:31`, `service_review_approve.py:42` → `app.agent_node.model_name_from_setting` | ✓ | ✓ |
| 6 | `api/routes/cds_admin.py:21-25` → `api.auth`/`api.auth_security`/`api.deps`/`api.ratelimit`/`api.users_db`; `:63-66` → `runtime.{pipeline_pool, app_pool}` + `app.state.settings`; `:316` → `runtime.deps.catalog` (+`maybe_refresh(force=True)` at `:318`) | ✓ (import block is `:21-25`, not `:22-26`) | ✓ |
| **7** | `adapters/cds_store.py:468` → `settings.supported_packet_extractor_versions` | ✓ | ✓ (listed separately) |
| **8** | parked scripts → `counselle_db.db.create_pool` + `config.settings.get_settings` (`publish_cds_manifest.py:40`, `cds_domain_diff.py:34`, `verify_cds_engine.py:41`, `verify_cds_adapters.py:38`, `_cds_crash_test_worker.py:18`) | ✓ | **not named** — harmless (both survive), but belongs in `PARKED.md` |

Also verified **not** edges (comments/docstrings only, no import): `app/cds/jobs.py:182`
(`EmptyCatalog`, `cds_data_enabled`), `counselle_db/db.py:45-52` (`DbChildSettings`),
`adapters/cds_gemini.py:88` (deliberate duplicate of `model_name_from_setting`).

**Runtime → parked (must all disappear).** Complete list at HEAD:

| Edge | Disposition |
|---|---|
| `api/main.py:49` `cds_admin` in the routes import tuple | **✗ M2 — plan removes only the `:277` mount** |
| `api/main.py:64` `from app.cds.jobs import start_cds_worker` | **✗ M3 — plan is ambiguous** |
| `counselle_db/catalog.py:18` `from counselle_db.packets import (…)` | ✓ dies with the manifest block |
| `counselle_db/service.py:32` `from counselle_db.packets import ParsedMetric, parse_packet_row, read_metric` | ✓ dies with `get_domain` |
| `scripts/dispose_cds_pollution.py:70-72` → `adapters.cds_store`, `app.cds.*` | ✓ script deleted |

After M2+M3, zero runtime→parked edges remain. `domain/cds/` imports nothing outside
`domain/` + `yaml` + `pymupdf` (confirmed by `tests/domain/test_purity.py`).

---

## Appendix C — tests: the four definitive lists

Measured at HEAD: **140** files under `tests/` (128 test modules, 3 conftest, 9 `__init__.py`).

#### C1 — DELETE (11, not 13)
`tests/test_mcp_smoke.py` (26) · `tests/counselle_db/test_server.py` (87) ·
`tests/api/test_supervision.py` (162) · `tests/adapters/test_cds_disposal.py` (188) ·
`tests/app/test_evidence_markers.py` (125) · `tests/app/test_legacy_citations.py` (41).
*(The plan's list of 6 named + "…" needs the remainder spelled out; two of its implied
members —`test_query_guard.py`, `test_reading_rules.py` — move out per M5.)*

#### C2 — REWRITE (18)
`tests/app/test_steps.py` 907 · `test_steps_router.py` 851 · `test_viz_pure.py` 855 ·
`test_protocol_fixtures.py` 723 · `test_tool_middleware.py` 343 · `test_toolset.py` 390 ·
`test_sources.py` 114 · `test_parked_sources.py` 30 (**M6**) · `test_caveats.py` 48 ·
`test_viz_signature.py` 163 · `test_tool_specs.py` 159 · `test_tool_overflow.py` 162 ·
`test_state.py` 151 · `test_skills.py` (`:332`) · `test_deps_pipeline_pool.py` 144 ·
`test_deps_workspace.py` 53 · `test_school_workspace_services_unit.py` 210 ·
`tests/counselle_db/test_catalog_contract.py` 655 · `test_foundation_regressions.py` 519 ·
`test_query_guard.py` 322 (**M5**) · `tests/domain/test_envelope_v2.py` 90 ·
`tests/api/test_sse.py` 263 · `tests/api/test_transcript.py` 792 ·
`tests/app/test_clarify_v2_agent_seam.py` 249 · `tests/evals/test_scorers.py` 1315 ·
`tests/test_settings.py` 403.

#### C3 — PARKED unit tests (26; 24 routine + 2 dormant)
`tests/app/cds/` **18 files**: `test_batching`, `test_batch_run`, `test_calling`,
`test_citation_remap`, `test_detect_nullable_identity`, `test_engine`, `test_jobs`,
`test_manifest`, `test_service_ingest_content_free_pdf`,
`test_service_ingest_patch_error_row`, `test_service_ingest_unreadable_pdf`,
`test_service_review_activate_untouched`, `test_service_review_edit_conflict`,
`test_service_review_edit_flags`, `test_service_review_edit_generation`,
`test_service_review_header`, `test_service_review_packet`, `test_service_review`†.
`tests/domain/cds/` **5**: `test_manifest_compile`, `test_packet_build`,
`test_packet_build_golden`†, `test_pages`, `test_validators`.
Plus `tests/counselle_db/test_packets.py` (602), `tests/counselle_db/test_reading_rules.py`
(93, **M5**), `tests/api/test_cds_admin_auth.py`, `tests/adapters/test_cds_pdf.py`,
`tests/domain/test_purity.py` (carve-out unchanged).
† = `live_db`, goes dormant.

#### C4 — `live_db` dormant when CDS tables are absent (5)
`tests/counselle_db/test_live_db.py` (68, asserts `current_contract == "8"`) ·
`tests/app/test_viz.py` (199) · `tests/app/cds/test_service_review.py`† ·
`tests/domain/cds/test_packet_build_golden.py`† · `tests/api/test_routes_unit.py`
(`:94`, `:418` — **S10**).
† = the two untriaged `TODOS.md:177-199` failures; they stay untriaged, under a "parked" heading.
The remaining 23 `live_db` files touch `counselle.*` only and are unaffected.

#### C5 — module-scope importers of deleted symbols (collection-error risk)
`tests/app/test_steps.py:17` · `tests/app/test_tool_middleware.py:9` ·
`tests/app/test_viz_pure.py:15-23` · `tests/app/test_parked_sources.py:3` ·
`tests/app/test_evidence_markers.py:1` · `tests/app/test_legacy_citations.py:7` ·
`tests/app/test_tool_specs.py:7` · `tests/app/test_toolset.py:20-28` ·
`tests/counselle_db/test_server.py:6` · `tests/counselle_db/test_catalog_contract.py:13` ·
`tests/counselle_db/test_foundation_regressions.py:12,14` ·
`tests/api/test_supervision.py:17` · `tests/test_settings.py:12` ·
`tests/app/test_deps_pipeline_pool.py:19` · `tests/app/test_deps_workspace.py:7` ·
`tests/evals/test_scorers.py:8,11` · `evals/runner.py:38-41`.
Runtime-patch sites (fail on execution, not collection):
`tests/app/test_school_workspace_services_unit.py:108,149`; `tests/test_settings.py:33,194`;
`tests/api/test_routes_unit.py:94`; `tests/app/test_durability.py:137`;
`tests/api/conftest.py:207`; `tests/app/test_run_turn.py` (catalog stub, `agent_mcp_read_timeout_s`).

#### C6 — `Catalog.load` fixtures (M7)
`tests/counselle_db/conftest.py:42` · `tests/app/test_school_workspace_live.py:40` ·
`test_workspace_tools.py:52` · `test_workspace_tools_essays.py:43` ·
`test_workspace_tools_essays_content.py:43` · `test_workspace_tools_essays_mutations.py:44` ·
`test_workspace_tools_memory.py:50` · `test_workspace_tools_profile.py:52` ·
`test_workspace_services_live.py:89`.

---

## Appendix D — Settings: dead under v3

| Field | Line | Sole consumer | Plan says | Verdict |
|---|---|---|---|---|
| `DbChildSettings` (class) | 60-93 | `counselle_db/server.py`, `serialize_db_child_environment` | delete | ✓ |
| `get_db_child_settings` | 97 | `counselle_db/server.py` | delete | ✓ |
| `serialize_db_child_environment` | 514 | `app/toolset.py:132`, `scripts/mcp_smoke.py` | delete | ✓ |
| `agent_mcp_read_timeout_s` | 347 | `app/toolset.py:134` | delete | ✓ |
| `_MCP_ENV_ALLOWLIST` | 48-58 | `serialize_db_child_environment` | (implied) | should be named |
| **`source_evidence_max_items`** | **275** | **`app/sources.py:122` only** | — | **✗ S3 — dead, not deleted** |
| **`cds_data_enabled`** | **259** | `app/deps.py:115`, `app/graph.py:99` | ambiguous | **✗ S4** |
| `supported_packet_extractor_versions` (Settings) | 264-274 | `adapters/cds_store.py:468` (parked); `service.py:825,831` (dies) | keep | ✓ |
| `db_pipeline_dsn` | 258 | `app/deps.py:128` | keep unset | ✓ |
| `cds_worker_*`, `cds_extraction_lease_seconds`, `cds_model_timeout_seconds`, `cds_upload_max_bytes` | 381-393 | `app/cds/jobs.py`, `api/context.py:223` | keep parked | ✓ |
| `model_cds_extract*`, `model_cds_detect` (5) | 184-215 | `app/cds/calling.py`, `detect.py` | keep parked | ✓ |
| `data_catalog_refresh_seconds` | — | `Catalog.maybe_refresh` | keep | ✓ |
| `query_database_max_bytes`, `viz_max_cells`, `db_row_cap` | — | survive | keep | ✓ |

Required fields (boot-blocking): `db_ro_dsn`, `db_app_dsn`, `jwt_secret` — **no CDS field is
required** ✓ (the plan's claim holds).

`.env.example` dead entries: `COUNSELLE_AGENT_MCP_READ_TIMEOUT_S`,
`COUNSELLE_SOURCE_EVIDENCE_MAX_ITEMS`, the `COUNSELLE_SETTINGS_NO_ENV_FILE` MCP-child
paragraph, the `# --- CDS reader catalog and packet contract ---` header, and
`COUNSELLE_CDS_DATA_ENABLED` (pending S4). Missing additions: `COUNSELLE_DB_ADMIN_DSN` (§6c
has it) + the whole `COUNSELLE_FACTS_*` block.

---

## Appendix E — scripts and evals disposition

| Path | Lines | Plan | Verified / note |
|---|---|---|---|
| `scripts/mcp_smoke.py` | 82 | DELETE | ✓ (`EXPECTED_TOOLS:16`; mypy walks `scripts/`, so it must die with `server.py`) |
| `scripts/dispose_cds_pollution.py` | 392 | DELETE | ✓ (imports parked `app.cds.*` at `:70-72`) |
| `scripts/publish_cds_manifest.py` | 206 | PARK | ✓ imports parked only + `counselle_db.db` |
| `scripts/cds_domain_diff.py` | 91 | PARK | ✓ same |
| `scripts/verify_cds_engine.py` | 322 | PARK | ✓ same (+`counselle_db.packets`) |
| `scripts/verify_cds_adapters.py` | 384 | PARK | ✓ same |
| `scripts/_cds_crash_test_worker.py` | 31 | PARK | ✓ `app.cds.jobs.Poller` |
| `scripts/cds_manifest_check.py` | 59 | PARK | ✓ pure-disk half still runs; §6d correctly notes the `CLAUDE.md` "Commands" entry becomes moot |
| `scripts/seed_reader_db.py` | 209 | REWRITE | ✓ (§6c) |
| `scripts/chat_cli.py` | 104 | EDIT `:6` | ✓ — the MCP-child phrase is on `:6` |
| `scripts/dev.py` | 634 | new `reset-db` | ✓ no CDS refs (`:369` "Process supervision" is unrelated) |
| `scripts/promote_admin.py` | 63 | keep | ✓ (unnamed in §6a; fine) |
| `scripts/finish_render_staging.py` / `finish_supabase_staging.py` | — | Phase 4 | ✓ but see **B1** (`finish_supabase_staging.py:73-79` = five view names) |
| `scripts/entrypoint.sh` | — | — | **✗ N7** `:20` comment |
| `evals/runner.py` | 1657 | REWRITE, same commit | ✓ `:41`, `:190-316`, `:486-573`; also `:38-40` two more privates (**M6**) |
| `evals/questions.yaml` | 32 cases | re-point | ✓ 32 ✓; the 24/17/2/5 split is not reproducible (**S8**) |
| `evals/judge.md`, `evals/report-*.json` | — | — | not mentioned; the four `report-*.json` files are historical records, no action |

---

## Appendix F — skills edit list (definitive, by CDS-hit count)

| File | Hits | Concrete refs | Plan | Verdict |
|---|---|---|---|---|
| `skills/db-recipes/SKILL.md` | 39 | frontmatter `description:` `:3` ("five … cds_library reader views", `get_domain`); `:10`; view list `:16-20`; SQL at `:37,38,56,57,58,82,86,98,99,101`; `:111` | wholesale rewrite | ✓ |
| `skills/citation-and-recency/SKILL.md` | 16 | — | 30-50% rewrite | ✓ |
| `skills/school-deep-dive/SKILL.md` | 14 | — | 30-50% rewrite | ✓ |
| `skills/school-comparison/SKILL.md` | 13 | — | 30-50% rewrite | ✓ |
| `skills/counselor-research/SKILL.md` | 5 | `description:` `:3`; `:10`, `:45`, `:46`, `:48` | "1-2 lines" | **N6 — 4-5 lines incl. the model-facing description** |
| `skills/major-and-fit/SKILL.md` | 2 | `:33`, `:55` | 1-2 lines | ✓ |
| `skills/school-list/SKILL.md` | 2 | `:26`, `:28` | 1-2 lines | ✓ |
| `skills/application-rounds/SKILL.md` | 1 | `:26` | 1-2 lines | ✓ |
| `skills/chancing/SKILL.md` | 1 | `:26` | 1-2 lines | ✓ |
| `skills/costs-and-aid/SKILL.md` | 1 | `:25` | 1-2 lines | ✓ |
| `skills/deep-research/SKILL.md` | 1 | `:15` | 1-2 lines | ✓ |
| `skills/essay-honesty/SKILL.md` | 1 | `:29` | 1-2 lines | ✓ |
| `skills/testing-strategy/SKILL.md` | 1 | `:31` | 1-2 lines | ✓ |
| **`skills/activities.md`** | 1 | `:25` | — | **✗ M8** |
| **`skills/honors.md`** | 1 | `:25` | — | **✗ M8** |
| The other 13 (`essay-*` ×10, `essay-fit`, `focused-answer`, `guided-counselor`) | 0 | — | none | ✓ verified zero hits |

Assets: `counselor.md` sections `:77`, `:157`, `:179-192`, `:193-208`, `:430`, `:438`,
`:462` — **all seven line numbers exact** ✓. `data_picture.md` 9 lines ✓.
`caveats.yaml` current kinds (exact, `:1,4,7,10,13,16,19,22,25,28,31`): `profile_snapshot`,
`stale_edition`, `partial_packet`, `definition_drift`, `not_in_template_version`,
`edition_mismatch_comparison`, `coverage_denominator`, `not_reported`, `not_applicable`,
`suppressed`, `vintage_period_unavailable` — 11 ✓, matching `app/caveats.py:18-22` exactly.
Note: `coverage_denominator` has **no code emitter today** (only `app/caveats.py`'s expected
set + the yaml + prompt/skill text) — §6a's "emitted by code when an aggregate or ORDER BY is
present" is net-new Phase 3 work, not a carry-over; worth saying so.
`step_labels.yaml`: 50 tool rows; `get_domain:` at `:31-38` ✓; a missing row degrades
silently via `app/tool_specs.py:82-86` → `StepMapper` generic fallback ✓.

---

## D — Facts response type, explore request/response, `db` chip spec, registry map, admin dashboard spec, dead-code list

## Appendix A — Facts response shape (TypeScript)

Replaces the §5 one-liner. Source-agnostic: no `cds`, no `edition`, no `evidence`,
no `manifest`. Every kind maps 1:1 onto a CollegeData `bodyContent` node type (F11) and
onto a block `school-facts-blocks.ts` already knows how to render.

```ts
// frontend/src/features/schools/facts/school-facts-types.ts  (rewritten)

export type FactState = "value" | "not_reported" | "not_collected" | "not_fetched";

/** A qualifier the value cannot be read correctly without. Unchanged from today
 *  (school-facts-types.ts:70-83) — the vocabulary is v3's, the type is not. */
export type Caveat = {
  id: string;                       // "stale_facts" | "coverage_denominator" | …
  text: string;
  severity: "ordinary" | "severe";
  short?: string;
};

type FactBase = {
  /** Two-segment `<domain>.<name>`, e.g. "admissions.admit_rate". */
  key: string;
  label: string;
  state: FactState;
  /** Never blank, never a dash. The absence word when state !== "value". */
  display: string;
  unit: string | null;
  /** Last time this value was confirmed present. ISO 8601. */
  observed_at: string | null;
  /** Only when the CollegeData label states one ("2025-26", "Fall 2024"). */
  reported_period: string | null;
  caveat_ids: string[];
};

/** CollegeData TitleValue. `value` may be multi-line (the source is a string[]). */
export type ScalarFact = FactBase & {
  kind: "scalar";
  value: number | string | boolean | null;
  /** CollegeData NestedTitleValue: an indented sub-row set under this row. */
  children?: ScalarFact[];
};

/** CollegeData TitleLink. */
export type LinkFact = FactBase & { kind: "link"; url: string | null };

/** CollegeData SubscreenNavigator (majors, programs). */
export type ListFact = FactBase & { kind: "list"; items: string[] };

/** CollegeData LabeledTable (values grid) — e.g. "Examinations". */
export type TableFact = FactBase & {
  kind: "table";
  key_title: string;                       // "Subject"
  columns: string[];                       // ["Required Units", "Due in Admissions Office"]
  rows: { label: string; cells: (string | null)[] }[];
};

/** CollegeData IconTable — a boolean matrix. `columns` MAY repeat ("Women","Women"),
 *  so the renderer keys by index, never by title. */
export type MatrixFact = FactBase & {
  kind: "matrix";
  key_title: string;                       // "Sports"
  columns: string[];
  rows: { label: string; cells: boolean[] }[];
};

/** CollegeData BarGraph — feeds FactBarChart via BarsBlock. */
export type DistributionFact = FactBase & {
  kind: "distribution";
  points: { key: string; label: string; display: string; value: number }[];
  max: number;                             // 100 for shares, else the largest bar
  scale: "percent" | "count";
};

/** Parsed middle-50 ("740-790 range of middle 50%") — feeds FactRangeChart. */
export type BandFact = FactBase & {
  kind: "band";
  p25: number; p50: number | null; p75: number;
  min: number; max: number;                // the TEST's scale, e.g. 200/800
  submitted_percent: number | null;        // drives classify-fit.ts:33
};

/** CollegeData LabeledTable whose valueTitles are an importance scale and whose
 *  rows carry a single X — feeds FactOrdinal. NOT IconTable (see F12). */
export type OrdinalFact = FactBase & {
  kind: "ordinal";
  levels: string[];                        // ["Very Important","Important","Considered","Not Considered"]
  items: { key: string; label: string; level: number; display: string }[];
};

export type Fact =
  | ScalarFact | LinkFact | ListFact | TableFact
  | MatrixFact | DistributionFact | BandFact | OrdinalFact;

export type FactGroup = {
  id: string;
  /** CollegeData CategoryDivider, or a sections.yaml group title. */
  label: string;
  facts: Fact[];
  /** A qualifier a CHART cannot be read correctly without. Groups only. */
  foot: string | null;
};

export type FactSection = {
  /** From sections.yaml — a plain string, NOT a closed union (F15). */
  id: string;
  title: string;
  /** Whether this section's source tabs were fetched at all (F13). */
  fetch_state: "ok" | "not_fetched" | "error";
  groups: FactGroup[];
};

export type SchoolIdentity = {   // unchanged (school-facts-types.ts:140-150)
  unitid: number; name: string; city: string | null; state: string | null;
  control: "public" | "private" | null; undergraduates: number | null;
  websiteUrl: string | null; domain: string | null;
};

export type DeadlineRow = {
  round: string;                 // "Regular", "Early Action", "Early Decision I"
  date: string | null;           // ISO; null → state "not_reported"
  state: FactState;
  display: string;               // "January 2" | "Not reported"
};

export type SchoolFacts = {
  identity: SchoolIdentity;
  /** ISO. Renders as "Checked {Month Year}" — an observation, never "updated" (R1). */
  facts_updated_at: string | null;
  /** False → the page renders the DESIGN.md §13.2 Empty primitive (F13). */
  has_collegedata: boolean;
  deadlines: DeadlineRow[];      // rendered as the Applying section's first group (F16)
  sections: FactSection[];
  caveats: Caveat[];             // referenced by fact.caveat_ids
};
```

**Component mapping** (`school-facts-blocks.ts` builds these from the above):
`scalar`/`link` → `RowsBlock` → `FactTable`; `scalar.children` → indented sub-rows
(**new**, small); `list` → `RowsBlock` with `collapsible: true` (existing affordance,
`school-facts-blocks.ts:69-80`); `table`/`matrix` → **new `TableBlock`** over
`components/ui/table` with `overflow-x-auto`; `distribution` → `BarsBlock` →
`FactBarChart`; `band` → `BandsBlock` → `FactRangeChart`; `ordinal` → `OrdinalBlock` →
`FactOrdinal`. All four existing chart files survive **unchanged**, which is what §6b's
"keep `charts/`" actually requires.

---

## Appendix B — Explore request/response shape

```ts
// GET /v1/schools/explore
export type ExploreRequest = {
  q?: string;                             // debounced 250 ms
  states?: string[];                      // ["CT","MA"]
  region?: ("northeast"|"midwest"|"south"|"west")[];        // NEW (F18)
  sizes?: ("lt2k"|"2k-10k"|"10k-25k"|"gt25k")[];
  control?: "public" | "private";
  test_policy?: "required" | "optional" | "blind";
  test_fit?: "middle50" | "above25" | "above75";            // uses sat/act below
  greek?: "little" | "substantial";
  gender?: "coed" | "women" | "men";
  calendar?: "semester" | "quarter" | "trimester";
  no_application_fee?: boolean;
  offers_early_decision?: boolean;
  offers_early_action?: boolean;
  offers_restrictive_early_action?: boolean;                 // NEW, positive (F18)
  exclude_restrictive_early_action?: boolean;
  rolling_admission?: boolean;
  major?: string;                          // exact CIP name from /schools/majors (F19)
  deadline_before?: string;                // ISO date                          // NEW
  /** min/max per key; omit a bound for open-ended. */
  ranges?: Partial<Record<RangeKey, { min: number | null; max: number | null }>>;
  include_missing?: RangeKey[];            // opt schools without the metric back IN
  /** Chooses the in-state vs out-of-state basis for admit rate and cost. */
  home_state?: string;
  sat_score?: number;
  act_score?: number;                                                          // NEW
  sort?: `${SortField}:${"asc"|"desc"}`;   // any numeric explore column (F18)
  page?: number;                           // 1-based                          // NEW
  page_size?: number;                      // default 24 = today's PAGE_SIZE
};

export type RangeKey =
  | "admit" | "cost" | "netPrice" | "needMet" | "meritAid"
  | "gradFour" | "gradSix" | "retention" | "ratio"
  | "housing" | "outOfState" | "international";

export type ExploreResponse = {
  schools: ExploreSchool[];                 // explore-types.ts:33-69 minus cdsYear
  page: number;
  page_size: number;
  total: number;
  /** HONESTY — one entry per range filter that hid rows purely for MISSING data.
   *  explore-types.ts:165-169, rendered by ExploreResultsHeader.tsx:188. */
  exclusions: { key: RangeKey; metric_label: string; count: number }[];
  /** Facet counts for the enum filters. Enums only, never ranges. */
  control_counts: { public: number; private: number };
  /** Non-null only when `total === 0`. Feeds the DESIGN.md §13.3 template verbatim:
   *  "{label} is the narrowest filter — {remaining_without_it} schools match
   *   everything else."  [Relax {label}] [Clear all filters] */
  narrowest: {
    key: RangeKey | "states" | "sizes" | "region" | "major" | "deadlineBefore";
    label: string;
    remaining_without_it: number;
  } | null;
  /** Oldest observed_at across the page — drives a page-level stale disclosure. */
  facts_observed_from: string | null;
};
```

`useExploreFilters.ts`'s URL codec (`:30-90`) extends to carry `sort` and `page`; the
React Query key is the same param set, so back/forward restores a page and a sort, not
just a filter set.

---

## Appendix C — The `db` citation chip: concrete spec

Resolves Q3. Every rule below already exists in DESIGN.md; nothing new is invented.

**Chip (inline, `CitationRenderer.tsx`)**
- **Shape:** unchanged. Same `<button>`, same height, same radius — DESIGN.md §15.3
  ("one chip shape for every source kind"). No new variant.
- **Icon:** the existing `SchoolIcon` glyph — the *generic-school* rung of §15.3's
  favicon chain — rendered on `--brand-tint` rather than bare. That is the "Counselle
  mark": it is visibly **ours** (brand ground) and visibly **not** the school's site
  favicon, which is exactly R2's requirement. The school-domain-favicon branch
  (`CitationRenderer.tsx:74-86`) is **skipped for `db`** — this is the one deliberate
  deviation from the chain, and it must carry a comment saying why (DESIGN.md §21
  "the 'why' is a comment at the site").
- **Label:** the school's name from `schoolDomainsFromBlocks`/`school_unitid`
  (`citations.ts:116-131`, kept). Not "Counselle", not "CollegeData", not "Database" —
  the school is the **subject**, we are the **source**, and the source is stated in the
  hover card, not in eight inline characters.
- **Tier badge:** **none.** `citation.tier === null` → `TierBadge` renders nothing
  (F26). No sixth Badge variant (DESIGN.md §14.1 is closed).
- **Href:** none. `db` citations have no external URL; the existing
  href/host suppression (`CitationRenderer.tsx:146-147`) already handles this.
- **Hover card** (§15.3 grammar: label + meta line that omits what the label said):
  - line 1 (label): `{School name}`
  - line 2 (meta, `--ink-muted`, 12px): `Counselle school data · Checked {Month Year}`
    — from `facts_updated_at`/`observed_at`. When `reported_period` is set:
    `Counselle school data · {period} · Checked {Month Year}`.
  - no snippet (there is no excerpt), no link row.
- **Accessible name:** `"{School name}, Counselle school data"`. Never interpolates a
  null tier (F26).
- `friendlySourceName` (`citations.ts:179-188`): the `cds`/`profile` branches collapse to
  one `db` branch returning the school name (falling back to `"Counselle school data"`
  when no `school_unitid` resolves).
- `citationYearLabel` (`citations.ts:147-151`): re-pointed from `academic_year` to
  `citation.vintage`, rendering `"Checked {Month Year}"` — or deleted and folded into
  the meta line. Prefer folding: one function fewer.

**Sources-rail row (`SourcesRail.tsx`)**
- Flat row, same as every other (§15.4): no card, no border, no divider at rest.
- Avatar: same brand-tinted `SchoolIcon` (`SourcesRail.tsx:131` branch flips
  `cds||profile` → `db`); the school-domain-favicon precedence above it is skipped for
  `db`, same comment as the chip.
- Title: the school name. **Not a link** — `db` has no URL, so the stretched anchor
  (`after:absolute after:inset-0`) is not applied and the row is inert. The rail's
  "the row is the link" rule needs an explicit `db` carve-out comment; a row that looks
  clickable and is not is worse than a plainly static row.
- Meta line: `Counselle school data · Checked {Month Year}`.
- **No nested evidence rows, no "…and {n} more values from this document" disclosure**
  (`SourcesRail.tsx:62-94,244-260` deleted). There is nothing to disclose: the value is
  the whole claim.
- **DESIGN.md §15.4 must be edited** — its "CDS/profile sources nest evidence rows…"
  paragraph describes a surface that ceases to exist. This is a §6d docs item the plan
  currently omits.

**Viz cells (`VizBlock.tsx`)**
- `stat_block` and `comparison_table` unchanged (§15.5, ADR 0024 — no third card).
- `sourceFocusForCell` → `{ index }` always; no `evidenceId` deep-link
  (`citations.ts:70-82`, `VizBlock.tsx:42`).
- Unavailable cells keep rendering *"not available"* in muted italic — never blank,
  never a dash (§15.5). This is the rule that survives the whole rewrite.
- The per-cell tier badge/button (`VizBlock.tsx:51-66`) renders only when
  `tier !== null`, and its `aria-label` (`:58`) must not interpolate a null (F26).
- A comparison whose columns' `observed_at` spread exceeds `facts_stale_days` renders
  the `observed_at_spread` caveat **once, under the table** — not per cell.

**Plan text change** — §5 Chat paragraph, and add to §6d: "`DESIGN.md` §15.4's evidence-row
paragraph and §15.3's tier-badge sentence are edited; §14.1's five-variant contract is
untouched (a `db` chip carries no badge at all)."

---

## Appendix D — Component → registry map

Installed today: `components/ui/` = accordion, avatar, badge, breadcrumb, button-group,
button, calendar, card, carousel, chart, checkbox, collapsible, command, dialog,
dropdown-menu, empty, hover-card, input-group, input, kbd, label, menu, meter,
number-field, onboarding-setup, popover, radio-group, scroll-area, segmented-control,
select, separator, sheet, sidebar, skeleton, sonner, spinner, table, tabs, textarea,
toolbar, tooltip. `components/ai-elements/` = artifact, chain-of-thought, code-block,
conversation, inline-citation, message, prompt-input, reasoning, shimmer, sources,
suggestion, task.

| New thing the plan implies | Use | Status | Note |
|---|---|---|---|
| Facts loading skeleton (`SchoolFactsSkeleton`) | `@shadcn/skeleton` — **installed** (`components/ui/skeleton.tsx`) | reuse | Compose rail (5 bars) + panel (headline + 8 rows). Follow `SchoolResultCardSkeleton.tsx` and `features/cds-admin/coverage/CoverageSkeleton.tsx` for shape (read them; do **not** import the latter — F24) |
| Facts error state | `@shadcn/empty` — **installed** (`components/ui/empty.tsx`) + `Button` | reuse | DESIGN.md §13.1 template, `role="alert"` |
| Facts empty state (no CollegeData page) | `@shadcn/empty` — **installed** | reuse | §13.2 template |
| Deadline list | `FactTable` rows in the Applying section | reuse | No new component (F16) |
| `TableBlock` (LabeledTable / IconTable) | `@shadcn/table` — **installed** (`components/ui/table.tsx`, Base UI lineage) | reuse | Wrap in `overflow-x-auto` (§17.6). Check marks: `lucide-react` `Check` + `aria-label`, never colour alone (§14.3) |
| `list` fact (90 majors) | `@shadcn/collapsible` — **installed** | reuse | `RowsBlock.collapsible` affordance already exists |
| Explore range filters | `explore-controls.tsx:128 RangeFields` (`number-field`) | reuse — **do not add a slider** | A slider cannot express "no maximum"; the number pair can. `@shadcn/slider` is the only genuinely missing primitive and it is not needed |
| Explore "major offered" combobox | `@shadcn/command` — **installed** (`components/ui/command.tsx`, `cmdk@1.1.1`) inside `@shadcn/popover` — **installed** | reuse | The canonical shadcn combobox recipe. Async-backed by `GET /v1/schools/majors?q=` (F19) |
| Explore "deadline before" | `@shadcn/calendar` — **installed** (`react-day-picker@10`) inside `popover` | reuse | Already used by the workspace deadline fields |
| Explore sort control | `@shadcn/select` or `segmented-control` — both **installed** | reuse | `explore-controls.tsx` already has the chip shell |
| Explore pagination | existing "show more" in `ExplorePanel.tsx:114-124`, re-pointed at `page` | reuse | No `pagination` primitive installed and none needed — keep the load-more affordance |
| Admin dashboard stat tiles | `@shadcn/card` + `Badge` — **installed** | reuse | See Appendix E. Do **not** import `cds-admin/coverage/CoverageCounters.tsx` (F24) |
| Admin crawl-run history table | `@shadcn/table` — **installed** | reuse | |
| Admin unmapped-label list | `@shadcn/scroll-area` + `@shadcn/collapsible` — **installed** | reuse | |
| Admin sparkline (optional) | `components/ui/chart.tsx` + `recharts@3.10` — **installed** | reuse | Only if trivial; DESIGN.md §15.5's "no charting library" rule governs *answer* viz, not admin chrome — but keep it to one sparkline |
| `db` citation chip | `CitationRenderer.tsx` (custom, §15 honesty surface) | extend | Explicitly a "build custom" per DESIGN.md §10.1 rung 6 — it is a differentiating honesty surface, not a commodity |

**Nothing in this plan requires a new registry install.** Re-run the shadcn MCP search
before building anyway (§10.1 rung 1) — it was down this session.

---

## Appendix E — Admin facts dashboard: concrete spec

**Route.** `/app/admin/facts`, wrapped in the existing `AdminGate`
(`app/auth/AdminGate.tsx` — which F9 confirms stays in the tree and now regains its
single importer, so the "importer-less; keep" note in §6b becomes moot). Registered in
`app/router.tsx` in the slot the four `admin/cds` objects vacate. **No catch-all
redirect** — the deleted `admin/cds/*` catch-all's job is done by the generic `*`
(`router.tsx:175-176` → `/app/tasks`), which is the intended unreachable behaviour for
the parked screens.

**Nav.** `app/shell/navigation.tsx`'s `adminShellRoutes` is **not deleted** — it is
re-pointed: `{ id: "facts", title: "School data", icon: <DatabaseZap />, link:
"/app/admin/facts" }`. `AppSidebar.tsx:45-47`'s `is_superuser` ternary stays exactly as
is. **This changes F9's 3-file parking edit into a 3-file *swap*** — same files, one
fewer deletion — and it is strictly safer (the sidebar branch and its `MeData` read keep
their only test coverage). Amend the §6b sentence "collapse `AppSidebar.tsx:45-46` to
`shellRoutes`, delete `navigation.tsx:10,70-79`" to "re-point `navigation.tsx:72-79` at
`/app/admin/facts`; `AppSidebar.tsx:45-47` and `DatabaseZap` are untouched."

**Layout** (one screen, `PageContainer` + the standard page scaffold, DESIGN.md §9.3;
max-width `1160px` to match `SchoolFactsPanel.tsx:73`):

```
┌ Page header ──────────────────────────────────────────────────────────┐
│ School data                                          [Run a pass now] │  ← Button, loading prop (§11.6)
│ Last checked 5 Sep 2026, 03:12 · next pass in 6h 48m                  │  ← --ink-muted, 13px
└───────────────────────────────────────────────────────────────────────┘

┌ Row of 4 stat tiles (Card, grid md:grid-cols-4 gap-3) ────────────────┐
│ Last pass      │ Pages          │ Schools        │ Needs attention    │
│ Completed      │ 15,504 fetched │ 2,584 of 2,592 │ 3 tabs failing     │
│ 1h 58m         │ 218 changed    │ slugs crawled  │ 41 unmapped labels │
│ [success]      │ 12 failed      │ 2,392 of 2,746 │ 8 unmatched slugs  │
│                │                │ unitids covered│                    │
└───────────────────────────────────────────────────────────────────────┘

┌ Per-tab health (Table, 6 rows) ───────────────────────────────────────┐
│ Tab            │ ok    │ http_error │ parse_error │ never_fetched     │
│ overview       │ 2,584 │ 0          │ 0           │ 8                 │
│ admission      │ 2,581 │ 3          │ 0           │ 8                 │  ← non-zero failure cell: Badge error + word
│ …                                                                     │
└───────────────────────────────────────────────────────────────────────┘

┌ Recent passes (Table, last 20 crawl_runs) ────────────────────────────┐
│ Started      │ Duration │ Pages │ Changed │ Errors │ buildId rotations│
│ 5 Sep 03:12  │ 1h 58m   │15,504 │   218   │   12   │        1         │
│ …                                                                     │
└───────────────────────────────────────────────────────────────────────┘

┌ Unmapped labels (Collapsible, collapsed by default) ──────────────────┐
│ 41 labels the mapper did not recognise in the last pass       [Show]  │
│ → ScrollArea, one row per label: source_path · label · N schools      │
└───────────────────────────────────────────────────────────────────────┘

┌ Unmatched CollegeData schools (Collapsible, collapsed) ───────────────┐
│ 8 slugs with no unitid · 354 unitids with no CollegeData page [Show]  │
└───────────────────────────────────────────────────────────────────────┘
```

**Components** — all from `components/ui/` (F24: **zero** imports from
`features/cds-admin/`): `Card` (tiles), `Table` (two tables), `Badge`
(`success`/`warning`/`error`/`secondary` only, §14.1), `Collapsible` + `ScrollArea` (the
two lists), `Button` with `loading` (§11.6) for "Run a pass now", `Skeleton` (loading),
`Empty` (no runs yet). Optional single sparkline of pages-changed per pass via
`components/ui/chart.tsx` + recharts — trivial, and the only chart on the screen.

**Status vocabulary** (DESIGN.md §14.1/§14.3 — the word, always; the glyph when severe):
`completed` → `success` "Completed"; `running` → `secondary` "Running" (plus the
unfilled-ring shape used for tool calls); `failed` → `error` "Failed" + `AlertTriangle`;
`queued` → `secondary` "Queued"; a tab with `consecutive_failures >= facts_failure_threshold`
→ `error` + `AlertTriangle`, below it → `warning` "Failing". Never a bare coloured number.

**States**
- **Loading:** four `Skeleton` tiles + two 5-row table skeletons. No spinner-on-page.
- **Error:** DESIGN.md §13.1 — **"Could not load crawl status" / "The workspace could
  not reach the school data service." / `[Try again]`**, `role="alert"`.
- **Empty (no `crawl_runs` yet — the state on a fresh DB, which is Phase 2's *actual*
  first state):** `Empty` primitive — **"No passes yet" / "The crawler has not run. Start
  one to populate school facts." / `[Run a pass now]`**. This case is guaranteed to occur
  and is the one most likely to be skipped.
- **Degraded:** `COUNSELLE_FACTS_WORKER_ENABLED=false` → an inline `warning` Badge row
  above the tiles, "Crawler disabled — showing the last completed pass", not an error.

**Polling.** React Query `refetchInterval: 30_000` **only while a run is `running`**
(otherwise `false`) — a dashboard that polls every 30s forever for a daily job is waste.

**Response shape** (`GET /v1/admin/facts/status`, superuser):
```ts
type FactsStatus = {
  worker_enabled: boolean;
  next_pass_at: string | null;
  current: { id: number; status: "queued"|"running"; started_at: string } | null;
  last: {
    id: number; status: "completed"|"failed"; started_at: string; finished_at: string;
    build_id: string; build_id_rotations: number;
    schools_seen: number; pages_fetched: number; pages_changed: number;
    facts_changed: number; errors: number; unmapped_label_count: number;
  } | null;
  coverage: {
    sitemap_slugs: number; slugs_crawled: number;
    unitids_total: number; unitids_covered: number;
    crosswalk_unmatched_slugs: number; unitids_without_page: number;
  };
  tabs: { tab: string; ok: number; http_error: number; parse_error: number;
          build_id_rotated: number; never_fetched: number }[];
  history: { id: number; started_at: string; duration_s: number; pages_fetched: number;
             pages_changed: number; errors: number; build_id_rotations: number;
             status: string }[];   // last 20
};
// GET /v1/admin/facts/unmapped?page= → { items: {source_path, label, school_count}[], total }
```
The unmapped list is a **separate paged endpoint** (F23): one pass can surface thousands
of labels and they must not sit inside the status payload the dashboard polls.

---

## Appendix F — Predicted dead code after v3 (the `knip` target list, F27)

**Whole files that become unused**
- `features/schools/explore/explore-fixtures.ts` (412) — §6b ✓
- `features/schools/facts/school-facts-fixtures.ts` + `facts/fixtures/*.ts` (11 files, 2,083) — §6b ✓
- `features/dev-school-facts-gallery/SchoolFactsGalleryPage.tsx` — **F1, unlisted**
- `api/chat/legacy-replay.ts` (343) + `tests/fixtures/protocol/legacy_v1_completed_turn.json` — §6b lists the module, not the fixture (**F6**)

**Exports that become unused inside surviving files**
- `explore-config.ts`: `dataWindowOptions` (:202), `CURRENT_CDS_YEAR` (:222),
  `RECENT_CDS_YEAR_SPAN` (:223) — §6b ✓
- `explore-filter.ts`: `matchesDataWindow` (:161-177) plus, once filtering is server-side,
  `runExplore` (:284), `relaxFilter` (:415), `isRangeActive` (:459). **`countActiveFilters`
  (:434) survives** — `ExplorePanel.tsx:109` uses it for the chip count and the stagger
  decision (`:124`), which stay client-side. §6b's "moves server-side" undersells that
  four of five exports die and one lives
- `explore-types.ts`: `DataWindow` (:117-118), `ExploreFilters.dataWindow` (:155),
  `ExploreSchool.cdsYear` (:67) — §6b ✓
- `useExploreFilters.ts`: `ENUM_PARAMS.dataWindow` (:57) — §6b ✓
- `school-facts-format.ts`: `coverageSentence` (:66-74); `ABSENCE_COPY` (:22-31) and
  `ABSENT_TOPIC_EXPLANATION` (:38-39) shrink to the four v3 states — §6b ✓
- `school-facts-types.ts`: `Evidence`, `DomainCoverage`, `SchoolEdition`, `AbsentTopic`,
  `OfficialLane`/`CdsLane`/`LaneRow`, and three of six `FactState` kinds
  (`suppressed`, `not_in_template_version`, `no_verified_value`) — §6b ✓
- `school-facts-rows.ts`: `provenanceOf` (:80-82) and `Provenance` (:42); `laneRow` dies
  with the dual-lane model — §6b ✓ (`laneRow` unnamed)
- `api/chat/types.ts`: `EvidenceItem`, `LegacySourceEntry`, `ReplaySourceEntry`
  (the last two die with `legacy-replay.ts` — **F6**, §6b marks them K)
- `api/chat/validation.ts`: `isCurrentEvidence` (:203-225) — §6b ✓
- `features/ai-chat/citations.ts`: `citationYearLabel` (:147-151) if folded into the
  hover meta line (Appendix C)
- `features/schools/facts/SchoolFactsPanel.tsx`: `NoCommonDataSet` — §6b ✓
- `features/schools/SchoolDetailRoute.tsx`: `NoFactsYet` (:365-388), replaced by the
  §13.2 Empty primitive — **F13, unlisted**

**Tokens**
- `styles/schools.css:127-128` `--school-fact-evidence-ink` / `-hover` — **F5, unlisted**

**Deliberately NOT dead (do not let a cleanup pass eat these)**
- `features/cds-admin/**`, `api/cds-admin/**`, `pages/cds-*`, `app/auth/AdminGate.tsx`
  (which Appendix E re-uses), `config.ts:6-11` — parked by design; put them in
  `knip.json`'s ignore list
- `SchoolResultCardSkeleton.tsx` — currently unused by `ExplorePanel`, becomes used by
  F21's first-load state
- `charts/*` (5 files) — dead under §5's shape as written, alive under Appendix A. This
  is the single clearest reason to adopt Appendix A.

---

## E — Node-type normalization, complete label inventory with `fact_key`/section/type, `facts_sections.yaml` draft, explore columns, crosswalk measurements, fixture slugs

### Appendix i — Node type → normalization

Key shapes are closed (verified across 11 captures): every node is `{type, data}`; `data` key sets
are exactly `ExpandableSection{title,iconType,link,children}`, `CategoryDivider{value}`,
`TitleValue{title,value}`, `TitleLink{title,text,link}`, `NestedTitleValue{topTitleValue,children}`,
`LabeledTable{tableTitle,keyTitle,valueTitles,data[{label,values}]}`, `IconTable{…same…}`,
`BarGraph{title,data[{label,value}]}`, `SubscreenNavigator{title,buttonText,data[str]}`.

| Node | Emits | `fact_key` | `value` jsonb | `display` | `unit` | Typed projection | Section |
|---|---|---|---|---|---|---|---|
| **ExpandableSection** | nothing; sets `section_title` context and (regex) a section-level `reported_period` | — | — | — | — | — | — |
| **CategoryDivider** | nothing; sets a **soft** `group` hint only (unstable across schools, E-B3) | — | — | — | — | — | — |
| **TitleValue** scalar money | 1 fact | `costs.tuition_in_state` | `{"kind":"money","amount":72685,"currency":"USD"}` | `"$72,685"` | `USD` | `value_num=72685` | money |
| **TitleValue** scalar percent | 1 fact | `outcomes.retention_first_year` | `{"kind":"percent","pct":99.4}` | `"99.4%"` | `percent` | `value_num=99.4` | outcomes |
| **TitleValue** scalar count | 1 fact | `admissions.waitlist_offered` | `{"kind":"count","n":944}` | `"944"` | `count` | `value_num=944` | getting-in |
| **TitleValue** bool | 1 fact | `admissions.early_action_offered` | `{"kind":"bool","v":true}` | `"Yes"` | — | `value_bool=true` | applying |
| **TitleValue** availability enum | 1 fact | `applying.application_fee_waiver` | `{"kind":"enum","code":"available","raw":"Available"}` | `"Available"` | — | `value_text="available"` | applying |
| **TitleValue** date (month-day) | 1 fact | `deadlines.early_action` | `{"kind":"date","month":11,"day":1,"year":2026,"anchored":false}` | `"November 1"` | — | `value_date=2026-11-01` | applying |
| **TitleValue** date (anchored) | 1 fact | `deadlines.regular` | `{"kind":"date","iso":"2027-01-02","anchored":true}` | `"January 2, 2027"` | — | `value_date=2027-01-02` | applying |
| **TitleValue** `"Rolling"` | 2 facts | `deadlines.regular`, `admissions.regular_deadline_is_rolling` | `{"kind":"enum","code":"rolling"}` / `{"kind":"bool","v":true}` | `"Rolling"` | — | `value_date=NULL`, `value_bool=true` | applying |
| **TitleValue** range (`"740-790 range of middle 50%"`) | 3 facts | `class_profile.sat_math_p25/_p75/_range` | `{"kind":"range","lo":740,"hi":790,"basis":"middle_50"}` | `"740–790"` | `score` | `value_num` per percentile fact | getting-in |
| **TitleValue** sentence (`"5% of 50,264 applicants were admitted"`) | 3 facts | `admissions.admit_rate`, `.applicants_total`, `.admitted_total` | `{"kind":"percent","pct":5.0}` / `{"kind":"count","n":50264}` / derived | `"5%"` etc. | percent/count | `value_num` | getting-in |
| **TitleValue** sentence (`"1,657 (69%) of 2,387 admitted students enrolled"`) | 3 facts | `admissions.enrolled_total`, `.yield_rate`, `.admitted_total` | as above | | | | getting-in |
| **TitleValue** pct-of-population (`"77% of all students"`) | 1 fact | `campus.students_in_housing_pct` | `{"kind":"percent","pct":77,"population":"all students"}` | `"77% of all students"` | percent | `value_num=77` | campus-life |
| **TitleValue** compound (`"1.3% from 90 countries"`) | 2 facts | `students.international_pct`, `students.countries_represented` | percent / count | | | | campus-life |
| **TitleValue** labelled pairs (`["Top tenth:   97%", …]`) | n facts | `class_profile.class_rank_top_tenth` … | `{"kind":"percent","pct":97}` | `"97%"` | percent | `value_num` | getting-in |
| **TitleValue** list (`Special Programs`, `Federal Loans`, `Activities and Organizations`) | 1 fact | `academics.special_programs` | `{"kind":"list","items":[…]}` | `"Honors program, Study abroad, …"` | — | `value_text = items joined` | academics |
| **TitleValue** free text | 1 fact | `campus.mascot` | `{"kind":"text","v":"Bulldog"}` | `"Bulldog"` | — | `value_text` | campus-life |
| **TitleValue** `"Not reported"` / `"Not available"` | 1 fact | *its own key* | `null` | `"Not reported"` | — | all NULL | its section |
| **TitleValue** address array (`["38 Hillhouse Avenue","New Haven","CT","06520"]`) | 1 fact | `identity.admissions_office_address` | `{"kind":"address","street":…,"city":…,"state":…,"zip":…}` | one line | — | `value_text` | applying |
| **TitleLink** | 1 fact | `money.financial_aid_url`, `money.net_price_calculator_url`, `campus.campus_map_url`, `applying.electronic_application_url` | `{"kind":"url","href":…,"text":…}` | link text | — | `value_text=href` | money / campus-life / applying |
| **TitleLink** with `link == "Not reported"` | 1 fact | same key | `null` | `"Not reported"` | — | NULL | — |
| **NestedTitleValue** | parent fact + one fact per child, child title as a **dimension suffix** (`_women`, `_men`, `_need_based_gift`, `_need_based_self_help`) | `admissions.admit_rate_women` | as for the matching scalar shape | | | | as parent |
| **LabeledTable** (`keyTitle='Factor'`, cols = the 4 ordinal levels) | one **ordinal** fact per row | `admissions.selection_factor_<snake(row)>` | `{"kind":"ordinal","code":"very_important","levels":["not_considered","considered","important","very_important"]}` | `"Very important"` | — | `value_text="very_important"`, `value_num=3` | getting-in |
| **LabeledTable** (`keyTitle='Subject'`, cols `['Req','Reco']`) | 2 facts per row | `admissions.units_required_<subject>`, `admissions.units_recommended_<subject>` | `{"kind":"decimal","v":4}` | `"4"` | `units` | `value_num` | getting-in |
| **LabeledTable** (`tableTitle='Examinations'`, cols `['Required Units','Due in Admissions Office']`) | 2 facts per row | `admissions.test_policy_<row>`, `deadlines.test_due_<row>` | enum / date | | | | getting-in / applying |
| **LabeledTable** (`keyTitle='Forms Required'`, cols `['Cost']`) | 1 fact per row **+ label capture** | `money.fafsa_code`, `money.css_profile_required`, `money.css_profile_fee` | text / bool / money | | | | money |
| **IconTable** 4-col (Intercollegiate) | 4 bool facts per sport row, packed into **one** list fact | `campus.varsity_sports` | `{"kind":"table","rows":[{"sport":"Basketball","women_offered":true,"women_scholarship":true,"men_offered":true,"men_scholarship":true}]}` | `"13 varsity sports"` | — | `value_num = row count` | campus-life |
| **IconTable** 2-col (Club) | as above, 2 flags | `campus.club_sports` | same shape without `_scholarship` | | | | campus-life |
| **BarGraph** | 1 distribution fact + the scalars parsed from its title | `class_profile.sat_math_distribution` (+ `_p25`,`_p75`,`_avg`) | the `distribution` shape in E-M7 | `"88% scored 700–800"` | percent | `value_num` NULL on the distribution | getting-in / academics / campus-life |
| **SubscreenNavigator** | 2 facts | `academics.undergraduate_majors` (list), `academics.undergraduate_majors_count` | `{"kind":"list","items":[…90…]}` / `{"kind":"count","n":90}` | `"90 majors"` | — | `value_num=90` | academics |
| **profile header scalar** (E-B4) | 1 fact | per Appendix ii §H | by shape | | | | per Appendix ii |
| **profile header 2-array** (`attendanceCost`, `tuitionFeesCost`) | 2 facts | `costs.<name>_in_state`, `costs.<name>_out_of_state` | money | | `USD` | `value_num` | money |
| **`headerCardContent`** (academics only) | walked as a `bodyContent` array | — | — | — | — | — | academics |

**Absence semantics (one rule, four states).**

| Source condition | `school_facts` row | `state` in the API |
|---|---|---|
| Node present, value parses | row with typed value | `value` |
| Node present, value is `"Not reported"` / `"Not Reported"` / `"Not available"` / `"—"` / `""` | row with `value = NULL`, `display = "Not reported"` | `not_reported` |
| Node **absent** but the key is in `sections.yaml` | **no row** | `not_published` |
| Tab never fetched or last fetch failed | no row; `school_pages.last_status != 'ok'` | `not_fetched` |
| School has no `collegedata_schools` mapping | no rows at all | `not_collected` |
| `BarGraph` bucket value `-1` | inside the distribution: `pct: null, absence: "not_reported"` | — |
| `BarGraph` bucket omitted | listed in `omitted_buckets` | — |
| `IconTable` cell `null` | `false` (the sport is genuinely not offered) | — |
| `LabeledTable` ordinal row with all four cells `""` | `value = NULL`, `display = "Not reported"` | `not_reported` |

### Appendix ii — Complete label inventory, per tab, with proposed `fact_key` / section / type

Legend for **Seen**: `Y` Yale · `G` UGA · `S` Santa Monica College (2-yr public, open admission) ·
`P` University of Phoenix (for-profit) · `A` School of the Art Institute of Chicago ·
`L` Spelman College (HBCU, women only). A blank means the label was absent from that capture —
which is data, not an error (E-M13).

Machine-generated source: `scratchpad/work/inventory.txt` (359 lines, every row and bar expanded)
and `scratchpad/work/union.txt` (267 distinct tuples, Yale+UGA).

#### §H — `pageProps.profile` header fields (39 keys) — **missing from the plan entirely (E-B4)**

| Tab(s) | Header key | Example | `fact_key` | Type | Section |
|---|---|---|---|---|---|
| all 6 | `id` | `244` | *(not a fact)* → `collegedata_schools.collegedata_id` | int | — |
| all 6 | `slug` | `"Yale-University"` | *(not a fact)* → `collegedata_schools.slug` | text | — |
| all 6 | `name` | `"Yale University"` | *(crosswalk only)* | text | — |
| all 6 | `website` | `"https://www.yale.edu/"` | `identity.website` | url | (identity strip) |
| overview | `description` | `"Yale is a private, Ivy League…"` | `identity.description` | text | (identity strip) |
| overview | `alternativeName` | `"UG"` / `null` | *(crosswalk alias, E-N2)* | text | — |
| overview | `universityType` | `Public` \| `Private` \| `Private for-profit` | `identity.control_reported` | enum | campus-life |
| overview | `populationType` | `Coed` \| `Undergrad women only` | `identity.gender_model_reported` | enum | campus-life |
| overview | `undergradPopulation` | `6591` | `students.undergraduate_total` | int | campus-life |
| overview | `gradPopulation` | `null` / `9852` | `students.graduate_total` | int | campus-life |
| overview | `malePercentage` | `48.8` | `students.men_pct` | percent | campus-life |
| overview | `femalePercentage` | `50.1` | `students.women_pct` | percent | campus-life |
| overview, admission | `address` | `{street1,street2,city,state,zipCode}` | `identity.address` | address | (identity strip) |
| overview | `admissionsPhone` | `"(203) 432-9316"` | `applying.admissions_phone` | text | applying |
| overview | `admissionsFax` | `"(203) 432-9392"` | `applying.admissions_fax` | text | applying |
| overview | `admissionsEmail` | `"student.questions@yale.edu"` | `applying.admissions_email` | text | applying |
| admission | `phone` | `""` / `"(203)…"` | duplicate of `admissionsPhone` — **drop** | — | — |
| admission | `admissionDeadline` | `"January 2, 2027"` \| `"Rolling"` | `deadlines.regular` (display) | date/enum | applying |
| admission | `admissionDeadlineDate` | `"2027-01-02"` \| `null` | `deadlines.regular` (`value_date`); **anchors the cycle year (E-M4)** | date | applying |
| admission | `fullTimeFaculty` | `"1,545"` | `faculty.full_time_count` | int | academics |
| admission | `partTimeFaculty` | `"676"` | `faculty.part_time_count` | int | academics |
| admission | `undergraduateMajors` | `[]` on every capture | **empty everywhere — do not use**; majors come from the academics `SubscreenNavigator` | list | — |
| admission, academics | `chance` | `null` on every capture | **ignore (E-N1)** | — | — |
| money-matters | `attendanceCost` | `["$99,085","$99,085"]` / `["$29,566","$50,410"]` | `costs.attendance_in_state`, `costs.attendance_out_of_state` | money ×2 | money |
| money-matters | `tuitionFeesCost` | `["$72,685","$72,685"]` / `["$11,492","$32,336"]` | `costs.tuition_fees_in_state`, `costs.tuition_fees_out_of_state` | money ×2 | money |
| money-matters | `roomBoardCost` | `"$21,600"` | `costs.room_and_board` | money | money |
| money-matters | `suppliesCost` | `"$1,000"` | `costs.books_and_supplies` | money | money |
| money-matters | `otherExpensesCost` | `"$3,800"` | `costs.other_expenses` | money | money |
| money-matters | `paymentPlans` | `[]` on every capture | `costs.payment_plans` | list | money |
| academics | `headerCardContent` | `[CategoryDivider, TitleValue…]` | **walk as a body array** | — | academics |
| academics, campus-life | `campusMapUrl` | `"https://map.yale.edu:443/map/"` | `campus.campus_map_url` | url | campus-life |
| campus-life, students | `city` | `"New Haven"` | duplicate of `address.city` — **drop** | — | — |
| campus-life, students | `cityPopulation` | `"130,660"` | `campus.city_population` | int | campus-life |
| campus-life, students | `nearestMetro` | `"New Haven if officially part of the New YorkCity m"` (truncated at source) | `campus.nearest_metro` | text | campus-life |
| campus-life, students | `avgJanTemp` | `null` everywhere | `campus.avg_january_temp` | number | campus-life |
| campus-life, students | `avgSeptTemp` | `null` everywhere | `campus.avg_september_temp` | number | campus-life |
| campus-life, students | `rain` | `null` everywhere | `campus.annual_rainfall` | number | campus-life |
| campus-life, students | `freshmanHousingGuarantee` | `null` everywhere (the *body* row is populated) | **drop, use the body row** | — | — |

#### §1 — `overview` tab body

The whole tab is a **strict subset** of the five topic tabs (verified: every overview label
reappears on its topic tab, with the one exception noted). It is still worth fetching because
the **header** carries `universityType`, `populationType`, `undergradPopulation`,
`gradPopulation`, `male/femalePercentage`, `description`, `admissionsPhone/Fax/Email` — which no
other tab has (E-B4). **Recommendation: map only the header from `overview`; skip its body.**
The one label that is overview-only in form is `Regular Admission Deadline` printed *without* the
year (`"January 2"`) — the admission tab prints `"January 2, 2027"`; take the admission one.

| Seen | Section / divider | Label | `fact_key` | Type | Section |
|---|---|---|---|---|---|
| YGSPAL | Admissions | Entrance Difficulty | `admissions.entrance_difficulty` | enum | getting-in |
| YGSPAL | Admissions | Overall Admission Rate | → 3 keys (Appendix i) | — | getting-in |
| YGSPAL | Admissions | Early Action Offered / Early Decision Offered | `admissions.early_action_offered` / `…early_decision_offered` | bool | applying |
| YGSPAL | Admissions | Regular Admission Deadline | `deadlines.regular` | date | applying |
| YGSPAL | Admissions ▸ Qualifications of Enrolled Freshmen | Average GPA · SAT Math · SAT EBRW · ACT Composite | `class_profile.*` | decimal / range | getting-in |
| YGSPAL | Financials | Cost of Attendance · Tuition and Fees · Room and Board · Average Percent of Need Met · Average Freshman Award · Average Indebtedness of *YYYY* Graduates | `costs.*` / `aid.*` | money / percent | money |
| YGSPAL | Academics | Academic Calendar System · General Education/Core Curriculum · Full-Time Faculty Teaching Undergraduates · **BarGraph** Regular Class Size (Students) | `academics.*` / `faculty.*` / `class_size.regular_distribution` | enum / int / distribution | academics |
| YGSPAL | Campus Life | *&lt;City&gt;* Population · Nearest Metropolitan Area · Freshman Housing Guarantee · Students in College Housing · Mascot · Sororities · Fraternities · *(G,S)* Athletic Conferences | `campus.*` | — | campus-life |
| YGSPAL | Students | **BarGraph** Ethnicity of Students from U.S. · International Students · First-Year Students Returning · Students Graduating Within 4 Years · Graduates Offered Full-Time Employment Within 6 Months · Graduates Pursuing Advanced Study Directly | `students.ethnicity_distribution`, `outcomes.*` | distribution / percent | campus-life / outcomes |

#### §2 — `admission` tab (4 sections)

| Seen | Section ▸ divider | Label | `fact_key` | Type | Section |
|---|---|---|---|---|---|
| YGSPAL | Freshman Admission Reqs ▸ *High School Preparation* **/** *High School Units Req or Recommended* (E-B3) | High School Graduation | `admissions.hs_graduation_requirement` | enum | getting-in |
| YGSPAL | ″ | High School Program | `admissions.hs_program_requirement` | enum | getting-in |
| G L | ″ | **LabeledTable** `Subject` × `['Req','Reco']` rows: English · Mathematics · Science · Social Studies · Foreign Language · Academic Electives · History | `admissions.units_required_<subject>` / `…units_recommended_<subject>` | decimal ×2 | getting-in |
| YGSPAL | ″ | **LabeledTable** `Examinations` × `['Required Units','Due in Admissions Office']` rows: SAT or ACT · SAT Only · ACT Only · SAT & SAT Subject Tests, or ACT · SAT Subject Tests Only · ACT Writing Test Policy | `admissions.test_policy_<row>` + `deadlines.test_due_<row>` | enum + date | getting-in / applying |
| YGSPAL | Applying For Admission ▸ Admissions Office | Address · Phone · Fax | `applying.admissions_*` | address / text | applying |
| YGSPAL | ″ ▸ Application Dates & Fees | Regular Admission Deadline | `deadlines.regular` | date | applying |
| YG AL | ″ | Application Fee | `applying.application_fee` | money | applying |
| YGSPAL | ″ | Application Fee Waiver | `applying.application_fee_waiver` | enum | applying |
| YGSPAL | ″ | Regular Admission Notification | `deadlines.regular_notification` | date/compound | applying |
| YGSPAL | ″ | Accept Offer of Admission | `deadlines.reply_by` | date | applying |
| YGSPAL | ″ | Waiting List Used | `admissions.waitlist_used` | bool | getting-in |
| YG AL | ″ | Defer Admission | `applying.deferred_enrollment` | enum | applying |
| YG AL | ″ | Transfer Admission | `applying.transfer_accepted` | enum | applying |
| YGSPAL | ″ ▸ Early Admission | Early Decision Offered · Early Action Offered | `admissions.early_decision_offered` / `…early_action_offered` | bool | applying |
| L | ″ | Early Decision Deadline | `deadlines.early_decision` | date | applying |
| Y G AL | ″ | Early Action Deadline · Early Action Notification | `deadlines.early_action` / `deadlines.early_action_notification` | date | applying |
| YGSPAL | ″ ▸ Application Form | Common Application | `applying.accepts_common_app` | enum | applying |
| YGSPAL | ″ | **TitleLink** Electronic Application | `applying.electronic_application_url` | url | applying |
| YG AL | ″ ▸ Other Application Requirements | Interview | `admissions.interview_requirement` | enum | getting-in |
| G AL | ″ | Essay or Personal Statement | `admissions.essay_requirement` | enum | getting-in |
| GPAL | ″ | Letters of Recommendation | `admissions.recommendations_requirement` | enum | getting-in |
| G | ″ | Other | `admissions.other_requirement` | text | getting-in |
| YG AL | ″ | Financial Need | `admissions.need_blind` | enum→bool | getting-in |
| YG AL | Selection of Students | **LabeledTable** `Factor` × `['Very Important','Important','Considered','Not Considered']`, **18 rows**: Rigor of Secondary School Record · Academic GPA · Standardized Tests · Class Rank · Recommendations · Essay · Interview · Level of Applicant's Interest · Extracurricular Activities · Volunteer Work · Particular Talent/Ability · Character/Personal Qualities · First Generation to Attend College · State Residency · Geographic Residence · Relation with Alumnus · Religious Affiliation/Commitment · Work Experience | `admissions.selection_factor_<snake>` | ordinal ×18 | getting-in |
| YGSPAL | Profile of Fall Admission | **NestedTitleValue** Overall Admission Rate ▸ Women / Men | `admissions.admit_rate[_women/_men]`, `.applicants_total[_women/_men]`, `.admitted_total[_…]` | percent + count | getting-in |
| YGSPAL | ″ | **NestedTitleValue** Students Enrolled ▸ Women / Men | `admissions.enrolled_total[_…]`, `admissions.yield_rate[_…]` | count + percent | getting-in |
| YG AL | ″ | Students Offered Wait List · Students Accepting Wait List Position · Students Admitted From Wait List | `admissions.waitlist_offered/_accepted/_admitted` | count ×3 | getting-in |
| YGSPAL | ″ ▸ Grade Point Average of Enrolled Freshmen (4.0 Scale) | **BarGraph**, untitled, 6–7 buckets (`4.00 and Above` … `2.00 - 2.49`, UGA adds `3.50 - 3.74`) | `class_profile.gpa_distribution` | distribution | getting-in |
| YGSPAL | ″ ▸ SAT Scores of Enrolled Freshmen | **BarGraph** ×2 titled `"SAT Math: <range>"` / `"SAT EBRW: <range>"`, 6 fixed buckets | `class_profile.sat_math_distribution` / `…sat_ebrw_distribution` + `_p25/_p75/_avg` from the title | distribution + int | getting-in |
| YGSPAL | ″ ▸ ACT Scores of Enrolled Freshmen | **BarGraph** ×3, titles `"<range>"` / `"<n> average , <range>"` / `"Not reported"` / `"ACT Math: …"` / `"ACT Eng: …"` | `class_profile.act_composite/_math/_english_distribution` + scalars | distribution + int | getting-in |
| YG AL | ″ ▸ Other Qualifications of Enrolled Freshmen | High School Class Rank (3 labelled pairs) | `class_profile.class_rank_top_tenth/_quarter/_half` | percent ×3 | getting-in |
| YG AL | ″ | National Merit Scholar · Valedictorian · Class President · Student Government Officer | `class_profile.national_merit_count` etc. | count | getting-in |

#### §3 — `money-matters` tab (3 sections + the header, E-B4)

| Seen | Section ▸ divider | Label | `fact_key` | Type | Section |
|---|---|---|---|---|---|
| YG AL | Applying For Financial Aid | **TitleLink** Website | `money.financial_aid_url` | url | money |
| YG AL | ″ | **TitleLink** Net Price Calculator | `money.net_price_calculator_url` | url | money |
| G L | ″ | Email | `money.financial_aid_email` | text | money |
| YGSAL | ″ ▸ Application Process | Application Deadline | `deadlines.financial_aid` | date | applying + money |
| YGSAL | ″ | Award Notification | `deadlines.aid_award_notification` | date/compound | money |
| YGSAL | ″ | High School Program *(duplicate of the admission row — same key, dedupe)* | `admissions.hs_program_requirement` | enum | getting-in |
| YGSAL | ″ | Methodology For Awarding Institutional Aid | `aid.need_analysis_methodology` | enum | money |
| YGSAL | ″ | **LabeledTable** `Forms Required` × `['Cost']`: `FAFSA Code is NNNNNN` · `CSS/Financial Aid Profile` · *(others)* | `money.fafsa_code` (from the label), `money.css_profile_required` (bool), `money.css_profile_fee` (text) | text/bool/money | money |
| YGSAL | Profile of *[YYYY-YY]* Financial Aid ▸ Freshman **and** ▸ All Undergraduates *(every row appears twice — store a `population` dimension in the key suffix)* | Financial Aid Applicants · Found to Have Financial Need · Received Financial Aid · Need Fully Met · Average Percent of Need Met | `aid.applicants_<pop>` / `aid.need_found_<pop>` / `aid.received_<pop>` / `aid.need_fully_met_<pop>` / `aid.avg_percent_need_met_<pop>`, `<pop> ∈ {freshman, all_undergraduates}` | count+percent / percent | money |
| YGSAL | ″ | **NestedTitleValue** Average Award ▸ Need-Based Gift / Need-Based Self-Help | `aid.avg_award_<pop>`, `aid.need_gift_recipients_<pop>`, `aid.need_gift_avg_<pop>`, `aid.need_selfhelp_*` | money/count/percent | money |
| YGSAL | ″ | Merit-Based Gift *(arity varies — E-M10)* | `aid.merit_to_need_recipients_<pop>` / `aid.merit_no_need_recipients_<pop>` + `_avg` | count/percent/money | money |
| YGSAL | ″ | *YYYY* Graduates Who Took Out Loans | `outcomes.graduates_with_loans_pct` (+ `reported_period`) | percent | outcomes |
| YGSAL | ″ | **NestedTitleValue** Average Indebtedness of *YYYY* Graduates | `outcomes.average_indebtedness` (+ `reported_period`) | money | outcomes |
| YGSAL | Financial Aid Programs ▸ Loans | Federal Loans · Other Loans · *(G,L)* State Loans | `aid.federal_loan_programs` / `aid.other_loan_programs` / `aid.state_loan_programs` | list | money |
| YGSAL | ″ ▸ Scholarships and Grants | Need-Based Available · Non-Need-Based Available | `aid.need_based_programs` / `aid.non_need_programs` | list | money |
| YGSAL | ″ ▸ Non-Need Awards | **NestedTitleValue** ×4: Academic Interest/Achievement · Creative Arts/Performance · Special Achievements/Activities · Special Characteristics — each ▸ Number of Awards | `aid.non_need_<area>_areas` (list) + `aid.non_need_<area>_count` | list + count | money |
| YGSAL | ″ ▸ Employment | Work-Study Programs · Average Earnings from On-Campus Employment | `aid.work_study_programs` / `aid.on_campus_employment_avg` | enum / money | money |

#### §4 — `academics` tab (7 sections + `headerCardContent`)

| Seen | Section | Label | `fact_key` | Type | Section |
|---|---|---|---|---|---|
| YGSPAL | *(headerCard)* ▸ General Information | Academic Calendar System · Summer Session | `academics.calendar` / `academics.summer_session` | enum | academics |
| YGSPAL | Undergraduate Education | **SubscreenNavigator** Undergraduate Majors (`"View All Majors (90)"`, full array inline) | `academics.undergraduate_majors` + `…_count` | list + count | academics |
| YGSPAL | ″ | Most Popular Disciplines | `academics.popular_disciplines` | list | academics |
| YGSPAL | ″ | Combined Liberal Arts/Professional Degree Programs | `academics.combined_degree_programs` | enum/list | academics |
| YGSPAL | ″ | Special Programs (up to 10 flags) | `academics.special_programs` | list | academics |
| YGSPAL | ″ | Study Abroad · Online Degrees | `academics.study_abroad` / `academics.online_degrees` | enum | academics |
| YGSPAL | Curriculum and Graduation Requirements | General Education/Core Curriculum · Computer · Foreign Language · Math/Science | `academics.required_coursework_*` | enum | academics |
| YGSPAL | Faculty and Instruction | Full-Time Faculty · Part-Time Faculty · Full-Time Faculty with Ph.D./Terminal Degree | `faculty.full_time_count` / `…part_time_count` / `…terminal_degree_pct` | int / percent | academics |
| YGSPAL | ″ | Regular Class Size — **`BarGraph` for Y/G/L, `TitleValue` for S/P/A** (E-B3) | `class_size.regular_distribution` | distribution | academics |
| GSPAL | ″ | Discussion Section/Lab Class Size — same dual shape | `class_size.subsection_distribution` | distribution | academics |
| YGSPAL | Advanced Placement | International Baccalaureate · Sophomore Standing · *(G,S,P,A,L)* Advanced Placement (AP) Examinations | `academics.ib_policy` / `academics.sophomore_standing` / `academics.ap_policy` | enum | academics |
| YGSPAL | Academic Resources | Library Available on Campus · *(G,S,P,A,L)* Holdings · Computer Ownership · Computers Available on Campus | `academics.library_on_campus` / `academics.library_holdings` / `academics.computer_ownership` / `academics.computers_available` | bool/int/enum | academics |
| YGSPAL | Academic Support Services | Tutoring · *(G,S,P,A,L)* Remedial Instruction · Services for Learning Disabled Students · Services for Physically Disabled Students | `academics.support_*` | enum / list | academics |
| YG PAL | Graduate/Professional School Education | Master's Degrees Offered · **SubscreenNavigator** Master's Programs of Study · Doctoral Degrees Offered · **SubscreenNavigator** Doctoral Programs of Study | `academics.masters_degrees` / `…masters_programs`(+`_count`) / `…doctoral_degrees` / `…doctoral_programs`(+`_count`) | list + count | academics |

#### §5 — `campus-life` tab (5 sections)

| Seen | Section ▸ divider | Label | `fact_key` | Type | Section |
|---|---|---|---|---|---|
| YGSPAL | Location and Setting | *&lt;City&gt;* Population *(city is a capture, not part of the key — E-B3)* | `campus.city_population` | int | campus-life |
| YGSPAL | ″ | Nearest Metropolitan Area | `campus.nearest_metro` | text | campus-life |
| YG AL | ″ | Campus Size | `campus.campus_acres` | int (`acres`) | campus-life |
| YGSPAL | ″ ▸ Getting Around | **TitleLink** Campus Map | `campus.campus_map_url` | url | campus-life |
| YGSPAL | ″ | Nearest Bus Station · Nearest Train Station | `campus.nearest_bus_station` / `…train_station` | text + distance | campus-life |
| YGSPAL | Housing | College Housing | `campus.housing_offered` | enum | campus-life |
| YG AL | ″ | Types of Housing | `campus.housing_types` | list | campus-life |
| GPAL | ″ | Freshman Housing Guarantee | `campus.freshman_housing_guarantee` | enum | campus-life |
| YG AL | ″ | Students in College Housing · Students Living Off Campus/Commuting | `campus.students_in_housing_pct` / `campus.students_off_campus_pct` | percent | campus-life |
| YG AL | ″ | Off-Campus Housing Assistance | `campus.off_campus_housing_assistance` | enum | campus-life |
| YGSPAL | Security | 24-Hour Emergency Phone/Alarm Devices · 24-Hour Security Patrols · Late-Night Transport/Escort Services · Electronically Operated Housing Entrances | `campus.security_*` | bool ×4 | campus-life |
| YGSPAL | Personal Support Services | Health Service · Personal Counseling · Child Care | `campus.health_service` / `campus.personal_counseling` / `campus.child_care` | enum | campus-life |
| YG AL | Sports & Recreation | Mascot · School Colors | `campus.mascot` / `campus.school_colors` | text | campus-life |
| G S | ″ | Athletic Conferences | `campus.athletic_conferences` | text/list | campus-life |
| YG AL | ″ ▸ Intercollegiate Sports & Scholarships | **IconTable** 4 cols, 13–35 rows | `campus.varsity_sports` | table | campus-life |
| G | ″ ▸ Club Sports | **IconTable** 2 cols, 17 rows | `campus.club_sports` | table | campus-life |
| G | ″ ▸ Club Sports | Intramural Sports | `campus.intramural_sports` | list | campus-life |

#### §6 — `students` tab (4 sections)

| Seen | Section | Label | `fact_key` | Type | Section |
|---|---|---|---|---|---|
| YGSPAL | Student Activities | Activities and Organizations | `campus.activities` | list | campus-life |
| YGSPAL | ″ | Sororities · Fraternities *(value is `"36% of women participate"` or `"Not reported"`)* | `campus.sorority_participation_pct` / `campus.fraternity_participation_pct` | percent | campus-life |
| YGSPAL | ″ | ROTC | `campus.rotc` | list (branch + on/off campus) | campus-life |
| YGSPAL | Student Body | Coeducational | `identity.coeducational` | bool | campus-life |
| YGSPAL | ″ | **NestedTitleValue** All Undergraduates ▸ Women / Men | `students.undergraduate_total`, `students.undergraduate_women_count/_pct`, `…men_count/_pct` | count + percent | campus-life |
| YGSPAL | ″ | Full-Time Undergraduates | `students.undergraduate_full_time` | count | campus-life |
| YGSPAL | ″ | **BarGraph** Ethnicity of Students from U.S. (8 fixed buckets) | `students.ethnicity_distribution` | distribution | campus-life |
| YGSPAL | ″ | International Students | `students.international_pct` (+ `students.countries_represented`) | percent + count | campus-life |
| YGSPAL | ″ | Average Age | `students.average_age` | int | campus-life |
| YGSPAL | ″ | All Graduate Students | `students.graduate_total` | count | campus-life |
| YGSPAL | Undergraduate Retention & Graduation | First-Year Students Returning | `outcomes.retention_first_year` | percent | outcomes |
| YGSPAL | ″ | Students Graduating Within 4 / 5 / 6 Years | `outcomes.graduation_rate_4y/_5y/_6y` | percent ×3 | outcomes |
| YGSPAL | After Graduation | Graduates Offered Full-Time Employment Within 6 Months · Average Starting Salary · Graduates Pursuing Advanced Study Directly · Disciplines Pursued | `outcomes.employed_within_6_months` / `outcomes.average_starting_salary` / `outcomes.advanced_study_pct` / `outcomes.disciplines_pursued` | percent / money / list | outcomes |

#### Labels present in the JSON but **missing from `plans/school-data-field-catalog.md`**

| Label | Where | Note |
|---|---|---|
| `Athletic Conferences` | campus-life + overview, UGA & Santa Monica | catalog §2 says "rendered only for UGA and coarser — dropped"; it is present on ≥2 of 6 captures and is the only athletics signal CollegeData gives. Keep it. |
| `Holdings` (library volumes) | academics ▸ Academic Resources | catalog §8 has `library_holdings_n` but marks the section "capture truncated"; confirmed present on 5/6. |
| `Remedial Instruction` | academics ▸ Academic Support Services | catalog §8 lists it; confirmed present on 5/6. |
| `Advanced Placement (AP) Examinations` | academics ▸ Advanced Placement | catalog §8 has `ap_policy` but sourced it from a section it marked truncated. |
| `Discussion Section/Lab Class Size` | academics ▸ Faculty and Instruction | **not in the catalog at all**; it is the CDS I3 subsection distribution (the FE already has a `subsection-sizes` group). |
| `Essay or Personal Statement`, `Letters of Recommendation`, `Other` | admission ▸ Other Application Requirements | catalog §4 lists them as present; they are absent from Yale, so the catalog's "rows absent for some schools" note is right — flagged here so the fixture set covers them. |
| `Early Decision Deadline` | admission ▸ Early Admission | in the catalog; absent from Yale (no ED), present on Spelman. |
| `State Loans` | money-matters ▸ Loans | **not in the catalog** (`federal_loans[]`/`other_loans[]` only). |
| `Email` (financial aid office) | money-matters ▸ Applying For Financial Aid | **not in the catalog**. |
| `Intramural Sports` | campus-life ▸ Club Sports | catalog §10 has `intramural_sports[]`; confirmed. |
| `Club Sports` **IconTable** | campus-life | catalog §10 models `club_sports[]` as a list; it is a 2-column IconTable. |
| `History`, `Academic Electives` | admission ▸ HS Units table | catalog §4's subject set is `{english, math, science, foreign_language, social_studies, electives}` — add `history`. |
| the 39 profile-header keys | all tabs | catalog §2/§6 covers some; the plan does not (E-B4). |

#### Catalog rows **not** seen in any capture (Yale or the five diverse schools)

`sat_submitted_pct` / `act_submitted_pct` · `net_price_*` · `residency_dist.*` (in-state /
out-of-state / international split) · `student_faculty_ratio` (as a published ratio) ·
`early_decision_admit_rate_pct` · `accepts_coalition_app` · `housing_usd` / `meal_plan_usd` split ·
`athletic_division` · `pell_recipients_pct` · `earnings_*` · `loan_default_rate_pct` ·
`cost_per_credit_*` · `tuition_guarantee_plan`. The catalog §16 gap analysis already marks these as
CollegeData-absent; this pass confirms all of them on six schools including a community college and
a for-profit. **The plan's §5 filter list contradicts §16 on four of them (E-M5).**

### Appendix iii — Proposed `config/facts/sections.yaml`

Today's groups (from `frontend/src/features/schools/facts/school-facts-sections.ts`, 719 lines —
6 sections, **27 groups**) are:

| Section | Groups today |
|---|---|
| `getting-in` | selection-factors · test-detail · required-units · class-rank · waitlist · applicant-pool |
| `money` | aid-coverage · cost-itemized · cost-living · cost-escalation · need-based-aid · merit-aid · international-aid · forms-deadlines |
| `academics` | degree-shares · class-sizes · subsection-sizes · special-study · core-curriculum · faculty-detail |
| `campus-life` | composition · greek-life · who-is-here · rotc |
| `outcomes` | time-to-degree · completion-gap |
| `applying` | decision-notification · other-terms · deposits |

**19 of the 27 survive with the same id and title.** Dropped for want of any CollegeData field:
`cost-living` (living-at-home / off-campus amounts), `cost-escalation` (tuition guarantee,
per-credit charge), `international-aid` (H6 nonresident aid), `degree-shares` (IPEDS completions),
`completion-gap` (Pell ratio), `deposits` (housing deposit). Added: `admissions-funnel-rates`,
`admission-requirements`, `costs` (the header block, E-B4), `aid-programs`, `graduate-education`,
`location`, `housing`, `safety-and-support`, `sports`, `activities`, `student-body`,
`after-graduation`, `deadlines` (a **first-class block** per §5).

```yaml
# config/facts/sections.yaml   —  layout only; never asserts what exists.
# Every key listed here renders "Not reported" when absent (E-M13).
# Anything the mapper emits that is not listed lands in that section's
# "other" group, rendered as "Other published values" (E-M8).
version: 1

sections:
  - id: getting-in
    title: Getting in
    headline: [admissions.admit_rate, admissions.entrance_difficulty,
               class_profile.sat_math_p25, class_profile.sat_math_p75,
               class_profile.sat_ebrw_p25, class_profile.sat_ebrw_p75,
               class_profile.act_composite_p25, class_profile.act_composite_p75,
               class_profile.average_gpa]
    groups:
      - id: applicant-pool
        title: Applicant pool
        chart: {kind: bars, unit: count, max: admissions.applicants_total}
        facts: [admissions.applicants_total, admissions.admitted_total, admissions.enrolled_total,
                admissions.yield_rate,
                admissions.applicants_total_women, admissions.admitted_total_women,
                admissions.admit_rate_women, admissions.enrolled_total_women, admissions.yield_rate_women,
                admissions.applicants_total_men, admissions.admitted_total_men,
                admissions.admit_rate_men, admissions.enrolled_total_men, admissions.yield_rate_men]
      - id: test-detail
        title: Test scores in detail
        caveat: >-
          CollegeData does not publish how many of the class submitted a score. A middle-50 band
          describes the students who did.
        chart: {kind: distribution, refs: [class_profile.sat_math_distribution,
                                           class_profile.sat_ebrw_distribution,
                                           class_profile.act_composite_distribution,
                                           class_profile.act_math_distribution,
                                           class_profile.act_english_distribution]}
        facts: [class_profile.sat_math_p25, class_profile.sat_math_p75, class_profile.sat_math_avg,
                class_profile.sat_ebrw_p25, class_profile.sat_ebrw_p75, class_profile.sat_ebrw_avg,
                class_profile.act_composite_p25, class_profile.act_composite_p75, class_profile.act_composite_avg,
                class_profile.act_math_avg, class_profile.act_english_avg]
      - id: gpa-and-rank            # was "class-rank"; GPA distribution joins it
        title: GPA and class rank
        caveat: >-
          Rank bands overlap — the top tenth is inside the top quarter. They cannot be added.
        chart: {kind: distribution, refs: [class_profile.gpa_distribution]}
        facts: [class_profile.average_gpa, class_profile.gpa_distribution,
                class_profile.class_rank_top_tenth, class_profile.class_rank_top_quarter,
                class_profile.class_rank_top_half,
                class_profile.national_merit_count, class_profile.valedictorian_count,
                class_profile.class_president_count, class_profile.student_government_count]
      - id: selection-factors
        title: How they weigh your file
        caveat: What the school says it weighs, not a measurement of what it did.
        chart: {kind: ordinal, levels: [not_considered, considered, important, very_important]}
        facts: [admissions.selection_factor_rigor_of_secondary_school_record,
                admissions.selection_factor_academic_gpa,
                admissions.selection_factor_standardized_tests,
                admissions.selection_factor_class_rank,
                admissions.selection_factor_recommendations,
                admissions.selection_factor_essay,
                admissions.selection_factor_interview,
                admissions.selection_factor_level_of_applicants_interest,
                admissions.selection_factor_extracurricular_activities,
                admissions.selection_factor_volunteer_work,
                admissions.selection_factor_particular_talent_ability,
                admissions.selection_factor_character_personal_qualities,
                admissions.selection_factor_first_generation_to_attend_college,
                admissions.selection_factor_state_residency,
                admissions.selection_factor_geographic_residence,
                admissions.selection_factor_relation_with_alumnus,
                admissions.selection_factor_religious_affiliation_commitment,
                admissions.selection_factor_work_experience]
      - id: admission-requirements     # new: the "Other Application Requirements" block
        title: What they require
        facts: [admissions.interview_requirement, admissions.essay_requirement,
                admissions.recommendations_requirement, admissions.other_requirement,
                admissions.need_blind,
                admissions.test_policy_sat_or_act, admissions.test_policy_sat_only,
                admissions.test_policy_act_only, admissions.test_policy_act_writing_test_policy,
                admissions.test_policy_sat_subject_tests_only,
                admissions.test_policy_sat_and_sat_subject_tests_or_act]
      - id: required-units
        title: Required high-school units
        caveat: Schools often recommend more than they require. The recommendation is the real expectation.
        facts: [admissions.hs_graduation_requirement, admissions.hs_program_requirement,
                admissions.units_required_english,        admissions.units_recommended_english,
                admissions.units_required_mathematics,    admissions.units_recommended_mathematics,
                admissions.units_required_science,        admissions.units_recommended_science,
                admissions.units_required_social_studies, admissions.units_recommended_social_studies,
                admissions.units_required_history,        admissions.units_recommended_history,
                admissions.units_required_foreign_language, admissions.units_recommended_foreign_language,
                admissions.units_required_academic_electives, admissions.units_recommended_academic_electives]
      - id: waitlist
        title: Waitlist
        caveat: Waitlist numbers swing widely year to year. Read them as context, not as odds.
        chart: {kind: bars, unit: count, max: admissions.waitlist_offered}
        facts: [admissions.waitlist_used, admissions.waitlist_offered,
                admissions.waitlist_accepted, admissions.waitlist_admitted]
      - id: other
        title: Other published values

  - id: money
    title: Money
    headline: [costs.attendance_in_state, costs.attendance_out_of_state,
               costs.tuition_fees_in_state, costs.tuition_fees_out_of_state,
               aid.avg_percent_need_met_all_undergraduates, aid.avg_award_freshman]
    groups:
      - id: cost-itemized
        title: Cost of attendance, itemized
        facts: [costs.attendance_in_state, costs.attendance_out_of_state,
                costs.tuition_fees_in_state, costs.tuition_fees_out_of_state,
                costs.room_and_board, costs.books_and_supplies, costs.other_expenses,
                costs.payment_plans]
      - id: aid-coverage
        title: How far the aid goes
        chart: {kind: bars, unit: percent}
        facts: [aid.applicants_freshman, aid.need_found_freshman, aid.received_freshman,
                aid.need_fully_met_freshman, aid.avg_percent_need_met_freshman,
                aid.applicants_all_undergraduates, aid.need_found_all_undergraduates,
                aid.received_all_undergraduates, aid.need_fully_met_all_undergraduates,
                aid.avg_percent_need_met_all_undergraduates]
      - id: need-based-aid
        title: Need-based aid
        facts: [aid.avg_award_freshman, aid.need_gift_recipients_freshman, aid.need_gift_avg_freshman,
                aid.need_selfhelp_recipients_freshman, aid.need_selfhelp_avg_freshman,
                aid.avg_award_all_undergraduates, aid.need_gift_recipients_all_undergraduates,
                aid.need_gift_avg_all_undergraduates, aid.need_selfhelp_recipients_all_undergraduates,
                aid.need_selfhelp_avg_all_undergraduates]
      - id: merit-aid
        title: Merit aid
        facts: [aid.merit_to_need_recipients_freshman, aid.merit_to_need_avg_freshman,
                aid.merit_no_need_recipients_freshman, aid.merit_no_need_avg_freshman,
                aid.merit_to_need_recipients_all_undergraduates, aid.merit_to_need_avg_all_undergraduates,
                aid.merit_no_need_recipients_all_undergraduates, aid.merit_no_need_avg_all_undergraduates,
                aid.non_need_academic_areas, aid.non_need_academic_count,
                aid.non_need_creative_arts_areas, aid.non_need_creative_arts_count,
                aid.non_need_special_achievements_areas, aid.non_need_special_achievements_count,
                aid.non_need_special_characteristics_areas, aid.non_need_special_characteristics_count]
      - id: aid-programs
        title: Aid programs offered
        facts: [aid.federal_loan_programs, aid.state_loan_programs, aid.other_loan_programs,
                aid.need_based_programs, aid.non_need_programs,
                aid.work_study_programs, aid.on_campus_employment_avg]
      - id: forms-deadlines
        title: Forms and deadlines
        facts: [aid.need_analysis_methodology, money.fafsa_code,
                money.css_profile_required, money.css_profile_fee,
                deadlines.financial_aid, deadlines.aid_award_notification,
                money.financial_aid_url, money.net_price_calculator_url, money.financial_aid_email]
      - id: other
        title: Other published values

  - id: academics
    title: Academics
    headline: [academics.calendar, faculty.full_time_count, faculty.terminal_degree_pct,
               academics.undergraduate_majors_count]
    groups:
      - id: majors
        title: What you can study
        facts: [academics.undergraduate_majors_count, academics.undergraduate_majors,
                academics.popular_disciplines, academics.combined_degree_programs]
      - id: class-sizes
        title: Class sizes
        chart: {kind: distribution, refs: [class_size.regular_distribution]}
        facts: [class_size.regular_distribution]
      - id: subsection-sizes
        title: Subsections — labs, discussions, recitations
        chart: {kind: distribution, refs: [class_size.subsection_distribution]}
        facts: [class_size.subsection_distribution]
      - id: faculty-detail
        title: Faculty
        facts: [faculty.full_time_count, faculty.part_time_count, faculty.terminal_degree_pct]
      - id: special-study
        title: Special study options
        facts: [academics.special_programs, academics.study_abroad, academics.online_degrees]
      - id: core-curriculum
        title: Core curriculum
        facts: [academics.required_coursework_general_education,
                academics.required_coursework_computer,
                academics.required_coursework_foreign_language,
                academics.required_coursework_math_science]
      - id: credit-and-support
        title: Credit, resources and support
        facts: [academics.ap_policy, academics.ib_policy, academics.sophomore_standing,
                academics.library_on_campus, academics.library_holdings,
                academics.computer_ownership, academics.computers_available,
                academics.support_tutoring, academics.support_remedial_instruction,
                academics.support_learning_disabled, academics.support_physically_disabled]
      - id: graduate-education
        title: Graduate and professional programs
        facts: [academics.masters_degrees, academics.masters_programs_count, academics.masters_programs,
                academics.doctoral_degrees, academics.doctoral_programs_count, academics.doctoral_programs]
      - id: other
        title: Other published values

  - id: campus-life
    title: Campus life
    headline: [students.undergraduate_total, students.graduate_total,
               campus.students_in_housing_pct, students.international_pct]
    groups:
      - id: student-body
        title: Who's here
        chart: {kind: distribution, refs: [students.ethnicity_distribution]}
        caveat: >-
          The ethnicity distribution covers students from the U.S. only; international students
          are counted separately and the two do not sum to 100%.
        facts: [students.undergraduate_total, students.undergraduate_full_time,
                students.undergraduate_women_count, students.undergraduate_women_pct,
                students.undergraduate_men_count, students.undergraduate_men_pct,
                students.graduate_total, students.ethnicity_distribution,
                students.international_pct, students.countries_represented,
                students.average_age,
                identity.coeducational, identity.gender_model_reported, identity.control_reported]
      - id: housing
        title: Housing
        facts: [campus.housing_offered, campus.freshman_housing_guarantee, campus.housing_types,
                campus.students_in_housing_pct, campus.students_off_campus_pct,
                campus.off_campus_housing_assistance]
      - id: greek-life
        title: Greek life
        facts: [campus.fraternity_participation_pct, campus.sorority_participation_pct]
      - id: activities
        title: Activities and organizations
        facts: [campus.activities, campus.rotc]
      - id: sports
        title: Sports
        facts: [campus.athletic_conferences, campus.mascot, campus.school_colors,
                campus.varsity_sports, campus.club_sports, campus.intramural_sports]
      - id: location
        title: Location and getting around
        facts: [campus.city_population, campus.nearest_metro, campus.campus_acres,
                campus.nearest_bus_station, campus.nearest_train_station, campus.campus_map_url,
                campus.avg_january_temp, campus.avg_september_temp, campus.annual_rainfall]
      - id: safety-and-support
        title: Safety and personal support
        facts: [campus.security_emergency_phones, campus.security_patrols_24h,
                campus.security_late_night_transport, campus.security_electronic_entrances,
                campus.health_service, campus.personal_counseling, campus.child_care]
      - id: other
        title: Other published values

  - id: outcomes
    title: Outcomes
    headline: [outcomes.retention_first_year, outcomes.graduation_rate_4y, outcomes.graduation_rate_6y]
    groups:
      - id: time-to-degree
        title: Time to degree
        chart: {kind: bars, unit: percent}
        facts: [outcomes.retention_first_year, outcomes.graduation_rate_4y,
                outcomes.graduation_rate_5y, outcomes.graduation_rate_6y]
      - id: debt
        title: Debt at graduation
        facts: [outcomes.graduates_with_loans_pct, outcomes.average_indebtedness]
      - id: after-graduation
        title: After graduation
        caveat: >-
          Employment and advanced-study figures are self-reported by the school and are missing
          for most schools.
        facts: [outcomes.employed_within_6_months, outcomes.average_starting_salary,
                outcomes.advanced_study_pct, outcomes.disciplines_pursued]
      - id: other
        title: Other published values

  - id: applying
    title: Applying
    headline: [deadlines.regular, admissions.early_decision_offered, admissions.early_action_offered,
               applying.application_fee]
    groups:
      - id: deadlines            # the first-class deadline block required by §5
        title: Deadlines
        caveat: >-
          Only the regular deadline carries a year on CollegeData; the rest are month-and-day and
          are resolved against that cycle.
        facts: [deadlines.regular, admissions.regular_deadline_is_rolling,
                deadlines.early_decision, deadlines.early_action,
                deadlines.financial_aid, deadlines.test_due_sat_or_act]
      - id: decision-notification
        title: Decision notification
        facts: [deadlines.regular_notification, deadlines.early_action_notification,
                deadlines.aid_award_notification, deadlines.reply_by]
      - id: rounds-offered
        title: Rounds offered
        facts: [admissions.early_decision_offered, admissions.early_action_offered,
                admissions.waitlist_used]
      - id: how-to-apply
        title: How to apply
        facts: [applying.accepts_common_app, applying.electronic_application_url,
                applying.application_fee, applying.application_fee_waiver,
                applying.deferred_enrollment, applying.transfer_accepted]
      - id: contact
        title: Admissions office
        facts: [applying.admissions_address, applying.admissions_phone,
                applying.admissions_fax, applying.admissions_email]
      - id: other
        title: Other published values
```

**Labels that fit no section, and what to do with them.** After this layout, the only leftovers are
(a) genuine identity fields — `identity.website`, `identity.description`, `identity.address` —
which belong in the page's identity strip, not in a section, and (b) any label CollegeData adds
later. **"other" as a seventh *section* is the wrong answer** (E-M8): a page with a seventh
untitled section reads as a bug, and `SectionId` has no such value. **"other" as the last *group*
of the natural section is the right answer**, and the renderer already has it
(`OTHER_GROUP_TITLE = "Other published values"`). The section for an unmapped label is derived from
its tab, deterministically: `overview → (skip)`, `admission → getting-in`,
`money-matters → money`, `academics → academics`, `campus-life → campus-life`,
`students → campus-life` **except** the `Undergraduate Retention & Graduation` and
`After Graduation` sections, which go to `outcomes`. No section change is needed to hold 100% of
the inventory.

### Appendix iv — `school_explore_rows` columns

One row per school, upserted by the mapper inside that school's facts transaction (§2/§3).
`P` = projected from `schools.basic_profile` (IPEDS), `F` = from `school_facts`,
`C` = computed by the mapper. **Every column is nullable and null is a first-class render path
(never 0)** — the rule `explore-types.ts:1-13` already states.

| Column | Type | Src | Source `fact_key` / `basic_profile` path | Null semantics |
|---|---|---|---|---|
| `school_id` | int PK | — | `schools.id` | — |
| `name`, `city`, `state` | text | P | `schools.name` / `basic_profile.location.{city,state}` | never null |
| `website_url` | text | P | `schools.official_website` | null → no link |
| `region` | text | P | `basic_profile.location.region` (IPEDS OBEREG) | never null in the seed |
| `locale` | text | P | `basic_profile.location.locale` | rarely null |
| `control` | enum(`public`,`private`,`private_for_profit`) | P | `basic_profile.classification.control`, refined by `identity.control_reported` when it says for-profit | never null |
| `institution_level` | text | P | `basic_profile.classification.institution_level` | — |
| `hbcu`,`hsi`,`tribal`,`land_grant`,`women_only`,`men_only` | bool | P | `basic_profile.identity_and_mission.*` | never null |
| `religious_affiliation` | text | P | same | null = none |
| `gender_model` | enum(`coed`,`women`,`men`) | P+F | `identity_and_mission.{women_only,men_only}`, cross-checked against `identity.gender_model_reported` | never null |
| `undergraduates` | int | F | `students.undergraduate_total` | null → excluded from a size filter unless `includeMissing` |
| `graduate_students` | int | F | `students.graduate_total` | null |
| `size_bucket` | enum(`lt2k`,`2k-10k`,`10k-25k`,`gt25k`) | C | from `undergraduates`; fall back to `basic_profile.classification.institution_size` when null | null only if both are null |
| `admit_rate` | numeric | F | `admissions.admit_rate` | null = not published (Santa Monica, Phoenix: `"Not reported"`) |
| `admit_rate_women`, `admit_rate_men` | numeric | F | `admissions.admit_rate_women/_men` | null |
| `applicants_total`, `admitted_total`, `enrolled_total`, `yield_rate` | int/num | F | `admissions.*` | null |
| `entrance_difficulty` | enum(5) | F | `admissions.entrance_difficulty` | null |
| `test_policy` | enum(`required`,`considered`,`not_required`,`not_reported`) | F | `admissions.test_policy_sat_or_act` | **`not_reported` is a value, not null** — the "test optional" filter must not treat a missing row as optional |
| `sat_math_p25/p75`, `sat_ebrw_p25/p75` | int | F | `class_profile.*` | null |
| `act_composite_p25/p75`, `act_composite_avg` | int | F | `class_profile.*` | null |
| `sat_total_p25/p75` | int | C | `sat_math_* + sat_ebrw_*` — **flag as computed**; CollegeData never prints a composite | null if either half is null |
| `gpa_avg` | numeric | F | `class_profile.average_gpa` | null |
| `class_rank_top_tenth` | numeric | F | `class_profile.class_rank_top_tenth` | null |
| `cost_attendance_in_state`, `cost_attendance_out_of_state` | int | F | `costs.attendance_in_state/_out_of_state` | null |
| `tuition_in_state`, `tuition_out_of_state` | int | F | `costs.tuition_fees_*` | null |
| `room_and_board`, `books_and_supplies`, `other_expenses` | int | F | `costs.*` | null |
| `need_met_pct` | numeric | F | `aid.avg_percent_need_met_all_undergraduates` | null |
| `need_fully_met_pct` | numeric | C | `aid.need_fully_met_all_undergraduates` ÷ `aid.received_all_undergraduates` — derived, never the printed average (today's trap 3) | null |
| `merit_aid_pct` | numeric | F | `aid.merit_no_need_recipients_all_undergraduates` (pct part) | null |
| `avg_award` | int | F | `aid.avg_award_all_undergraduates` | null |
| `avg_indebtedness` | int | F | `outcomes.average_indebtedness` | null |
| `graduates_with_loans_pct` | numeric | F | `outcomes.graduates_with_loans_pct` | null |
| `retention_pct` | numeric | F | `outcomes.retention_first_year` | null |
| `grad_rate_4y`, `grad_rate_5y`, `grad_rate_6y` | numeric | F | `outcomes.graduation_rate_*` | null |
| `students_per_faculty` | numeric | C | `students.undergraduate_full_time ÷ faculty.full_time_count` — **computed, labelled as such (E-M5)**; not the IPEDS ratio | null if either is null |
| `faculty_full_time`, `faculty_part_time`, `faculty_terminal_pct` | int/num | F | `faculty.*` | null |
| `housing_pct` | numeric | F | `campus.students_in_housing_pct` | null |
| `housing_offered` | bool | F | `campus.housing_offered` | null |
| `greek_pct_men`, `greek_pct_women` | numeric | F | `campus.fraternity_participation_pct` / `…sorority_participation_pct` | null; `"Not reported"` → null but with `state = not_reported` in the API |
| `international_pct` | numeric | F | `students.international_pct` | null |
| `calendar` | enum | F | `academics.calendar` | null |
| `application_fee` | int | F | `applying.application_fee` | null ≠ 0 — the "fee = 0" filter must match `application_fee = 0` only |
| `application_fee_waiver` | bool | F | `applying.application_fee_waiver` | null |
| `accepts_common_app` | bool | F | `applying.accepts_common_app` | null |
| `offers_early_decision`, `offers_early_action` | bool | F | `admissions.early_decision_offered/_early_action_offered` | null |
| `is_rolling` | bool | F | `admissions.regular_deadline_is_rolling` | null |
| `deadline_regular` | date | F | `deadlines.regular` (`value_date`) | null when rolling — the "deadline before date" filter must use `includeMissing` semantics against `is_rolling` |
| `deadline_early_decision`, `deadline_early_action` | date | F | `deadlines.*` | null |
| `waitlist_used` | bool | F | `admissions.waitlist_used` | null |
| `majors` | text[] | F | `academics.undergraduate_majors` items | empty array ≠ null: `{}` = published an empty list, null = not published |
| `majors_count` | int | F | `academics.undergraduate_majors_count` | null |
| `sports_women`, `sports_men` | text[] | F | `campus.varsity_sports` rows where the gender flag is true | null |
| `special_programs` | text[] | F | `academics.special_programs` | null |
| `ethnicity_*_pct` (8 cols: `aian`,`asian`,`black`,`hispanic`,`multi`,`nhpi`,`white`,`unknown`) | numeric | F | `students.ethnicity_distribution` buckets | null per bucket — an omitted bucket is null, **never 0** |
| `facts_updated_at` | timestamptz | — | `max(school_facts.observed_at)` | never null once crawled |
| `fact_count` | int | — | count of current facts | — |
| `retired_at` | timestamptz | — | — | `school_explore` filters `IS NULL` |

**Sort columns** (§5 "sort by any numeric column"): `name`, `admit_rate`, `undergraduates`,
`cost_attendance_in_state`, `cost_attendance_out_of_state`, `tuition_in_state`,
`tuition_out_of_state`, `need_met_pct`, `merit_aid_pct`, `avg_indebtedness`, `retention_pct`,
`grad_rate_4y`, `grad_rate_6y`, `students_per_faculty`, `housing_pct`, `international_pct`,
`greek_pct_men`, `greek_pct_women`, `application_fee`, `deadline_regular`, `sat_total_p25`,
`act_composite_p25`, `gpa_avg`, `entrance_difficulty`, `facts_updated_at`.
Every sort needs `NULLS LAST` in both directions, and the response must say how many rows sorted
into the null tail — same accounting as `exclusions` (§6b).

**Columns dropped from §5 because no field exists (E-M5):** `admit_rate_in_state`,
`admit_rate_out_of_state`, `net_price`, `out_of_state_pct`, and the `REA` facet.

---

### Appendix v — Crosswalk, measured

**Setup.** 2,593 slugs from the live sitemap (`a-` + `b-sitemap`). 2,746 rows in
`cds_library.school_profiles` (read via `COUNSELLE_DB_PIPELINE_DSN`, read-only; `cds_library_app`
can `SELECT` it, `cds_library_reader` cannot use `pg_trgm` at all — E-M12, so trigram similarity
is a 6-line Python reimplementation of `show_trgm`, verified to reproduce pg_trgm's algorithm:
each word padded `"  word "`, 3-grams, `|A∩B| / |A∪B|`).

**Run A — name only** (what you get without an address; the bound if the crawl never fetched a
page). Script `work/crosswalk_slug.py`.

| Stage | Matched | Cumulative |
|---|---|---|
| exact normalized slug-name, nationally unique | 1,778 | 1,778 / 2,593 = **68.6%** |
| trigram ≥ 0.9, nationally unique, ≥0.02 clear of #2 | 76 | 1,854 / 2,593 = **71.5%** |
| **remainder** | | **739 (28.5%)** |
| distinct unitids claimed | 1,853 | → **893 unitids with no CollegeData slug at this stage** |
| one unitid claimed by two slugs | 1 (`The-New-School` / `The-New-School-for-Public-Engagement` → 193654) | |

**Run B — with the address from the per-school payload** (what the plan's design actually gets
once E-B1 is fixed and the crosswalk is built from `profile.address`). Measured on a **random
283-slug sample** of the sitemap; script `work/crosswalk_addr.py`.

| Stage | Matched | Cumulative | Projected on 2,593 |
|---|---|---|---|
| 1. exact normalized name + state | 201 | 201 / 283 = **71.0%** | ~1,842 |
| 2. exact name + state + city (disambiguates a multi-hit) | 0 in this sample (9 in the 149-row run) | 71.0% | — |
| 3. trigram ≥ 0.9 within state, ≥0.02 clear | 5 | 206 = **72.8%** | ~1,888 |
| 4. trigram ≥ 0.6 **and** same city or same zip5 | 20 | 226 = **79.9%** | ~2,071 |
| 5. same city/zip5 **and** token containment (stop-worded) | 18 | 244 = **86.2%** | ~2,235 |
| 6. same city/zip5, single candidate ≥ 0.45 | 4 | 248 = **87.6%** | ~2,272 |
| **remainder for subagent adjudication** | **35** | **12.4%** | **≈ 320** |

An intermediate run on 149 samples gave 87.9% / 12.1% — the estimate is stable.

**Answer to the plan's open question: the adjudication set is ≈ 300 rows, not 50 and not 800** —
and a meaningful share of those are legitimately unmatchable rather than hard (`American Islamic
College`, `Doral College`, `Patrick Henry College`, `Global University`, `Reformed University` have
no Title-IV IPEDS row in the seed at all). Budget one subagent pass over ~300 rows with a 3-candidate
shortlist each.

**20 unmatched samples with nearest same-state candidates** (from the 283-row run; the pattern is
overwhelmingly multi-campus systems that CollegeData splits and IPEDS merges, or the reverse):

| CollegeData row | Nearest candidates (unitid, name, city, trgm) |
|---|---|
| `Doral College` [Doral, FL] | 244233 City College-Hollywood (.44) · 447014 Daytona College (.43) |
| `Columbia College - South Carolina` [Columbia, SC] | 217934 **Columbia College** (Columbia) (.50) — correct, blocked by the " - South Carolina" suffix |
| `ECPI University` [Charlotte, NC] | 198516 Elon University (.60) — the real row is `ECPI University` in VA; NC is a branch |
| `Rasmussen University-Central Pasco` [Odessa, FL] | 138309 **Rasmussen University-Florida** (Ocala) (.49) — campus vs system |
| `Strayer University-South Raleigh Campus` [Raleigh, NC] | 199193 NC State (.41) — no Strayer NC row |
| `Strayer University-White Marsh Campus` [Baltimore, MD] | 430184 **Strayer University-Maryland** (.50) — campus vs system |
| `Strayer University - Birmingham` [Birmingham, AL] | 101365 Herzing-Birmingham (.60) — no Strayer AL row |
| `Strayer University-Teays Valley Campus` [Scott Depot, WV] | (system row is in DC) |
| `Calvin University - Handlon Campus` [Ionia, MI] | 169080 **Calvin University** (Grand Rapids) (.58) — prison-education branch |
| `University of Arizona South` [Sierra Vista, AZ] | 104179 **University of Arizona** (Tucson) (.79) — branch |
| `Reformed University` [Lawrenceville, GA] | 140872 Reinhardt (.46) — no IPEDS row |
| `Patrick Henry College` [Purcellville, VA] | 232308 Hollins (.32) — no IPEDS row in the seed |
| `Global University` [Springfield, MO] | 177214 Drury (Springfield) (.46) — no IPEDS row |
| `AMDA-American Musical and Dramatic Arts Academy-Los Angeles` | 188854 American Musical and Dramatic Academy (NY) (.67) — campus |
| `DeVry University-Chicago Loop Campus` [Chicago, IL] | 482477 **DeVry University-Illinois** (Lisle) (.64) — campus vs system |
| `Felbry College School of Nursing` [Columbus, OH] | 487861 **Felbry College** (Columbus) (.46) — name suffix |
| `Humphreys University` [Stockton, CA] | 115773 **Humphreys University-Stockton and Modesto Campuses** (.42) — resolved by stage 5 in the later run |
| `Culinary Institute of Virginia` [Norfolk, VA] | 234085 VMI (.55) — a division of ECPI, no own IPEDS row |
| `Southwestern Baptist Theological Seminary` [Fort Worth, TX] | 224712 Episcopal Theological Seminary of the Southwest (.56) — graduate-only, likely out of the seed's scope |
| `College of Staten Island (City University of New York)` [Staten Island, NY] | 190558 **College of Staten Island CUNY** (Staten Island) (.50) — resolved by stage 5 |
| `State University of New York College at Oneonta` [Oneonta, NY] | 196194 SUNY Oswego (.60), 196176 SUNY New Paltz (.60) — the correct SUNY Oneonta row loses to same-shaped siblings |

**Consequences for §4/§9.** (1) The matching design is sound but needs stages 4–6 written down,
not just "exact → trigram ≥0.9 → adjudication" — trigram ≥0.9 alone buys **1.8 percentage
points**. (2) The adjudicator's brief must cover the campus/system question explicitly, and §3's
`UNIQUE (school_id) WHERE retired_at IS NULL` forces a choice (E-S4). (3) R6's "~350 unitids
without a CollegeData page" should be revised to a measured 500–800 (E-S2).

---

### Appendix vi — Fixture school slugs

Yale alone is the least representative school on the site: it has no ED, no Greek data, no HS-units
table, no club-sports table, no state loans, no essay/recommendation rows, no summer session, and
its GPA distribution is entirely `-1`. The exit test "zero unmapped labels on the fixture captures"
is worth nothing against it alone. These slugs are verified present in the live sitemap and, where
marked ✔, already captured in `scratchpad/work/fixtures/`.

| Slug | Why it is in the set — what it breaks | Captured |
|---|---|---|
| `Yale-University` | the baseline; REA-only, no ED, all-`-1` GPA bars, 3-bucket class-size graph, `"Not reported"` Greek | ✔ |
| `University-of-Georgia` | large public: **in-state/out-of-state 2-arrays**, 7-bucket class-size and GPA graphs, HS-units table, both sports IconTables, `Athletic Conferences`, `State Loans`, `Intramural Sports`, `Academic Electives`, `Other` requirement | ✔ |
| `Santa-Monica-College` | community college: **`"Profile of  Financial Aid"` with no year**, no selection-factors table, no waitlist, no application fee, `Regular Class Size` as a `TitleValue` not a `BarGraph`, `Rolling, notification begins…` | ✔ |
| `University-of-Phoenix` | for-profit + online: `universityType = "Private for-profit"`, `admissionDeadline = "Rolling"` with `admissionDeadlineDate = null`, **no `money-matters` tab at all** (a real `not_found`, E-M11), 89,828 undergraduates | ✔ (5/6) |
| `School-of-the-Art-Institute-of-Chicago` | art school: portfolio-driven, ACT graph titled `"Not reported"`, EA with a `"Not reported"` notification, `Chicago Population` label capture | ✔ |
| `Spelman-College` | HBCU + women-only: `populationType = "Undergrad women only"`, `malePercentage = null`, **both ED and EA offered** (only capture with `Early Decision Deadline`), `History` HS-unit row, `Discussion Section/Lab Class Size` as a `BarGraph`, FAFSA code `001594` | ✔ |
| `Ohio-State-University` | very large public with branch campuses — the crosswalk campus/system case (E-S4) and the biggest sports/majors payloads | to capture |
| `Berea-College` | no-tuition model: `$0` cost lines, 100% need met, the "fee = 0 ≠ null" case | to capture |
| `United-States-Military-Academy` | service academy: no tuition, no aid section, unusual requirements | to capture |
| `Ohio-State-Universitity-at-Marion` | a slug/name **typo at source** (E-S3) | to capture |
| `Arizona-State-University-at-the-West-campus` | the multi-campus crosswalk case that stages 1–6 cannot resolve | to capture |
| `Wellesley-College` | second women-only, to prove the gender-model projection is not Spelman-specific | optional |

**Plan change:** §7 Phase 1's exit test becomes *"zero unmapped labels across the eleven fixture
captures listed in `tests/fixtures/collegedata/`"*, and §4 names the set. Store them as committed
fixtures (they are 3–12 KB each, ~66 files, well under any size concern) so the mapper test runs
offline in the routine suite.

---

## F — Tool signatures/docstrings, `query_database` allow-list + guard, `db` envelope, caveat trigger table, prompt/skill edits, eval disposition, ADR disposition

### Appendix i — the four v3 tool signatures and docstrings

In-process registration follows the existing pattern verbatim
(`app/toolset.py:216-238` for Tavily, `app/workspace/agent_tools*.py` for workspace): a
`_make_*_tool(...)` closure whose inner `async def` docstring **is** the model contract, piping
through `process_tool_result(payload, middleware, tool_name=…)` and returning
`Tool(fn, takes_ctx=False)`; appended to `extra_tools` at `app/agent_node.py:765-771`. Each also
needs a `config/assets/step_labels.yaml` row (plus the new "every mounted tool has a label row"
test §6a already calls for) and, if source-gated, an `app/tool_specs.py` entry.

```python
# counselle_db/models.py (new)
class SchoolFactsStatus(FrozenModel):
    facts_updated_at: datetime | None = None   # max(observed_at) over the school's live facts
    fact_count: int = 0
    has_collegedata: bool = False
    tabs: Mapping[str, str] = {}               # tab -> last_status

class ResolvedSchool(FrozenModel):
    status: Literal["match"] = "match"
    school: SchoolBasics
    data: SchoolFactsStatus                    # replaces `coverage: SchoolCoverage`

class FactRow(FrozenModel):
    key: str                 # "<domain>.<name>"
    label: str
    section: str
    display: str | None
    available: bool
    state: Literal["value", "not_reported", "not_collected", "not_fetched"]
    unit: str | None = None
    value: Any = None
    reported_period: str | None = None
    vintage: str             # code-owned; see F14
    caveat_kinds: tuple[str, ...] = ()

class FactsResult(FrozenModel):
    school: SchoolBasics
    facts_updated_at: datetime | None
    sections: tuple[str, ...]        # every section this school has, even when not requested
    rows: tuple[FactRow, ...]
    row_count: int
    truncated: bool                  # get_facts_max_rows hit
    summary: str                     # "48 of 63 getting-in facts reported; 2 sections not fetched"
```

**1. `resolve_school(query: str) -> dict`** — docstring moved from `server.py:109-127`, edited:

> Resolve a school name, abbreviation, alias, or UNITID to one school.
>
> Input: `query` — free text or a UNITID string.
>
> Success returns exactly one of three `status` values:
> - `match` — one school, plus its live data block: when Counselle last confirmed this school's
>   facts (`facts_updated_at`), how many facts it holds (`fact_count`), whether a facts page was
>   ever collected for it (`has_collegedata`), and per-page fetch status (`tabs`). A school with
>   `has_collegedata: false` has **no** facts — say "not collected" and use web/.edu search; never
>   read it as "the school reports nothing". A tab whose status is not `ok` is **not fetched**,
>   which is also not "not reported".
> - `candidates` — more than one campus matched; ask which campus the student means, then resolve
>   again with a more specific query.
> - `not_found` — no school in the database matches; say so honestly and route to web/.edu search
>   instead of inventing a school.
>
> Error returns `error: tool_error` with safe retry/stop guidance.

**2. `get_school_profile(unitid: int, groups: list[str] | None = None) -> dict`** — **unchanged**.
Docstring moved verbatim from `server.py:134-151`. It reads `school_profiles`, which §3 keeps
unchanged, and mints its own citation branch in `tool_middleware.py:91-129`. Only the citation
`source` changes from `"profile"` to `"db"` (F9); `profile_snapshot` caveat stays.

**3. `get_facts(unitid: int, sections: list[str] | None = None, keys: list[str] | None = None) -> dict`** — new:

> Read Counselle's stored facts for one school — the only fact read path.
>
> Input: `unitid` (from `resolve_school`) and **at most one** narrowing argument. `sections` — one
> or more section ids from the school's own `sections` list (`getting-in`, `money`, `academics`,
> `campus-life`, `outcomes`, `applying`, `other`). `keys` — exact `<domain>.<name>` fact keys.
> Omit both to read every section, which may be truncated; prefer a section or a key list.
>
> Success returns one row per fact with a preformatted `display`, its typed `value`, and a
> code-owned `vintage`. **Copy `display` and `vintage` verbatim** — never reformat a number and
> never merge two facts' vintages into one shared period. Each row's `state` is the honest reason
> it has no value, and the three unavailable states mean different things: `not_reported` (we
> collected this school's page and the field is empty), `not_fetched` (the page carrying it could
> not be read this cycle), `not_collected` (Counselle holds no facts page for this school at all).
> None of them is zero, and none of them is a substitute for another. `reported_period` states the
> period a fact covers when the source labels one; when it is null the period is unstated — say so
> rather than implying the current cycle.
>
> `truncated: true` means the cap was reached: narrow with `sections` or `keys` and call again.
> An unknown section or key fails with the valid list for this school; retry with one of those.
> A school with no facts returns zero rows and `facts_updated_at: null` — say the data is not
> collected and fall back to official web/.edu search.

**4. `query_database(sql: str, params: list | None = None) -> dict`** — docstring edited from
`server.py:194-210`:

> Run one guarded, read-only SQL read over the five reader views, for a shape no typed tool
> covers: cross-school candidate selection, aggregates, or coverage detail.
>
> Input: `sql` — a single parameterized `SELECT`/`WITH` using `$1..$n` placeholders only — and
> optional `params`. Bind every fact key as a parameter, never inline it: bound keys are how the
> result gets its coverage denominators.
>
> Success returns `columns`, `rows`, `row_count`, `truncated`, `as_of`, and `coverage` — for each
> fact key the query named, how many schools have a value for it out of how many profiles. Rows
> are raw and bypass the typed reading rules and citations entirely: never present a raw row as a
> cited student-facing value. Re-fetch any named final value through `get_facts` /
> `get_school_profile` before stating it, and state the covered/total denominator on any aggregate
> or ranking. If `coverage` is empty on an aggregate, you do not have a denominator — name the
> fact key as a bound parameter and re-run, or state the number without a population claim.
>
> Error returns `error: tool_error`; rewrite the query rather than retry it verbatim.

---

### Appendix ii — `query_database` allow-list and guard mechanism

**Allow-list** (`_ALLOWED_RELATIONS`, replacing `service.py:55-63`):

| Relation | Typed columns exposed to SQL | Why |
|---|---|---|
| `cds_library.school_profiles` | as today (no `profile_sha256`, `basic_profile` jsonb read-only) | identity joins, name/state/control |
| `cds_library.school_facts_sql` | `school_id int, fact_key text, label text, section text, display text, unit text, value_num numeric, value_text text, value_bool bool, value_date date, reported_period text, observed_at timestamptz` — **no `value jsonb`** | the long-form fact filter/aggregate surface |
| `cds_library.school_explore` | `school_id` + one typed column per filterable metric (§5) + `majors text[]`, `sports text[]`, `facts_updated_at` | the wide-row surface: multi-metric filters, major/state/cost queries |
| `cds_library.school_data_status` | `school_id, facts_updated_at, fact_count, has_collegedata, tab_status jsonb→` per-tab text columns | "how many schools do we have" honesty |
| `cds_library.fact_coverage` | `fact_key, schools_with_value, schools_total, as_of` | the denominator the model can check itself |

`cds_library.current_school_facts` is granted to `cds_library_reader` (the `get_facts` service path
reads `value jsonb` from it) but is **not** on the allow-list — that is what replaces
`_reject_packet_projection`'s jsonb-projection ban with a relation-level rule instead of an
AST-level one.

**Guards kept unchanged** (all in `_guard_sql`, `service.py:920-991`): single-statement,
no `;`/`--`/`/*`, sqlglot one-`exp.Query` parse, the forbidden-node list, `Lock`/`Into`,
implicit-comma-join rejection, schema-qualified allow-list, `_SAFE_FUNCTIONS`, contiguous
`$1..$n` matching both regex and AST, binary-param rejection, the `db_row_cap + 1` wrap, the
readonly transaction + `statement_timeout`, and the byte cap.

**Guards deleted and what replaces each:**

| Rejector | Honesty property it enforces today | v3 replacement | Preserved? |
|---|---|---|---|
| `_reject_binary_projection` (`:136-166`) | no PDF/sha bytes reach the model | no bytea column exists in any allow-listed relation; **keep the function** as a cheap backstop with `_BYTEA_COLUMNS = {"content_sha256"}` (`page_snapshots` is not readable anyway) | ✅ structurally |
| `_reject_packet_projection` (`:299-334`) | (a) internal keys (`provider_contract`, `diagnostic_code`, `evidence`) never leave; (b) a whole packet object is never returned; (c) only a scalar candidate value crosses | relation allow-list: `school_facts_sql` has no jsonb and no internal columns at all | ✅ **stronger** (schema-level, not AST-level) |
| `_reject_manifest_text_search` (`:337-350`) | a `LIKE` on manifest text must never masquerade as exact metric membership — i.e. "does this metric exist" is answered structurally, not by substring | no manifest. The analogous v3 risk is **"which schools have fact X"** answered by a `LIKE` on `fact_key` producing a wrong denominator. Replace with: a `LIKE`/`ILIKE` on `school_facts_sql.fact_key` or `fact_coverage.fact_key` is **rejected** ("fact keys are exact; bind the key as a parameter"). ~12 lines, same shape as the existing function | ⚠️ **must be added — the plan drops it with no replacement** |
| `_reject_unselected_cross_school_ranking` (`:497-516`) | a cross-school ranking must not mix two editions per school (double-counting / apples-to-oranges) | `school_facts_sql` is already one live row per `(school_id, fact_key)` (`UNIQUE … WHERE valid_to IS NULL`), so the multi-edition ambiguity is gone by construction | ✅ by schema |
| `_reject_non_manifest_json_helpers` (`:561-590`) | the only JSONPath allowed is the one exact bound-ref membership query | no jsonb reachable; drop `jsonb_path_exists`, `jsonb_build_object`, `to_jsonb`, `jsonb_typeof`, `json_extract*` from `_SAFE_FUNCTIONS` entirely | ✅ by removal |
| `_selected_document_cte` + `_uses_selected_document_ranking` + `_has_single_school_constraint` (`:363-495`) | the canonical selected-document join shape | no analog needed | ✅ n/a |

**Denominator mechanism** (`query_database`, after `_guard_sql`):

```python
def _named_fact_keys(tree: exp.Query, params: list[Any], known: Set[str]) -> tuple[str, ...]:
    """Fact keys this query names — bound params first, exact-equality literals second.

    Membership in the catalog's fact-key set is the safety property: an unknown
    string is ignored, so a stray literal can never fabricate a denominator.
    """
    named = {p for p in params if isinstance(p, str) and p in known}
    for predicate in tree.find_all(exp.EQ, exp.In):
        lhs = predicate.this
        if not (isinstance(lhs, exp.Column) and lhs.name.casefold() == "fact_key"):
            continue
        for literal in predicate.find_all(exp.Literal):
            if literal.is_string and str(literal.this) in known:
                named.add(str(literal.this))
    return tuple(sorted(named))

def _needs_denominator(tree: exp.Query) -> bool:
    return tree.find(exp.AggFunc) is not None or tree.find(exp.Order) is not None
```

`QueryResult` gains `coverage: tuple[FactCoverage, ...]` (one `{fact_key, schools_with_value,
schools_total}` per named key, fetched from `fact_coverage` in the same readonly transaction) and
`coverage_caveat: Caveat | None`. When `_needs_denominator(tree)` and `named` is non-empty →
`render_caveat("coverage_denominator", covered=…, total=…, as_of=…)`. When `_needs_denominator`
and `named` is **empty** → `warning` gains the "denominator unavailable — bind the fact key as a
parameter" sentence (F6). `_MANIFEST_SAFE_RETRY`/`_SELECTED_DOCUMENT_SAFE_RETRY`
(`server.py:22-29`) are deleted; a single `_FACT_KEY_SAFE_RETRY` routing back to `db-recipes`
replaces them if the `LIKE`-on-`fact_key` rejector fires.

**Row cap / overflow:** unchanged for `query_database` (`db_row_cap` 500,
`query_database_max_bytes` 262144, `service.py:1018-1053`). For `get_facts`: new
`get_facts_max_rows` (default 60, F20) applied in the service, **before** the middleware, so the
result carries an honest `truncated` flag rather than being silently truncated by
`reduce_tool_result`. Both tools stay inside the generic overflow path
(`tool_middleware.process_tool_result` → `overflow_spill`); `read_tool_result` needs no change
beyond dropping `restore_pending_evidence_tokens` (`sources.py:100-118`).

---

### Appendix iii — the `db` envelope, `RegisteredSource`, and the `sources` event

#### `domain/envelope.py`

```python
SourceName = Literal["db", "web", "edu", "reddit"]     # was 5 literals incl. "cds","profile"
Tier = Literal["official", "community"]

class EvidenceItem: ...            # DELETED (with app/evidence_markers.py)

class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    v: Literal[2] = 2
    source: SourceName
    tier: Tier | None = None       # required for web/edu/reddit; MUST be None for db
    vintage: str = Field(min_length=1)
    url: str | None = None
    school_unitid: int | None = None
    facts_updated_at: date | None = None       # NEW — when Counselle last confirmed this school
    source_period: str | None = None           # web-only, unchanged
    source_period_basis: SourcePeriodBasis | None = None
    source_period_evidence: str | None = None
    source_currentness: SourceCurrentness | None = None

    @model_validator(mode="after")
    def validate_identity(self) -> Citation:
        if self.source == "db":
            if self.tier is not None:
                raise ValueError("Counselle database citations carry no source tier")
            if not self.school_unitid:
                raise ValueError("database citations require the school they describe")
            if self.url is not None:
                raise ValueError("database citations carry no source URL")
            if any((self.source_period, self.source_period_basis,
                    self.source_period_evidence, self.source_currentness)):
                raise ValueError("database citations cannot carry web source-period evidence")
        else:
            if self.tier is None or not self.url:
                raise ValueError(f"{self.source} citations require a URL and a tier")
            if self.source == "reddit" and self.tier != "community": raise ...
            if self.source == "edu" and self.tier != "official": raise ...
            if self.school_unitid is not None or self.facts_updated_at is not None:
                raise ValueError("external citations cannot carry database identity")
        # the three currentness rules (:109-116) survive verbatim
        return self
```

**Dropped:** `document_sha256`, `source_kind`, `retrieved_at`, `academic_year`,
`manifest_version`, `profile_sha256`, `_SHA256`, `EvidenceItem`.
**Kept:** the whole web-currentness block (`:109-116`) — that governs Tavily and is untouched.
**Rationale for `tier: Tier | None`:** D3 says facts carry no tier. Keeping `tier="official"` on
the wire "but never rendering it" leaves a latent leak any future UI can surface; making it
structurally absent enforces D3 in code rather than in a component. `_is_citation_shaped`
(`app/sources.py:35`) still passes because `model_dump` emits the key with `None`.

`CitationEnvelope`: drop `evidence` and both validator branches (`:153-160`). Everything else
(`extra="forbid"`, the exact inert unavailable shape at `:141-148`, available ⇒ citation +
nonblank display at `:149-150`, finite-JSON `raw`) is source-agnostic and stays verbatim — that
is the part of the honesty core that survives generation change.

#### `app/sources.py`

```python
def source_key(citation: Citation) -> Hashable:
    if citation.source == "db":
        return ("db", citation.school_unitid)       # one rail entry per school
    return (citation.source, citation.url, citation.vintage)
```

Delete `register_pending_evidence`, `promote_pending_evidence`, `pending_evidence`,
`register_used_evidence`, `restore_pending_evidence_tokens`, `self._pending`, the
`evidence_token` import, and the evidence branch of `annotate_envelopes` (`:174-187`) — the
`annotated.pop("evidence", None)` line goes with it. `entries_for_wire` (`:152-163`) loses the
`(page, eid)` sort and `evidence_omitted_count`. `_MAX_TEXT_CHARS` and the `[N]` grammar
(`:17,51-62`) are unchanged.

#### Wire (`domain/events.py:273-287` → `frontend/src/api/chat/types.ts`)

```
SourceEntry = { v: 2, index: int>=1, citation: Citation, label: str, snippet: str|None }
```
`evidence` and `evidence_omitted_count` removed both sides. Golden fixtures
`tests/fixtures/protocol/{turn_full,transcript}.json` regenerated (asserted from Python
`tests/app/test_protocol_fixtures.py` and TS `src/test/protocol-fixtures.test.ts`).

#### What a `db` `RegisteredSource` carries, concretely

| Field | Value | Rendered as |
|---|---|---|
| `citation.source` | `"db"` | Counselle mark (never the school's favicon — F1) |
| `citation.tier` | `null` | no badge |
| `citation.school_unitid` | the school | the chip/row **subject** |
| `citation.facts_updated_at` | max `observed_at` for that school | "Checked September 2026" |
| `citation.vintage` | `"Counselle facts · checked Sept 2026"` | rail row subtitle |
| `label` | `"{school name}"` | rail row title, chip text (`friendlySourceName`) |
| `snippet` | `null` | — |
| per-**fact** `vintage` (envelope sibling, not the citation) | `"Counselle facts · 2025–26 · checked Sept 2026"` or `"… · reporting period unstated · …"` | the phrase the model copies next to that number (F14) |

`app/tool_middleware.py:_normalize_db_payload` becomes a `tool_name in {"get_facts",
"get_school_profile"}` branch minting exactly this citation; the label composition at
`viz.py:461-473` collapses to `school.name` for `db`.

---

### Appendix iv — caveat trigger table

Current catalog: 11 kinds (`config/assets/caveats.yaml`, asserted exactly at `app/caveats.py:18-24`).
The plan's keep(4)/add(4)/retire(7) partition **is complete** — 4 + 7 = 11 ✅ — but no retired
kind's emitter and no new kind's emitter is named. Emitters today: `packets.py:428-436` and
`:458-459`, `models.py:82`, `viz.py:256`, `tool_middleware.py:21-40`.

| Kind | v3 | Emitted by | Trigger | Text (v3) | Slots |
|---|---|---|---|---|---|
| `profile_snapshot` | keep | `counselle_db/models.py:82` (`ProfileLeaf` default) — unchanged | every `get_school_profile` leaf | unchanged: "Identity profile snapshot from {snapshot_date}; verify time-sensitive facts." | `snapshot_date` |
| `coverage_denominator` | keep | `counselle_db/service.query_database` (new, App. ii) + `db-recipes` | aggregate or `ORDER BY` over a facts column with ≥1 resolved fact key | unchanged | `covered,total,as_of` |
| `not_reported` | keep | **new: `get_facts` service** (`state == "not_reported"`) | the school's page was collected and the label is present but empty | unchanged: "The school did not report this item." | — |
| `not_applicable` | keep | **new: `get_facts` service** | the mapper's normalizer resolved the label to an explicit N/A marker | unchanged: "The school marked this item as not applicable." | — |
| `not_collected` | **add** | `get_facts` + `resolve_school` | `has_collegedata = false`, i.e. no facts page exists for this school | "Counselle does not collect facts for this school; this is not a report of zero or of the school withholding it." | — |
| `not_fetched` | **add** | `get_facts` service | the fact's tab has `school_pages.last_status != 'ok'` | "The page carrying this item could not be read this cycle, so its value is unknown — not absent." | — |
| `stale_facts` | **add** | `get_facts` service | `now - observed_at > facts_stale_days` | "Counselle last confirmed this value on {checked}; it may have changed since." | `checked` |
| `observed_at_spread` | **add** | `app/viz.py` (replaces `_apply_mismatch`, `:243-262`) | available `db` cells whose `observed_at` span exceeds `facts_stale_days` | "Compared values were confirmed at different times: {checked_dates}." | `checked_dates` |
| `stale_edition` | retire | `packets.py:432` | — | — | — |
| `edition_mismatch_comparison` | retire | `viz.py:256` | — | — | — |
| `partial_packet` | retire | `packets.py:429` | — | — | — |
| `definition_drift` | retire | `packets.py:430` | — | — | — |
| `not_in_template_version` | retire | `packets.py:435` | — | — | — |
| `vintage_period_unavailable` | retire | `packets.py:458-459` | superseded by the "reporting period unstated" clause **in the per-fact `vintage` string** (F14), which is stronger — it rides the value rather than being a separate caveat the model may not voice | — | — |
| `suppressed` | retire | `packets.py:435` | — | — | — |

Also rewrite `app/tool_middleware.py:21-40` `_caveats`: today it re-lists 9 kinds in a hard-coded
`if/elif` and **silently drops an unlisted kind**. In v3 make it slot-driven from
`caveat_catalog()` instead of a second hand-maintained list — that closes the silent-drop trap
(`explore/honesty.md` G16) at the same time, for less code.

---

### Appendix v — prompt / skill edit list (corrected)

**Prompts**

| File | Edit | Lines |
|---|---|---|
| `config/assets/prompts/counselor.md` | delete `### CDS Recency Gates` | 179-192 |
| | rewrite `### Database Safety` (names `get_domain`, "the five CDS reader views", the manifest probe, the db-recipes retry rule) | 193-208 |
| | `## The Honesty Contract` — line 94 "current-manifest domain / qualified refs" → sections/fact keys; keep 92 verbatim | 77-97 |
| | **`## Community Evidence`** — line 125 (`selected_edition` verbatim rule → delete), line 127 (`get_domain` per-row vintage → `get_facts`, keep the "never merge vintages" law verbatim) | 98-128 |
| | **`## The Counselor's Read`** — line 136 "CDS data is structure and statistics" → "Counselle's stored facts are last-confirmed observations, not this cycle's policy" | 129-152 |
| | `## Evidence Routing` — line 163 channel description | 157-178 |
| | **`## Substantive Advice`** — line 218 "`counselle-db / CDS`" | 209-251 |
| | **`## Composition Laws`** — line 282 (evidence tokens → delete), **line 287 (caveat-kind list → the 8 v3 kinds)**, lines 288-290 (`not_in_template_version` + stale/partial rules → `not_collected`/`not_fetched`/`stale_facts` rules), line 293 (packet-v8 JSON keys → fact keys as bound params) | 278-294 |
| | **`## Planning And Tool Loop`** — lines 327-328 tool sequencing | 322-336 |
| | `## School Resolution Etiquette` — line 436 "limited CDS coverage / usable domains" | 430-437 |
| | `## Visualizations` — line 446 `metric_ref`/`get_domain` | 438-455 |
| | `## Live Data Picture` | 462-467 |
| `config/assets/prompts/data_picture.md` | full rewrite; slots `as_of, n_schools, snapshot_date, facts_updated_range, schools_with_facts, fact_key_count, section_menu, stale_count` replacing the 11 in `app/prompt.py:12-24` | all 9 |
| `config/assets/prompts/README.md` | lines 6, 8 ("evidence", "live manifest/coverage summary") | 6, 8 |
| `config/assets/prompts/source_availability.md` | check the "Counselle's first-party data does not have this value" sentence still reads right when the reason may be `not_collected` | — |

**Skills** (26 `SKILL.md` + 2 loose files; grep-verified counts of CDS-vocabulary hits in parens)

| Skill | Plan says | Verified | Correction |
|---|---|---|---|
| `db-recipes` (39) | wholesale rewrite | ✅ | see below |
| `citation-and-recency` (23) | 30–50% rewrite | ✅ | the caveat-kind guide and the CDS-phrasing template go; the marker/sidebar/tier mechanics survive **except** the tier paragraph (D3: `db` has no tier) |
| `school-comparison` (20) | 30–50% | ✅ | Steps 2-4 (edition parity → `observed_at` spread) |
| `school-deep-dive` (17) | 30–50% | ✅ | coverage-block → data block; per-domain → per-section |
| `counselor-research` (6) | 1–2 lines | ✅ | L10-11 tool list, L47-48 "latest CDS edition" staleness |
| `chancing` (4), `school-list` (3), `major-and-fit` (3), `costs-and-aid` (2), `application-rounds` (2), `testing-strategy` (1), `deep-research` (1), `essay-honesty` (1) | 1–2 lines | ✅ | `essay-honesty` exists at `skills/essay-honesty/SKILL.md:29` ✅ |
| **`skills/activities.md:25`** | *missing* | ❌ | "School-specific context from CDS" — one-line edit (**F11**) |
| **`skills/honors.md:25`** | *missing* | ❌ | same (**F11**) |
| `essay-fit`, `focused-answer`, `guided-counselor` | none | ✅ | `essay-fit`'s only hit is `resolve_school`, which survives |
| `essay-advanced`, `essay-brainstorm`, `essay-craft`, `essay-depth`, `essay-drafting`, `essay-exercises`, `essay-revision`, `essay-structure`, `essay-types`, `essay-values` (0) | *unstated* | ✅ | the essay library added above this plan's `13a6656` baseline; grep-verified at zero hits for `get_domain`, `Common Data Set`, `cds`, `manifest`, `packet`, `metric_ref` — none. 16 dispositioned + these 10 = the 26 `SKILL.md` on disk |

**`db-recipes` v3 sketch** (replaces all 125 lines; keeps only the "typed tools first, guarded SQL
is the rare path" frame):

1. *§Typed tools first* — `resolve_school`, `get_school_profile`, `get_facts` cover almost every
   question. The five allow-listed views, named literally (App. ii). "Never write a bare table
   name." "`current_school_facts` is not reachable — use `get_facts`."
2. *§Two shapes, two views* — `school_facts_sql` is long-form (one row per school × fact key) for
   "which schools report X"; `school_explore` is one wide row per school for multi-metric filters
   (state + major + cost + grad rate). Pick the wide one when you are filtering on more than two
   metrics.
3. *§Always bind the fact key* — the exact-membership recipe, with the honesty reason: a bound key
   is what makes the result carry `schools_with_value/schools_total`; a `LIKE` on `fact_key` is
   rejected.
   ```sql
   SELECT f.school_id, p.name, f.value_num, f.reported_period, f.observed_at
   FROM cds_library.school_facts_sql f
   JOIN cds_library.school_profiles p ON p.id = f.school_id
   WHERE f.fact_key = $1 AND f.value_num IS NOT NULL
   ORDER BY f.value_num DESC
   LIMIT $2
   ```
4. *§Coverage denominator recipe* — read it from `fact_coverage` directly, or take it from the
   result's own `coverage` block; attach the `coverage_denominator` caveat wording, never
   hand-write a denominator sentence.
   ```sql
   SELECT fact_key, schools_with_value AS covered, schools_total AS total, as_of
   FROM cds_library.fact_coverage WHERE fact_key = ANY($1::text[])
   ```
5. *§Explore-shaped candidate filter* — the wide-row query with `includeMissing` honesty: a school
   missing the metric is excluded from the *filter*, not from the *universe*; report both counts.
   ```sql
   SELECT e.school_id, p.name, e.total_cost_out, e.grad_rate_6y
   FROM cds_library.school_explore e
   JOIN cds_library.school_profiles p ON p.id = e.school_id
   WHERE p.state = $1 AND $2 = ANY(e.majors)
     AND e.total_cost_out <= $3 AND e.grad_rate_6y >= $4
   ORDER BY e.total_cost_out LIMIT $5
   ```
6. *§What never to select* — `current_school_facts` / any jsonb `value`; raw rows as citations
   ("re-fetch each finalist through `get_facts` before telling the student a number");
   `school_data_status` counts presented as coverage without the total.

---

### Appendix vi — eval case disposition (32 cases, one partition)

| # | Case (`questions.yaml` line) | Disposition | Why |
|---|---|---|---|
| 1 | `routing-profile-identity` (4) | **keep, harness only** | `get_school_profile` name survives; `build_eval_context` school selection changes |
| 2 | `routing-admissions` (12) | re-point | `get_domain` → `get_facts` |
| 3 | `routing-enrollment` (21) | re-point | `domain_id: enrollment` → `sections: [...]` |
| 4 | `routing-aid` (30) | re-point | `domain_id: financial_aid` |
| 5 | `routing-cross-school-sql` (39) | re-point | `load_skill → query_database → get_domain` |
| 6 | `routing-current-deadline-web` (49) | light edit | web-only |
| 7 | `honesty-mit-current-enrollment-web` (59) | light edit | web-only |
| 8 | `coverage-no-packet` (76) | re-point | "no packet" → `has_collegedata: false` |
| 9 | `coverage-official-web-pivot` (86) | re-point | pivot trigger becomes `not_collected`/`not_fetched` |
| 10 | `coverage-not-in-db` (97) | light edit | `resolve_school` `not_found`, unchanged |
| 11 | `caveat-stale-partial` (105) | re-point | `stale_edition + partial_packet` → `stale_facts` |
| 12 | `caveat-template-absence-fixture` (113) | **delete** | no v3 analog |
| 13 | `caveat-template-absence-live` (120) | **delete** | no v3 analog; also deletes the `template_absence_live` scorer (`runner.py:937-959`) |
| 14 | `caveat-profile-snapshot` (129) | re-point | kind survives; citation source `profile` → `db` |
| 15 | `caveat-cross-edition` (138) | re-point | `edition_mismatch_comparison` → `observed_at_spread` |
| 16 | `honesty-yale-mixed-vintages` (148) | re-point | mixed CDS vintages → mixed `reported_period`/`observed_at` |
| 17 | `composition-same-domain` (161) | re-point | domain → section |
| 18 | `composition-mixed-db-web` (172) | light edit | routing law unchanged |
| 19 | `composition-unavailable-hole` (183) | light edit | now must distinguish the three unavailable states |
| 20 | `composition-stat-block` (193) | re-point | `metric_ref` → fact keys |
| 21 | `denominator-best-aid` (200) | re-point | denominator source → `fact_coverage` |
| 22 | `denominator-most-selective` (210) | re-point **+ scorer surgery** | drop `expects.selected_document_sql`; `typed_refetch_domain_id: admissions` → `typed_refetch_keys` (**F7**) |
| 23 | `denominator-need-blind` (226) | re-point | same |
| 24 | `honesty-missing-is-not-zero` (237) | light edit | "CDS packet" → "facts data" |
| 25 | `clarify-ambiguous-school` (245) | light edit | — |
| 26 | `clarify-specific-school` (251) | light edit | — |
| 27 | `narration-tool-work` (257) | re-point | step labels name `get_facts` |
| 28 | `workspace-create-tasks` (262) | untouched | — |
| 29 | `workspace-profile-memory` (271) | untouched | — |
| 30 | `response-mode-focused-direct` (280) | light edit | — |
| 31 | `response-mode-deep-research-triangulates` (291) | re-point | also the open `TODOS.md` eval gap (CDS cited for a deadline) |
| 32 | `response-mode-guided-counselor-converges` (304) | untouched | — |

**Totals: 17 re-point, 2 delete, 9 light edit, 3 workspace/untouched, 1 harness-only = 32** (F12).

**New cases required for the Phase 3 gate to mean anything (F13):**

| New id | Question shape | Asserts |
|---|---|---|
| `v3-honesty-not-collected` | a real school with no CollegeData page | prose says "not collected", never "not reported"/"0"; pivots to web/.edu; `not_collected` caveat kind present |
| `v3-honesty-not-fetched` | a school whose `money-matters` tab is `http_error` | that section reads "not fetched", distinct from "not reported" |
| `v3-honesty-stale-facts` | a fact whose `observed_at` > `facts_stale_days` | `stale_facts` caveat voiced; the "checked" date stated |
| `v3-honesty-period-unstated` | a fact with `reported_period IS NULL` | the model states the reporting period is unstated; does **not** attach a current-cycle year (**R1**) |
| `v3-denominator-cross-school` | "which schools meet 100% of need" | `query_database` result carries `coverage`; prose states covered/total; `coverage_denominator` caveat |

Also add the two structural honesty tests §7 Phase 3 already names, as pytest not evals (cheaper,
deterministic): `query_database` rejects `current_school_facts` and rejects a `LIKE` on `fact_key`.

---

### Appendix vii — ADR disposition

| ADR | Plan says | Verified | Correction |
|---|---|---|---|
| 0002 tracked-schools scope | untouched | ✅ | its coverage language is CDS-tier-free already |
| **0004** DB access as MCP server | supersede | ✅ correct | 0004's Consequences line ("Runs as a stdio child… status surfaced in `/v1/health`") is exactly what §6a deletes (`api/supervision.py`, `system.py:67`). Also note 0004's Implementation-note ("the service layer *is* the real API; `app/` imports it directly") is **preserved**, not superseded — v3 promotes it to the only path |
| **0005** three-layer + SQL hatch | amend | ✅ | the existing Old-data note already enumerates the four tools; add a third generation naming `get_facts` and the five v3 relations |
| **0006** reading rules in code | amend | ✅ | its Old-data note's list of what a new generation supersedes needs the **`Tier`** entry updated: v3 removes tier from DB citations entirely (D3), which 0006's "DB results are `official`" clause asserts |
| **0012** read-only role | amend | ✅ | its Old-data note names "five `cds_library.*` reader views"; v3 has six granted / five allow-listed. ADR 0036's amendment (agent read-only, admin write path isolated) stays valid — restate as "parked" |
| **0014** viz render-spec | amend | ✅ | its ADR-0032 amendment names "a verified metric ref (`<domain_id>.<metric_id>`) or profile ref, fetched by code through the packet/profile boundary" — replace with fact key / profile ref through `get_facts`/`get_school_profile`. The **R3 clarification** (reddit excluded from `SourcedCellInput`) must be restated verbatim; F17 adds a `db` clause |
| **0015** Tavily no-fetch | supersede the clause | ⚠️ | the clause is in **four** places: `:6` (context "must not… build scrapers"), `:9` (decision 1), `:19` (rationale), `:24` (alternatives). Name all four (**F18**) |
| **0017** layering | not listed | ✅ ok | `app/facts/` → `adapters/collegedata/` matches the `app/cds/` → `adapters/cds_*` precedent; `tests/domain/test_purity.py` only gates `domain/` and already carves out `domain/cds/` |
| **0018** central config | amend | ✅ | bucket-3 "live-derived from DB" examples become the facts-key catalog + `school_data_status`; the new `facts_*` settings are bucket 1 |
| **0019** durable sessions | **not listed** | ❌ | add a one-line note: decision unchanged, D9 is a one-time `counselle.*` data reset (**F18**) |
| **0023** one deployable | not listed | ⚠️ | state *explicitly unchanged*, with the ADR-0036 precedent (poller state lives in the `jobs` table, not in-process) so nobody reads the facts worker as a third in-process state owner à la ADR 0027 (**F18**) |
| 0024 remove score_band | untouched | ✅ | §5's "there is no score-band card" is correct |
| **0026** MVP3 frontend reset | untouched | ✅ | grep finds no honesty-surface coupling |
| **0027** workspace events | untouched | ✅ | correct — but ADR 0037 should say facts changes deliberately do **not** publish `ChangeEvent`s (0027 governs student-owned mutations) so nobody wires it later (**F18**) |
| **0032** db-rewire | supersede | ✅ | 0032 locks "exactly five reader views", "exactly four LLM-facing tools", `get_domain` as the only metric path, packet-as-only-evidence, one-selected-edition, and the four-shape viz cell grammar. v3 keeps the reader-role/view boundary, code-owned availability/caveats, and the viz provenance boundary — say which survives, as 0032 itself did |
| **0036** CDS pipeline in-app | amend as **parked** | ✅ | 0036's "every packet the writer builds is validated through the reader's own `parse_packet_row()` before COMMIT" invariant survives only if `counselle_db/packets.py` stays importable — §6a's "move `DomainRow`/`format_cds_edition` into `packets.py`" is exactly right and load-bearing for this |

---

## G — Idempotent boot sequence, env matrix, compose draft, `dev.py reset-db` steps, ops signals

### Appendices

#### (i) Idempotent boot sequence (proposal, addresses F6)

1. `scripts/entrypoint.sh` unchanged in shape: `seed_reader_db.py` → `yoyo apply --batch` (app DSN,
   `counselle` schema) → `exec uvicorn`.
2. `seed_reader_db.py` v3, split into three independently-idempotent phases, all run on **every**
   boot when `COUNSELLE_DB_ADMIN_DSN` is set:
   a. **Role reconciliation** (always safe, already the existing pattern): `_ensure_role` for
      `counselle_app`, `counselle_ro`, `cds_library_reader`, **and now `cds_library_app`** (missing
      today — `blast-db-deploy.md` §1.4 row `:191-193`) and `cds_library_owner` (missing today —
      §1.3/§4.1).
   b. **Schema DDL** (always safe — every statement is `CREATE TABLE IF NOT EXISTS` /
      `CREATE OR REPLACE VIEW` / a `DROP TRIGGER IF EXISTS …; CREATE TRIGGER …` guard /
      `CREATE OR REPLACE FUNCTION`): execute the v3 seed file unconditionally on every boot, so a
      schema change made after first deploy is never silently skipped the way
      `cds_documents_active_sha256_uidx` is stuck today.
   c. **Data load** (gated, unchanged pattern): `_reader_contract_is_loaded` check
      (`to_regclass('cds_library.school_profiles') IS NOT NULL AND EXISTS(SELECT 1 FROM …)`) still
      gates the one-time `TRUNCATE`+`COPY` of `cds_library.schools` from
      `school_profiles.csv.gz` — this is the only step that must never re-run against live data.
   d. **Grant reconciliation** (always safe, already the existing pattern): re-`GRANT` the reader
      and writer role/view lists every boot (idempotent `GRANT`s).
3. Local dev's `scripts/dev.py reset-db` is the **only** place that ever runs a destructive
   `DROP SCHEMA … CASCADE` — the container/prod boot path (step 2 above) never drops, only
   creates-if-missing + loads-if-empty.

#### (ii) Env matrix (kept / added / removed / repurposed)

| Var | Local | Staging (Render+Supabase) | Prod | Notes |
|---|---|---|---|---|
| `COUNSELLE_DB_RO_DSN` | kept | kept | kept | unchanged (reader role, now 6 views not 5) |
| `COUNSELLE_DB_APP_DSN` | kept | kept | kept | unchanged |
| `COUNSELLE_DB_ADMIN_DSN` | **added** to `.env.example` (absent today) | already in `render.yaml:43`, `sync:false` | same | needed by `dev.py reset-db` locally; already read by `seed_reader_db.py:178` |
| `COUNSELLE_DB_PIPELINE_DSN` | repurposed | repurposed | repurposed | same DSN/role (`cds_library_app`), now writes facts tables (or CDS tables, mutually exclusive per F1) instead of being CDS-only-optional; **rewrite its `.env.example:89-92` comment** |
| `COUNSELLE_CDS_WORKER_ENABLED` | **must be set `false`** wherever `COUNSELLE_DB_PIPELINE_DSN` is set for facts use (F1) | same | same | currently defaults `true` — the BLOCKER fix |
| `COUNSELLE_FACTS_WORKER_ENABLED` | **added**, recommend default `false` (F8) | added | added | new kill switch, mirrors `cds_worker_enabled` shape |
| `COUNSELLE_FACTS_CRAWL_RPS` / `_INTERVAL_HOURS` / `_MAX_BUILD_ROTATIONS` / `_STALE_DAYS` / `_FAILURE_THRESHOLD` / `_SNAPSHOT_RETENTION_PER_PAGE` / `GET_FACTS_MAX_ROWS` | **added** (Phase 1) | added | added | Settings fields per plan §4, all currently absent (`grep facts_` → 0 hits) |
| `CRAWLEE_STORAGE_DIR` | **added**, e.g. `/tmp/crawlee-storage` | added | added | required given root-owned `/app` (verified, see "Verified-correct") — or set Crawlee's storage client to memory, per plan §2 |
| `COUNSELLE_CDS_DATA_ENABLED` | kept (unrelated flag — gates `Catalog`/tool mounting, not the pipeline) | kept | kept | do not confuse with `CDS_WORKER_ENABLED` |
| `DbChildSettings`-only fields (no `COUNSELLE_` env today reads them directly, but the class exists) | **removed** | removed | removed | `config/settings.py:60` `DbChildSettings`, `:97` `get_db_child_settings`, `:514` `serialize_db_child_environment`, `:347` `agent_mcp_read_timeout_s` — all confirmed present today, all die with the MCP child deletion (§6a) |
| Render/Supabase helper `fixed` env dicts | n/a | **must add** `COUNSELLE_DB_ADMIN_DSN`, `COUNSELLE_DB_PIPELINE_DSN`, `COUNSELLE_CDS_WORKER_ENABLED=false`, `COUNSELLE_FACTS_WORKER_ENABLED` to `finish_render_staging.py:247-263`'s `fixed` dict | same | today's dict has neither ADMIN nor PIPELINE DSN (pre-existing bug, blast §2.6) — the PUT-replaces-list behavior means anything left out here is silently dropped on every re-run (F7) |
| `render.yaml` `plan:` | n/a | `free` today | **must become a paid tier** (F5) or the facts worker never runs a pass (R8) | owner cost decision, currently unaddressed anywhere in Phase 4 |

#### (iii) `deploy/docker-compose.dev.yml` draft

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: counselle_data
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${COUNSELLE_LOCAL_DB_SUPERUSER_PASSWORD:?set in .env}
    ports:
      - "127.0.0.1:${COUNSELLE_DB_PORT:-5433}:5432"
    volumes:
      - counselle_v3_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d counselle_data"]
      interval: 2s
      timeout: 2s
      retries: 30

volumes:
  counselle_v3_postgres_data:
```

Notes:
- New named volume (`counselle_v3_postgres_data`), deliberately **not** the retired repo's
  `counselle-data-pipeline_postgres_data` — matches D9's "rebuild from a new seed" intent and
  avoids silently re-adopting old data.
- No `/docker-entrypoint-initdb.d/` mount — all role/schema bootstrap happens host-side via
  `dev.py reset-db` calling `setup_db.sql` + the (rewritten) `seed_reader_db.py` logic against
  `COUNSELLE_DB_ADMIN_DSN=postgresql://postgres:<password>@localhost:${COUNSELLE_DB_PORT:-5433}/counselle_data`
  — sidesteps the init-script `\getenv`-inside-container complication (`blast-db-deploy.md` §2.8).
- **Manual owner step required before first use, not automated by any script (F2):**
  `docker stop counselle-data-pipeline-db-1` (decide separately whether to `docker rm` it and/or
  its volume — a data-destruction call that should be named explicitly, not implied by D9).

#### (iv) `scripts/dev.py reset-db` steps (proposal)

1. Require `COUNSELLE_DB_ADMIN_DSN` in `.env` (die with a clear message otherwise, mirroring the
   existing `check_config` pattern at `scripts/dev.py:149-175`).
2. `docker compose -f deploy/docker-compose.dev.yml up -d db` (idempotent; safe if already running).
3. Wait for readiness (reuse `wait_for_database`'s psycopg probe, `scripts/dev.py:264-286`, pointed
   at the admin DSN).
4. `DROP SCHEMA IF EXISTS cds_library CASCADE;` and `DROP SCHEMA IF EXISTS counselle CASCADE;` — the
   one explicit, owner-authorized destructive step in the whole pipeline (D9). Confirm first whether
   `_yoyo_migration` lives inside `counselle` (it does, per the `?schema=counselle` DSN suffix
   convention used everywhere else in this repo) so the drop clears the ledger too.
5. `psql "$COUNSELLE_DB_ADMIN_DSN" -f scripts/setup_db.sql` (roles, with `cds_library_owner` and
   `cds_library_app` now created here too, per the F6 role-reconciliation fix).
6. `psql "$COUNSELLE_DB_ADMIN_DSN" -f deploy/seed/cds_library_schema.sql` (v3: schools base table +
   the seven new tables + six views + triggers + default privileges, all sourced from the seed file
   per §3's "ship in the seed file this time" commitment).
7. `COPY` `school_profiles.csv.gz` into `cds_library.schools` with the explicit 19-column list
   (`blast-db-deploy.md` §1.2), letting `created_at` take its `DEFAULT now()`.
8. `uv run yoyo apply --batch --database "$COUNSELLE_DB_APP_DSN?schema=counselle" migrations/`
   (clean ledger, 19 files, no `cds_library` cross-references — confirmed safe).
9. Print a verification summary: `cds_library_reader` sees exactly the six new views and is denied
   every base table; `cds_library_app` can `INSERT` into every one of the seven new tables — mirrors
   Phase 0's own exit test, run locally instead of only in CI-less prod.

#### (v) Ops signals (proposal, addresses F9)

- Add a `facts_worker` key to `GET /v1/health` (`api/routes/system.py`, alongside the existing
  `mcp`/`rate_limiter` keys at `:67` and the `db_status`/`rate_limiter_status` combine logic at
  `:56-57`): `{"last_pass_status": ..., "last_pass_started_at": ..., "consecutive_failures": ...}`
  sourced from the newest `crawl_runs` row and `school_pages.consecutive_failures` — the data
  already exists per plan §3, this is presentation only.
- Emit one clear `logger.error("facts_crawl_pass_completed_with_errors", errors=N,
  unmapped_labels=M)` line when a pass's `crawl_runs.errors > 0` or `unmapped_labels` is non-empty —
  distinct from the generic transient-retry noise the copied `_loop()` shape already produces, so a
  human scanning stderr JSON logs can find "this pass had real problems" without wading through
  routine retry chatter.
- No paging/metrics stack — correctly out of scope for this stage (YAGNI); the two additions above
  are the cheap, high-value minimum consistent with the repo's existing idiom, not a new system.
- Retention (R5): no code action needed now (byte-stable payloads verified); add one `TODOS.md`
  entry once Phase 1 ships, matching this repo's existing discipline for deliberately-deferred work
  (F11).
- Backups: rely entirely on the managed Postgres provider's own snapshotting (Render/Supabase);
  state this explicitly in `docs/DEPLOY.md` rather than leaving it unstated.

---

## H — Flow decision matrix, NFR matrix, owner-ratification list, parked-vs-dead table, missing deliverables + copy strings

### Appendix i — Flow decision matrix

`D` = decided end to end (backend → API → frontend → copy) · `P` = partially decided · `U` = undecided.

| # | Flow | State | What is missing |
|---|---|---|---|
| **a1** | School detail → `about` tab, school **with** CollegeData | **P** | Response shape and section layout decided (§5, `sections.yaml`). Missing: the loading state's content (§6b notes `SchoolFactsPanel.tsx:41-47` "needs a loading state" and stops there), `aria-busy` (F28), client `staleTime` (F42), the "Checked <month year>" placement (Q2/Q15), payload budget (F17), the group-level (`groups[].label`) source, and the six unlisted CDS strings (F41). |
| **a2** | `about` tab, school **without** CollegeData | **P** | `not_collected` named (§5). Missing: page-level vs per-section treatment; the copy; the replacement for the shipped `data.edition === null` gate and the `NoCommonDataSet` component, which cannot express two distinct absences (F41); the chat-side analog (F19). |
| **a3** | Facts tab, **one tab failed** | **P** | §4 decides "Not fetched" for the section. Missing: it is not in §5's `state` enum (F5); the mapping from five `last_status` values; whether a partially-failed section shows its *previously observed* facts (SCD2 keeps them — F12 says keep, the plan doesn't) or hides them. |
| **a4** | Facts tab, **stale** facts | **P** | `facts_stale_days=120` + `stale_facts` caveat + Phase 2 exit test exist. Missing: page-level vs per-fact disclosure; the copy; the interaction with "Checked <month year>" (two freshness statements on one page); whether a stale fact is still shown (it must be) with what mark. Q2 is open. |
| **b1** | Explore default view | **P** | Endpoint + view decided. Missing: default sort, default page size, whether `total` is exact or capped (F7), the initial (unfiltered) empty/loading treatment. |
| **b2** | Explore each filter | **P** | The 25 filters are listed. Missing: `ExploreQuery` model, per-filter param names, value domains (size buckets? region definitions?), `includeMissing` default, "admit rate in-state/out-of-state **by home state**" — where does home state come from (profile? a control?), which is undecided. |
| **b3** | Explore sort | **U** | "sort by any numeric column" with no allow-list, no direction param, no tie-break, no SQL-safety statement (F7). |
| **b4** | Explore pagination | **U** | `page=` only; no page size, no max, no `total`. Also a **silent interaction change**: today it is client-side "Load more" (`PAGE_SIZE = 8`, footer *"Showing {n} of {N}"*, `ExplorePanel.tsx:49,115-119,254-271`). F7 / Q18. |
| **b5** | Explore **URL sharing** | **U** | A full URL contract already ships (`useExploreFilters.ts:28-156`, ~20 named params). The plan never says it is preserved, and `data` (dataWindow) must be dropped from it (F9). |
| **b6** | Explore **zero results** | **P** | The copy already ships verbatim (`ExplorePanel.tsx:286-329`). Missing: `narrowest.label`, its count-without-it, and the relax target are not in §5's response, so the shipped component would go dark (F9). |
| **b7** | School excluded by a **missing metric** | **P** | The affordance already ships — `ExclusionChip` *"{count} hidden — no {metricLabel}"* + *"include"* (`ExploreResultsHeader.tsx:188-196`) and `controlCounts` (`ExploreFilterBar.tsx:246-247`). Missing: `exclusions`/`control_counts` are not in §5's response, and `includeMissing` has no stated default (F9). |
| **b8** | Explore **"major offered"** | **P** | Server-side, `majors text[]`. Missing: matching semantics (exact CIP-ish label? substring? synonym list — "nursing" vs "Registered Nursing"), which is the whole usability of the filter. |
| **c1** | Chat "tell me about Yale's admissions" (`get_facts`) | **P** | Contract decided (single-school, `sections?|keys?`, `get_facts_max_rows`). Missing: what a section's worth of facts looks like in the model's context (the overflow path at `tool_overflow.py:276-283` is preserved but not sized), and the step label copy (§6a adds the row; no string). |
| **c2** | "compare Yale and UGA on cost" (`comparison_table`) | **D** | N× `get_facts`, cell grammar unchanged, `observed_at_spread` caveat, Phase 3 exit test. Well decided. |
| **c3** | "which Ohio schools under $30k offer nursing" (`query_database`) | **U** | Majors are unreachable from the allow-listed view (F10). |
| **c4** | "what's Yale's SAT range" (`stat_block`) | **P** | Card survives (`app/viz.py:128,134` unchanged). Missing: `specs/mvp2/PRD.md` story 33's score-band card was removed by ADR 0024 and its teaching caption now has no home; F20's band-trust caption is the replacement and is unstated. |
| **c5** | "when is Yale's ED deadline" | **U** | F4. Collides with `specs/mvp1/PRD.md` story 31 and eval `routing-current-deadline-web`. |
| **c6** | A school with **no CollegeData page** | **U** | F19 — no model sentence, no prompt rule, no card, no eval. |
| **c7** | A question about data CollegeData never reports (yield by major) | **P** | The general absence rule survives via `counselor.md`'s honesty contract and the fallback ladder. Missing: v3 has no `fact_coverage`-driven way for the agent to know a key *does not exist in the vocabulary at all* (vs exists-but-null) — §7 of the original brief ("the model doesn't know what it doesn't know") is dropped without replacement; `data_picture.md` is "full rewrite" with no target content. |
| **c8** | A question whose answer **changed** since the last pass | **P** | SCD2 + `observed_at` support it. Missing: nothing surfaces "this changed on <date>" to the student, and `school_facts.valid_from/valid_to` (the whole point of SCD2) has **no reader** in any phase — a history table nobody reads (Appendix iv). |
| **d1** | Workspace add-school dialog (deadline prefill) | **U** | Q4 open; F4 for the honesty and re-sync semantics. |
| **d2** | Applications test-policy clarification | **P** | §6a re-points `service_reference.py` at `admissions.test_policy`. Missing: the fact's *absence* path — today `get_domain` returned a packet with availability states; `service_reference.py:40-57` builds a `CitationEnvelope` with `document_sha256`/`academic_year`/`manifest_version`, all of which disappear. The replacement envelope's fields are unstated. |
| **d3** | School search in workspace | **D** | `GET /v1/schools/search` reads `school_profiles`, which is unchanged; §6a's "Keep untouched" covers it. Only note: `api/workspace/keys.ts:39-41` key collision is flagged in §6b. |
| **e1** | Admin facts status / dashboard | **P** | F11 — endpoint named, schema cannot serve half the owner's fields, no frontend spec, no copy, no empty state. |
| **e2** | Superuser gate | **P** | "(superuser)" stated. Missing: router-level vs per-route (F8); `is_superuser` on `MeData` stays (§6b) but nothing says what a superuser sees where the CDS nav item was — the plan says "One small screen replaces the CDS admin home in the nav" and never decides whether any "CDS is parked" note is shown. Recommend: **nothing** — a parked feature should be invisible, and `PARKED.md` is the record. |
| **e3** | Parked CDS admin, from a superuser's view | **P** | Routes deleted, nav collapsed, 65 files still compile. Missing: an explicit statement that a superuser sees **no** CDS surface and that `/admin/cds/*` returns the SPA catch-all (not a 404), which is what `_install_spa_routes` will do. |
| **f** | Session resume after the nuke | **P** | §6a decides the *engineering* (no compat shim, strict re-validation) and §7 Phase 4 adds a **runbook line**. Missing: any user-facing consequence. Every user's entire chat history vanishes with no notice, no export, no in-app copy. The sidebar will simply be empty. |
| **g** | `/v1/health` consumers | **P** | §6a removes `"mcp"`. Missing: nothing is added for the new worker (F18); `docs/DEPLOY.md:79,170` and `tests/api/test_routes_unit.py:393-473` assert the shape and are not listed among the rewrites. |
| **h** | Home / any "N schools with deep data" surface | **D (by absence)** | Verified: the `"Deep data · CDS extracted"` badge exists **only** in `specs/mvp2/PRD.md:83` and was never built (§6b is right). No frontend surface shows a school-count or data-depth stat. The only remaining user-visible CDS strings are `features/ai-chat/citations.ts:149,185` (`"Common Data Set · {year}"`, `friendlySourceName`) and the nav item `app/shell/navigation.tsx:75` — all three are in §6b's rewrite list. Nothing missing. |

---

### Appendix ii — NFR matrix

| Concern | State | Evidence / gap |
|---|---|---|
| Rate limiting, new endpoints | **U** | No GET route in the app is limited (`api/ratelimit.py` — all three limiters are on writes/auth). Explore is the app's most expensive query. F8. |
| Auth on `/v1/schools/*` | **U** | Today's `GET /v1/schools/search` is `current_active_user` (`applications.py:28-38`); the plan is silent. F8. |
| Auth on `/v1/admin/facts/status` | **P** | "(superuser)" stated; router-level vs per-route unstated. F8. |
| Caching / ETag (server) | **U** | Zero ETag support in `api/`; one `Cache-Control` precedent (`cds_admin.py:280`). F17. |
| Caching (client) | **U** | `frontend/src/app/query-client.ts:3-14` sets no `staleTime`/`gcTime` app-wide -> refetch on every mount, including every `about`/`application` tab toggle. F42. |
| Pagination limits | **U** | `page=` only; no size, no max, no total. F7. |
| Input validation (explore params) | **U** | No pydantic query model; `sort=` is an unguarded column name. F7. |
| Error response shape | **P** | The `EnvelopeError` + `map_*_errors` convention exists (`api/deps.py:27-51`, `workspace_common.py:28-36`) and the plan never says the new routes follow it, nor what a 404/503 looks like. F8. |
| Logging / PII | **D** | No PII in facts; `structlog` JSON with `trace_id`. Only note: the crawler must not log full response bodies. Worth one line. |
| Robots / ToS / legal | **U** | `respect_robots_txt_file=True` is decided; the legal exposure has **no risk row** and its mitigations were voided by D3. F3 / **BLOCKER**. |
| Attribution obligations | **U** | D3 is binding (no label shown). Whether that is legally acceptable is an owner decision, un-recorded. F3 / Appendix iii Q5. |
| Data retention | **P** | `facts_snapshot_retention_per_page` declared, no consumer. F12. |
| GDPR | **D (n/a)** | No personal data in the facts store. |
| Accessibility | **U** | DESIGN.md §16.1 is binding and unreferenced for three new screens. F28. |
| Mobile / responsive | **U** | 25 filters and a ~300-row page with no stated mobile treatment. F28. |
| Performance budget | **U** | No payload budget, no latency target, **no indexes on `school_explore_rows`**. F17. |
| Observability | **P** | Admin screen only (pull, superuser); `/v1/health` loses a key and gains none. F18. |
| Rollback | **U** | The nuke is irreversible and no phase has an abort path; `docs/DEPLOY.md:61`'s `pg_dump` recipe is never invoked. F16. |
| Secrets | **D** | Three DSNs unchanged; `setup_db.sql` reads passwords via `\getenv`; `.env.example` gains the admin DSN. Only gap: F26 (entrypoint required_env). |
| Test strategy vs CLAUDE.md | **P** | Exit tests are real and well-chosen where present; seven honesty-critical paths untested. F21. |
| Evals | **P** | Re-pointing decided; zero new cases; no budget. F13. |
| Docs | **P** | Seven docs listed; `DESIGN.md`, `docs/adr/README.md`, `specs/README.md`, `frontend/src/styles/README.md` missing. F14. |
| Boot fail-fast | **D** | §6a names all three boot gates (`Catalog.load`, `caveat_catalog()`, `validate_prompt_assets()`) and rewrites them together. Well done. |
| Concurrency / double-pass | **D** | `jobs` `UNIQUE (kind) WHERE status IN ('queued','running')` + the lease loop. Good. |
| Storage growth | **P** | Argued, not budgeted against a provider plan. F30. |

---

### Appendix iii — Owner-ratification list (decisions the plan makes silently)

Q1–Q4 in §8 are **not** the complete set. Each row below is a real decision already embedded in the
plan text that the owner has not been asked to confirm. Recommended default in the last column.

| # | Decision the plan makes silently | Where | Recommended default |
|---|---|---|---|
| **Q5** | **Re-accept the ToS/legal exposure under D1 (whole site, daily) + D3 (no label, no attribution)**, with two of the four originally-recorded mitigations removed. | §0 D1/D3 vs `rearchitecture.md` §11.1 | **Owner must answer explicitly.** Recommend: accept, with `robots.txt` respected, an identifying UA with a contact URL, 2 req/s, and no bulk-export endpoint — and record it as risk R0. |
| **Q6** | Schema name stays `cds_library` even though nothing CDS remains in it. | §1 | **Keep.** The plan's reason (renaming touches every DSN/grant/doc/test for zero value) is right; but say so in ADR 0037 so the name is not read as a leftover. |
| **Q7** | DSN env names stay `COUNSELLE_DB_PIPELINE_DSN` / role `cds_library_app` for the facts writer. | §1, §3 | **Keep**, and document in `docs/DATABASE_GUIDE.md` §1 that "pipeline" now means "facts crawler". Note this is the same DSN F1 shows cannot double as the parking switch. |
| **Q8** | The old dev container/volume (`counselle-data-pipeline-db-1`, `counselle-data-pipeline_postgres_data`) is orphaned by the new compose file. | §6c | **Leave it untouched until Phase 5**; it is the only surviving copy of the pre-nuke DB until F16's dump exists. Removal is a Phase 5 checklist line. |
| **Q9** | `facts_crawl_rps = 2` (≈2 h/pass, 15.5k requests/day against one site). | §4 | **Confirm.** 2 req/s sustained for two hours daily is the single most visible thing Counselle does to CollegeData; 1 req/s (≈4 h) halves the footprint at no product cost since the pass is nightly. Recommend **1**. |
| **Q10** | `facts_snapshot_retention_per_page = 10`. | §4 | **3.** Ten historical bodies per page × 15.5k pages is ~950 MB for a history no code reads (Appendix iv). Three is enough to debug a bad mapper run. |
| **Q11** | `facts_stale_days = 120`. | §4 | **Confirm 120** for the `stale_facts` caveat, but note it also governs `observed_at_spread` in comparisons (§5), where 120 days is very loose — two schools 119 days apart would compare silently. Recommend **splitting**: `facts_stale_days = 120`, `facts_spread_days = 30`. |
| **Q12** | Unmapped labels land in a section literally named **`other`** and are rendered to students as `unmapped:<source_path>` keys. | §3, §4 | **Do not render them.** `section = 'other'` is fine for storage and the admin screen; the facts **page** should omit `other` entirely until a human maps it. A raw `unmapped:pageProps.profile.x.y` label on a student page is the opposite of the design system's voice. |
| **Q13** | The score-band card stays dropped (ADR 0024), so SAT/ACT ranges render only as `stat_block` rows. | §5 | **Confirm.** But `specs/mvp2/PRD.md` story 33's teaching caption must survive somewhere — F20 puts it on the Explore verdict; it should also ride the SAT rows on the facts page. |
| **Q14** | Every user's chat history is deleted on the staging deploy with only a runbook line — no in-app notice, no export. | §6a "Session state", Phase 4 | **Add one line of copy.** Pre-deploy: the sidebar's empty state gains a one-time dismissible note *"Conversations from before <date> were cleared during a database rebuild."* It costs one string and is the difference between a rebuild and a data-loss incident from the user's side. |
| **Q15** | Freshness reads "Checked <month year>" (Q2's recommendation) **and** a `stale_facts` caveat can fire on the same page. | §5, §6a | Decide **one** primary freshness statement per surface: the page line is "Checked <month year>"; `stale_facts` fires only past `facts_stale_days` and then *replaces* the line with "Last checked <month year> — this may be out of date". Two coexisting freshness claims is a worse honesty surface than one. |
| **Q16** | The CDS admin nav item is replaced by the facts dashboard; a superuser sees no trace of the parked system. | §5 | **Confirm — show nothing.** A parked feature should be invisible in the product; `PARKED.md` + ADR 0036's amendment are the record. |
| **Q18** | Explore's interaction changes from client-side **"Load more"** (`PAGE_SIZE = 8`, *"Showing {n} of {N}"*) to server-side numbered pages. | §5 `page=` | **Keep "Load more".** Serve `page`/`page_size` from the server but append client-side, so the shipped footer, the shipped `NoResults`/`ExclusionChip` affordances and the scroll position all survive. `page_size = 24`. |
| **Q19** | Every new query refetches on every mount (no `staleTime` anywhere in the app). | `query-client.ts:3-14` | Facts `staleTime: 5 min`, explore `60 s`, admin status `30 s`. F42. |
| **Q20** | The facts tab's URL value stays `about` (the plan calls it "the facts tab"). | `SchoolDetailRoute.tsx:67` | **Keep `about`** — renaming breaks every shared school link for no gain. |
| **Q17** | `page_snapshots` keeps full response bodies (`pageProps.profile`) indefinitely-until-retention, i.e. Counselle stores a copy of CollegeData's content. | §3 | **Confirm** — it is required for citation integrity (`rearchitecture.md` §11.5) — but scope it in R0 as "retained for citation integrity, never served". |

---

### Appendix iv — Parked-vs-dead disposition

**Rule applied:** `PARKED` = kept in-tree, unreachable at runtime, **must be listed in `PARKED.md`** and
have a revival step. `DEAD` = must be deleted in the phase that orphans it. `LIVE` = still load-bearing.
Anything the plan leaves in neither state is a finding.

| Item | Plan says | Verdict | Note |
|---|---|---|---|
| `domain/cds/`, `app/cds/`, `adapters/cds_*`, `api/routes/cds_admin.py`, `config/cds/` | Park | **PARKED** | Correct. Must appear in `PARKED.md` (F27). |
| `counselle_db/packets.py` (+ `DomainRow`, `format_cds_edition` moved in) | Park, self-contained | **PARKED** | Correct and well-reasoned. |
| `counselle_db/formatting.py` | Park (used by both) | **LIVE** | It is imported by parked *and* live code (`format_decimal`). Not parked — it is live shared code. Relabel, or the next reader deletes it. |
| `settings.supported_packet_extractor_versions` | Keep (read by `adapters/cds_store.py:468`) | **PARKED** | Acceptable under D8 **only if labelled** in `PARKED.md` and in a comment at `config/settings.py:264`. Otherwise it is an orphan field with a validator. |
| `settings.cds_upload_max_bytes` | not mentioned | **LIVE** | Load-bearing for `MaxBodySizeMiddleware` (F25). Must be split. |
| `settings.cds_data_enabled` | "escape hatch, not the destination" | **DEAD** | F24 — delete with `EmptyCatalog` and the `app/deps.py:115-121` branch. |
| `EmptyCatalog` | not mentioned | **DEAD** | F24. |
| `Catalog` class | Rewrite (drop manifest/coverage SQL) | **LIVE** | Correct — it becomes the schools + `school_data_status` loader. |
| `_NO_CDS_DATA_PICTURE` (`app/graph.py:54-59`) | not mentioned | **DEAD** | Names `get_domain`; F24. |
| `COUNSELLE_CDS_WORKER_ENABLED` / `settings.cds_worker_enabled` | implied unused (DSN-based parking) | **LIVE — and it is the parking switch** | F1. It must be set to `false` and documented, not left at its `True` default. |
| `start_cds_worker` call in `api/main.py:114` + `app.state.cds_poller` | left in place (parking = unset DSN) | **DEAD** | F1 — with the DSN set it is actively harmful. Delete the call; the function stays with the parked module. |
| `scripts/cds_*` (6 files) | Park | **PARKED** | Correct. `CLAUDE.md`'s Commands block must move `cds_manifest_check.py` under a parked heading, not drop it (F29). |
| `deploy/seed/*cds*.csv.gz` (4 files, 7.9 MB) | Delete | **PARKED — must NOT be deleted** | F2 — they are the only reproducible copy of the shipped packets once the tables are dropped. |
| `deploy/seed/schema.sql` | rewritten | **DEAD** | F15 — duplicates `cds_library_schema.sql`; delete rather than maintain two. |
| `counselle_db/server.py`, `api/supervision.py`, `scripts/mcp_smoke.py`, `scripts/dispose_cds_pollution.py` | Delete | **DEAD** ✅ | Correctly identified. Docstrings moved first — good. |
| `app/evidence_markers.py`, `app/legacy_citations.py`, `frontend/.../legacy-replay.ts` | Delete | **DEAD** ✅ | Correct, with importers moved in the same commit. |
| `evals/runner.py:485-570` | Delete (dead duplicate) | **DEAD** ✅ | Correct. |
| `frontend/.../fixtures/` (facts, 2,054 ln) + `explore-fixtures.ts` (412 ln) | Delete | **DEAD** ✅ | Correct. |
| `features/cds-admin/CdsErrorCard.tsx` | parked with the tree | **LIVE — must be promoted first** | F44. It is the only DRY copy of DESIGN.md §13.1's error card, and the three new surfaces need it. |
| `frontend/.../AdminGate.tsx` | "becomes importer-less; keep" | **DEAD** | An importer-less component is dead code by definition. It is ~1 file; if `/admin/facts` (F11) exists it becomes **LIVE** again — which is the right answer. Make that explicit: `AdminGate` guards the new facts dashboard route. |
| The 65 CDS-admin frontend files (~9,000 ln) | Park (still compile, tests green) | **PARKED** | Acceptable under D8. Must be in `PARKED.md`. Note the honest cost: ~9,000 lines and 16 tests run on every routine suite for a parked feature. |
| `frontend/src/styles/schools.css` evidence tokens | not mentioned | **DEAD** | F22 — `--school-fact-evidence-ink`, `--school-fact-evidence-hover`. |
| `school-facts-format.ts`'s `suppressed` / `not_in_template_version` / `no_verified_value` copy | "rewrite `-format.ts`" | **DEAD** | Three of the six shipped absence strings have no v3 producer (F5). Delete, don't leave unreachable branches. |
| `ExploreFilterPanel.tsx:168` CDS help text, `explore-config.ts:202-206` `dataWindowOptions` | `explore-config.ts` named; the panel is not | **DEAD** | F41 — add `ExploreFilterPanel.tsx` to the explore rewrite list. |
| `school_facts.valid_from/valid_to` (SCD2 history) | schema only | **no reader in any phase** | Appendix i c8. Either name the reader (a "changed on" line, or the admin diff view) or state plainly that history is written now and read later — and then it is deliberate, not dead. |
| `facts_snapshot_retention_per_page`, `facts_failure_threshold` | declared Settings | **DEAD as planned** | F12 — give each a consumer or drop it. |
| `specs/cds-pipeline/tuning/` | not mentioned | **PARKED** | It is the ground truth + harness that reproduces the cut; keep, and list in `PARKED.md` alongside the preserved data (F2). |
| `docs/research/*.md` | not mentioned | **LIVE (historical)** | ADR 0003/0009/0011 rationale; unaffected by v3. The stray PDF is F35. |
| `specs/deep-research/` | not mentioned | **LIVE (deferred)** | Still the follow-up plan; the graph topology it depends on is untouched. No action. |
| `plans/school-data-*.md` (4 files, untracked) | v3 graduates; others "do not delete" | **must be committed + graduated** | F31. |
| `TODOS.md` CDS items + 2 `live_db` failures | move under "parked — dormant, untriaged" | **PARKED** ✅ | Correct and honest. F2 is what makes them ever triageable again. |
| `specs/school-facts/`, `specs/school-data-tool-call-polish/`, `specs/db-rewire/` | "stay as historical records" | **PARKED (superseded)** | F23 — must be *marked* superseded, or they read as current. |

---

### Appendix v — Missing deliverables (implied by the plan, never named)

Proposed names/paths, for the plan to adopt verbatim.

**Config / data assets**
1. `config/facts/keys.yaml` — and its **schema doc**: `config/facts/README.md` giving the entry shape
   (`match:` pattern, `fact_key`, `section`, `type`, `unit`, `period_from_label:`), the type vocabulary,
   and the "two-segment `<domain>.<name>`" rule. `config/assets/prompts/README.md` is the precedent.
2. `config/facts/sections.yaml` — six sections × groups × ordered keys, plus the `not_applicable` rules
   (F5). Same README.
3. `config/facts/collegedata_crosswalk.csv` — **header named**: `slug,unitid,method,matched_at,note`
   (`method ∈ exact|trigram|manual`).
4. A versioning rule for all three: `mapper_version` in `school_facts` must be derived from the
   `keys.yaml` content hash, not hand-bumped.

**Backend modules**
5. `app/facts/__init__.py`, `app/facts/crawl.py` (the `--once` entrypoint + pass orchestration),
   `app/facts/jobs.py` (lease loop), `app/facts/mapper.py`, `app/facts/normalize.py`,
   `app/facts/write.py` (SCD2 + explore upsert), `app/facts/crosswalk.py`, `app/facts/status.py`
   (the dashboard aggregate).
6. `adapters/collegedata/__init__.py`, `fetch.py` (Crawlee/httpx, buildId, robots, UA),
   `discover.py` (sitemap + `college-search.json`), `models.py` (the typed `bodyContent` tree).
7. `api/routes/schools.py` (facts + explore) and `api/routes/admin_facts.py`; pydantic models in
   `api/models/schools.py` (`FactsResponse`, `ExploreQuery`, `ExploreResponse`, `FactsStatusResponse`)
   — the repo has no `api/models/` today, so **name the choice**: models beside the route file, or a
   new package.
8. `api/deps.py::etag_response()` (F17) and `api/routes/schools_common.py::map_facts_errors` (F8).

**Fixtures and tests**
9. Fixture captures: `tests/fixtures/collegedata/<slug>/<tab>.json` — **6 tabs × 3 schools**
   (Yale = rich, UGA = public with in/out-of-state arrays, a small private with sparse tabs) ≈ 18 files
   ≈ 150 KB. Small enough to commit; `artifacts/` is for *generated* output, and a test fixture is
   source. Say so, because the rule is otherwise ambiguous.
10. Test files: `tests/app/facts/test_mapper.py`, `test_normalize.py`, `test_scd2_write.py`,
    `test_crosswalk.py`, `test_crawl_pass.py`; `tests/api/test_schools_routes.py`,
    `test_admin_facts_routes.py`; `tests/counselle_db/test_facts_service.py`,
    `test_query_guard_v3.py` (replacing the deleted `test_query_guard.py`);
    `frontend/src/features/schools/facts/school-facts-honesty.test.tsx` (rewritten),
    `frontend/src/features/schools/explore/explore-server.test.ts`.
11. The regenerated goldens: `frontend/tests/fixtures/protocol/turn_full.json`, `transcript.json` —
    name the generator command (there is one; the plan says they are "asserted from both sides").

**Frontend**
12. `frontend/src/api/schools/facts.ts`, `explore.ts`, `keys.ts`, `hooks.ts`;
    `frontend/src/api/admin/facts-status.ts`.
13. `frontend/src/features/admin-facts/` — `AdminFactsRoute.tsx`, `FactsStatusHeader.tsx`,
    `TabFailureTable.tsx`, `UnmappedLabelTable.tsx`, `CrawlHistoryList.tsx` (F11), and the route entry
    `/admin/facts` in `app/router.tsx` (wrapped in the existing `app/auth/AdminGate.tsx`, which keeps
    it from becoming importer-less) + the nav entry replacing `navigation.tsx:72-79`'s
    `adminShellRoutes` and its `is_superuser` branch at `AppSidebar.tsx:44-46`.
13b. `frontend/src/components/ui/ErrorCard.tsx` — `CdsErrorCard.tsx` promoted out of the parked tree
    (F44), with the five existing hand-rolled call sites re-pointed.
13c. `frontend/src/api/schools/hooks.ts` must carry explicit `staleTime` values (F42) — the app's
    first, so name them in the plan rather than leaving them to the implementer.

**Docs**
14. `PARKED.md` at the repo root (F27) — outline: *What is parked and why (ADR 0036 + D8) · The parked
    paths · The preserved data and its restore command · The six import edges into live code · The
    revival steps, in order · The dormant tests and the two untriaged failures · What must not be
    deleted*.
15. `docs/adr/0037-school-data-v3.md` — outline: *Context (D1–D11; what 0032/0036 assumed) · Decision
    (CollegeData facts store, seven tables, seven views, four in-process tools, CDS parked) ·
    Rationale · Alternatives (keep packets; RAG corpus — see `plans/school-data-v2.md`; a second
    service) · Consequences (supersedes 0032, 0004, 0015's no-fetch clause; amends
    0005/0006/0012/0014/0018; 0036 → parked; supersedes `specs/school-facts`,
    `specs/school-data-tool-call-polish`, `specs/db-rewire` as records) · The legal posture (R0)*.
16. `specs/school-data-v3/` with `PRD.md`, `plan/`, and `research/` (F31).
17. `deploy/docker-compose.dev.yml` (named container + volume, F36) and the `dev.py reset-db` help text.

**Copy strings** (DESIGN.md §13 voice: sentence case, second person, say the noun, never blank)
18. `"Not reported"` — value absent on a fetched page.
19. `"Not collected"` — school has no CollegeData page.
20. `"Not fetched"` — tab failed on the last pass. Section-level: *"We couldn't read this page on the
    last check."*
21. `"Not applicable"` — structurally absent for this school.
22. `"Checked {Month YYYY}"` — the page freshness line (Q2/Q15).
23. Stale: *"Last checked {Month YYYY} — this may be out of date."*
24. Deadline with no stated cycle: *"Cycle not stated — confirm on the school's site."* (F4)
25. Explore filtered-to-zero (DESIGN.md §13.3, verbatim template): *"No schools match"* /
    *"{narrowest} is the narrowest filter — {N} schools match everything else."* / `[Relax {filter}]`
    `[Clear all filters]`.
26. Explore missing-metric note: *"{n} schools have no value for this — [include them]"*.
27. Facts empty (no CollegeData): *"No facts collected for {school} yet"* / *"We have this school's
    identity but haven't collected its facts."* (F19)
28. Admin empty: *"No crawl has run yet"* / *"Start a pass to see coverage."*
29. Admin worker off: *"Worker disabled"*.
30. Sidebar one-time notice (Q14): *"Conversations from before {date} were cleared during a database
    rebuild."*
31. `db` chip label and hover-card meta line (Q3/R2) — the exact strings, since "Counselle mark with
    the school as subject" is a description, not copy. Note the two shipped strings this replaces:
    `citations.ts:148-149` `` `Common Data Set · ${academic_year}` `` and `:185`
    `friendlySourceName -> "Common Data Set"`.
32. The Explore exclusion/empty copy is **not** new — it ships today (`ExplorePanel.tsx:286-329`,
    `ExploreResultsHeader.tsx:188-196`). The deliverable is the **response fields** that keep it alive
    (`narrowest`, `exclusions`, `control_counts`), not new strings (F9).

---

## I — ARCHITECTURE.md / DATABASE_GUIDE.md dispositions, all-36 ADR table + ADR 0037 outline, CLAUDE.md replacement text, other docs

### Appendix (i): `docs/ARCHITECTURE.md` section disposition (definitive)

| § | Title | CDS/packet/manifest/MCP/evidence content found | Disposition |
|---|---|---|---|
| 1 | Guiding principles | L61: packet-boundary example | **Amend** (reword the honesty-in-code illustration) |
| 2 | Shape of the system | L88, 92-98, 106-107: MCP box, CDS Library Postgres box, `get_domain` naming | **Amend** (redraw diagram, rename tool in flow narrative) |
| 3 | The stack | L119-123: MCP server / four-tools-five-views row | **Amend** (plan already lists) |
| 4 | Layering & dependency rule | L149-150: ADR 0032/0036 write-path deviation bullets | **Amend** (plan already lists as §4 — wait, re-check: plan's list omits §4 too; see below) |
| 5 | Repository layout | L173-193: `counselle_db/` own-process line, `domain/cds` etc. | **Amend** (plan already lists) |
| 6 | Event protocol | none | Untouched |
| 7 | Sessions & identity | none | Untouched |
| 8 | Data-access layer (counselle-db MCP) | whole section | **Rewrite** (plan already lists) |
| 9 | Packet/evidence/citation truth boundary | whole section | **Rewrite** (plan already lists) |
| 10 | Dynamic catalog & qualified refs | whole section | **Rewrite** (plan already lists) |
| 11 | School coverage | whole section | **Rewrite** (plan already lists) |
| 12 | Agent runtime (+12.1 clarify) | L340: generic "native MCP connections" (PydanticAI capability, not DB-specific) | Untouched |
| 13 | Deep-research subsystem | none direct | Untouched |
| 14 | External search & source control | L407: "DB is the fourth source... CDS edition" | **Amend** (missing from plan's list — Finding 1) |
| 15 | Skills (SKILL.md) | mechanism only | Untouched |
| 16 | Citations, recency, temporal context | L433: "every named DB fact carries registered evidence" | **Amend** (missing from plan's list — Finding 1) |
| 17 | Visualizations | whole mechanism section | **Rewrite** (plan already lists) |
| 18 | Configuration architecture | L464, 479, 481 | **Amend** (plan already lists) |
| 19 | Observability & cost accounting | L491: MCP child supervisor health check | **Amend** (plan already lists) |
| 20 | Deployment & day-one deployability | L501: MCP child process supervised | **Amend** (plan already lists) |
| 21 | Testing strategy | L512-513: packet/edition test-surface language | **Amend** (missing from plan's list — Finding 1) |
| 22 | Feature→component traceability | L530, 542 | **Amend** (plan already lists) |
| 23 | Platform evolution path | none | Untouched |
| 24 | Risks & mitigations | L583, 585 | **Amend** (plan already lists) |
| 25 | Open questions | none | Untouched |
| 26-30 | Full-stack app shape, protocol ext., auth, chat mgmt, feedback | none | Untouched |
| 31 | The frontend (incl. Workspace module) | none (workspace reads catalog only, not deep facts) | Untouched (plan correct) |
| 32-37 | Config delta, deployment, FE testing, risks, profile/memory, onboarding | none | Untouched |
| 38 | CDS extraction pipeline & admin surface | whole section | **Rewrite → reframe as "parked"** (plan already lists; note: this is a *status flip*, not a deletion — code stays in tree per D8) |

Note on §4: on closer read, plan §6d's list actually **does** include "§4" — no, re-checking the
plan text precisely: "rewrite §8, §9, §10, §11, §17, §38; amend §3, §5, §18, §19, §20, §22, §24."
**§4 is not in either list.** L149-150 (the ADR-0017/0032 accepted-deviation bullet and the
CDS-admin-as-fourth-subsystem bullet) do reference the write path and need at minimum a footnote
once ADR 0036 is reframed as parked. Add §4 to the amend list alongside §1, §2, §14, §16, §21.

**Corrected disposition line for plan §6d:** "rewrite §8, §9, §10, §11, §17, §38; amend §1, §2, §3,
§4, §5, §14, §16, §18, §19, §20, §21, §22, §24; §31 and the rest untouched."

### Appendix (ii): `docs/DATABASE_GUIDE.md` disposition

| § | Title | Disposition (confirmed by direct read) |
|---|---|---|
| 1 | Access and permissions | **Replace** — read-path view list (5→6), write-path DSN/role/grant description entirely CDS-schema-specific. Plan's claim confirmed. |
| 2 | School identity and profiles | **Reused** — `school_profiles`/`basic_profile` is IPEDS-seeded identity, unchanged by facts-store swap (v3 §3 confirms `schools`/`school_profiles` unchanged). Plan's claim confirmed. |
| 3 | Manifest 5.1.0: dynamic catalog | **Replace** — entirely manifest/packet-shaped, no analog in a per-field scrape. Plan's claim confirmed. |
| 4 | Active documents & selected editions | **Replace** — edition-selection logic replaced by "most-recent-scrape-wins, per-field `observed_at`" (v3 §4/§6 SCD2 model). Plan's claim confirmed. |
| 5 | Packet v8 anti-corruption boundary | **Replace** — packet JSON parsing rules have no facts-store analog (a scraped field is typed at write time, no JSON anti-corruption layer needed). Plan's claim confirmed. |
| 6 | Reading states & display rules | **Adapt** — the *principle* survives (only a positively-confirmed value is a student value); the `extraction_status`/`availability_status` table is replaced by v3's `last_status`/`state: value|not_reported|not_collected` vocabulary (v3 §5). `not_in_template_version` (structural-absence-by-proof) has no analog — a scraped field is either present, absent, or the site doesn't have that field at all (simpler binary). Plan's "adapted" claim confirmed. |
| 7 | Evidence, citations, vintage, caveats | **Adapt** — principle survives ("citation is code-generated, never model-manufactured"); mechanism moves from PDF-page/excerpt evidence to scrape-timestamp + source-URL, no page/excerpt evidence at all for facts (per D6: db citations carry no evidence). Caveat catalog needs the full remap in plan §6a's caveats.yaml section. Plan's "adapted" claim confirmed. |
| 8 | Query recipes (safety limits) | **Rewrite recipes, keep pattern** — every SQL example (L408-435) hardcodes old view names; the guardrail *pattern* (statement timeout, row cap, byte cap) is fully reusable. Plan's claim confirmed. |
| 9 | Fallback ladder & hard prohibitions | **Adapt** — ladder shape survives with "usable domain" → "usable facts fields"; the "never" list survives except packet/edition-specific bullets (merge editions, template-absence inference). Plan's claim confirmed. |

Plan's summary ("§1/§3/§4/§5 replaced; §6/§7/§9 adapted; §2 reused; §8 recipes rewritten") is
**accurate and complete** — no gaps found in this file, unlike ARCHITECTURE.md.

#### The `cds_library_schema.sql` / parked-DDL question (§3, §6c) — see Finding 6 for the full case.
Verified by direct read: the file has zero GRANT/TRIGGER/DEFAULT-PRIVILEGES statements despite its
own header claiming to be "the ONLY schema-DDL source of record." Decision needed: **one file**, not
two — retire the existing file at its current path in the same commit that writes the fresh
`pg_dump` to `deploy/seed/parked/cds_extraction_schema.sql`.

### Appendix (iii): ADR disposition table (all 36) + ADR 0037 outline

| ADR | Title | Disposition | Note |
|---|---|---|---|
| 0001 | Primary user/scope | Untouched | No DB-source coupling |
| 0002 | Any school in scope | **Keep, add third old-data layer** | Already carries an "Old-data note (ADR 0032)" blockquote (verified); needs a fourth-generation layer noting the facts-store coverage model (per-field presence, not edition/tier) replaces 0032's language too |
| 0003 | PydanticAI + LangGraph | Untouched | Runtime choice, source-agnostic |
| 0004 | DB access as MCP server | **Fully superseded by 0037** | No remaining true content once MCP child is deleted; use the 0007/0008 "Superseded by [ADR 0037]" blockquote pattern, body kept historical |
| 0005 | Three-layer + SQL escape hatch | **Keep shape, new old-data note (4th gen)** | Already has an ADR-0032-era "Old-data note" blockquote (verified, quoted in body); needs updating to name the new 4-tool roster (`get_facts` replaces `get_domain`) |
| 0006 | Reading rules/citations in code | **Keep core, new old-data note (3rd gen)** | Already has an ADR-0032 old-data note (verified); needs a third-generation note describing `observed_at`/no-evidence facts-store model |
| 0007 | Hybrid field discovery | Untouched | Already "Superseded by ADR 0032," historical, unaffected further |
| 0008 | Field-embedding reconciliation | Untouched | Same as 0007 |
| 0009 | Deep research: GPT-Researcher | Untouched | DB-first framing is generic; not wired yet regardless |
| 0010 | Skills via SKILL.md | Untouched | Mechanism, not content |
| 0011 | Model config | Untouched | No DB-source coupling |
| 0012 | Read-only DB role | **Keep, narrow old-data note** | Already has both an "Old-data note (ADR 0032)" and an "Amendment (ADR 0036)" blockquote (verified); the 0032 note's "cds_library_reader, five views" phrase becomes the new view count/role |
| 0013 | Source-control dropdown | Untouched | Web/Reddit/.edu toggles, zero DB coupling |
| 0014 | Viz render-spec | **Keep provenance boundary, amend mechanism** | Already has "Amendment (ADR 0032)" + an "R3 clarification" note (verified); needs a further note swapping `get_domain`→`get_facts` |
| 0015 | External search Tavily | **Partially superseded** | The "we never fetch or scrape pages ourselves" clause (verified in Decision §1: "Tavily returns already-extracted page content... we never fetch or scrape pages ourselves") is directly contradicted by v3's own Crawlee/httpx scraper — the search half (Tavily-for-web/edu/reddit) stands unchanged |
| 0016 | API-first event protocol | Untouched | No CDS/citation-shape coupling in the protocol decision itself |
| 0017 | Layered core, stack-native seams | **Amend — MISSING from plan's list (Finding 2)** | Its own "Carve-out (eng-review D2)" MCP-tool-loop-only language is exactly what v3 eliminates |
| 0018 | Central config + data assets | **Keep pattern, update bucket-3 examples** | No pre-existing old-data note (verified — plain Decision section); bucket-3 "manifest/domains/coverage/evidence" examples need facts-store nouns |
| 0019 | Platform-ready sessions | Untouched | Checkpointer *mechanism* decision; D9 nuking `counselle.*` data doesn't invalidate the ADR's decision to use it |
| 0020 | Frontend: LibreChat clone | Untouched | Already "Superseded by ADR 0026," unaffected |
| 0021 | Auth | Untouched | No coupling |
| 0022 | Protocol: step/thinking/resume/cancel | Untouched | No coupling |
| 0023 | One deployable | Untouched (referenced, not amended) | Plan's own Scheduling row explicitly says "ADR 0023 one-deployable stays intact" |
| 0024 | Remove score_band | Untouched | Pure viz-catalog decision, independent of data source |
| 0025 | Turn persistence module | Untouched | No coupling |
| 0026 | MVP3 frontend reset | Untouched | No coupling |
| 0027 | Workspace service + change events | Untouched | Reads school catalog for identity/search only, not deep facts |
| 0028 | The run is the message | Untouched | No coupling |
| 0029 | Agent workspace tools direct-service | Untouched | No coupling |
| 0030 | Essay markdown projection | Untouched | No coupling |
| 0031 | Student profile/documents/memory | Untouched | No coupling |
| 0032 | DB rewire to CDS Library | **Fully superseded by 0037** | Already carries an "Amendment (ADR 0036)" blockquote (verified) narrowing it to the read path only — 0037 supersedes that entire read path; use a "Superseded by [ADR 0037]" note, keep body historical |
| 0033 | Reserved settings namespace | Untouched | No coupling |
| 0034 | Counselor response modes | Untouched | No coupling |
| 0035 | Structured clarifying questions | Untouched | No coupling |
| 0036 | CDS pipeline in-app | **Amend — parked, not retired** | Append a new "## Amendment (2026-0X-0X) — parked" section, following the exact precedent already in this file's own "## Amendment (2026-08-27) — the metric catalog was cut" section (verified, same file) |

**ADR file-naming convention** (verified against `0032-db-rewire-cds-library.md`,
`0036-cds-pipeline-in-app.md`): `NNNN-kebab-case-title.md`, 2-6 words, no dates in the filename.
Proposed: **`0037-collegedata-facts-store-cds-parked.md`**.

**README.md index-row format** (verified: `| [0032](...) | Title | One-line supersede/amend summary |`,
matching how 0032's own row named "replaces the retired wide field store"):

```
| [0037](0037-collegedata-facts-store-cds-parked.md) | School data v3: CollegeData facts store, in-process tools, CDS system parked | Supersedes 0032 (five views/four tools/manifest/packet-v8) and 0004 (MCP as DB transport); narrows 0015 (no-fetch clause — search half stands); amends 0005/0006/0012/0014/0017/0018 with a facts-store-generation old-data note; amends 0036 as parked, not retired. |
```

**ADR 0037 draft outline:**

```
# ADR 0037 — School data v3: CollegeData facts store, in-process tools, CDS system parked

## Context
- Counselle's CDS extraction pipeline (ADR 0036) shipped but has 4 real documents behind
  it and owner-acceptance still pending; the wide-fact-store predecessor (ADR 0032) covers
  only 8-schools-deep. Students need every-school, always-current facts, not a slow-growing
  hand-curated PDF corpus.
- CollegeData publishes structured JSON (not HTML) for 2,592 schools, updated on its own
  cadence — a daily free scrape covers what years of manual CDS extraction cannot.

## Decision
- Structured school data = `schools`/`basic_profile` (unchanged, IPEDS) + CollegeData,
  every field, every school, re-scraped daily with change detection (SCD2).
- No RAG, no CDS packet/manifest at runtime; the CDS extraction pipeline (ADR 0036) is
  parked — code stays in-tree and importable, its live tables are dropped, nothing is
  mounted.
- The agent reads facts through four in-process tools (`resolve_school`,
  `get_school_profile`, `get_facts`, `query_database`) — no MCP child, no stdio transport.
- `cds_library` and `counselle.*` are both nuked and rebuilt from a new seed; three
  roles/DSNs unchanged.

## Rationale
- Free, daily, code-side-typed scraping beats a paid, slow, per-document extraction
  pipeline for "always up to date, every school" — the stated product goal.
- Deleting the MCP child removes a whole transport layer (supervision, restart backoff,
  health-check plumbing) for zero remaining benefit once the only consumer was our own
  in-process code anyway (ADR 0004's original alternative, now adopted).

## Alternatives considered
- Keep the CDS pipeline as the sole source and scale up extraction volume — rejected:
  cost/latency-bound, will never reach every-school coverage at this cadence.
- Keep MCP as the DB transport, just repoint tools at the new schema — rejected: no
  remaining consumer of the MCP boundary once the field service moves in-process; a
  transport layer with one caller is a shallow pass-through (ADR 0017's own no-wrapper rule).

## Consequences
- Supersedes ADR 0032 (five views/four tools/manifest/packet-v8/evidence markers) and ADR
  0004 (MCP as DB transport) in full.
- Narrows ADR 0015: the "we never fetch pages ourselves" clause no longer holds for the
  CollegeData crawl; Tavily-for-search is otherwise unchanged.
- Amends ADRs 0005, 0006, 0012, 0014, 0017, 0018 with a facts-store-generation old-data note
  (pattern unchanged, objects renamed).
- Amends ADR 0036: the CDS write path is parked, not retired — code stays, tests stay green,
  live tables are dropped, `PARKED.md` names the revival steps.
```

### Appendix (iv): CLAUDE.md replacement text (paragraph-by-paragraph)

| Location | Current text (verbatim, from the live file) | Becomes |
|---|---|---|
| "What we're building" ¶2 | "...since ADR 0036, it is also the **CDS extraction pipeline and its admin tool**... **The student-facing agent path is still a strictly read-only consumer** of the CDS Library: it authenticates as `cds_library_reader` over `COUNSELLE_DB_RO_DSN`..." | "...since ADR 0036, this repo also contains the (now parked) CDS extraction pipeline and its admin tool — see the new Status paragraph. The student-facing agent path reads a CollegeData facts store (ADR 0037): stable identity (`cds_library.schools`, unchanged) plus daily-rescraped, per-field facts, still through the same reader role/DSN pattern (`cds_library_reader` / `COUNSELLE_DB_RO_DSN`)." |
| "Status" section | every CDS-cutover/pipeline/polish-2 paragraph stands as-is | append (don't edit in place, per the historical-record rule) a closing note on each: "Superseded by the school-data-v3 re-architecture (ADR 0037) — the CDS system described above is parked, not deleted; see the new Status paragraph below." Then add **one new** dated Status paragraph documenting the facts-store cutover once it ships. |
| "Commands" | `uv run python scripts/cds_manifest_check.py` line + its "P1 hard gate" comment | drop the command line entirely (no manifest exists to check under v3); note in the same commit that the script itself is parked, not deleted, alongside the rest of `domain/cds/` |
| Documentation map — `docs/ARCHITECTURE.md` row | "...including the four-tool CDS Library data surface, packet/evidence truth boundary, live data picture, viz v2..." | "...including the CollegeData facts-store data-access layer, the facts-store honesty boundary (per-field `observed_at`), live data picture, viz v2..." |
| Documentation map — `docs/DATABASE_GUIDE.md` row | "Exhaustive contract for the five CDS Library reader views: profiles, dynamic manifest, selected editions, packet v8, availability/evidence/caveat rules, coverage, limits, and safe SQL recipes." | "Exhaustive contract for the six facts-store reader views: profiles, current facts, explore, data status, fact coverage; per-field `observed_at`/availability/caveat rules, coverage, limits, and safe SQL recipes." |
| Documentation map — `deploy/seed/cds_library_schema.sql` row | "The schema-DDL and grant-model source of record for `cds_library`..." | either drop the row (if the file moves to `deploy/seed/parked/`) or repoint it: "Parked schema-DDL for the retired CDS write path (revival steps in `app/cds/PARKED.md`)." New v3 schema's seed file gets its own row instead. |
| "The stack" — Database access bullet | "a `counselle-db` MCP server (Python, asyncpg, `cds_library_reader`) exposing exactly four tools: `resolve_school`, `get_school_profile`, `get_domain`, and parameterized `query_database`..." | "in-process PydanticAI tools (no MCP child, no stdio transport) over `counselle_db/service.py` on the RO pool: `resolve_school`, `get_school_profile`, `get_facts`, and parameterized `query_database`..." |
| "The stack" — Catalog bullet | "the current immutable manifest snapshot (`5.0.2`, extraction contract 8) is dynamic. Never hardcode domain ids, metric inventories/counts, profile groups, or qualified refs." | "there is no manifest at runtime; the CollegeData field catalog is `config/facts/keys.yaml` + `sections.yaml`, versioned data assets. Never hardcode fact keys, section names, or the CollegeData crosswalk." |
| "The stack" — Reading rules/citations bullet | "...every value decoded, formatted, dated, **source-tiered**..." | drop "source-tiered" for `db` — note `db` citations carry no tier (D6); tiering applies only to `web`/`edu`/`reddit`. |
| "The stack" — DB bullet | "...The agent path reads exactly five `cds_library` views... the CDS admin write path (ADR 0036) is the one exception..." | "...The agent path reads exactly six facts-store views... the CDS admin write path (ADR 0036, parked) no longer runs; a facts-crawl writer (`cds_library_app`) is the only exception, gated by `COUNSELLE_FACTS_WORKER_ENABLED`." |
| "Scope guardrails" — "Any profiled school" bullet | "...CDS coverage is derived from the selected document and usable current-manifest domain packets..." | "...facts coverage is derived from `school_data_status` (per-field presence, no manifest/edition concept)..." |
| "Scope guardrails" — "Read-only" bullet | "...reads only the five views granted to `cds_library_reader`. ADRs 0012, 0032." | "...reads only the six views granted to `cds_library_reader`. ADRs 0012, 0037." |
| "Writing the agent" | no direct CDS reference | untouched (confirmed — prompts-as-data/model-call-isolation/tool-schema/authz/typed-output/eval-not-unit-test philosophy is source-agnostic) |
| "Frontend components" section | no CDS reference | untouched |

### Appendix (v): other docs — line-by-line list

**`README.md`** (verified full read):
- L3: "answers from stable identity plus whatever evidence-backed CDS domains its selected edition
  actually covers" → facts-store phrasing, no editions/evidence.
- L7-8: the two-piece intro paragraph naming "the CDS Library's Postgres database... exactly five
  reader views" and "The CDS extraction pipeline & admin tool... the writer that produces the data
  the agent reads" → rewrite both bullets (facts-store writer description; CDS bullet gets
  parked-not-active framing).
- L17: `counselle_db/` row — "The `counselle-db` MCP server + in-process service layer: four
  read-only tools over the CDS Library's five reader views." → drop "MCP server," rename tools.
- L37-56: the fresh-DB bash recipe (confirmed exact match to plan's citation) — replaced by
  `scripts/dev.py reset-db` per plan §6c.
- L58-62: the "technically complete but traffic closed" cutover-status paragraph — needs its own
  parked/superseded note once v3 ships (mirrors the CLAUDE.md Status handling).
- L69: `COUNSELLE_DB_RO_DSN` comment "(five views only)" → six views.
- L160: "the five-view CDS Library contract" → the new view-count/name.
- L161: "the 32 architectural decision records" → 37 (already wrong at 36; fix in the same edit —
  Finding 10).

**`docs/DEPLOY.md`** (verified full grep):
- L15: "domains and definitions come from the current immutable manifest view" — false once there's
  no manifest.
- L16-17: PyMuPDF bullet ("the CDS extraction pipeline uses PyMuPDF... required wherever the
  extraction path...") — keep only if noting the pipeline is parked (PyMuPDF stays installed for
  revival, not for current use).
- L25-32: "Provision the `cds_library` schema: the current manifest... the eight base tables, the
  five reader views..." → rewrite for the new seven-table/six-view schema.
- L96: "opens separate app/read pools plus the MCP child read pool" → drop, no MCP child.
- L105-109: `COUNSELLE_DB_PIPELINE_DSN`/CDS-worker env block → becomes optional/off-by-default
  reflecting the parked state (facts-crawl worker gets its own env var instead).
- L163-164, 173: deploy checklist — "CDS Library current pointer is `5.1.0`; all five views
  readable," `mcp_smoke.py`/"four-tool MCP boundary" line, "MCP child spawn... latency" — all three
  rewritten once the manifest/MCP child are gone.

**`TODOS.md`** (verified full read, all CDS-tagged items):
- `school_requirements` migration item (L3-20) — **unrelated**, keep as-is (workspace table, not
  CDS Library) — confirmed by direct read.
- `cds_deploy_export`/`cds_deploy_seed` owner item (L38-42) — moot if those schemas are dropped in
  the v3 nuke; otherwise still open.
- Archive-old-repo item (L44-48) — unaffected, still open.
- `cds_max_pages_per_call` item (L50-54) — moot, no active extraction to cap; close with a note.
- Two-eval-gaps item (L56-61) — one of the two (`deep-research-triangulates`) is directly re-scoped
  by the `get_domain`→`get_facts` evals rewrite.
- Per-metric-recall item (L64-68) — moot for the primary path once parked.
- Dev-origin-allowlist item (L70-74) — CDS admin surface stays in-tree parked, so this fix is still
  valid/open once re-enabled; no change needed now.
- Two-UI-fixes item (L129-154) — describes the parked write path directly; becomes dormant.
- sha256-index item (L156-175) — see Finding 7 (file-pointer fix needed).
- Two-`live_db`-failures item (L177-199) — plan's "TODOS.md:179-195" citation checked, in range.
- Non-CDS items (session-TTL, sessions-list, CSP, focus-restore, auth hardening, community-card
  viz) — confirmed unrelated, keep as-is.

**`specs/README.md`** — see Finding 8.

**`frontend/src/styles/README.md`** — grepped for `cds|manifest|packet|edition|evidence`: **zero
hits**. Confirmed out of scope, no plan action needed.

**`DESIGN.md`** — see Finding 3 (§15.3, §15.4 need edits; §14 confirmed untouched).

---

## J — Module manifest, pydantic API models, worker design (resume/enqueue/overlap), change-detection + SCD2 algorithm, reuse table, lint posture

### Appendix (i) — module manifest for v3's new code

| # | File | Layer | Responsibility | Est. lines |
|---|---|---|---|---|
| 1 | `domain/facts/models.py` | domain | `FactState` enum, `NormalizedValue`, `FactRow`, `SectionSpec`, `PageStatus` — frozen pydantic, `extra="forbid"` (match `counselle_db/models.py:15-17`) | 120 |
| 2 | `domain/facts/normalize.py` | domain | label+raw → typed value + `display` + `unit`; the money/percent/int/decimal/ordinal/bool/text/date/list/table/range engine (§4). Pure. | 300 |
| 3 | `domain/facts/state.py` | domain | **the one** `fact_state()` (finding 2) + `is_stale(observed_at, stale_days)` | 60 |
| 4 | `domain/facts/period.py` | domain | `reported_period` extraction from a label ("2025-26", "Fall 2024") | 60 |
| 5 | `adapters/collegedata/__init__.py` | adapters | empty | 0 |
| 6 | `adapters/collegedata/fetch.py` | adapters | sitemap load + host rewrite, `buildId` read/rotation, the 6-tab JSON GET, robots, UA/rps. Returns typed `FetchedPage`. The **only** file importing crawlee/httpx-for-scraping. | 250 |
| 7 | `adapters/collegedata/parse.py` | adapters | pydantic model tree for `pageProps.profile`'s `bodyContent` node types; typed walk yielding `(source_path, label, raw)` | 300 |
| 8 | `adapters/facts_store.py` | adapters | **all** asyncpg writes: snapshot insert (`ON CONFLICT DO NOTHING` + repoint), `school_pages` upsert, SCD2 close/insert, `school_explore_rows` upsert, `crawl_runs` open/close, `facts_jobs` claim/renew/sweep/complete. Mirrors `adapters/cds_store.py`'s role exactly. | 450 |
| 9 | `adapters/facts_queries.py` | adapters | read-side SQL for the admin dashboard on the pipeline pool (last runs, per-tab status counts, crosswalk counters). Mirrors `adapters/cds_admin_queries.py`. | 200 |
| 10 | `app/facts/__init__.py` | app | empty | 0 |
| 11 | `app/facts/__main__.py` | app | argv → `run_crawl_pass()` / `run_remap()`; builds settings + a pipeline pool; `--once`, `remap` | 70 |
| 12 | `app/facts/crawl.py` | app | one pass: discovery → per-school fetch of 6 tabs → `mapper` → one transaction via `facts_store`; `crawl_runs` accounting; buildId-rotation policy; resume skip | 250 |
| 13 | `app/facts/mapper.py` | app | snapshot tree → `FactRow`s: `facts_keys.yaml` pattern match, `domain.facts.normalize` call, `unmapped:<source_path>` fallback, explore-row projection | 300 |
| 14 | `app/facts/crosswalk.py` | app | `lru_cache`d CSV loader (slug↔unitid, method) + `reset_config_caches()` registration | 70 |
| 15 | `app/facts/jobs.py` | app | the lease poller: sweep → claim → run `crawl.run_crawl_pass` → renew; daily enqueue ticker; `start_facts_worker(runtime, settings)`. Copies `app/cds/jobs.py` minus the semaphore. | 170 |
| 16 | `app/facts/service.py` | app | facts-page presenter: `counselle_db.service.get_facts` + `facts_sections.yaml` layout + `fact_state` + deadlines → `SchoolFactsResponse` | 180 |
| 17 | `app/facts/service_explore.py` | app | explore query build (parameterized), exclusion accounting / `controlCounts` / `narrowest`, pagination | 300 |
| 18 | `app/facts/service_admin.py` | app | assemble `FactsStatusResponse` from `adapters/facts_queries` + settings-derived "next pass" | 120 |
| 19 | `app/facts/models.py` | app | the HTTP response/request pydantic models (appendix ii) | 220 |
| 20 | `api/routes/schools_facts.py` | api | `GET /v1/schools/{unitid}/facts`, `GET /v1/schools/explore`; `current_active_user`; `map_facts_errors` | 90 |
| 21 | `api/routes/admin_facts.py` | api | `GET /v1/admin/facts/status`; router-level `current_superuser`; `_facts_admin_parts` 503 | 60 |
| 22 | `config/assets/facts_keys.yaml` | asset | label pattern → `fact_key`, `section`, `type`, `unit` (finding 12) | — |
| 23 | `config/assets/facts_sections.yaml` | asset | facts-page layout: section → groups → ordered `fact_key`s | — |
| 24 | `config/facts/collegedata_crosswalk.csv` | asset | slug, unitid, method | — |
| — | *changed, not new:* `counselle_db/service.py` (+`get_facts`, rewritten `resolve_school`), `counselle_db/sql_guard.py` (split out, finding 16), `config/settings.py` (`facts_*` block), `api/main.py` (router mounts + `start_facts_worker` in lifespan) | | | |

No file exceeds 800 lines; no function in the design exceeds 50 (the mapper's per-node-type handlers
are a dispatch table, not one function).

---

### Appendix (ii) — pydantic API models

All in `app/facts/models.py` unless noted. `_Model` = `BaseModel` with
`ConfigDict(extra="forbid", frozen=True)`, matching `counselle_db/models.py:15-17`. Field names stay
snake_case (the wire convention everywhere in this repo — `frontend/src/api/*/types.ts` hand-writes
matching types; there is no alias generator in `app/workspace/models.py` beyond
`populate_by_name`, `:140`).

#### `GET /v1/schools/{unitid}/facts` → `SchoolFactsResponse`

```python
FactState = Literal["value", "not_reported", "not_fetched", "not_collected"]
TabName  = Literal["overview","admission","money-matters","academics","campus-life","students"]
PageStatus = Literal["ok","http_error","build_id_rotated","parse_error","never_fetched"]

class FactIdentity(_Model):
    unitid: int
    name: str
    city: str | None = None
    state: str | None = None
    official_domain: str | None = None

class FactItem(_Model):
    key: str                      # "<domain>.<name>"
    label: str
    state: FactState
    display: str | None = None    # None unless state == "value"
    value: Any = None             # typed scalar / list / table; None unless state == "value"
    unit: str | None = None
    reported_period: str | None = None   # R1/Q2: null means the period is unstated

class FactGroup(_Model):
    label: str
    facts: tuple[FactItem, ...]

class FactSection(_Model):
    id: Literal["getting-in","money","academics","campus-life","outcomes","applying","other"]
    title: str
    groups: tuple[FactGroup, ...]

class FactDeadline(_Model):
    key: str                      # e.g. "applying.deadline_ed"
    label: str
    date: Date | None = None
    display: str | None = None

class SchoolFactsResponse(_Model):
    identity: FactIdentity
    observed_at: datetime | None      # max school_pages.last_fetched_at (finding 10); None = never fetched
    is_stale: bool                    # observed_at older than facts_stale_days — server-computed, not FE
    has_collegedata: bool             # False ⇒ every fact is "not_collected"
    tabs: Mapping[TabName, PageStatus]
    deadlines: tuple[FactDeadline, ...]
    sections: tuple[FactSection, ...]
```
Notes: `is_stale` is computed by `domain.facts.state.is_stale` — never re-derived in the frontend
(that would be the fourth copy of finding 2's rule). `state` is *always* present, so the frontend
never infers "missing" from a null.

#### `GET /v1/schools/explore` → `ExploreQuery` (params) + `ExploreResponse`

```python
SortKey = Literal["admit","name","cost","size","grad_rate","deadline"]
Control = Literal["public","private"]
SizeBucket = Literal["lt2k","2k-10k","10k-25k","gt25k"]
RangeKey = Literal["admit_rate","total_cost","net_price","need_met","merit_aid",
                   "grad_rate_4y","grad_rate_6y","retention","student_faculty",
                   "housing_pct","greek_pct","out_of_state_pct","international_pct"]

class ExploreQuery(BaseModel):                    # FastAPI Query dependency, not a body
    model_config = ConfigDict(extra="forbid")
    q: str | None = Field(default=None, max_length=100)
    states: tuple[str, ...] = ()                  # each 2 chars, validated against a set
    sizes: tuple[SizeBucket, ...] = ()
    control: Control | None = None
    admit_basis: Literal["overall","in-state","out-of-state"] = "overall"
    home_state: str | None = Field(default=None, min_length=2, max_length=2)
    test_policy: Literal["required","optional","blind"] | None = None
    sat: int | None = Field(default=None, ge=400, le=1600)
    act: int | None = Field(default=None, ge=1, le=36)
    gender_model: Literal["coed","women","men"] | None = None
    calendar: Literal["semester","quarter","trimester"] | None = None
    no_app_fee: bool = False
    rounds: tuple[Literal["ED","ED2","EA","REA","Rolling"], ...] = ()
    major: str | None = Field(default=None, max_length=120)
    deadline_before: Date | None = None
    ranges: Mapping[RangeKey, "NumericRange"] = {}   # min/max, each validated per key
    include_missing: tuple[RangeKey, ...] = ()       # per-range opt-in (§5)
    sort: SortKey = "name"
    sort_desc: bool = False
    page: int = Field(default=1, ge=1, le=500)
    page_size: int = Field(default=..., ge=1, le=...)   # settings.facts_explore_page_size / _max_page_size

class NumericRange(_Model):
    min: float | None = None
    max: float | None = None
    @model_validator(mode="after")
    def _ordered(self): ...   # min <= max, else 422

class ExploreSchoolRow(_Model):
    unitid: int
    name: str
    city: str | None
    state: str | None
    control: Control | None
    size: int | None
    admit_rate: float | None
    total_cost: int | None
    net_price: int | None
    grad_rate_6y: float | None
    test_policy: str | None
    sat_25: int | None; sat_75: int | None
    act_25: int | None; act_75: int | None
    next_deadline: Date | None
    observed_at: datetime | None

class Exclusion(_Model):
    key: RangeKey
    metric_label: str
    count: int                 # rows hidden ONLY because the metric was missing

class NarrowestFilter(_Model):
    key: str                   # RangeKey | "states" | "sizes"
    label: str
    remaining_without_it: int

class PageMeta(_Model):
    page: int
    page_size: int
    total: int
    total_pages: int

class ExploreResponse(_Model):
    schools: tuple[ExploreSchoolRow, ...]
    exclusions: tuple[Exclusion, ...]
    control_counts: Mapping[Control, int]
    narrowest: NarrowestFilter | None
    meta: PageMeta
```
`Exclusion` / `control_counts` / `narrowest` mirror the current client shapes exactly
(`frontend/src/features/schools/explore/explore-types.ts:165-184`) so the FE swap at
`ExplorePanel.tsx:95-103` is a rename, not a redesign. Casing is the one change the FE must absorb
(`metricLabel`→`metric_label`, `controlCounts`→`control_counts`, `remainingWithoutIt`→
`remaining_without_it`) — say so in §6b so it isn't discovered at wiring time.

#### `GET /v1/admin/facts/status` → `FactsStatusResponse` (coordinator's spec)

```python
CrawlStatus = Literal["running","succeeded","partial","failed","aborted"]

class CrawlRunSummary(_Model):
    id: int
    started_at: datetime
    finished_at: datetime | None
    duration_s: float | None            # derived, not stored
    status: CrawlStatus
    error_code: str | None = None
    error_message: str | None = None
    build_id: str | None = None
    build_id_rotations: int = 0
    schools_seen: int = 0
    pages_fetched: int = 0
    pages_changed: int = 0
    pages_failed: int = 0
    facts_changed: int = 0
    unmapped_label_count: int = 0

class TabFailure(_Model):
    tab: TabName
    status: PageStatus
    count: int

class UnmappedLabel(_Model):
    source_path: str
    label: str
    schools: int

class CoverageCounts(_Model):
    sitemap_slugs: int | None            # crawl_runs.sitemap_slugs of the last pass
    crosswalk_matched: int
    crosswalk_unmatched: int
    schools_total: int                   # cds_library.schools row count
    schools_with_facts: int              # school_explore_rows WHERE retired_at IS NULL

class FactsStatusResponse(_Model):
    last_run: CrawlRunSummary | None
    next_run_at: datetime | None         # last finished_at + facts_crawl_interval_hours, or the
                                         # queued job's queued_at; None when the worker is disabled
    worker_enabled: bool                 # settings.facts_worker_enabled
    queued_or_running: bool              # a facts_jobs row in ('queued','running')
    coverage: CoverageCounts
    tab_failures: tuple[TabFailure, ...] # school_pages GROUP BY tab, last_status (non-'ok' only)
    unmapped_labels: tuple[UnmappedLabel, ...]   # capped at facts_admin_unmapped_limit
    unmapped_labels_truncated: bool
    history: tuple[CrawlRunSummary, ...]         # last facts_admin_history_limit (default 20)
```
**Schema columns the plan lacks to serve this** (repeat of finding 14, for the schema editor):
`crawl_runs.job_id`, `crawl_runs.status`, `crawl_runs.error_code`, `crawl_runs.error_message`,
`crawl_runs.pages_failed`, `crawl_runs.sitemap_slugs`, `crawl_runs.crosswalk_matched`,
`crawl_runs.crosswalk_unmatched`. `tab_failures` needs no new column but forces the route onto the
**pipeline pool** (`school_pages` is a base table, not one of the six reader views).

---

### Appendix (iii) — worker design (resume, enqueue, overlap)

Copy **verbatim** from `app/cds/jobs.py`: the class shape (`start`/`stop`/`_loop`/`_on_loop_done`), the
boot sweep before polling (`:52-62`), the transient-error survival with `continue` after
`poll_seconds` (`:85-105`), the background lease keeper with `_LEASE_RENEWAL_FRACTION = 3`
(`:37,147-176`), the `LeaseLostError` → `lease_lost` event contract (`:164-167`), and
`start_facts_worker(runtime, settings)` returning `None` when `runtime.pipeline_pool is None` or the
kill switch is off (`:179-192`), wired into `api/main.py`'s lifespan next to `start_cds_worker`
(`api/main.py:126-127`, stop at `:132-134`).

**Drop:** `asyncio.Semaphore(cds_worker_concurrency)` (`:47,92,98,103,112`) and the `_running_tasks`
set. `facts_jobs`'s `UNIQUE (kind) WHERE status IN ('queued','running')` already permits exactly one
pass; a concurrency knob would be an unreachable setting. The poller holds at most one task.

**Enqueue (daily).** No ticker, no APScheduler. The poll loop, on each idle tick, runs one
parameterized statement that is itself the schedule — the unique partial index makes it idempotent
under any number of instances:
```sql
INSERT INTO cds_library.facts_jobs (kind, status, queued_at)
SELECT 'crawl_pass', 'queued', now()
WHERE NOT EXISTS (SELECT 1 FROM cds_library.facts_jobs
                  WHERE kind='crawl_pass' AND status IN ('queued','running'))
  AND COALESCE((SELECT max(finished_at) FROM cds_library.crawl_runs), 'epoch')
      < now() - make_interval(hours => $1)
ON CONFLICT DO NOTHING
```
(`$1 = settings.facts_crawl_interval_hours`.) No in-process timer state, so a restart never skips or
double-fires a day.

**Resume after a crash (the plan is silent — decide: resume, do not restart).** A pass is ~2 h at 2
rps; restarting from scratch on every deploy or blip means a pass may never finish. On claim, the
worker either reuses the run row already linked to the job (`crawl_runs.job_id = job.id`, status
`running`) or opens a new one, then skips any `(school_id, tab)` whose page is already current for
this run:
```sql
-- schools still to do in this run
SELECT cs.school_id, cs.slug
FROM cds_library.collegedata_schools cs
WHERE cs.retired_at IS NULL AND cs.school_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cds_library.school_pages sp
    WHERE sp.school_id = cs.school_id
      AND sp.last_fetched_at >= $1        -- crawl_runs.started_at of THIS run
    GROUP BY sp.school_id HAVING count(*) = 6)
ORDER BY cs.school_id
```
Per-school granularity (not per-tab), because finding 11 makes the school the transaction unit. A
resumed pass's `pages_fetched` counter continues on the same `crawl_runs` row, so the admin dashboard
shows one pass, not two.

**Two instances (Render zero-downtime overlap).** Safe by construction, provided the sweep is copied
exactly: `sweep_expired_leases` reclaims only rows whose `lease_expires_at < now()`
(`adapters/cds_store.py` pattern; the CDS claim is `WHERE status='queued' … FOR UPDATE SKIP LOCKED`,
`:322-341`). The outgoing instance keeps renewing every `lease/3` until its `stop()` runs, so the
incoming instance's boot sweep finds nothing to steal and its claim finds no `queued` row. On the
outgoing instance's actual death, the lease expires within `facts_crawl_lease_seconds` and the new
one resumes mid-pass via the query above. Set `facts_crawl_lease_seconds` to ~180 (three poll
renewals), **not** to the pass duration — the lease covers liveness, not the job.

**`--once` / CLI.** `python -m app.facts --once` (finding 9) needs only `get_settings()` and a pipeline
pool from `counselle_db.db.create_pool(dsn=settings.db_pipeline_dsn, settings=settings)`. It calls the
identical `run_crawl_pass(pool, settings, run_id=...)` the poller calls — no second code path — and
writes the same `crawl_runs` row, but does **not** go through `facts_jobs` (a manual run is not
queue work; document that it can therefore race a scheduled pass, and that the operator should
disable the worker or accept per-school transaction isolation).

---

### Appendix (iv) — change detection + SCD2 write path

Per school, per pass. All SQL parameterized (`$n`), per pipeline ADR 0001 / CLAUDE.md.

```
for school in schools_remaining_this_run:            # appendix (iii) resume query
    fetched = {}                                     # tab -> FetchedPage | FetchError
    for tab in SIX_TABS:                             # sequential, paced at facts_crawl_rps
        fetched[tab] = adapters.collegedata.fetch.get_tab(slug, tab, build_id)
        # a 404/HTML body -> re-read buildId once, retry, count the rotation;
        # abort the whole pass after facts_crawl_max_build_rotations

    # ---- one transaction per school (finding 11) ----
    async with pool.acquire() as conn, conn.transaction():
        for tab, page in fetched.items():
            if page.failed:
                UPSERT school_pages(last_status=page.error_kind,
                                    consecutive_failures = consecutive_failures + 1)
                continue                              # no facts written for this tab -> "not_fetched"

            sha = sha256(json.dumps(page.profile, sort_keys=True, separators=(',',':')).encode())
            current_sha = SELECT ps.content_sha256
                          FROM school_pages sp JOIN page_snapshots ps ON ps.id = sp.latest_snapshot_id
                          WHERE sp.school_id=$1 AND sp.tab=$2

            if sha == current_sha:
                UPDATE school_pages SET last_fetched_at=now(), last_status='ok',
                                        consecutive_failures=0
                 WHERE school_id=$1 AND tab=$2
                # NOTE: no school_facts UPDATE at all — observed_at is derived
                # from school_pages.last_fetched_at (finding 10)
                continue

            snapshot_id = INSERT INTO page_snapshots (school_id, tab, first_seen_at, http_status,
                                                      build_id, content_sha256, body)
                          VALUES ($1,$2,now(),$3,$4,$5,$6)
                          ON CONFLICT (school_id, tab, content_sha256) DO NOTHING
                          RETURNING id
            if snapshot_id is None:                   # a revert to a previously seen body
                snapshot_id = SELECT id FROM page_snapshots
                              WHERE school_id=$1 AND tab=$2 AND content_sha256=$3
            UPDATE school_pages SET latest_snapshot_id=$3, last_fetched_at=now(),
                                    last_changed_at=now(), last_status='ok', consecutive_failures=0
             WHERE school_id=$1 AND tab=$2
            changed_tabs.add(tab)

        # ---- map + SCD2, only for tabs whose body changed ----
        new_rows = mapper.map_school(fetched, changed_tabs)      # -> FactRow[] with fact_key, value,
                                                                 #    display, unit, section, tab, ...
        current = SELECT fact_key, value, display, unit, mapper_version
                    FROM school_facts
                   WHERE school_id=$1 AND valid_to IS NULL AND tab = ANY($2::text[])

        # close-then-insert, in this order (a partial unique index cannot be deferrable, §3)
        UPDATE school_facts SET valid_to = now()
         WHERE school_id=$1 AND valid_to IS NULL AND tab = ANY($2::text[])
           AND fact_key = ANY($3::text[])                       -- changed keys + keys now absent

        INSERT INTO school_facts (school_id, fact_key, tab, value, display, unit,
                                  value_num, value_text, value_bool, value_date,
                                  section, reported_period, snapshot_id, source_path,
                                  mapper_version, valid_from)
        SELECT * FROM unnest($1::…)                              -- changed + newly present keys

        # a value that did NOT change but whose mapper output metadata did (finding 15)
        UPDATE school_facts SET display=$3, unit=$4, mapper_version=$5, source_path=$6,
                                snapshot_id=$7
         WHERE school_id=$1 AND fact_key=$2 AND valid_to IS NULL

        # ---- explore row: one upsert per school, after all six tabs ----
        INSERT INTO school_explore_rows (school_id, …typed columns…, majors, sports,
                                         facts_updated_at, retired_at)
        VALUES ($1, …, now(), NULL)
        ON CONFLICT (school_id) DO UPDATE
           SET …EXCLUDED…, facts_updated_at = now(), retired_at = NULL
```

Diff rule (state it in §4): **SCD2 closes a row only when `(fact_key, value)` changes.** A change in
`display`/`unit`/`mapper_version`/`source_path`/`snapshot_id` alone is an in-place `UPDATE` — otherwise
a `facts_keys.yaml` bump rewrites the entire history table and every `observed_at`-spread comparison
becomes wrong.

Remap (`python -m app.facts remap`) runs the identical block with the fetch stage replaced by
`SELECT ps.body … FROM school_pages sp JOIN page_snapshots ps ON ps.id = sp.latest_snapshot_id
WHERE sp.school_id = $1`, `changed_tabs = all six`, and no `school_pages` writes.

---

### Appendix (v) — reuse table (existing thing → reused by)

| Existing (file:line) | Reused by | Note |
|---|---|---|
| `app/cds/jobs.py:40-192` (Poller, sweep, lease keeper, `start_*_worker`) | `app/facts/jobs.py` | copy the shape; drop the semaphore (finding 8). Do **not** import — D8 |
| `adapters/cds_store.py:315-363` (claim `FOR UPDATE SKIP LOCKED`, `renew_lease`, `LeaseLostError`) | `adapters/facts_store.py` | same SQL vocabulary against `facts_jobs` |
| `api/routes/cds_admin.py:45-49` (router-level `current_superuser`) | `api/routes/admin_facts.py` | verbatim |
| `api/routes/cds_admin.py:57-66` (`_cds_parts` → clean 503 on `pipeline_pool is None`) | `api/routes/admin_facts.py::_facts_admin_parts` | verbatim |
| `api/routes/cds_admin.py:69-79` / `workspace_common.py:28-37` (`map_*_errors`) | `api/routes/schools_facts.py::map_facts_errors` | same three-way 404/409/422 mapping |
| `api/deps.py:27-51` `EnvelopeError` + handler | all new routes | the only error shape (finding 7) |
| `api/auth.py::current_active_user` (via `applications.py:33`) | `/v1/schools/{unitid}/facts`, `/v1/schools/explore` | finding 6 |
| `config/settings.py:561-566` `load_yaml_asset` + `reset_config_caches` (`:569-577`) | `facts_keys.yaml`, `facts_sections.yaml` | move both under `config/assets/` (finding 12) |
| `api/main.py:82-85` boot pre-load of yaml assets | the two new assets | fail-fast at boot |
| `counselle_db/db.py:41-72` `create_pool` (jsonb codec, statement timeout) | crawl pool, `--once` CLI | note the 8 s default timeout (finding 13) |
| `counselle_db/models.py:15-17` `FrozenModel` (`extra="forbid", frozen=True`) | `domain/facts/models.py`, `app/facts/models.py` | model-config convention |
| `counselle_db/catalog.py` (`SchoolRecord`, `normalize_school_name:53`, `resolve_candidates`, abbreviations asset `:59-72`) | rewritten `resolve_school`, the crosswalk name matcher | do **not** write a second name normalizer |
| `app/workspace/service_applications.py:91-116` `search_schools` + `counselle_db/service.py:665` `search_school_names` | unchanged; `/v1/schools/search` stays workspace-owned | finding 5 — do not duplicate into the facts router |
| `counselle_db/service.py:55-63` `_ALLOWED_RELATIONS` | the v3 `query_database` allow-list | enumerate it (finding 4) |
| `app/caveats.py:14-30` `caveat_catalog` + `render_caveat` | `not_collected`, `not_fetched`, `stale_facts`, `observed_at_spread` | the `expected` set at `:18-24` is a literal — update it in the same commit or boot fails |
| `app/workspace/service_reference.py:10` (`app/` ← `counselle_db/service`) | `app/facts/service.py` → `counselle_db.service.get_facts` | the ADR 0017 accepted deviation, already precedented |
| `frontend/src/features/schools/explore/explore-types.ts:165-184` (`Exclusion`, `controlCounts`, `narrowest`) | `ExploreResponse` field shapes | keep names 1:1 (snake_case) so the FE swap is a rename |
| `pyproject.toml:171-175` markers (`live_db`) | new live tests | no new marker; fixture-based crawl tests are routine |
| `tests/fixtures/` | `tests/fixtures/collegedata/<slug>-<tab>.json` | finding 18 |

---

### Type-check / lint posture (task 7)

- **ruff:** `select = ["E","F","I","UP","B","SIM"]`, `line-length = 100` (`pyproject.toml:88-90`).
  `B008` is relaxed only for `fastapi.Depends/Security/Query/File/Form` (`:93-101`), which covers the
  `Query(...)` defaults in `ExploreQuery`. No new ruff config needed.
- **mypy:** `ignore_missing_imports = true` globally (`:98`); `strict = true` only for `domain.*`
  (`:106-108`). Consequence: putting the normalization/state engine in `domain/facts/` (finding 1)
  gets it strict typing for free and needs **no** new override — provided it imports only stdlib +
  pydantic (the purity gate, `tests/domain/test_purity.py:22-24`, allows exactly those plus `domain`;
  `domain/cds/` has a documented `yaml`/`pymupdf` carve-out at `:24` — `domain/facts/` needs no
  carve-out, since `facts_keys.yaml` is loaded in `app/`, not `domain/`).
- **crawlee:** not currently a dependency. Because `ignore_missing_imports = true` is global, a missing
  `py.typed` produces **no** mypy error and therefore **no override is needed** — but also no checking.
  Verify and record `py.typed` at add time (finding 19) and confine crawlee to
  `adapters/collegedata/fetch.py`, which returns a typed `FetchedPage`, so no `Any` escapes.
- **bandit:** `exclude_dirs = ["tests","frontend",".worktrees",".agents",".claude","evals"]`
  (`:178`) — `adapters/collegedata/` and `app/facts/` are in scope. A raw-URL fetch will trip nothing
  by default, but any `subprocess`/`assert` in the crawl path will; keep them out.
- **coverage source** (`:181-183`) already lists `config, domain, app, adapters, api, counselle_db,
  evals` — new packages are picked up with no change.