# TODOS

## Landing launch: what is left after the launch pass

`plans/landing-launch-plan.md` and `plans/landing-finalize-plan.md` are built and deployed to `https://acceptra.ai`. Production equals `main`: deploy only with `npm run deploy:landing` (`docs/DEPLOY.md` § The public landing site). The PostHog overview is the project's primary dashboard ("Acceptra: launch overview"), emailed weekly on Mondays. What is still open, and why:

**Owner, security and money:**
- **2FA** on Cloudflare (a single Super Administrator), Spaceship and PostHog.
- **Workers Paid** (D-5), before any launch spike: `/ingest` and `/api/waitlist` share the free 100k requests a day, so a spike stops signups until 00:00 UTC.
- **Analytics consent.** The landing records full replays (typed text included), keeps IPs and sets a first-party cookie. The privacy policy says so, but there is no consent banner; EU/UK visitors (ePrivacy/GDPR) would need one, and many visitors are 13–17. The policy's own "Changes" section promises an email to the waitlist on a significant change, and this is one.
- **Honesty calls on the live page** (principle 3), default remove unless sourced or consented: the three testimonials; the mentor calls, the counselor view and the university logos (D-6); "$10,000 counselor", "$140–300 an hour" and the ChatGPT comparison row. Also confirm the Google appointment schedule has open slots.

**Cloudflare, done 2026-09-29 with a short-lived owner token:** SSL/TLS Full (strict); CAA for letsencrypt.org, pki.goog, ssl.com and sectigo.com (the Universal certificate stayed active); email alerts to admin@ for a failed Pages production deploy, Universal SSL and HTTP DDoS. Still open:
- **Delete that API token** in My Profile → API Tokens: it was created without an expiry and can't delete itself.
- **DNSSEC is enabled at Cloudflare and pending**: it takes effect only once the DS record is at Spaceship (acceptra.ai → DNSSEC): key tag `2371`, algorithm `13`, digest type `2`, digest `1501FA38566916B13119F99E031F640C13E96DF5436F8885E103E9935451B1B2`. Harmless while pending. After pasting, check with DoH that the AD bit is set and MX, SPF and DKIM still resolve; rollback removes the DS at Spaceship first.

**Checks with a date:**
- **Late November 2026:** confirm the edge certificate renews cleanly before 2026-12-28, now that CAA restricts issuers.
- **Weekly:** the D1 export (`docs/DEPLOY.md`), kept 30 days in `~/private-backups/acceptra/`.
- **Before DMARC leaves `p=none`:** list every legitimate sender for acceptra.ai (Google Workspace, and whatever sends the "we're open" email), and move reports to a shared mailbox; today they go to one person.

**Owner accounts and yes/no:**
- **Indexing:** Google Search Console has the Domain property `acceptra.ai` (auto-verified by the existing `google-site-verification` TXT record: never delete it), `sitemap.xml` submitted and read (3 pages), and indexing requested for `/`, `/privacy` and `/terms` (2026-09-29). IndexNow (Bing, Yandex, Seznam, Naver) was pinged once; it is not wired into deploys. Still owner: Bing Webmaster Tools (import from Search Console), Brave, the Rich Results Test, real WhatsApp, iMessage and LinkedIn share previews, and PSI mobile from the owner's browser.
- **An external uptime check** on `/` and `/privacy`: nothing alerts today if the site or DNS goes down.
- **`acceptra.com`:** buy it and 301 it (`verify-landing.sh` checks it with `CHECK_COM=1`).
- **`acceptra.org`** now publishes `v=spf1 -all` and DMARC `p=reject`, so nobody can send as it. Spaceship's API refuses a null MX, so it has none. Its auto-renew is off (expires 2027-09-20); `acceptra.ai`'s is on.
- **Collaborator PRs #4, #8 and #9** are stale: close them or ask the author.
- **Founders and profiles are empty.** `FOUNDERS` and `PROFILES` in `frontend/src/features/landing/brand.ts` drive the "Who is behind Acceptra?" FAQ entry, `Organization.founder` and `Organization.sameAs`; nothing renders until they are filled in. Add `twitter:site` to `landing.html` once the X handle exists.
- **The site icon is derived, not designed.** `public-landing/icon.svg` (and every PNG/ICO generated from it) and `assets/acceptra-glyph.svg` are the wordmark's "A" on the brand green. Regenerate the PNG set from the designed mark when it exists.

