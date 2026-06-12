# ADR 0023 — One deployable: the SPA served same-origin from the FastAPI service

**Status:** Accepted (2026-06-12; drafted in the MVP2 architecture pass, 2026-06-11)

## Context
MVP2 adds a real frontend (`frontend/`, ADR 0020) and auth (ADR 0021). Where the built SPA is served from determines the CORS surface, the cookie-auth story, the TLS/deploy story, and whether day-one deployability (Part I, §20) survives. MVP1's posture: one container, stateless, state in Postgres.

## Decision
1. **The FastAPI service serves the built SPA, same origin.** Multi-stage `Containerfile`: a node stage builds the Vite bundle; the Python stage mounts it via `StaticFiles`. `/v1/*` is the API; the static marketing landing page is `/` for logged-out visitors; everything else falls through to the SPA for client-side routing. **Still one container + Postgres.**
2. **Dev keeps the same posture:** the Vite dev server proxies `/v1` to `localhost:8000`, so cookies and relative URLs behave identically in dev (with HMR) and prod.
3. **The statelessness clause is amended honestly:** the service stays stateless except **two named owners of best-effort in-process state** — the **turn registry** (ADR 0022: detached turn tasks, ring buffers, stream locks, cancel handles) and the **per-user rate counters**. Each degrades gracefully on restart. **One instance is the documented MVP2 posture**; scale-out means re-backing exactly these two, deliberately not built now.
4. Streaming responses set `X-Accel-Buffering: no` and rely on protocol keepalives so reverse proxies don't buffer SSE (both already implemented in `api/sse.py`; verify on the chosen host).
5. **Migrations run via the container entrypoint:** `yoyo apply` against `counselle.*` executes before uvicorn starts. (The yoyo chain exists today but nothing runs it automatically — this closes that gap.)

## Rationale
- **Same origin deletes whole problem classes:** no CORS configuration, no third-party-cookie pain (httpOnly cookie auth becomes trivially correct — the deciding enabler for ADR 0021), SSE auth just works, one TLS cert, one thing to deploy and monitor. The highest-leverage KISS decision in MVP2.
- One container preserves MVP1's "deployable to any VPS/Fly/Railway on day one" property unchanged.
- Naming the in-process state (instead of pretending statelessness) keeps the scale-out path honest and contained — a closed list, not a surprise.

## Alternatives considered
- **Separate static hosting / CDN for the SPA (Vercel, Netlify, S3+CDN)** — rejected for MVP2: buys CDN latency wins at the cost of CORS config, cross-site cookie policy (`SameSite=None`, third-party-cookie deprecation risk), two deploy targets, and env-specific API URLs. Splitting later is a config change, not an architecture change.
- **A second container (nginx for static + API behind it)** — rejected: an extra moving part to do what `StaticFiles` does fine at this traffic; a real reverse proxy can be added at the host level without touching the app.
- **Server-side rendering (Next.js et al.)** — rejected: a chat app behind a signup wall has no SEO surface; the one page that needs instant paint (the marketing landing) is a static file. SSR would add a Node runtime to a Python service for nothing.

## Consequences
- The `Containerfile` gains a node build stage; image build time grows; runtime image stays Python-only.
- `api/` gains the static-mount + SPA-fallback wiring and the landing-page route (a few lines, Settings-gated so dev can run API-only).
- Horizontal scaling requires the named-state migration first — documented, closed-list, later.
- The CORS settings knob (Part I, §18) becomes effectively unused — kept for the API-as-product future, defaulted empty. *Amended at B0 (2026-06-12): same-origin serving makes `CORS_ORIGINS` default-empty in production; the current `localhost:8000` default dies at B6 (the deploy phase flips it).*
