# The FE↔BE Wire Contract (B0 spike 4 — final)

> Produced by B0 gate-spike 4 (2026-06-12). This is the field-by-field contract between the backend and `frontend/src/api/protocol.ts`. **B1b builds §1–§2 + §5–§7 backend-side, B2 applies §8a + the golden fixtures, B4 builds §3–§4's server half, B5 consumes per §8b. Nothing here re-opens at those phases.** Conflicts found during the spike are resolved in §9 (resolutions recorded, not open questions).
>
> Governing rule (ship-plan §0.2): protocol.ts is the consumer contract — the backend serves its field names and nesting. Everything below is either EXISTING (declared on both sides) or NEW with a named owner.

---

## 1. SSE events

Envelope (every event, both sides agree today): `{ v: 1, type: <string>, data: <object> }`. SSE framing per `api/sse.py`: `id: <seq>` / `event: <type>` / `data: <compact-json>` frames; keepalive `: ping` comments from sse-starlette. The `data:` JSON is the full envelope (v/type/data), and `event:` duplicates the type. `ProtocolEvent` stays seq-less (§6).

### 1.1 `meta` — first event of every stream

| wire field | type | req | producer | consumer | status |
|---|---|---|---|---|---|
| `trace_id` | `string` | required | `domain/events.py MetaData` | `turn-reducer.ts` (`state.meta`), harness | EXISTING |
| `session_id` | `string` | required | same | same | EXISTING |
| `model` | `string` | required | same | same | EXISTING |
| `message_id` | `string` (UUID) | required (MVP2) | `ev_meta` gains it — **B1a/B1b** (G1: the assistant message id, minted at turn start; a clarify resume re-emits the parked turn's id) | B5a ChatContext reconciles optimistic temp id → this | **NEW** — B2 protocol.ts edit |
| `user_message_id` | `string` (UUID) | required (MVP2) | same (G1) | B5a ChatContext: canonical id of the just-sent user bubble; edit addressing | **NEW** — B2 protocol.ts edit |
| `response_mode` | `'quick' \| 'think'` | optional additive; required for current turns | `ev_meta` receives the server-resolved execution mode (ADR 0034) | FE snapshots immutable execution mode; old clients ignore it | **NEW** — quick/think delta |

### 1.2 `narration`

`data = { text: string }`. This is the agent-visible prose/status stream: the visible run narration and inline status updates the UI shows while the turn is still alive. Consumer: reducer `narration[]` + interleaved `timeline`.

### 1.3 `delta`

| field | type | req | producer | consumer |
|---|---|---|---|---|
| `text` | `string` | required | `DeltaData` (final-answer prose only; narration and native thoughts use their own events) | `turn-reducer.ts appendDelta` | EXISTING |

### 1.4 `viz`

`data` **is** the `RenderSpec` directly, no wrapper (`ev_viz` dumps the spec): `{ v: number, type: 'stat_block'|'comparison_table'|'score_band', title: string, schools: SchoolRef[], rows: VizRow[], band?: ScoreBand|null }` with `SchoolRef = {unitid: number, name: string}`, `VizRow = {label: string, cells: CitationEnvelope[]}`, `ScoreBand = {test: 'sat'|'act'|'both'}`. `CitationEnvelope = {v, field, label, display, raw?, available, unit?, citation}`. Producer `domain/specs.py RenderSpec`; consumer `turn-reducer.ts` → `components/cards/*`. The backend stages successful render specs during work, dedupes equivalent ones, and emits the batch once when final-answer mode begins; within that batch first-seen tool order is preserved. No placeholder anchoring. EXISTING, byte-identical both sides. (Tier inside `citation` — see conflict C1.)

### 1.5 `clarify`

`data` **is** the `ClarifySpec` directly: `{ v: number, question: string, header: string, multi_select: boolean, options: {label: string, hint: string}[] }` (2–4 options, backend-validated). Producer `domain/specs.py`; consumer `turn-reducer.ts` → `ClarifyWidget`. EXISTING. The stream event stays the bare spec — the `{spec, answer}` pair exists **only on transcript entries** (§2).

### 1.6 `sources`

`data = { sources: SourceEntry[] }`, `SourceEntry = { index: number, citation: Citation, label: string }`, `Citation = { source: 'ipeds'|'scorecard'|'cds'|'web'|'edu'|'reddit', tier: 'official'|'community', vintage: string, caveat?: string|null, raw_table?: string|null, url?: string|null }`. Producer `app/run_turn.py` (registry verbatim, end of turn); consumer `turn-reducer.ts` (replace semantics — correct, since the payload is the cumulative registry, §5) → `SourcesContext`/`CitationRef`/`SourcesFooter`. EXISTING. **Note the Citation.tier conflict — C1.**

### 1.7 `usage`

| field | type | req | producer | consumer |
|---|---|---|---|---|
| `input_tokens` | `number` | required | `UsageData` + `api/usage.py enrich_usage_event` | reducer → token line | EXISTING |
| `output_tokens` | `number` | required | same | same | EXISTING |
| `est_cost_usd` | `number \| null` | optional | enrichment | same | EXISTING |
| `tool_calls` | `number` | required | same | same | EXISTING |

### 1.8 `step` — NEW event (B1a)

FE already declares the full shape in protocol.ts (`StepData`/`StepKind`/`StepTier`/`StepDetail`/`ToolUi`) — **backend B1a must serve exactly these names** (the new `domain/events.py` types are the sanctioned §26 carve-out; mapper in `app/steps.py` + `config/assets/step_labels.yaml`):

| field | type | req | notes |
|---|---|---|---|
| `step_id` | `string` | required | unique within the turn; pairs start/end — **keyed by `tool_call_id`** (parallel tool calls: results arrive as-completed) |
| `status` | `'start' \| 'end' \| 'error'` | required | |
| `kind` | `'db_tool' \| 'sql' \| 'web_search' \| 'edu_search' \| 'reddit_search' \| 'viz' \| 'skill' \| 'research' \| 'write_plan' \| 'workspace'` | required | `research` reserved; unknown tool → generic default row, never absent |
| `label` | `string` | required | pre-built server-side from `step_labels.yaml` |
| `tier` | `'official' \| 'community' \| null` | required | drives the icon/color grammar |
| `detail` | `StepDetail \| null` | required (null on start) | `{ query?, domains?, result_count?, duration_ms?, tool?, field_keys?, row_count?, viz_type?, schools? }` — all optional, kind-specific; never DSNs/credentials. `sql` kind: the statement rides `detail.query` (radical transparency, decided in B1a) |
| `ui` | `ToolUi \| null` | optional | rendered step widget payload, replayed as-is; the backend treats it as display metadata, not logic |

Consumers: `turn-reducer.ts mergeStep` (merge by `step_id`), `components/timeline/*`. `ask_student`'s call event is excluded (its `interrupt()` means no result event ever pairs).

### 1.9 `thinking` — NEW event (B1a)

`data = { text: string }` — native model thought summaries when the provider emits them. This is distinct from `narration`: narration is visible assistant prose/status; thinking is the model's own thought stream. Consumer: reducer `thinking[]` + interleaved `timeline`.

### 1.10 `user_message` — NEW event (B2)

`data = { text: string, user_message_id: string, injected: boolean }`. This is the mid-run steering event: the backend emits it immediately when `/steer` receives text; `injected:false` is the immediate ack and may later be upgraded/replayed as `true` with the same id, while a terminal leftover `false` becomes the client-owned next normal turn and is not persisted in settled record segments.

### 1.11 `done`

`data = { status: 'complete' | 'awaiting_input' | 'cancelled' }`. FE `DoneStatus` already includes `'cancelled'`; backend `DoneData` Literal is `complete|awaiting_input` today — **backend adds `'cancelled'` (B1a domain delta, used from B2; G5)**. No protocol.ts edit needed. FE maps any unknown → `awaiting_input` (`doneStatusToTurnStatus`) — the documented degrade. G5 semantics: cancel active → single-shot `done(cancelled)`; watchdog timeout → `error`, never `done(cancelled)`.

### 1.12 `error`

`data = { message: string, trace_id: string, code?: string }`. Terminal. `code`
is additive; `model_unavailable` is reserved for provider-capacity/not-found
failures where mode-aware recovery is safe. EXISTING clients keep using
`message`.

### 1.13 `POST /v1/sessions/{id}/steer`

Request body: `{ text: string }` (same auth + ownership rules as `POST /v1/sessions/{id}/messages`). Active steerable turn → `202 { status: "queued", user_message_id }` and a `user_message` event to all attached consumers; idle/no steerable run → `409 { status: "idle" }`. The emitted `user_message` is an immediate ack (`injected:false`) that may later be upgraded/replayed as `true` with the same id; if the run ends first, the leftover `false` is client-owned for the next normal turn and is not persisted in settled record segments.

### 1.14 Response-mode request delta

The quick/think response-mode work is additive within protocol v1 (ADR 0034).

- `POST /v1/sessions` accepts optional `{ response_mode?: 'quick'|'think' }`
  and returns `{ session_id, source_config, response_mode }`. Omitted defaults
  to `quick`; disabled Think returns a user-safe error before any row is
  created.
- `POST /v1/sessions/{id}/messages` accepts optional
  `{ response_mode?: 'quick'|'think' }` for normal turns. Omitted inherits the
  session's sticky mode; clarification answers inherit the parked turn's
  historical mode; regenerate preserves the target turn's execution mode.
- Clients never send model ids, thinking levels, or provider thought flags.
  The server owns mode-to-model mapping and persists the exact model used.

---

## 2. Transcript wire shape — `GET /v1/sessions/{id}`

Response envelope (existing route, B1b rewrites `_extract_transcript`): `{ session_id: string, title: string|null, created_at: string|null, source_config: object|null (backend wire shape, §4), response_mode: 'quick'|'think' (sticky next-turn preference), transcript: TranscriptEntry[] }`. B4 adds the per-send `source_config` upsert so this field is the dropdown seed. The quick/think delta adds `response_mode` for the chat's sticky next-turn preference; malformed/unknown historical values degrade to Quick in current clients.

### 2.1 User entry

| wire field | type | req | protocol.ts today | B2 edit? |
|---|---|---|---|---|
| `role` | `'user'` | required | declared | no |
| `text` | `string` | required | declared | no |
| `ts` | `string \| null` | required | declared | no |
| `message_id` | `string` | optional (absent on pre-MVP2 turns; = G1 `user_message_id` — **the wire name is `message_id`**, per §0.2) | declared `message_id?: string` | no |
| `synthesized` | `boolean` | optional (present+`true` only on clarify-answer bubbles synthesized from the turn record, G4; FE hides Edit on it; G3 returns 422 for it) | **missing** | **yes — B2: `synthesized?: boolean;` on `TranscriptUserEntry`** |

### 2.2 Assistant entry

| wire field | type | req | protocol.ts today | B2 edit? |
|---|---|---|---|---|
| `role` | `'assistant'` | required | declared | no |
| `text` | `string` | required — **kept** (concatenated prose; harness/dumb clients read it until B5d) | declared | no |
| `ts` | `string \| null` | required | declared | no |
| `message_id` | `string` | optional (absent pre-MVP2; G1 assistant id; resume reuses the parked id) | declared | no |
| `parts` | `({type:'text', text: string} \| {type:'viz', spec: RenderSpec})[]` | optional (absent pre-MVP2 → FE falls back to `[{type:'text', text}]` — already implemented in `transcriptEntryToEvents`) | declared (`AssistantContentPart`) | no |
| `segments` | `TranscriptSegment[]` | optional — the whole-run replay surface; includes `narration`, `thinking`, `kind: "user"` steering segments, tools, `delta`, and viz beats in stream order | declared | no |
| `step_record` | `{ steps: StepData[], narration?: string[], thinking: string[], receipt: string }` | optional (absent pre-MVP2) | declared (`StepRecord`) | no |
| `sources` | `SourceEntry[]` | optional — the **cumulative** registry snapshot at that turn's end (§5) | declared | no |
| `usage` | `UsageData` | optional | declared | no |
| `response_mode` | `'quick' \| 'think' \| string` | optional for legacy; current entries include it | **added after B5** | quick/think delta: immutable historical execution mode; unknown historical modes render safely and cannot be silently regenerated as Quick |
| `model` | `string` | optional for legacy; current entries include it | **added after B5** | quick/think delta: exact resolved model setting used for this assistant turn |
| `status` | `'complete' \| 'awaiting_input' \| 'cancelled' \| 'error'` | required on MVP2 entries; optional in the type (pre-MVP2 entries omit → FE defaults `'complete'`) | declared as `DoneStatus \| 'error'` — exact same literal set | no |
| `error` | `{ message: string, trace_id: string, code?: string }` | optional — present iff `status === 'error'` (the ErrorData the student saw live, trace_id included; `model_unavailable` can persist here too) | declared | quick/think delta adds optional `code` |
| `clarify` | `{ spec: ClarifySpec, answer: string \| null }` | optional — present on any turn that asked; `answer: null` = unanswered/unparked-frozen; non-null = the resume text (the same string the synthesized user bubble carries) | declared as **`clarify?: ClarifySpec`** | **yes — B2: `clarify?: { spec: ClarifySpec; answer: string \| null };`** (breaking for the mock fixtures — they regenerate in B5 from the golden JSON) |
| `feedback` | `{ rating: 'up' \| 'down' }` | optional — the **caller's** stored rating, joined by B4's transcript read | **missing** | **yes — B2: `feedback?: { rating: 'up' \| 'down' };`** (FE maps to `thumbsUp`/`thumbsDown` at the ChatContext projection, mirroring the existing `feedbackOf` seam) |

**Pre-MVP2 prose-only fallback shape (pinned):** `{ role, text, ts }` — no `message_id`, no `parts`, no `step_record`, no `status`. The FE path already handles it; B1b's fixture test pins it backend-side.

**Producer note:** the turn record (G2) is server-internal (incl. `messages_offset` — never on the wire); the transcript read serializes it into exactly §2.2. The `receipt` string is computed backend-side at record-write time using the format pinned in §7 (so persisted receipts equal what the FE derived live).

---

## 3. `/v1/config` shape

What the shipped FE consumes today comes from `frontend/src/api/chat/config.ts`
(`resolveComposerConfig`) and the composer/session routes. The footer remains an
FE constant; `/v1/config` serves only runtime client capabilities and editorial
copy.

**Pinned response shape** (`GET /v1/config`, authed, B4):

```ts
type AppConfigResponse = {
  greeting: string;                        // greeting_templates.yaml keyed by admission_season
  season_note: string | null;              // null/'' → Landing hides the line
  conversation_starters: string[];         // starter_prompts.yaml
  default_source_config: SourceConfigWire; // backend names — §4; the user's preset falling back to Settings defaults
  skills: SkillCatalogEntry[];             // public user-invokable skills
  max_selected_skills: number;             // 0 disables the skill picker
  current_admissions_cycle_year: number;   // shared date context
  default_response_mode: 'quick';          // server default, always advertised
  response_modes: ResponseModeOption[];    // server-owned mode capability list
};

type SkillCatalogEntry = {
  name: string;
  display_name: string;
  description: string;
};

type ResponseModeOption = {
  id: 'quick' | 'think';
  model: string;
  model_display_name: string;
  preview: boolean;
};
```

B5c consumes it async (the three vendored components rewire from the import-time constant + loading state); `default_source_config` runs through the §4 mapper before seeding `sourceStore` defaults.

`thinking_stream` is not part of `/v1/config`; it is a server-side runtime setting that only controls whether native Gemini thought summaries are requested/emitted for Think. Disabled modes are omitted from `response_modes`; clients render only this list.

---

## 4. `source_config` mapping table

**Wire shape (backend names everywhere on the wire — `domain/specs.py SourceConfig`):**

```ts
type SourceConfigWire = {
  web: boolean;
  edu: boolean;
  reddit: boolean;
  reddit_subreddits: string[] | null;  // bare keys, no 'r/' — null = the full menu
};
```

**FE store shape (`api/mock/sourceStore.ts SourceConfig`):** `{ webSearch: boolean; eduSources: boolean; reddit: boolean; selectedSubreddits: ('r/…')[] }`.

| direction | rule |
|---|---|
| `web` ↔ `webSearch` | identity |
| `edu` ↔ `eduSources` | identity |
| `reddit` ↔ `reddit` | identity |
| BE→FE | `selectedSubreddits = (reddit_subreddits ?? FULL_MENU).map(s => 'r/' + s)` |
| FE→BE | `reddit_subreddits = setEquals(selected, FULL_MENU) ? null : selectedSubreddits.map(s => s.replace(/^r\//, ''))` |

**Where it lives:** the transport boundary — one named pure module `frontend/src/api/source-config.ts` (B5c, new file), used by (a) `sendMessage` body construction (every send carries `source_config` — the wire shape, so `SendMessageBody.source_config` tightens from `Record<string, unknown>` to `SourceConfigWire`), (b) the `/v1/config` `default_source_config` read, (c) the session-read seed of the dropdown. Nothing above the seam ever sees bare keys; nothing on the wire ever sees `webSearch`.

**`FULL_MENU`:** the FE constant is re-derived from `config/assets/subreddit_menu.yaml`'s concrete entries (`ApplyingToCollege, chanceme, financialaid, premed, csMajors`; the `{school}` template row is agent-internal and excluded from the toggle UI) — see C3.

---

## 5. Sources / citations rule

**Registry indexes are global + stable per session — confirmed in source.** `app/sources.py SourceRegistry` is rebuilt from `state.source_registry` at each node execution and dumped back; indexes are 1-based, append-only (`last.index + 1`), deduped by `(source, url, vintage, raw_table)` with first-label-wins. The registry rides graph state across turns, so a marker `[7]` minted in turn 1 means the same source in turn 5. `run_turn.py` emits `ev_sources` from the **full** final-state registry (fallback: last in-stream dump) — i.e. the event payload is already cumulative.

**The cumulative-sources rule (pinned):** every `sources` event and every transcript entry's `sources` array carries the session-cumulative registry as of that turn's end. The reducer's replace-on-`sources` semantics are therefore correct unchanged. Inline `CitationRef` chips resolve `[n]` against this list by `index` — chips in old messages never break.

**The FE footer-filter rule (pinned, B5d):** `SourcesFooter` for a message shows `sources.filter(s => citedIndexes.has(s.index))` where `citedIndexes` = the union of marker indexes matched in **that message's `parts` text parts** (and the live equivalent: the turn's markdown blocks) using the same grammar `remarkCitations.ts` already uses: `/\[(\d{1,2})\]/g`. Viz cells need no scan — cards carry their own per-cell `citation` popovers and contribute nothing to the prose footer. Cumulative chips untouched; footers never list a source the message didn't cite. (Regex digit-cap caveat: C5.)

