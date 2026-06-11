# Counselle — MVP2 Architecture (the full-stack app)

> The HOW for `PRD-mvp2.md`. This document extends `docs/ARCHITECTURE.md` (referenced throughout as "Part I, §N") and merges into it as Part II when the build starts. Decisions here are backed by ADR drafts 0020–0023 in `plans/mvp2/adr/`.
>
> Status: **specified 2026-06-11, not yet built.** Section numbers §26–35 are pre-assigned for the merge into `docs/ARCHITECTURE.md`.

---

## Contents

26. [MVP2: the shape of the full-stack app](#26-mvp2-the-shape-of-the-full-stack-app)
27. [Protocol extensions: work visibility, resume & cancel](#27-protocol-extensions-work-visibility-resume--cancel)
28. [Identity & auth](#28-identity--auth)
29. [Chat management](#29-chat-management)
30. [Feedback & per-user rate limiting](#30-feedback--per-user-rate-limiting)
31. [The frontend](#31-the-frontend)
32. [MVP2 configuration delta](#32-mvp2-configuration-delta)
33. [MVP2 deployment](#33-mvp2-deployment)
34. [MVP2 testing strategy](#34-mvp2-testing-strategy)
35. [MVP2 risks & open questions](#35-mvp2-risks--open-questions)

---

## 26. MVP2: the shape of the full-stack app

MVP1 was built API-first precisely so this step would be additive (Part I, §23): the optional principal in the request context, the nullable `user_id` on sessions, the additive-within-v1 event protocol, and the client-agnostic API were all reserved seams. MVP2 lands on them. **Nothing in MVP2 touches `domain/`** — the honesty core ships as-is.

```
              ┌──────────────────────────────────┐   ┌──────────────────────┐
   browser    │  Counselle web app  (frontend/)  │   │  marketing landing   │
              │  React SPA — LibreChat-cloned    │   │  page (one static    │
              │  parts + Counselle components    │   │  file, served at /)  │
              └────────────────┬─────────────────┘   └──────────┬───────────┘
                               │  same origin: /v1/* (REST + SSE), cookie auth
              ┌────────────────▼────────────────────────────────▼───────────┐
              │           Counselle service (the SAME FastAPI app)          │
              │  api/    + auth, chat CRUD, feedback, rate limit, SPA serve │
              │  app/    + step/thinking emission, cancel, auto-title       │
              │  domain/   UNCHANGED — the honesty core ships as-is         │
              └────────────────┬─────────────────────────────────────────────┘
                               │  everything below identical to Part I, §2
                  (counselle-db MCP · Tavily · Postgres counselle.* · pipeline DB read-only)
```

**The MVP2 principles (deltas to Part I, §1):**

1. **Still one backend deployable.** No second service, no BFF, no gateway, no Redis, no message bus. Auth is `api/`-layer middleware and routes; chat CRUD is routes over rows that already exist (ADR 0019); rate limiting is middleware. The dependency rule (ADR 0017) absorbs all of it.
2. **Every addition lands on a reserved seam.** Auth fills the optional principal (Part I, §6). Chat history reads rows the checkpointer already writes (Part I, §7). New event types ride the additive-within-v1 rule (Part I, §6). If an MVP2 feature ever requires changing `domain/` or breaking v1 semantics — stop and write the ADR (the Part I, §23 discipline).
3. **The frontend is a pure client.** It speaks only the versioned protocol. The service still doesn't know or care what renders it; the dev harness keeps working unmodified until deleted.
4. **Clone, don't design.** The UI's design system and core chat components are cloned from LibreChat (MIT) — tokens wholesale, components vendored (§31, ADR 0020). We design only what LibreChat doesn't have: the honesty surfaces (timeline, cards, citations, clarify).
5. **Same origin, one container.** The SPA and the landing page are served by the FastAPI service (§33, ADR 0023) — no CORS, trivial cookie auth, one TLS cert, one deploy.

**Retirement:** `harness/` is deleted once `frontend/` reaches feature parity (it was built to die — Part I, §5). Until then it stays as the protocol's second client and a useful regression check that v1 stayed additive.

**Seam reality check (verified against the code, 2026-06-11):** several things this plan needs already exist in MVP1 and must not be re-specified as new work — the SSE `id:` field on every event (`api/sse.py`), `sessions.updated_at` + the per-turn touch (`migrations/0001_sessions.sql`, `app/sessions.py`), the in-process single-flight guard (`api/routes/sessions.py`), the unvalidated-principal seam (`api/context.py`), the `Containerfile` (single-stage today), `.env.example`, and the yoyo migration chain. The genuinely new machinery is: the **turn registry** (§27.3), step/thinking emission (§27.1–27.2), auth, the chat-management routes, and the frontend.

---

## 27. Protocol extensions: work visibility, resume & cancel

(ADR 0022.) All changes are **additive within v1** — `v` stays 1, existing clients (the harness) ignore unknown event types by design (Part I, §6). This section is the single biggest enabler of the PRD's chat experience: today's protocol has no granular work visibility.

### 27.1 New event: `step`

Start/end pair per unit of agent work. The activity timeline renders these directly.

```jsonc
// status: "start"
{ "v": 1, "type": "step", "data": {
    "step_id": "s3",                  // unique within the turn; pairs start/end
    "status": "start",                // start | end | error
    "kind": "web_search",             // db_tool | sql | web_search | edu_search |
                                      // reddit_search | viz | skill | research
    "label": "Searching the web: nyu cs acceptance rate 2026",  // human label, pre-built server-side
    "tier": "official",               // official | community | null — drives the icon/color grammar
    "detail": null
}}

// status: "end" — same step_id, carries the receipts (PRD story 15)
{ "v": 1, "type": "step", "data": {
    "step_id": "s3", "status": "end", "kind": "web_search",
    "label": "Searching the web: nyu cs acceptance rate 2026", "tier": "official",
    "detail": {                       // kind-specific; the expandable receipt
      "query": "nyu cs acceptance rate 2026",
      "domains": ["niche.com", "usnews.com"],
      "result_count": 5,
      "duration_ms": 1840
      // db_tool/sql kinds instead carry: tool, field_keys[], row_count
      // viz kind carries: viz_type, schools[]
    }
}}
```

- **Emission seam (a named build-time gate):** the preferred path is PydanticAI's native streamed-run tool events surfaced through the graph's custom stream — the stack's own seam (Part I, §1 principle 2). **Verify at build time** that the pinned pydantic-ai emits tool-call start/result events from `run_stream_events()`: today `app/agent_node.py` consumes only `PartStart`/`PartDelta`/`AgentRunResult` events, so this is assumed, not proven. **Decided fallback order if it doesn't:** seams we already own — the MCP `process_tool_call` hook (where `annotate_mcp_result` already sits) sees every `counselle-db` call, and the Tavily / `render_viz` / skill tools are our own functions. Either way, **no hand-wrapping of tools** (ADR 0017).
- **The step mapper is a named module, not route code:** a pure function — tool-call info in, `{kind, tier, label}` out — using the label templates. Today the graph→event translation sits inline in the route's stream generator (`api/routes/sessions.py`); MVP2 must not pile step mapping, thinking routing, and templating into that closure. The route generator stays a dumb encode-and-yield loop; the mapper is table-driven-testable with zero mocks (§34).
- **Labels are editorial:** built from templates in a new data asset `config/assets/step_labels.yaml` (per `kind`, with arg interpolation — "Querying the database: {category} fields", "Checking r/{subreddit}"). Changing the product voice never touches code (ADR 0018 bucket 2).
- **Steps persist (PRD stories 15–16, decision 5):** at turn end, the turn's **step record** — steps with their receipts, the thinking lines (§27.2), and the derived one-line receipt — is written into the graph state alongside the messages. No new storage: the checkpointer already holds that state. The transcript read returns it per assistant message (§27.5). Without this, "expandable forever" and the collapsed receipt on old chats would be a lie — the timeline would exist only as ephemeral stream events.
- **Source-control enforcement is visible for free** (PRD story 17): a disabled source's tool isn't mounted (ADR 0013), so its `kind` *cannot* appear in the timeline. No new enforcement needed — the existing mechanism becomes user-visible.
- **`research` kind is reserved, unused in MVP2** — the deep-research follow-up emits its phases through the same event (PRD story 52's "UI room reserved").
- **Receipts never leak secrets:** `detail` carries queries, domains, counts, field keys — never DSNs, raw SQL parameters beyond the statement, or credentials (house rule).

### 27.2 New event: `thinking`

```jsonc
{ "v": 1, "type": "thinking", "data": { "text": "The database covers admissions, but this year's deadline needs the live site." } }
```

Short reasoning summaries interleaved in the timeline (PRD story 14). **Realization (KISS):** MVP1 realized "visible reasoning" as prose narration woven into `delta` (Part I, §6). MVP2 reroutes the model's *interstitial* text — the text PydanticAI emits between tool calls — into `thinking` events; only final-answer text rides `delta`. No second model call, no summarizer. One honesty rule, prompt-enforced and eval-watched: facts and numbers never appear *first* in `thinking` — it narrates intent, not findings. Thinking lines persist in the turn's step record (§27.1), so revisited chats keep them under the expanded receipt. If dogfooding shows interstitial narration is too sparse, the fallback is a cheap-tier summarizer per step (decide then, not now — §35).

### 27.3 The turn registry (one module owns the turn lifecycle)

**The load-bearing structural change in the backend delta.** Today the turn *is* the request-handler coroutine: `api/routes/sessions.py` runs `run_turn()` inside the SSE response generator, and the single-flight guard is a bare `set` on `app.state`. In that shape, a client disconnect (an F5!) cancels the coroutine and **kills the turn** — refresh-proof streams (PRD story 39) are impossible — and cancel/reattach would be different routes with no shared object to act on.

MVP2 introduces **one deep module — the turn registry** (`app/turns.py`) — that owns the whole lifecycle:

- **Turns run as detached asyncio tasks** that outlive any HTTP request. Per session the registry holds: the running task, the **ring buffer** of emitted events (size in Settings), the **single-flight lock**, and the **cancel handle**. A disconnected client costs the turn nothing.
- **Interface (the endpoints become thin callers):** `start(session_id, message, …)`, `attach(session_id, last_event_id) → event iterator`, `cancel(session_id)`, `is_generating(session_id)`.
- `POST .../messages` = start + attach. **New endpoint `GET /v1/sessions/{id}/stream`** = attach from `Last-Event-ID` — replay the buffer tail, then live to `done`. (Every event already carries the SSE `id:` field — implemented in MVP1, `api/sse.py`; the buffer and reattach are the new parts.) No active turn in this process → `204 No Content` → the client falls back to the **transcript read** (§27.5).
- **Single-writer rule** (PRD story 40): a second `POST .../messages` while a turn is active → `409 {error: "stream_active"}` (the existing guard moves into the registry). "Send mid-stream re-asks" is client-orchestrated: cancel → await `done` → send. The sessions list (§29) reads `is_generating` from the registry for the cross-tab indicator.
- **The buffer is best-effort UX; persisted state is the correctness guarantee** — prose in the checkpointer, the step record in the graph state (§27.1). A deploy mid-turn loses the buffer, not the chat. No Redis, no event store.
- **Every piece of single-instance state lives inside this one module** — §33's scale-out story becomes "re-back the turn registry", not a hunt across route handlers. Deletion test: removing the registry would smear task ownership, buffering, locking, and cancellation across four route handlers — it concentrates complexity, so it earns its keep.

### 27.4 Cancel

- **New endpoint: `POST /v1/sessions/{id}/cancel`** — the registry cancels the detached task via asyncio cancellation at the graph boundary. The stream terminates with `done`; partial prose persists (the student keeps what streamed).
- **`done.data.status` gains `cancelled`** — extending the *existing* enum (`complete | awaiting_input` today, `domain/events.py`) rather than introducing a parallel `stop_reason` field. Additive within v1. The composer's send⇄stop swap (PRD story 38) is cancel + this field.

### 27.5 The transcript contract

The transcript read (`GET /v1/sessions/{id}`) today returns user/assistant text pairs reconstructed from graph state. MVP2 extends it — per assistant message — with the persisted **step record** (§27.1): steps with receipts, thinking lines, and the one-line receipt. This is the typed contract the frontend's turn reducer consumes (§31.4); it's what lets old chats render the collapsed receipt by default (PRD decision 5), keeps receipts "expandable forever" (story 16), and gives the resume fallback full fidelity. Turns from before MVP2 simply have no step record — the renderer shows prose only.

### 27.6 New/changed endpoints summary

| Endpoint | Purpose |
|---|---|
| `GET /v1/sessions` | List + title search (owner's sessions) — §29 |
| `PATCH /v1/sessions/{id}` | Rename — §29 |
| `DELETE /v1/sessions/{id}` | Delete chat (+ its checkpoints) — §29 |
| `GET /v1/sessions/{id}/stream` | Reattach to an in-flight turn (Last-Event-ID) — §27.3 |
| `POST /v1/sessions/{id}/cancel` | Stop the active turn — §27.4 |
| `POST /v1/sessions/{id}/messages/{message_id}/feedback` | Thumbs up/down — §30 |
| `POST /v1/auth/*` | fastapi-users routers (register, login, logout, forgot/reset, Google OAuth) — §28 |
| `GET/PATCH/DELETE /v1/me` | Account read/update/delete; `DELETE /v1/me/chats` for delete-all — §28 |
| `GET /v1/config` | Runtime client config: starter chips, greeting, default source-config — §32 |

All existing v1 endpoints keep their exact semantics; `POST /v1/sessions` and `POST .../messages` now require auth and stamp `user_id`.

---

## 28. Identity & auth

(ADR 0021.) The moment ADR 0016's "optional principal" and ADR 0019's "nullable `user_id`" stop being optional and nullable in practice. Scope is exactly the PRD's decision 6: email + password, Google OAuth, password reset — no email-verification ceremony, no 2FA, no profile wizard.

- **Library: `fastapi-users`** (+ `httpx-oauth` for Google). Battle-tested registration/login/logout/forgot-password/reset-password routers, password hashing, and OAuth association — never hand-roll auth (house principle 2). Mounted under `/v1/auth/*`.
- **Token transport: JWT in an httpOnly, `Secure`, `SameSite=Lax` cookie.** The deciding constraint is SSE: `EventSource` cannot set an `Authorization` header, but cookies ride along free on same-origin requests — and the SPA *is* same-origin (§33). One transport for REST and streams, zero token-juggling in the client.
- **CSRF posture:** `SameSite=Lax` + the API is JSON-only (no form-encoded state changes, content-type enforced). That combination is the standard mitigation; no CSRF-token machinery in MVP2. Revisit only if the app is ever embedded cross-origin.
- **Google OAuth:** fastapi-users' OAuth router with `GoogleOAuth2`; accounts link by email (a Google sign-in with an existing email attaches to that user). Signup collects name + email only (PRD story 4).
- **Reset emails:** a thin `adapters/email.py` seam — provider (`smtp | resend | console`) + credentials in Settings; templates are data assets. `console` is the dev default (prints the reset link to logs).
- **Schema delta** (own migration chain, `counselle.*` only — ADR 0019): `counselle.users` (fastapi-users base columns: `id uuid`, `email` unique, `hashed_password` nullable for OAuth-only accounts, `is_active`; plus `name`, `created_at`, `settings jsonb` for theme + default source-config preset) and `counselle.oauth_accounts`. `sessions.user_id` gets its FK and a NOT NULL constraint *for new rows* (enforced in code; old dev rows are deleted, not migrated — they're disposable).
- **The principal:** the auth dependency populates the existing request-context principal (`api/context.py` already parses-but-ignores it — the seam is sitting there) — exactly as Part I, §6 promised, **no route-shape or orchestration changes**.
- **Ownership is one dependency, not per-route code:** a single FastAPI dependency — `owned_session(session_id, principal)` — resolves principal → session row → ownership and raises uniformly; a foreign or unknown session returns **404, not 403** (don't leak existence). Every `/v1/sessions/*` route takes it as a parameter, so the authz rule has one home and one test suite — a route can't half-forget it, and a route-inventory test (§34) catches forgetting it entirely.
- **Data controls (PRD story 49):** `DELETE /v1/me/chats` (all sessions + checkpoints) and `DELETE /v1/me` (account + cascade). Confirm-gated in the client.
- **Settings storage:** the thin MVP2 settings (theme, default source-config preset) live in `users.settings jsonb` — no separate table for three fields (KISS). Name/email/password/Google live on the user row and the fastapi-users flows.

---

## 29. Chat management

(PRD stories 46–48.) Rows already exist (ADR 0019) — this is routes + one background task.

- **No schema delta here:** `counselle.sessions` already has `updated_at` (`migrations/0001_sessions.sql`) and `app/sessions.py` already touches it on every completed turn. Recency grouping (Today / Yesterday / Previous 7 days / older) is computed client-side from it.
- **List + search:** `GET /v1/sessions?q=&cursor=&limit=` — the owner's sessions, `updated_at` desc, cursor-paginated. `q` is a title `ILIKE` match in Postgres — title search is enough (PRD story 46); no search engine, no embedding index.
- **Rename / delete:** `PATCH` with `{title}`; `DELETE` removes the session row and the checkpointer rows for that thread (the LangGraph thread-deletion API; verified at build time).
- **Auto-titles (PRD story 47):** after the first turn's `done`, a fire-and-forget background task sends the first exchange to the cheap-tier model (model knob in Settings; prompt is a data asset) and updates `title`. On any failure the title stays as the default (the question, truncated) — titling never blocks or breaks a turn, never retries.
- **List rows carry `is_generating`** (§27.4) for the sidebar's cross-tab indicator.

---

## 30. Feedback & per-user rate limiting

**Feedback (PRD story 22):** `POST /v1/sessions/{id}/messages/{message_id}/feedback` with `{rating: "up" | "down"}` → upsert into `counselle.feedback` (`id, user_id, session_id, message_id, rating, created_at`) — idempotent per (user, message), re-tapping toggles. Feedback is an engineering instrument: the eval workflow reads this table (an export script in `evals/`, not a pipeline) to source regression questions from real thumbs-downs. Reason chips are MVP3 (PRD).

**Rate limiting (PRD story 50):** MVP2 is the first time strangers can spend the Gemini/Tavily budget.

- **Per-user, in-process sliding-window counters**, keyed by `user_id`, applied to the message-send route only — the only expensive route; reads are not limited.
- Knobs in Settings: `turns_per_hour`, `turns_per_day`. Exceeded → `429` with `Retry-After`; the client shows a plain generic message (the designed limit UX is MVP3, per the PRD gap pass).
- In-memory is *correct* at one instance (§33). The knobs living in Settings is what makes a shared backend (Redis/Postgres) a swap, not a rework — when scale-out happens, not before. ~30 lines of code; no limiter framework needed.
- **Per-user spend visibility for free:** the existing `turn_complete` log line (`api/routes/sessions.py`) already carries session, trace, tokens, duration, and estimated cost — MVP2 adds `user_id` to it. Per-user cost accounting from day one is then log aggregation (Part I, §19's design intent), not new machinery.

---

## 31. The frontend

(ADR 0020.) The PRD's centerpiece. The strategy in one line: **LibreChat is the castle; we build a house from its bricks** — clone the design system and the chat-commodity components exactly, leave their product's parts, and build the Counselle-only components in the same visual language.

### 31.1 The stack (locked by the clone decision)

Cloning LibreChat's components pixel-exactly requires running their rendering stack. Verified against the repo (MIT license; pinned commit recorded at clone time):

| Layer | Choice | Note |
|---|---|---|
| Framework | **React 18 + TypeScript** | Theirs exactly |
| Build | **Vite** | Theirs; dev server proxies `/v1` → the API (§33) |
| Styling | **Tailwind CSS 3.4** + their CSS-variable theme | Copied wholesale (§31.2). **Stay on their major version while cloning** — no v4 migration |
| Primitives | **Radix UI** + **lucide-react** icons | Theirs exactly |
| Server state | **TanStack Query** | Theirs; ours wraps *our* protocol client |
| Client state | **Jotai** | Their newer atoms are already Jotai; **we do not adopt Recoil** (their legacy store) |
| Routing | **react-router** | `/login /signup /reset /  /c/:sessionId` |
| Markdown | **react-markdown + remark-gfm** | Theirs; plus our citation-marker renderer |
| Composer | **react-textarea-autosize** | Theirs |
| Motion | **framer-motion** | Theirs; constrained by the PRD motion rules |
| Virtualization | Their message-list approach | Decide exact lib when cloning that surface (§35) |
| Fonts | **Inter / Roboto Mono** | Theirs exactly |

Deliberately **not** taken from their dependency pile (YAGNI): Recoil, `librechat-data-provider`, i18next, Mermaid/KaTeX/Monaco, file upload/DnD, speech, avatars, Meilisearch-backed search, `SiblingSwitch` (message branching — PRD decision 4 locked it out).

### 31.2 The clone strategy (the lego rule)

1. **Tokens first, wholesale.** Copy `client/tailwind.config.cjs` and `client/src/style.css` (the CSS-variable theme: `--surface-primary`, `--text-primary`, `--border-light`… defined per `:root`/`.dark`) plus the font setup, essentially verbatim. This single step guarantees that *anything* written in their class vocabulary — cloned or new — renders pixel-identically: colors, spacing, radii, both themes. Prune unused CSS later, never before.
2. **Vendor the cloned components.** `frontend/src/vendor/librechat/` holds components copied from their tree — **JSX structure and Tailwind classes preserved exactly**; their Recoil hooks and data-provider calls stripped and replaced with props wired to our state/API. The quarantine makes "this is a clone — don't restyle it" physical, and makes deliberate re-syncs against upstream possible. `UPSTREAM.md` in that directory records the pinned commit; the MIT license notice ships alongside (legal requirement).
   - **Cloned surfaces:** sidebar/nav + conversation list (incl. search, rename, delete, grouping), the composer (`ChatForm`, send/stop buttons, textarea autosize), the message shell + markdown content renderers + hover action row, the settings dialog (Radix tabs — their General/Account/Data structure maps ~1:1 onto our thin settings), the new-chat landing + conversation-starter chips, and the auth pages.
   - Expect each cloned surface to pull 3–10 support files (shared hooks, small ui/ atoms) — the vendor directory absorbs them.
3. **Build the Counselle-native components in their visual language.** These don't exist in LibreChat, so we write them — using *only* the cloned tokens, their Radix primitives, their spacing/radius scale, their motion timings: the **activity timeline** (steps, thinking lines, shimmer, collapse-to-receipt), the **dossier stat block**, the **comparison table**, the **score band**, **citation chips + anchored popovers**, the **sources footer**, the **clarify widget** (chips + freeze-to-record), the **"not in our database" card**, and the designed **"not available"** muted state. This is where the PRD's design laws get implemented (CLS ≈ 0 via pre-sized skeletons, tabular numerals, 68ch measure, no winner-highlighting).
4. **Two new semantic token pairs** extend the cloned CSS-var system: `--official-*` (cool) and `--community-*` (warm) — defined once per theme, used identically by chips, timeline steps, cards, and the sources footer. Per the PRD's visual direction, this axis is the **only** place color carries meaning, and it's the only color addition we make to their system.

### 31.3 Repository layout

```
frontend/
├── package.json / vite.config.ts / tsconfig.json
├── tailwind.config.cjs           # cloned from LibreChat, pinned
├── index.html
└── src/
    ├── styles/                   # style.css (cloned tokens) + counselle.css (official/community tokens)
    ├── vendor/librechat/         # cloned components — quarantined; UPSTREAM.md + MIT notice
    ├── components/               # Counselle-native: timeline/ cards/ citations/ clarify/
    ├── api/                      # THE protocol client: fetch wrapper, SSE parser, event types
    ├── state/                    # jotai atoms: drafts, per-chat source-config, ui bits
    ├── routes/                   # login / signup / reset / app shell / c/:sessionId
    └── hooks/
```

`frontend/` joins the monorepo as a sibling of `harness/` — it's a pure client like everything else (Part I principle 3). House rules apply (files <800 lines, organize by feature).

### 31.4 State & data rules

- **TanStack Query owns server state** (me, sessions list, transcript, runtime config). **Jotai owns the small client state** (composer drafts, per-chat source-config, open popover, theme). **The URL owns which chat** (`/c/:sessionId`). Server state is never duplicated into client stores.
- **`src/api/` is the only module that knows the protocol.** A typed event union mirroring the `domain/` spec types; a fetch-streaming SSE parser (`POST` streams can't use `EventSource`; the same parser serves the reattach `GET`); cookie auth means zero token handling. Two forward-compatibility rules live here and nowhere else: **unknown event type → ignored; unknown render-spec type → markdown fallback** (the degrade rule, PRD story 35).
- **The turn reducer is a named pure module** (`src/api/turn-reducer.ts`): protocol events in → turn view-state out (the append-only block list, the accumulated steps/thinking, skeleton placeholders, the derived receipt) — **no React imports**. Components are dumb draws over its output. Most of §31.5's smoothness laws *are* reducer logic; scattered through components they'd be untestable, and this is exactly where lying-to-a-student rendering bugs would live. It also reduces the persisted step record from the transcript contract (§27.5), so live streams and revisited chats render through one code path. Tested against the backend's exported protocol fixtures (§34).
- **Composer drafts persist to localStorage per session** (PRD story 41); a failed send keeps the text in the composer with inline retry.

### 31.5 The turn pipeline (how the smoothness laws are implemented)

| PRD law / story | Mechanism |
|---|---|
| 0ms echo, question pins to top (11) | Optimistic append in the send mutation; one programmatic scroll; answer fills downward — no bottom-chasing autoscroll |
| Activity <300ms, never silent (12, 36) | `step`/`thinking` events render the live timeline; SSE keepalives bound dead air |
| Streaming prose, no flicker (18) | Append-only markdown **block list** — completed blocks are memoized and never re-render; only the open block re-parses; soft caret at the stream edge |
| Citation chips materialize inline (19) | Marker syntax in `delta` → chip component via the markdown renderer, resolved against the `sources` event |
| Cards inline, CLS ≈ 0 (20, 43) | The announcing `step` triggers a skeleton **sized from the render-spec shape** (type + row/column counts) before data; fill with ~200ms fade; text above never reflows |
| Collapse to receipt (16) | The turn reducer derives the receipt from accumulated `steps[]` at `done`; old chats render it from the persisted step record (§27.5, PRD decision 5) |
| Scroll always wins (37) | User scroll detaches the view; "↓ Latest" pill; completion never yanks the viewport |
| Stop / re-ask (38) | Send⇄stop button on `is_generating`/`done.status`; cancel-then-send orchestration (§27.4) |
| F5-proof (39) | Reattach via `GET .../stream` + Last-Event-ID against the turn registry; 204 → transcript fetch (§27.3, §27.5) |
| Long chats at 60fps (42) | Virtualized message list; lazily mounted cards; per-chat scroll restoration |
| Reduced motion (44) | `prefers-reduced-motion` kills shimmer/transitions globally |

### 31.6 The landing page

One static HTML file (no framework, no build step) served at `/` for logged-out visitors — what Counselle is, one dossier screenshot, a signup CTA (PRD decision 2). Logged-in users are redirected into the app. Copy lives in the file; it's one page, not a CMS.

---

## 32. MVP2 configuration delta

(Extends Part I, §18 — same three buckets, same test.)

**Settings groups added:**

| Group | Knobs |
|---|---|
| Auth | JWT secret + TTL, cookie name/flags, Google client id/secret, reset-token TTL |
| Email | provider (`smtp \| resend \| console`), credentials, from-address |
| Rate limit | `turns_per_hour`, `turns_per_day` |
| Chat | title model (cheap tier), title max length |
| Streaming | resume ring-buffer size, reattach on/off |
| Frontend | static bundle dir, serve on/off (off in dev — Vite proxies `/v1`) |

**Data assets added (`config/assets/`):** `starter_prompts.yaml` (the home-screen chips, one per signature capability), `greeting_templates.yaml` (keyed by `admission_season` phase — the season-aware greeting reuses Part I, §16's machinery), `step_labels.yaml` (§27.1), the title prompt, email templates.

**`GET /v1/config`** serves the client-relevant assets at runtime (starter chips, greeting for today's season, default source-config) — editorial changes ship without a frontend rebuild, and the greeting derives from the same season function the agent uses (one mechanism, never two).

---

## 33. MVP2 deployment

(ADR 0023; extends Part I, §20 — deployability remains a property, not a phase.)

- **Still one container.** The existing single-stage `Containerfile` becomes multi-stage: stage 1 (node) builds the Vite bundle; stage 2 is the existing Python image with the bundle mounted via FastAPI `StaticFiles` and the static landing page at `/`. `/v1/*` is the API; everything else falls through to the SPA (client-side routing).
- **Same origin is the load-bearing choice:** no CORS configuration, cookie auth trivially secure (no third-party-cookie pain), SSE auth just works, one TLS cert, one deploy target (any VPS / Fly / Railway, day one). Splitting the SPA to a CDN later is a config change, not an architecture change.
- **Dev parity:** Vite dev server proxies `/v1` → `localhost:8000`, so the same-origin posture (and cookie behavior) holds in development with HMR.
- **The statelessness clause, amended honestly:** the service remains stateless **except for two named owners of in-process, best-effort state** — the **turn registry** (§27.3: detached tasks, ring buffers, stream locks, cancel handles) and the **rate-limit counters** (§30). Each degrades gracefully on restart (transcript catch-up / lock vanishes with its turn / counters reset). **One instance is the documented MVP2 posture.** Scale-out beyond one instance means re-backing exactly these two — a contained, known job, deliberately not done now.
- **SSE through proxies:** streaming responses set `X-Accel-Buffering: no` and rely on the protocol's keepalives (both already implemented — `api/sse.py`); verify behavior on the chosen host at deploy time.
- **Migrations on deploy get a real mechanism:** the container entrypoint runs `yoyo apply` against `counselle.*` before exec'ing uvicorn. (Today the yoyo chain exists but nothing runs it automatically — boot assumes the schema is current.) New migrations: users, oauth_accounts, feedback.

---

## 34. MVP2 testing strategy

(The Part I, §21 philosophy carries: **test where lying to a student is possible**; behavior, not implementation. The PRD deferred UI-testing scope to this pass — here it is.)

- **The turn registry is the new deep-module test surface** — unit-tested with a fake event source, no HTTP: client disconnect leaves the detached turn running; reattach replays exactly from `Last-Event-ID`; cancel persists partial prose and emits `done.status = cancelled`; double-send → 409; buffer overflow degrades to transcript fallback. The existing parked-interrupt durability regression extends to mid-stream reconnect.
- **The step mapper is table-driven:** tool-call fixture in → `{kind, tier, label}` out, one row per tool — zero mocks, the labels asset exercised directly.
- **Backend delta — routine pytest, no live LLM:** auth flows + the `owned_session` dependency (foreign session → 404; plus a route-inventory test asserting every `/v1/sessions/*` route declares it), rate-limit behavior (429 + Retry-After + window reset), step persistence (the step record survives into the transcript read), **disabled source ⇒ its step kind cannot appear** (story 17's test), feedback idempotency, auto-title failure never blocks a turn.
- **Shared protocol fixtures are the contract test:** the backend's protocol tests export their emitted event payloads (including a full turn with steps, viz, clarify, and the transcript with step records) as JSON fixture files; the frontend's turn-reducer tests consume the same files. Python↔TypeScript drift is caught by a failing fixture, with no contract-test machinery built.
- **Frontend — the honesty surfaces are the test surface** (Vitest + Testing Library; the turn reducer tested headlessly against the shared fixtures, components against fixture render specs): "not available" renders the designed muted state, never an empty cell; tier chips always match envelope tier; the score band **never composes a 1600** and always shows the teaching caption; comparison table never winner-highlights; unknown card type → markdown fallback; the clarify widget freezes to a record after answering; citation popover content matches the envelope.
- **One Playwright smoke** (the only E2E): signup → ask → stream completes with timeline → refresh mid-answer lands on a sane state → transcript intact. Nothing more — no visual-regression infra, no cross-browser matrix in MVP2.
- **The eval set is unchanged** — it tests the agent, which didn't change. Thumbs feedback begins feeding it (§30).

---

## 35. MVP2 risks & open questions

| Risk | Mitigation |
|---|---|
| LibreChat upstream churn / clone drift | Pinned commit in `UPSTREAM.md`; `vendor/` quarantine; re-syncing is a deliberate task, never automatic |
| Version skew (their Tailwind 3.4 vs ecosystem v4) | Stay on their versions while cloning; upgrade only if/when re-syncing with them |
| Cloned components drag hidden coupling (Recoil stores, their contexts) | Strip-and-rewire at vendor time; each surface budgets its support files; the harness proves the protocol needs nothing from their plumbing |
| In-process resume buffer lost on restart/deploy | Transcript catch-up is the correctness guarantee; the buffer is UX sugar (§27.3) |
| pydantic-ai doesn't emit tool-call stream events (the §27.1 gate fails) | Decided fallback already on owned seams: the MCP `process_tool_call` hook + our own Tavily/`render_viz`/skill functions — no tool wrapping either way |
| Step records bloat graph state on long chats | Receipts are bounded (queries/domains/counts/keys, no payloads); checkpoint growth already has the TTL knob (Part I, §7); watch, don't pre-build |
| Cookie auth CSRF | `SameSite=Lax` + JSON-only state changes (§28); revisit if ever embedded cross-origin |
| Single-instance assumptions (the turn registry + rate counters) | Explicitly documented as the MVP2 posture (§33); two named owners, closed list; re-back them when scale demands |
| SSE buffered/broken by proxies | `X-Accel-Buffering: no` + keepalives; verify on the chosen host |
| `step`/`thinking` leak internals or fabricate | Labels templated from assets; receipts limited to queries/domains/counts/field keys; thinking narrates intent, never facts-first (prompt + eval) |
| fastapi-users maintenance risk | Surface used is small (routers + dependency); standard FastAPI underneath; replaceable at the router layer |
| `users.settings jsonb` grows into a junk drawer | It holds exactly theme + source preset in MVP2; anything more triggers a real column/table decision |

**Open questions (resolve at build time):**

- **The §27.1 emission gate:** does the pinned pydantic-ai emit tool-call start/result events from `run_stream_events()`? (Today `app/agent_node.py` consumes only Part events.) Verify first thing; the fallback order is already decided.
- Exact `fastapi-users` / `httpx-oauth` versions and cookie-transport API — pin everything (the Part I posture).
- The LibreChat pin commit — chosen when the clone is cut; recorded in `UPSTREAM.md`.
- `thinking` density — if interstitial narration proves too sparse in dogfooding, add the cheap-model per-step summarizer (decide on evidence, not now).
- Virtualization library — clone theirs vs a lighter modern one; decide when cloning the message list.
- LangGraph thread-deletion API for chat delete — confirm the exact call (contained to the checkpointer adapter).

---

## Merge notes (applied to `docs/ARCHITECTURE.md` at build time)

Small Part I annotations to apply when this document merges in as Part II:

1. Header: two-part framing + MVP2 status line.
2. §2: note the dev harness is superseded by `frontend/` (still a pure client of the same protocol).
3. §5: add `frontend/` to the repo tree; mark `harness/` "retired in MVP2 — deleted at parity".
4. §6: auth posture paragraph → "fulfilled in MVP2 (§28)"; events table → pointer to §27's additive events.
5. §7: `user_id` nullable note → "populated from MVP2 (§28)".
6. §18 / §20: pointers to §32 / §33.
7. §23 (evolution path): mark the accounts/auth, chat history, and real-frontend rows as landed in MVP2.
8. §25: SSE-vs-WebSocket question → resolved (SSE kept; resume via Last-Event-ID, §27.3).