**Engineering notes:**
- **Cloudflare's Web Analytics beacon stays, by owner decision.** It comes from an account-level Web Analytics site with automatic setup (the Pages project toggle and the zone RUM setting are both off). The enforced CSP blocks it, so it sends nothing, but it costs a console error and holds Lighthouse Best Practices at 92, and `verify-landing.sh https://acceptra.ai` fails its real-browser CSP check on it. `Cache-Control: no-transform` would stop the injection but also stops Cloudflare compressing the HTML, so don't use it. To remove it: Analytics & Logs → Web Analytics → acceptra.ai → Manage site → disable automatic setup.
- **Lighthouse mobile on production after the finalize pass** (2026-09-29, local Lighthouse 13, three runs): Performance 93, 96, 94 (LCP 2.3–2.6 s, CLS 0), Accessibility 100, SEO 100, Best Practices 92, all of that gap being the blocked beacon above.
- **The app build still renders `LandingPage`** (`src/app/router.tsx`), where `/api/waitlist` doesn't exist, so a signup there shows the generic error. The app isn't deployed; decide at B6.
- **Deferred**, none needed now:
  - Turnstile on the waitlist, if the rate limit and host check prove not enough.
  - A separate preview D1, only if preview signups must work (today the host check refuses them).
  - Merging Geist and Inter (a design call).
  - Optional analytics events (`faq_opened`, `section_viewed`), an acquisition dashboard, and a no-signups alert, once traffic is steady.
  - Stream-limiting chunked request bodies in the waitlist Function (it measures the body after reading it).
  - `worker-src` and the toolbar origin in the CSP, if replay or the toolbar is ever enabled under the enforced CSP.
  - posthog-js `module.slim` and `advanced_disable_feature_flags_on_first_load`.
  - Pausing the typewriter and marquee off screen, and moving the composer animation off `background-color`.
  - WebP for the three PNG logo tiles.
  - A `<details>` FAQ for no-JS visitors (the answers are in the HTML, but collapsed without JS).
  - A server-side honeypot check (today the client drops a filled trap).
  - Trimming the ~40 kB of inline SVG data URIs.
  - The 37px "Skip to content" link, accepted: it is a keyboard target, not a touch target.
  - The unused registry exports knip still lists, and test-only Python helpers.

## Waitlist admin (`plans/landing-admin-plan.md`): what is left

The page, its API and the gate are built and tested locally (`docs/DEPLOY.md` § The admin page). Open:

- **Access setup and go-live.** The owner enables Zero Trust once (team `acceptra`, Free); then the Access app, the "Founders" policy and the three `wrangler.toml` `[vars]` go in over the API, followed by a deploy, the production checks in `verify-landing.sh`, and one real sign-in on a laptop and a phone (including the "Your session ended" state after deleting the `CF_Authorization` cookie). Until the vars are set, the Function fails closed and `/admin/` is a 404 everywhere.
- **The ESLint import ban the plan asked for is a test instead.** A `no-restricted-imports` rule on `src/features/waitlist-admin/**` (banning `@/features/landing/analytics` and `posthog-js`) was blocked by a local hook that refuses any `eslint.config.js` edit; `src/features/waitlist-admin/no-analytics.test.ts` enforces the same ban. Swap it for the lint rule if the hook is lifted.
- **`verify-landing.sh` checks two FAQ questions the page no longer has** ("What is Acceptra?" and "Is my data sold or used for advertising?"), since the FAQ was rewritten in `9656ff73`/`40eb0d6a`. Both checks fail against any build of `main`; update them to the current questions.
- **Two stale labels in the app, out of this plan's scope:** `AdminGate`'s doc comment (`src/app/auth/AdminGate.tsx`) still describes gating three `/app/admin/cds/*` routes, though it now guards `/app/admin/facts`; and the sidebar entry for that page is titled "CDS" (`src/app/shell/navigation.tsx`).

## Focused Answer speed pass (`plans/quick-answers-plan.md`): what is left

- **One eval run is noisy.** Single-case flips between identical runs are common (the memory case picked `update_profile` over `remember`; a score-band answer added an invented threshold). Judge a change on two runs, not one.
- **Eval latencies before 2026-09-30 include grading.** `duration_s` used to stop after the LLM judge scored the case, which adds up to ~40s on criteria cases; it now stops when the turn ends. Measured the new way on main after the speed work: median 11.6s, 87 words. The slow tail is the SQL ranking cases (58-177s, 10-15k reasoning tokens), where the model worked through a denominator conflict. The owner decided (2026-09-30) that a ranking is out of all profiled schools; the recipe and the guard now agree with the prompt.
- **Large `get_facts` reads truncate.** `rows` and `unavailable` share a 60-row cap, and `getting-in` (90 facts) and `money` (63) exceed it alone, so a section read of either truncates and the model reads again by key, spending a round. Focused Answer now asks for exact keys; if it still happens, a larger cap (against the 20k inline limit) is the next step.

