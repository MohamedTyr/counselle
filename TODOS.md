# TODOS

## School-page-slim: `school_requirements` migration was meant to stay unapplied, and did not
- **What:** `migrations/0019_drop_school_requirements.sql` (+ `.rollback.sql`) drops
  `counselle.school_requirements`, its two indexes, and the
  `protect_published_requirement_facts` trigger/function. It was written and reviewed to be
  **deliberately not run against any database** — and it has since been run against the local
  Postgres on `localhost:5433` anyway. `_yoyo_migration` records `0019_drop_school_requirements`
  applied at `2026-09-04 20:07:49 UTC`, and `to_regclass('counselle.school_requirements')`
  returns nothing: the table, its indexes and its trigger are gone from that database.
- **How it happened, and what is already fixed:** `migrations/0020_essay_sessions.sql` was
  authored later that day declaring `-- depends: 0019_drop_school_requirements`, so applying the
  essay-panel feature also applied this drop; commit `1adfd30` records that it did, and
  re-points `0020` at `0018_drop_essay_prompt_drafts` so the two are independent siblings and
  no feature migration can force this one again. That closes the mechanism, not the state.
- **What is still open:** the drop this entry exists to hold back has already happened on the
  only database there is, so the owner is being asked to sign off on something already done
  rather than something pending. `0019_drop_school_requirements.rollback.sql` restores the DDL
  if the state should be put back before that decision; the table was empty in every real
  environment and nothing in the app reads or writes it, so nothing was lost, but "not applied
  anywhere" is no longer a true description of it and should not be repeated.
- **Why it was to be held in the first place:** per `CLAUDE.md` Status, the CDS extraction pipeline cutover (ADR 0036) is
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
  rollback restores. For the applied state, query `_yoyo_migration` and
  `to_regclass('counselle.school_requirements')` on `localhost:5433` rather than trusting
  either this file or the commit that added the migration.
- *(Logged from the school-page-slim refactor, Phase 3, 2026-09-04; corrected from the essay AI
  panel branch, 2026-09-07, on finding the migration applied.)*

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
- **New constraint since the essay AI panel (2026-09-07): a naive TTL sweep would silently delete essay panel threads.** `counselle.sessions` now has a nullable `essay_id` (migration `0020_essay_sessions`), and a row with it set is the essay's *own* durable conversation — reached from the editor, never from the chat list, and expected to still be there when the student comes back to a draft they left for a month. It is exactly the kind of row a recency-based sweep deletes first, because it is not touched between drafting sessions and has no title to make its loss obvious. Whatever this job ends up doing, it has to make a deliberate decision about `essay_id IS NOT NULL` rows — exclude them, give them their own TTL keyed to the essay's own activity, or delete them only with the essay — rather than treating every session row alike. See `docs/DATABASE_GUIDE.md` §10 and `docs/ARCHITECTURE.md` §39.4.
- *(Logged from /plan-eng-review, 2026-06-10. Note: CI pipeline was proposed and explicitly declined by the user the same day. Essay-thread constraint appended 2026-09-07.)*

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

## Essay panel: the "Open in editor" morph is only partial
- **What:** opening the docked essay document panel into the full editor route is supposed to
  read as one continuous element growing into the page. It mostly does not. Measured across
  repeated runs, roughly **88% cross in a single frame** — the shared element jumps from panel
  width to page width with no intermediate frames — because the main thread stalls while TipTap
  mounts in the destination route, and the stall swallows the animation. A `layoutDependency`
  change (`EssayDocumentSurface.tsx`) improved the good case to **9 intermediate widths**, which
  is a real morph; it did not move the bad case, because the bad case is not an animation
  problem.
- **Why:** the fix is not in the motion config — it is in what happens on the destination side.
  Candidates, none tried: mount the editor lazily so the first frame after navigation has no
  TipTap work in it; hand the destination the already-parsed document instead of re-parsing;
  or accept the jump honestly and drop the shared-element treatment rather than shipping a
  transition that works one time in eight. Left as-is because a partial morph is not *wrong*,
  just inconsistent, and diagnosing a main-thread stall properly needs a profiler and a real
  browser, which this work never had.
- **Context (start here):** `frontend/src/features/essays/EssayDocumentSurface.tsx`
  (`layoutDependency`), `frontend/src/features/ai-chat/components/EssayDocumentPanel.tsx` (the
  panel and its "open in editor" affordance), `frontend/src/features/essays/useEssayEditor.ts`
  (the TipTap mount that stalls). Reproduce by opening an essay document panel from a mutation
  receipt in the main chat and clicking through to the editor, repeatedly.
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## Essay panel: the dock threshold is viewport-keyed, not container-keyed
- **What:** `useIsPanelDocked` in `frontend/src/features/essays/EssayEditorRoute.tsx` decides
  whether the editor's chat panel docks beside the document or covers it, and it keys off
  `window.innerWidth` against a `PANEL_DOCK_BREAKPOINT_PX` of 1280. The workspace sidebar is
  not part of that measurement, so the same viewport width means two different amounts of
  actual room depending on whether the sidebar is expanded (340px) or collapsed (48px).