---

## 6. Last-Event-ID

**Confirmed in `api/sse.py`:** every frame carries `id: <seq>`, `seq` = monotonically increasing integer **starting at 0, per stream/turn** (the route's generator counts locally; B2's turn registry moves the counter onto the per-turn ring buffer — same semantics: unique within a stream, not globally).

**Transport-internal cursor rule (pinned):** `ProtocolEvent` stays seq-less — components never see ids. `HttpTransport` (B5a) records the last `id:` value it parsed for the active turn; on reconnect it calls `GET /v1/sessions/{id}/stream` with header `Last-Event-ID: <last-seen-seq>`; the server replays buffered events with `seq > last`, then continues live. The cursor **resets at each terminal event** (`done`/`error`) and on a new `sendMessage` (seq restarts per turn). `attach(sessionId, lastEventId?)`'s caller-side param is satisfied by this bookkeeping — callers pass nothing. `204 No Content` from `/stream` → transport signals no-active-turn → ChatContext falls back to `transcript()`. (MockTransport's `from = Number(lastEventId) + 1` already matches the seq-index semantics.)

**Replay contract for attach (FE-ATTACH-CURSOR, no wire-version bump):** `GET /v1/sessions/{id}/stream` with **no** `Last-Event-ID` ⇒ the server **full-replays from seq 0**, then continues live; with a `Last-Event-ID` ⇒ **tail-only** (events with `seq > cursor`), then continues live. Full replay is the safe default — it never loses the already-streamed prefix. To make reload-resume actually work, `HttpTransport` persists the per-turn cursor in **`sessionStorage`** (`counselle:cursor:<id>`, per-tab, ephemeral, cleared at each terminal event and on `sendMessage`) so a hard refresh re-threads the tail instead of replaying the whole turn. A brand-new tab that never streamed this turn has no cursor and therefore gets the full replay; that reduces cleanly because `attachTurn` reduces into a fresh turn state (no prose doubling). If Phase 1's server-side Last-Event-ID work (BC-06) resolves the contract differently, reconcile this note with it.