## DeepSeek on Fireworks (ADR 0043): what is left

Every live model call moved from Gemini on Vertex to DeepSeek V4.1 Flash on Fireworks (`plans/fireworks-deepseek-plan.md`). Still open:

- **The account price.** `model_prices` holds the highest Global rate Fireworks publishes ($0.30 in / $1.20 out per 1M); the docs also show $0.45/$1.80 (US) and $0.22/$0.66 (the model page). The owner confirms the account's rate on the Fireworks billing page, then the default changes.
- **Data terms, before real student data.** Student chats, profiles and essays now go to Fireworks. Confirm zero data retention and no training on prompts or outputs before production traffic; until then only synthetic or throwaway accounts.
- **Before the app is deployed (B6):** the app's privacy copy must name Fireworks as the model processor. Today the only privacy page is the landing waitlist's, which names no model provider, so nothing shipped went stale.
- **The parked CDS extraction system is still on Gemini** (`adapters/cds_gemini.py`, `model_cds_*`, the Vertex credentials). Reviving it (`PARKED.md`) means either keeping Vertex credentials for it alone or porting it to `app/llm.py`.
- **One client per model build.** `app/llm.py::build_model` makes a new `AsyncOpenAI` (and httpx pool) per call site and never closes it. The SDK's 600s default timeout is gone: `model_read_timeout_s` (45s) retries a chat turn's request that stalls before its first byte; non-streamed calls (judge, titles) and goal turns keep the SDK default. If sockets pile up under load, cache the client per key.
- **The judge gate's strict bar.** FPR is 0 in every run, but no effort gave two consecutive 1.000 runs; the two misses (test-22, test-28) have debatable labels. The owner relabels or accepts (`evals/goal_judge/REPORT-20260930-deepseek.md`).
- **Quick is slow and verbose; Think over-researches.** Quick at `low`, over the eval's 10 comparison cases: median 32.6s against Gemini's 17.1s, about twice the output tokens, p95 200s. One Think turn made 43 tool calls and hit the budget with an empty answer; a normal one took about 4.5 minutes and $0.35. The Think eval run at `high` was not completed.
- **A goal-drafted essay invented a personal anecdote** in the browser pass, against `essay-honesty`'s fabrication ban.
- **Transcript usage records carry no cost.** `est_cost_usd` is null in stored usage records (they keep raw usage); the streamed `usage` event is priced. Pre-existing.
- **Local Python needs IPv4.** On a workstation with broken IPv6, Python's HTTP clients hang on `api.fireworks.ai` instead of falling back (curl falls back). Fix it in the environment (`precedence ::ffff:0:0/96 100` in `/etc/gai.conf`), not in app code.

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

## Tasks redesign: drop the retired columns and export `reminder_at` first
- **What:** a follow-up migration to drop `counselle.tasks.status`, `priority`, `category`, `assignee`, `needs_input`, `due_at`, `planned_for`, and `reminder_at` — all kept for one release by migration `0019_tasks_redesign.sql` alongside the new `when_on`/`deadline_on`/`done_at`/`flagged`/`created_by_actor`/`last_actor` columns. Before dropping `reminder_at` specifically, export its values first — spec §10 promises the export and no code path writes or reads `reminder_at` anymore (D6, `plans/tasks-redesign-plan.md` §1), so the column is currently pure historical data with no application consumer.
- **Why:** the redesigned Tasks page (`when`/`deadline`/`flagged`/`done` vocabulary, both in the UI and in the agent tools) has fully replaced the old status/priority/category/assignee model; `status`/`completed_at` are only still written because `app/workspace/service_applications.py`'s progress rollup reads `status = 'done'` — that rollup needs to move to `done_at` before the column can go. Keeping eight dead columns around past one release is exactly the config/schema debt this project avoids.
- **Context (start here):** `migrations/0019_tasks_redesign.sql` (the header comment lists every survivor and why); `app/workspace/service_tasks.py` (the `done_at` ↔ `status` sync); `app/workspace/service_applications.py` (the progress rollup that still reads `status`); `plans/tasks-redesign-plan.md` §1 row D6 and P1.1.
- *(Logged from the tasks redesign, P8.4, 2026-09-04.)*

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
- **Note on the duplicate prefixes:** two pairs of migrations share a numeric prefix —
  `0019_tasks_redesign` + `0019_drop_school_requirements`, and `0020_task_sort_order` +
  `0020_essay_sessions` — because the branches were developed in parallel and were applied
  before they met. They are **not** renumbered: yoyo keys on the full filename stem, every
  stem is unique and already recorded as applied, and renaming any of them would make yoyo
  re-run it against a schema that already has the change. Each pair touches disjoint tables,
  so relative order within a prefix is irrelevant.
