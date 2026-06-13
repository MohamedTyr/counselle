# Deploying Counselle

> **Status: not yet deployed.** The deploy + hardening phases (B6–B7 of the MVP2 ship-plan) were deliberately deferred. Counselle runs locally today (see the README). This guide is the **plan and the known traps** for the first real deployment — the steps below have **not** been executed or verified in production yet. Treat it as the map, not a tested runbook.

Decision context: ADR 0023 (SPA same-origin, one deployable). The full plan narrative lives in [`../specs/mvp2/plan/ship-plan.md`](../specs/mvp2/plan/ship-plan.md) §B6.

## What still needs building before a deploy works

The current `Containerfile` builds the **backend only** and runs `uv run` at runtime. Before a first deploy these are still TODO (all named in ship-plan §B6):

- **Multi-stage container**: a Node stage (`npm ci`, `npm run build`, `VITE_TRANSPORT=http`) producing `frontend/dist`, copied into the Python stage.
- **SPA same-origin serving** in `api/main.py`: Settings-gated static serving — landing at `/`, SPA fallback, `/v1` passthrough. (Today the backend serves `/v1` only; the frontend is a separate Vite dev server.)
- **Runtime hygiene**: `uv sync --frozen --no-dev` at build; `exec` the venv binaries directly (no `uv run` at runtime); **promote `psycopg2-binary` to main deps** (yoyo's driver currently sits in the dev group, so `--no-dev` would brick the migration step); a tightened `.dockerignore` (`frontend/node_modules`, `tests/`, `docs/`, `plans/`, `specs/`, `evals/report-*`).
- **First-boot reconcile → background task**: today the lifespan awaits a full 1,093-field embed before serving (30–90s) — a cold-start vs health-check-grace kill loop. Move it to a background task and pre-warm.

## Database first (everything depends on a reachable DSN)

1. Provision Postgres 16 (managed or VPS), **co-located with the app**.
2. **Pre-create the `vector` extension as admin** — migration 0003 runs `CREATE EXTENSION` as the app role, which fails on managed Postgres. Without the pre-create, first boot crash-loops.
3. `pg_dump` / `pg_restore` the pipeline DB into it.
4. Run `scripts/setup_db.sql` as admin (roles + grants).
5. **Verify grants as `counselle_ro`** — the `ALTER DEFAULT PRIVILEGES` trap: objects created by a different admin role are invisible to the agent, a silent honesty bug. Run the grant-verification query after every restore/refresh.
6. Set both DSNs (`COUNSELLE_DB_RO_DSN`, `COUNSELLE_DB_APP_DSN`); use `pool_min ≥ 2` against a remote DB.

## The environment matrix

A first deploy forgets the MVP1 half. The complete set:

**Database & sessions**
- `COUNSELLE_DB_RO_DSN`, `COUNSELLE_DB_APP_DSN` (required)
- `COUNSELLE_CHECKPOINTER=postgres`
- `COUNSELLE_SESSION_TTL_DAYS` (optional; unset = keep everything)

**Models / GCP**
- `COUNSELLE_VERTEX_API_KEY` (preferred) **or** `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON) — use the API key, not an ADC file, where possible
- `COUNSELLE_GOOGLE_CLOUD_PROJECT`, `COUNSELLE_GOOGLE_CLOUD_LOCATION`
- `COUNSELLE_MODEL_COUNSELOR`, `_CHEAP`, `_CLARIFIER`, `_TITLE`, and `COUNSELLE_MODEL_PRICES`

**Sources**
- `COUNSELLE_TAVILY_API_KEY` (required when any external source is enabled)

**Auth (ADR 0021)**
- `COUNSELLE_JWT_SECRET` — a **stable** ≥32-byte secret (rotating it logs everyone out)
- `COUNSELLE_COOKIE_SECURE=true` (HTTPS only in prod)
- `COUNSELLE_GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, with the **production** redirect URI registered: `https://<domain>/v1/auth/google/callback`

**API**
- `COUNSELLE_CORS_ORIGINS` — **flip to empty** in prod (ADR 0023's consequence; the dev default is `["http://localhost:8000"]`)
- `COUNSELLE_API_HOST=0.0.0.0`, `COUNSELLE_API_PORT=8000`

## Entrypoint & the one flag that breaks first

The entrypoint runs `yoyo apply --batch` (app DSN — migrations stay additive, so a failure crash-loops back to the previous image) then:

```bash
exec uvicorn api.main:create_app --factory --host 0.0.0.0 --port 8000 --forwarded-allow-ips='*'
```

**`--forwarded-allow-ips='*'` is the flag the first OAuth attempt dies without.** Behind the host's TLS terminator, an untrusted `X-Forwarded-Proto` makes the app think it's on `http`, so the Google `redirect_uri` generates as `http://` → `redirect_uri_mismatch`.

## Deploy checklist

- [ ] DB provisioned, `vector` pre-created, restored, grants verified as `counselle_ro`
- [ ] Full env matrix set; `CORS_ORIGINS` emptied; `COOKIE_SECURE=true`
- [ ] Migrations ran on boot; `/v1/health` green
- [ ] SSE un-buffered end-to-end (the TLS terminator must not buffer the stream)
- [ ] Cookies set under TLS; **Google OAuth works on the prod domain** (the forwarded-proto proof)
- [ ] One cold-boot run measured (MCP child spawn + first-turn latency)
- [ ] Playwright smoke passes against production: signup → ask a known dossier question → stream with timeline → reload mid-stream → full-fidelity transcript
- [ ] Security pass: response headers, cookie flags, no secrets baked into the image, admin routes gated
