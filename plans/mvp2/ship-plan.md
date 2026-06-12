# MVP2 Ship Plan — backend delta, FE‑7 hookup, deploy

> The execution plan for **the rest of the app**: everything between "the frontend demos on fixtures" (frontend-plan FE‑0…FE‑6, done, merged 2026‑06‑12) and "a student signs up and uses Counselle on a real URL." Covers the full backend delta (`architecture.md` §27–30, §32–33), the agent-code changes (step/thinking emission), real auth, the FE‑7 hookup, deployment, and the docs/evals close-out.
>
> Specs this plan executes, by reference: `PRD-mvp2.md` (the WHAT), `plans/mvp2/architecture.md` §26–35 (the HOW), ADR drafts 0020–0023. Where the spec named a build-time gate, the gate is a task here. **Where the spec had a hole, §0.1 names the resolution explicitly** — the spec gaps surfaced in review are resolved here and recorded into the architecture docs at B0; everything else adds no decisions, only sequencing + build detail.
>
> Status: **plan drafted 2026‑06‑12, revised same day through two review passes** — pass 1: spec coverage / codebase reality / engineering rigor; pass 2 (four lenses): the FE↔BE seam walked against the actual frontend code, agent work-visibility quality, MVP1 regression safety, and a simulated first deploy. Phases B0–B7.

---

## 0. Definition of done

MVP2 ships when all of these are true:

1. **PRD Backend Delta 1–7 implemented**: `step` events, `thinking` events, resume + cancel, auth + users, chat CRUD + auto-titling, feedback endpoint, per-user rate limiting.
2. **The frontend runs against the real service** — `HttpTransport` over `/v1`, cookie auth, reattach, cancel, edit/regenerate, real source-control — with every FE‑6 smoothness law (including the mobile sweep, PRD story 45) re-verified against real latency, and the shared protocol fixtures reconciled (the contract test).
3. **One container deploys to a real host with a real database**: the pipeline Postgres hosted and reachable (§2 prerequisite 0), SPA + landing served same-origin, migrations run on boot, SSE survives the host's proxy, Google OAuth works on the prod domain.
4. **The Playwright smoke passes against the deployed stack**: signup → ask → stream with timeline → refresh mid-answer → sane state → transcript intact — *transcript intact* meaning full fidelity: prose, cards, citations, step receipts, clarify records with their answers, feedback state (§0.1‑G2).
5. **The eval set passes against a re-baselined comparison** (§B7 — the prose composition changes by design) with the new mechanical honesty checks in place; routine pytest, ruff, mypy, tsc, vitest, and the frontend build are all green.
6. **`harness/` is deleted**; docs (ARCHITECTURE Part II + the §0.1 addenda, ADRs 0020–0023 Accepted, CLAUDE.md, README, DEPLOY.md) are current; `plans/mvp2/` archives.

**Non-goals (locked by the PRD):** deep research (stub seam stays), guest mode, memory/personalization, email verification, 2FA, reason-chip feedback, designed rate-limit UX, follow-up chips, autocomplete, chat sharing, billing, admin, branching.

### 0.1 Spec gaps resolved by this plan

Written into `docs/ARCHITECTURE.md` Part II (and ADR 0022 where noted) during B0's docs merge — decisions, recorded as such.

- **G1 — Message identity.** Every turn mints two UUIDs at start — `user_message_id` and `message_id` (the assistant message) — emitted in `meta.data` (additive within v1; the live stream can address the in-flight message for feedback/edit) and persisted in the turn record (G2). Feedback keys on the globally-unique assistant `message_id`. **A clarify resume reuses the parked turn's `message_id`** — one assistant message, one id, however many park/resume cycles produced it.
- **G2 — Full transcript fidelity.** §27.5's step record grows into the **turn record** (B1b): per assistant turn — the G1 ids, ordered `parts[]` (text + viz at emission offsets), steps + receipts, thinking lines, the one-line receipt, the sources payload, usage, terminal status (+ error payload when status is `error`), the clarify record (spec + answer/unanswered), timestamps, and `messages_offset` (the graph-state slice point for G3; server-internal, never on the wire). Persisted per turn in graph state; the transcript read returns the **consumer-contract wire shape** (§0.2). MVP1's transcript is prose-only and `viz_emitted` is overwritten per turn — today a reloaded chat loses its cards entirely; this fixes that.
- **G3 — Edit & regenerate: history rewrite.** `POST /v1/sessions/{id}/messages` gains optional `replace_message_id` (a prior `user_message_id`): single-flight lock held, no active turn → one `aupdate_state` rewrite (messages sliced at the target turn's `messages_offset`, turn records truncated, source registry restored from the last surviving record's cumulative snapshot, pending interrupt cleared per G4), then the new text runs as a normal turn. **Regenerate = edit of the last user message with the same text** — one mechanism. Pre-MVP2 turns have no `user_message_id` and **cannot be edit targets** (422; the FE hides Edit on id-less entries) — the rewrite never slices into record-less history.
- **G4 — Clarify-park lifecycle.** Invariant (verified against `app/run_turn.py`): `interrupt()` ends the turn — `done(awaiting_input)`, task completes, lock releases; **no parked task exists**, so the answering POST is never 409'd and cancel-on-parked is a no-op + **unpark** (clear the interrupt, freeze the clarify as *unanswered*). A plain next message remains the answer (story 24). **The answered case persists** (story 25): the answer rides `Command(resume=text)` and never enters `messages`, so the resumed turn's record stores the answer alongside the spec, and the transcript read synthesizes the student's answer bubble from it (carrying the resume's `user_message_id`, so it's a first-class entry — feedback-anchorable, but **not an edit target**: G3 returns 422 for it by an explicit synthesized flag, not by id-absence). **Resume-replay semantics (decided, recorded in ADR 0022's consequences):** LangGraph re-executes the node — pre-clarify tools re-run and re-stream as fresh steps in the answering turn. This is shown as-is (it is the truth: the work *is* re-done) and the **resumed run's record replaces the parked record** (same `message_id` per G1); the replay may differ from what was watched live (non-deterministic) — accepted, named, one sentence in the ADR.
- **G5 — Cancel semantics.** Active → `202` + single-shot `done(cancelled)`; idle → `204` no-op; parked → `204` + unpark. Cancel racing completion = the idle no-op. **Watchdog timeout terminates with `error`, not `done(cancelled)`** — the student didn't press stop.

**Verified facts (checked in-source 2026‑06‑12):** `FunctionToolCallEvent`/`FunctionToolResultEvent` exist in the pinned pydantic-ai and flow through `run_stream_events()`. **`FinalResultEvent` is NOT a usable thinking/delta splitter** (fires on any TextPart when text output is allowed). **Parallel tool calls are real**: pydantic-ai yields all call events for a response in order, then runs tools concurrently with result events **as-completed** — start/end pairing must key on `tool_call_id`, not a "current step" cursor. `ask_student` raises `interrupt()` out of the tool call — **its call event never gets a result event**. The Tavily tools **never raise** — failures return `{"error": …}` as successful-looking results. `AsyncPostgresSaver.adelete_thread` and `Pregel.aupdate_state` exist.