- **Why it is a TODO and not a bug:** it was measured, and it never clips the essay. Checked at
  1024 / 1141 / 1280 / 1440 viewport widths × sidebar expanded and collapsed — eight cells, no
  clipping and no missing scrollbar in any of them. What it does cost is one avoidable overlay:
  at **1141px with the sidebar collapsed the content row is 1093px**, wide enough to dock a
  380px panel beside a 690px measure, and the panel still takes the whole width. So this is a
  layout-quality miss, not a correctness one.
- **The fix, if it is ever worth doing:** key on the measured width of the row itself, the way
  the main chat's document panel already does — `EssayDocumentPanel.tsx` uses a `ResizeObserver`
  against a `MIN_DOCK_ROW_PX` floor precisely because a viewport breakpoint put the same 1280px
  viewport on opposite sides of the threshold. That is the pattern to copy; the two surfaces
  currently disagree about how to answer the same question.
- **Context (start here):** `EssayEditorRoute.tsx` (`useIsPanelDocked`,
  `PANEL_DOCK_BREAKPOINT_PX`) vs. `frontend/src/features/ai-chat/components/EssayDocumentPanel.tsx`
  (`PANEL_WIDTH_PX` / `MIN_CHAT_COLUMN_PX` / `MIN_DOCK_ROW_PX` and the observer).
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## `essay_context_max_chars` bounds two different things
- **What:** the setting caps *both* the essay markdown inlined into the essay-surface system
  prompt (`app/agent_node.py`, passed to `app.prompt.render_essay_context`) *and* the length of
  the student's text selection accepted on the wire (`api/routes/sessions.py`'s
  `_parse_surface_request`, called from `post_message` with
  `max_selection_chars=settings.essay_context_max_chars`). One knob, two limits, and they are
  not the same limit: one is "how much of a draft may ride the prompt before we truncate and
  say so", the other is "how much selected text will we accept from a client at all".
- **Why:** it is a real coupling, not a naming quibble — tuning either one silently moves the
  other. At the shipped default (8,000) both are generously sized and nothing bites, which is
  why it shipped this way; the two only need separating when someone has a reason to change one
  of them.
- **Context (start here):** `config/settings.py` (`essay_context_max_chars` and its comment,
  which describes only the prompt-block role); the two call sites above. Splitting it is a
  second Settings field plus a wire-validation test — small, just not yet load-bearing.
  Recorded as a consequence in ADR 0037.
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## Migration `0020` is a duplicated number across two branches
- **What:** `migrations/0020_essay_sessions.sql` (this branch) and
  `migrations/0020_task_sort_order.sql` (`feat/tasks-redesign`) both claim the `0020` prefix.
  They were authored in parallel off the same `main`, and neither knew about the other.
- **Why it is not broken:** yoyo keys migrations on the **full id**, not on the numeric prefix,
  so both apply cleanly and both are recorded distinctly. What is lost is only the property that
  the directory listing reads as a linear order — after both land, sorting the filenames no
  longer tells you the apply order, and a future reader has to read the `-- depends:` lines
  instead of the numbers. That is exactly what those lines are for.
- **What to do:** decide at merge time, once, rather than twice. Either renumber whichever
  branch merges second (a pure rename plus its `depends:` reference, safe as long as neither id
  has been applied to a real database yet — see the "written but not applied" entries above) or
  accept the duplicate and stop treating the prefix as ordering. Do **not** renumber a
  migration that has already been applied somewhere: yoyo would then see the new id as unapplied
  and try to run it again.
- **Context (start here):** `migrations/0020_essay_sessions.sql`,
  `git show feat/tasks-redesign:migrations/0020_task_sort_order.sql`, and the `-- depends:` line
  at the bottom of each header comment.
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## Essay panel: `PendingChangesReadout`'s live-region pattern is unconfirmed on a real screen reader
- **What:** `frontend/src/features/essays/PendingChangesReadout.tsx` announces a change in the
  pending-change counts by remounting a **keyed `<span>` inside** a container that carries
  `role="status"` (the key is `${waiting}:${outdated}`, so a new reading is a new node rather
  than mutated text). It is structurally sound and it passes in jsdom, but *remount-inside-a-live-region*
  is specifically one of the patterns whose behavior varies across screen-reader × browser
  combinations — some announce the new node, some announce nothing because the subtree was
  replaced rather than changed, some announce twice.
