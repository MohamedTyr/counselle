# Quick / Think Response Mode

Status: **shipped; graduated to specs on 2026-07-23**

This plan adds a per-turn response-mode selector to both Counselle composers:

- **Quick** uses `google-vertex:gemini-3.5-flash` with Gemini thinking level
  `MINIMAL` and provider thought summaries disabled.
- **Think** uses `google-vertex:gemini-3.1-pro-preview` with Gemini thinking
  level `HIGH` and provider thought summaries enabled when the existing
  `thinking_stream` product flag is on.

The public product language is deliberately **Quick / Think**, never
"non-thinking / thinking." Gemini 3.5 Flash can reason even at `MINIMAL`, and
Google explicitly says `MINIMAL` does not guarantee that thinking is off. The
feature selects a speed/depth tradeoff; it does not claim to expose or disable
private chain-of-thought.

No implementation work belongs in this plan file. This copy is the graduated
historical record; living behavior now lives in `docs/ARCHITECTURE.md`, ADR
0034, and the additive MVP2 wire-contract notes.

## 0. Pre-implementation provider gate

Do this before migrations, protocol work, or UI work. Vertex Express Mode
availability is a hard dependency, not a rollout detail. The current production
constructor is `GoogleCloudProvider(api_key=...)`; the exact target API key and
environment must prove that constructor can invoke **both** configured IDs:

1. `gemini-3.5-flash` with `thinking_level=MINIMAL` and
   `include_thoughts=false`;
2. `gemini-3.1-pro-preview` with `thinking_level=HIGH` and
   `include_thoughts=true`.

Use one tiny no-tool request per model through the installed PydanticAI and
Google GenAI versions. Do not print credentials, prompts, signatures, or full
provider payloads. Record only reachability, model ID, status, latency, and
usage under `artifacts/`.

This gate exists because Google's current Express Mode model table lists
Gemini 3.1 Pro Preview but does not yet list Gemini 3.5 Flash, even though 3.5
Flash is GA on standard Vertex. The repository default alone is not proof that
the target Express key can call it. If either smoke fails, stop and make an
explicit auth/provider-path decision. Do not substitute a fallback model and do
not build UI that advertises an unverified capability.

## 1. Outcome and product contract

### Student-visible behavior

The composer toolbar gets one compact selector immediately beside **Sources**.
Its closed label always exposes the current selection:

- `Quick` with a small speed icon and chevron.
- `Think` with a small reasoning icon and chevron.

Opening it shows one radio selection from two rows:

| Mode | Primary copy | Supporting copy | Secondary model disclosure |
|---|---|---|---|
| Quick | **Quick** | Fast answers for everyday questions. | Gemini 3.5 Flash |
| Think | **Think** | More time for complex comparisons and important decisions. | Gemini 3.1 Pro · Preview |

Locked interaction decisions:

1. **Quick is the default for every new chat.**
2. **The selection is sticky per chat**, persisted server-side, so refreshes,
   cleared local state, and another device agree.
3. **The selection applies to the next normal new turn.** Keep two concepts
   separate: `selected_response_mode` is the chat's sticky next-turn
   preference; `execution_response_mode` is the immutable mode of an active,
   retried, regenerated, steered, or resumed turn. It cannot change a model
   invocation already in progress.
4. **The selector is disabled during an active turn and while answering a
   parked clarification.** A clarification answer continues the original turn
   with its original response mode.
5. **Retries use the failed attempt's captured mode.** They do not read whatever
   the selector happens to show later.
6. **Regenerate uses the original assistant response's execution mode** without
   changing the chat's sticky next-turn preference. This preserves
   reproducibility without making an old Think regeneration silently turn the
   whole chat back to Think. A student who wants a different normal-turn mode
   selects it and sends a new follow-up such as "reconsider that."
7. **Mid-run steering inherits the active turn's mode.** A queued steering
   message that becomes a new turn inherits the mode captured when it was
   queued, not a later UI selection.
8. **No silent model fallback.** If Think is unavailable, Counselle says so and
   offers `Retry Think` plus a separate, explicit `Retry with Quick` replacement
   action. The Quick action changes only that failed answer's execution mode;
   it does not silently rewrite the chat preference. Counselle never claims a
   Pro answer while serving Flash.
9. **Provider thoughts and Counselle work visibility remain distinct.** Quick
   still renders real tool steps and model narration. It simply does not request
   Gemini provider thought summaries. Think requests summaries, which continue
   to render in the existing collapsed activity timeline.
10. **No automatic routing in this feature.** Counselle does not silently
    promote Quick to Think. The student controls the tradeoff and the server
    executes exactly the selected mode.

### Why a menu, not an on/off toggle or model picker

- An on/off toggle falsely implies one model does not reason.
- A raw model picker makes students understand provider naming and preview
  lifecycle instead of choosing the outcome they want.
- A permanently expanded segmented control adds unnecessary density to the
  mobile composer and leaves no room for the explanatory copy.
- The existing composer already uses a top-opening menu for Sources. Reusing
  the same spatial and interaction grammar keeps the control discoverable and
  visually quiet.
- The existing Base UI Menu radio primitives already provide the correct
  single-selection keyboard semantics. Do not install AI Elements' full model
  selector or hand-roll a menu.

### Explicitly not in scope

- Automatic prompt-complexity routing.
- More than two response modes or a user-facing thinking-effort slider.
- Per-user billing, subscriptions, quotas, or a separate Think rate limit.
- Silent provider fallbacks or LiteLLM adoption.
- Changing the cheap, clarifier, or title models.
- Changing prompts solely because the model changes; only do so if the A/B eval
  identifies a concrete model-specific failure.
- Exposing raw chain-of-thought, hidden reasoning tokens, or a claim that the
  timeline is the model's complete internal reasoning.
- Refactoring unrelated chat or workspace code.

## 2. Current system and leverage map

| Concern | Existing source of truth to extend | Constraint to preserve |
|---|---|---|
| Model configuration | `config/settings.py` | ADR 0011: use PydanticAI's native per-agent `model=` seam; no wrapper layer |
| Google model construction | `app/agent_node.py::default_model_factory` | Vertex Express Mode API-key path is the working auth path |
| Thinking configuration | `app/agent_node.py` + `thinking_stream` | `thinking_stream` remains the global display/request gate for native summaries |
| Per-session single flight | `app/turns.py::TurnRegistry.start` | No `await` before the `_turns[session_id]` claim assignment |
| Clarify continuation | `TurnRegistry._selected_skills_for_start` and parked turn record | Server-owned continuation metadata wins; clients cannot replace it mid-turn |
| Turn execution | `app/run_turn.py::run_turn` | `meta` must be first and must report the model actually used |
| Graph transport | `app/state.py::TurnState.turn_ids` | Values must remain msgpack-plain and checkpoint-safe |
| Durable replay | `app/records.py`, `app/transcript.py` | Turn record is the transcript truth; legacy records must still render |
| Usage/cost | `app/usage.py`, registry `_observe` | Enrich from the actual per-turn model, not global Settings |
| Session stickiness | `counselle.sessions`, `app/sessions.py` | Persist inside the registry's post-claim/pre-spawn guard; rejected or failed preparation never spawns or mutates |
| Wire protocol | `domain/events.py`, `api/sse.py` | Additive fields stay protocol v1; old clients ignore unknown fields |
| Home composer handoff | `AiComposerRoute.tsx` → router `initialTurn` | Capture mode with text and skills before navigating |
| Chat lifecycle | `useChatSession.ts`, `useTurnEngine.ts` | Mode must survive retry, conflict recovery, attach, queued steering, and regenerate |
| Composer UI | `AiComposer.tsx`, `ChatComposer.tsx`, `SourcesMenu.tsx` | Both entry points use the same shared mode component and design tokens |
| Menu primitive | existing `components/ui/menu.tsx` | Use its Base UI `MenuRadioGroup`/`MenuRadioItem`, matching Sources; no new package or custom ARIA implementation |

