# Phase 6 — Guidance, receipts, evals, and living documentation

## Mission

Teach the model only routing/composition behavior, keep truth in code, rebuild evals
around the new failure modes, and make living docs describe the shipped system. This
phase does not change the core data contract established earlier.

## Read first

- `specs/db-rewire/design.md` §§6, 8, 10–15.
- `config/assets/prompts/counselor.md`, `prompts/README.md`, `step_labels.yaml`, every
  current `skills/*/SKILL.md`, `app/skills.py`, both load-skill tool builders,
  `app/steps.py`, `domain/events.py`.
- Full `evals/questions.yaml`, `evals/runner.py`, latest report, judge prompt/models.
- `README.md`, `AGENTS.md`, `TODOS.md`, `docs/ARCHITECTURE.md`,
  `DATABASE_GUIDE.md`, `DEPLOY.md`, and all ADRs/index.

## 6.1 Counselor prompt

Rewrite `config/assets/prompts/counselor.md` while preserving voice, onboarding,
workspace, source gating, and safety behavior unrelated to the old DB.

Delete:

- static field map and sibling-field recovery;
- dossier shortlist/tool instructions;
- old coverage tiers and `is_tracked` phrasing;
- school-count/data-calendar slots;
- IPEDS/Scorecard/earnings/program/benchmark assumptions;
- old render `unitids/field_keys`, fetch behavior, and table echo;
- old field/tier prompt blocks.

Add the exact routing order:

1. resolve a DB school before school-specific reads;
2. identity, classification, contact, and official links -> profile;
3. metrics -> only domains listed as usable by coverage, through `get_domain`;
4. no first-party value -> official web/search, disclose the fallback;
5. cross-school/aggregate candidate selection -> parameterized `query_database`, state
   covered/total denominator, then re-fetch named final values through typed reads;
6. deadlines/current cycle/beyond CDS edition -> web even when a packet exists.

Add always-on composition laws:

- copy visible+internal markers verbatim; the runtime removes internal evidence tokens;
- student-facing named values use markers; live computed aggregates are explicitly
  labelled with as-of/denominator instead of receiving a fake citation;
- viz inputs are only metric/profile refs, registered external values, or explicit
  unavailable;
- correct rejected refs; never turn a rejection into unavailable;
- DB displays are copied, not paraphrased;
- mention caveat kinds when relevant, but never duplicate their canonical wording.

The prompt names caveat kinds only. It may disclose data coverage honestly while still
not narrating internal tool plumbing. Preload/strict-slot tests must prove the final
system prompt has only `{data_picture}`, `{temporal_context}`, `{student_context}`, and
`{subreddit_menu}`.

## 6.2 Tool docstrings and receipt contract

Docstrings are the model-facing API. For each of the four DB tools and `render_viz`,
pin inputs, output statuses, honest failure handling, and next action. No hardcoded
domains/groups/refs.

Update `config/assets/step_labels.yaml`:

- add/replace rows for `resolve_school`, `get_school_profile`, `get_domain`,
  `query_database`;
- delete every retired DB tool row;
- keep existing non-DB/workspace/search rows;
- keep `viz_labels` optional/generic for the open type set.

Rewrite `app/steps.py` receipts with only safe structural information:

```text
resolve_school:
  tool, query, result_count, schools?, duration_ms
get_school_profile:
  tool, schools, value_count, duration_ms
get_domain:
  tool, schools, domain_id, value_count, duration_ms
query_database:
  tool, row_count, duration_ms
render_viz:
  viz_type, value_count, schools, sources
```

Rules:

- domain `value_count` is authoritative availability `verified`, not `len(values)`;
- query receipt never contains SQL params/rows;
- no receipt contains packets, values, excerpts, diagnostics, coverage blocks, or
  provider metadata;
- resolve can derive safe schools from result because args have no unitid;
- source chips use official Catalog domains for DB schools only;
- `StepMapper.result_is_error` recognizes false `ok` and `error|rejected` status;
- overflow receipts preserve only status/result_count/schools/domain_id/value_count/
  row_count/ui;
- `StepDetail.domain_id` is singular CDS; `domains` remains Tavily hostnames.

