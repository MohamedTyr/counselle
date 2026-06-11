# MVP2 Planning — Overview

> Everything for the MVP2 architecture pass lives in this folder until the build starts. Nothing in `docs/` is touched yet — at build time the contents here merge outward (see "What merges where" below).
>
> Status: **architecture pass done (2026-06-11)**. The implementation plan (phases) is the next step and will be added to this folder.

## What MVP2 is

`PRD-mvp2.md` defines the WHAT: a ChatGPT-grade full-stack app over the MVP1 agent — auth, a persistent chat workspace, the activity-timeline chat experience, chat management, thin settings, one landing page. This folder is the HOW: the decisions the PRD explicitly deferred to the architecture pass (frontend stack, auth implementation, protocol schema details, rate-limiting mechanism, UI testing scope).

## Files in this folder

| File | What it holds |
|---|---|
| `00-overview.md` | This file |
| `architecture.md` | The full MVP2 architecture spec — the extension of `docs/ARCHITECTURE.md` (Part II): system shape, protocol extensions, auth, chat management, the frontend, config, deployment, testing, risks |
| `frontend-plan.md` | The frontend execution plan (built first, backend-free): the LibreChat vendoring scheme (aliases, substrate, strip lists from the 4-agent source recon), the mock-transport architecture, phases FE‑0…FE‑6 with gates, and the pixel-fidelity audit. Backend hookup is FE‑7, planned later |
| `adr/0020-frontend-librechat-clone.md` | ADR draft: frontend stack + the LibreChat clone strategy |
| `adr/0021-auth-fastapi-users-cookie-jwt.md` | ADR draft: auth — fastapi-users, cookie JWT, Google OAuth |
| `adr/0022-protocol-work-visibility-resume-cancel.md` | ADR draft: `step`/`thinking` events, Last-Event-ID resume, cancel — additive within protocol v1 |
| `adr/0023-spa-same-origin-one-deployable.md` | ADR draft: the SPA is served same-origin from the FastAPI service; still one container |

## What merges where at build time

When the MVP2 build branch starts (Pre-Phase 0 of the workflow):

1. **`architecture.md` → `docs/ARCHITECTURE.md`** — appended as "Part II — MVP2: the full-stack app" (§26–35), with the small Part I annotations listed in its final section applied.
2. **`adr/0020`–`0023` → `docs/adr/`** — moved as-is, status flipped from Draft to Accepted; `docs/adr/README.md` index gains four rows.
3. **`CLAUDE.md`** — status + documentation-map updates.
4. **This folder → the implementation plan** — phase files get written here (same protocol as `plans/archive/mvp1/`), and the folder archives to `plans/archive/mvp2/` when MVP2 ships.

## The one-paragraph architecture summary

Still **one backend deployable**: the same FastAPI service, extended at the `api/` layer with auth (fastapi-users, JWT in an httpOnly cookie), chat CRUD, feedback, and per-user rate limiting, and at the `app/` layer with the **turn registry** (turns as detached tasks that survive disconnects — the module that owns resume, cancel, and the single-writer rule), step/thinking emission with persisted step records, and auto-titling — every addition lands on a seam MVP1 explicitly reserved (the optional principal, the nullable `user_id`, the additive event protocol). Plus **one new frontend**: a React SPA in `frontend/` whose design system and core components are **cloned from LibreChat** (MIT) — tokens copied wholesale, components vendored and rewired — with the Counselle-native components (activity timeline, cards, citations, clarify widget) built in the same visual language. The SPA is served same-origin by the FastAPI service from a single container, which kills CORS, makes cookie auth trivial, and keeps day-one deployability intact. The agent and its honesty machinery ship unchanged.