The current global-model assumptions that must be removed are:

- `run_turn` emits `settings.model_counselor` in `meta`.
- the registry enriches usage with `settings.model_counselor`.
- `default_model_factory` always reads `settings.model_counselor`.
- the agent node applies `include_thoughts=True` globally whenever
  `thinking_stream` is enabled.

One shared seam must **not** be changed: `AppDeps.model_factory` is an existing
zero-argument injected test factory also consumed by counselor tests,
auto-titles, and document summaries. Dynamic counselor routing belongs only in
the production counselor factory path; changing the shared callable signature
would break unrelated model consumers.

Changing only the model factory would create a correctness bug: Think could run
Pro while metadata, persisted history, telemetry, and cost all claimed Flash.

## 3. Technical contract

### 3.1 Canonical response-mode type

Add `domain/response_mode.py` with a string enum:

```python
class ResponseMode(StrEnum):
    QUICK = "quick"
    THINK = "think"
```

Why a domain enum:

- It is the shared boundary type for HTTP input, session persistence, graph
  state, turn records, and model resolution.
- It prevents duplicated string literals and arbitrary client model IDs.
- It contains no provider dependency and keeps the pure domain layer pure.

Add small boundary helpers only where needed:

- validate persisted strings through `ResponseMode(value)` or Pydantic.
- legacy session rows and old clients default to `ResponseMode.QUICK`.
- malformed persisted values fail safely and log server-side; never silently
  select a more expensive model.

### 3.2 Server-owned model selection

Add `app/model_selection.py` with one immutable result type and one pure
resolver:

```python
@dataclass(frozen=True)
class CounselorModelSelection:
    response_mode: ResponseMode
    model_setting: str
    thinking_level: Literal["MINIMAL", "HIGH"]
    include_thoughts: bool

def counselor_model_selection(
    response_mode: ResponseMode,
    settings: Settings,
) -> CounselorModelSelection: ...
```

Mapping:

| Mode | Settings field | Thinking level | Include provider thoughts |
|---|---|---|---|
| quick | existing `model_counselor` | `MINIMAL` | `False` |
| think | new `model_counselor_think` | `HIGH` | `settings.effective_thinking_stream` |

Keep `model_counselor` as Quick's setting instead of renaming it. That preserves
the existing `COUNSELLE_MODEL_COUNSELOR` environment contract and keeps other
callers backward compatible. Add:

```python
model_counselor_think: str = "google-vertex:gemini-3.1-pro-preview"
model_counselor_display_name: str = "Gemini 3.5 Flash"
model_counselor_think_display_name: str = "Gemini 3.1 Pro"
model_counselor_think_preview: bool = True
response_mode_think_enabled: bool = True
```

Because the current production factory always constructs `GoogleModel`, fail
fast unless both counselor settings use the `google-vertex:` prefix. Today,
silently stripping an Anthropic or unknown prefix would misroute it through
Google. Provider-generic construction is a separate ADR-level change, not part
of this feature.

The browser sends only `quick` or `think`; it never sends a model ID, provider,
thinking level, or `include_thoughts` flag. The resolver is the only mapping
from product intent to provider configuration.

Do not use `gemini-3.1-pro-preview-customtools`. Google's custom-tools endpoint
is optimized for bash/code-agent workflows and may fluctuate elsewhere;
Counselle should use the standard Pro endpoint.

### 3.3 Wire shapes

Request fields:

```json
POST /v1/sessions
{
  "source_config": { "...": "..." },
  "response_mode": "quick"
}

POST /v1/sessions/{id}/messages
{
  "text": "...",
  "skills": [],
  "source_config": { "...": "..." },
  "response_mode": "think"
}
```

`MessageBody.response_mode` is optional for backward compatibility:

- New clients always send it for normal new turns.
- Omission on a normal turn uses the session's persisted mode.
- Clarification answers omit it and inherit the parked record's mode.
- An explicit mode that conflicts with a parked continuation is rejected with
  a user-safe `422`, catching stale or malicious clients instead of changing
  model mid-turn.

Additive protocol-v1 `meta.data`:

```json
{
  "trace_id": "...",
  "session_id": "...",
  "model": "google-vertex:gemini-3.1-pro-preview",
  "response_mode": "think",
  "message_id": "...",
  "user_message_id": "..."
}
```

The exact configured model setting is emitted, not merely the bare Google model
name. Existing `model` consumers keep working; `response_mode` is additive and
`v` remains `1` per ADR 0022.

Extend terminal `error.data` with an optional structured `code`. Use
`model_unavailable` only for the explicitly mapped provider-capacity/not-found
statuses that support mode-aware recovery. Old clients continue using
`message`; new clients never parse human copy to decide whether `Retry with
Quick` is safe.

Session responses add the current sticky `response_mode`. Transcript assistant
entries add the historical `response_mode` and `model`. Both fields are optional
when reading legacy turn records.

`GET /v1/config` adds:

```json
{
  "default_response_mode": "quick",
  "response_modes": [
    {
      "id": "quick",
      "model": "google-vertex:gemini-3.5-flash",
      "model_display_name": "Gemini 3.5 Flash",
      "preview": false
    },
    {
      "id": "think",
      "model": "google-vertex:gemini-3.1-pro-preview",
      "model_display_name": "Gemini 3.1 Pro",
      "preview": true
    }
  ]
}
```

This is presentation-safe capability metadata, not an authorization surface.
The frontend owns the Quick/Think product labels and descriptions; the backend
owns available IDs, configured model identity, and the display name matching
that model through the named Settings fields above. The browser must not parse
provider IDs to invent human copy. When deployment changes a preview model ID,
it updates the matching display/preview settings in the same config change.
Disabled modes are omitted from `response_modes`, and
`default_response_mode` must always be present in that non-empty list. The
server still rejects a stale valid `think` request when Think is disabled.

Add a dedicated `ResponseModeUnavailable` path: raise before the session claim
when a valid mode is administratively disabled and return a user-safe `503`
with no writes. Malformed enum values remain FastAPI `422`; do not conflate
"well-formed but unavailable" with invalid input.

## 4. Database and session persistence

### 4.1 Migration

At implementation time, use the next free migration number. The current dirty
worktree already contains `0013_essay_prompt_drafts.sql`, so this plan expects:

- `migrations/0014_response_mode.sql`
- `migrations/0014_response_mode.rollback.sql`

Forward migration:

```sql
-- depends: 0013_essay_prompt_drafts

ALTER TABLE counselle.sessions
ADD COLUMN response_mode text NOT NULL DEFAULT 'quick',
ADD CONSTRAINT sessions_response_mode_check
CHECK (response_mode IN ('quick', 'think'));
```