- **Why it matters more than the usual a11y TODO:** this band exists to be the thing that
  contradicts a false claim by the agent. A student using a screen reader is exactly the student
  who cannot glance at it, so if the announcement is the part that silently does not work, the
  honesty guarantee is missing for the person who most depends on it.
- **What to check:** with a real AT pairing (NVDA/Firefox, VoiceOver/Safari, JAWS/Chrome), have
  the agent propose a suggestion and confirm the count change is announced exactly once. If a
  remount is not announced, the fix is to keep a stable node and update its text content instead,
  and move the entry animation to a sibling. Note the deliberate design around it: `announce` is
  **off by default** and opted into only in the editor's covering chat panel, because everywhere
  else `SuggestionsBar` already announces the same fact and two live regions said it twice.
- **Context (start here):** `PendingChangesReadout.tsx` (the `announce` prop's docstring records
  the reasoning), `PendingChangesReadout.test.tsx` (jsdom-level coverage),
  `frontend/src/features/essays/EssayChatPanel.tsx` and
  `frontend/src/features/ai-chat/components/EssayDocumentPanel.tsx` (the two mount sites).
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## Essay panel: the tracked-change markers are proven present, not proven well-spoken
- **What:** the decorations used to carry `aria-label="Delete: …"` / `"Insert: …"` / the stale
  sentence. That never reached any screen reader — `deletion`, `insertion` and `generic` all
  prohibit an accessible name, so the browser discards the attribute (confirmed in Chrome's
  accessibility tree: a labelled `<del>` exposes its text and no name). It is fixed: each change
  is now bracketed by visually-hidden marker text, which **is** in the accessibility tree, verified
  there for all three kinds.
- **What is still unverified:** how each screen reader actually *reads* the result in continuous
  mode — whether "Suggested deletion: good. End of suggested deletion. Suggested insertion: …"
  lands as a clear boundary or as clutter a student learns to tune out, and whether the same
  bracketing is too verbose on an essay carrying eight changes. Being in the tree is necessary,
  not sufficient; only a real AT pairing answers the verbosity question. Check it in the same
  session as the readout entry above.
