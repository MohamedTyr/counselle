# TODOS

## `cds_library.school_explore` view ownership drifted from the seed (live DB fix applied, source not)
- **What:** the live v3 database's `cds_library.school_explore` view was owned by `postgres`
  instead of `cds_library_owner`, so `cds_library_reader`'s (checked-in) `GRANT SELECT` never
  reached it and `GET /v1/schools/explore` could not read the view at all. Applied a same-session
  `GRANT SELECT ON cds_library.school_explore TO cds_library_reader` directly against the live DB
  to unblock Phase 2 verification — additive, no ownership change, no data touched. **This is a
  workaround, not a fix**: `deploy/seed/cds_library_schema.sql`'s `CREATE OR REPLACE VIEW` will
  fail again next time `scripts/seed_reader_db.py` runs against this database ("must be owner of
  view school_explore") until the view's ownership itself is corrected
  (`ALTER VIEW cds_library.school_explore OWNER TO cds_library_owner`, then re-run the seed).
- **Why:** likely created once by hand under the admin role during Phase 1's explore work rather
  than through the seed's `SET ROLE cds_library_owner` bootstrap. Fixing ownership is a live-DB
  schema change beyond school-data-v3 Phase 2's assigned surface; flagged rather than
  applied.
- **Context:** `deploy/seed/cds_library_schema.sql`'s `school_explore` view + its grant block;
  `scripts/seed_reader_db.py`'s always-run DDL phase.
- *(Logged from the school-data-v3 Phase 2 backend implementation, 2026-09-08.)*

## `counselle_db/service.py`'s 800-line breach is resolved — split landed in Phase 2, not Phase 3
- **What:** the SQL-guard split this TODO used to defer to Phase 3 has already happened, in Phase
  2's own commit `8bca991`. `counselle_db/sql_guard.py` now exists (692 lines) holding
  `_guard_sql`, `query_database`, the allow-lists, and the AST-walking helpers;
  `counselle_db/service.py` is down to 276 lines, well under CLAUDE.md's 800-line ceiling. The
  extraction was verified behaviour-preserving by AST-equality comparison against the pre-split
  code, and the callers this TODO worried about (`evals/runner.py`, and any others importing the
  moved names) were updated in the same commit.
- **Status:** closed. Nothing outstanding here.
- *(Logged from the school-data-v3 Phase 2 backend implementation, 2026-09-08; corrected the same
  day once the split landed in `8bca991`.)*

## Facts write can commit with no matching Explore row (pre-existing, deliberately deferred)
- **What:** in `app/facts/crawl.py::_process_school_live` (and `_process_school_remap`), the
  broad `except Exception:` sits *inside* the `async with pool.acquire() as conn,
  conn.transaction():` block, so it runs before the transaction's `__aexit__` — the transaction
  **commits** rather than rolling back. A failure occurring after `write_school_facts` has
  succeeded but before/within `project_explore_row`/`upsert_explore_row` would leave a committed
  `school_facts` row with no matching `school_explore_rows` row: a school that renders on its own
  detail page but silently disappears from Explore browse.
- **Why not fixed here:** predates school-data-v3 Phase 2 and was not introduced by it. It has
  never fired — facts and explore rows are at exact 2,239/2,239 parity today — and triggering it
  requires a bug that does not currently exist; the `UnmappedControlError` path specifically is
  provably zero-write, since `ipeds_filter_columns` raises before `write_school_facts` runs. The
  fix means restructuring the deliberately-designed poison-pill handler that already cost this
  project one livelock (`tests/adapters/test_crawl_poison_pill.py` is the regression coverage for
  that incident) — real regression risk for an issue that has never fired, and it does not force a
  future rewrite.
- **Context (start here):** `app/facts/crawl.py::_process_school_live` and
  `_process_school_remap` (the `except Exception:` inside the `async with pool.acquire() as conn,
  conn.transaction():` block); `adapters/facts_store.py::write_school_facts`. Minimal fix if it
  ever matters: re-raise (or roll back explicitly) before recording `mapper_error`, or move the
  explore-row upsert into a savepoint that reverts on any exception, not just the recognized type.
- *(Logged from the school-data-v3 Phase 2 audit, 2026-09-08.)*

## No range guard on the derived `need_fully_met_pct`
- **What:** `app/facts/explore_projection.py` computes `need_fully_met_pct` by regex-parsing
  leading headcounts out of two free-text CollegeData facts and dividing them. Nothing in code
  enforces the `[0, 100]` range — it holds only because of the current shape of the source text. A
  CollegeData format change could silently write an impossible percentage that a student would
  then see.
- **Why not fixed here:** verified safe today across all 1,425 populated rows — every distinct
  source value is digit-led, no zero denominators, observed range 0.019%-100.0%, and the computed
  ratio was cross-checked against the source text's own embedded percentage with zero mismatches.
  Flagged as the one spot in this area where upstream format drift is unguarded, not fixed
  preemptively for a shape that hasn't happened yet.
- **Context (start here):** `app/facts/explore_projection.py` (the `need_fully_met_pct`
  computation, and `merit_aid_pct`, which shares the same regex-divide pattern from free text).
- *(Logged from the school-data-v3 Phase 2 audit, 2026-09-08.)*

## School-page-slim: `school_requirements` migration is written but not applied
- **What:** `migrations/0019_drop_school_requirements.sql` (+ `.rollback.sql`) drops
  `counselle.school_requirements`, its two indexes, and the
  `protect_published_requirement_facts` trigger/function. It is written and reviewed
  but **deliberately not run against any database.**
- **Why:** per `CLAUDE.md` Status, the CDS extraction pipeline cutover (ADR 0036) is
  still awaiting owner acceptance, and the live `counselle`/`cds_library` databases are
  already drifted from source control pending that sign-off (see the sha256-index TODO
  below for the precedent this follows). Applying a second un-signed-off schema change
  ahead of that acceptance is the owner's call, not something to do inside a UI-slimming
  refactor. The table costs nothing to leave: it is empty in every real environment (the
  only `INSERT INTO counselle.school_requirements` in the repo is raw SQL inside a test
  fixture) and, as of this refactor, nothing in the app reads or writes it anymore.
- **Context (start here):** `plans/school-page-slim.md` Phase 3 and risk R2;
  `migrations/0019_drop_school_requirements.sql` for the drop and its ordering rationale;
  `migrations/0011_school_workspace.sql` lines ~100-224 for the original DDL the
  rollback restores.
- *(Logged from the school-page-slim refactor, Phase 3, 2026-09-04.)*

## School-page-slim: optional follow-up column removals
- **What:** `tasks.requirement_kind`, `applications.checklist`, `applications.platform`,
  and `applications.platform_other` are no longer driven by any UI surface after the
  school-page-slim refactor, but were all deliberately **kept** this round.
- **Why:** each is still a valid, server-validated API field with no orphaning risk —
  `requirement_kind` is free text with a regex `CHECK`, not a foreign key, so it can't be
  orphaned by the `school_requirements` drop above; `checklist` is the student's own
  tracking map on a separate validated patch path; `platform`/`platform_other` are
  validated by `_validate_platform_patch`. Removing the columns is a data-model decision,
  not a UI one, and none of them cost anything sitting unused. Only pursue this if the
  product decides those fields are gone for good — it would need its own migration.
- **Context (start here):** `plans/school-page-slim.md` Phase 2 step 3 and step 5;
  `app/workspace/service_applications.py` (`_validate_platform_patch`);
  `migrations/0011_school_workspace.sql` (original column definitions).
- *(Logged from the school-page-slim refactor, Phase 3, 2026-09-04.)*

## Identify the owner of `cds_deploy_export` / `cds_deploy_seed`
- **What:** two schemas exist on the live database (`cds_deploy_export`, `cds_deploy_seed`) that appear in no migration in either this repo or the retired `counselle-data-pipeline` repo. They contain static snapshot tables and are correctly inaccessible to `counselle_ro`, but nobody on this project knows what writes them.
- **Why:** an undocumented schema on a production database is a liability — it could be dead, or it could be a deploy-tooling dependency nobody's tracked.
- **Context (start here):** `specs/cds-pipeline/plan/CUTOVER.md` §4. Identify the owner and either document the schemas' purpose or remove them.
- *(Logged from the CDS pipeline ship plan, Phase 7, 2026-08-27.)*

## Archive the old `counselle-data-pipeline` GitHub repo
- **What:** mark the GitHub repo archived (read-only); the local clone stays, not deleted — it's the only record of how manifest `5.0.2` and packet v8 were originally produced, and the provenance of the pre-cut 1,149 metric definitions.
- **Why:** the in-app CDS pipeline (ADR 0036) has fully replaced it; the old repo's compute was decommissioned 2026-08-18. The archive action itself was deliberately left to the owner, not done by an agent session.
- **Context (start here):** `specs/cds-pipeline/plan/CUTOVER.md` §3. A provenance blockquote pointing at ADR 0036 was already added to the old repo's README (`517b85f`, committed but not pushed).
- *(Logged from the CDS pipeline cutover, 2026-08-18, deferred through Phase 7, 2026-08-27.)*

## `cds_max_pages_per_call` — deliberately not built
- **What:** a per-call page cap for CDS extraction, named in `specs/cds-pipeline/plan/PLAN.md` §I1 risk 6's mitigation list but never implemented.
- **Why:** page routing plus the 900s lease (with background renewal) already cover today's worst case — `ohio-state_2023-2024.pdf` (187 pages) completed cleanly twice, in 11m41s and 9m31s, well inside the lease window. A larger document than that could still need the cap; it isn't needed yet.
- **Context (start here):** `specs/cds-pipeline/plan/SHIP-PLAN.md` §4.5 (the resilience check that confirmed it isn't needed yet); `engine.py`'s `_route_domains`/`_route_batches` (the page-routing fallback that's carrying the load today).
- *(Logged from the CDS pipeline ship plan, Phase 4.5, 2026-08-27.)*

## Two known agent-behaviour eval gaps (CDS republish baseline)
- **What:** two eval failures reproduced across all three eval runs during the CDS Phase 4.2 baseline, neither caused by the republish or any commit landed this session:
  1. `guided-counselor` ends a turn on a bare `ask_student` tool call with no framing prose.
  2. `deep-research-triangulates` cites CDS for a deadline the eval prompt scoped to official-site-only.
- **Why:** recorded as known-open rather than fixed, since neither is a regression from this branch's work — (2) was only newly *visible* this session because a retry/backoff fix let that eval case run far enough to be scored on content for the first time.
- **Context (start here):** `specs/cds-pipeline/plan/CUTOVER.md` §"Phase 4 execution log" → "4.2 detail — eval baseline"; `evals/` for the eval definitions.
- *(Logged from the CDS pipeline ship plan, Phase 4.2, 2026-08-27.)*

## Per-metric recall re-measurement across the wider CDS corpus
- **What:** the CDS pipeline's per-metric recall was previously quoted at 65.6%, measured against the pre-cut, 1,149-metric catalog before deliberation tuning existed. That figure is retired — it describes a system that no longer exists. The shipped-configuration numbers that replace it (99.01% accuracy, 96.96% coverage, 4 known hallucinations) were measured on a five-document tuning corpus (UGA, Cornell, Caltech, UCF, Dartmouth) with **zero overlap** with the four documents actually shipped (Harvard ×2, Yale, UPenn).
- **Why:** the D18 escalation (`specs/cds-pipeline/plan/SHIP-PLAN.md` §0.12) accepted this gap on the strength of a hand spot-check of 11 metrics on one shipped document (Harvard 2025), which caught one real extraction error. That spot-check is directional, not a substitute for measuring recall on the corpus actually served to students.
- **Context (start here):** `specs/cds-pipeline/plan/CUTOVER.md` §7 (`D18`) and §6; `tuning/FINAL-REPORT.md` §11–12.
- *(Logged from the CDS pipeline ship plan, Phase 7, 2026-08-27.)*

## Dev-origin allowlist misses non-default Vite ports on a CDS admin write route
- **What:** `api/auth_security.py`'s `_LOCAL_DEV_FRONTEND_ORIGINS` allowlists only `http://localhost:5173/5174` and `http://127.0.0.1:5173/5174`. `auth_origin_protect` (which reads that allowlist) is wired as a dependency only on the upload-create route in `api/routes/cds_admin.py` (`POST /uploads`) — every other CDS admin write route uses `_write_deps`, which does not include it. A local Vite dev server running on a different port (e.g. 5175, picked automatically when 5173/5174 are already in use by another worktree) gets a 403 from that one route.
- **Why:** cost real debugging time twice in the same session before the cause (the hardcoded port list, not a broader auth bug) was identified.
- **Context (start here):** `api/auth_security.py:12-17` (`_LOCAL_DEV_FRONTEND_ORIGINS`), `api/routes/cds_admin.py:130-134` (the one route with `auth_origin_protect`) vs. `_write_deps` (`api/routes/cds_admin.py:81`, used by every other write route).
- *(Logged from the CDS pipeline ship plan, Phase 7, 2026-08-27.)*

## Implement the session-TTL cleanup job
- **What:** a periodic task that enforces `settings.session_ttl_days` — delete expired rows from `counselle.sessions` and their checkpoint data (by `thread_id`) from the LangGraph checkpointer tables.
- **Why:** the Settings surface ships the knob (ADR 0019 names retention as configurable) but nothing executes it; with the keep-everything default this is harmless for months, but a knob connected to nothing is config-surface debt.
- **Pros:** config honesty; disk hygiene before it's ever a problem.
- **Cons:** touches the checkpointer's internal tables (small coupling to library internals — re-verify table names on library upgrades).
- **Context (start here):** wire it into the API lifespan (`api/main.py`); the deletion is two statements inside one transaction; add a `cleanup: {last_run, deleted}` line to `/v1/health`.
- **Depends on / blocked by:** Phase 4 checkpointer landed (tables exist in `counselle.*` per eng-review D3).
- *(Logged from /plan-eng-review, 2026-06-10. Note: CI pipeline was proposed and explicitly declined by the user the same day.)*

## B2: parked-then-non-resume ghost (turn lifecycle)
- A parked thread whose next action is NOT a resume (e.g. a cancel racing in) can leave the parked record ghosted — B2's turn registry single-flight lock owns concurrent-turn lifecycle; do not guard piecemeal. *(Logged from B1b review fixes, 2026-06-13; see the `# B2:` comment in `app/run_turn.py`.)*

## B2: `_write_failure_record` double-failure corner
- If the failure write itself dies after the prose append lands but before the record write, prose exists without a record — same B2 owner as above. *(Logged from B1b review fixes, 2026-06-13; see the docstring note in `app/run_turn.py::_write_failure_record`.)*

## B2: queued next-turn auto-start (deliberate non-goal)
- No server-side auto-start of queued next turns after active run completion. The current behavior is client auto-forward after terminal; keep that handoff on the client side.

## sessions-list load-more (deferred from B5c)
- **What:** the sidebar sessions list (`GET /v1/sessions`) requests `limit=50` (the route's `le=50` cap) and treats that as the full list. Sessions beyond the 50 most-recent are not shown; there is no infinite-scroll / load-more / cursor pagination yet.
- **Why:** the route already returns a `next_cursor`; the FE just doesn't consume it. KISS for MVP2 — 50 covers the dogfooding window. Client-side grouping + search still work over the loaded 50.
- **Context (start here):** `src/api/http/sessions.ts` (`listSessions`, `SESSIONS_LIMIT`), `src/api/hooks.ts` (`useChatsQuery`), `Conversations.tsx` (`loadMoreConversations` is a no-op in `ConversationsSection.tsx`). Wire `next_cursor` → an infinite query and feed `loadMoreConversations`.
- *(Logged from B5c, 2026-06-13.)*

## Server-header CSP (deferred from FE-M9, Phase 6 / deploy)
- **What:** ship a real Content-Security-Policy as a response header from the server/CDN, including a `script-src` with a per-request nonce (and the other directives — `default-src`, `style-src`, `connect-src`, `font-src`, `frame-ancestors`, etc.). The stopgap `<meta http-equiv="Content-Security-Policy">` now in `frontend/index.html` (FE-M9) covers only `img-src`/`object-src`/`frame-src`/`base-uri` and deliberately omits `script-src` (a meta-tag `script-src` breaks Vite's HMR inline bootstrap in dev).
- **Why:** the meta-tag CSP is a dev-safe backstop, not the control. A `script-src` is the real XSS mitigation, and a nonce-based policy can only be set as a response header at request time — it can't live in static `index.html`. Also pairs with the rest of the security header set (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- **Context (start here):** the stopgap meta lives in `frontend/index.html`; the production serving layer is the deploy target (see `docs/DEPLOY.md` — SPA same-origin serving / `--forwarded-allow-ips`). Once a server/CDN serves the SPA, set the full CSP + security headers there and drop or downgrade the meta tag. With FE-H1 landed there is NO Google-favicon origin to whitelist in `img-src`; a first-party favicon proxy (if ever built) would add its own origin.
- **Residual third-party favicon fetch — `schoolLogo.ts` (Phase 6, CFG-04):** `frontend/src/components/cards/schoolLogo.ts` still builds a `https://www.google.com/s2/favicons?domain=…` URL as the keyless school-logo fallback (the `logoCandidates` chain). This is the SAME privacy class as FE-H1 (leaks which school host the student views) but a DIFFERENT surface — school-card logos, not the citation/source-browsing path FE-H1 closed. FE-H1 (Phase 4) deliberately scoped itself to `SourceFavicon.tsx` and left this here. **Phase 6 must address it:** route it through a first-party favicon proxy or remove the Google fallback (the latter regresses school-card logos, so the proxy is preferred). Until then `img-src` in any CSP must still whitelist `www.google.com`. (Logged from FE-H1 reviewer carve-out, Phase 4.)
- *(Logged from FE-M9, Phase 4. The server-header CSP is the real control; the meta tag is defense-in-depth only.)*

## Sources/artifact panel per-trigger focus restore (deferred from FE-M8, Phase 4)
- **What:** on closing the right-rail panel (sources/artifact), return focus to the exact trigger that opened it (the inline pill or the SourcesStrip button), not just the chat region. Phase 4 ships the contained fix: focus moves to the panel heading on open, and on close moves to `<main role="main">` (given `tabIndex={-1}` in `ChatView.tsx`) so AT focus isn't stranded on the unmounted panel. True per-trigger restore needs the opening element captured at open time.
- **Why:** the panel is opened via a jotai atom (`openSourcesPanelAtom`/`openArtifactPanelAtom`) from many call sites (inline pills in `MessageContent.tsx`, the strip in `SourcesStrip.tsx`), so the trigger element isn't known at the close site without storing it. Storing a DOM node in atom state couples DOM into app state — deferred rather than done dirtily.
- **Context (start here):** `src/app/ChatView.tsx` (`closeSources`/`closeArtifact`, `mainRef`), `src/app/state.ts` (the open atoms), `src/components/citations/SourcesPanel.tsx` (`headingRef` mount-focus). Also: focus-restore-on-close is hard to assert in jsdom — cover it with Playwright in Phase 7.
- *(Logged from FE-M8, Phase 4. The contained main-focus fix is in; per-trigger restore is the follow-up.)*

## DS-04 (pre-deploy security): OAuth associate-by-email + no email verification
- **DS-04 (pre-deploy security): OAuth `associate_by_email=True` + no email verification = account-takeover surface.** A password account on an email links with a later Google sign-in for that email (and vice-versa) — full chat/PII blast radius. A documented MVP tradeoff (ADR 0021, PRD decision 6), not shipped fixed in the Phase 6 hardening pass (flipping login UX is a product decision). Before any non-trivial user base, do option (1), (2), or (3) from `plans/audit/phase-6-configurability.md` DS-04. **Blocks B6 deploy.** See the comment at the `associate_by_email=True` site in `api/main.py` and the open-items list in `docs/DEPLOY.md`.
- *(Logged from Phase 6, DS-04.)*

## DS-06: email-keyed + per-account auth rate limiting (multi-replica)
- **What:** the auth rate limiter is per-IP only (`api/ratelimit.py`), and process-local. Add email-keyed + per-account-attempt caps, and a shared store (Redis) for a multi-replica deploy.
- **Why:** per-IP alone is bypassable by distributed / rotating-IP brute force; the in-process sliding windows don't span replicas. Email-keying needs a body read (consumes the request stream) or a dependency rework; multi-replica needs Redis — both out of scope for the single-replica MVP2 (ARCHITECTURE §23). Phase 6 (DS-06) added a `/v1/health` `rate_limiter` signal so a mis-wired limiter is visible; this deferred item is the harder half.
- **Context (start here):** `api/ratelimit.py` (`check_auth`, `_client_ip`, the MULTI-REPLICA CAVEAT comment), `api/routes/system.py` (the health signal).
- *(Logged from Phase 6, DS-06.)*

## Community card viz type (deferred from MVP1)
- **What:** add a native `community_card` renderer and documented v2 payload grammar.
- **Why:** the viz-v2 seam now accepts known and opaque types, so an unknown card already degrades safely; this TODO is the richer qualitative/Reddit presentation, not a schema-union change.
- **Context:** see `domain/specs.py` (`RenderSpec`) and ARCHITECTURE §17. No honesty risk deferred — community content is never quantified anyway; this is a UX improvement only.
- *(Logged from Phase 7 Slice D docs audit, 2026-06-11.)*

## CDS admin polish-2: two UI fixes never confirmed in a real browser
- **What:** the audit's §6 required a real-browser check for two findings before their fixes
  landed. **Neither check was performed.** Both fixes shipped anyway:
  1. **U-02** — load the review page for a real document, resize to ~768px, and confirm
     `ReviewPanel`'s flag bar and accordion are actually reachable (not clipped with no scroll
     path). The fix (`frontend/src/pages/cds-review-page.tsx`, a bounded `grid-rows-*` at the
     base breakpoint) was reasoned from CSS Grid semantics and independently re-verified by
     reading the full ancestor chain — `WorkspaceShell` → `WorkspaceOutlet` → the page
     `<section>`, all `overflow-hidden` with no scrollable intermediate, neither pane bounding
     its own height at the base breakpoint — but jsdom computes no layout, so the fix has never
     been seen working in an actual browser.
  2. **U-01** — open the Reject dialog, type a reason, tab to a button, and press ⌘Enter to
     confirm Radix does not `stopPropagation` on non-Escape keys (i.e. that the bug was
     exploitable end-to-end the way described, and that the fix's `modalOpen` guard actually
     blocks it in a live DOM). The missing guard itself was code-confirmed with certainty; only
     the end-to-end browser confirmation was skipped.
  Both have jsdom-level regression tests, so a *literal* regression is caught — but neither was
  ever seen rendering correctly in a real browser, which is what §6 asked for.
- **Why:** cost/time pressure during the fix batch; the reasoning behind both fixes is solid, but
  "reasoned to be correct" and "seen working" are different claims, and the plan was explicit
  that these two specifically needed the latter.
- **Context (start here):** `specs/cds-pipeline/plan/cds-admin-polish-2.md` §6 ("Verification
  still owed") for the exact repro steps; `frontend/src/pages/cds-review-page.tsx` (U-02's grid
  fix) and `frontend/src/features/cds-admin/review/use-review-controller.ts` (U-01's `modalOpen`
  guard).
- *(Logged from the CDS admin polish-2 batch, 2026-09-02.)*

## CDS admin polish-2: the sha256 unique index is in source control but not applied
- **What:** `deploy/seed/cds_library_schema.sql` now declares
  `cds_documents_active_sha256_uidx` — `UNIQUE (school_year_id, pdf_sha256) WHERE
  invalidated_at IS NULL AND superseded_at IS NULL`, fixing V-01 (no constraint backs the
  document-dedupe logic). It was verified creatable against current live data inside a
  rolled-back transaction (zero violating rows) but **deliberately not applied to the running
  database.**
- **Why:** the live `cds_library` schema is mid-cutover, with owner acceptance of the whole CDS
  extraction pipeline ship gate still pending (see CLAUDE.md Status). Applying a schema change to
  that database ahead of that sign-off is an owner decision, not something to do silently inside
  a fix batch. This means the seed file and the live database have **drifted** — do not assume
  they match, and do not assume the index exists when reasoning about the live system.
  `adapters/cds_store.py`'s advisory-lock guard (added in the same batch) closes the concurrent
  double-insert race at the application level regardless, so the race V-01 also worried about is
  not live-exposed even without the index — the index is defense-in-depth for a DB-level
  guarantee, not the only thing standing between here and a duplicate row.
- **Context (start here):** `deploy/seed/cds_library_schema.sql` (the index's DDL and its
  inline comments), `specs/cds-pipeline/plan/cds-admin-polish-2.md` finding V-01 and finding
  W-06 (which V-01 was blocked on), `adapters/cds_store.py` (the advisory-lock guard).
- *(Logged from the CDS admin polish-2 batch, 2026-09-02.)*

## Two pre-existing `live_db` test failures, untriaged (found during CDS admin polish-2)
- **What:** two `live_db`-marked tests were already failing at the audit's baseline commit
  (`2217fbd`), before any of the polish-2 fixes landed, and are **still failing** now. Neither
  was recorded as a finding in the audit itself, so this is the record of them:
  1. `tests/app/cds/test_service_review.py::test_pending_active_update_predicate_resolves_and_closes`
     — asserts that `close_pending_active_updates` resolves both of two back-to-back
     `active_update` rows; it currently resolves neither.
  2. `tests/domain/cds/test_packet_build_golden.py::test_rebuild_a_live_packet_byte_identical_from_its_own_contract`
     — rebuilding a live packet from its own stored contract is not byte-identical; the diff
     involves `class_size.class_sections_*` entries.
- **Why:** both depend on live local Postgres state, so they may be genuine defects or fixture
  drift against the current database — nobody has triaged which. They are **not caused by this
  batch's work** — confirmed present before the first fix commit. The first one is worth
  triaging first: it sits directly in the approve/correction machinery (`active_update`
  resolution) that this batch's A-01/A-02/R-02 fixes touched, so a real defect there could
  interact with those fixes in ways nobody has checked.
- **Context (start here):** run
  `uv run pytest tests/app/cds/test_service_review.py::test_pending_active_update_predicate_resolves_and_closes tests/domain/cds/test_packet_build_golden.py::test_rebuild_a_live_packet_byte_identical_from_its_own_contract -m live_db -v`
  against local Postgres to reproduce; `app/cds/service_review_approve.py`'s
  `close_pending_active_updates` for the first, `domain/cds/packet_build.py` /
  `class_size` metric handling for the second.
- *(Logged from the CDS admin polish-2 batch, 2026-09-02 — found at baseline, not introduced by
  it.)*

## Resolved: `COUNSELLE_DB_RESET_NOTICE_DATE` is now wired up (school-data-v3 Phase 2)
`Settings.db_reset_notice_date`/`db_reset_notice_days` exist, `.env.example` documents both, and
the unauthenticated `GET /v1/config/public` (`api/routes/config.py`) serves the date — the
consumer this entry was waiting on. `AuthLayout`'s sign-in notice UI (frontend, §5.6) is a
follow-up in the same phase; this entry is closed on the backend side.

## Six functions over CLAUDE.md's 50-line limit, introduced in school-data-v3 Phase 2 (deliberately deferred)
- **What:** Phase 2's facts/Explore work introduced six functions past the 50-line house rule:
  - `app/facts/service_explore.py::_build_clauses` — 182 lines
  - `app/facts/service_explore.py::run_explore` — 166 lines
  - `app/facts/service.py::_build_deadlines` — 68 lines
  - `adapters/facts_store.py::retire_absent_slugs` — 65 lines (grew from a compliant 30 when the
    crawl-retirement fraction/floor ceiling — see the remap-retirement fix in `8bca991` — was
    added)
  - `app/facts/service.py::get_school_facts` — 58 lines
  - `app/facts/service.py::_try_band` — 57 lines
- **Why not fixed here:** `_build_clauses` and `run_explore` own the Explore exclusion accounting
  — the honesty-relevant filter/availability logic that four reviewers had just finished
  auditing and approving. Splitting them is mechanical and the existing tests cover it, but
  reshaping just-approved honesty-critical code immediately, with three plan phases still ahead,
  traded a real regression risk for a readability gain. This is genuine debt to pay down, not a
  false positive — it was consciously deferred, not overlooked.
- **Context (start here):** the six functions above.
- *(Logged from the school-data-v3 Phase 2 backend implementation, 2026-09-08.)*

## Correction: the "six functions" entry above is stale — later phases grew the crawl/crosswalk surface too
- **What:** the entry immediately above this one was accurate as of Phase 2, but the crawl and
  crosswalk work that followed in later phases added its own set of over-50-line functions that
  were never folded into that count. A fresh AST-based scan of the whole repo (`ast.parse`,
  measuring `end_lineno - lineno + 1` on every `FunctionDef`/`AsyncFunctionDef`, so decorators and
  docstrings can't skew the count the way a line-count heuristic would) run 2026-09-09 finds, in
  just the facts/crosswalk/CollegeData surface this work owns (`app/facts/`, `adapters/facts_*`,
  `adapters/collegedata/`, `domain/facts/`, `scripts/build_crosswalk.py` and its adjudication
  scripts):
  - The original six, re-measured today (two shifted by one line — not a real change, just where
    the earlier count drew the boundary — the rest are exactly as recorded):
    - `app/facts/service_explore.py::_build_clauses` — 182 lines (unchanged)
    - `app/facts/service_explore.py::run_explore` — 167 lines (was 166)
    - `app/facts/service.py::_build_deadlines` — 68 lines (unchanged)
    - `adapters/facts_store.py::retire_absent_slugs` — 65 lines (unchanged)
    - `app/facts/service.py::get_school_facts` — 59 lines (was 58)
    - `app/facts/service.py::_try_band` — 57 lines (unchanged)
  - Ten more, not in the original count, all introduced or grown past 50 lines by the crawl-pass
    and crosswalk-builder work that shipped after Phase 2:
    - `scripts/build_crosswalk.py::_run_ladder` — 168 lines
    - `app/facts/crawl.py::_process_school_live` — 168 lines
    - `app/facts/crawl.py::_run_crawl_pass_locked` — 128 lines
    - `adapters/facts_store.py::write_school_facts` — 127 lines
    - `adapters/facts_store.py::record_page_changed` — 81 lines
    - `app/facts/crawl.py::_process_school_remap` — 58 lines
    - `scripts/build_crosswalk.py::_merge_command` — 57 lines
    - `adapters/collegedata/fetch.py::_get` — 55 lines
    - `adapters/facts_jobs_store.py::close_run` — 54 lines
    - `scripts/build_crosswalk.py::_fetch_all` — 52 lines
  - Sixteen functions over the limit today in this surface, not six.
- **Why not fixed here:** same reasoning as the original entry — this is the crawl/write/dedup
  path for the CollegeData facts store, honesty-adjacent (it decides what gets written and what
  gets retired) and recently built or reviewed; splitting sixteen functions is mechanical but
  real work, better done as its own pass than folded into an unrelated bookkeeping correction.
- **Context (start here):** the sixteen functions listed above; the scan is repo-wide AST-based
  (not a regex or line-count heuristic), scoped in this report to the facts/crosswalk/CollegeData
  files school-data-v3 owns — `evals/runner.py`'s four over-limit functions are tracked separately
  in the correction entry below this one, and unrelated pre-existing oversized functions elsewhere
  in the repo (e.g. `app/run_turn.py`, `app/agent_node.py`, `app/viz.py`) are out of scope for this
  entry and not school-data-v3's debt to record.
- *(Logged from the school-data-v3 Phase 5 docs/graduation pass, 2026-09-09.)*

## Two pre-existing oversized files, unrelated to school-data-v3 Phase 2
- **What:** two files were already over CLAUDE.md's 800-line file limit before Phase 2, and
  remain so, untouched by its function-level work:
  - `evals/runner.py` — 1,528 lines. Phase 2 changed exactly one line in it (the
    `counselle_db.service` → `counselle_db.sql_guard` import fixup that followed the SQL-guard
    split in `8bca991`).
  - `frontend/src/test/render-app.tsx` — was already over 800 lines (878) before Phase 2. Phase 2
    added 74 lines of facts-fixture test helpers, taking it to 952.
- **Why not fixed here:** pre-existing, out of scope for Phase 2's facts/Explore surface; noted
  so neither file's size is mistaken for something this phase introduced.
- *(Logged from the school-data-v3 Phase 2 backend implementation, 2026-09-08.)*

## Correction: `evals/runner.py`'s "unrelated to Phase 2" entry above is stale — Phase 3 un-parked and substantially rewrote it
- **What:** the entry immediately above this one describes `evals/runner.py` as pre-existing,
  untouched apart from a one-line import fixup, at 1,528 lines. That was true as of Phase 2. It
  stopped being true in Phase 3: `build_eval_context` and its `_school` helper had been left as
  `NotImplementedError` stubs, which meant the eval harness could not execute a single case, and
  `score_composition`'s per-cell tier check would have failed every *correct* answer regardless,
  since `db`-sourced citations carry `tier: null` by design (decision D3, `specs/school-data-v3/plan/school-data-v3.md`
  §0). Phase 3 un-parked both — the harness now runs against live `get_facts`/`query_database`
  output. The file's current size is **1,391 lines** (net *smaller* than the 1,528 recorded
  above, despite the added implementation — some other dead weight was removed in the same pass).
  It still has four functions over the 50-line house limit:
  - `evals/runner.py::score_deterministic` — 165 lines
  - `evals/runner.py::run_question` — 74 lines
  - `evals/runner.py::score_narration` — 59 lines
  - `evals/runner.py::build_eval_context` — 55 lines
- **Why not fixed here:** the file remains over the 800-line ceiling and these four functions
  remain over the 50-line ceiling for the same reason as the six Phase 2 functions above — this
  is the eval-scoring logic that determines whether the school-data-v3 eval suite is trustworthy
  at all, and it was only just brought back from a non-functional parked state. Splitting it up
  is mechanical work that should happen once the harness has run cleanly for a while, not in the
  same phase that resurrected it.
- **Context (start here):** `evals/runner.py::build_eval_context`/`_school` (the un-parked
  functions), `evals/runner.py::score_composition` (the `tier: null` interaction with `db`
  citations), decision D3 in `specs/school-data-v3/plan/school-data-v3.md` §0.
- *(Logged from the school-data-v3 Phase 5 docs/graduation pass, 2026-09-09 — correcting the
  Phase 2 entry above rather than editing it in place, since it was an accurate record of Phase 2
  and the correction belongs to Phase 3's later change.)*

## Two school-data-v3 eval cases cannot be exercised against live data
- **What:** `evals/questions.yaml`'s `v3-coverage-tab-not-published` and `v3-honesty-stale-facts`
  cases (school-data-v3 Phase 3) each need a live-data condition that does not currently
  exist anywhere in the database:
  - `v3-coverage-tab-not-published` needs a school with at least one facts page in the
    `not_published` state. The live distribution across all 2,746 schools' page statuses is only
    `{ok: 13428, http_error: 6}` — no page has ever been marked `not_published`.
  - `v3-honesty-stale-facts` needs a school whose facts are older than
    `settings.facts_stale_days` (120 days), so a `stale_facts` caveat would actually attach.
    Every school in the live database was crawled less than a day before this was last checked.
  Both cases carry a `live_gate` key (`not_published` / `stale_facts` respectively) that the
  harness checks before scoring; when the gate condition isn't met in the live data, the case
  reports as **NOT EXERCISED** with a `skip_reason`, rather than silently scoring green because
  the assertion happened not to trip on the available rows.
- **Why not fixed here:** both conditions require either injecting a fabricated page-status row
  or fast-forwarding a school's `last_checked_at` outside the normal crawl path — either one
  would mean scoring the eval against data the live system did not actually produce, which is
  exactly the kind of synthetic-looking-real result this project's honesty stance treats as worse
  than an honestly-skipped case. Left as a known, explicitly-surfaced gap rather than a fake
  pass.
- **Context (start here):** `evals/questions.yaml` lines ~299–338 (the `# --- school-data-v3
  Phase 3: new v3 honesty cases ---` block and its own note on this exact gap); wherever `live_gate`/
  `skip_reason` is read in `evals/runner.py`'s scoring loop.
- *(Logged from the school-data-v3 Phase 5 docs/graduation pass, 2026-09-09.)*