The default backfills existing rows as Quick and keeps old insert call sites
working during a rolling/local migration. Do not overload `source_config` or
user `settings` JSON with per-session execution state.

Rollback:

```sql
ALTER TABLE counselle.sessions
DROP CONSTRAINT sessions_response_mode_check,
DROP COLUMN response_mode;
```

### 4.2 Session repository

Extend `app/sessions.py`:

- include `response_mode` in insert and detail-select SQL. Do not add it to the
  sidebar list query/response until a list consumer exists.
- `create_session(..., response_mode: ResponseMode = QUICK)`.
- add `set_session_response_mode(pool, session_id, response_mode)` using one
  parameterized update.
- normalize the DB string to the enum at the application boundary or leave the
  row JSON-compatible and validate in the route, consistently with current
  session repository style.

Return the field from create/get and from rename only where that route returns
the same detail shape. Extend the fallback session creation in
`app/run_turn.py::_ensure_session` so an explicit direct/eval Think call inserts
Think rather than accidentally taking the DB's Quick default. The DB default is
the final compatibility backstop.

### 4.3 Mutation ordering

Do **not** copy the route's current post-`start()` source-config/title write
pattern for response mode. `TurnRegistry.start()` creates the detached task
before it returns; a route-level mode write could fail with a 500 while an
untracked Pro/Flash turn is already running.

Preserve the no-await atomic claim window and make mode persistence part of the
existing guarded preparation after the claim but before task creation:

1. FastAPI validates the enum; the route reads/authorizes the session.
2. `TurnRegistry.start` validates skills and mode availability synchronously.
3. It checks capacity and assigns `_turns[session_id]` with no intervening
   `await`.
4. Under the existing release-on-error `try`, it reads parked state once,
   resolves continuation ownership, performs any history rewrite, and then
   persists mode only for an explicitly selected **normal new turn**.
5. A clarification, steer, or `replace_message_id` regeneration never changes
   stickiness. Session creation already persists its initial selection.
6. Only after the guarded DB write succeeds may `asyncio.create_task()` spawn
   the detached run.
7. Any preparation/write failure releases the claim, maps to a safe pre-stream
   response, and makes no model call.

Add `response_mode_inherited`/turn-kind state to `_Turn` so this decision is
server-owned, not reconstructed by the route. Keep existing source-config/title
behavior unchanged; this feature must not expand its post-spawn failure window.

## 5. Turn lifecycle and model correctness

### 5.1 Registry ownership

Extend `_Turn` with immutable-at-claim fields:

```python
response_mode: ResponseMode
model_setting: str
response_mode_inherited: bool
```

`TurnRegistry.start` accepts the optional requested mode and the authorized
session's persisted fallback mode. Model selection is resolved once and stored
on `_Turn`; no later code re-reads a mutable UI preference or global counselor
model to decide what this turn means.

Preserve the atomic window in `start`:

- Enum normalization and pure model resolution are allowed before the claim.
- No network, graph, or database `await` may be introduced between the
  single-flight checks and `_turns[session_id] = turn`.
- Parked-record inspection remains after the claim and inside the existing
  release-on-error `try` block.

Replace `_selected_skills_for_start` with one focused parked-continuation reader
that fetches graph state once and returns both:

- inherited/validated selected skills;
- inherited/validated response mode and continuation ownership.

For a parked continuation:

- missing request mode inherits the record;
- matching explicit mode is accepted but unnecessary;
- conflicting explicit mode raises `InvalidResponseMode` and releases the claim;
- missing mode on a legacy parked record falls back to Quick.

The checkpoint's historical `model` is display/audit data, not an execution
input. On clarification resume, inherit the original response mode and resolve
that mode through the **current approved Settings mapping**. This avoids
executing an arbitrary or retired model string from checkpoint state after a
preview-model deployment change. Preserve the parked record's original model;
the replacement record truthfully stores the newly invoked model. If the mode
is no longer available, fail explicitly instead of falling back.

Do not perform separate graph reads for skills and response mode.

### 5.2 Detached execution

`TurnRegistry._drive` passes `turn.response_mode` and `turn.model_setting` to
`run_turn`. `run_turn` puts both in `turn_ids` before emitting `meta` and passes
the selected model through graph execution.

The agent node reads the prepared response mode/model from `turn_ids` and
asserts they match the server-owned `_Turn`/`run_turn` inputs. Fresh turns and
parked resumes resolve from Settings before graph execution; the node never
accepts a browser model ID or independently trusts an old checkpoint string.
Keep the values msgpack-plain.

`default_model_factory` becomes:

```python
def default_model_factory(settings: Any, model_setting: str) -> Model: ...
```

It continues to use `GoogleCloudProvider(api_key=settings.vertex_api_key)` and
`model_name_from_setting`. Preserve the existing shared zero-argument injection
seam:

```python
injected = getattr(deps, "model_factory", None)
model = (
    injected()
    if injected is not None
    else default_model_factory(settings, selection.model_setting)
)
```

Do not catch `TypeError` as a compatibility shim and do not change
`AppDeps.model_factory`: titles and document summaries call it with zero
arguments. Test dynamic production routing through the pure resolver plus a
monkeypatched/spied `default_model_factory`.

The agent node creates per-turn `GoogleModelSettings`:

```python
GoogleModelSettings(
    google_thinking_config={
        "thinking_level": selection.thinking_level,
        "include_thoughts": selection.include_thoughts,
    }
)
```

Never send both `thinking_level` and legacy `thinking_budget`. Explicitly set
`MINIMAL` for Quick and `HIGH` for Think rather than relying on provider defaults
that can differ by model or change over time.

### 5.3 Thought signatures and model switching

Gemini 3 requires thought signatures to be returned exactly during function
calling, including Flash at `MINIMAL`. Preserve the existing behavior:

- persist `result.all_messages()` rather than reconstructing provider history;
- preserve PydanticAI `ThinkingPart`, tool-call parts, provider details, and
  thought signatures byte-for-byte;
- round-trip a synthetic signature through `scrub_evidence_tokens`, checkpoint
  serialization/deserialization, and model-history replay so Counselle's own
  recursive history transform cannot accidentally strip it;
- do not filter thought parts from stored model history just because Quick does
  not display summaries;
- only suppress public `thinking` events for Quick by not requesting
  `include_thoughts`; storage and wire visibility are separate concerns.

Switching Quick → Think → Quick across completed turns is supported. The
response mode cannot switch inside one parked or active turn; a parked resume
may use a newer server-approved model setting for that same mode after a deploy,
and must record the actual model.

### 5.4 Cancel, timeout, error, and rewrite paths

Every terminal record path must retain the same response mode/model:

- complete;
- awaiting clarification;
- clarification resume replacement;
- explicit cancel with partial history;
- watchdog timeout;
- tool retry exhaustion;
- generic provider or persistence error.

History rewrite truncates records as it does today. A regenerate supplies the
historical assistant execution mode from the frontend but does not persist it
as the chat's next-turn selection. Do not add a speculative edit-mode UI in
this feature; the current product path is Regenerate.