Update `domain/events.py`, frontend types/validator, `step-receipts.ts`,
`AgentRunView.tsx`, and `ToolWidgets.tsx`. Independently pin the expected four DB tools
in a test; do not merely compare server and label sets, because two stale sets can agree.

## 6.3 Skills: exact final set

Final on-disk directories:

```text
skills/citation-and-recency/
skills/db-recipes/
skills/school-comparison/
skills/school-deep-dive/
```

Delete `decode-coded-value`. Replace/rename `dossier-assembly` to
`school-deep-dive`. Keep comparison/deep-dive public; citation/db-recipes internal.

### `citation-and-recency`

Teach:

- markers/displays copied verbatim and marker immediately after supported prose;
- CDS phrasing derives school, edition, page only from Citation/evidence;
- profile snapshot is identity context, not a current metric;
- caveat `text` is canonical; the skill explains when/how to voice each kind;
- template absence is neither zero nor not reported;
- sidebar/document/evidence behavior;
- official versus community tier treatment.

### `school-deep-dive`

Teach:

- resolve -> coverage -> relevant profile + at most the 2–3 domains the question needs;
- dynamic domain IDs only;
- no recreation of a fixed dossier shortlist;
- official profile links feed school-site fallback;
- no profile-as-current-metric;
- optional v2 card via verified channels; fix rejected refs.

### `school-comparison`

Teach:

- resolve all schools, then coverage/edition parity;
- same domain symmetrically per school;
- official web fallback for missing/current values;
- nullable web-only columns and unavailable holes;
- exact v2 grammar and all-or-nothing retry;
- mismatch/partial/stale caveats and ranking denominator;
- no product 6-school cap; keep the synthesis useful.

### `db-recipes`

Teach only rare-path SQL:

- exactly five schema-qualified views and `$n` parameters;
- typed-tools-first;
- manifest/domain/profile JSON paths;
- selected-edition and coverage denominator recipes;
- numeric packet candidates filter `verified + reported + JSON number`;
- refetch named final values through `get_domain` for evidence;
- never select full packet/provider contract/PDF bytes or expose raw rows as cited
  student truth.

### Loader compatibility

Fix the production duplication: `app/agent_node._make_load_skill_tool` must mount the
builder from `app/skills.make_load_skill_tool()` and preserve overflow middleware;
delete its handwritten stale menu. Update `app/skills.py` examples.

Add one non-advertised alias:

```python
{"dossier-assembly": "school-deep-dive"}
```

Canonicalize before visibility/duplicate checks and persist the canonical name. An old
and new alias in the same selection collide as a duplicate. The alias is compatibility
logic, not a fifth skill and not displayed in config. Test parked/resumed old selection.

## 6.4 Eval set rewrite

The current 57-question set is built around dead field keys/tier/breadth and must be
replaced, not patched. Preserve historical `evals/report-*.json` byte-for-byte.

### Eval categories

1. `routing`
2. `coverage_honesty`
3. `edition_caveat`
4. `composition`
5. `denominator_honesty`
6. existing useful `honesty`, `clarify_judgment`, `narration_quality`, and workspace
   categories that do not depend on old DB concepts.

Do not hardcode the full domain menu/counts in YAML. The runner creates `EvalContext`
from the current data picture: manifest, dynamic domains, covered/total, and selected
live fixture schools.

### Canonical case matrix

Include cases equivalent to:

- routing: profile identity/official link, admissions, enrollment, aid, cross-school
  SQL candidate shape, current deadline web;
- coverage: no-packet answer without fake data, official-web pivot, not-in-DB school;
- caveats: stale+partial packet, availability summary/template absence, profile
  snapshot, cross-edition mismatch;
- composition: same-domain DB comparison, mixed DB/web, null-unitid web school,
  unavailable hole, stat block;
- denominator: best aid, most selective, need-blind over covered set.

Use live-derived roles rather than permanent brand assumptions: choose a covered
stale/partial school, a profile-only school, and two schools with a common verified
metric at run start. A deterministic v8 fixture covers `not_in_template_version`; a
live case runs only when the current DB honestly contains it and otherwise records a
named skip.

### Runner/scorers

Delete old value-bearing tool lists, flat-field selection scorer, old tier scorer, and
v1 `viz['schools']` assumptions. Enrich event summary with:

- ordered tool calls, safe args, safe statuses, and durations;
- domain IDs and coverage results;
- caveat kinds;
- render columns/cells, source/tier/availability, and compact ack;
- marker presence and aggregate denominator/as-of statements;
- no payload values/excerpts in logs beyond what the judge needs.

Use deterministic code for tool order, domain selection, no-profile-as-metric, source
presence, cell provenance/tier, unavailable behavior, caveat kinds, denominator, and
no-old-tool assertions. Use the cheap judge only for phrasing/clarity. When a case has
criteria, build exactly one ordered verdict per criterion and fail on missing/extra
verdicts.

Tag comparison cases and report duration/input/output/tool-call median, p95, and max.
This is the evidence gate for reviving `compare_schools`; no intuition-based revival.

Run the eval baseline only after Phase 1 re-extraction and Phases 2–5. Review every
failure at the correct layer: routing prompt, phrasing skill/catalog, truth/code bug.

## 6.5 Full living-document rewrite

### `docs/DATABASE_GUIDE.md`

Phase 1 already replaced the old guide before data-layer implementation. Reconcile the
guide with the final code and live contract; do not defer its first rewrite to this
phase. Its required final content is:

- five-view schemas/permissions;
- identity and profile object groups/provenance/snapshot limitation;
- manifest 5.0.0/current pointer/dynamic domain and qualified-ref rules;
- packet v8 plus compatible legacy identifiers and anti-corruption invariants;
- selected-edition policy;
- every availability/extraction state and display rule;
- context binders/vintage and caveat catalog;
- coverage aggregate definitions;
- safe parameterized recipes for exactly five views;
- bytea/PDF/query limits;
- role/DSN boundaries and no pipeline imports;
- app-cycle `cycle_year` disambiguation;
- examples dynamically derived or clearly labelled snapshots, never canonical enums.

Compare every SQL recipe to live view columns and preserve the Phase 1 contract-first
history in the implementation log.

### `docs/ARCHITECTURE.md`

Perform a full sweep, not only §§8/10/11: system/data flow, stack, layout, MCP/service
surface, packet seam, catalog, field discovery removal, citations/evidence, temporal
context/data picture, coverage, search fallback, skills, viz v2, config, deploy,
testing, receipts, frontend source rail, risks, and feature matrix.

### ADR 0032

Add `docs/adr/0032-db-rewire-cds-library.md` with context, decision, alternatives,
consequences, migration/rollback, and these explicit supersessions/amendments:

- supersedes 0007 and 0008 fully;
- replaces old-data details in 0002, 0005, 0006, and 0012;
- amends 0014 for verified two-channel rendering;
- amends 0017 for the packet anti-corruption truth boundary and removed reconciler;
- retains/uses 0019's same-Postgres schema decision;
- amends 0024's closed RenderSpec set to the open known/opaque seam.

Add superseded banners only to 0007/0008; keep historical bodies unchanged. Update ADR
index and count.

### Other living docs

Update:

- `README.md`: corrected pipeline name, breadth, no pgvector prerequisite, setup,
  four-tool/data-picture model, commands;
- `AGENTS.md`: shipped stack/status, five-view contract, no old R1–R12 terminology,
  dynamic manifest, new skills/assets, source/citation/viz rules, role name;
- `TODOS.md`: remove/adjust obsolete reconciler/vector/data items; community card stays
  deferred and now references the open seam;
- `docs/DEPLOY.md`: no reconcile/embed first boot, new dual roles/DB/loopback/cutover,
  while production deploy B6 remains deferred;
- `config/assets/prompts/README.md` and skill docs/index;
- `specs/README.md` only after the implementation has shipped and this plan graduates.

Do not retro-edit shipped plan narratives or historical eval reports. The canonical
design remains the before/after decision record even though it names the old repo in
context.

## 6.6 Exit gate

Run:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check . && uv run mypy .
cd frontend && npm run typecheck && npm test && npm run lint && npm run build
uv run python -m evals.runner
```

Review the eval report manually for every canonical category, no uncited named values,
coverage denominator phrasing, caveat wording, mixed-cell tiering, and comparison
latency. Phase 6 is complete only when docs contain no live old-DB instruction and the
four-skill/tool menus exactly match disk/server reality.
