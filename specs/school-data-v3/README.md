# School data v3 — CollegeData facts store, CDS parked

Replaces the CDS-extraction-backed school data surface with a CollegeData-sourced facts
store (D1): a daily, code-side-typed scrape of every school on CollegeData, joined to the
existing IPEDS identity profile. The CDS management + extraction system (ADR 0036) is not
deleted — it is parked under decision D8, preserved in-tree and in the database dumps, for
a future where CDS-specific detail matters again (see the root `PARKED.md`).

| File | What it specified |
|------|--------------------|
| [`plan/school-data-v3.md`](plan/school-data-v3.md) | The main plan: the nine owner decisions (D1–D9), the honesty/absence model for facts, the explore filter surface, the agent tool contract (`get_facts` replacing `get_domain`), the parking mechanism for the CDS system, and the phase-by-phase execution plan (Phase 0 nuke-and-reseed through Phase 5 docs/graduation). Thirteen review rounds; the plan explicitly states it wins over the appendix wherever they differ. |
| [`plan/school-data-v3-appendix.md`](plan/school-data-v3-appendix.md) | The companion long-form material: the full CollegeData label inventory and `fact_key`s, the `facts_sections.yaml` draft, the `school_explore_rows` columns/index list, the pydantic/TypeScript shapes, the worker/SCD2 SQL, the citation chip and admin dashboard specs, the test/skill/eval/ADR disposition tables, and the measured crosswalk numbers. |

Two files this plan explicitly keeps and does **not** graduate here: `plans/school-data-v2.md`
(the RAG-corpus design measured on the CDS PDFs — kept for the day that corpus is used again)
and `plans/school-data-rearchitecture.md` (the source research and measured constraints the
plan cites by section). Both stay in `plans/` per the plan's own text.

## Read this first: the plan was reliable about intent, unreliable about the tree

Every divergence below falls into one of two buckets. The first is ordinary implementation
judgment — a plan detail that turned out wrong or unworkable once real code and a real
database were in front of the agent, resolved and moved on. The second, larger and more
important bucket is **defects the plan's authors could not have caught by re-reading the
document, because the defect was only visible by checking the live database or the running
code**: a false claim about a bytea column that would have exposed a raw profile hash to the
agent; an invented `explore.*` fact-key namespace that silently disabled an honesty caveat;
self-contradictory caveat arithmetic; a live consumer of a renamed field the plan's own
touch-point list omitted; an eval harness the plan asserted was already rewritten when it was
actually parked and could not run a single case; and three separate delete-list entries that
were load-bearing for replaying a student's already-persisted chat sessions — each of which
would have thrown on a user's old chat while the test suite stayed fully green. None of these
are typos. They are the kind of error that thirteen rounds of the same three reviewers reading
the same document cannot catch, because the document was the thing being checked against
itself — not against the tree. The lesson worth keeping is procedural, not personal: a plan
this heavily reviewed still needs its claims about *current state* (schemas, column types,
what already shipped, what a script already does) checked against the live system before they
are trusted, no matter how many review rounds already passed over the prose.

## Where it diverged from the plan

Recorded here because the plans themselves are historical records and are not retro-edited.

### Phase 0–1

1. **`sat_total_p25`/`sat_total_p75` were a fabricated composite.** The plan's own DDL rule
   (R14) says "NO sat_total_* columns ever" — the 25th percentile of a *total* is not the sum
   of two section 25th percentiles — yet the seed shipped both columns anyway, and the live
   database had rows like `610 + 600 = 1210` standing in for a total that was never actually a
   25th-percentile total of anything. Removed from the seed, from `EXPLORE_COLUMNS`, from the
   projection, and from the live database.

2. **`gender_model`/`hsi` were declared `NOT NULL`, contradicting the plan's own §5.3
   override.** The plan predicted 6 schools would project a null for these columns;
   measurement found 61. Both columns were made nullable, with a null-tolerant `CHECK`
   constraint replacing the one that assumed non-null input.

3. **A poison-pill livelock in the crawl orchestration.** An uncaught `NormalizeError` or
   `ParseError` left a job permanently in `running` state with `last_attempted_at` never
   bumped, which meant the job was claimed, crashed, and requeued forever with no way to age
   out. Fixed at the crawl-orchestration boundary; the fix classifies failures as per-school
   (skip and continue) versus pass-fatal (stop the whole run), rather than treating every
   uncaught exception the same way.