Catch PydanticAI `ModelHTTPError` separately before generic model exceptions;
in the pinned version it is not an `UnexpectedModelBehavior` subclass. Only
explicit statuses `404`, `429`, and `503` produce `code=model_unavailable` and
mode-aware user-safe copy:

- Think: `Think is temporarily unavailable. Try again, or switch to Quick.`
- Quick: preserve the current generic retry message unless a more specific
  action is useful.

Log status, configured model, mode, and trace ID server-side without logging
prompts, provider response bodies, API keys, or thought signatures. Do not map
`400`, `401`, `403`, content-filter, or malformed-tool errors to "model
unavailable."

## 6. Durable records, protocol, and transcript

### 6.1 Turn record

Extend `build_turn_record` and every `build_terminal_update` caller so each new
record contains:

```json
{
  "response_mode": "think",
  "model": "google-vertex:gemini-3.1-pro-preview"
}
```

Require both values in validated `turn_ids` and make `build_turn_record()` read
them from `ids`, so complete/error/park paths cannot diverge. Update registry
`_observe(meta)` to copy `response_mode` and `model` into `turn.ids`; the
cancel/timeout/shutdown-drain builders then use the same identity. Do not make
each catch block independently remember to add them. Preserve the existing
pre-meta cancel rule: if no answer identity was ever exposed, cancellation
writes no turn record.

Legacy record behavior:

- absent `response_mode` is interpreted as Quick;
- absent `model` remains absent in historical transcript metadata rather than
  pretending Counselle knows what served an old answer;
- a legacy parked record can safely resume as Quick, but the new replacement
  record records the actual model used for the resumed execution;
- present but malformed/unknown `response_mode` remains renderable as
  unsupported history; it is not silently relabeled Quick.

### 6.2 Transcript

Add `response_mode` and `model` to assistant transcript entries. Mode belongs to
the assistant answer because it describes how that answer was generated. Do not
duplicate it on the user entry.

The frontend maps those fields into `AssistantChatMessage` so regenerate can use
the exact historical mode. The normal message surface does not need a permanent
badge; model/mode metadata can remain available to actions, diagnostics, and a
future details surface without adding transcript noise.

### 6.3 Meta and reattach

`MetaData` and the frontend `TurnState.meta` carry the response mode and actual
configured model. On live attach, the replayed meta event restores them. If a
client attaches after the ring buffer is gone, transcript fallback restores them
from the durable record.

Update protocol fixtures and wire-contract documentation. Because fields are
additive and clients ignore unknown keys, keep `PROTOCOL_VERSION = 1`.

## 7. Usage, pricing, and telemetry

### 7.1 Actual-model accounting

Change registry `_observe` to call:

```python
enrich_usage_event(event, turn.model_setting, settings)
```

Never use `settings.model_counselor` for a dynamic turn. Extend
`log_turn_complete` with `response_mode` and `model` structured fields so mode
latency/cost can be compared without joining transcript state.

### 7.2 Current prices

Replace the unverified Gemini 3.5 entry. Current **Standard PayGo, global
endpoint** prices verified 2026-07-22 per 1M tokens are:

| Model | Input ≤200K | Output + reasoning ≤200K | Input >200K | Output + reasoning >200K |
|---|---:|---:|---:|---:|
| Gemini 3.5 Flash | $1.50 | $9.00 | — | — |
| Gemini 3.1 Pro Preview | $2.00 | $12.00 | $4.00 | $18.00 |

Google applies the long-context tier to all tokens when input context exceeds
200K. The current `(input, output)` tuple cannot represent that honestly.
Replace it with a small frozen nested Pydantic settings model containing:

- normal input/output rates;
- optional long-context input/output rates;
- threshold (`200_000`) when applicable.

Keep the schedule on the single Settings surface and preserve the existing
`COUNSELLE_MODEL_PRICES` JSON environment contract. Do not encode fake
long-context fields for Flash, whose price is uniform. `estimate_cost` selects
Pro's long tier from `input_tokens` and remains `None` for unknown models. Do
not add cached-token accounting until the usage payload actually exposes cached
tokens; do not claim precision the telemetry does not provide.

Reasoning tokens are billed at the output rate. In installed PydanticAI 1.107.0,
Google's `thoughtsTokenCount` is exposed in `details["thoughts_tokens"]`, while
the bundled usage extractor already includes both candidate and thought tokens
in `output_tokens` and adds tool-use prompt tokens to input. Treat
`usage.output_tokens` as the billable response-plus-reasoning count; **never add
`thoughts_tokens` again**. Pin this with a synthetic provider-usage regression
test and one live sanity check so a future dependency change is intentional.

### 7.3 Metrics to compare

Record or derive per mode:

- count and error rate;
- time to first public output;
- total duration;
- input/output tokens;
- tool-call count;
- estimated cost;
- cancel rate;
- user feedback rating.

No dashboard is required for v1. The structured fields are the seam.

## 8. Frontend state and transport

### 8.1 Shared types

Add:

```ts
export type ResponseMode = "quick" | "think";
```

Extend:

- `ChatConfigWire` / `ComposerConfig` with default and available modes;
- `CreatedSession`, `ChatSession`, and session wire types with sticky mode;
- `MetaData` with `response_mode`;
- transcript assistant entries with optional `response_mode` and `model`;
- `AssistantChatMessage` with mode/model;
- `SendMessageInput` and create-session input with mode.

Validate all server values at the transport boundary. Config modes must be
unique, known, non-empty, and contain the declared default. A malformed config
degrades to the built-in Quick-only capability and reports the contract failure;
it never enables an unknown mode.

Transcript compatibility is deliberately stricter:

- missing mode on a genuinely legacy record maps to Quick;
- known `quick`/`think` is preserved;
- a present unknown/malformed future mode keeps the answer renderable but marks
  its execution mode unsupported, disables Regenerate with a user-safe
  explanation, and never fabricates Quick.

### 8.2 Session state

Extend `useChatSession`'s session-scoped local state with
`selectedResponseMode`.
Hydration order mirrors source configuration:

1. initial-turn mode from the home composer, if present;
2. locally captured session mode during in-flight navigation, if present;
3. hydrated server session mode;
4. config default;
5. built-in Quick fallback.

Use a small session-keyed cache only to bridge request/navigation/hydration races,
as the source-config cache does. The database remains the durable truth.

Every existing `LocalSessionState` reconstruction path (hydrate, transcript
error, persisted-message setter, source-config setter, and commit callback)
must explicitly preserve `selectedResponseMode`; these setters do not all merge
the old object today. Mirror the existing synchronous `sessionIdRef` stale-call
guard so an old stream cannot stamp mode onto a newly selected session. Give
the new session-mode cache a test-only reset, and clear its entry after server
commit only when both session ID and captured mode still match.

`setSelectedResponseMode` creates a new state object; do not mutate shared
objects. A mode change before Send updates local state immediately but becomes
durable only when the registry accepts and persists a normal turn (or when a new
session is created with that mode).

Normalize selection against advertised availability. If an existing session is
sticky Think while Think is disabled, select Quick for the next normal turn and
show a clear, non-destructive availability notice. Historical Think answers stay
truthful. An active or parked Think turn still displays Think as its execution
history even though it is unavailable for new turns.

### 8.3 Home composer handoff

`AiComposerRoute` owns a response-mode state initialized from config Quick. It
passes mode to:

- `AiComposer` for rendering;
- `useComposerStartTurn` when creating the session;
- router `initialTurn` alongside copied text and skills.

`AiChatRoute.initialTurnFromState` validates the mode union. Invalid/missing
legacy router state uses Quick without rejecting otherwise valid text/skills.

The first actual message send must use the captured initial-turn mode, not wait
for the session query and accidentally overwrite it with Quick during hydration.

### 8.4 Turn engine snapshots

Keep `selectedResponseMode` outside the execution engine as the next-turn
preference. Thread an explicit `executionResponseMode` snapshot through
`submitMessage`; do not let `runTurn` read a changing selector ref after
submission.

Add mode to:

- the complete immutable pending request snapshot (`text`, copied `skills`,
  execution mode, replacement ID, and continuation ownership);
- `LiveTurn` as `executionResponseMode`;
- conflict-recovery `runTurn` calls;
- `StartedTurn` where useful for reconciliation;
- queued auto-forward steering entries;
- optimistic assistant state after `meta` reconciliation;
- active attach state restored from replayed `meta`.

Rules:

- A normal send snapshots the current selected mode.
- Retry uses the failed request's captured execution mode.
- 409 cancel/retry uses the original snapshot.
- A live injected steer does not send a new mode.
- If steering returns `queued` for later auto-forward, store the active turn's
  captured mode with the queued text.
- The engine derives parked continuation from its current state and omits mode
  from the HTTP body. This must cover both `handleClarifyAnswer` (the inline
  widget) and free-text submit through `handleComposerSubmit`; do not trust an
  arbitrary caller-supplied continuation boolean.
- Regenerate passes a supported historical `message.responseMode`; a missing
  genuinely legacy mode maps to Quick, while a present unsupported mode cannot
  regenerate.
- Replacement, clarification, and steering execution never mutate
  `selectedResponseMode` or server stickiness.

Terminal SSE `error` is a first-class retry path. Today it is consumed as a
normal terminal frame, so only pre-`meta` HTTP/network failures create
`PendingSend`. Pass the immutable request snapshot into `consumeStream`; when a
post-`meta` `model_unavailable` error arrives, retain recovery state anchored to
the reconciled backend `user_message_id`. `Retry Think` history-rewrites that
failed turn with the same mode; `Retry with Quick` performs an explicit one-off
Quick replacement. Neither duplicates the optimistic/user bubble, and neither
changes the next-turn preference. Test both pre-`meta` disabled/capacity
responses and post-`meta` provider errors.

Make the submit API explicit rather than extending the current overloaded
`skillsOrReplaceMessageId` positional union further. Replace it with an object:

```ts
submitMessage({ text, skills, executionResponseMode, replaceMessageId })
```

This is a local cleanup earned by the new fourth semantic argument. It prevents
mode/replace-ID ordering bugs and keeps call sites readable. Update only direct
callers and tests; do not refactor unrelated engine internals.

## 9. Composer UI implementation

### 9.1 One shared component

Create `frontend/src/features/ai-composer/ResponseModeMenu.tsx` and use it from
both:

- `features/ai-composer/AiComposer.tsx`;
- `features/ai-chat/components/ChatComposer.tsx`.

Props:

```ts
type ResponseModeMenuProps = {
  mode: ResponseMode;
  modes: readonly ResponseModeOption[];
  disabled?: boolean;
  onModeChange: (mode: ResponseMode) => void;
};
```

Use the installed Base UI `MenuRadioGroup` and `MenuRadioItem` from
`components/ui/menu.tsx`, exactly as `SourcesMenu` uses the same Menu family.
This preserves the existing focus, positioning, styling, and keyboard grammar
without parallel Radix behavior. Reuse the visual tokens and top-opening
placement from `SourcesMenu`:

- `side="top"`, `align="start"`, `sideOffset={8}`;
- same 32px visual trigger height and control radius;
- inherit the shared Button's existing coarse-pointer 44px hit-area expansion
  and verify it; do not add a second hit-padding trick;
- no new colors, gradients, shadows, radii, fonts, or animation system;
- preserve the Menu primitive's actual transition and reduced-motion behavior;
- icons are secondary to visible text and never the only state signal.

Do not copy the trigger class string into a third component. If Sources and mode
need the same composer-control styling, extract a narrowly named shared class or
small composer toolbar button primitive in `features/ai-composer/`; keep behavior
in the individual menus.

### 9.2 Accessibility contract

- Trigger accessible name: `Response mode: Quick` or `Response mode: Think`.
- `aria-haspopup`, expanded state, focus return, Escape, Up/Down, Home/End, and
  selection semantics come from Base UI.
- Options use real radio-menu semantics and expose checked state independently
  of color.
- Disabled state remains perceivable. If the existing Button's native disabled
  behavior removes it from focus, provide nearby visible state text rather than
  inventing custom `aria-disabled` keyboard behavior solely for this control.
- No tooltip is required because the trigger has visible text. Descriptions live
  in the menu, not tooltip-only content.
- Verify zoom/reflow at 200%, narrow mobile widths, long localized copy, and
  keyboard-only operation.

### 9.3 Visual and behavioral states

| State | Trigger | Menu/behavior |
|---|---|---|
| New chat | Quick | Enabled; Quick checked |
| Think selected before send | Think | Enabled; Think checked; Preview shown only in secondary copy |
| Active send | Execution mode | Disabled; Stop remains available; returns to selected mode at terminal |
| Parked clarification | Original mode | Disabled; clarification response inherits it |
| Error with retry | Selected next-turn mode | Recovery banner names the failed mode; trigger shows execution mode only while a retry runs |
| Think unavailable | Quick for next turn | Non-destructive notice; historical/failed Think remains labeled Think |
| Session reload | Persisted mode | Hydrates without visible Quick→Think flicker |
| Legacy session | Quick | Safe fallback |

Do not render mode badges on every assistant message. The selector, live activity,
and optional model disclosure are enough; permanent badges would add noise to a
high-stakes reading surface.

## 10. Implementation phases

### Phase 0 — Exact provider-path proof

Files: no source changes; store the redacted result under `artifacts/`.

Work: run the two no-tool Express Mode smokes from section 0 with the target
deployment key, installed SDKs, exact model IDs, and exact thinking settings.

Exit gate: both calls succeed and report usage. Otherwise stop; do not proceed
to schema or UI work.

### Phase 1 — Domain, Settings, model resolver, and pricing

Files:

- new `domain/response_mode.py`
- new `app/model_selection.py`
- `config/settings.py`
- `app/usage.py`
- focused settings/usage/model-selection tests

Work:

1. Add the response enum and immutable mode resolver.
2. Add `model_counselor_think` and the honest-disable flag while preserving
   `model_counselor` as Quick; fail fast on incompatible provider prefixes.
3. Replace global thought configuration with per-selection settings.
4. Replace flat unverified pricing with long-context-aware schedules.
5. Test exact mappings, unknown model cost, threshold boundary at 200K, and
   immutability.

Exit gate: pure tests prove that every mode resolves to exactly one model and
thinking configuration, and pricing matches the documented schedule.

### Phase 2 — Database and session API

Files:

- new migration + rollback (expected `0014`)
- `app/sessions.py`
- `api/routes/sessions.py`
- `api/routes/config.py`
- relevant repository/route tests