- **Context (start here):** `plans/school-page-slim.md` Phase 3 and risk R2;
  `migrations/0019_drop_school_requirements.sql` for the drop and its ordering rationale;
  `migrations/0011_school_workspace.sql` lines ~100-224 for the original DDL the
  rollback restores. For the applied state, query `_yoyo_migration` and
  `to_regclass('counselle.school_requirements')` on `localhost:5433` rather than trusting
  either this file or the commit that added the migration.
- *(Logged from the school-page-slim refactor, Phase 3, 2026-09-04; corrected from the essay AI
  panel branch, 2026-09-07, on finding the migration applied; duplicate-prefix note extended
  to the `0020` pair during the essay-panel merge, 2026-09-08.)*

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
## `TasksLayout.test.tsx`'s two detail-panel tests are flaky (pre-existing)

- **What:** `opens the detail panel when a row title is clicked` and `opens the detail panel
  for the task named in the ?task= query param` fail on roughly a third to a half of runs with
  `Unable to find role="textbox" and name "Task title"`. The panel's title field simply never
  appears; the rest of the page renders. Both fail the same way, and the second one never
  clicks anything — it renders straight onto `?task=<id>` — so this is the panel's *mount*
  being racy in jsdom, not the click path.
- **Why it matters:** it makes `npm test` non-deterministic, which trains people to re-run
  until green. It is also the likeliest explanation for the "detail panel never opens" report
  from an earlier in-browser pass that could not be reproduced by hand.
- **Not caused by the tasks UI/UX pass (2026-09-05):** confirmed by stashing that work and
  running the file five times on the pre-change tree — it failed three of five, on exactly
  these two tests. Raising `asyncUtilTimeout` does *not* fix it (the query still never
  resolves, it just times out later), so it is a real state race and not a slow machine.
- **Where to start:** `useDelayedUnmount` in `frontend/src/features/tasks/TaskDetailPanel.tsx`
  (`mounted` is adjusted during render, `entered` from a `requestAnimationFrame`), and
  `useIsDesktop` in the same file, which decides between the desktop `<aside>` and the mobile
  Base UI `Sheet` from `window.innerWidth` while the test setup's `matchMedia` mock always
  reports `matches: false`. Reproduce with
  `cd frontend && npm test -- --run TasksLayout` a few times in a row.

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
- **Why it is a TODO and not a bug:** it never clips the essay —
  `document.documentElement.scrollWidth === window.innerWidth` at every width measured, before
  and after the fix below. What it costs is one avoidable overlay: at **1141px with the sidebar
  collapsed the content row is 1093px**, wide enough to dock a 380px panel beside a 690px
  measure, and the panel still takes the whole width. That much is still true and still open.
- **What this entry used to claim, and got wrong (corrected 2026-09-08):** it concluded "a
  layout-quality miss, not a correctness one" off eight cells checked on the essay-AI-panel
  branch — a branch with **no task rail on the essay page**. Merging it into a `main` that had
  the tasks redesign put a 288px `EssayTasksSection` rail on the same row, keyed to Tailwind's
  viewport `xl` (also 1280px), so the two thresholds fired together and neither could see the
  other. At a 1280px viewport with the sidebar expanded the row is 968px, the rail took 288 and
  the panel 380, and the essay was left **130px of paper — eighteen characters a line** beside a
  rail holding nothing but "Tasks" and an empty quick-add. (1440/expanded was the second bad
  cell, at 274px/43ch.) Nothing clipped, nothing overflowed, every test and typecheck passed,
  which is exactly why it survived the merge — and **no test in CI can ever hold this**, because
  jsdom does not evaluate container queries at all. The threshold is only checkable in a browser.
- **Fixed for the rail (2026-09-08):** the `aside` is keyed to the measured
  `@container/essay-canvas` column instead of the viewport, at `@4xl` (896px). The container
  excludes the docked panel because the panel is an in-flow flex sibling (verified: the
  container's content box goes 1288 → 908 when the panel opens at 1600/expanded, in a headless
  Chromium that paints no scrollbar; 1278 → 898 where one is painted). Same container ladder
  `essay-paper-inset.ts` already steps on, so no second threshold was introduced. Re-measured in
  Chromium across {1280,1440,1600,1920} × {sidebar expanded, collapsed} × {panel open, closed}:
  the worst measure went from 130px/18ch to 392px/61ch, every panel-closed cell is unchanged to
  the pixel, and no cell overflows. The rail now yields before the paper does.