### 0.2 The wire contract (one authoritative shape, decided at B0 spike 4)

The already-built frontend types (`frontend/src/api/protocol.ts`) are the consumer contract; the backend serves **their** field names and nesting — re-deciding names per phase is how seams die. Locked here, finalized field-by-field in B0 spike 4:

- Transcript entries mirror `TranscriptEntry`/`TranscriptAssistantEntry`: user entries carry **`message_id`** (the wire name for G1's `user_message_id`) + `ts`; assistant entries carry `message_id`, `ts`, **`text` (kept — the harness and any dumb client reads it)**, `parts[]`, `step_record: {steps, thinking, receipt}` (receipt = the formatted sources-line **string**), `sources`, `usage`, `status` (literal `complete|cancelled|error|awaiting_input` — nothing else; the FE maps unknowns to `awaiting_input`), `error?` (status `error` → the `ErrorData` the student saw live, trace_id included), `clarify?` (`{spec, answer | null}` — the FE widget gains the frozen-answer render), `feedback?` (the caller's stored rating — the read path that makes thumbs survive reload).
- **`sources` stays cumulative per message** (the registry's stable global indexes are what citation chips resolve by); the FE sources *footer* filters to the markers cited in that message's parts (a small named FE task) — chips never break, footers never lie.
- `meta.data` gains `message_id` + `user_message_id`; `MetaData` in protocol.ts updated to match.
- `/v1/config` serves the shape the landing already consumes: `{greeting, season_note, conversation_starters[], default_source_config}` (the FE's `APP_CONFIG` fields; `footer` stays an FE constant).
- `source_config` on the wire uses the backend's names (`{web, edu, reddit, reddit_subreddits}`, bare subreddit keys) — the FE's `sourceStore` maps its `{webSearch, eduSources, selectedSubreddits: ['r/…']}` shape at the transport boundary.
- Events gain nothing else; `ProtocolEvent` stays seq-less — **HttpTransport tracks the SSE `id:` internally** and owns the Last-Event-ID cursor (the `attach(sessionId, lastEventId?)` caller-side param is satisfied by the transport's own bookkeeping).

---

## 1. Execution protocol (applies to every phase)

### Git

- **Branch:** `feat/mvp2-app`, cut from `main` at B0. Conventional commits per phase milestone (B1 and B5 have named sub-milestones — one commit each), only after the milestone's gate + review loop pass. Stage file-by-file; never `git add -A`. New migrations ship with `.rollback.sql`.
- **Merge:** a single `--no-ff` milestone merge to `main` when B7's gate passes. No pushes/PRs unless asked.

### Subagents & model routing

- **Implementation:** main loop + scoped **Fable subagents** with tight briefs for parallelizable mechanical work (the FE‑4C/FE‑5/FE‑6 pattern: small, parallel, scoped). Sonnet only for fully prescriptive sweeps.
- **Verification is never delegated on trust:** every user-facing gate verified personally in the browser; every backend gate by running tests/server personally.

### The review loop (after each phase, before its commit)

1. Mechanical gates first (routine pytest, `ruff check . && uv run mypy .`; phases touching `frontend/` — **including B2's fixture spec** — also `tsc`, vitest, `vite build`).
2. Reviewers in parallel, scoped to the phase diff: `python-reviewer`/`typescript-reviewer` + `code-reviewer` always; `security-reviewer` mandatory B3/B4/B5/B6 (+ receipts-no-secrets B1/B2); `database-reviewer` on migration phases; `silent-failure-hunter` on error-path phases (B1 emission, B2 lifecycle, B4 auto-title, B5 transport).
3. Fix every CRITICAL/HIGH; re-review changed files; loop until clean. MEDIUMs fixed or deferred to TODOS.md with reason.
4. Re-run mechanical gates. Commit.

### House invariants (checked in every review)

Layering inward-only (the only `domain/` delta is the additive event types — the sanctioned §26 carve-out); parameterized SQL only; no secrets in logs/receipts; files <800 lines, functions <50 (vendored frontend exempt); the honesty carve-out — never lie to a student — outranks KISS everywhere it applies.

---

## 2. Prerequisites (user-provided — needed before the marked phase)

| # | Item | Needed by | Notes |
|---|---|---|---|
| 0 | **A production Postgres for the pipeline DB** | B6 (provisioned early in B6) | **The biggest one.** The pipeline DB lives on the dev machine today; `counselle.*` cannot be split out (cross-schema coupling: `migrations/0002_helpers.sql` reads `raw.*`/`field_values` by name; the reconciler reads `public.fields`). Day 1 needs the whole database hosted: Postgres 16 + **pgvector available**, co-located with the app (up to 12 tool rounds × cross-region RTT otherwise), sized for the pipeline data (~GBs). Choices: the host's managed PG, or PG on the same VPS. Refresh story decided at B6 (re-dump vs pipeline pointing at the cloud DB). |
| 1 | Google OAuth client ID + secret | B3 | GCP console; redirect URIs for `http://localhost:8000` now, prod domain added in B6. `.env` only. |
| 2 | Deploy target choice | B6 | Default recommendation: **Fly.io**; Railway or any VPS equally fine per ADR 0023. Needs a domain for `Secure` cookies + OAuth redirect. |
| 3 | Email provider (prod only) | B6 | `console` covers dev and is the only arm built until B6; Resend/SMTP added at launch only if real reset email is wanted. |

---

## 3. Phases

Sequence: B0 → B1 → B2 → B3 → B4 → B5 → B6 → B7. (True DAG: B1→B2 and *most of* B3 are independent — B3's auth core can pull forward if B1 runs long; its registry-touching bits land after B2; B4 needs both.) File paths verified against the code 2026‑06‑12.

---

### B0 — Branch, docs merge, build-time gates (no production code)

**Branch** `feat/mvp2-app`. **Docs merge** per `00-overview.md`: architecture.md → ARCHITECTURE Part II with the eight Part I annotations **plus the §0.1/§0.2 addenda** (G1–G5 into §27; the §26 domain-carve-out note; the §34 eval-delta sanction; ADR 0023's CORS-knob consequence; ADR 0022 amended with G1–G5 + the resume-replay consequence). ADRs 0020–0023 → Accepted (after the spikes). `CLAUDE.md` status + map. Commit.

**Gate spikes (throwaway; outcomes appended to this file as "B0 decisions"):**

1. **Emission mechanics** (live Gemini, one tool-using question + one clarify round through `run_stream_events()`): confirm event ordering; **produce the pairing rule** — `tool_call_id → step_id` map (as-completed results make a "current step" cursor wrong); time call→result locally (result events carry no duration); confirm `ask_student`'s call event gets no result (excluded from steps — the clarify event is its UI); observe a parallel batch (interleaved pairs; what happens to sibling steps when an `interrupt()` unwinds mid-batch). **Prove the two LangGraph mechanics:** (a) `aupdate_state` while an interrupt is pending (the parked record write) sticks and doesn't disturb `Command(resume)`; (b) the unpark — `aupdate_state(..., as_node=…)` actually empties `snapshot.tasks[*].interrupts` (what parked-detection reads). Fallbacks if not: record written at resume; unpark via discarded no-op resume.
2. **Thinking routing:** the threshold-buffer (per-model-response text buffer; tool-call part in the same response → flush as `thinking`; crossing ~240 chars → flush as `delta`, stream live thereafter). The spike pins the edge cases: `PartStartEvent` carries the first chunk as content (the buffer consumes both event classes); text *after* tool-call parts in a response; buffer resets per response; the threshold's latency cost measured. **Also evaluate Gemini's native thought summaries** (`ThinkingPart`/`ThinkingPartDelta` — pydantic-ai surfaces them; they'd fill the model-thinking gaps with real reasoning at real facts-first risk) — adopt, defer, or reject **on evidence, recorded**.
3. **fastapi-users:** the custom asyncpg `BaseUserDatabase` adapter (default; SQLAlchemy fallback); pin versions; verify cookie-JWT transport; **the OAuth callback → set-cookie → 302-to-SPA wrapper**; **the null-`hashed_password` guard** (clean 400 + dummy-hash timing parity); **the login content-type** (fastapi-users login is form-encoded — `/v1/auth/login` is the named exemption to B3's JSON-only rule).
4. **The wire contract finalized** (§0.2): field-by-field against `protocol.ts` — ids, `text` kept, `ts`, `error`, `status` literals, `clarify {spec, answer}`, `feedback` hydration, receipt string format, cumulative sources + footer-filter rule, config shape, source-config mapping, Last-Event-ID ownership. Output = B1b's build checklist **and B5's FE task list** (both consume this, neither re-decides it).

**Gate:** docs merged; decisions recorded; spikes deleted. **Commit.**

---

### B1 — Work visibility & the turn record (the agent-code phase)

Two committed sub-milestones. No HTTP changes beyond the transcript read.

#### B1a — `step` + `thinking` events, the step mapper, emission

- **Domain (additive):** `domain/events.py` — `StepData` + `ev_step()`; `ThinkingData` + `ev_thinking()`; `done.status` gains `cancelled`; `meta.data` gains the G1 ids. `v` stays 1.
- **The step mapper** (`app/steps.py` + `config/assets/step_labels.yaml`): pure, **with a complete table — one row per tool, walked against the live surface** (MCP: `resolve_school`, `get_values`, `get_dossier`, `compare_schools`, `find_schools`, `national_benchmark`, `get_programs`, `get_diversity`, `query_database`, `get_data_calendar`, `search_fields`; Tavily ×3; `render_viz`; `load_skill`; `ask_student` = excluded; + a default row so an unknown tool maps to a generic step, never to nothing — exhaustiveness-tested against the live MCP tool list). **Labels can name schools:** the mapper takes a `unitid → name` resolver (the in-memory catalog — already loaded) so "Pulling Duke's dossier" beats "Querying the database" for unitid-arg tools; `{category}` derives per-tool (field-key prefixes / dossier sections). `sql` kind: label "Running a custom database query", receipt carries the statement (radical transparency — decided, not omitted). **Error labels per failure class** in the asset ("Search failed — source unavailable", "Retrying…"). Receipts: queries/domains/counts/field keys — never DSNs/credentials/payloads (tested).
- **Emission (`app/agent_node.py`):** consume the tool events with the **`tool_call_id → step_id` pairing map** (B0's rule); **result-shape error detection** — a Tavily `{"error": …}` dict and a `RetryPromptPart` result both emit `status:"error"` (a failed search must never get a green check — law 2), and the model's retry shows as a fresh step; **terminal closure** — at clarify/done/error, every open step is closed by the emitter (synthetic `end`/`error`) so nothing shimmers forever (covers `ask_student`'s missing result event and interrupt-stranded parallel siblings). Thinking routing per B0 spike 2.
- **Prompt delta** (`counselor.md`): the prompt today contains **zero narration instruction** — interstitial density is whatever Gemini does unprompted. Add it: brief intent narration before tool calls ("one short sentence on why, before you act"), never facts/numbers first (§27.2). This is a deliberate behavior change — it shifts the eval baseline, handled in B7.
- **`app/run_turn.py`:** `step`/`thinking` arms in the custom switch; the route generator stays encode-and-yield.

#### B1b — The turn record + the full-fidelity transcript (G1 + G2 + §0.2)

- **`app/state.py`:** `TurnState` gains `turn_records` — **an overwrite channel where every writer owns the full list** (no reducer; the four writers — node return, cancel write, G3 rewrite, parked-clarify write — each read-prior-append-write; one sentence that prevents the double-append class). Record fields per G2. **`parts[]` is offsets, not duplicated prose** — which requires the invariant: **every terminal path (complete, cancelled, error, tool-budget) leaves `messages` carrying exactly the prose that streamed.** The `UsageLimitExceeded` path (today loses streamed prose — a live MVP1 bug under G2's lens) and the node-error path get the partial-`ModelResponse` + record treatment here; cancel gets it in B2; **the empty-partial rule: no prose streamed → skip the `ModelResponse` append entirely** (an empty-content response corrupts the provider history). Clarify: parked record written via spike-1's proven mechanism; **resume replaces it, same `message_id`** (G4).
- **Transcript read** (`get_session_route` + a rewritten `_extract_transcript`): serves the §0.2 wire shape — **`text` kept on assistant entries** (the harness reads it until B5d retires it; any dumb client keeps working), `parts[]`/records alongside; pre-MVP2 turns → prose-only entries; a pre-MVP2-checkpoint fixture test pins that.
- The existing `tests/api/test_protocol.py` known-event-type set updated for `step`/`thinking` (budgeted).

**Tests:** table-driven mapper (a row per tool + exhaustiveness vs the live MCP list + error-shape detection + resolver labels); `FunctionModel` scripted runs — step sequences incl. **parallel interleaving**, threshold routing both sides of the threshold **and both sides of a response boundary**, terminal closure, `ask_student` exclusion; **disabled source ⇒ kind impossible** (story 17); turn-record correctness (offsets, ids, replace-on-resume); transcript wire shape vs the committed contract; receipts-no-secrets; pre-MVP2 fallback. One `live_llm` test: real tool-using turn → steps + thinking + round-tripped transcript entry.

**Gate:** all green; live harness run personally verified (stream additive; reload still renders via `text`). **Review loop → commit (×2).**

---

### B2 — The turn registry: detached turns, resume, cancel, history rewrite

(§27.3–27.4; ADR 0022; G3–G5.)

**`app/turns.py` — the registry:**
- `start(session_id, text, source_config, user_id, replace_message_id=None)` — single-flight lock (`StreamActive` → 409); G3 rewrite first when editing; then the detached task wrapping `run_turn()`, under the **watchdog** (`turn_timeout_s`; timeout → cancel-with-persistence terminating with `error` per G5). Events append to the per-turn ring buffer.
- **The registry also owns what the route owns today** (the route becomes a dumb caller, verified against `api/routes/sessions.py`): **seq stamping** (buffer-owned — Last-Event-ID replay must be consistent across consumers), **usage enrichment** (`enrich_usage_event` moves in — a reattaching consumer must see the same enriched event the first consumer saw; route-side enrichment would fork the streams), **the after-commit error fallback**, and the `turn_complete` log (fields unchanged; `user_id` added in B4, with the rate-limit work — §30's pairing).
- **Buffer policy:** attachments follow by index (N tabs watch free; if that ever stops being free, cut to latest-attach-wins); `stream_buffer_size` defaults to a full worst-case turn (overflow effectively unreachable); a consumer falling off the head is **terminated with an `error` event** (silently skipped deltas = corrupted prose = an honesty bug); buffer + bookkeeping **evicted at terminal**; attach after eviction → `NoActiveTurn` → `204` → the transcript (complete, per G2).
- `attach(session_id, last_event_id)`; `cancel(session_id)` per G5 — awaits `CancelledError` propagation **then** one `aupdate_state` (partial `ModelResponse` — skipped if no prose streamed — + partial record + accumulated source markers), single-shot terminal; `is_generating`; `on_turn_complete` (B4's title hook). **Shutdown drains the registry before `Runtime.aclose()`** — the final state write must not hit a closed pool.
- The `app.state.active_sessions` set dies. **Budgeted:** the two existing tests that poke it (`tests/api/test_protocol.py:392`, `tests/api/test_routes_unit.py:254`) are rewritten against the registry.

**Routes:** `POST .../messages` (+`replace_message_id`) = start + attach; **`GET /v1/sessions/{id}/stream`** (Last-Event-ID; 204); **`POST /v1/sessions/{id}/cancel`** (G5). **Settings:** `stream_buffer_size`, `turn_timeout_s`, reattach toggle.

**The contract fixtures (golden):** committed `tests/fixtures/protocol/*.json` — full dossier turn, clarify turn (incl. resume), cancelled turn, full-fidelity transcript — from `FunctionModel` runs through a normalization pass (stable ids, zeroed timestamps/durations); routine backend pytest asserts emission == fixtures (regen behind a flag); frontend vitest loads the same files (`fs.readFileSync`, outside Vite root) — **which makes B2 the named owner of the protocol.ts transcript-type edits** (`clarify: {spec, answer|null}`, `feedback?`, the id/ts fields per §0.2); a backend phase deliberately touching one frontend file, its review loop runs the FE checks. Drift = red test on either side. **The mock-transport TS fixtures regenerate from these same shapes in B5** so `VITE_TRANSPORT=mock` renders the same product as `http`.

**Tests (§34 + review findings):** disconnect-survival; exact replay from Last-Event-ID; double-send 409; **`done(awaiting_input)` releases the lock / answering POST not 409'd**; cancel → partial persisted + `done(cancelled)`; cancel-after-done no-op; cancel-on-parked unparks; cancel-before-prose skips the append; watchdog; fall-off → `error`; eviction → 204; **history rewrite** (offset slice, registry restore, ghost-exchange-free transcript, parked-edit, 422 on pre-MVP2 targets); shutdown drain; parked-interrupt durability + mid-stream reconnect.

**Gate:** all green incl. FE vitest; personally verified live (kill tab → curl reattach replays; cancel mid-stream → partial transcript with receipts). **Review loop → commit.**

---

### B3 — Auth & identity

(§28; ADR 0021.) `security-reviewer` + `database-reviewer` mandatory; the asyncpg adapter is auth-critical code.

- **Migration `0004_users.sql` (+ rollback):** `counselle.users` (fastapi-users base; `hashed_password` nullable; + `name`, `settings jsonb`, `created_at`), `counselle.oauth_accounts` (FK CASCADE), `sessions.user_id` FK CASCADE. **Dev purge: `DELETE … WHERE user_id IS NULL` + the matching checkpoint-row sweep** (checkpoint tables have no FK — without the sweep the purge strands orphans forever; the session-TTL job is still parked). Named consequence: MVP1 eval sessions are purged (they're re-runnable; the runner will keep minting NULL-user rows in dev — accepted, dev-only).
- **`api/auth.py` + `api/users_db.py`:** fastapi-users wiring — `UserManager` (name on register; stock 400 on existing email = accepted, named existence leak; forgot/reset 202 always; reset on OAuth-only sets a password — intended, named); cookie JWT (`httpOnly`, `Secure` Settings-gated, `SameSite=Lax`, **TTL locked: 30 days, no refresh**; logout = cookie deletion; ADR 0021's TTL note amended at B0); routers under `/v1/auth/*`: register, login (**form-encoded — the named JSON-only exemption**), logout, forgot/reset, **the users router** (email/password change — story 49's Account rows), Google OAuth (`associate_by_email=True`, the spiked callback wrapper).
- **Principal & ownership:** validated `current_user` dependency supersedes the parse-only seam; **`owned_session`** on every `/v1/sessions/*` route — foreign/unknown → 404; route-inventory test. `POST /v1/sessions` + `.../messages` require auth and stamp `user_id` (`create_session` gains it as an **optional kwarg** — `evals/runner.py:364` calls it directly and must keep working).
- **`/v1/me`:** GET (id, name, email, `has_password`, `google_connected`, settings), PATCH (name, settings jsonb), `DELETE /v1/me` (registry-cancel active turns → delete; FK cascade + explicit `adelete_thread` loop), `DELETE /v1/me/chats`.
- **The admin surface goes prod-safe (was unauthenticated by MVP1 design):** `POST /v1/admin/reconcile` — its own docstring says "must add admin auth before exposing to the internet", and B6 is about to do exactly that. Settings-gated off in prod (or superuser-gated) — a named task, since it triggers paid Vertex work. `/v1/health` **stays open** (uptime checks; its supervisor/reconciler detail is acceptable). `/v1/meta/sources` retires with the harness in B5d.
- **CSRF posture:** JSON-only content-type on state-changing routes (login exempted per B0 spike 3).
- **`adapters/email.py`:** `console` arm only + the provider switch.
- **Settings:** Auth + Email groups; `.env.example`. **Budgeted:** the authenticated-client fixture + the ~50-call-site sweep of `tests/api/`.

**Tests:** full flows; wrong password; OAuth-only + password login → 400; reset round-trips; Google callback (mocked); ownership 404 over the inventory; `DELETE /v1/me` cascade incl. active-turn cancel; content-type; cookie flags.

**Gate:** suite green incl. migrated tests; personally verified live (email + Google loops, httpOnly cookie, harness 401s). **Review loop → commit.**

---

### B4 — Chat management, feedback, rate limiting, runtime config

(§29–30, §32.)

- **Chat management:** `GET /v1/sessions?q=&cursor=&limit=` (keyset on `(updated_at, session_id)`; `q` ILIKE; rows incl. `is_generating`). `PATCH {title}` (`title_max_len`); `DELETE` — **registry cancel first** (a live task must not checkpoint after `adelete_thread`), then row + thread.
- **Source-config stickiness gets its server half (PRD story 10 — review found it had none):** the per-message `source_config` (already in the MVP1 body) is **upserted onto the session row on each send**, and the transcript/session read returns it — a mid-chat toggle survives devices and cleared storage; the FE seeds the dropdown from it (B5).
- **Auto-titles:** default title set when the first message arrives (the question, truncated); `on_turn_complete` → fire-and-forget cheap-model titling; failure → default stands; never blocks/retries/raises (deliberate, logged swallow).
- **Feedback:** migration `0005_feedback.sql` (+ rollback) — `(id, user_id FK CASCADE, session_id FK CASCADE, message_id, rating, created_at)`, unique `(user_id, message_id)`. POST upsert / `rating: null` clears; ownership via `owned_session`. **The transcript read joins feedback** (the §0.2 `feedback?` field — thumbs survive reload; without the read path, re-tap-toggles is a lie after F5). Account-deletion feedback-cascade asserted here.
- **Rate limiting:** `api/ratelimit.py` — per-user sliding windows on `POST .../messages` (`turns_per_hour`/`turns_per_day`; 429 + `Retry-After`; clarify answers spend a token — named). **Plus the same 30-line window on `/v1/auth/login` and `/v1/auth/forgot-password`** (keyed by email/IP — password brute-force and reset-spam are otherwise open; review finding, accepted as in-scope). `turn_complete` gains `user_id`.
- **Runtime config:** `GET /v1/config` (authed) serves the §0.2 shape — greeting + `season_note` from `greeting_templates.yaml` keyed by the same `admission_season` machinery the agent uses; `conversation_starters` from `starter_prompts.yaml`; `default_source_config` = the user's preset falling back to Settings defaults.
- **Settings:** Chat group (`model_title`, `title_max_len`), Rate-limit group.

**Tests:** list/search/pagination/ownership; delete cancels-then-removes (checkpoints too, `live_db`); source-config upsert round-trip; title paths; feedback idempotency/toggle/ownership/cascade/**read-path hydration**; 429s (messages + auth) + window expiry; config shape + season (frozen clock).

**Gate:** green; verified by `curl` against a seeded dev DB (the named no-browser window: harness is auth-dead from B3, the SPA wires in B5 — no dev bypass gets added). **Review loop → commit.**

---

### B5 — FE‑7: the frontend goes live

(frontend-plan FE‑7; §31.4.) **Review round 2's central correction lands here: "nothing above Transport changes" was the *design*; the FE-0…FE-6 build bypassed the seam in practice** — ChatContext imports the mock store directly, persists transcripts client-side, never calls `attach`/`transcript`, has no error handling, never sends `source_config`, and six vendored components import `authStore` directly. B5 is therefore **seam-discipline restoration + the swap**, with the explicit task list below (sourced from the seam audit; B0 spike 4's contract is the input). Four committed sub-milestones. `typescript-reviewer` + `security-reviewer`.

#### B5a — HttpTransport + the stream pipeline + identity

- **Dev wiring first (load-bearing, previously unowned):** the Vite dev server proxies `/v1` → `localhost:8000` (preserving same-origin so cookies ride in dev — the ADR 0023 dev-parity posture, wired now); until B5b builds the login UI, the B5a gate authenticates via a curl-minted session cookie (a named ritual, not a dev bypass).
- `HttpTransport`: fetch-streaming SSE parser (`id:`/`event:`/`data:` frames, CRLF, multi-line data, keepalive comments) for POST send and GET attach; **internal Last-Event-ID cursor** (§0.2); `cancel`, `transcript`; `credentials: 'same-origin'`; typed `401/409/429/422` errors. `VITE_TRANSPORT` switch **actually built** (it's a comment today), default `http`; mock kept.
- **Identity adoption (G1, end-to-end):** `MetaData` gains the ids in protocol.ts; the reducer exposes them; **ChatContext stops minting client uuids as canonical** — optimistic echo gets a temp id reconciled to `meta`'s ids when the stream opens; feedback/edit address backend ids only (no more orphan feedback rows / 422 edits after a live turn).
- **ChatContext rewires to the seam:** `transport.transcript()` replaces the localStorage read (today it has zero call sites); **the client-side transcript persistence block is deleted** (the server persists; the post-turn projection re-sources from reducer state + ids); `getChat`/`createChat`/`messagesStore`/`feedbackStore` imports go; new-chat flow awaits `POST /v1/sessions` then sends.
- **Error handling exists for the first time:** `runTurn` catches; a failed send **keeps the composer text** (today `ChatForm` clears before awaiting — reordered) with inline retry; 409 → cancel-then-retry-once; 429 → `Retry-After` message; stream error → the error card (no more fabricated empty "complete" entries from the `finally` block); double-cancel guarded.
- **Gate:** a real dossier turn streams into the real UI (timeline, cards, citations, sources, stop) and the golden fixtures pass through the reducer. Commit.

#### B5b — Real auth + account surface

- **Build the auth client surface, then swap the six vendored import sites** (`LoginForm`, `SocialLoginRender`, `Registration`, `AccountSettings`, `Account`, `DeleteAccount` — ledgered): login/register/logout/forgot/reset → `/v1/auth/*` (login form-encoded), Google → redirect flow, session user = TanStack query on `/v1/me` (cookie is the session); **async + failure states wired** (the mock was sync and infallible — wrong-password/existing-email render now); AuthGate gains the loading state (no flash-to-login while `me` resolves); signup wall keys off the 401.
- Account tab gains the email/password rows story 49 promises (backend capability landed in B3; the FE rows are added in the vendored Account tab, ledgered); Data controls → the real DELETEs.
- **Settings sync designed:** `users.settings = {theme, default_source_config}`; server wins at login, local-optimistic on change (PATCH `/v1/me`), localStorage = offline cache.
- **Gate:** full account loop live (register → Google → settings persist across browsers → delete account). Commit.

#### B5c — Source control, feedback, config, sessions list

- **Source-control wiring (the audit's worst functional break — the toggle is currently fake against a real backend):** `sourceStore` → mapped `source_config` on **every** `sendMessage`; the dropdown seeds from the session's stored config on chat open; per-conversation stickiness via B4's upsert. **Story 17 verified end-to-end: toggle Reddit off → no reddit step can appear.**
- **Feedback:** the hook maps `thumbsUp/Down` ↔ `{rating}`, `undefined` ↔ `null`; **the tag/text collection UI is subtracted** (vendored Feedback popovers collect data the backend doesn't store — reason chips are MVP3; collecting-and-discarding is a dishonest affordance), ledgered; thumbs hydrate from the transcript's `feedback` field.
- **Config:** `/v1/config` consumed async (the three vendored components read an import-time constant today — small rewire + loading state), shape per §0.2.
- **Sessions list:** real list query; **pagination resolved KISS** — `limit=200`, treated as the full list (client-side grouping + search stand; infinite scroll → TODOS.md, named); `is_generating` renders as a small pulsing dot on the convo row (new, ledgered); the sessions query invalidates on turn completion so the cheap-model title appears in-session.
- **Gate:** sidebar, search, rename/delete, source toggles, thumbs — all live and honest. Commit.

#### B5d — Turn orchestration, landing, harness retirement, the smoothness gate

- **Reattach designed and built:** on chat open, `attach()` first (the audit: nothing calls it today) — a `LiveTurn` constructed *from the replayed `meta`* for a turn this tab didn't start; the in-flight user echo merges from the transcript; `stopGenerating` works on an attached turn; `204` → `transcript()`.
- **Edit & regenerate go real (G3):** `replace_message_id` from transcript ids; the local truncate-then-submit path is deleted; Edit hidden on id-less (pre-MVP2 / synthesized-clarify-answer) entries; **EditMessage's silent "Save" (text-mutation-without-re-ask) is removed** — PRD decision 4 gives it no meaning, and post-seam it would be a client-side lie. Send-mid-stream: cancel → await done → send.
- **The clarify answer renders frozen** (the §0.2 `{spec, answer}` — the widget seeds its selection from the persisted answer; today it never shows what was chosen).
- **Dead-air cover (the agent review's D1):** a client-side "Thinking…" shimmer line from send until the first event and between last-step-end and the next event — truthful (the model *is* thinking), and the only thing that bounds Gemini's multi-second first-token gap; keepalives keep the pipe alive but paint nothing.
- The sources **footer filters to the markers cited in that message** (§0.2); cumulative chips untouched.
- **The marketing landing page** (one static file, real dossier screenshot, CTA). **Retire the harness** (+ mount, + `/v1/meta/sources`, + its tests).
- **Gate (personally, in-browser, real backend):** the full loop — signup wall → register → Google → seasonal greeting → dossier turn with real timeline/receipts/cards/citations → clarify round-trip (chip + typed; frozen answer visible after reload) → stop mid-stream → F5 mid-answer reconnects → edit old message → regenerate → source toggles honest → thumbs survive reload → rename/search/delete → settings cross-browser → logout. Every FE‑6 smoothness law at real latency + the mobile sweep (375px, 44pt, keyboard); **thinking density assessed (the §35 dogfooding checkpoint — the summarizer fallback decision happens here on evidence)**. tsc/vitest/build green. **Review loop → commit.**

---

### B6 — Ship: database, container, deployed, smoked

(§33; ADR 0023; prerequisite 0.)

**B6.0 — The database first (everything else depends on a reachable DSN):** provision Postgres 16 (managed or VPS) **co-located with the app**; **pre-create the `vector` extension as admin** (migration 0003 runs `CREATE EXTENSION` as the app role — fails on managed PG; the pre-create is a named DEPLOY.md step, or the first boot crash-loops); `pg_dump`/`pg_restore` the pipeline DB; run `scripts/setup_db.sql` as admin (roles + grants); **verify grants as `counselle_ro`** (the `ALTER DEFAULT PRIVILEGES` trap: objects created by a different admin role are invisible to the agent — silent honesty bug; the post-restore/post-refresh grant-verification query is part of the ritual); set both DSNs. **The refresh story decided and documented:** re-dump vs the pipeline repo pointing at the cloud DB; either way the grant check runs after every refresh.

**The container:** multi-stage `Containerfile` — node stage (`npm ci` with devDeps — the build runs tsc; **no `VITE_ENABLE_LOGGER`**; `VITE_TRANSPORT` defaulted/ARG'd to `http`) → Python stage with `frontend/dist`. **Runtime hygiene (all named, all one-liners that brick a first deploy when missed):** `uv sync --frozen --no-dev` at build, `exec` the venv binaries directly (no `uv run` at runtime — lockfile revalidation + cache surprises); **promote `psycopg2-binary` to main deps** (yoyo's driver — it lives in the dev group today, so `--no-dev` would brick the entrypoint's migration step); tightened `.dockerignore` (`frontend/node_modules`, `harness/`, `tests/`, `docs/`, `plans/`, `evals/report-*`); deps-before-code COPY ordering. `api/main.py`: Settings-gated static serving (landing at `/`, SPA fallback, `/v1` passthrough). **First-boot reconcile moves to the background task** (today the lifespan awaits a full 1,093-field embed before serving — 30–90s cold start vs host health-check grace = kill loop); DEPLOY.md gets the pre-warm ritual (poll `/v1/health` until the reconciler shows the embed done, then announce the URL).

**Entrypoint:** `yoyo apply --batch` (app DSN — Counselle owns `counselle.*` DDL; failure → crash-loop → previous image, works because migrations stay additive) then `exec uvicorn` **with `--forwarded-allow-ips='*'`** (behind the host's TLS terminator, untrusted `X-Forwarded-Proto` means the app thinks it's on `http` → the Google `redirect_uri` generates as `http://` → `redirect_uri_mismatch`; this is *the* flag the first OAuth attempt dies on). A Pydantic `max_length` caps the message body (no other body limit exists anywhere).

**`compose.yaml`** + **`docs/DEPLOY.md`** (registered in CLAUDE.md): **the complete env matrix** — not just the new groups but the MVP1 half a first deploy forgets (`VERTEX_API_KEY`, `GOOGLE_CLOUD_PROJECT`/`LOCATION`, `TAVILY_API_KEY`, model names, `MODEL_PRICES`), the stable JWT secret, cookie flags, `CORS_ORIGINS` **flipped to empty** (ADR 0023's consequence; the default is `localhost:8000` today), DSNs, "use the API key, not an ADC file" note, `SESSION_TTL_DAYS`, pool sizing (`pool_min ≥ 2` against a remote DB).

**Deploy** (host per §2): env set; verify on the real host: SSE un-buffered end-to-end, cookies under TLS, **Google OAuth on the prod domain** (the forwarded-proto proof), migrations ran, `/v1/health` green, **one cold-boot run** (MCP child spawn + first-turn latency on the cold path — FE-6's laws were never measured there).

**The Playwright smoke** (the only E2E): signup → ask a known long dossier question → stream with timeline → **reload triggered on the first `step` event** (deterministic) → sane state → full-fidelity transcript. `frontend/e2e/`; run-by-hand (no-CI decision stands).

**Gate:** the smoke passes against production; a real dossier question answered end-to-end on the public URL, personally. **Review loop (security: headers, cookie flags, no secrets in image, the admin route gated) → commit.**

---

### B7 — Hardening, evals, docs, close-out

- **Evals, honestly re-based:** the "agent didn't change" premise is **false** — B1a ships a prompt delta (narration instruction) and thinking-rerouting changes what `prose` *is* (the runner joins `delta` only). So: **re-run the baseline once after B1 on the routine subset** (running it at B7-time is equivalent — the runner drives `run_turn` directly and B2–B6 never touch its emission path; if the runner is ever moved onto the registry, re-baseline then) and B7 compares like-with-like, per-criterion (not headline accuracy) — otherwise B7 chases ghost "emission bugs" or waves through a real honesty regression as expected drift. The judge input gains the thinking lines; `evals/judge.md` gains the facts-first watch. **New mechanical checks on every question** (no judge needed): no digit-bearing token from tool results appears in `thinking` before it appears in `delta`; **step↔tool-call completeness** (every tool call in the thread has a paired start+end; no orphan starts — catches pairing/closure bugs against real Gemini parallelism that `FunctionModel` can't reproduce); label sanity (no `unitid=`, no unfilled `{…}` templates). One resumed-clarify eval question added (the eval set currently stops at `awaiting_input` — the replay path is never eval-exercised).
- **`evals/export_feedback.py`** lands here.
- **Full verification sweep:** complete pytest incl. live markers; ruff + mypy; tsc + vitest + build; final whole-diff review (`code-reviewer` + `security-reviewer` over `git diff main...HEAD`).
- **Docs:** CLAUDE.md (status, commands incl. frontend + deploy, map + DEPLOY.md), README, TODOS (session-TTL job; sessions-list load-more; thinking-density verdict; checkpoint/turn-record growth watch; scale-out re-backing list), Part II spot-check, PRD-mvp2 status.
- **Archive** `plans/mvp2/` → `plans/archive/mvp2/` (+ as-built deviations note). **Merge** `--no-ff` → `main`.

**Gate = the Definition of Done, item by item.**

---

## 4. Risks & watch-items (execution-level; §35's stand)

| Risk | Mitigation |
|---|---|
| Streamed tool events misbehave (ordering/args) despite verified classes | B0 spike 1 first; ADR 0022's MCP-hook fallback decided; mapper seam-agnostic |
| Thinking threshold misclassifies / narration too sparse | Degrades honestly both ways; FunctionModel pins both sides + response boundaries; the prompt now *instructs* narration; native thought summaries evaluated at B0; density checkpoint at B5d with the summarizer fallback |
| Parallel calls / interrupts strand or mispair steps | `tool_call_id` pairing + terminal closure are named B1a mechanisms with tests; the B7 completeness check catches what mocks can't |
| A failed search gets a green check | Result-shape error detection (Tavily error dicts, RetryPromptPart) is a named B1a mechanism, tested |
| Clarify resume's visible replay reads as a bug | Decided + recorded (G4/ADR 0022): shown as-is, record replaced, same message_id; one resumed-clarify eval |
| Turn record bloats state / parts offsets dangle | Receipts bounded; the every-terminal-path prose invariant (incl. the tool-budget fix and empty-partial skip); TTL knob watches growth |
| Cancel/race/shutdown loses partial prose | Await-propagation-then-write, single-shot terminal, drain-before-close — all tested |
| History rewrite corrupts a thread | Offset written by the appender; one `aupdate_state`; ghost-exchange/parked-edit/422 tests; transcript is the oracle |
| Hung model/MCP wedges a session | Watchdog → error (not `cancelled`); buffer evicted at terminal |
| fastapi-users adapter subtleties (null hash, OAuth callback, form login) | All three on B0 spike 3's checklist; SQLAlchemy fallback contained; security review treats the adapter as auth-critical |
| B2/B3 turn existing suites red | Both budgeted (the two registry-poking tests; the ~50-call-site auth sweep) |
| The FE seam was bypassed in FE-0…6 | B5's task list is the audit's findings, sub-milestone by sub-milestone — identity adoption, ChatContext rewiring, error surfaces, source wiring, feedback hydration, config/auth surfaces |
| Eval baseline shifts read as regressions (or mask one) | Re-baseline after B1; per-criterion diff; mechanical checks carry the honesty load |
| The prod DB doesn't exist / pgvector / grants drift after refresh | Prerequisite 0 + B6.0's ritual (pre-create extension, setup_db.sql, the grant-verification query after every restore/refresh) |
| First deploy bricks on a one-liner | The named cluster: `--forwarded-allow-ips`, psycopg2-binary promotion, `--no-dev`, background first-reconcile, VITE build args, CORS flip, admin route gate |
| Scope creep | §0 non-goals; reviewers flag additions beyond spec + §0.1/§0.2 |

## 5. B0 decisions (spike outcomes, recorded 2026-06-12)

All four gate spikes ran against the live stack (Gemini 2.5 Pro on Vertex, the real MCP toolset, the real graph + Postgres checkpointer). Spike code deleted; these are the outcomes the phases build on. Pinned versions at spike time: pydantic-ai 1.107.0, langgraph 1.2.4, langgraph-checkpoint-postgres 3.1.0, fastapi 0.136.3, asyncpg 0.31.0.

### Spike 1 — emission mechanics (live, two tool-using runs + three clarify rounds)

- **Event ordering confirmed.** Per model response: parts stream as `PartStartEvent`/`PartDeltaEvent`/`PartEndEvent` — **`ToolCallPart`s ride these too**, so the emitter keys steps on `FunctionToolCallEvent`/`FunctionToolResultEvent` only and the delta path matches `TextPart`/`TextPartDelta` only. All call events of a parallel batch arrive in order, then result events as-completed. Parallel batches are real and common (observed: 2×`resolve_school`, then 2×`render_viz`, single turn).
- **The pairing rule stands:** `tool_call_id → step_id` map; durations timed locally (call→result; MCP tools 0.03–0.15s locally). **1.107 gotcha: `FunctionToolResultEvent.result` is deprecated — use `.part`.**
- `ask_student`'s missing result event and interrupt-stranded siblings weren't directly provoked; **terminal closure (B1a) covers both by construction** and the `FunctionModel` tests pin them.
- **Dead air measured:** ~28s before the first event on a tool-using question (no visible activity at all), ~4–6s between tool rounds. With native thoughts on, first visible activity at ~16s. The `thinking` events + B5d shimmer are justified by measurement, not taste.
- **LangGraph mechanic (a) — parked write: VIABLE, with one consequence.** `aupdate_state` on a parked thread succeeds with `as_node=None` and the values stick, **but it empties `snapshot.tasks[*].interrupts`** (while `next` stays `('agent',)`). Crucially (spike 1c): **`Command(resume=…)` still works after the write** — the node re-executes and the resume answer is consumed normally. **Decision:** B1b writes the parked turn record as planned; **parked-detection moves off `tasks[*].interrupts` onto the turn record itself** (last record `status == "awaiting_input"`) — `run_turn`'s current interrupt-based check is replaced in B1b, and B2's registry uses the record too.
- **LangGraph mechanic (b) — unpark: PROVEN.** `aupdate_state(config, {...}, as_node="agent")` empties the interrupts **and** clears `next` (the graph believes the agent node completed); the next plain message then runs a complete fresh turn. This is G5's cancel-on-parked mechanism, exactly as planned.

### Spike 2 — thinking routing (decided)

- **Primary mechanism: the threshold buffer, refined with `PartEndEvent.next_part_kind` as the deterministic flush signal.** Per-response text buffer consumes `TextPart` content from both `PartStartEvent` (the first chunk rides it — confirmed, 244 chars observed) and `PartDeltaEvent`. Flush rules: (1) a `TextPart`'s `PartEndEvent` arrives with `next_part_kind='tool-call'` and the buffer is under the threshold → flush as `thinking`; (2) the buffer crosses the threshold (~240 chars) mid-part → flush as `delta` and stream live thereafter; (3) response end / run end → flush as `delta`. Buffer resets per model response. **Measured latency cost ≈ 0** — Gemini streams 100–250-char chunks, so every flush decision resolves within about one chunk.
- **Edge recorded (accepted):** Gemini emits answer-scaffold text before tool calls — observed a 121-char intro sentence and a 19-char `### SAT Middle 50%` heading immediately before `render_viz` calls. Under-threshold pre-tool text routes to `thinking`; acceptable — viz cards carry their own titles, and the intro reads naturally as a thinking line. The B1a prompt delta (narration instruction) makes pre-tool text *intentional*.
- **Native Gemini thought summaries: ADOPT.** `GoogleModelSettings(google_thinking_config={"include_thoughts": True})` → `ThinkingPart`/`ThinkingPartDelta` stream live (~250-char deltas) carrying real reasoning ("Finding School Identifiers — I'm currently focused on resolving…"), cutting visible dead air from 28s to 16s. B1a maps them to `ev_thinking` (the second feed alongside the rerouted pre-tool text). Facts-first risk carried by B7's digit-check; round-1 thinking precedes any tool results by construction. ThinkingParts flowed through multi-round in-run history cleanly; the cross-turn serialization round-trip gets a B1a test. Settings-gated (`thinking_summaries`, default on).

### Spike 3 — fastapi-users (verdict: the ADR 0021 design is viable as planned; 25/25 spike checks passed)

- **Pinned:** fastapi-users **15.0.5**, httpx-oauth **0.17.0**, pwdlib 0.3.0 (argon2-cffi 25.1.0, bcrypt 5.0.0 fallback w/ auto-upgrade on login), pyjwt 2.13.0, python-multipart 0.0.32. Default hasher **argon2id**. Dependency added to `pyproject.toml` at B0 (it ships with B3).
- **Custom asyncpg `BaseUserDatabase`: VIABLE.** Plain `Generic` base (`from fastapi_users.db import BaseUserDatabase`), 8 async methods: `get(id)`, `get_by_email(email)` (case-insensitive), `get_by_oauth_account(oauth, account_id)`, `create(create_dict)`, `update(user, update_dict)`, `delete(user)`, `add_oauth_account(user, create_dict)`, `update_oauth_account(user, oauth_account, update_dict)`. Observed dicts: password-register create = `{email, hashed_password, name}` (custom schema fields ride through); OAuth create = `{email, hashed_password, is_verified}`; oauth-account dicts = exactly the 6 `counselle.oauth_accounts` columns (`oauth_name, access_token, account_id, account_email, expires_at, refresh_token`). **Plain Python classes satisfy `UserProtocol`** (`id, email, hashed_password, is_active, is_superuser, is_verified` + `oauth_accounts` iterable for OAuth) — no SQLAlchemy, no pydantic required; `hashed_password: str | None` accepted structurally.
- **Cookie transport proven:** `CookieTransport(cookie_max_age=30d, cookie_secure=<settings>, cookie_httponly=True, cookie_samesite="lax")` + `JWTStrategy(lifetime_seconds=30d)`; login 204 + Set-Cookie; cookie authenticates; logout 204 + cookie cleared; no cookie → 401 (matches the SPA's signup-wall trigger).
- **Login content-type proven:** JSON body → 422; form body → 204. The exemption stands.
- **Null-hash guard recipe:** override `UserManager.authenticate` — unknown email → dummy `password_helper.hash()` + return None; `hashed_password is None` → dummy hash + return None; else `verify_and_update` (persisting upgrades). Stock router maps None → **400 LOGIN_BAD_CREDENTIALS**. Timing-constant across missing/OAuth-only/wrong-password.
- **OAuth callback → cookie → 302 recipe:** subclass `CookieTransport`, override `get_login_response` to return `RedirectResponse(302, SPA root)` passed through `self._set_login_cookie(resp, token)`; mount it as a **second `AuthenticationBackend`** (same `JWTStrategy`/secret) passed to `get_oauth_router(..., associate_by_email=True)`. Proven: 302 + Location + httpOnly cookie; the user authenticates thereafter.
- **Gotchas B3 must honor:** (1) **stock `oauth_callback` GENERATES a password hash for new OAuth users** — `hashed_password IS NULL` ⇒ OAuth-only must be forced (cleanest: override `UserManager.oauth_callback` to null it; adapter-level also works); the null-hash guard is safe either way. (2) The OAuth flow now carries a **mandatory CSRF cookie** (`/authorize` sets it, `/callback` requires it, else 400 OAUTH_INVALID_STATE; secure=True default — fine over HTTPS, don't strip at the proxy). (3) **JWT secret ≥ 32 bytes** (pyjwt 2.13 warns below). (4) `name` rides a custom `UserCreate` schema into `create_dict` — confirmed; `on_after_register` receives the `Request`.

### Spike 4 — the wire contract (final)

The full field-by-field contract lives in **`plans/mvp2/wire-contract.md`** — SSE events incl. the `step`/`thinking` shapes (protocol.ts already declares `StepData`/`ThinkingData`/`StepRecord`; the backend conforms to them), the transcript wire shape, `/v1/config`, the `source_config` mapper (`frontend/src/api/source-config.ts`, new B5c file), the cumulative-sources + footer-filter rules, the per-turn Last-Event-ID cursor, the receipt format (the FE's `deriveReceipt` activity line is the pinned contract — implemented server-side at B1b), the exact B2 protocol.ts edit list, and the B5 file-by-file task inputs. Nine conflicts/ambiguities found and **resolved in the contract** (§9) — the headline one: **C1, a live FE honesty bug** — protocol.ts treats `Citation.tier` as a union of *source names*, so against the real backend every community source would render as official; B2 fixes the type, B5 fixes the components (`isCommunityTier`, `tierLabel`, fallback tier), and the honesty tests re-pin.

## 6. What done looks like

A student opens the public URL, reads one honest page, signs up in seconds (or taps Google), asks "give me the full profile on NYU," watches the agent actually work — every step labeled with the school's name, every claim chipped, every number sourced and dated, every failed search marked as failed — answers a clarifying question by tapping or typing and can still see what she chose tomorrow, refreshes mid-answer and loses nothing, edits her question and the transcript stays truthful, toggles Reddit off and it is *visibly* off, comes back tomorrow to find the chat titled and waiting, and never once gets lied to. One container, one hosted Postgres, deployed, evaled, documented.