Work:

1. Add/backfill/check `sessions.response_mode`.
2. Extend create/detail responses and the config capability payload; leave the
   unused sidebar list shape alone.
3. Add optional message mode validation.
4. Add the parameterized repository write used by registry preparation.
5. Preserve auth scoping and parameterized SQL; declare migration dependency
   `0013_essay_prompt_drafts`.

Exit gate: old request bodies still work as Quick/session-sticky; malformed
modes return 422 and disabled Think returns 503 with no session mutation.

### Phase 3 — Registry, graph, agent, records, and usage truth

Files:

- `app/turns.py`
- `app/run_turn.py`
- `app/state.py`
- `app/agent_node.py`
- `app/records.py`
- `app/turn_persistence.py`
- `app/transcript.py`
- `domain/events.py`
- backend lifecycle/protocol tests and fixtures

Work:

1. Capture mode/model on `_Turn` without weakening the no-await claim window.
2. Inherit mode during parked clarification using the same graph read as skills,
   and persist only normal-turn selection inside the pre-spawn guard.
3. Pass selection through `run_turn`, `turn_ids`, agent construction, meta, all
   terminal records, usage enrichment, and logs.
4. Preserve the shared zero-argument injected model factory; route only the
   production counselor factory dynamically.
5. Preserve thought signatures and full provider history through Counselle's
   evidence scrub/checkpoint transform.
6. Add transcript and protocol fields with legacy/unsupported-mode handling.
7. Add structured mode-aware provider-capacity errors without misclassifying other
   model errors.

Exit gate: every terminal lifecycle produces one terminal event and one record
whose mode/model match the model factory invocation and usage estimate; a failed
pre-spawn preference write releases the claim and makes no model call.

### Phase 4 — Frontend contracts and turn engine

Files:

- `frontend/src/api/chat/types.ts`
- `frontend/src/api/chat/config.ts`
- `frontend/src/api/chat/transport.ts`
- `frontend/src/features/ai-chat/model.ts`
- `frontend/src/features/ai-chat/turn-reducer.ts`
- `frontend/src/features/ai-chat/useTurnEngine.ts`
- `frontend/src/features/ai-chat/useChatSession.ts`
- `frontend/src/features/ai-chat/AiChatRoute.tsx`
- `frontend/src/features/ai-chat/AiChatPage.tsx`
- `frontend/src/features/ai-composer/AiComposerRoute.tsx`
- `frontend/src/features/ai-composer/useComposerStartTurn.ts`
- focused transport/hook/reducer/page tests

Work:

1. Validate and map response-mode wire data.
2. Hydrate/normalize sticky per-session mode without cross-session leakage and
   preserve it in every `LocalSessionState` reconstruction.
3. Carry the mode through the home handoff and first auto-send.
4. Convert `submitMessage` to a named-options object.
5. Separate selected next-turn mode from immutable execution mode across normal
   send, retry, conflict recovery, queued steer, attach, clarify, and regenerate.
6. Retain recovery state for post-`meta` SSE model errors and implement explicit
   same-mode and Quick replacement actions without duplicate messages.

Exit gate: no code path can accidentally read a later selector state for an
already-started or retried request.

### Phase 5 — Shared composer UI

Files:

- new `frontend/src/features/ai-composer/ResponseModeMenu.tsx`
- optionally one tiny shared composer-control styling primitive
- `AiComposer.tsx`
- `ChatComposer.tsx`
- component/page accessibility tests

Work:

1. Implement the top-opening radio menu with existing primitives/tokens.
2. Mount it beside Sources in both composers.
3. Implement disabled/clarify/active/error states.
4. Verify desktop, mobile, keyboard, focus, 200% zoom, and reduced motion in a
   manual browser acceptance smoke; do not add Playwright solely for this feature.

Exit gate: the same component and copy render in both entry points with no
one-off styling fork.

### Phase 6 — Live verification, eval, docs, and rollout

Files:

- relevant live tests/eval configuration
- `docs/ARCHITECTURE.md`
- `specs/mvp2/plan/wire-contract.md`
- new ADR superseding the current single-counselor-model and global-thinking
  assumptions in ADRs 0011/0028, or one focused amendment ADR linked from the
  ADR index
- `.env.example` / deployment docs if they enumerate model settings

Work:

1. Re-run both model smokes plus tool/cross-model history tests.
2. Run the Counselle eval set in Quick and Think with identical cases.
3. Compare quality, citation honesty, latency, tool behavior, and cost.
4. Update living docs and record the mode-routing decision.
5. Roll out Quick as default; enable Think only after Express Mode quota is
   verified in the target environment (reachability was already gated in Phase 0).

Exit gate: all acceptance criteria below pass and the owner approves measured
quality/cost, not benchmark marketing.

## 11. Test and verification plan

Tests are added where they buy confidence in lifecycle, billing, honesty, or a
regression-prone UI flow. Do not chase a coverage percentage or unit-test static
copy for its own sake.

### 11.1 Pure/unit tests

| Codepath | Required assertion |
|---|---|
| Response-mode resolver | Quick/Think exact model, level, and include-thoughts mapping |
| Model factory | Selected production model reaches `GoogleModel`; zero-arg injected seam and missing-key failure stay intact |
| Price/usage | Normal/long boundary, unknown model `None`, and synthetic Google thoughts are counted exactly once |
| Request validation | only `quick`/`think` accepted; omitted old field compatible; disabled Think is unavailable, not malformed |
| Config adaptation | duplicate/malformed/empty/default-missing modes degrade to safe Quick-only capability |
| Turn record | complete/error/park/cancel/timeout/shutdown/tool-budget records include matching mode/model; pre-meta cancel writes none |
| Signature history | Thinking signature/provider details survive evidence scrub + checkpoint dump/load + replay |
| Transcript adaptation | missing legacy mode maps Quick; present unknown mode renders unsupported and cannot regenerate |
| Meta reducer | live mode/model survive stream reconciliation |
| Transport | create/send JSON includes explicit normal-turn mode and omits it for clarify continuation |
| Mode menu | radio semantics, accessible name, disabled state, selection callback |

### 11.2 Registry and integration matrix

| Scenario | Expected result |
|---|---|
| Quick normal turn | Flash factory, MINIMAL, no provider thought summaries, Quick meta/record/cost |
| Think normal turn | Pro factory, HIGH, provider summaries when enabled, Think meta/record/cost |
| Omitted mode on old client | persisted session mode, or Quick for a legacy/default session |
| Concurrent send | 409; session mode/source/title unchanged |
| Capacity rejection | 503; session mode unchanged |
| Invalid mode | 422 before claim; no writes |
| Disabled Think | 503 before claim; no writes/model call |
| Pre-spawn persistence failure | claim released, safe response, no model call |
| Clarify resume with no mode | original mode inherited; current approved model resolved and recorded |
| Clarify resume with conflicting mode | 422; parked record remains resumable |
| Cancel partial Think run | one `done(cancelled)` and Think/Pro partial record |
| Timeout | one error terminal and captured mode/model record |
| Disconnect + attach | replayed meta restores correct mode/model |
| Buffer lost + transcript fallback | durable record restores correct mode/model |
| Regenerate | original assistant mode executes with replacement ID; sticky selection is unchanged |
| 409 recovery retry | no duplicate optimistic message; original captured mode reused |
| Post-meta Think failure | failed turn is replaceable; `Retry Think` and explicit one-off Quick make no duplicate user bubble |
| Injected steer | no new mode request; active model continues |
| Auto-forwarded steer | captured active mode used for the later new turn |
| Session switch during stream | stale callback cannot overwrite another session's mode |
| Mode cache lifecycle | test reset works; same-tick stale setter and mismatched commit cannot clear/overwrite current session |
| Think disabled after persistence | next-turn selection normalizes Quick with notice; active/parked/history stays truthfully Think |
| Both clarify inputs | inline widget and free-text composer omit mode |
| Active attach | execution mode restores from meta, then trigger returns to selected mode at terminal |
| Reload | persisted mode hydrates without Quick/Think flicker |