- **What the container key also changes, deliberately:** it makes the rail *appear* at widths
  where `xl:block` hid it unconditionally. Swept 700→1300 in 25px steps: the rail now arrives at
  a **~944px viewport with the sidebar collapsed and ~1208px expanded**, so a 1024px tablet on
  the sidebar rail gets a task rail on the essay page for the first time. Kept, because the grid
  says it is the better half: where the rail shows, the paper measures 61–74ch; where it does
  not, the paper sits on its `max-w-[820px]` cap at 108–115ch. The rail arriving earlier is what
  holds the measure inside DESIGN.md rule 17, not what costs it.
- **Known consequence, recorded not fixed:** at 1280/sidebar-collapsed/panel-open the measure
  went 61ch → 108ch, because that is the one cell where the rail used to be accidentally holding
  it legal. The root cause is older than this change — `max-w-[820px]` yields ~108ch on its own,
  so most panel-closed cells already violate rule 17. Capping the paper by measure rather than by
  pixels is the real fix and is out of scope here.
- **Known thin margin:** at 1600/expanded/panel-open the column measures 898px against the 896px
  threshold — 2px. It does not flip at runtime, but 3px on `--sidebar-width`, `--scrollbar-size`
  or the row's `lg:px-7` moves the paper ~330px with no code change. Left on the ladder on
  purpose; the arithmetic and the alternatives are written out at the `aside` itself.
- **Also fixed (2026-09-08), a defect the container key introduced:** the panel toggle crosses
  the rail's threshold, so a binary `hidden`/`block` put a 320px step inside the panel's 200ms
  reflow. rAF-sampled and resampled onto a 16.7ms frame at 1280/expanded, closing grew the paper
  to 722px and then took **321px back in a single frame** ~148ms in; opening handed 272px back
  the same way. The `aside` now transitions its own width (and `visibility`, so a 0-width rail is
  not still tabbable) over 200ms `ease-in-out` — the accordion carve-out of DESIGN.md §12.1 rule
  2. The rail's own worst frame is now 59px at 1280/expanded and 0–27px elsewhere, under the
  **67–71px the panel's own ease-out already moves the paper** in the same interaction. A control
  cell where the rail never toggles (1600/expanded) measures 64–71px closing and −267…−288px
  opening — the opening figure is main-thread jank from mounting the chat panel, is pre-existing,
  and is why a flat "no frame moves more than 40px" bar is not reachable here without changing
  the panel's own curve.
- **Still open — the dock threshold itself.** `useIsPanelDocked` is unchanged and still keys on
  `window.innerWidth`. The fix, if it is ever worth doing: key on the measured width of the row,
  the way the main chat's document panel already does — `EssayDocumentPanel.tsx` uses a
  `ResizeObserver` against a `MIN_DOCK_ROW_PX` floor precisely because a viewport breakpoint put
  the same 1280px viewport on opposite sides of the threshold. The two surfaces still disagree
  about how to answer the same question.
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

## The three public essay skills are within ~30 characters of their combined body cap
- **What:** `essay-brainstorm` + `essay-drafting` + `essay-revision` must stay co-selectable,
  so their bodies together must fit `MAX_SELECTED_SKILL_BODY_CHARS` (24,000). They currently
  measure **23,973 characters — 27 to spare**, held by
  `tests/app/test_skills.py::test_public_essay_trio_fits_selected_skill_body_budget`.
  `essay-revision` is separately at 194 body lines against its 195-line ceiling in
  `_BODY_LINE_LIMIT_EXCEPTIONS`. Adding a sentence to any of the three now costs a sentence
  somewhere else in the same trio.
- **Why it is not just "raise the cap":** the cap defends a real per-turn context limit — three
  skill bodies plus the system prompt, the essay, and the student context all ride the same
  turn. Growing it is a context-budget decision, not a formality.
- **What would actually fix it:** the trio has real duplication to reclaim — the "one trusted
  human reader" guidance appears twice in `essay-revision` alone (the essay-test section and
  the feedback-conduct section), and the ownership/honesty lines restate `essay-honesty`, which
  every essay skill already loads first. A dedup pass across the three would buy back room
  without cutting anything a student's answer depends on.
- **Context (start here):** `tests/app/test_skills.py` (the budget test and the per-skill line
  ceilings); `app/skills.py` for `MAX_SELECTED_SKILL_BODY_CHARS`; `skills/essay-revision/`,
  `skills/essay-drafting/`, `skills/essay-brainstorm/`.
- **The number has only ever gone down.** 39 characters of headroom were found while
  correcting the edits-become-suggestions wording; that correction spent 8 of them (39 → 31),
  and the follow-up that added the turn-wide scope to `essay-revision`'s edit-mechanics bullet
  spent 4 more (31 → 27), having already paid for most of itself by dropping "each rejectable
  on its own" (the next bullet says it) and tightening the essay-test section's trusted-reader
  line. Two prose fixes cost 12 characters. That is the rate to plan against.
