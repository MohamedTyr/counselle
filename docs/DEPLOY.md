# Deploying Counselle

> This is the deployment runbook — how Counselle is deployed and the traps to avoid. For the current deployment **status** (whether a given environment is live), see `CLAUDE.md`. **Deploy itself is deferred** — this is the plan, updated for the school-data-v3 topology, not a verified runbook. Nothing in this document has been executed end to end against a fresh managed Postgres; the exit test below (§ Deploy checklist) is what proves it, and it has not been run.

Decision context: ADR 0023 (SPA same-origin, one deployable), ADR 0038 (school-data-v3: the CollegeData facts store replaces the CDS Library as the deployed data surface; the CDS extraction pipeline is parked in place, per `PARKED.md`). The execution narrative lives in [`../specs/mvp2/plan/ship-plan.md`](../specs/mvp2/plan/ship-plan.md); the schema/role model referenced throughout is `../specs/school-data-v3/plan/school-data-v3.md` §3.

## What the deploy image must include

The deploy image is a single same-origin container (API + built SPA). It must provide:

- **A multi-stage container**: a Node stage (`npm ci`, `npm run build`, `VITE_TRANSPORT=http`) producing `frontend/dist`, copied into the Python stage.
- **SPA same-origin serving** in `api/main.py`: Settings-gated static serving — landing at `/`, SPA fallback, `/v1` passthrough (the API surface).
- **Runtime hygiene**: `uv sync --frozen --no-dev` at build; `exec` the venv binaries directly (no `uv run` at runtime); **keep `psycopg2-binary` in main deps** (yoyo's driver — if it sits in the dev group, `--no-dev` bricks the migration step); a tightened `.dockerignore` (`frontend/node_modules`, `tests/`, `docs/`, `plans/`, `specs/`, `evals/report-*`).
- **No catalog warm-up:** there is no field index, embedding job, or startup reconciler. The facts store's `school_explore_rows`/`fact_coverage_counts` tables are upserted per school by the crawl worker, not rebuilt at boot.
- **PyMuPDF, with no extra OS packages:** the parked CDS extraction pipeline (`domain/cds/`, `adapters/cds_*`) uses PyMuPDF (`pymupdf`) to open and page PDFs, and its code stays in-tree and importable even while unmounted (`PARKED.md`). It needs no `apt-get` install on the `python:3.12-slim` base — per `uv.lock` it ships `manylinux_2_28` wheels with MuPDF statically bundled, so don't add system libraries for it.

## Database first (everything depends on a reachable DSN)

Under school-data-v3 the `cds_library` schema holds the **CollegeData facts store**, not CDS packets: `schools` (IPEDS identity, unchanged) plus eight new tables (`collegedata_schools`, `page_snapshots`, `school_pages`, `school_facts`, `school_explore_rows`, `fact_coverage_counts`, `facts_jobs`, `crawl_runs`) and exactly six reader views (`school_profiles`, `current_school_facts`, `school_facts_sql`, `school_explore`, `school_data_status`, `fact_coverage`). The CDS extraction pipeline (manifest, packets, `cds_extractions`) is parked — its DDL and data are preserved but not part of a fresh deploy's live schema (`PARKED.md`).

1. Provision Postgres 16 (managed or VPS), **co-located with the app**.
2. **The container provisions the schema itself on boot** (`scripts/entrypoint.sh` → `scripts/seed_reader_db.py`) — there is no separate manual schema-provisioning step on a fresh database. It reconciles the roles (`counselle_app`, `counselle_ro`, `cds_library_reader`, `cds_library_owner`, `cds_library_app`) — `cds_library_app` always exists so the seed's grants resolve, but it is only given `LOGIN` and a password when `COUNSELLE_DB_PIPELINE_DSN` is configured — applies `deploy/seed/cds_library_schema.sql` unconditionally (every statement is `IF NOT EXISTS`/`CREATE OR REPLACE`, so re-running it on a warm database is a no-op), and loads `deploy/seed/schools.csv.gz` into `cds_library.schools` the first time the table is found empty. This is why `COUNSELLE_DB_ADMIN_DSN` is required at boot (§ environment matrix) — the seed owns every `cds_library` object now, so a missing admin DSN is not a degraded mode, it's a boot failure.

   > ⚠️ **`seed_reader_db.py` writes cluster-global roles**, not database-scoped ones: `CREATE ROLE`/`ALTER ROLE` land on the whole Postgres cluster, not just the database in the DSN you point it at. Running it (directly, or via the entrypoint) against a scratch or throwaway database on a cluster that also hosts a real one **silently rewrites that real database's `counselle_app`/`counselle_ro`/`cds_library_app` role passwords and `LOGIN` state**, breaking every credential in its `.env` with no error at the time it happens. Never point this script, or a container that runs it on boot, at a database sharing a cluster with one you are not prepared to have its roles rewritten on.

3. Verify after boot: a LOGIN role that is a member only of `cds_library_reader` can select all six reader views and is denied on every base table (nine, including `schools`). Separately, `cds_library_app` (the facts crawler's write role, `COUNSELLE_DB_PIPELINE_DSN`) can `INSERT, SELECT, UPDATE` on the eight facts-store tables and `DELETE` only on `page_snapshots` (retention) — never on `schools`.
4. The entrypoint also runs `python -m app.facts crosswalk-sync` on every boot, upserting the committed `config/facts/collegedata_crosswalk.csv` into `collegedata_schools` (the seed creates that table empty; `app/facts/crosswalk.py` is its only loader). This needs `COUNSELLE_DB_PIPELINE_DSN` too, which is why that DSN is **required** at boot under v3 (`scripts/entrypoint.sh`'s `required_env` hard-fails with `exit 1` if it is empty) even before anyone turns the crawl worker on. There is no optional/degraded mode for an *unset* DSN — that only exists for one that is set but unreachable (§ environment matrix).
5. The entrypoint then applies the Counselle migration chain (`yoyo apply --batch`) against `COUNSELLE_DB_APP_DSN`'s `counselle` schema.
6. Set all four DSNs (`COUNSELLE_DB_RO_DSN` for the reader login, `COUNSELLE_DB_APP_DSN` for `counselle.*`, `COUNSELLE_DB_ADMIN_DSN` for the container's bootstrap connection, `COUNSELLE_DB_PIPELINE_DSN` for the facts crawler's write role — all four required at boot); use `pool_min ≥ 2` on non-free production databases. For a side-by-side local cutover, bind the database to loopback only.

### Storage budget (the crawl worker's own growth, once turned on)

Snapshot bodies are byte-stable per page (verified), so `page_snapshots` grows only on an actual content change, capped at 3 retained snapshots per page in-pass. The plan's measured estimate (`../specs/school-data-v3/plan/school-data-v3.md` §6c, R5): **≈95 MB of jsonb after the first full pass**, growing with steady-state changed pages toward **≈300 MB worst case**. Check the managed provider's plan against that before turning the worker on — this was not re-measured against a live production pass, it's the plan's own estimate.

### The Render Starter + Supabase staging path

This is the small staging/demo target. The web service must be an **always-on paid instance**, not Render's free tier: a free instance sleeps on inactivity, and the in-process facts crawl worker (`COUNSELLE_FACTS_WORKER_ENABLED`) never gets a chance to run a pass if the process isn't running. The checked-in `render.yaml` sets `plan: 0.5c-512mb` (Render's current paid-tier plan id for what used to be called "Starter" — legacy plan names like `starter` still resolve, but `render.yaml` uses the current id) for exactly this reason; do not downgrade it back to `free` without re-reading this paragraph.

1. Keep the Render app and Supabase database in the closest available US regions to each other. The checked-in `render.yaml` uses Render `oregon`.
2. Confirm the source database fits the target Supabase plan before importing:

   ```bash
   psql "$COUNSELLE_DB_APP_DSN" -Atqc \
     "select pg_size_pretty(pg_database_size(current_database()));"
   ```

3. Export the current database into a local, gitignored artifact:

   ```bash
   mkdir -p artifacts/deploy
   pg_dump --format=custom --no-owner --no-acl \
     --file artifacts/deploy/counselle-supabase.dump \
     "$COUNSELLE_DB_APP_DSN"
   ```

4. Create a Supabase project. Prefer Postgres 16 if the dashboard offers a version choice; otherwise run the gates below against the Supabase version. Use the Supabase admin connection string only for restore/bootstrap. Then restore the dump, create the runtime roles (including `cds_library_app`), verify the six-view reader contract, and print the Render secret env vars:

   ```bash
   SUPABASE_ADMIN_DSN="postgresql://postgres..." \
     uv run python scripts/finish_supabase_staging.py
   ```

5. Export the three runtime DSNs printed by the Supabase helper — **`COUNSELLE_DB_PIPELINE_DSN` is required at boot under v3** (the entrypoint's `crosswalk-sync` step needs it even before the facts crawler or the parked CDS admin surface are turned on; `scripts/finish_render_staging.py` fails fast if it's missing rather than deploying a service that would crash-loop) — then create/update the Render web service, trigger the current commit deploy, and verify `/v1/health`:

   ```bash
   export COUNSELLE_DB_RO_DSN="postgresql://counselle_ro..."
   export COUNSELLE_DB_APP_DSN="postgresql://counselle_app..."
   export COUNSELLE_DB_PIPELINE_DSN="postgresql://cds_library_app..."
   uv run python scripts/finish_render_staging.py --wait
   ```

   The helper uses the logged-in Render CLI API key, the Docker `Containerfile`, and the model/search keys from the environment or `.env`. Re-running it **merges** onto the service's existing env vars rather than replacing them wholesale (a bare PUT of Render's env-vars endpoint drops anything the script doesn't know about — the fix reads the current set first) — so a secret set once by hand in the Render dashboard (a rotated `COUNSELLE_DB_ADMIN_DSN`, say) survives a later re-run. For Render-to-Supabase traffic, use Supabase's session-pooler connection strings when direct database connections are unavailable from IPv4-only networks. The pooler username form is role-qualified, for example `counselle_app.<project-ref>`, `counselle_ro.<project-ref>`, and `cds_library_app.<project-ref>`.
6. For a small Supabase plan, keep `COUNSELLE_DB_POOL_MIN=1` and `COUNSELLE_DB_POOL_MAX=5` unless measured traffic says otherwise. Counselle opens separate app/read pools plus, when configured, the pipeline pool, so idle connection count matters on small databases.

### An operational fact, not a to-do: the free Supabase Postgres expires 2026-09-18

The owner's current free Render Postgres project expires **2026-09-18** — nine days out from the date this section was last touched. Provisioning a replacement (a new free project, or a paid one) is an **owner step**, not something this repo automates, and it is a hard deadline for any deploy that depends on that database staying reachable. Nothing in-repo hardcodes the expiring host; a new project just needs its DSNs exported through the steps above.

### The first v3 deploy drops the entire `counselle` schema

The first deploy of this branch against an existing staging database **drops the entire `counselle` schema** — all accounts, OAuth links, student profiles, workspaces, feedback, and sessions. This is a one-time consequence of the school-data-v3 cutover (D9, `../specs/school-data-v3/plan/school-data-v3.md` §0), not a property of every future deploy — but whoever runs this cutover on the shared staging environment needs to know it in advance, not discover it after.

**Do not run the drop below before D9's backup step.** D9 requires "a restore-verified full dump copied off the workstation" before anything is dropped (`../specs/school-data-v3/plan/school-data-v3.md` §0, execution detail in §7 Phase 0). Do that first:

```bash
mkdir -p artifacts/deploy
pg_dump --format=custom --no-owner --no-acl \
  --file artifacts/deploy/pre-v3-cutover.dump \
  "$COUNSELLE_DB_APP_DSN"

# Restore-verify into a scratch database before proceeding:
createdb pre_v3_cutover_restore_check
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname postgresql://localhost/pre_v3_cutover_restore_check \
  artifacts/deploy/pre-v3-cutover.dump
dropdb pre_v3_cutover_restore_check

# Then copy artifacts/deploy/pre-v3-cutover.dump off this workstation
# (a second disk, another machine, cloud storage) before proceeding — D9
# requires both the restore verification and the off-workstation copy.
```

Only once that dump exists, is restore-verified, and is copied off the workstation, run the drop itself against the target staging database — this repo ships no automated command for it, so type the database name below in by hand rather than pasting a variable, as the confirmation gate:

```bash
# Confirm you are pointed at the intended staging database before running this.
psql "$COUNSELLE_DB_APP_DSN" -Atqc "select current_database();"
# If, and only if, that printed the staging database you mean to reset:
psql "$COUNSELLE_DB_APP_DSN" -c "DROP SCHEMA counselle CASCADE;"
```

The next boot's `yoyo apply --batch` recreates `counselle` from migration `0001` onward. Immediately afterward: set `COUNSELLE_DB_RESET_NOTICE_DATE` to today's date (nothing sets it automatically — see § environment matrix) so the in-app notice renders, and re-run `scripts/promote_admin.py --email …` for each admin before `/app/admin/facts` is reachable again.

## The environment matrix

A first deploy easily forgets the agent-core half. The complete set:

**Database & sessions**
- `COUNSELLE_DB_RO_DSN`, `COUNSELLE_DB_APP_DSN` (required)
- `COUNSELLE_DB_ADMIN_DSN` (required — the container's own bootstrap connection; see § Database first)
- `COUNSELLE_DB_PIPELINE_DSN` — the facts crawler's write role (`cds_library_app`, ADR 0038), and also the parked CDS admin write path's DSN. **Required at boot** under v3 (the entrypoint's `crosswalk-sync` step needs it), even before the crawl worker itself is turned on. The app degrades the CDS admin surface to its documented 503 and no-ops the facts worker (logs, does not fail boot) if this DSN is set but unreachable.
- `COUNSELLE_CDS_WORKER_ENABLED` — **must stay `false`** wherever `COUNSELLE_DB_PIPELINE_DSN` drives the facts crawler (the parked CDS extraction poller would otherwise spin forever against a dropped `cds_extractions` table). Defaults `false`; set it explicitly rather than relying on the default.
- `COUNSELLE_FACTS_WORKER_ENABLED` — the in-process facts crawl worker's kill switch. Defaults `false`: turning a brand-new crawler against a third-party site on is a deliberate step taken after staging verification, not a side effect of setting the other DSNs. Requires an **always-on** web instance (see § Render Starter path above) — a sleeping free instance never runs a pass.
- `COUNSELLE_CHECKPOINTER=postgres`
- `COUNSELLE_SESSION_TTL_DAYS` (optional; unset = keep everything)
- `COUNSELLE_DB_RESET_NOTICE_DATE` (optional; `config/settings.py`, `.env.example`) — **defaults to unset, and nothing sets it automatically.** It is absent from `render.yaml`'s `envVars` and from `finish_render_staging.py`'s env dict, so it does not appear as a side effect of a normal deploy. This is an explicit operator step for the D9 cutover only: set it (format `YYYY-MM-DD`) by hand in the platform's env vars right after running the schema drop in § "The first v3 deploy drops the entire `counselle` schema" — otherwise the in-app reset notice never renders for the users it was written for. `COUNSELLE_DB_RESET_NOTICE_DAYS` (default `30`) controls how long it keeps rendering.

**CollegeData facts crawler (`FACTS_*`, all optional — sane defaults ship in `config/settings.py`)**
- `COUNSELLE_FACTS_CRAWL_USER_AGENT` — must name a real contact URL (`http://`/`https://`); the code refuses to boot with the documented placeholder left in place if the worker is enabled
- `COUNSELLE_FACTS_CRAWL_RPS` (default `1.0`), `COUNSELLE_FACTS_CRAWL_CONCURRENCY` (default `1`) — the crawl rate against collegedata.com; the plan's Q9 default is 1 req/s with adaptive backoff
- `COUNSELLE_FACTS_CRAWL_INTERVAL_HOURS` (default `24`), `COUNSELLE_FACTS_WORKER_POLL_SECONDS` (default `30`), `COUNSELLE_FACTS_CRAWL_LEASE_SECONDS` (default `180`)
- `COUNSELLE_FACTS_STALE_DAYS` (default `120`) — when a school's facts flip to the stale caveat

**Models / GCP**
- Application Default Credentials (preferred): a workload identity or
  `GOOGLE_APPLICATION_CREDENTIALS` service-account configuration. For local
  development, use `gcloud auth application-default login`. `COUNSELLE_VERTEX_API_KEY`
  remains an Express-mode fallback where authorization keys are permitted.
- `COUNSELLE_GOOGLE_CLOUD_PROJECT`, `COUNSELLE_GOOGLE_CLOUD_LOCATION`
- `COUNSELLE_MODEL_COUNSELOR` (Quick), `COUNSELLE_MODEL_COUNSELOR_THINK` (Think), `_CHEAP`, `_CLARIFIER`, `_TITLE`, display-name/preview fields, and `COUNSELLE_MODEL_PRICES`
- `COUNSELLE_RESPONSE_MODE_THINK_ENABLED` — leave false until Think's target environment has verified Vertex/Express Mode quota, live smokes, and accepted quality/cost; disabled Think is omitted from `/v1/config` and never silently falls back to Quick
- `COUNSELLE_THINKING_STREAM` — native provider thought-summary gate for Think, not the Quick/Think selector

**Sources**
- `COUNSELLE_TAVILY_API_KEY` (required when any external source is enabled)

**Auth (ADR 0021)**
- `COUNSELLE_JWT_SECRET` — a **stable** ≥32-byte secret (rotating it logs everyone out)
- `COUNSELLE_OAUTH_STATE_SECRET` (DS-09) — **required and DISTINCT in prod** (do not reuse the JWT secret). The dev fallback to `COUNSELLE_JWT_SECRET` is **dev-only**: reusing one secret for two crypto purposes (session JWTs + OAuth CSRF state) couples their blast radius. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `COUNSELLE_COOKIE_SECURE=true` (HTTPS only in prod)
- `COUNSELLE_GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, with the **production** redirect URI registered: `https://<domain>/v1/auth/google/callback`
- Public staging allows email/password self-signup:
  `COUNSELLE_AUTH_SELF_SIGNUP_ENABLED=true`. Password reset can stay disabled
  with `COUNSELLE_PASSWORD_RESET_ENABLED=false` until real email delivery is
  configured.

**API**
- `COUNSELLE_CORS_ORIGINS` — the default is now **empty** (06-L1; the fail-safe under same-origin serving, ADR 0023). Leave it empty in prod; the split-origin **dev** setup sets `["http://localhost:5173"]`.
- `COUNSELLE_API_HOST=0.0.0.0`, `COUNSELLE_API_PORT=8000`
- `COUNSELLE_TRUSTED_PROXY_CIDR` (required) — the platform's proxy CIDR, passed straight through to uvicorn's `--forwarded-allow-ips` by `scripts/entrypoint.sh`. Never `'*'` (see below) — that lets a client forge its own `X-Forwarded-For` entry and defeat the per-IP auth rate limit. Consumed only by the entrypoint shell script as a CLI argument; deliberately not on the ADR 0018 Settings surface, so it is never read by Python.

> **`$PORT`-injecting hosts (CFG-11):** `scripts/entrypoint.sh` binds
> `--port "${PORT:-8000}"`, so Render's injected port works without a target-specific
> command override.

## Open security items (must close before public traffic)

- **DS-04 — OAuth `associate_by_email=True` + no email verification.** Email-based account linking without proof of email ownership is an account-takeover surface (a password account on an email links with a later Google sign-in for that email, and vice-versa). A documented MVP tradeoff (ADR 0021, PRD decision 6), **NOT shipped fixed in the hardening pass**. Before any non-trivial user base, do one of: (1) require email verification before login, (2) only associate-by-email when the existing account is verified, or (3) gate `current_active_user` on `is_verified` for password accounts. See `plans/audit/phase-6-configurability.md` DS-04 and `TODOS.md`. **Blocks B6.**
- **DS-09 — distinct `COUNSELLE_OAUTH_STATE_SECRET`** in prod (see the env matrix above).

DS-04 blocks public OAuth launch. It does not block the five-user staging slice
when Google OAuth is unconfigured and public signup/password reset are disabled.

## Entrypoint & the one flag that breaks first

The entrypoint provisions the database (`scripts/seed_reader_db.py`), syncs the CollegeData crosswalk (`python -m app.facts crosswalk-sync`), then runs `yoyo apply --batch` (app DSN — migrations stay additive, so a failure crash-loops back to the previous image) and finally:

```bash
exec uvicorn api.main:create_app --factory --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="${COUNSELLE_TRUSTED_PROXY_CIDR}"
```

**`--forwarded-allow-ips` is the flag the first OAuth attempt dies without — but it must name the platform's trusted proxy CIDR, never `'*'`.** Behind the host's TLS terminator, an untrusted `X-Forwarded-Proto` makes the app think it's on `http`, so the Google `redirect_uri` generates as `http://` → `redirect_uri_mismatch`; trusting the proxy's real CIDR (set via `COUNSELLE_TRUSTED_PROXY_CIDR`) fixes that the same way `'*'` would, without also letting a client forge its own `X-Forwarded-For` entry and walk straight through the per-IP auth rate limit.

## Deploy checklist

- [ ] All six `cds_library_reader` views (`school_profiles`, `current_school_facts`, `school_facts_sql`, `school_explore`, `school_data_status`, `fact_coverage`) readable and all nine base tables denied through the reader-login DSN
- [ ] Counselle application schema provisioned through its separate app DSN
- [ ] Full env matrix set (§ environment matrix, including the `FACTS_*` block); `CORS_ORIGINS` emptied; `COOKIE_SECURE=true`; `COUNSELLE_CDS_WORKER_ENABLED=false`
- [ ] Five-user staging only: signup, Google OAuth, and password reset are closed by env (`COUNSELLE_AUTH_SELF_SIGNUP_ENABLED=false`, `COUNSELLE_PASSWORD_RESET_ENABLED=false`, no Google OAuth client configured); tester accounts pre-created by hand or through `scripts/promote_admin.py` for admins — there is no dedicated tester-management or auth-closed-verification script in this repo (an earlier revision of this checklist named `scripts/manage_tester.py` and `scripts/check_staging_auth_closed.py`, neither of which exists; if that gate matters, write it, don't assume it)
- [ ] Migrations ran on boot; `/v1/health` returns HTTP 200 with `"status": "ok"` (there is no separate `/v1/ready` route — `/v1/health` is the one liveness/readiness endpoint the app exposes, `api/routes/system.py`)
- [ ] SSE un-buffered end-to-end (the TLS terminator must not buffer the stream)
- [ ] Cookies set under TLS; **Google OAuth works on the prod domain** (the forwarded-proto proof)
- [ ] One cold-boot run measured (first-turn latency; there is no MCP child to spawn under v3 — the agent's facts tools are in-process)
- [ ] If the facts crawl worker is turned on: the web instance is on the always-on paid plan (§ Render Starter path), `/v1/health`'s `facts_worker` field is `"ok"` or `"disabled"`, never silently `"stale"`
- [ ] Playwright smoke passes against production: invite login → ask a known school question → stream with timeline → reload mid-stream → full-fidelity transcript (there is no committed automated release-gate script; do this by hand or write one before relying on it)
- [ ] Security pass: response headers, cookie flags, no secrets baked into the image, admin routes gated
- [ ] Backups: rely on the managed provider's own snapshots (this repo ships no separate backup job) — confirm the provider plan actually includes point-in-time recovery before depending on it
- [ ] If this deploy is the D9 cutover (dropping an existing `counselle` schema): the restore-verified, off-workstation backup exists (§ "The first v3 deploy drops the entire `counselle` schema"), and `COUNSELLE_DB_RESET_NOTICE_DATE` was set by hand immediately after the drop

## The public landing site (Cloudflare Pages)

The marketing site at `https://acceptra.ai` (the landing page, `/privacy` and `/terms`) deploys on its own, as a static Cloudflare Pages project, independent of the app container above. It has no app API behind it. Two Pages Functions in the same project cover what a static file can't: `POST /api/waitlist` (`frontend/functions/api/waitlist.ts`) stores signups in a Cloudflare D1 database, and `/ingest/*` (`frontend/functions/ingest/[[path]].ts`) proxies PostHog on our own origin so ad blockers don't hide visits. `public-landing/_routes.json` limits Functions to those two paths, so static files never invoke one. The decisions behind this shape are in `plans/landing-seo-plan.md` (static build, hosting, headers) and `plans/landing-backend-plan.md` (waitlist storage, the proxy).

**Build.** `cd frontend && npm run build:landing` builds only the three pages into `frontend/dist-landing` with `public-landing/` as the public directory, then `scripts/prerender-landing.mjs` renders the page to HTML (so crawlers that do not run JavaScript get the full page), writes it as `index.html`, adds the two font preloads, and fails the build if any `/assets/` URL in the page is missing. The waitlist endpoint and the analytics proxy are both same-origin, so the report-only CSP in `_headers` is `'self'` for scripts and connections.

| Pages setting | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm run build:landing` |
| Output directory | `dist-landing` |

`frontend/wrangler.toml` is the project's config: its name, `pages_build_output_dir`, and the D1 binding (`DB` → `acceptra-waitlist`, migrations in `frontend/migrations-landing/`). Once that file exists the dashboard shows bindings read-only, so change the binding there, never in the dashboard.

`public-landing/` carries `robots.txt`, `sitemap.xml` (update each `<lastmod>` when that page changes), `llms.txt`, the `404.html` that keeps unknown paths from returning the homepage with a 200, `_redirects`, `_headers` (security headers, immutable assets, `noindex` on every `*.pages.dev` host), the icon set, `og.png` and `logo.png`. The facts the page, the structured data and `llms.txt` share (the definition, the school count, founders, official profiles) live in `frontend/src/features/landing/brand.ts`; change them there and in `llms.txt` together.

**The waitlist (D1).** Signups live in one table, `waitlist` (`frontend/migrations-landing/0001_waitlist.sql`), keyed by the normalised email. A repeat email is an update: on the same side it fills in answers and never clears one, a side switch drops the old side's answers, and `source`, `plan`, the `utm_*` tags and `created_at` never change after the first signup. The endpoint checks method, `Origin`, JSON content type and a 2 KB size cap, validates every field against the table's allow-lists (a bad campaign tag is dropped, not rejected), answers a new and a repeat email identically, and logs only an error code on a D1 failure. After any change to the update statement, run the integrity check, which aborts on a broken rule:

```bash
cd frontend
npx wrangler d1 migrations apply acceptra-waitlist --local
npx wrangler d1 execute acceptra-waitlist --local --file migrations-landing/checks/check_upsert.sql
```

It lives in `checks/` because Wrangler applies every `.sql` directly in `migrations_dir` as a migration.

First-time setup, once (`npx wrangler login` first):

- [ ] `npx wrangler d1 create acceptra-waitlist`, and put the printed `database_id` in `frontend/wrangler.toml`
- [ ] `npx wrangler d1 migrations apply acceptra-waitlist --remote`
- [ ] A rate-limiting rule on the zone: path equals `/api/waitlist`, 10 requests per 10 seconds per IP, block for 10 seconds (zone-scoped, so it doesn't cover `*.pages.dev`; the `Origin` check still does)
- [ ] After the first deploy: one real signup, check the row, delete it

Reading the list:

| Question | Where to look |
|---|---|
| How many signed up | `SELECT count(*) FROM waitlist;` in the D1 console. D1 is the count; PostHog's `waitlist_joined` can be blocked and is for the curve |
| Conversion and drop-off | the PostHog funnel: pageview → `waitlist_opened` → `waitlist_joined` → `waitlist_details` |
| Which channel converts | the funnel broken down by `utm_source`; exact counts with `SELECT utm_source, count(*) FROM waitlist GROUP BY 1;` |
| Who they are | `SELECT side, role, class_of, count(*) FROM waitlist GROUP BY 1,2,3;` |
| Export | `npx wrangler d1 export acceptra-waitlist --remote --output waitlist.sql` |
| Delete on request | `DELETE FROM waitlist WHERE email = ?;` in the D1 console, within 30 days of the email |

At app launch the table is exported once and loaded into a `counselle.waitlist` table in Postgres; the shape carries over unchanged.

**The analytics proxy.** `/ingest/static/*` and `/ingest/array/*` go to `us-assets.i.posthog.com` (cached at the edge), everything else under `/ingest/` to `us.i.posthog.com`. Only `GET`, `POST` and `OPTIONS` are forwarded; `Cookie`, `Authorization` and `Host` never are, and `X-Forwarded-For` carries the visitor's IP so PostHog's location lookup keeps working. It follows PostHog's Cloudflare proxy doc (https://posthog.com/docs/advanced/proxy/cloudflare); recheck the upstream hosts there if events stop arriving. If it breaks, analytics stops and signups carry on. On a machine without working IPv6, `wrangler pages dev` reaches PostHog only after minutes of IPv6 timeouts, or not at all, because workerd tries every IPv6 address before IPv4; that is local only.

**Zone settings** (Cloudflare dashboard, not files):

- [ ] A proxied DNS record for `www`, and one Redirect Rule sending `www` on `http` and `https` to `https://acceptra.ai` in a single hop
- [ ] Always Use HTTPS on; `acceptra.com`, once owned, redirects to `https://acceptra.ai`
- [ ] Email Address Obfuscation **off** (it rewrites every `mailto:` into `/cdn-cgi/l/email-protection` and breaks hydration)
- [ ] Rocket Loader **off**
- [ ] AI Crawl Control: every category allowed, managed robots.txt off, Bot Fight Mode not challenging verified bots
- [ ] Crawler Hints on (IndexNow)

**Verify.** `frontend/scripts/verify-landing.sh <base-url>` runs the launch checks: the prerendered content and head tags, the same page for Googlebot, bingbot, GPTBot, ClaudeBot and PerplexityBot, every asset resolving, the clean URLs and their single-hop redirects, the real 404, the crawl files and the headers. Against `https://acceptra.ai` it also checks the host redirects, and with `PAGES_DEV_URL` set it checks the preview host sends `noindex`. Locally, `npx wrangler pages dev dist-landing` serves the build with Pages' own `_headers`, `_redirects` and 404 handling. What the script cannot check (Search Console, rich-result validators, link-preview renders, Lighthouse, a production waitlist signup reaching D1 and PostHog) is listed in the plan's §12.