### 11.3 Live Google/PydanticAI gates

Run these intentionally; they incur provider cost:

1. Phase 0: one simple no-tool Quick request through the exact Express path.
2. Phase 0: one simple no-tool Think request through the exact Express path.
3. One tool-calling request in each mode.
4. One sequential multi-tool call in each mode, proving thought signatures are
   replayed inside the provider loop.
5. One conversation: Quick tool call → Think follow-up → Quick follow-up.
6. One Think clarification park/resume if the current agent exposes a real
   clarify path; otherwise cover the server inheritance deterministically and
   do not invent a fake provider behavior.
7. Confirm live `usage.output_tokens` remains consistent with the pinned
   response-plus-reasoning contract; do not add detail tokens again.
8. Observe Think's dynamic Express quota behavior without treating the smoke as
   a quota guarantee.

Never print API keys, thought signatures, full provider histories, or student
prompts in test output/artifacts.

### 11.4 Frontend integration + manual browser acceptance

Automate the state/protocol cases with existing Vitest component and hook
tests. Treat viewport, zoom, keyboard, and touch checks as a manual browser
acceptance smoke; `frontend/package.json` has no Playwright runner, and this
feature does not justify adding one.

1. New home composer starts at Quick.
2. Select Think with mouse, keyboard, and touch-sized target.
3. Send from home; routed chat begins in Think without a transient Quick send.
4. During streaming, the selector shows execution Think and cannot change; at
   terminal it returns to the selected next-turn preference.
5. Stop, retry, and regenerate preserve execution mode without changing the
   sticky selection.
6. Send a Quick follow-up in the same chat; only the next turn changes.
7. Reload and confirm the chat remains Quick.
8. Open another chat with Think and switch between sessions; neither preference
   leaks into the other.
9. Exercise narrow mobile width, 200% zoom, focus return, Escape, arrow keys,
   and reduced motion.
10. Simulate pre-`meta` unavailability and post-`meta` Pro 429/503: the error is
    actionable, no Flash answer is mislabeled Think, and explicit one-off Quick
    replacement succeeds.

### 11.5 Eval comparison

Run the same eval cases twice with an explicit response-mode override:

- existing answer/citation quality metrics;
- data-honesty failures as a hard gate;
- tool selection and tool-call count;
- response completeness and instruction following;
- median and p95 latency;
- token and estimated-cost distribution;
- malformed/unsupported visualization rate;
- clarification quality where applicable.

Do not declare Think "better" from generic benchmarks. Ship it because the
Counselle eval shows a worthwhile quality/depth tradeoff on complex admissions
questions. Quick must remain trustworthy enough for the default path.

## 12. Failure and rescue registry

| Failure | User-visible risk | Prevention | Rescue |
|---|---|---|---|
| Client sends arbitrary model | cost/security bypass | enum-only request; server mapping | 422 without claim or writes |
| Express path cannot call exact models | shipped selector advertises fiction | Phase 0 exact-key smokes | stop before implementation; explicit provider decision |
| Pro preview unavailable/429 | Think hangs or generic failure | target-env smoke; dynamic quota awareness | structured error; Retry Think or explicit Quick replacement |
| Quick still requests thoughts | unexpected latency/cost and misleading UI | per-mode `include_thoughts=False` | resolver unit test and live usage comparison |
| Metadata says Flash while Pro ran | billing/audit lie | resolve once on `_Turn`; thread actual model everywhere | invariant tests on factory/meta/record/usage |
| Mode changes during clarify | provider/history discontinuity | inherit parked record; reject conflict | leave parked record untouched and resumable |
| Thought signatures stripped | Gemini 400 during tools | preserve PydanticAI full messages | cross-mode sequential-tool live test |
| Retry reads current selector | failed Quick silently retries as Think | capture mode in `PendingSend` | retry snapshot test |
| Post-meta error has no retry | failed Think dead-ends after SSE terminal | carry snapshot into stream consumer + structured code | history-rewrite failed turn; no duplicate bubble |
| Regenerate changes preference | old Think answer makes future turns Think | separate selected/execution modes; never persist replacement | replacement/stickiness invariant test |
| Queued steer loses mode | later turn uses unrelated preference | queue `{text, mode}` immutably | auto-forward integration test |
| Reattach loses mode | selector disagrees with active stream | replay meta, transcript fallback | attach/reload tests |
| Mode write fails after detached spawn | 500 plus untracked answer | persist in guarded post-claim/pre-spawn section | release claim; no task/model call |
| Rejected send changes sticky mode | UI/server drift | persist only normal turns before spawn | 409/422/503/no-write tests |
| Legacy record missing fields | transcript crash | optional fields + Quick compatibility fallback | legacy protocol fixture |
| Future record has unknown mode | regenerate silently falls back | render unsupported; disable regenerate | user-safe explanation |
| Long-context Pro underpriced | misleading observability | tiered price schedule at 200K | boundary tests and documented estimate |
| Duplicate composer implementations drift | home and chat behave differently | one shared `ResponseModeMenu` | component mounted in both page tests |
| Preview label omitted | student assumes stable model | secondary `Preview` disclosure | config/UI contract test |
| Silent fallback | student receives different quality than chosen | no fallback model | provider failure test asserts no Flash call |

## 13. Security and privacy checks

- Validate mode at HTTP, DB, checkpoint, and transcript boundaries.
- Never accept model/provider/thinking settings from the browser.
- Preserve existing session ownership checks before reading or mutating sticky
  mode.
- Parameterized SQL only.
- Do not log prompts, source payloads, API keys, model history, provider error
  bodies, or thought signatures.
- Ensure config exposes only presentation-safe model identifiers, never
  credentials or quota details.
- Rate limiting continues to apply per message endpoint. Observe Think load
  before inventing a separate quota.
- Error copy must not include raw provider messages or tracebacks.

## 14. Rollout and rollback

### Rollout

1. Land migration and backward-compatible backend fields first if deployment is
   split; old clients omit mode and continue with session/Quick behavior.
2. Verify both model calls in the target environment.
3. Deploy frontend selector with Quick default.
4. Watch Think 429/503 rate, latency, cancel rate, token cost, and feedback.
5. Keep `COUNSELLE_MODEL_COUNSELOR_THINK` configurable so the preview successor
   can be changed without touching turn-lifecycle code.

### Emergency disable