- *(Logged 2026-09-08; re-measured after the honesty-wording follow-up the same day.)*

## The essay panel's "only this essay" promise is prompt-only, not enforced
- **What:** `config/assets/prompts/essay_partner.md` tells the model "you cannot see or touch
  essays other than the one loaded into this panel." The code does not make that true.
  `_ESSAY_SURFACE_WORKSPACE_TOOLS` (`app/agent_node.py`) mounts `view_essays`, `read_essay`,
  `edit_essay`, `write_essay`, and `update_essay` unscoped — each takes an arbitrary
  `essay_id` and is bounded only by `WHERE user_id = $1`, so any of the student's own essays
  is reachable from the panel. `ToolCtx.write_mode` compounds it: it is one value for the
  whole turn, derived from the *panel's* essay (`_write_mode`, turn-start `word_count == 0`),
  and it then governs writes to every essay that turn. A turn opened on an empty essay is in
  `direct` mode, and a write it aims at a different, non-empty essay commits straight in.
- **Why it is recorded and not fixed:** it is not a security hole — the user scoping is real,
  and nothing crosses between students. It is an honesty gap of the kind this area keeps
  producing: a sentence the model is told to believe that the server does not hold it to.
  Scoping the tools to the panel's `essay_id` (and making `write_mode` per-essay) is a
  contained change, but it is a behavior change to a shipped surface, not a wording fix.
- **Why it is worth doing eventually:** the residual per-essay ambiguity in *all* of this
  prose — `essay_partner.md`, `skills/essay-honesty`, `skills/essay-revision`, and both
  content-tool docstrings, every one of which says "the essay" and means the panel's —
  collapses to nothing the moment the scoping is real. It gets worse the other way: if
  anyone ever weakens the prompt line above to match the code, the panel loses its only
  statement of which essay it works on.
- **Context (start here):** `app/agent_node.py` (`_ESSAY_SURFACE_WORKSPACE_TOOLS`,
  `_write_mode`, `_load_turn_essay`), `app/workspace/agent_tools_shared.py` (`ToolCtx`),
  `config/assets/prompts/essay_partner.md` § "You only work on this essay".
- *(Logged 2026-09-08, found while correcting the applied-vs-proposed prose.)*

## `app/agent_node.py` is over its 800-line cap; the plan's own C6 stop condition tripped
- **What:** the file is now ~1,847 lines. C6 (`plans/goal-mode-plan.md`) revised Phase 3's
  budget upward from a fictional "~40-line extraction" to an honest "~150-250 net new lines
  across `app/agent_node.py` and `app/steps.py`, including the iteration lifecycle in C7" —
  and this batch's review found actual net growth from Phase 3 running roughly +485 lines
  against that stated 150-250, well past what C6 itself expected. The plan is explicit that
  splitting this file is its own branch, not something to fold into a fix batch, so nothing
  here attempts it.
- **The concrete split a reviewer proposed**, to do in that follow-up branch:
  - `app/goal_loop_runner.py` — `_run_goal_loop`, `_goal_step`, `_update_goal_ledger_totals`
    (and its `_usage_tokens`/`_price_usage_delta` pricing helpers), `_goal_wrapup_prompt`.
  - `app/agent_iteration.py` — `_run_once`, `_RunOnceResult`, the steer helpers
    (`_emit_injected_steers`, `_record_uninjected_steers`, `record_replayable_snapshot`).
  - `app/final_content_writer.py` — the viz placer/writer (`_FinalContentPlacementWriter`
    and friends).
  - `app/compaction_beat.py` — `_CompactionBeat`, `_SummarizingBeat`,
    `_make_compaction_beat_emitter`, `_clear_tool_results_tier`,
    `compaction_capabilities`.
- **Context:** `app/agent_node.py`; `plans/goal-mode-plan.md` §5.3 correction C6.
- *(Logged from the goal-mode Phase 3 review-fix batch, 2026-09-16.)*

## Non-goal tool-budget path: the viz card now renders after the budget message, not before
- **What:** when an ordinary (non-goal) turn hits its tool budget, the student now sees the
  "I hit my tool budget" message before any viz card the turn had staged, rather than after.
  This fell out of Phase 3 consolidating `flush_final()` down to the single terminal call
  described in `_run_once`'s docstring (`app/agent_node.py`) — previously turn-terminal
  flushing could happen at more than one point, and this ordering was one of the side effects
  of collapsing that to one call.