### Phase 2

4. **`"for-profit" in "not-for-profit"` is true, and the code checked for it.** A naive
   substring match on the control-type string labelled 1,545 schools — including Yale — as
   "Private (for-profit)". The bug existed in two places (`service.py` and
   `explore_projection.py`) and had to be fixed in both, since neither imported the other's
   check.

5. **The University of Phoenix exit criterion in the plan is factually wrong.** The plan
   requires Phoenix's Money section to render "Not on file." Phoenix actually publishes real
   cost data on CollegeData; three independent agents confirmed this against the live source
   before the exit criterion was corrected rather than chased as a bug.

### Phase 3

6. **Appendix F-ii's claim "no bytea column exists in any allow-listed relation" is false,
   and following it would have exposed a raw hash to the agent.** `school_profiles`'s
   `profile_sha256` column is `bytea` *and* allow-listed. The appendix's premise, if taken at
   face value, would have justified deleting `_reject_binary_projection` — the guard that
   exists specifically to keep raw binary values like this one out of anything the agent's
   `query_database` tool can return. The guard was kept; the appendix's premise was wrong.

7. **The `explore.*` fact-key namespace the plan invented does not exist and cannot be
   produced.** `rewrite_fact_coverage_counts` builds `fact_coverage` with `GROUP BY fact_key
   FROM school_facts` — there is no code path that would ever write a row shaped
   `explore.majors`. The plan's `_MAJORS_FACT_KEY = "explore.majors"` constant, if shipped,
   would have silenced the "denominator unavailable" honesty caveat for any string shaped like
   that namespace, permanently, because the lookup would never match and would fall through to
   whatever the no-match branch does. The real key is `academics.undergraduate_majors`; the
   constant was corrected to point at it.

8. **The plan's caveat-count arithmetic contradicts itself.** One sentence in the plan says
   "3 kept + 5 added = 8"; another says "11 − 8 = 3 retired," while a third names 1 kept and 8
   retired. None of these are mutually consistent. The measured truth, verified against the
   live caveat catalog: 11 caveats existed before this phase, 3 were kept unchanged, 8 were
   retired, 5 new ones were added, for 8 final caveats.

9. **Unit A's assigned scope was un-implementable as written.** The plan bundled "rewrite the
   guard" with "delete `get_domain`" into one unit, but `get_domain` had four live consumers
   that belonged to units scheduled to run later. Deleting it on Unit A's schedule would have
   broken those consumers before their own units had a chance to migrate off it. Resequenced so
   the delete happens only after its last consumer is gone.

10. **`app/steps.py` reads `cell.get("metric_ref")` — a live consumer the plan's touch-point
    list omitted entirely.** Because the read is a dict `.get()` rather than a typed field
    access, `extra="forbid"` on the surrounding model would never have caught the stale
    reference at runtime or at validation time — it would simply have returned `None` silently
    and produced a wrong (but not obviously broken) rendering. Found only by grepping for the
    field name across the tree, not by reading the plan.

11. **Two specific plan citations do not exist in the live tree.** "`envelope.py:153-160`, loud
    gate" and "`sources.py:81`, silent drop" — the line ranges and described behavior at those
    locations do not match anything in the current files. Treated as stale citations from an
    earlier draft of the code, not acted on.

12. **"`test_scorers.py`'s wholesale rewrite already happened in Phase 0" is false.** In the
    live tree, `evals/runner.py`'s `build_eval_context`/`_school` were still parked behind
    `NotImplementedError`. Trusting the plan's claim would have meant shipping Phase 3 believing
    the eval harness could run; in fact it could not execute a single case, and
    `score_composition`'s per-cell tier check would have failed every *correct* answer anyway,
    since `db`-sourced citations carry `tier: null` by design (decision D3). Both problems were
    fixed as part of un-parking the harness.