---

## 7. The receipt string

The receipt format is pinned to the FE's `deriveReceipt` (`turn-reducer.ts`), and B1b implements it server-side so persisted receipts match the live-derived line:

- Segments joined by `' · '`, in this fixed order, each omitted when its count is 0:
  1. `${n} database lookup[s]` — n = count(kind `db_tool`) + count(`sql`)
  2. `${n} web search[es]` — n = count(`web_search`) + count(`edu_search`)
  3. `${n} Reddit search[es]` — n = count(`reddit_search`)
  4. `${n} visualization[s]` — n = count(`viz`)
  5. `${n} step[s]` — n = remaining steps (`skill`, `research`, unknown)
- Pluralization: bare English `s`/`es` exactly as coded (`1 database lookup`, `2 web searches`, `1 Reddit search`, `3 visualizations`, `1 step`).
- Empty string when the turn has zero steps **and** zero thinking lines.
- Example: `"3 database lookups · 1 web search · 1 visualization"`.

Counting unit: one **step** (one `step_id`), regardless of start/end/error status. (§0.2's parenthetical "formatted sources-line string" was loose phrasing — C2.)

---

## 8a. The B2 protocol.ts edit list (exact additive diffs)

1. **`MetaData`** — add two fields:
   ```ts
   message_id: string;       // G1: the assistant message's id
   user_message_id: string;  // G1: the id minted for the user message that started this turn
   ```
2. **`TranscriptUserEntry`** — add `synthesized?: boolean;` (G4 clarify-answer bubble — never an edit target).
3. **`TranscriptAssistantEntry.clarify`** — change (the one non-purely-additive edit; mock fixtures regenerate in B5): `clarify?: { spec: ClarifySpec; answer: string | null };`
4. **`TranscriptAssistantEntry`** — add `feedback?: { rating: 'up' | 'down' };`
5. **`Tier`** — correct to the backend truth (C1; today's union is wrong, not merely loose):
   ```ts
   export type Tier = 'official' | 'community';
   export type SourceName = 'ipeds' | 'scorecard' | 'cds' | 'web' | 'edu' | 'reddit';
   // Citation.source: SourceName (currently `string`)
   ```

No edits needed for: `StepData`/`StepKind`/`StepTier`/`StepDetail`/`ToolUi`/`ThinkingData`/`UserMessageData` (already declared, backend conforms to them), `DoneStatus` (already has `cancelled`), `status`/`error`/`message_id`/`ts`/`parts`/`segments`/`step_record`/`sources`/`usage` on entries (already declared and conformant).

Backend mirror edits (B1a/B1b/B2, the checklist): `EventType` gains `"narration" | "step" | "thinking" | "user_message"`; `NarrationData`/`StepData`/`ThinkingData`/`UserMessageData` models + `ev_narration`/`ev_step`/`ev_thinking`/`ev_user_message`; `MetaData` + `ev_meta` gain the two ids; `DoneData.status` gains `"cancelled"`; `MessageBody` gains `replace_message_id: str | None` (G3); the transcript read serializes §2, including replayable `segments[]`.

## 8b. B5 FE task-list inputs (files that must change to consume this contract)

- `src/api/http-transport.ts` (NEW) — SSE parser, internal Last-Event-ID cursor (§6), `cancel`, `transcript`, typed 401/409/429/422 errors, `credentials: 'same-origin'`.
- `src/api/transport.ts` — `SendMessageBody.source_config: SourceConfigWire`; add `replace_message_id?: string` (G3); `VITE_TRANSPORT` switch built for real; `POST /steer` remains the ordinary live-send path for mid-run steering.
- `src/api/source-config.ts` (NEW) — the §4 mapper, both directions.
- `src/api/turn-reducer.ts` — expose `meta`'s ids; carry the clarify **answer** in view-state; `transcriptEntryToEvents` reads `clarify.spec` (+ threads `answer` outside the event replay); default `status` for pre-MVP2 entries unchanged; `narration` and `thinking` stay separate in replay.
- `src/app/ChatContext.tsx` — stop minting canonical client UUIDs (reconcile temp ids to `meta.message_id`/`user_message_id`); delete localStorage transcript persistence + `messagesStore`/`feedbackStore`/`getChat`/`createChat` imports; `transport.transcript()` + `attach()` on chat open; edit/regenerate via `replace_message_id` (Edit hidden on id-less/`synthesized` entries); error handling (409/429/stream-error); feedback hydrated from the entry's `feedback` (`up`→`thumbsUp`); seed dropdown from the session's stored `source_config`.
- `src/api/hooks.ts` — real `GET /v1/sessions` (map `session_id`/`updated_at`/`created_at`/`is_generating` → `ChatSummary` camelCase), rename/delete/create; feedback mutation → `POST .../messages/{id}/feedback {rating: 'up'|'down'|null}` (tag/text UI subtracted per B5c).
- `src/api/types.ts` — `ChatSummary` gains `isGenerating?: boolean`.
- `src/api/mock/*` — fixtures regenerated from the B2 golden JSON (incl. `clarify {spec, answer}` entries, meta ids); `sourceStore` keeps FE shape, gains the wire mapper call sites; `messagesStore`/`feedbackStore` retire from the live path.
- `src/components/clarify/ClarifyWidget.tsx` — gains `answer?: string | null`; frozen widget seeds its selection from it.
- `src/components/citations/TierChip.tsx` (+ its call sites in `CitationRef`, `SourcesFooter`, cards) — C1 fix: `isCommunityTier = tier === 'community'`; `tierLabel` keys on `citation.source`; `CitationRef`'s pre-sources fallback tier becomes `'official'`.
- `src/components/citations/SourcesFooter.tsx` — the §5 footer filter (cited-marker set from the message's text parts).
- `vendor/librechat/.../Landing.tsx`, `ConversationStarters.tsx` — async `/v1/config` + loading state. `Footer.tsx` — no change (the footer constant moves out of the mock-fixtures file into an FE constants module).
- `src/components/source-control/SourceDropdown.tsx`, `DefaultSources.tsx` — `FULL_MENU` re-derived from the backend menu (C3); seed from session config.
- Six vendored auth import sites + `src/app/auth.ts`/`authStore` — B5b, real `/v1/auth/*` + `/v1/me` (on the seam-audit ledger).

---

## 9. Conflicts / ambiguities — resolutions (recorded at B0)

- **C1 — `Citation.tier` (real conflict, resolved: FE adapts).** Backend `domain/envelope.py`: `tier: Literal["official","community"]`, `source: Literal["ipeds","scorecard","cds","web","edu","reddit"]` — MVP1-shipped, already on the wire. protocol.ts declares `Tier` as a union of *source names*, the mock fixtures populate `tier` with source names, `isCommunityTier` tests `tier === 'reddit'`, and `tierLabel` maps source names. **Against the real backend, every community source renders as official and every chip label breaks** — an honesty-surface bug. The consumer-contract rule covers names the backend doesn't serve yet; here the backend already serves this shape, so the FE adapts: B2 fixes the `Tier` type (§8a item 5), B5 fixes the components. The honesty tests re-pin against the corrected semantics.
- **C2 — receipt phrasing (resolved).** The `deriveReceipt` activity format (§7) is the receipt; ship-plan §0.2's "sources-line" parenthetical is loose wording.
- **C3 — subreddit menu drift (resolved, KISS).** FE `SUBREDDITS` constant = `r/ApplyingToCollege, r/chanceme, r/IntltoUSA`; backend menu = `ApplyingToCollege, chanceme, financialaid, premed, csMajors` + `{school}`. The FE constant is corrected in B5c to the yaml's concrete entries (`{school}` excluded — agent-internal); the menu is **not** added to `/v1/config` (revisit only if it starts churning).
- **C4 — feedback payload width (resolved by the plan).** Wire = `{rating: 'up'|'down'}`, clear = `{rating: null}`; FE↔wire mapping `thumbsUp↔up` lives in the hooks layer; tag/text UI subtracted in B5c.
- **C5 — marker regex digit cap (resolved: widen).** `remarkCitations.ts` matches `\[(\d{1,2})\]` — markers ≥ `[100]` are possible (session-cumulative registry). B5 widens to `\d{1,3}` (one character, named B5d task alongside the footer filter).
- **C6 — "feedback-anchorable" synthesized bubble (reading pinned).** Feedback keys on the **assistant** `message_id`; the synthesized clarify-answer bubble is *addressable* (carries `user_message_id`) but gets no feedback UI — B1b/B5 must not build user-bubble feedback from G4's "first-class" sentence.
- **A1 — transcript `status` presence (pinned).** Required on every MVP2-written entry, omitted only on pre-MVP2 fallback entries (FE default `'complete'` stands). B1b's fixture test asserts presence on MVP2 turns.
- **A2 — `seq` resets per turn (pinned).** Per-stream uniqueness only; the transport cursor is per-turn and cleared on terminal events (§6) so B5a never carries a stale cursor into the next turn's `attach`.