- **Why it's recorded rather than fixed:** a reviewer confirmed the new ordering is
  architecturally correct — `flush_final()` is genuinely turn-terminal and firing it earlier
  would reintroduce the multiple-terminal-flush hazard the consolidation removed. This is an
  intentional, user-visible product change (message-then-card instead of card-then-message on
  the tool-budget path), not a bug, and it should be acknowledged as an accepted change rather
  than left as an unexplained diff in a test assertion.
- **Context:** `app/agent_node.py` (`_run_once`'s docstring, `_TOOL_BUDGET_MESSAGE`,
  `flush_final`).
- *(Logged from the goal-mode Phase 3 review-fix batch, 2026-09-16.)*

## Goal mode (Part 8 non-goals) — deferred by the plan itself, not by omission
- **What:** `plans/goal-mode-plan.md` Part 8 records a list of non-goals for `/goal`
  Phases 0–5, all deliberate and none accidental:
  - **Sub-agents / delegation** and **durable, crash-proof goal runs** — both are now
    reachable via `pydantic-ai-harness==0.4.0`'s `experimental/subagents` and
    `experimental/step_persistence` without a PydanticAI 2.x upgrade (a correction to
    `specs/agent-mode/plan/agent-mode-architecture-plan.md`'s assumption that 2.x was
    required), but neither is built. A crash mid-run still loses the run today, same as
    any turn.
  - **A goals list page / `counselle.goal_runs` table.** No new table shipped (D8) —
    a goal run is only visible in its own chat message.
  - **Bulk undo of a goal run.** The plan's own §6.8 (Phase 8) sketches this as a
    follow-up on its own branch; not started.
  - **Re-deriving criteria after a steer.** A mid-run steer redirects *how* the agent
    works, never *what* it is judged against — criteria are frozen at goal start.
  - **A domain-specific `summary_prompt`** for the compaction summarizing tier (e.g.
    preserving school names/UNITIDs/deadlines/citation markers verbatim). Deferred until
    real goal-run traces exist to tune against — the shipped default summary prompt
    (`## Intent`/`## Key decisions`/`## Artifacts`/`## Current state`/`## Next
    steps`/`## Open questions`) is unmodified.
  - **Merging the two composers, splitting `app/agent_node.py`.** The line-budget entry
    above (`app/agent_node.py is over its 800-line cap`) already tracks the split
    proposal; this is the same debt, not a new one.
  - **An output validator.** Not deferred — **forbidden** (D5; see ADR 0041, `AGENTS.md`
    "No output validator was added and none may be").
- **Four Part 9 owner decisions were never made**, and were shipped at the plan's stated
  `Settings` defaults instead: (a) whether to add a one-time approval gate before a goal
  run's first tool call (shipped unattended); (b) which model tier judges (shipped on
  `model_cheap`, contrary to the MT-Bench literature the plan cites, though the measured
  adversarial eval result — 6/6 correct — did not reproduce that literature's failure
  mode); (d) a cost ceiling per student per month, as opposed to per run (not set); (e)
  the agent's own model tier for goal turns (shipped on `model_cheap` rather than the
  counselor tier — a real quality-for-cost trade on the student-facing work itself).
  Each is a `Settings` knob, so none of this requires a code change to revisit.
- **Phase 7 — the plan's own kill-gate — has not run.** No real student's raw goal
  statement has been tested against the shipped system. The plan states plainly that if
  most real statements decompose into vacuous or out-of-scope criteria, the right answer
  is a cheap, read-only "what's incomplete across my workspace" pass instead of more
  judge tuning — this has not been decided either way.
- **No real-browser verification.** Neither the plan's §7.4 live acceptance script nor
  the Phase 5 gate's dev-gallery check (nine `GoalStatus` fixtures at 1440px/390px) ran
  in an actual browser during this work; everything on the frontend is verified at the
  jsdom/unit level only.
- **The judge eval's TPR=1.000 is one clean run, not demonstrated stability.** A
  confirmation re-run under the same pinned settings (`temperature=0.0`) was launched to
  rule out a lucky draw and did not finish before the measuring session ended — see
  `evals/goal_judge/REPORT-20260916T160355Z.md`'s own closing section. Re-run the gate at
  least once more before treating the number as stable.