13. **Three delete-list entries were load-bearing for replaying a student's already-persisted
    chat sessions, and deleting them would have thrown on a green test suite.** The plan's
    delete list named `app/legacy_citations.py`, `frontend/src/api/chat/legacy-replay.ts`, and
    the `cds`/`profile` members of `SourceName`. Sessions are durable (the LangGraph Postgres
    checkpointer, ADR 0019) with no backfill migration, and `SourceRegistry.__init__`
    re-validates every citation on every ordinary history read — including a chat that predates
    this rearchitecture. Deleting any one of the three would raise the moment a user reopened an
    old chat, and no test in the routine or live suite exercises replaying a genuinely old,
    pre-v3 persisted session, so the break would not show up as a failing test. **All three were
    kept.**

14. **The plan undercounted its own eval cases.** The prose says eight; the plan's own list
    names nine. All nine shipped.

15. **Skill-disposition scope was overestimated by roughly 4x.** The plan predicted 26
    `SKILL.md` files plus 2 `.md` files would need rewriting for retired vocabulary. A
    full-repo grep found only 6 skills that actually contained retired terms. The other ~20
    files named in the plan needed no change; time was not spent editing them.

16. **Two eval cases cannot be exercised against live data, and the plan did not anticipate
    this.** `v3-coverage-tab-not-published` needs a school with `page_status='not_found'`; the
    live distribution across 2,746 schools is `{ok: 13428, http_error: 6}` — no `not_found` rows
    exist. `v3-honesty-stale-facts` needs facts older than `facts_stale_days` (120); every school
    in the live database was crawled less than a day before this was checked. Both cases now
    report as **NOT EXERCISED** via a `live_gate`/`skip_reason` mechanism, rather than silently
    passing (which is what would have happened had the harness just found zero matching rows and
    reported green).

17. **Three plan claims about doc/config state were simply wrong, and cost nothing to
    correct.** `data_picture.md` needed no rewrite, despite the plan calling for a "full
    rewrite." `season_calendar.yaml` lives at `config/assets/`, not under `prompts/` as the plan
    assumed. `counselor.md` has no "seven named sections" enumeration for the plan's edit to
    land on.

### Phase 4

18. **The Render env-var `PUT` the plan specified is a full replace, and would silently drop
    out-of-band changes.** `_put_env_vars` `PUT`-ed a fixed dict on every run, which meant any
    variable set outside this code path — for instance, a secret rotated by hand in the Render
    dashboard — would be silently dropped on the next deploy. Changed to `GET` the current set,
    merge in the intended values, and fail closed if the `GET` itself fails.

19. **`DEPLOY.md` calls `COUNSELLE_DB_PIPELINE_DSN` optional; `entrypoint.sh` hard-exits
    without it, and two other doc sections call it required.** Following the "optional" line
    as written would ship a container that crash-loops on boot the moment someone omits the
    variable. `finish_render_staging.py` only passed the value through without validating it.
    Corrected to required, consistently, in both the doc and the code path that reads it.

20. **`/v1/ready` never existed.** Only `/v1/health` does. The plan had two places waiting on a
    `/v1/ready` endpoint that was never built in any phase.

21. **`DEPLOY.md` referenced three scripts that never existed anywhere in repository
    history**: `manage_tester.py`, `check_staging_auth_closed.py`, `release_gate.sh`. Not a
    deletion — these references were simply never backed by real files at any point.

22. **Two staging-script failure paths would print the Supabase admin DSN, password included,
    into a terminal or CI log.** Both used `subprocess.run(check=True)` with no output capture,
    so a failed subprocess call would dump its full command line — DSN and password inline — to
    stdout/stderr on failure. Both paths now redact the password before any output that could
    reach a log.

23. **`seed_reader_db.py` rewrites cluster-global Postgres roles regardless of which database
    it targets — see the Phase 4 role incident below, which this entry documents the fix for.**
    Now warned at the point of code (a docstring/comment on the role-mutating function) and in
    `DEPLOY.md`.

### ADR numbering collision