Do not silently remap Think to Flash. If the preview becomes unusable, remove
Think from the advertised `response_modes` capability list through an explicit
configuration flag or deployment setting and leave existing historical records
truthful. The UI then shows Quick only for new turns; old Think messages still
replay with their recorded mode/model.

Use the planned `response_mode_think_enabled: bool = True` switch for this honest
disable path. The model resolver still rejects disabled Think requests
server-side, because stale clients may continue to send them.

### Database rollback

Rollback the application before dropping the column. Historical turn records
already contain mode/model in checkpoint state and remain forward data; old code
ignores the extra keys. Drop `sessions.response_mode` only after no deployed code
selects it.

## 15. Documentation decisions

Implementation changes an accepted architectural default, so documentation is
part of shipping:

- Add an ADR for user-selected counselor response modes. It should supersede the
  single-default-model parts of ADR 0011 and clarify ADR 0028's
  `thinking_stream`: the flag gates native thought-summary requests for Think;
  it is not the response-mode selector.
- Update `docs/adr/README.md`.
- Update `docs/ARCHITECTURE.md` model/config, protocol, session, frontend, usage,
  and testing sections.
- Update `specs/mvp2/plan/wire-contract.md` additively; do not rewrite shipped
  historical narrative elsewhere.
- Update environment/deploy references with
  `COUNSELLE_MODEL_COUNSELOR_THINK` and the honest-disable flag.
- Record current model IDs, preview status, thinking levels, pricing date, and
  lifecycle source links. Treat prices and preview lifecycle as time-sensitive.

### Authoritative implementation references (verified 2026-07-22)

- [Vertex Express Mode available models and rate limits](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview)
- [Gemini 3.5 Flash model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash)
- [Gemini 3.5 Flash thinking, history, and migration behavior](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5)
- [Gemini 3.1 Pro Preview model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview)
- [Gemini thinking levels and thought signatures](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Agent Platform global Standard pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
- [Gemini model lifecycle/deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

Also inspect the **installed**, pinned PydanticAI/google-genai source during
implementation for `GoogleCloudProvider`, `GoogleModelSettings`, usage
extraction, `ThinkingPart`, and `ModelHTTPError`; online docs can move ahead of
the versions actually running in this repo.

## 16. Acceptance criteria

The feature is ready only when all are true:

- Both composers show the same accessible Quick/Think selector beside Sources.
- Quick is default for new chats and sticky per existing chat.
- Selected next-turn mode and immutable execution mode never overwrite each
  other; regenerate/clarify/steer do not change stickiness.
- Quick invokes exactly Gemini 3.5 Flash with `MINIMAL` and no requested provider
  thoughts.
- Think invokes exactly Gemini 3.1 Pro Preview with `HIGH` and requested provider
  thoughts when `thinking_stream` is enabled.
- Browser requests cannot select arbitrary models or thinking parameters.
- Meta, transcript, turn record, usage, logs, and cost report the model actually
  invoked.
- Clarify, retry, cancel, detach/reattach, history rewrite, regenerate, steering,
  reload, and session switching preserve the specified mode semantics.
- Thought signatures survive tool loops and cross-turn model switching.
- Invalid/rejected requests do not mutate sticky mode.
- A failed preference write releases the claimed turn before spawn and makes no
  model call.
- Pro failures never silently fall back to Flash.
- Pre- and post-`meta` model failures expose structured recovery; retry does not
  duplicate the user message.
- Current pricing and the >200K Pro tier are represented honestly.
- Legacy sessions, records, protocol fixtures, and clients remain compatible.
- Present unknown historical modes render safely and cannot silently regenerate
  as Quick.
- Routine backend checks, frontend typecheck/tests, targeted live smokes, and the
  two-mode eval comparison pass.
- Living architecture/wire docs and the new ADR match the shipped behavior.
- No unrelated dirty-worktree files are modified.

## 17. Verification commands

Routine backend:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check .
uv run mypy .
```

Frontend:

```bash
cd frontend
npm run typecheck
npm test
```

Targeted live checks should be added to the existing marker scheme and invoked
explicitly so cost is intentional. The full eval remains:

```bash
uv run python -m evals.runner
```

Store browser screenshots, model comparison reports, or logs under `artifacts/`,
never the repository root or source/doc directories.

## 18. GSTACK REVIEW REPORT — technical review

Two independent read-only reviewers inspected the plan against the current code.
No reviewer edited the repository; their findings were adjudicated and folded
into the plan above.

### Reviewers

1. Backend/provider/lifecycle reviewer — inspected Settings, PydanticAI/Google
   construction, registry claim/spawn ordering, persistence, graph/checkpoint
   state, records, usage, migrations, exceptions, and lifecycle tests.
2. Frontend/protocol/UX reviewer — inspected config/transport contracts,
   transcript mapping, both composer paths, chat hydration, turn retries,
   clarify/steer/regenerate/attach behavior, shared menu primitives,
   accessibility, and the existing test harness.

### Incorporated findings

- Added Phase 0 because the target Express table currently omits 3.5 Flash;
  exact-key/model reachability must pass before implementation.
- Moved sticky-mode persistence into the registry's guarded post-claim,
  pre-spawn section, including claim release/no-model-call failure behavior.
- Preserved the shared zero-argument injected `model_factory`; only production
  counselor construction receives a selected model.
- Resolved parked continuation policy: inherit mode, re-resolve the current
  approved model, and record the actual replacement model.
- Made record plumbing exact across agent-node, shared terminal builders, and
  registry-captured meta identity, including pre-meta cancel behavior.
- Pinned PydanticAI usage semantics so thought tokens cannot be double-counted;
  specified a JSON-compatible nested price schedule and dated global rates.
- Separated sticky selected mode from per-attempt execution mode so regenerate,
  retry, clarify, steering, and attach cannot overwrite preference.
- Added post-`meta` SSE error recovery with structured error codes, immutable
  request snapshots, history rewrite, and explicit same-mode/Quick actions.
- Distinguished missing legacy modes from present unsupported future modes;
  unsupported history renders but cannot silently regenerate.
- Added disabled-Think normalization, presentation-safe model display names,
  both clarification call paths, exact local-state preservation rules, and
  stale-session/cache regressions.
- Required the existing Base UI Menu family and shared coarse-pointer Button
  behavior; removed assumptions about a Radix wrapper or unverified animation.
- Kept response mode out of the sidebar list protocol because it has no current
  consumer; create/detail and execution surfaces carry it. This is the one
  deliberate KISS resolution of differing reviewer recommendations.

### Residual risks

1. `gemini-3.5-flash` is GA but is absent from Google's current Express Mode
   table. Phase 0 may block the feature until Google or the auth path changes.
2. `gemini-3.1-pro-preview` is a preview endpoint with dynamic Express quota and
   can change or retire; the disable switch and configurable mapping are
   mandatory operational escape hatches.
3. Cross-model history, thought signatures, and structured output plus tools
   are provider-sensitive. The plan requires live tool/cross-model gates because
   static type checks cannot prove provider acceptance.
4. Source-config/title persistence already happens after detached spawn in the
   current code. This plan deliberately does not refactor that unrelated path;
   response mode must not copy or worsen it.
5. Responsive/touch/zoom verification remains a manual browser acceptance smoke
   because the frontend has no Playwright runner; automated state and protocol
   coverage stays in the existing Vitest suite.