- **The §2.10 budget defaults are a projection, not a measurement** — the loop did not
  exist yet when the cost spike that produced `goal_max_cost_usd`/`goal_max_model_requests`
  and the rest of that table ran (Phase 0's S8). Re-derive them against a real run's
  logged spend once Phase 7 produces one.
- **Context:** `plans/goal-mode-plan.md` Part 8 (non-goals) and Part 9 (open owner
  decisions); `docs/adr/0041-goal-mode.md` Consequences; `docs/ARCHITECTURE.md` §42.7.
- *(Logged from the goal-mode Phase 6 documentation pass, 2026-09-16. `plans/goal-mode-plan.md`
  stays in `plans/` — it graduates to `specs/goal-mode/` only after owner acceptance, per
  the planning-workflow rule; it was NOT moved as part of this entry.)*

## The goal-only summarizing compaction tier has never run against a real model
- **What:** the `SummarizingCompaction` tier (D11) is mounted, disclosed, and tested, but
  every test drives it through a `FunctionModel` — no live goal run has yet crossed
  `goal_compaction_target_tokens` and paid for a real summary. So three things are
  built-and-unmeasured rather than verified: (1) whether a real summary keeps a goal run
  coherent across the cut (the plan's Phase 6 scenario E), (2) whether 100,000 /
  8,000 (`goal_compaction_target_tokens` / `goal_compaction_keep_tokens`) are the right
  numbers — they are ported from OpenCode's defaults, not measured here, and the same
  caveat as the §2.10 budget defaults applies, and (3) what a real summary costs inside
  the ledger, which now carries it at the agent's own rate.
- **Also still open:** the domain-specific `summary_prompt` (school names, UNITIDs,
  deadlines, citation markers verbatim) that `plans/goal-mode-plan.md` §4.3 defers until
  real traces exist — already recorded above under the Part 8 non-goals, and the same
  traces close both items.
- **Why it's recorded rather than fixed:** it needs a real, long goal run, which is
  Phase 6/7 dogfood work and costs real money; guessing at the numbers first is exactly
  what §4.3 says not to do.
- **Context:** `app/agent_node.py` (`compaction_capabilities`, `_SummarizingBeat`);
  `config/settings.py` (`goal_compaction_*`); `tests/app/test_agent_node_compaction.py`.
- *(Logged when the summarizing tier was built, 2026-09-16.)*

## Goal mode: opening a long goal run mid-flight shows a blank "Starting response…"
- **What:** reloading, or opening from the sidebar, a goal run that is still in progress
  can show only the student's message and the generic starting beat — no goal line, no
  plan, no tool beats — until the run ends and the transcript is persisted. Short goal
  runs are unaffected once finished: a settled run replays correctly from the transcript.
- **Observed (2026-09-18):** a live goal run ~25 minutes in. `GET /sessions/{id}` returned
  a transcript holding only the user message; `GET /sessions/{id}/stream` returned 200
  (so the registry had an active turn) and replayed no events, several times closing
  within ~6ms. Reproduced on a fresh page load with no dev hot-reload involved.
- **Likely cause, not confirmed from logs:** `app/turns.py::_follow` terminates a consumer
  that "fell off the buffer head" rather than skip events. The replay buffer is
  byte-budgeted (`stream_buffer_bytes`), so a long goal run evicts its early events; a
  fresh attach from seq 0 then falls off the head, and the client's transcript fallback
  has nothing to show because a live turn's assistant message is not persisted yet.
  That rule is right for a short turn and a real hole for a run designed to last up to
  an hour. Confirm by looking for `consumer fell off the buffer head` in the server log.
- **Why it was not fixed here:** it is the turn registry's replay contract, not the goal
  UI. The honest fix is structural — e.g. keep the latest `goal` and `write_plan` steps
  replayable regardless of eviction, or persist a partial transcript for long turns —
  and deserves its own change, not a patch smuggled into a UI pass.
- *(Logged from the goal-mode UI/UX pass, 2026-09-18.)*

## Goal mode: the agent runs on the cheap tier, not the student's selected mode
- **What:** `goal_agent_model_setting` falls back to `model_cheap` (D15), so a goal turn
  ignores Quick/Think. In live runs on 2026-09-18 the cheap tier planned myopically (a
  2-step plan for a 3-school goal, grown to 6 as it went) and, once, gave up and asked the
  student for dates despite the prompt's "state assumptions, don't ask" rule — the check
  then correctly sent it back. Setting `COUNSELLE_GOAL_MODEL` is a one-line change, but
  `goal_max_model_requests` and `goal_max_total_tokens` are derived from cheap-tier
  pricing under the $3.00 cap, so raising the model means re-deriving both. Owner call.
- *(Logged from the goal-mode UI/UX pass, 2026-09-18.)*

## `search_school_site` searched the wrong school's website
- **What:** during a goal run, a beat read "Searching Dalton State College's website:
  'Emory University Regular Decision deadline 2027'" and returned federalregister.gov
  and Dalton State results. The `.edu` search resolved Emory to the wrong institution.
  Unrelated to goal mode — seen there only because goal runs do a lot of searching.
- *(Logged from the goal-mode UI/UX pass, 2026-09-18.)*
