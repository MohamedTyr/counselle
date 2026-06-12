# MVP2 Ship Plan — backend delta, FE‑7 hookup, deploy

> The execution plan for **the rest of the app**: everything between "the frontend demos on fixtures" (frontend-plan FE‑0…FE‑6, done, merged 2026‑06‑12) and "a student signs up and uses Counselle on a real URL." Covers the full backend delta (`architecture.md` §27–30, §32–33), the agent-code changes (step/thinking emission), real auth, the FE‑7 hookup, deployment, and the docs/evals close-out.
>
> Specs this plan executes, by reference: `PRD-mvp2.md` (the WHAT), `plans/mvp2/architecture.md` §26–35 (the HOW), ADR drafts 0020–0023. Where the spec named a build-time gate, the gate is a task here. **Where the spec had a hole, §0.1 names the resolution explicitly** — five spec gaps surfaced in plan review are resolved here and recorded into the architecture docs at B0; everything else adds no decisions, only sequencing + build detail.
>
> Status: **plan drafted 2026‑06‑12, revised same day after a three-lens review pass** (spec coverage, codebase reality, engineering rigor). Phases B0–B7.

---

## 0. Definition of done

MVP2 ships when all of these are true:

1. **PRD Backend Delta 1–7 implemented**: `step` events, `thinking` events, resume + cancel, auth + users, chat CRUD + auto-titling, feedback endpoint, per-user rate limiting.
2. **The frontend runs against the real service** — `HttpTransport` over `/v1`, cookie auth, reattach, cancel, edit/regenerate — with every FE‑6 smoothness law (including the mobile sweep, PRD story 45) re-verified against real latency, and the shared protocol fixtures reconciled (the contract test).
3. **One container deploys to a real host**: SPA + landing served same-origin, migrations run on boot, SSE survives the host's proxy, Google OAuth works on the prod domain.
4. **The Playwright smoke passes against the deployed stack**: signup → ask → stream with timeline → refresh mid-answer → sane state → transcript intact — *transcript intact* meaning full fidelity: prose, cards, citations, step receipts, clarify records (§0.1‑G2).
5. **The eval set passes at MVP1 levels** with the new `thinking` facts-first watch in place; routine pytest, ruff, mypy, tsc, vitest, and the frontend build are all green.
6. **`harness/` is deleted**; docs (ARCHITECTURE Part II + the §0.1 addenda, ADRs 0020–0023 Accepted, CLAUDE.md, README) are current; `plans/mvp2/` archives.

**Non-goals (locked by the PRD — do not let scope creep in):** deep research (stub seam stays), guest mode, memory/personalization, email verification, 2FA, reason-chip feedback, designed rate-limit UX, follow-up chips, autocomplete, chat sharing, billing, admin, branching.

### 0.1 Spec gaps resolved by this plan

The review pass found five places where `PRD-mvp2.md` requires behavior that `architecture.md` never mechanized. The resolutions below are part of this plan's scope and get written into `docs/ARCHITECTURE.md` Part II (and ADR 0022 where noted) during B0's docs merge — they are decisions, recorded as such, not silent improvisation.

- **G1 — Message identity.** PRD story 22 (feedback per message), §27.5 (step records per message), and edit/regenerate addressing all need stable message ids; the spec never mints them. **Resolution:** every turn mints two UUIDs at start — `user_message_id` and `message_id` (the assistant message) — emitted in `meta.data` (additive within v1; the live stream can address the in-flight message for feedback) and persisted in the turn record (G2). Feedback keys on the globally-unique assistant `message_id`.
- **G2 — Full transcript fidelity.** The PRD ("refreshing never breaks the chat", story 39; the receipt "expandable forever", story 16; the frozen clarify record, story 25) and the already-built frontend contract (`frontend/src/api/protocol.ts::TranscriptAssistantEntry`: `parts[]` with viz at in-stream position, `sources`, `clarify`, `usage`, `status`, `message_id`) require far more than §27.5's "step record". MVP1's transcript is prose-only (`{role, text, ts}` from `_extract_transcript`), and `viz_emitted` is overwritten per turn — **today, a reloaded chat loses its cards entirely.** **Resolution:** §27.5's step record grows into the **turn record** (B1b): per assistant turn — `message_id`s (G1), ordered `parts[]` (text blocks + viz specs at the text offset where each was emitted), steps + receipts, thinking lines, the derived one-line receipt, the sources payload as emitted at that turn's end, usage, terminal status, and `messages_offset` (the graph-state message-list index before the turn — what makes G3's truncation a slice). Persisted in graph state per turn (append-only list), returned by the transcript read.
- **G3 — Edit & regenerate need a history-rewrite mechanism.** PRD decision 4 ("editing an old message truncates the chat after it and re-asks") and story 21 (regenerate) were built in the frontend against mocks, but no spec gives the backend a way to truncate the durable thread — a client-side truncate would resurrect "deleted" exchanges on F5 (an honesty violation). **Resolution:** `POST /v1/sessions/{id}/messages` gains optional `replace_message_id` (a prior `user_message_id`): the service — single-flight lock held, no active turn — rewrites graph state via `aupdate_state` (messages sliced at that turn's `messages_offset`, turn records truncated, source registry rebuilt from the surviving turns' records), then runs the new text as a normal turn. **Regenerate = edit of the last user message with the same text** — one mechanism, no second endpoint. Truncating a clarify-parked thread also clears the park (G4). Pre-MVP2 turns have no `user_message_id` and therefore **cannot be edit targets** — the rewrite never slices into record-less history, so the registry rebuild always has a surviving snapshot (or the slice is rejected with a 422).
- **G4 — Clarify-park lifecycle vs cancel/edit.** Invariant (verified against `app/run_turn.py`): `interrupt()` ends the turn — `run_turn` yields `done(awaiting_input)` and returns, the task completes, the lock releases; **there is no parked task**, so the answering `POST .../messages` is never 409'd, and `cancel` on a parked session is a no-op. The hole: a parked thread treats *any* next message as the clarify answer (`Command(resume=text)`), so an edit/new-question while parked would be swallowed as the answer. **Resolution:** the **unpark rule** — a `POST .../messages` carrying `replace_message_id` (G3), and a `POST .../cancel` on a parked session, both clear the pending interrupt and freeze the clarify into the turn record as *unanswered*; a plain next message remains the answer (PRD story 24's "typing is answering"). **The answered case persists too** (PRD story 25 — "what was asked *and chosen*"): the clarify answer rides `Command(resume=text)` and never enters `messages`, so the resumed turn's record stores the answer text alongside the frozen spec, and the transcript read synthesizes the student's answer bubble from it — F5 after answering a clarify loses nothing. The FE `ClarifySpec` contract gains the answer field (B0 spike 4). Tested as named invariants.
- **G5 — Cancel endpoint semantics.** Locked: cancel with an active turn → `202` + the stream terminates with `done(cancelled)`; cancel on an idle session → `204` no-op; cancel on a parked session → `204` + unpark (G4). Cancel racing natural completion: terminal-event emission is single-shot in the registry — cancel-after-done is the idle no-op.

