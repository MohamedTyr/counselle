# Counselle database contract

Counselle's student-facing agent is a read-only consumer of the `cds_library` schema:
it reads only the six views granted to `cds_library_reader`, over
`COUNSELLE_DB_RO_DSN`, and never touches a base table. This guide describes that
contract and the honesty rules for turning it into student-facing answers, and those
rules are unweakened by anything below.

Counselle also *contains* a separate facts-crawl write path: an in-process worker,
authenticated as a different role over a different DSN, that populates the base tables
the six views read. §1 describes both paths and the hard boundary between them — a
second role and a second DSN, touched only by the facts adapters, never by the agent.
Everywhere else in this document, "Counselle" continues to mean the read-only agent
path unless a sentence says otherwise.

`cds_library` is a broad, code-typed, per-field facts store. It holds one stable school
identity profile per school plus a scraped, self-service catalog of admissions, cost,
aid, academics, student-life, and outcomes facts for every school Counselle can map to
an institution — daily-refreshed, carrying no source label and no evidence excerpt.
It does not hold a curated, document-grounded, evidence-cited corpus for a handful of
schools; that shape of data store exists in this codebase, unmounted and dormant — see
§10.

## 1. Access and permissions

### The read path — student-facing agent

Connect with the LOGIN role `counselle_ro`, whose only inherited membership is the
NOLOGIN group role `cds_library_reader`, using `COUNSELLE_DB_RO_DSN`. Use
schema-qualified, parameterized SQL. The reader can select exactly these views:

| View | Contract |
|---|---|
| `cds_library.school_profiles` | One row per school: typed identity columns, `basic_profile`, per-field `profile_provenance`, and profile version/snapshot/hash. |
| `cds_library.current_school_facts` | One row per school × reported fact, including the raw `value` jsonb — read only through the typed DB service (`get_facts` and the code-owned Explore fit batch), never reachable through `query_database`. |
| `cds_library.school_facts_sql` | The same current fact rows, jsonb-free: typed `value_num`/`value_text`/`value_bool`/`value_date`, `display`, `unit`, `observed_at` — the one facts relation `query_database` may touch. |
| `cds_library.school_explore` | One row per school: ~100 typed, nullable filter/metric columns (admit rate, cost, test bands, majors, and more) for cross-school filtering and joins that don't need a `fact_key`. |
| `cds_library.school_data_status` | One row per school, including a school with no crawl yet at all: `has_collegedata`, `facts_updated_at`, `fact_count`, and per-tab fetch status. |
| `cds_library.fact_coverage` | One row per known `fact_key`: how many schools report a value, out of how many are crosswalked at all, and when that count was last computed. |

No base table is part of this path's API. In particular, the agent's connections
cannot select `schools`, `collegedata_schools`, `page_snapshots`, `school_pages`,
`school_facts`, `school_explore_rows`, `fact_coverage_counts`, `facts_jobs`, or
`crawl_runs` — only the six views above. Do not request broader grants for the agent
path or compensate for a missing view field with base-table access.
`cds_library_reader` is the only role, and `COUNSELLE_DB_RO_DSN` the only DSN, the
agent's own connections ever hold; the write path described below runs on an entirely
separate role, DSN, and connection pool that agent code never touches.

`COUNSELLE_DB_RO_DSN` authenticates the LOGIN role `counselle_ro`, a member of the
NOLOGIN `cds_library_reader` group, and is the only credential the agent path may use
to read the six views. `COUNSELLE_DB_APP_DSN` authenticates `counselle_app`, which owns
Counselle's own application state in the `counselle` schema (users, sessions, chats,
workspace, feedback, and checkpointer); it has zero grants on `cds_library` and must
never be used to bridge to it. Never substitute one DSN for another, or import
facts-store adapter code to bridge them.

### Application authentication state

Migration `0022_auth_launch` adds `counselle.auth_sessions` and
`counselle.auth_action_tokens` through the application DSN. Login sessions store
only a token digest, user ID, creation/expiry and recent-authentication time;
they are separate from conversation rows in `counselle.sessions`. Action tokens
store a digest, purpose, target email and expiry; email reauthentication also
binds the initiating login session. Both tables cascade on user deletion.
Credential updates and session revocation share a transaction. These are
application tables and add no facts-store grants. See
[ADR 0045](adr/0045-auth-launch-lifecycle.md) for the lifecycle and trust rules.

Migration `0023_auth_credential_revision` adds the internal, nonnegative bigint
`counselle.users.credential_revision`, initially zero. Password replacement and
confirmed email changes increment it atomically with session revocation. Reset
tokens and session issuance compare the revision they observed, preventing an
old reset link or in-flight login from becoming valid again after email A → B → A.
Both `0022_auth_launch` and `0023_auth_credential_revision` are applied locally;
production migration remains pending.

Before private reads or writes reach these stores, the shared authentication
dependencies check an optional `X-Expected-User-Id` against the cookie owner.
The browser supplies its displayed account; a mismatch returns
`409 ACCOUNT_CHANGED`. Workspace EventSource uses `expected_user_id` in its URL
for the same check. This adds no database column or grant and does not replace
per-resource ownership checks; see the browser contract in Architecture §28.

### The Explore card's admit-rate band

Explore's card category is a code-owned planning band, not an individual admission
probability, and it reads exactly one column: `cds_library.school_explore.admit_rate`.
`<20` is Reach, `<50` is Target, every other valid rate is Safety. A rate that is
absent, non-numeric, or outside `[0,100]` is Unknown, and an Unknown card claims no
band at all. Nothing else is an input — not the saved student Profile, not the
browser's score assumptions, not `current_school_facts`' entering-class comparables —
so the band is a statement about the school, never a prediction about the reader
(ADR 0040, superseding ADR 0039).

