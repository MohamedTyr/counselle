# Deploying Counselle

> This is the deployment runbook — how Counselle is deployed and the traps to avoid. For the current deployment **status** (whether a given environment is live), see `CLAUDE.md`.

Decision context: ADR 0023 (SPA same-origin, one deployable). The execution narrative lives in [`../specs/mvp2/plan/ship-plan.md`](../specs/mvp2/plan/ship-plan.md).

## What the deploy image must include

The deploy image is a single same-origin container (API + built SPA). It must provide:

- **A multi-stage container**: a Node stage (`npm ci`, `npm run build`, `VITE_TRANSPORT=http`) producing `frontend/dist`, copied into the Python stage.
- **SPA same-origin serving** in `api/main.py`: Settings-gated static serving — landing at `/`, SPA fallback, `/v1` passthrough (the API surface).
- **Runtime hygiene**: `uv sync --frozen --no-dev` at build; `exec` the venv binaries directly (no `uv run` at runtime); **keep `psycopg2-binary` in main deps** (yoyo's driver — if it sits in the dev group, `--no-dev` bricks the migration step); a tightened `.dockerignore` (`frontend/node_modules`, `tests/`, `docs/`, `plans/`, `specs/`, `evals/report-*`).
- **No catalog warm-up:** domains and definitions come from the current immutable
  manifest view. There is no field index, embedding job, or startup reconciler.

## Database first (everything depends on a reachable DSN)

1. Provision Postgres 16 (managed or VPS), **co-located with the app**.
2. Deploy the CDS Library independently, including current manifest `5.0.2`, its
   extraction-contract-8 packets, the five reader views, and pipeline-managed
   `cds_library_reader` grants. Do not import pipeline code into this image.
3. Provision a LOGIN role that is a member only of `cds_library_reader`; verify it can
   select all five views and cannot select base tables.
4. Run `scripts/setup_db.sql` for Counselle's separate `counselle_app` role/schema and
   apply the Counselle migration chain.
5. Set both DSNs (`COUNSELLE_DB_RO_DSN` for the reader login,
   `COUNSELLE_DB_APP_DSN` for `counselle.*`); use `pool_min ≥ 2` remotely. For a
   side-by-side local cutover, bind the database to loopback only.

## The environment matrix

A first deploy easily forgets the agent-core half. The complete set:

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
- `COUNSELLE_OAUTH_STATE_SECRET` (DS-09) — **required and DISTINCT in prod** (do not reuse the JWT secret). The dev fallback to `COUNSELLE_JWT_SECRET` is **dev-only**: reusing one secret for two crypto purposes (session JWTs + OAuth CSRF state) couples their blast radius. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `COUNSELLE_COOKIE_SECURE=true` (HTTPS only in prod)
- `COUNSELLE_GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, with the **production** redirect URI registered: `https://<domain>/v1/auth/google/callback`

**API**
- `COUNSELLE_CORS_ORIGINS` — the default is now **empty** (06-L1; the fail-safe under same-origin serving, ADR 0023). Leave it empty in prod; the split-origin **dev** setup sets `["http://localhost:5173"]`.
- `COUNSELLE_API_HOST=0.0.0.0`, `COUNSELLE_API_PORT=8000`

> **`$PORT`-injecting hosts (CFG-11):** the `Containerfile` CMD binds a fixed `--port 8000`. If a deploy target injects `$PORT` (e.g. Cloud Run), change the CMD to `--port ${PORT:-8000}` at the deploy phase (B6). No `Containerfile` change is made now (deploy is deferred).

## Open security items (must close before public traffic)

- **DS-04 — OAuth `associate_by_email=True` + no email verification.** Email-based account linking without proof of email ownership is an account-takeover surface (a password account on an email links with a later Google sign-in for that email, and vice-versa). A documented MVP tradeoff (ADR 0021, PRD decision 6), **NOT shipped fixed in the hardening pass**. Before any non-trivial user base, do one of: (1) require email verification before login, (2) only associate-by-email when the existing account is verified, or (3) gate `current_active_user` on `is_verified` for password accounts. See `plans/audit/phase-6-configurability.md` DS-04 and `TODOS.md`. **Blocks B6.**
- **DS-09 — distinct `COUNSELLE_OAUTH_STATE_SECRET`** in prod (see the env matrix above).

## Entrypoint & the one flag that breaks first

The entrypoint runs `yoyo apply --batch` (app DSN — migrations stay additive, so a failure crash-loops back to the previous image) then:

```bash
exec uvicorn api.main:create_app --factory --host 0.0.0.0 --port 8000 --forwarded-allow-ips='*'
```

**`--forwarded-allow-ips='*'` is the flag the first OAuth attempt dies without.** Behind the host's TLS terminator, an untrusted `X-Forwarded-Proto` makes the app think it's on `http`, so the Google `redirect_uri` generates as `http://` → `redirect_uri_mismatch`.

## Deploy checklist

- [ ] CDS Library current pointer is `5.0.2`; all five views readable and base tables denied through the reader-login DSN
- [ ] Counselle application schema provisioned through its separate app DSN
- [ ] Full env matrix set; `CORS_ORIGINS` emptied; `COOKIE_SECURE=true`
- [ ] Migrations ran on boot; `/v1/health` green
- [ ] SSE un-buffered end-to-end (the TLS terminator must not buffer the stream)
- [ ] Cookies set under TLS; **Google OAuth works on the prod domain** (the forwarded-proto proof)
- [ ] One cold-boot run measured (MCP child spawn + first-turn latency)
- [ ] Playwright smoke passes against production: signup → ask a known school question → stream with timeline → reload mid-stream → full-fidelity transcript
- [ ] Security pass: response headers, cookie flags, no secrets baked into the image, admin routes gated