**Verified facts the plan builds on (checked in-source 2026‑06‑12, recorded here so B0 doesn't re-litigate):** `FunctionToolCallEvent`/`FunctionToolResultEvent` exist in the pinned pydantic-ai and flow through `run_stream_events()` (unconsumed by `app/agent_node.py` today). **`FinalResultEvent` is NOT a usable thinking/delta splitter** — `_get_final_result_event` (pydantic_ai/models/__init__.py) fires it on the *first TextPart of any response* when text output is allowed, including interstitial text before a tool call. `AsyncPostgresSaver.adelete_thread` exists (langgraph checkpoint/postgres/aio.py:340); `Pregel.aupdate_state` exists (pregel/main.py:2499).

---

## 1. Execution protocol (applies to every phase)

### Git

- **Branch:** `feat/mvp2-app`, cut from `main` at B0. One branch for the whole plan.
- **Conventional commits per phase milestone** (B1 and B5 have named sub-milestones — one commit each), only after the milestone's gate + review loop pass. Stage file-by-file; never `git add -A`.
- New migrations ship with `.rollback.sql` files (the 0001–0003 convention).
- **Merge:** a single `--no-ff` milestone merge to `main` when B7's gate passes. No pushes/PRs unless asked.

### Subagents & model routing

- **Implementation:** main loop + scoped **Fable subagents** with tight briefs for parallelizable mechanical work (the FE‑4C/FE‑5/FE‑6 pattern: small, parallel, scoped — never one giant background brief). Sonnet only for fully prescriptive sweeps.
- **Verification is never delegated on trust:** every user-facing gate is verified personally in the browser; every backend gate by running the tests/server personally.

### The review loop (after each phase, before its commit)

1. Run the phase's mechanical gates first (pytest routine markers, `ruff check . && uv run mypy .`; for phases touching `frontend/` — **including B2's fixture spec** — also `tsc`, vitest, `vite build`).
2. Launch reviewers **in parallel**, scoped to the phase's diff:
   - `python-reviewer` (backend) / `typescript-reviewer` (frontend) — always.
   - `code-reviewer` — always (ADR 0017 layering, file/function size, the named-module rules, **scope creep beyond the spec**).
   - `security-reviewer` — **mandatory for B3 (auth — the asyncpg user-DB adapter is auth-critical code), B4 (rate limit/feedback input), B5 (client auth), B6 (deploy/headers)**; receipts-never-leak-secrets in B1/B2.
   - `database-reviewer` — migration phases (B3, B4): cascades, rollback files, backward compatibility.
   - `silent-failure-hunter` — phases adding error paths (B2 lifecycle, B4 auto-title, B5 transport).
3. Fix every CRITICAL and HIGH. Re-review changed files. Loop until clean (zero CRITICAL/HIGH; MEDIUMs fixed or deferred to TODOS.md with reason).
4. Re-run the mechanical gates. Then commit.

### House invariants (checked in every review)

Layering inward-only (`domain/` → `app/` → `adapters/` → `api/`; the only `domain/` delta is the additive event types — the sanctioned §26 carve-out, noted in the B0 merge annotations); parameterized SQL only; no secrets in logs/receipts; files <800 lines, functions <50 (vendored frontend exempt); the honesty carve-out — never lie to a student — outranks KISS everywhere it applies.

---

## 2. Prerequisites (user-provided — needed before the marked phase)