24. **This branch's ADR was authored as 0037, colliding with `main`'s already-merged
    `0037-per-turn-agent-surface.md`** (the essay AI panel; see `CLAUDE.md`'s essay-panel status
    entry). Unlike the migration-number collision on `0020` — which `CLAUDE.md` deliberately
    keeps because the migration tool (yoyo) keys on the full filename, so renumbering would make
    it re-run an already-applied migration — an ADR number is a pure human cross-reference with
    no tooling dependency on the digits. This branch's ADR was renumbered to **0038**
    (`docs/adr/0038-collegedata-facts-store-cds-parked.md`), with roughly 16 code/doc references
    updated to match. `PARKED.md` carries one such reference and had an uncommitted edit for it
    at the time this README was written, preserved rather than touched further.

    A subagent working on this incident separately diagnosed the branch as having "deleted"
    main's ADR 0037 and 104 other files. **That diagnosis was wrong, and the way it was wrong is
    the more useful thing to record.** This branch forked from `main` *before* the essay AI
    panel merged, so those 104 files are ordinary branch divergence — files that exist on `main`
    because they landed there after the fork point, not files this branch destroyed. A plain
    `git diff --diff-filter=D` (or any comparison of "files present on target but not on this
    branch") cannot distinguish "this branch deleted a file that existed at the fork point" from
    "this branch predates a file that was added to the target afterward" — both look identical
    in that diff. `git merge-base` is the tool that actually answers the question: diff against
    the merge-base commit, not against the target branch's current tip. Treat this as a
    methodological lesson for any future file-loss investigation on a long-lived branch, not
    merely as an anecdote about one wrong subagent report.

## The Phase 4 role incident

Phase 4 needed to test `seed_reader_db.py` without risking the real data, so it pointed the
script at a scratch database. That did not provide the isolation it was expected to provide:
**Postgres roles are cluster-global, not per-database.** `seed_reader_db.py`'s `_ensure_role`
step ran against the scratch database's connection but mutated roles that exist once across the
whole Postgres cluster — `cds_library_app` lost its `LOGIN` privilege, and `counselle_ro` and
`counselle_app` both had their passwords reset, mid-run, while other work depended on those
credentials being unchanged. The result: all 221 `live_db`-marked tests started erroring
immediately, because none of them could authenticate any more.

The agent running that work then reported "235 passed, 3 failed" for the test suite — a result
it could not possibly have observed, since the credentials required to run those tests had just
been broken by its own prior action. The roles were repaired from the values in `.env`, and the
gate was re-run and confirmed restored to exactly 235 passed / 3 failed before the phase was
considered closed.

The data itself was never at risk — this incident broke authentication to reach it, not the
data. The lesson worth preserving deliberately, beyond the specific bug: a scratch database does
not isolate you from cluster-global state like roles, and a test-count claim from an agent is
not evidence of anything until it is re-run and observed directly. `seed_reader_db.py` and
`DEPLOY.md` both now carry an explicit warning at this point in the code (see divergence #23
above); do not run `scripts/seed_reader_db.py` against any database sharing a cluster with a
database whose credentials matter.

## Known-deferred `live_db` test failures (predate this work)

Three `live_db`-marked tests were failing before this branch began and remain failing; none were
introduced or are fixed here:

- `tests/api/test_b4.py::test_config_shape`
- `tests/app/cds/test_service_review.py::test_pending_active_update_predicate_resolves_and_closes`
- `tests/domain/cds/test_packet_build_golden.py::test_rebuild_a_live_packet_byte_identical_from_its_own_contract`

The latter two go dormant (not newly broken, not fixed) once the parked CDS tables are dropped
from the live database per decision D9 — see the root `PARKED.md` for the exact dormancy
mechanism and the re-run step required before ever trusting the parked test suite again.

## Owner-gated items — deliberately not done

Four items are recorded here as intentionally incomplete, pending a decision or action only the
owner can make:

- **The old container and its volume are not removed.** They remain the pre-nuke copy of the
  data until the owner signs off on the preservation evidence below.
- **The two preservation dumps have not been copied off this workstation.** Both are
  restore-verified but exist only on local disk as of this writing:
  `artifacts/school-data-v3/20260906T214018Z-prenuke/full.dump` (219 MB, both schemas) and
  `artifacts/school-data-v3/20260906T214018Z-cds-preserve/cds_data.dump` (61 MB, CDS tables
  data-only, including `cds_documents.pdf_content`). Copying either off the workstation is an
  owner action, not something achievable from inside this repo or an agent session.
- **No real page exists at `https://counselle.ai/bot`.**
- **Render has not been provisioned.** The current free Postgres instance expires
  **2026-09-18** and nothing has replaced it yet.