One Explore result page is one call to `counselle_db.service.explore`: the code-owned
page statement plus its ancillary count/option statements, in a single read-only
transaction. There is no per-page facts batch, no application-database Profile read,
and no evidence-export seam on this path. No estimate is persisted, and an estimate
never reads or writes `Application.list_type`.

### The write path — the facts crawler, walled off by role and DSN

A separate, isolated write path populates the base tables the six views above read.
This is not an exception to anything above: the agent's own connections never gain
write capability, and every read-path rule in this document — the view contract, the
honesty rules in §5–§9 — applies to it exactly as written, unchanged.

- **Role and DSN.** The write path authenticates as `cds_library_app` (a LOGIN role
  when `COUNSELLE_PIPELINE_PASSWORD` is configured; otherwise created and kept
  `NOLOGIN` — present but inert) over `COUNSELLE_DB_PIPELINE_DSN`
  (`config/settings.py`'s `db_pipeline_dsn`, optional). `cds_library_app` holds
  `SELECT` on `schools` (it never writes school identity) and `INSERT, SELECT, UPDATE`
  on the eight facts-store base tables (`collegedata_schools`, `page_snapshots`,
  `school_pages`, `school_facts`, `school_explore_rows`, `fact_coverage_counts`,
  `facts_jobs`, `crawl_runs`), plus a narrow `DELETE` on `page_snapshots` only — the
  one operation the retention job needs; every other table is insert/update-only, and
  a retired `fact_coverage_counts` row is zeroed by an `UPDATE`, never deleted. This
  grant model, and every other `cds_library` object grant, lives in one file:
  `deploy/seed/cds_library_schema.sql`; `scripts/setup_db.sql` bootstraps the roles
  themselves (create/reconcile, passwords, session defaults) and grants nothing on
  `cds_library` directly.
- **Schema source of record.** This repo's own yoyo `migrations/` never create or
  alter `cds_library`. `deploy/seed/cds_library_schema.sql` is the schema-DDL and
  grant-model source of record: every base table, index, constraint, the shared
  `tab_names()` function and `tab_name` domain, the two live triggers
  (`schools_projection_matches`, `page_snapshots_immutable`), the six reader views
  (real view bodies), and both roles' exact grants.
- **Code boundary.** `adapters/facts_store.py`, `adapters/facts_jobs_store.py`,
  `adapters/collegedata/*`, and `app/facts/*` are the only code that opens a
  connection on this DSN, driven by an in-process worker started from the FastAPI
  lifespan when `facts_worker_enabled` is set. The agent's own connection pool is
  constructed from `COUNSELLE_DB_RO_DSN` only and is never given `cds_library_app`'s
  credentials — the isolation is role-level and DSN-level, not just
  code-organizational, so a bug inside the facts crawler cannot let the agent's
  request path write.
- **Page evidence is immutable; facts are versioned, never edited.** `page_snapshots`
  carries a `BEFORE UPDATE` trigger that rejects mutation outright — a snapshot is
  inserted once and only ever removed by retention, never changed. `school_facts` is
  stored SCD2 (`valid_from`/`valid_to`): a changed value closes the current row
  (`valid_to = now()`) and inserts a new one; nothing ever `UPDATE`s a fact's value in
  place. A **lease-based worker** claims work off `facts_jobs` with
  `FOR UPDATE SKIP LOCKED` (never blocking on another worker's row), holds a
  `lease_expires_at` window it renews while running, and a periodic sweep re-queues
  any job whose lease expired without being renewed — the same shape a crashed or
  killed worker leaves behind is safely resumable, not silently stuck. Exactly one
  crawl pass can run at a time: `app/facts/crawl.py` takes a non-blocking
  `pg_try_advisory_lock` on one dedicated connection for the whole pass, and a worker
  that cannot acquire it stamps its own claim `error`/`pass_already_running` and exits
  without touching the `crawl_runs` row the original owner still holds.
- **Snapshot retention, not indefinite history.** `adapters/facts_store.py` keeps the
  newest `facts_snapshot_retention_per_page` (default 3) `page_snapshots` rows per
  `(school_id, tab)`, pruning older ones in the same transaction as each changed-page
  write — except a snapshot still referenced by a *current* (`valid_to IS NULL`) fact
  row, which is never pruned regardless of age. `school_facts` history itself
  (`valid_to IS NOT NULL` rows) is retained indefinitely; nothing reads it yet, but
  nothing deletes it either.
- **The CollegeData↔IPEDS crosswalk is a reviewed, committed artifact, not a live
  lookup.** `config/facts/collegedata_crosswalk.csv` is built once, offline, by a
  matching ladder plus a hand-reviewed adjudication pass — no LLM call at build or run
  time, and none at crawl time either. `app/facts/crosswalk.py` is its only loader;
  `sync_crosswalk()` is the one write that upserts it into
  `cds_library.collegedata_schools`, run explicitly, not as a side effect of a crawl
  pass. A row not seen in the sitemap across a full pass is retired
  (`retired_at` set), not deleted, and a safety ceiling
  (`facts_retirement_max_fraction`, default 10% above a `facts_retirement_min_floor`
  of 50 live rows) refuses to mass-retire the crosswalk in one pass.

Read this section and you should know exactly which DSN may do what:
`COUNSELLE_DB_RO_DSN` reads six views and nothing else; `COUNSELLE_DB_APP_DSN` owns
`counselle.*` and nothing in `cds_library`; `COUNSELLE_DB_PIPELINE_DSN` is the only
credential that can write `cds_library`, and only through the facts-store adapter
layer. The agent's own connections are never the second or third of these.

## 2. School identity and profiles

`school_profiles.id` is the IPEDS UNITID and remains Counselle's canonical school key.
Resolve a school before school-specific reads. Names, `search_name`, aliases, location,
official domain, and main-campus status support resolution; ambiguous campuses remain
distinct schools.

`basic_profile` is stable identity context, not current institutional metrics. Its
top-level groups come from the stored profile itself; consumers must not maintain a
second enum. A live database trigger (`schools_projection_matches`) rejects any write
whose typed identity columns (`name`, `city`, `state`, `official_domain`,
`search_name`, and the rest) disagree with `basic_profile`'s own values — the typed
columns are a projection of the jsonb, checked at write time, never a second source of
truth that can drift from it. The profile intentionally excludes annual admissions,
enrollment, cost, aid, outcomes, earnings, demographics, staffing, and other
time-series facts — those live in the facts store described below, not in the profile.

Every profile leaf may have a receipt in `profile_provenance`: status, chosen source,
source column, vintage, source-file SHA, raw and normalized values, and normalization.
Use the stored receipt rather than inventing a source label. Every profile answer must
carry the profile snapshot/version caveat; a profile value must never be presented as a
live or current-cycle metric.

## 3. The facts store

The facts store is a broad, per-field scrape: one row in `school_facts` per
`(school_id, fact_key)` currently in effect, stored as SCD2 history so a changed value
never overwrites the record of what was true before. A `fact_key` is a
`<domain>.<name>` string (for example `admissions.applicants_men`,
`deadlines.regular`) declared once, school-agnostically, in
`config/assets/facts_sections.yaml` — the same declared-key list every school's facts
page renders against, present or absent. Bare, undeclared keys never reach a typed
read or a citation.

Every fact row carries: its typed value (`value_num`/`value_text`/`value_bool`/
`value_date` — at most one is ever non-null; a compound kind such as a range, table, or
distribution carries its data in the `value` jsonb column instead), a preformatted
`display` string, a `unit`, an optional `reported_period`/`reported_period_year`
(the source's own stated period for that value, distinct from when Counselle observed
it), and `observed_at` — the last time the page carrying it was successfully fetched,
read live off `school_pages.last_fetched_at`, not off a cached catalog snapshot.

A legitimate `0` or `false` is a real, present value at full weight — never a synonym
for missing, and never collapsed into any of the absence states below.

### The five fact states

`domain/facts/state.py`'s `fact_state()` is the single function that resolves a fact's
state; nothing downstream re-derives one from raw statuses on its own. There are
exactly five, and each makes a different claim about *why* a value is or isn't there.
Getting this distinction right is the honesty core of this document — never
substitute one state's word for another's, and never render two of them the same way:

| State | What it asserts | What it would be a lie to say instead |
|---|---|---|
| `value` | Counselle observed this exact value on the school's own published page. | — |
| `not_reported` | The page carrying this item was read successfully, and it explicitly does not report a value here (e.g. a blank cell on an `ok` page). | Never render this as "0", "unknown", or "not published" — the school was checked and chose not to report it. |
| `not_fetched` | The page carrying this item could not be read on the last check (a transport error, a parse failure, a site layout change, or a page never yet attempted). Counselle does not know the value — this is not evidence the school withholds it. | Never render this as "not reported" or "not published" — both claim the check succeeded; this one didn't. |
| `not_published` | The school genuinely has no such page (a checked, confirmed 404) — the section this fact would live in does not exist for this school at all. | Never render this as "0" or "not reported" — nothing was withheld, because nothing exists to check. |
| `not_collected` | Counselle has no CollegeData crosswalk row for this school at all — no crawl has ever run against it, for any fact. | Never render this as a report of zero, or as evidence the school withholds data. |

`section_state()` resolves the same distinction one level up, for a page section made
of several contributing tabs: `ok` when every tab is `ok`; `not_published` when every
non-`ok` tab is a confirmed `not_found`; `not_fetched` when every non-`ok` tab shares
the "checked, but the read failed" class; `partial` when tabs disagree. A section whose
only contributing tab is `not_found` is `not_published`, never `partial`. A `caveats.yaml`
entry exists for `not_reported`, `not_fetched`, `not_published`, and `not_collected` —
one canonical sentence per state; a skill or prompt may explain when to voice one, but
must not improvise or paraphrase its wording.

### No composite is ever synthesized

A published aggregate is never rebuilt from its parts. The clearest example: the 25th
percentile of a total SAT score is **not** the sum of a section's 25th percentile and
another section's 25th percentile — percentiles of a sum are not the sum of
percentiles, because the same student does not necessarily sit at the 25th percentile
on both sections at once. `school_explore_rows` therefore has `sat_math_p25`/
`sat_math_p75` and `sat_ebrw_p25`/`sat_ebrw_p75` columns and **no** `sat_total_p25`/
`sat_total_p75` columns at all — a fabricated composite shipped there once and was
removed. The same discipline applies everywhere a derived number might tempt a
shortcut: `need_fully_met_pct` is computed only from the school's own reported
`aid.need_fully_met` divided by `aid.received`, never as a stand-in for the school's
own printed average, and an omitted ethnicity bucket is stored `null`, never `0`, so a
distribution's bars can never be assumed to sum to 100. If a school does not publish a
number, Counselle does not derive one on its behalf.

### Scraped facts are Counselle's own data

Every fact in this store was scraped by Counselle's own crawler, code-typed by
Counselle's own mapper, from CollegeData.com's published pages. No source label, no
source tier, and no attribution are ever surfaced to a student — this is a deliberate
decision, not an oversight. Lineage from a raw page snapshot to the mapper version that
produced a fact is kept internally, for Counselle's own debugging ("why did this
number change"), and is never exposed through any API, rendered on any page, or carried
into a citation. The citation envelope's `db` source (§7) carries `tier: null` for
exactly this reason: it is the one source kind that asserts no external provenance at
all, because there is none to disclose. This does not weaken accuracy — the value
still traces to a real observed page — it only means Counselle presents this data as
its own, the way any product that compiles and republishes public facts does.

## 4. Reading states and display rules

Apply the state table in §3 in code, before the model sees a value. Only `value` is a
student value; the other four states are all "no value," each with a distinct reason.
Copy the canonical formatted `display` string produced by code — do not ask the model
to reformat, round, or paraphrase it. When a fact's `reported_period` is present, its
per-fact vintage names that period explicitly (e.g. "entering class Fall 2024, checked
March 2026"); when it is absent, the vintage says the reporting period is unstated
rather than silently omitting it.

## 5. Evidence, citations, vintage, and caveats

Every reported fact traces to a raw page snapshot Counselle fetched and to the mapper
version that parsed it — real, checkable lineage — but that lineage is never surfaced
as a citation the way an external source's is. A `db` citation (§3's "Counselle's own
data") carries no `tier`, no `url`, and no document identity; it carries only the
school it describes, a vintage string, and — for a `get_facts` read — the date
Counselle last confirmed that school's data (`facts_updated_at`). `resolve_school` and
`get_school_profile` always mint the identity vintage (from the profile's own snapshot
date); `get_facts` mints the facts vintage when the school has a non-null
`facts_updated_at`, falling back to the identity vintage rather than fabricating a
confirmation date over an empty slot.

Two source kinds — `cds` and `profile` — remain valid values in the citation type but
are **read-only**: nothing mints them any more. They exist because a session's turn
history is durable (LangGraph's Postgres checkpointer, ADR 0019, no backfill
migration) and a session that called the retired `get_domain` tool, or an earlier
`get_school_profile` that minted `profile`, still carries those literals in its
checkpointed state — every read of that history re-validates against the same
`Citation` model. Dropping either from the type would not fail a test; it would throw
the moment such a session's history is next read. Every citation this store mints
today uses `source: "db"`.

External search citations (`web`, `edu`, `reddit`) are unchanged: each requires a real
URL and a `tier` (`official` for `edu`, `community` for `reddit`), and none may carry
any database identity field.

The code-owned caveat catalog (`config/assets/caveats.yaml`) supplies canonical text
for these kinds — a prompt or skill may name a kind and explain when to voice it, but
must not duplicate or improvise its wording:

- `profile_snapshot` — identity profile snapshot date; verify time-sensitive facts;
- `coverage_denominator` — a cross-school aggregate's covered/total population and
  as-of date;
- `not_reported`, `not_fetched`, `not_published`, `not_collected` — the four
  no-student-value states from §3's table (`value` needs no caveat);
- `stale_facts` — Counselle last confirmed this value on a stated date; it may have
  changed since (fired when an observation is older than `facts_stale_days`, default
  120 days);
- `observed_at_spread` — two facts being compared were confirmed at different times,
  more than `facts_spread_days` (default 30) apart.

The model must copy citation and caveat text verbatim. It must not manufacture a
vintage, a confirmation date, or a caveat sentence.

## 6. Query recipes

Typed tools are the normal path: `resolve_school` resolves the school,
`get_school_profile` reads identity, `get_facts` reads a school's declared facts (by
section, by exact key, or in full). `query_database` is a rare escape hatch for
cross-school candidate selection, aggregates, and coverage detail a typed tool cannot
answer — typed reads are already cited; `query_database` output is for shaping the next
typed call, not a citation source in itself.

`query_database` accepts one parameterized `SELECT`/`WITH`, positional `$1..$n` only,
under a row cap and statement timeout, restricted to exactly five schema-qualified
views (`counselle_db/sql_guard.py`'s `_ALLOWED_RELATIONS`):

- `cds_library.school_profiles`
- `cds_library.school_facts_sql`
- `cds_library.school_explore`
- `cds_library.school_data_status`
- `cds_library.fact_coverage`

`cds_library.current_school_facts` is reader-granted — `get_facts` reads it — but is
**deliberately excluded** from this allow-list: it carries a raw `value` jsonb column,
and `query_database`'s guard rejects any jsonb or bytea projection before the database
is ever asked. `school_facts_sql` is the flattened, jsonb-free view to use instead. The
guard also rejects, before execution: any relation not in the list above; any function
not on a narrow safe list; implicit comma joins; more than one statement; anything
other than `SELECT`/`WITH`; a `fact_key LIKE`/`ILIKE` pattern (fact keys are exact,
never a substring search); and a projection of `school_profiles.profile_sha256`,
`basic_profile`, `profile_provenance`, or `school_data_status.tabs` (binary or internal
provenance columns with no legitimate reason to leave this surface as a raw blob —
`get_school_profile` already serves that content typed and decoded).

### Configured safety limits

| Boundary | Exact configured value |
|---|---:|
| PostgreSQL statement timeout (`db_statement_timeout_ms`) | `8,000` ms |
| Guarded-query row cap (`db_row_cap`) | `500` rows |
| Serialized guarded-query result cap (`query_database_max_bytes`) | `262,144` bytes |
| `get_facts` row cap (`get_facts_max_rows`, tool-level, on a narrowed call) | `60` rows |

The statement timeout is set per-connection via `set_config('statement_timeout', ...)`;
the row cap wraps the caller's query as `SELECT * FROM (<query>) AS counselle_query
LIMIT db_row_cap + 1` and reports truncation when the extra row is present; the
serialized-result cap rejects a response whose JSON encoding exceeds
`query_database_max_bytes`.

### Coverage denominator recipe

Any cross-school aggregate or ranking must state covered/total, never just the covered
count. `fact_coverage` already has this precomputed per fact key — bind the ranked key
as a `fact_key = $n`/`IN` parameter so the guard can attach a real denominator; an
inlined literal or an unresolved string earns none:

```sql
SELECT schools_with_value AS covered,
       (SELECT count(*) FROM cds_library.school_profiles) AS total,
       computed_at AS as_of
FROM cds_library.fact_coverage
WHERE fact_key = $1
```

The total is every profiled school, not the view's own `schools_total` (only the
schools with a CollegeData crawl): a ranking is out of all the schools Counselle
knows, and the coverage block `query_database` attaches uses the same total.

### Numeric candidate filter

```sql
SELECT f.school_id, p.name, f.value_num, f.display, f.observed_at
FROM cds_library.school_facts_sql f
JOIN cds_library.school_profiles p ON p.id = f.school_id
WHERE f.fact_key = $1 AND f.value_num IS NOT NULL
ORDER BY f.value_num ASC
LIMIT $2
```

This produces a candidate list, not a citation: re-fetch each finalist's real value
through `get_facts` for its typed display string, vintage, and citation before telling
the student a number.

`school_explore` carries already-typed, already-numeric filter columns (admit rate,
cost, test-score bands, majors, and more) for joins that don't need a `fact_key` at
all:

```sql
SELECT p.name, e.admit_rate
FROM cds_library.school_explore e
JOIN cds_library.school_profiles p ON p.id = e.school_id
WHERE e.control = $1 AND e.cost_attendance_out_of_state < $2
ORDER BY e.admit_rate ASC LIMIT $3
```

### Majors membership

A school's major list has no standard vocabulary, so a `majors @> ARRAY[...]`
membership test always carries the `academics.undergraduate_majors` denominator and a
printed-name-match caveat — a match is a match on the school's own printed name, never
a normalized taxonomy:

```sql
SELECT name FROM cds_library.school_explore WHERE majors @> ARRAY[$1]
```

### All-schools deadline aggregates

The calendar's all-schools layer queries every school's published round deadlines
for the current admissions cycle, applying the `inherited_date` rule (honesty for
recency and cycle-match) and the `OFFERED_KEY_FOR_DEADLINE` not-offered rule (§1):

```sql
SELECT school_id, fact_key, value_date, value_bool, reported_period, observed_at
FROM cds_library.current_school_facts
WHERE fact_key = ANY($1::text[])
```

where `$1` = the five round keys (`deadlines.early_decision`, `deadlines.early_decision_2`,
`deadlines.early_action`, `deadlines.early_action_2`, `deadlines.regular`) plus the
distinct values of `OFFERED_KEY_FOR_DEADLINE` (one per round). For each row: (1) drop if
its round's not-offered flag is `False`, (2) pass `fact` and `cycle_year` to
`inherited_date(...)` and drop on `None`, (3) resolve `name = catalog.school_name(id)`
and drop on `None`. Items are sorted by (date, school name); the client groups them
per (day, round). The response carries the coverage denominator (`schools_with_dates`,
`schools_total = catalog.school_count`) and is cached `private, max-age=3600`.

### What never to select

- Binary or internal-provenance columns blocked by the guard (§6 above) — use
  `get_school_profile` for typed, decoded identity fields instead of a raw column.
  `bytea` hashes, where selectable at all, are binary 32-byte SHA-256 values, not
  preformatted hex strings.
- Raw, unprocessed rows presented directly to a student as a cited fact.
- An inlined fact-key literal with no `fact_key = $n`/`IN` binding — it earns no
  coverage denominator.

Examples above are schematic; bind all values as `$n` parameters.

## 7. Fallback ladder and hard prohibitions

The honest routing order is:

1. resolve an in-database school;
2. use the profile for stable identity/classification/contact/official links;
3. use `get_facts` for reported facts, disclosing the correct one of the five states
   for anything not a reported value;
4. when a fact is `not_fetched`, `not_published`, or `not_collected`, or the question
   is current-cycle beyond what the facts store holds, use the school's official
   site/search and disclose the fallback;
5. use guarded SQL only for rare candidate/aggregate work, with denominator honesty.

Never, from this path:

- read or write facts-store base tables directly — the agent's own connections hold
  only `cds_library_reader` and cannot write under any circumstance; the separate
  facts-crawl write path described in §1 is not reachable from here and is not an
  exception to this rule;
- treat the profile as current admissions, cost, aid, or outcomes data;
- synthesize a composite value from its parts (§3) — a total's percentile, a
  distribution's missing bucket, or a printed average, when the school did not publish
  that exact number;
- collapse `not_reported`, `not_fetched`, `not_published`, and `not_collected` into one
  undifferentiated "missing" — each is a different claim (§3);
- convert an absence to zero, or infer a value the school did not publish;
- expose a source label, a source tier, or a page excerpt on any `db` citation, or
  attach lineage (snapshot id, mapper version, raw page body) to any student-facing
  surface, log, or receipt;
- write a `fact_key LIKE`/`ILIKE` pattern, or select through `current_school_facts`,
  from `query_database`;
- cite an aggregate as if it were a source-reported school value.

The data is the product. If the contract cannot support a claim, say what is known,
what is unavailable and why (in the exact words of §3's five states), which population
was checked, and where the answer falls back to an external source.

## 8. Configuration reference

Every crawl-behavior knob a dev might tune is a named `Settings` field
(`config/settings.py`), never a literal repeated across files:

| Setting | Default | What it controls |
|---|---:|---|
| `facts_worker_enabled` | `false` | Whether the in-process crawl-pass worker starts at all. |
| `facts_stale_days` | `120` | Age (days) past which an observation earns the `stale_facts` caveat. |
| `facts_crawl_rps` | `1.0` | The shared token-bucket rate every CollegeData request obeys (the R0 rate-limit mitigation). |
| `facts_crawl_request_timeout_s` | `20.0` | Per-request httpx timeout. |
| `facts_crawl_user_agent` | a `CounselleBot/1.0` string with a real contact URL | The self-identifying `User-Agent` every request carries; boot-validated to not still be the placeholder. |
| `facts_crawl_max_build_rotations` | `3` | How many Next.js `buildId` rotations one pass tolerates before aborting. |
| `facts_crawl_max_response_bytes` | `20,000,000` | Hard ceiling on any single fetched response, after decompression. |
| `facts_worker_poll_seconds` | `30` | How often the poller sweeps expired leases and checks for claimable work. |
| `facts_crawl_lease_seconds` | `180` | A claimed job's lease window before it is considered abandoned. |
| `facts_crawl_interval_hours` | `24` | How often a new crawl pass is auto-enqueued. |
| `facts_spread_days` | `30` | How far apart two facts' `observed_at` values must be to earn the `observed_at_spread` caveat. |
| `facts_failure_threshold` | `3` | Consecutive per-page fetch failures before a page is skipped for the rest of a pass. |
| `facts_snapshot_retention_per_page` | `3` | How many `page_snapshots` rows are kept per `(school_id, tab)`. |
| `facts_retirement_max_fraction` | `0.10` | Above `facts_retirement_min_floor` live crosswalk rows, the largest fraction one pass may retire. |
| `facts_retirement_min_floor` | `50` | Below this many live crosswalk rows, the retirement ceiling is not enforced at all. |

## 9. The retired CDS extraction pipeline (parked, not deleted)

An earlier design read structured school data from a curated, human-reviewed
extraction of uploaded Common Data Set PDFs into a five-view read contract
(`active_cds_documents`, `active_cds_domain_packets`, `cds_document_sources`,
`cds_manifest_snapshots`, plus `school_profiles`), gated by a manifest/packet
anti-corruption boundary and page-level evidence citations. That system's runtime role
is superseded by the facts store above — it never reached more than a handful of
schools, while a free, code-typed, daily scrape reaches every school CollegeData
publishes — but the system itself is **parked, not retired**: it represents real,
evaluated engineering that is not thrown away on the chance a document-grounded,
higher-fidelity source is worth its cost again.

What "parked" means, concretely:

- **Its code stays in-tree and importable.** `domain/cds/`, `app/cds/`,
  `adapters/cds_*`, `api/routes/cds_admin.py`, `counselle_db/packets.py`, and their
  frontend counterpart under `frontend/src/features/cds-admin/` are unchanged, on
  disk, at their original paths. Their own unit tests keep running and keep passing.
- **Nothing is mounted or started.** `api/main.py` does not import or route to the CDS
  admin router, and does not start the CDS extraction worker. The kill switch is
  `COUNSELLE_CDS_WORKER_ENABLED=false` (default), not an unset pipeline DSN —
  `COUNSELLE_DB_PIPELINE_DSN` is repurposed to drive the facts crawler described in
  §1, and the two systems are mutually exclusive on that one DSN by design.
- **Its live database tables are dropped; its DDL and its data are both preserved.**
  The seven CDS-specific `cds_library` base tables (`cds_documents`,
  `cds_domain_packets`, `cds_extractions`, `cds_manifests`, `cds_school_years`,
  `ct_index_entries`, `ct_index_state`) no longer exist in the live database.
  `deploy/seed/parked/cds_extraction_schema.sql` is their DDL, moved verbatim (base
  tables, the four CDS-specific reader views, shared helper functions, the three
  immutability triggers, and `cds_library_app`'s old grant on these tables only —
  never on `schools` or `school_profiles`, which this file does not own). Both a
  data-only dump and a full pre-cutover schema dump exist and are restore-verified;
  see `PARKED.md` for their exact locations and the full revival procedure.
- **`schools` is the one pre-existing `cds_library` table that survived unchanged in
  shape** — it is redefined as part of the live seed above and remains live
  throughout; it was never a CDS-specific table.

`PARKED.md` is the authoritative, continuously-maintained register of every parked
file, every import edge into the parked tree, and the exact steps to revive it. Read
it — not this section — before touching anything under `domain/cds/`, `app/cds/`,
`adapters/cds_*`, or `counselle_db/packets.py`; this section exists only so a reader of
this guide knows the parked system exists and where to look, not as a second source of
truth for its state.

## 10. Counselle-owned shapes that are contracts

Everything above is `cds_library`, read over `COUNSELLE_DB_RO_DSN`. This section is a
different region of the same server: `counselle.*`, owned by `COUNSELLE_DB_APP_DSN` and
defined by this repo's `migrations/`. Most of that schema needs no contract here — a
column is whatever the migration and the typed service model say it is. Two shapes do,
because more than one component has to agree on them without a type to enforce it: a
jsonb array whose element shape crosses the server, the wire, and a ProseMirror plugin,
and a uniqueness rule that only a partial index makes true.

### `counselle.essays.suggestions` — the pending review queue

`jsonb NOT NULL DEFAULT '[]'` (`migrations/0007_workspace.sql`). An array of pending
agent-proposed edits, appended by a `suggest`-mode `edit_essay`/`write_essay`
(ADR 0030's amendment, ADR 0037) and drained on accept/reject. Every element:

| Key | Type | Contract |
|---|---|---|
| `id` | string (uuid) | Minted server-side. The accept/reject route's path parameter. |
| `old_text` | string | The markdown span to replace. **Never empty in practice**, by two mechanisms that meet: suggest mode only runs on an essay with content (one that is still empty is written directly, since a first draft has nothing to review against), and an empty anchor matches everywhere in a non-empty document, so validation refuses it as ambiguous before it can be stored. Do not add a code path that stores an empty anchor — it can be located nowhere and everywhere at once. |
| `new_text` | string | The markdown to put in its place. Empty means *delete the matched text*; this is the only thing that distinguishes a deletion from a replacement, and no `kind` field is stored. |
| `old_text_plain` | string | `old_text` with markdown syntax stripped (`essay_markdown.to_plain_text`). |
| `new_text_plain` | string | `new_text`, likewise. |
| `rationale` | string | One short line on why, shown beside the change. May be `""`. Never essay prose. |
| `actor` | string | `"counselle"` for every row written today; present so a future student- or third-party-authored suggestion is distinguishable without a migration. |
| `created_at` | string (ISO-8601, UTC) | When the batch was proposed. One value shared by every element of one `edit_essay` call. |
| `essay_version_at_creation` | string (ISO-8601) | The essay's `updated_at` when the suggestion was authored — the same token `expected_version` uses. Provenance, not a guard: it is recorded, never compared on the accept path. |
| `turn_message_id` | string (uuid) or null | The assistant turn that authored it, for traceability back to the conversation. Null outside a live turn (tests, CLI). |

Four rules govern the array, and code depends on all four:

- **The two spaces are not interchangeable.** `old_text`/`new_text` are markdown and are
  the *only* fields the server ever applies — accept runs `essay_markdown.apply_edits`
  in markdown space. The `_plain` twins are the *only* fields a client may anchor with:
  the live editor carries formatting as marks, so `"I love **pizza**."` never matches a
  document that reads `"I love pizza."`. They are produced by joining blocks with **no
  separator**, matching ProseMirror's own `textContent`; any other block separator on
  either side searches for a differently-shaped string and silently finds nothing.
- **Pending is the only state.** There is no `status` field. A resolved suggestion is
  removed from the array, so every persisted element is pending by definition, and a
  second accept of the same `id` is a 404 rather than a second application.
- **Staleness is derived, never stored.** A suggestion is stale when its anchor no longer
  matches the essay uniquely — zero matches or more than one. The server discovers this
  at accept time (`apply_edits` raises; the essay is left untouched and the caller gets
  422); the client discovers it by searching the live document for `old_text_plain` and
  finding no unique match, and paints the change inert rather than dropping it.
- **A batch is independently anchorable.** Every element must match the essay as it reads
  *now*, not only after a sibling element lands. `apply_edits` validates an `edit_essay`
  batch cumulatively, which is correct for a direct write that commits as one document;
  suggest mode therefore re-validates each edit against the original document and refuses
  the whole batch if one depends on another. Without that, accepting out of order would
  match different text than the agent described.

### `counselle.sessions.essay_id` — one durable thread per essay

`uuid NULL REFERENCES counselle.essays(id) ON DELETE CASCADE`
(`migrations/0020_essay_sessions.sql`), with:

```sql
CREATE UNIQUE INDEX sessions_essay_id_idx
  ON counselle.sessions (essay_id)
  WHERE essay_id IS NOT NULL;
```

**The invariant this index enforces: at most one session row may point at any given
essay, while any number of rows may point at none.** The unbounded `NULL` half is not
what the `WHERE` clause buys — Postgres treats `NULL`s as distinct in a unique index by
default, so a plain `UNIQUE (essay_id)` would already permit every main-chat session. What
the predicate buys is that the index covers only the rows the rule is about, that it is
immune to a later `NULLS NOT DISTINCT`, and — the load-bearing part — that it is an exact
conflict target.

That last point is why the index is not decorative:

- `app/sessions.py::get_or_create_essay_session` infers it with
  `ON CONFLICT (essay_id) WHERE essay_id IS NOT NULL DO NOTHING`; the predicate must
  match the index's for the inference to resolve. The insert *is* the concurrency guard:
  two racing first-opens of the same essay serialize, and the loser reads the winner's row
  instead of creating a second thread the student would silently lose half a conversation
  to.
- It is what makes "the conversation about an essay follows the essay" a database fact
  rather than a client-side convention — the panel's thread survives a different browser
  or device because it was never stored in one.

Ownership is enforced in the same statement rather than assumed by the caller: the insert
selects the essay row under the caller's `user_id` with `archived_at IS NULL`, so an essay
that is not this student's inserts nothing and matches nothing, and the caller gets a 404.

`essay_id IS NOT NULL` is also a filter, not only a key: `list_sessions` excludes these
rows, so an essay's panel thread never appears in the main chat list, and
`POST /v1/sessions/{id}/messages` refuses an essay-surface turn whose request names a
different essay than the session row does.

## 11. SAT practice — `counselle.sat_*`

A third, fully independent data region alongside the two above: not `cds_library`, and
not the workspace tables §10 describes contracts for. It is owned by
`COUNSELLE_DB_APP_DSN` (`counselle_app`, the same role that owns every other
`counselle.*` table — no new DSN, no new grant) and defined by
`migrations/0021_sat_practice.sql`. **The agent has no tool that reads or writes any of
it** — this is stricter than the read-only boundary the rest of this document describes;
there is no reader role for SAT data at all today, because nothing needs one.

### Schema

Two tables split a question's identity/classification from its content, so the
counts/session endpoints — hit on every filter click — scan a narrow table and never
touch TOASTed HTML:

| Table | Holds |
|---|---|
| `sat_questions` | Identity (`question_id`, `external_id`/`ibn` as natural keys), classification (`module`, `domain_cd`, `skill_cd`, `score_band`, `difficulty`, `program`, `item_type`), `in_bluebook`, source timestamps, `content_sha256`, `retired_at` |
| `sat_question_content` | `stimulus`, `stem`, `answer_options` (jsonb), `correct_answers` (`text[]`), `rationale` — one row per question, FK'd to `sat_questions` |
| `sat_question_aliases` | A non-canonical `question_id` for a content id filed twice under the source bank, resolving to its canonical row |
| `sat_bank_meta` | A single row: the currently-synced bank's `content_sha256`, `question_count`, `fetched_at`, `synced_at` |
| `sat_attempts` | One row per graded attempt: `user_id`, `client_attempt_id` (a retry-safe uniqueness key, `UNIQUE (user_id, client_attempt_id)`), the question's classification **denormalized at attempt time**, the graded verdict, timing, `local_date` |
| `sat_bookmarks` | `(user_id, question_id)` primary key |

Every `question_id`-typed column is `text COLLATE "C"` — independent of the server's
locale, so joins, `ORDER BY`, and `DISTINCT ON` never disagree about ordering; every id
in the bank is 8 lower-case hex characters, for which any collation would agree, but the
explicit collation makes that a guarantee rather than an accident.

`sat_attempts` and `sat_bookmarks` deliberately carry **no foreign key** to
`sat_questions`. An attempt is a historical fact about what the student saw — a later
College Board reclassification of a question's skill or band must never silently rewrite
past analytics — and an imported `.liprep` progress file may name question ids the
current bank does not hold. The one place integrity is enforced is at write time:
`POST /questions/{id}/attempts` can only insert an id it just loaded from the live
schema.

Enumerated columns (`module`, `source`, `item_type`, `difficulty`) are validated in
application code (`Literal` types), matching every other `counselle.*` table.
`sat_attempts.module` / `domain_cd` / `skill_cd` are the deliberate exception: they are
free text, because an imported progress log may carry unknown or empty classification
codes, and the statistics function has defined behavior for both (an unrecognized code
does not contribute to the eight-domain rollup; an empty code is its own bucket).

### The write path: `bank-sync`

`counselle.sat_*` has exactly one writer path, and it is not a live crawler. A CLI
pipeline (`python -m app.sat fetch | build | audit`, run offline, entirely outside the
running application) produces a versioned seed file, `deploy/seed/sat/bank.jsonl.gz`
(`sat_bank_path` in Settings). `bank-sync` (`app/sat/bank_sync.py`) is what actually
writes the database, and it runs on **every application boot**
(`scripts/entrypoint.sh`, after migrations apply; `scripts/dev.py`'s `run_stack`) — never
at request time, never on a schedule, never in response to student activity.

The whole sync is one transaction, opened under
`pg_advisory_xact_lock(hashtextextended('sat_bank_sync', 0))` so two application
instances booting concurrently serialize instead of racing on the upsert; the lock
releases automatically at commit or rollback. It is a no-op — two cheap `SELECT`s,
nothing else — when the bank file's sha256 and row count already match
`sat_bank_meta`. Otherwise it verifies the file's hash against its own `MANIFEST.json`,
then `executemany`-upserts questions → content → aliases in that FK order (never one
giant multi-row statement over ~13MB of HTML, which would risk the connection pool's
statement timeout), sets `retired_at` on any live row absent from the new bank, clears
`retired_at` on any row that returns, and writes the `sat_bank_meta` row. **It never
deletes a row** — attempts and bookmarks reference question ids, and a retired question
stays fully readable by direct id lookup (`/questions/{id}`, `/session?question=`), it
just drops out of filtered listings and counts.

A missing bank file is a boot-time warning, not a failure — the application starts on
whatever bank it already has in the database.

### The retirement safety guard

`_check_retirement_is_safe` (`app/sat/bank_sync.py`) refuses — raising, aborting the
whole sync transaction, changing nothing — to retire more than **30%** of a populated
`sat_questions` table (50 or more live rows) in a single sync. A real College Board
refresh retires at most a handful of stale ids per pass; retiring a large share of a
populated live table in one sync is the signature of the wrong file being synced against
real data (a fixture bank, a build that silently produced an empty or truncated file),
not an intended refresh. Below the 50-row floor the check does not apply, so a small
dev or test database can still be freely rebuilt end to end. A refusal is caught the
same way `bank-sync` catches every other sync failure: logged, nothing changed, boot
continues on the bank already in place — never a reason to fail the boot.

This guard exists only in code, as a pair of module constants in `bank_sync.py`
(`_RETIREMENT_GUARD_MIN_LIVE_ROWS = 50`, `_RETIREMENT_GUARD_MAX_RATIO = 0.3`), not as
`Settings` fields — unlike the structurally similar `facts_retirement_max_fraction` /
`facts_retirement_min_floor` pair §8 documents for the CollegeData facts crawler, which
this guard is modeled on.

### Relation to the reader/writer role split

Every other data region in this document is split across at least two Postgres roles —
`cds_library_reader` for the agent's read path, `cds_library_app` for a writer — because
the agent needs to read what a separate writer produces. SAT practice has no such split
because it has no reader on the agent side at all: `bank-sync` and every
`api/routes/sat.py` route run on the same `counselle_app` role/DSN that owns every other
`counselle.*` table, the same way `counselle.tasks`, `counselle.essays`, and the rest of
the workspace schema do. The isolation that matters here is not role-based; it is that
no code path anywhere hands `counselle.sat_*` access to the agent's tool surface.

## 12. Scholarships — `counselle.scholarship*`

Three app tables owned by `counselle_app` through `COUNSELLE_DB_APP_DSN`, created by
`migrations/0022_scholarships.sql`. Not `cds_library`; the agent reads them only through the
in-process `search_scholarships` tool, on the app pool, published records only.

| Table | Holds |
|---|---|
| `scholarships` | One record: `status` (`draft`/`published`/`archived`), an integer `version` for optimistic concurrency, the editable fields as flat columns (award, deadline, requirements), `eligibility` and `essays` as `jsonb` arrays, `last_checked_on` (null = never checked), `created_by`/`updated_by` (FK to users, `SET NULL`) |
| `scholarship_saves` | `(user_id, scholarship_id)` primary key; cascades from both sides |
| `scholarship_revisions` | One row per admin write: the version after it, the action, a `jsonb` snapshot of the editable fields plus status, the actor (`SET NULL`); `UNIQUE (scholarship_id, version)` |

- `scholarships_published_is_complete` refuses a published row with a blank name or sponsor,
  a non-`http(s)` apply or source link, a null `last_checked_on`, a missing fixed amount or
  range bound, or a fixed deadline with no date. A CHECK passes on NULL, so each nullable
  column it reads is tested with `IS NOT NULL` explicitly. The service runs the same rules
  first (`domain/scholarships/publish.py`); the constraint only fires on a bug there.
- Records are never hard-deleted: archiving keeps saves and history.
- Deleting a user removes their saves and leaves scholarships and revisions, with the actor
  columns set to null.
- No extra indexes: the published list is a few hundred rows, the saves primary key covers
  "my saves", and the revisions unique key covers history.