| Item | Needed by | Notes |
|---|---|---|
| **Google OAuth client ID + secret** | B3 | GCP console → OAuth consent screen + Web client; redirect URIs for `http://localhost:8000` (dev) now, prod domain added in B6. Goes in `.env`, never in code. |
| **Deploy target choice** | B6 | Default recommendation: **Fly.io** (containers + TLS, SSE-friendly); Railway or any VPS equally fine per ADR 0023. Needs a domain (or the host's subdomain) for `Secure` cookies + the OAuth redirect. |
| **Email provider (prod only)** | B6 | `console` provider covers all of dev (prints reset links to logs) **and is the only provider arm built** (B3); a Resend/SMTP arm is added in B6 only if prod wants real reset emails at launch. |

---

## 3. Phases

Sequence: B0 → B1 → B2 → B3 → B4 → B5 → B6 → B7. (True dependency DAG: B1→B2 and *most of* B3 are independent — B3's auth/users/ownership core can pull forward in parallel if B1 runs long, but its registry-touching bits — `DELETE /v1/me` cancelling active turns, the logout-vs-turn semantics — land only after B2; B4 needs both.) File paths and function names verified against the code 2026‑06‑12.

---

### B0 — Branch, docs merge, build-time gates (no production code)

**Branch:** cut `feat/mvp2-app` from `main`.

**Docs merge (per `00-overview.md`):**
- `plans/mvp2/architecture.md` → appended to `docs/ARCHITECTURE.md` as Part II (§26–35), applying its eight Part I merge-note annotations, **plus the §0.1 addenda** (G1–G5 written into §27 where each belongs; the §26 "nothing touches domain/" sentence gains the additive-event-types carve-out; the §34 "eval set unchanged" sentence gains the ADR 0022-sanctioned thinking-watch exception; the ADR 0023 CORS-knob consequence noted in §18's annotation).
- `plans/mvp2/adr/0020–0023` → `docs/adr/`, Draft → **Accepted** (ADR 0022 amended first with G1–G5); `docs/adr/README.md` gains four rows.
- `CLAUDE.md`: status + documentation map (architecture now two parts; this plan listed).
- Order inside the commit: spikes run **before** the status flip to Accepted.

**Gate spikes (throwaway scripts, deleted before commit; outcomes appended to this file as a "B0 decisions" note):**

1. **Emission + clarify-replay observation** (live Gemini, one tool-using question + one clarify round, consuming `run_stream_events()`): confirm tool event ordering and receipt material (note: `FunctionToolResultEvent` carries no duration — we time call→result ourselves); **observe what a clarify resume replays** — the resumed node re-executes the whole PydanticAI run (per `app/agent_node.py`'s own replay docs), so steps are *regenerated*, not merged — confirm, and shape B1's parked-clarify test to the observed model (the turn record for a clarify turn is whatever the *resumed* run produces, plus the frozen clarify + its answer; no cross-task merge machinery). **Two LangGraph mechanics to prove here, not discover in B2:** (a) writing the parked turn's record requires `aupdate_state` *while an interrupt is pending* (the node never returned) — confirm the write sticks and doesn't disturb the later `Command(resume)`; (b) G4's unpark — LangGraph has no clear-interrupt API; confirm the `aupdate_state(..., as_node=...)` pattern actually empties `snapshot.tasks[*].interrupts` (what `run_turn`'s parked detection reads). If either fails, the fallback designs (record written at resume time; unpark via a no-op resume that the graph discards) get decided here.
2. **Thinking routing is decided** (the FinalResultEvent path is dead — §0.1 verified facts): **threshold-buffered routing.** Buffer text deltas per model response; a tool-call part starting in the same response flushes the buffer as `thinking` lines; the buffer exceeding a threshold (~240 chars, a named constant) flushes as `delta` and streams live thereafter (a long text is the final answer; interstitial narration is short). Misclassification degrades honestly: long narration rides `delta` (= MVP1 behavior); a sub-threshold final answer arrives as one small burst at response end. The spike validates the threshold against real Gemini narration lengths. ADR 0022's outer fallback (MCP hook + own tools) still covers `step` if streamed tool events misbehave.
3. **fastapi-users adapter decision:** default — a thin custom asyncpg implementation of `BaseUserDatabase` (~80 lines of parameterized CRUD; all crypto/flows stay in the library); fallback — `fastapi-users-db-sqlalchemy` if the protocol surface proves larger. Spike checklist: pin `fastapi-users` + `httpx-oauth` versions; verify the cookie-JWT transport API; **the OAuth callback → set-cookie → 302-to-SPA shape** (the stock callback returns a login response — a custom callback wrapper is expected); **the null-`hashed_password` path** (upstream assumes non-null; OAuth-only accounts must get a clean 400 on password login, with a dummy-hash verify to avoid a timing oracle).
4. **Transcript-contract diff:** field-by-field diff of `frontend/src/api/protocol.ts` (`TranscriptEntry`/`TranscriptAssistantEntry`/`StepData`/the event union) against §27 + the G1/G2 shapes — the output is **B1b's build checklist** (the FE types are the consumer contract; spec wins where they diverge, FE adjusts in B5).
5. **Confirmations (already verified in-source, re-run as one-liners):** `adelete_thread`, `aupdate_state` signatures against the pinned versions.

**Gate:** docs merged with addenda; all decisions recorded; spikes removed. **Commit.**

---

### B1 — Work visibility & the turn record (the agent-code phase)

Two committed sub-milestones. No HTTP changes beyond the transcript read.

#### B1a — `step` + `thinking` events, the step mapper, emission

- **Domain (additive):** `domain/events.py` — `StepData` (`step_id`, `status: start|end|error`, `kind: db_tool|sql|web_search|edu_search|reddit_search|viz|skill|research`, `label`, `tier: official|community|None`, `detail: dict|None`) + `ev_step()`; `ThinkingData` (`text`) + `ev_thinking()`; `done.data.status` gains `cancelled` (used from B2). `meta.data` gains `message_id` + `user_message_id` (G1). `v` stays 1.
- **The step mapper:** `config/assets/step_labels.yaml` (per-kind templates with arg interpolation — "Querying the database: {category} fields", "Searching the web: {query}", "Reading {domain}", "Checking r/{subreddit}", "Building a {viz_type} view", "Using the {skill} skill") + `app/steps.py` — pure: `map_tool_call(tool_name, args) -> (kind, tier, label)`; `map_tool_result(tool_name, args, result, duration_ms) -> detail` (db tools → `tool, field_keys[], row_count`; SQL → statement, row_count; searches → `query, domains[], result_count, duration_ms`; viz → `viz_type, schools[]`; skill → name). **Receipts carry queries/domains/counts/field keys — never DSNs, credentials, or result payloads** (tested).
- **Emission (`app/agent_node.py`):** consume `FunctionToolCallEvent`/`FunctionToolResultEvent` in the existing `run_stream_events()` loop → `writer()` custom step chunks via the mapper (durations timed call→result locally); tool exception → `status: "error"`. `step_id` = per-turn counter. **Thinking routing per the B0 threshold-buffer decision**; interstitial text stops riding `delta`. Prompt delta (`config/assets/prompts/counselor.md`): interstitial narration narrates *intent*, never facts/numbers first (§27.2; the eval watch lands in B7).
- **`app/run_turn.py`:** the `mode == "custom"` switch grows `step`/`thinking` arms; the route generator stays encode-and-yield.

#### B1b — The turn record + the full-fidelity transcript (G1 + G2)

- **`app/state.py`:** `TurnState` gains `turn_records: list[dict]` (append-only across turns — *not* the per-turn-overwritten `viz_emitted` pattern). Each record, per G2: `message_id`, `user_message_id`, `parts[]`, `steps[]` (with receipts), `thinking[]`, `receipt` (`sources_line`, `step_count`, `duration_ms`), `sources` (the turn-end payload — cumulative, so G3's rebuild adopts the last surviving record's snapshot), `usage`, `status`, `clarify` (frozen spec + answer/unanswered, when the turn clarified), `messages_offset` (pre-turn message-list length — G3's slice point). **The `parts[]` shape is offsets, not duplicated prose:** boundaries into the turn's message text + viz specs at those offsets; the transcript read materializes text blocks by slicing. That shape requires an invariant: **every terminal path — complete, cancelled, error, tool-budget — leaves `messages` carrying exactly the prose that streamed.** Cancel gets this in B2; the `UsageLimitExceeded` path (`agent_node.py` — today `result` stays `None` and the streamed prose never enters `messages`) and the node-error path get the same partial-`ModelResponse` + record treatment here (status `complete`-with-budget-note / `error` respectively) — otherwise a reload loses prose the student saw, the exact bug class G2 exists to kill. `agent_node`/`run_turn` accumulate and append the record; the checkpointer persists it (no new storage). Clarify turns: the parked turn's record freezes the clarify spec (written per B0 spike 1's proven mechanism), the answer is added at resume (G4), and the resumed run's record is complete by construction — no merge machinery.
- **Transcript read (`api/routes/sessions.py::get_session_route` + a rewritten `_extract_transcript`):** returns the `TranscriptEntry[]` shape of the consumer contract — user entries with `user_message_id`; assistant entries carrying the full turn record. Pre-MVP2 turns: no record → prose-only entries (renderer already handles it).
- `viz_emitted` stays only as the in-turn accumulation channel feeding the record (or is folded in — implementation's call; the state key's per-turn-overwrite behavior must not be load-bearing anymore).

**Tests (routine, no live LLM):** table-driven mapper (one row per tool); emission via `FunctionModel` scripted runs (exact step start/end/thinking sequences, threshold-buffer routing both sides of the threshold); **disabled source ⇒ its kind cannot appear** (PRD story 17); turn record built correctly (parts split at viz offsets; ids present; offsets right); transcript read returns the contract shape; receipts-no-secrets; clarify-park record freeze. One `live_llm` test: a real tool-using turn emits ≥1 step pair + thinking, and its transcript entry round-trips. **The harness still works untouched** (proves v1 additivity — it ignores unknown events).

**Gate:** all green; live harness run personally verified. **Review loop → commit (×2).**

---

### B2 — The turn registry: detached turns, resume, cancel, history rewrite

The load-bearing structural change (§27.3–27.4; ADR 0022; G3–G5).

**`app/turns.py` — the registry (one deep module):**
- `start(session_id, text, source_config, user_id, replace_message_id=None)` — acquires the per-session single-flight lock (held → `StreamActive` → the route's `409 stream_active`); **if `replace_message_id`: the G3 history rewrite first** (no active turn required by the lock; slice messages at the target turn's `messages_offset`, truncate `turn_records`, rebuild the source registry from surviving records, clear any pending interrupt per G4 — one `aupdate_state` write); then spawns the turn as a **detached `asyncio.Task`** wrapping `run_turn()`, under a **wall-clock watchdog** (`asyncio.wait_for`, `Settings.turn_timeout_s` — a hung Gemini/MCP call must not wedge the session forever; timeout runs the cancel-with-persistence path but terminates with an **`error` event**, not `done(cancelled)` — the student didn't press stop, and the record says so). Events append to the per-turn **ring buffer**.
- **Buffer policy (slow consumers, honestly):** attachments follow the buffer **by index** (N concurrent attachments cost nothing — two tabs both watch, which is how PRD story 40's "catch up" is exceeded for free; if index-following somehow doesn't fall out free, cut to latest-attach-wins). `Settings.stream_buffer_size` defaults large enough to hold a **worst-case full turn** (events are small dicts; a few thousand ≈ trivial memory), making overflow effectively unreachable; a consumer that still falls off the head gets its attachment **terminated with an `error` event** — never silently skipped deltas (skipped prose = corrupted answer = an honesty bug). Buffer + bookkeeping **evicted at terminal event** (no growth across a day's traffic); attach after eviction → `NoActiveTurn`.
- `attach(session_id, last_event_id) -> AsyncIterator[(seq, Event)]` — replay from the buffer index after `last_event_id`, then live to terminal. No active turn → `NoActiveTurn` (route → `204` → client falls to the transcript, which G2 made complete).
- `cancel(session_id)` — per G5: active → cancel the task at the graph boundary, **await `CancelledError` propagation, then** persist the partial turn: one `aupdate_state` appending a serialized `ModelResponse` carrying the streamed partial text (so the message list stays request/response-paired — `_split_user_message`'s tail convention survives) + the partial turn record (steps so far, parts so far, status `cancelled`) + the registry's accumulated source markers (inline citation chips in kept prose must still resolve); emit single-shot `done(cancelled)`. Idle → no-op. Parked → unpark (G4).
- `is_generating(session_id)`; `on_turn_complete` hook (B4's auto-title). Turn-completion bookkeeping (the `turn_complete` log) moves here from the route's `finally`, fields unchanged (B3 adds `user_id`).
- Owns ALL single-instance state (the `app.state.active_sessions` set dies). **Shutdown ordering:** the lifespan drains the registry (cancel-with-persistence for live turns) **before** `Runtime.aclose()` closes pools/checkpointer — otherwise the final `aupdate_state` hits a closed connection and loses exactly the prose this machinery exists to keep.

**Routes (`api/routes/sessions.py` becomes thin):** `POST .../messages` (body gains optional `replace_message_id`) = `start` + `attach(None)` — client disconnect now costs the turn nothing; **new `GET /v1/sessions/{id}/stream`** = `attach(Last-Event-ID)`, `204` on `NoActiveTurn`; **new `POST /v1/sessions/{id}/cancel`** per G5 (`202`/`204`).

**Settings:** `stream_buffer_size`, `turn_timeout_s`, reattach on/off (§32).

**The contract fixtures (a golden test, not an export mode):** canonical fixtures **committed** to `tests/fixtures/protocol/*.json` — a full dossier-style turn (`meta/step/thinking/delta/viz/sources/usage/done`), a clarify turn, a cancelled turn, and a full-fidelity transcript payload — generated from `FunctionModel` runs through a **normalization pass** (stable ids substituted for uuids, zeroed timestamps/durations) so they're byte-stable. A routine backend pytest asserts current emission == the committed fixtures (regeneration behind an explicit flag); the frontend turn-reducer vitest suite loads the same files (`fs.readFileSync` + `path.resolve` — they live outside Vite's root; never `import`ed). Drift on either side = a red test.

**Tests (§34 + the review findings):** fake-event-source registry units — disconnect leaves the turn running to completion (state persisted); reattach replays exactly from `Last-Event-ID`; double-send → 409; **`done(awaiting_input)` releases the lock and the answering POST is not 409'd** (G4's invariant); cancel → partial prose + record in transcript + `done(cancelled)`; **cancel-after-done is a no-op** (single-shot terminal); cancel-on-parked unparks + freezes the clarify unanswered; watchdog timeout cancels a hung turn; fall-off-the-head terminates with `error`; eviction → 204 path; **history rewrite** — edit truncates messages/records/registry at the right offset, regenerate re-runs the last exchange, edit-while-parked unparks, transcript after rewrite shows no ghost exchanges; shutdown drains before pool close; the parked-interrupt durability regression extends to mid-stream reconnect.

**Gate:** all green (including the FE vitest fixture consumption — this phase's review loop runs the frontend checks too); **personally verified live:** real turn in the harness → kill the tab → `curl -H "Last-Event-ID: N"` replays + tails; cancel mid-stream → partial transcript with partial receipts. **Review loop → commit.**

---

### B3 — Auth & identity

(§28; ADR 0021.) `security-reviewer` + `database-reviewer` mandatory; the asyncpg user-DB adapter is treated as auth-critical code.

- **Migration `0004_users.sql` (+ rollback):** `counselle.users` (fastapi-users base: `id uuid PK`, `email` lower-unique, `hashed_password` **nullable** (OAuth-only accounts; the B0-spiked guard makes password login on them a clean 400), `is_active`, `is_superuser`, `is_verified` — base columns kept inert; plus `name text`, `settings jsonb NOT NULL DEFAULT '{}'`, `created_at`); `counselle.oauth_accounts` (FK → users ON DELETE CASCADE); `sessions.user_id` FK → users ON DELETE CASCADE; **dev session purge guarded: `DELETE FROM counselle.sessions WHERE user_id IS NULL`** (can never eat real data on any environment, ever).
- **`api/auth.py` (+ `api/users_db.py`, the B0 adapter):** fastapi-users wiring — `UserManager` (name on register; no verification ceremony; **register-with-existing-email returns the stock 400 — an accepted, named existence leak**; forgot/reset returns 202 regardless — no leak; **reset on an OAuth-only account sets a password — named, intended**); **cookie JWT transport** (`httpOnly`, `Secure` Settings-gated for plain-http dev, `SameSite=Lax`, name/TTL from Settings — **TTL locked: 30 days, no refresh machinery**; logout = cookie deletion; ADR 0021's short-TTL revocation note amended accordingly at B0); routers under `/v1/auth/*`: register, login, logout, forgot/reset, **the users router** (email/password change — PRD story 49's Account rows), the **Google OAuth router** (`httpx-oauth` `GoogleOAuth2`, `associate_by_email=True`, the B0-spiked callback wrapper: set cookie + 302 to the SPA).
- **The principal & ownership:** a validated `current_user` dependency supersedes `api/context.py`'s parse-only seam (middleware keeps stashing for logs). **`owned_session(session_id, user)`** on **every** `/v1/sessions/*` route — foreign/unknown → **404**, never 403; a **route-inventory test** walks `app.routes` and asserts it. `POST /v1/sessions` + `.../messages` require auth and stamp `user_id` (`app/sessions.py::create_session` gains the param).
- **`/v1/me`:** `GET` (id, name, email, `has_password`, `google_connected`, settings), `PATCH` (name, settings jsonb — theme + default source preset), `DELETE /v1/me` (cancel any active turn via the registry first; then delete — FK cascade for rows + an explicit `adelete_thread` loop per session, since checkpoint tables have no FK to sessions; feedback-cascade is asserted in B4 when the table exists), `DELETE /v1/me/chats` (same, minus the account).
- **CSRF posture:** state-changing routes enforce `Content-Type: application/json` (one dependency + test).
- **`adapters/email.py`:** the provider seam with **only the `console` arm built** (logs the reset link — the dev default); the switch + `NotImplementedError` for `smtp|resend` (added in B6 only if launch wants real email). Templates as `config/assets/email/` assets.
- **Settings:** Auth group (jwt secret — env-stable, never boot-generated; cookie name/secure; Google id/secret; reset TTL) + Email group; `.env.example`. Secrets fail-fast only when their feature is on.
- **The existing-suite migration (budgeted):** ~50 call sites in `tests/api/` POST without auth — add an authenticated-client fixture + sweep the suite green. (`evals/runner.py` is unaffected — it drives `run_turn` directly.)
- **Named edge semantics:** logout does not kill an active turn (it finishes and persists — fine); cookie expiry mid-stream is benign (auth checked at request start), reattach-after-expiry → 401 → login (verified in B5).

**Tests:** register→login→me→logout; wrong password; OAuth-only + password login → 400; forgot/reset round-trip (console captures the token); reset-sets-password on OAuth-only; Google callback (mocked `httpx-oauth`: new-user + associate-by-email); ownership 404 parameterized over the route inventory; `DELETE /v1/me` cascade (sessions + checkpoints gone, active turn cancelled); content-type enforcement; cookie flags.

**Gate:** suite green incl. the migrated existing tests; **personally verified live:** full email + Google loops on localhost (real GCP client), httpOnly cookie in devtools, the harness (cookieless) correctly 401s. **Review loop → commit.**

---

### B4 — Chat management, feedback, rate limiting, runtime config

(§29–30, §32.)

- **Chat management:** `GET /v1/sessions?q=&cursor=&limit=` — owner's, `updated_at` desc, keyset-paginated on `(updated_at, session_id)`; `q` = title `ILIKE`; rows `{session_id, title, updated_at, created_at, is_generating}` (registry-sourced). `PATCH {title}` (cap = the same `title_max_len` knob); `DELETE` — **registry cancel first** (a live detached task must not checkpoint after the thread is deleted and resurrect rows), then row + `adelete_thread` (tested).
- **Auto-titles:** the **default title is set when the first message arrives** (the question, truncated to `title_max_len`) — not at session creation (no question exists yet). On the first turn's `on_turn_complete`: fire-and-forget task → first exchange → cheap-tier model (`model_title` defaulting to `model_cheap`; prompt asset `prompts/title.md`) → `UPDATE title`. Any failure → default stands; **never blocks, never retries, never raises into the turn** (the swallow is deliberate and logged — silent-failure-hunter signs it off).
- **Feedback:** migration `0005_feedback.sql` (+ rollback) — `counselle.feedback (id, user_id FK ON DELETE CASCADE, session_id FK ON DELETE CASCADE, message_id, rating up|down, created_at)`, **unique `(user_id, message_id)`** — sound because `message_id` is a global uuid (G1). `POST .../messages/{message_id}/feedback {rating}` upsert; `rating: null` clears (re-tap toggles). Ownership via `owned_session`. The account-deletion feedback-cascade assertion lands here (deferred from B3 — the table now exists).
- **Rate limiting:** `api/ratelimit.py` (~30 lines) — per-`user_id` in-process sliding windows, applied **only** to `POST .../messages`; knobs `turns_per_hour`/`turns_per_day`; exceeded → `429` + `Retry-After`. **A clarify answer is a message send and spends a token — named and accepted** (simple beats a parked-state carve-out). `turn_complete` gains `user_id`.
- **Runtime config:** `GET /v1/config` (authed) → `{greeting, starter_prompts[], default_source_config}` — greeting from `config/assets/greeting_templates.yaml` keyed by the **same** `admission_season` machinery the agent uses (one mechanism, never two); chips from `starter_prompts.yaml`; default source config = the user's saved preset falling back to Settings defaults.
- **Settings:** Chat group (`model_title`, `title_max_len`), Rate-limit group.

**Tests:** list/search/pagination/ownership; delete removes checkpoint rows (`live_db`); title — success, failure-is-harmless, never-delays-`done`; feedback idempotency/toggle/ownership/cascade; 429 + `Retry-After` + window expiry; config shape + season correctness (frozen clock).

**Gate:** green; sidebar-shaped data verified by `curl` against a seeded dev DB (note: between B3 and B5 there is deliberately **no browser client** — the harness is auth-dead and the SPA isn't wired; curl is the verification surface, and no dev auth bypass gets added to "fix" that). **Review loop → commit.**

---

### B5 — FE‑7: the frontend goes live

(frontend-plan FE‑7; §31.4.) The seam swap the frontend was built around: nothing above `Transport` changes. Three committed sub-milestones. `typescript-reviewer` + `security-reviewer` on the auth client.

#### B5a — HttpTransport + the stream pipeline

- `frontend/src/api/http/transport.ts`: `sendMessage` — `POST .../messages` with **fetch-streaming SSE parsing** (`EventSource` can't POST): a small parser over `ReadableStream` handling `id:`/`event:`/`data:` frames, CRLF, multi-line data, keepalive comments; yields the existing `ProtocolEvent` union (unknown types already ignored downstream). `attach` — `GET .../stream` + `Last-Event-ID` (same parser); `204` → empty → caller falls to `transcript()`. `cancel`, `transcript`. All same-origin with `credentials: 'same-origin'`; `401` → auth redirect; `409`/`429` → typed errors the existing retry/draft-keeping paths render.
- The reducer's vitest specs have consumed `tests/fixtures/protocol/*.json` since B2 (B2 owns the reconciliation; this milestone just proves it against live traffic — no second reconciliation task).
- `VITE_TRANSPORT=mock|http`, default **http**; MockTransport stays for dev/offline/tests.
- **Gate:** a real dossier turn streams into the real UI — timeline, cards, citations, sources — verified in-browser. Commit.

#### B5b — Real auth + the REST swap

- `src/api/mock/authStore.ts` retired behind the same `app/auth.ts` surface: login/register/logout/forgot/reset → `/v1/auth/*`; Google button → the redirect flow; session user = a TanStack query on `GET /v1/me` (the cookie is the session — zero client token handling); signup wall keys off the `me` 401. Account rows → `/v1/me` PATCH + the users-router flows; Data controls → `DELETE /v1/me/chats` / `/v1/me`. Theme + default-source preset sync to `users.settings` (localStorage = offline cache).
- `src/api/hooks.ts` swaps store → real endpoints (same QueryKeys/shapes): sessions list (server `updated_at` drives the existing recency grouping; `is_generating` → the sidebar indicator), rename/delete/create, feedback (**the vendored `thumbsUp/thumbsDown` shape maps to `{rating: up|down}` inside the hook** — vendored components untouched), config → `GET /v1/config`.
- **Gate:** the full account loop live — signup wall → register → Google → settings → delete-account. Commit.

#### B5c — Turn orchestration, landing page, harness retirement, the smoothness gate

- On chat open: `attach()` first → events through the same reducer; `204` → `transcript()` (already the reducer's second path). F5 mid-answer now actually reconnects.
- **Edit & regenerate go real (G3):** edit-old-message → `sendMessage` with `replace_message_id`; regenerate → the same with the last user message's id + text. Send-mid-stream: cancel → await `done` → send (a raced `409` retries once). Parked-chat edit relies on G4's unpark — verified.
- **The marketing landing page** (PRD decision 2, §31.6): one static HTML file, no framework — what Counselle is, one real dossier screenshot (taken from the live app this milestone), signup CTA; served at `/` in B6.
- **Retire the harness:** delete `harness/` + its mount in `api/main.py` + its tests (it has done its job — including proving v1 additivity in B1).
- **Gate (personally, in-browser, real backend):** the full loop — signup wall → register → Google login → seasonal greeting → dossier turn with real timeline/receipts/cards/citations → clarify round-trip (chip and typed) → stop mid-stream → F5 mid-answer reconnects → edit-and-re-ask (old message) → regenerate → rename/search/delete → settings persist across browsers → logout. Every FE‑6 smoothness law at real latency (echo 0ms; first activity <300ms — now bounded by real step emission; no >2s silence — keepalives + **thinking density assessed here, the §35 dogfooding checkpoint**), **plus the mobile sweep (story 45): 375px viewport, 44pt targets, composer above keyboard, card variants**. tsc/vitest/build green. **Review loop → commit.**

---

### B6 — Ship: one container, deployed, smoked

(§33; ADR 0023.)

- **Container:** `Containerfile` goes multi-stage — stage 1 (`node:20-slim`) builds `frontend/dist`; stage 2 = the existing Python image + the bundle. `api/main.py`: Settings-gated static serving — landing at `/` (logged-out; logged-in redirect is client-side), `StaticFiles` assets, SPA fallback for non-`/v1` routes. Settings frontend group (bundle dir, serve on/off — off in dev; Vite proxies `/v1`).
- **Entrypoint migrations:** `entrypoint.sh` — `yoyo apply --batch` then `exec uvicorn`. **Named posture:** migration failure → non-zero exit → crash-loop → previous image redeploy (works because migrations stay additive — keep them so); yoyo runs on the **app DSN** (Counselle owns `counselle.*` DDL per ADR 0019 — verified, not assumed, at first deploy); concurrent apply during the host's blue-green overlap is serialized by yoyo's lock table (stated, verified on host).
- **`compose.yaml`** (local prod-parity) + **`docs/DEPLOY.md`** (env vars incl. the stable JWT secret, host notes, OAuth redirect setup) — **registered in CLAUDE.md's documentation map**.
- **Deploy** (host per §2): env set (DSNs, JWT secret, Google creds + prod redirect URI, cookie `Secure` on, email provider — add the Resend/SMTP arm now only if launch wants real reset email); verify on the real host: SSE un-buffered end-to-end (`X-Accel-Buffering` + keepalives), cookies under TLS, Google OAuth on the prod domain, migrations ran, `/v1/health` green.
- **The Playwright smoke** (the only E2E, §34), runnable locally and against the deployed URL: signup → ask (a known long dossier question) → stream completes with timeline → **reload triggered on receipt of the first `step` event** (deterministic, not a sleep — the only E2E must not be the flaky one) → sane state → transcript intact at full fidelity. Lives in `frontend/e2e/`; run-by-hand gate (consistent with the no-CI decision).

**Gate:** the smoke passes against production; a real dossier question answered end-to-end on the public URL, personally. **Review loop (security: headers, cookie flags, no secrets in image) → commit.**

---

### B7 — Hardening, evals, docs, close-out

- **Eval delta** (sanctioned by ADR 0022's consequence; the §34 "unchanged" sentence was annotated at B0): `evals/judge.md` gains the `thinking` facts-first watch; `evals/runner.py` ingests `step`/`thinking` events so assertions can see them. **Run the full eval set**; investigate any regression vs `report-2026-06-11` (the agent didn't change — regressions indicate emission bugs, e.g. final-answer text misrouted to `thinking`).
- **`evals/export_feedback.py`** lands here (thumbs-down rows → eval-question candidates — a script, not a pipeline; built now that the table and real usage exist).
- **Full verification sweep:** complete pytest incl. `live_db`/`live_search`/`live_llm`; ruff + mypy; tsc + vitest + build; one final whole-diff review (`code-reviewer` + `security-reviewer` over `git diff main...HEAD`).
- **Docs:** `CLAUDE.md` (status → MVP2 shipped; commands gain frontend dev/build + deploy; map adds DEPLOY.md), `README.md`, `TODOS.md` (carry-overs: session-TTL job; the standing §35 watch-items — thinking density verdict, checkpoint/turn-record growth vs the TTL knob, scale-out re-backing list; anything deferred in reviews), Part II merge-notes spot-checked, `PRD-mvp2.md` status line.
- **Archive:** `plans/mvp2/` → `plans/archive/mvp2/` with a final as-built deviations note in this file.
- **Merge:** `--no-ff` milestone merge → `main`: `merge: MVP2 milestone — the full-stack app (backend delta, auth, FE-7, deployed)`.

**Gate = the Definition of Done (§0), item by item.**

---

## 4. Risks & watch-items (execution-level; §35's architecture risks stand)

| Risk | Mitigation |
|---|---|
| Streamed tool events misbehave despite the verified classes (ordering, missing args) | B0 spike 1 is first work; ADR 0022's fallback (MCP hook + own tools) is decided; the step mapper is seam-agnostic |
| Thinking threshold-buffer misclassifies | Degrades honestly by construction (long narration → delta = MVP1 behavior; short answer → small end-burst); FunctionModel tests pin both sides; the eval watch + prompt rule guard the facts-first honesty side |
| The turn record bloats graph state | Receipts bounded (no payloads); parts store offsets+specs, not duplicated prose beyond the message text; the existing checkpoint TTL knob covers growth — watch, don't pre-build |
| Cancel loses partial prose / races its own state write | Registry accumulates; awaits `CancelledError` propagation **before** the single `aupdate_state`; single-shot terminal; shutdown drains before pool close — all tested |
| History rewrite corrupts a thread (bad offset slice) | `messages_offset` written at turn start by the same code that appends; rewrite is one `aupdate_state`; ghost-exchange and parked-edit tests; the transcript read is the oracle |
| A hung model/MCP call wedges a session forever (detached tasks remove the old disconnect-kills-it accident) | The watchdog (`turn_timeout_s`) → cancel path; buffer + bookkeeping evicted at terminal |
| fastapi-users custom asyncpg adapter hides a protocol subtlety; null-hash and OAuth-callback sharp edges | B0 spike 3's checklist names all three; SQLAlchemy-adapter fallback contained to one module; security review treats the adapter as auth-critical |
| B3 turns the existing API suite red | Budgeted: authenticated-client fixture + suite sweep is a named B3 task |
| Golden fixtures aren't byte-stable (uuids/timestamps) | The normalization pass is specified; regeneration is flag-gated; routine runs assert equality on both sides |
| Real-latency smoothness regressions (FE‑6 tuned on mocks) | B5c re-runs every law + the mobile sweep; keepalives bound silence; thinking density is the named checkpoint |
| OAuth/cookies break only on the prod domain | B6 verifies on the real host before the smoke; redirect URIs + `Secure` are env, not code |
| Scope creep | §0 non-goals; reviewers instructed to flag additions beyond spec + §0.1 |

## 5. What done looks like

A student opens the public URL, reads one honest page, signs up in seconds (or taps Google), asks "give me the full profile on NYU," watches the agent actually work — every step labeled, every claim chipped, every number sourced and dated — answers a clarifying question by tapping or typing, refreshes mid-answer and loses nothing (cards, receipts, and citations included), edits her question and the transcript stays truthful, comes back tomorrow to find the chat titled and waiting, and never once gets lied to. One container, one Postgres, deployed, evaled, documented.