- **If it reads as too much:** the cheap knob is dropping the closing marker for a *replacement*
  (the insertion's own opening marker already supplies the boundary) and keeping it only for a
  pure deletion, which has nothing after it. That is a `SR_MARKERS` edit, not a redesign.
- **Context (start here):** the `SR_MARKERS` comment in
  `frontend/src/features/essays/suggestions/suggestionExtension.ts`, and the two bracketing tests
  in `suggestionExtension.test.ts`.
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## Two `aria-label`s sit on elements whose role prohibits a name (works in Chrome, off-spec)
- **What:** axe 4.10.2 reports `aria-prohibited-attr` (incomplete, serious) on exactly two nodes
  across the essay surfaces: the ProseMirror root (`.tiptap`, `aria-label="Essay body"`) and
  `PageHeader`'s title row (a `<div aria-label="{essay title}">`). Neither declares a role, so both
  resolve to name-prohibited roles on paper — but unlike the `<del>`/`<ins>` case above, Chrome
  *does* expose both names in its accessibility tree (checked: `generic "Essay body"`), so no
  student loses information today.
- **Why it is left alone:** neither is this branch's code, `PageHeader` is shared by every route,
  and the correct fix differs per case — the editor root wants `role="textbox"` (it is
  `contenteditable`, and Chrome already treats it as one), while the header's label is simply
  redundant beside the `<h1>` inside it and should probably just be deleted. Both are
  `PageHeader`/editor-shell changes, not tracked-change changes, and doing them here would be an
  unrelated refactor smuggled into an a11y fix.
- **Context (start here):** `frontend/src/features/essays/useEssayEditor.ts` (where the editor root
  gets its attributes) and `frontend/src/components/workspace/PageHeader.tsx`.
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## The page-hide keepalive essay save is last-write-wins, and now has two writers
- **What:** the debounced autosave path sends `expected_updated_at` and is properly guarded
  (ADR 0030). The **page-hide keepalive** save deliberately does not: it calls
  `updateEssayKeepalive(essayId, { content })` with no version, and
  `service_essays._check_not_stale` is a **no-op when `expected_updated_at` is absent**, so that
  write always wins.
- **Why it was deliberate, and why it is now worth revisiting:** the keepalive fires as the page
  is going away, so a rejected save can never be retried and the student never sees the failure —
  guarded, the older in-flight save lands first, bumps the version, and the *newest* text is the
  one thrown away. That reasoning still holds. What changed on this branch is the exposure: an
  essay now has **two editable surfaces** — the full editor route and the document panel docked
  in the main chat — both mounting `useEssayAutosave` against the same essay. Two tabs, or one
  tab with the panel open beside a conversation, is no longer an exotic setup, and the unguarded
  write is the one that resolves the conflict by discarding the other side.
- **What would close it:** the honest options are a merge (three-way on the markdown projection,
  expensive), a last-write-wins that at least *tells* the student on next load that a divergence
  happened (the accept path already has a `DIVERGED_TOAST_MS` toast for its own version race — the
  vocabulary exists), or preventing the second surface from being editable at all when the first
  one is mounted. Pick deliberately; do not just add `expected_updated_at` to the keepalive path,
  which reintroduces exactly the silent-data-loss bug the comment there warns about.
- **Context (start here):** `frontend/src/features/essays/useEssayAutosave.ts` — the
  "Deliberately UNGUARDED" comment block on the keepalive send, and `flush()` above it;
  `app/workspace/service_essays.py::_check_not_stale`;
  `frontend/src/features/ai-chat/components/EssayDocumentPanel.tsx` (the second mount site this
  branch added).
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## Essay panel: three writers of one essay cache key, and a race held by a test rather than a reproduction
- **What:** `workspaceKeys.essays.detail(id)` is written or invalidated from three places, and
  two of them have an ordering requirement between them that nothing enforces:
  1. `useEssaySuggestions.resolve` — adopts the server's post-resolve essay into the cache, then
     re-invalidates the same key synchronously, on purpose.
  2. `EssayEditorRoute.refetchEssay` — invalidates it whenever an agent turn settles in the
     docked chat panel.
  3. `api/workspace/events.ts` — invalidates it on **every** workspace SSE change event whose
     object is an essay, including the resolve's own.
  The bug that made this visible is fixed: a read issued by (2) or (3) *before* a resolve
  committed would land after the resolve's cache write, overwrite it, and put the resolved
  change back on screen as pending with the honesty readout counting it. The re-invalidation in
  (1) closes it, resting on React Query's `refetchQueries` default `cancelRefetch: true` to
  cancel the in-flight stale read and re-issue it.
- **Why it is still recorded:** the fix rests on a **deterministic test, not on a
  reproduction**. The interleaving was never observed in a real browser — (3) fires for the
  resolve's own change event moments later and re-reads the same key, so the wrong state is
  real but too short to catch by hand. A negative control is not evidence of absence, so what
  actually carries this is the ordering argument, and the argument has to be re-read rather
  than assumed if the resolve flow is ever restructured. The shape is also the durable part:
  three writers of one key, one of which must run after another, with no type and no lint
  saying so. Anything new that reads this essay must either not race a resolve or invalidate
  after it.
- **Context (start here):** `frontend/src/features/essays/suggestions/useEssaySuggestions.ts` —
  the five-rule header comment and the invalidation inside `resolve`, both of which record the
  reasoning at the call site;
  `frontend/src/features/essays/suggestions/useEssaySuggestions.test.tsx` ("a background read
  still in flight cannot re-show the accepted change");
  `frontend/src/api/workspace/events.ts` (the `essay` case);
  `frontend/src/features/essays/EssayEditorRoute.tsx` (`refetchEssay`).
- *(Logged from the essay AI panel branch, 2026-09-07.)*

## Essay panel: the three plan requirements are built (closed 2026-09-07)
- **What:** the word-count projection (Part 2 §4), the selection-scoped quick-action chips
  (Part 2 §6), and focus advance on resolve (Part 2 §3.4) all shipped, verified in a real
  browser. Nothing is outstanding here; the entry is kept because two of the three landed in a
  different shape from the plan and the next person should not "restore" the drafted version:
  1. **The projection does not use the plan's `pendingWordDelta` formula**, which is wrong twice
     over (accepting is cumulative, so an overlapping change is skipped rather than summed; and
     `countWords` counts runs of non-whitespace, so a change can merge or split words at its own
     edges while counting none of its own). `word-projection.ts` rebuilds the projected text and
     counts it, and returns nothing where that text is not knowable.
  2. **`components/ai-elements/suggestion.tsx` was deleted rather than adopted** — it wraps
     shadcn's Radix `ScrollArea`, and this repo's is a Base UI rewrite with a different contract.
     Do not re-add it.
  3. **Focus advance fires on the resolved row leaving the list, not on the resolving lock
     clearing.** Those arrive in separate renders and keying on the lock drops focus to `<body>`.
- **Context:** `frontend/src/features/essays/suggestions/word-projection.ts` (+ its tests),
  `frontend/src/features/essays/essay-quick-actions.ts`,
  `frontend/src/features/ai-chat/components/ChatComposer.tsx`,
  `frontend/src/features/essays/suggestions/SuggestionsBar.tsx`.
  `specs/essay-ai-panel/README.md` records the same three, with the measurements.
- *(Closed on the essay AI panel branch, 2026-09-07.)*
