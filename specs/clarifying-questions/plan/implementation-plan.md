# Clarifying Questions — implementation plan

Date: 2026-07-22  
Status: shipped; graduated to specs on 2026-07-23  
Depends on:
- ADR 0016 (versioned SSE protocol)
- ADR 0019 (durable LangGraph/Postgres sessions)
- ADR 0022 (legacy clarify/resume lifecycle; partially superseded by this work)
- ADR 0025 (single terminal-persistence owner)
- ADR 0028 (the run is the message)
- `plans/agent-interactivity-parity.md`

## Outcome

Counselle may pause only when missing information would materially change its
answer. The pause appears as an inline, accessible question bundle inside the
assistant transcript. The student can answer one to three choose-one or
choose-many questions, use a custom answer for any question, or reply through
the ordinary composer.

The question bundle never disappears. While pending it is interactive; once
accepted it transforms in place into a compact, readable question-and-answer
record. The agent then continues without replaying any model or workspace tool
work that happened before the question.

This plan deliberately does **not** revive the legacy LangGraph
`interrupt()`-backed `ask_student`. Agent V1 removed that path because resuming
re-executed the whole PydanticAI node and could repeat workspace writes. The new
path uses a PydanticAI structured **output tool**, completes the first model run
normally, persists its provider history, then starts a distinct continuation
run from that completed history.

## Scope

### In scope

- A model-facing `ask_student` structured output with a deliberately small,
  bounded schema.
- One clarification episode containing one to three required questions.
- Choose-one and choose-many questions, each with two to five suggested
  options and code-owned “Something else” input.
- Structured widget submission and ordinary composer reply.
- Durable pending, answered, cancelled, error, reload, reattach, and multi-tab
  behavior.
- A v2 clarification contract with full v1 transcript/checkpoint readability.
- Transcript-native rendering, keyboard and screen-reader behavior, mobile
  behavior, focus/scroll rules, retry states, and reduced motion.
- Focused backend, frontend, protocol, lifecycle, and eval regressions.
- A new ADR and living architecture documentation.

### Out of scope

- Open-ended form fields authored by the model.
- Dates, ranking, file upload, school picker, numeric input, branching logic,
  optional fields, or arbitrary form schemas.
- More than one clarification round during the same logical continuation.
- Asking questions that merely make a decent answer marginally better.
- A modal, drawer, full-page wizard, or profile/intake workflow.
- Editing a submitted clarification response. A correction is a normal
  follow-up message.
- New application tables or any write to the read-only CDS Library database.
- Distributed turn execution beyond the existing `TurnRegistry` guarantees.

## Current code truth

The implementation must start from these facts, not from the old visual mock:

1. `domain/specs.py` has a v1 `ClarifySpec` for one question, two to four
   options, an agent-authored header, and a `multi_select` flag. Its strings are
   currently unbounded.
2. `app/clarify.py` calls LangGraph `interrupt()`, but Agent V1 does not mount
   that tool. `config/assets/prompts/counselor.md` explicitly tells the model
   not to stop for clarification.
3. `app/agent_node.py` drives pinned `pydantic-ai==1.107.0` through
   `Agent.iter(...)`. The run already snapshots safe, completed provider
   history and uses `end_strategy="early"` behavior.
4. The old compatibility resume reuses the parked assistant `message_id`,
   replaces its record, and synthesizes the answer bubble. That record model
   cannot provide correct chronology for the new UX.
5. `app/records.py` and the frontend reducer already use ordered `segments[]`
   for live/reload parity. Clarification is still top-level metadata and is
   rendered after all existing segments.
6. The current `ClarifyWidget.tsx` supports one question, toggle-button
   semantics, immediate single-choice submission, a comma-joined multi-answer,
   and a faded frozen state. None is a safe foundation for v2 behavior.
7. `MessageBody.in_reply_to` already exists but is ignored. It is the correct
   stale-widget guard for clarification submissions.
8. The turn registry already claims one active operation per session and
   inherits selected skills for legacy parked answers. Source configuration
   still needs the same inheritance rule.
9. `app.titles._first_exchange()` currently accepts the first assistant entry
   even when its text is blank; a clarification-only first assistant message
   would block automatic title generation.
10. Shipped files under `specs/mvp2/` and `specs/agent-mode/` are historical
    records. They must not be rewritten to describe this future behavior.

## Locked product and interaction rules

These are acceptance criteria, not suggestions.

### When the agent asks

- Ask only when the missing answer materially changes the work or prevents an
  honest answer.
- Make a reasonable, disclosed assumption when that is safe.
- Never ask for information already present in the conversation or workspace.
- Use ordinary prose for open-ended, sensitive, unbounded, or merely helpful
  context.
- Default to one question. Batch two or three only when they are independent
  and already known to be necessary.
- Never batch a later question whose wording or options depend on an earlier
  answer.
- A logical continuation may not ask a second clarification bundle. Code, not
  prompt wording alone, enforces this.

### What the agent authors

The agent supplies only:

- a direct, neutral question;
- `single` or `multiple` selection intent;
- two to five short option labels;
- optional, concise hints explaining the consequence of a choice.

The product owns the heading, progress, controls, “Something else,” input
label, button copy, status copy, answer summaries, IDs, and version fields.
The model never authors an “Other” option, decorative header, recommended
choice, required marker, button, or layout instruction.

### Active widget

- Inline in the assistant transcript at normal answer width; never modal.
- One cohesive question bundle, not stacked nested cards.
- One active question expanded. Completed questions collapse to an answer
  summary with Edit; upcoming question prompts remain visible and compact.
- One question uses no unnecessary progress chrome. Two or three show “1 of
  3” in quiet supporting text.
- Suggested answers are full-width option rows with label and optional hint.
- Single choice uses real radio semantics. Multiple choice uses checkbox
  semantics and the instruction “Choose all that apply.”
- Selecting an option never submits and never auto-advances.
- `Next` advances locally; the final action is `Send answers`.
- Keep `Next`/`Send answers` activatable: an invalid attempt reveals and
  announces the inline error and focuses the first invalid question rather
  than failing silently behind a disabled button.
- “Something else” reveals a visibly labelled, auto-growing textarea.
- For single choice, a nonblank custom answer is exclusive with the preset
  choice. Preserve its draft if the student temporarily switches back to a
  preset. For multiple choice, custom text may supplement presets.
- Enter inserts a newline in custom text. Only the explicit action submits.
- The ordinary composer remains available with “Answer above, or reply in
  your own words…” and is the free-form answer path for the whole bundle.
- Skill and source controls are hidden while clarification is pending; the
  composer helper explains that this reply answers the existing question. A
  continuation cannot change its tool surface, and neither request field is
  submitted.

### Accepted and historical widget

- The same widget stays at the exact transcript position where it appeared.
- It becomes a compact Q→A record, not disabled controls and not a faded form.
- A widget submission creates no duplicate user bubble.
- A composer reply remains a normal user bubble between the question message
  and continuation message; the widget says it was answered in the reply.
- An accepted answer remains answered even if downstream continuation errors,
  times out, or is cancelled.
- An unanswered cancellation says “Not answered.”
- Historical answers may expand for exact details, but are not editable.
- Render model-authored prompts/options/hints and student custom text only as
  escaped plain text (`whitespace-pre-wrap` where line breaks matter), never as
  Markdown or HTML. Only the deterministic copy serializer emits Markdown.

### Accessibility, mobile, focus, and motion

- Use a named form region, fieldset/legend or equivalent accessible group,
  native radio/checkbox behavior, visible focus rings, and 44px minimum targets.
- Errors are adjacent to the relevant question and announced. Busy and
  accepted changes use a polite live region without narrating every selection.
- Give each question heading a programmatic focus target (`tabIndex={-1}`) and
  associate it with its fieldset; legends alone are not reliably focusable. On
  `Next`, focus the next heading. On Edit, focus the edited heading.
  On acceptance, focus remains stable; the resumed assistant stream uses the
  existing live-region behavior rather than stealing focus.
- The widget scrolls only enough to keep the active question/action visible;
  it must not jump the whole transcript or fight the software keyboard.
- Mobile stays one column inside the conversation scroll, honors safe areas,
  uses 16px minimum textarea text, and never horizontally scrolls.
- State transitions are 150–200ms at most and are removed under
  `prefers-reduced-motion`.
- Pending drafts survive question navigation, send failure, and harmless
  rerenders. They do not leak across session/message/spec identity.

## Architecture decision

### 1. `ask_student` is an output tool, not an interrupt or function tool

Configure the normal agent with a structured PydanticAI output:

```python
Agent(
    ...,
    output_type=[
        str,
        ToolOutput(ClarifyDraftV2, name="ask_student", ...),
    ],
    end_strategy="early",
)
```

Why this seam:

- PydanticAI processes output tools before ordinary function tools.
- With `end_strategy="early"`, sibling function calls in the same model
  response are returned as skipped rather than executed. A workspace write
  cannot race the clarification output.
- The first run finishes with complete, provider-valid message history; there
  is no dangling tool call and no replay on continuation.
- The output is typed at the model boundary and can be retried by PydanticAI if
  the model emits an invalid shape.
- The clarify surface remains excluded from the ordinary tool timeline because
  the widget itself is the presentation.

Before production code, add a narrow installed-version characterization test
that proves all of the above against `pydantic-ai==1.107.0`, including a model
response that contains `ask_student` beside a workspace function call. If the
pinned behavior differs, stop this implementation slice and update the ADR;
do not fall back to LangGraph `interrupt()`.

### 2. The clarification and continuation are separate assistant records

The root assistant message (`A1`) owns all work up to and including the
question bundle. The continued answer (`A2`) is a new assistant message linked
to `A1`.

```text
Widget answer
U1 original request
A1 pre-question work + pending widget
A1 same durable record, widget now answered
A2 continued work + final answer

Composer answer
U1 original request
A1 pre-question work + pending widget
A1 same durable record, widget now “answered in reply”
U2 ordinary composer reply
A2 continued work + final answer
```

This is cleaner than replacing A1 with A2:

- A1 never disappears while A2 streams.
- The question remains after any pre-question steps/narration and before the
  reply/continuation.
- Widget answers do not require a synthetic user message.
- Composer answers use the existing normal user-message projection.
- The original U1 remains the editable root. U2 is immutable as a
  clarification reply; correction is a new turn.
- Feedback, copy, error, cancel, and partial-stream state for A2 remain normal.

A1 is an interaction record, not a final answer. Suppress its ordinary action
row in pending, answered, and cancelled states. A2 keeps feedback/copy but not
Regenerate for this slice. The expandable historical summary itself provides
access to A1's exact questions and answers.

Add `continuation_of: str | None` to a turn record. Do not overload
`replace_message_id`, `synthesized_answer`, or ID absence with this meaning.
Legacy v1 records keep their existing replacement/synthesized projection.

### 3. Clarification is an ordered segment inside A1

Add `clarify` to the ordered emission/segment vocabulary:

```json
{
  "kind": "clarify"
}
```

The spec and response have one source of truth on A1's top-level `clarify`
record; the segment is only a pointer locating that record in chronology. The
frontend resolves it against the message-level record. Do not persist two spec
copies that can drift.

An example A1 sequence is:

```text
[narration, step, step result, narration, clarify]
```

`build_segments`, transcript fallback normalization, the SSE reducer, reload
adapter, renderer, and whole-run Markdown serializer must all understand this
kind. `parts` remains final-answer/viz compatibility data and does not absorb
the widget.

### 4. Answer acceptance is durable before continuation begins

Under the session's existing registry claim:

1. Load the latest pending v2 A1 and validate `in_reply_to`.
2. Validate the structured widget response against A1's stored spec, or record
   the exact bounded composer text.
3. Inherit A1's selected skills and stored source-configuration snapshot.
4. Immutably update A1 from pending to answered **and** write a distinct
   `ContinuationIntent` in one `graph.aupdate_state` call. If this write fails,
   leave A1 pending and return a retryable error.
5. Start A2 with a new assistant `message_id`, `continuation_of=A1`, and the
   completed provider history from A1.
6. Only after the durable acceptance succeeds, emit A2's `meta`, then a
   replayable `clarify_response` acknowledgement, then A2's ordinary events.

For v2 continuation only, delay the current early `meta` emission until the
acceptance prewrite has succeeded; `meta` alone must never make a pending
widget look accepted. The acknowledgement is authoritative live state for the submitting tab,
another attached tab, and SSE-buffer replay. The durable transcript is the
authoritative reload state. Do not emit an actionable initial `clarify` event
until A1's awaiting-input record and completed provider history have committed.

The pre-accept boundary is retryable: draft remains interactive. Once the
durable response write succeeds and `clarify_response` is emitted, the answer
stays accepted even if A2 later fails.

`ContinuationIntent` is not a second copy of the clarification. A1 remains the
only source for the spec and response; the intent stores only continuation
lifecycle/identity needed to recover safely:

```text
v, phase (accepted | running), root A1 ID, planned A2 ID,
internal trigger request ID, response origin, inherited skills/source snapshot
```

The model payload is reconstructed deterministically from A1's validated
response. The intent is written atomically with answer acceptance and cleared
only in the same terminal update that commits A2. If the process dies while
the intent is still `accepted`, an idempotent retry resumes the same planned A2
instead of rejecting the already-stored answer. Immediately before the first
A2 model request, mark it `running` durably.

A hard process death after `running` is the existing mid-agent crash boundary:
do not silently replay A2 because completed workspace writes may not have made
it into a safe checkpoint. On reload, project an interrupted-continuation
recovery state beside the already-accepted A1 and let the student explicitly
start a normal “continue” follow-up. Graceful shutdown, cancel, timeout, and
ordinary errors still use the current terminal persistence path and clear the
intent. Test both restart boundaries: `accepted` resumes the same A2;
`running` never auto-replays tools. Exact hard-crash mid-node recovery is a
system-wide durability project, not hidden inside clarification.

Keep top-level `pending_clarify` legacy-only/`None` for v2. Native v2 pending
detection is exactly: the latest turn record is `awaiting_input`, has a v2
clarification, and has no accepted response. `ContinuationIntent` represents a
different accepted-but-not-terminal lifecycle and never duplicates the spec or
answer.

### 5. A2 is a fresh Pydantic run over completed history

A2 appends a server-rendered user request to A1's completed provider history.
It never calls LangGraph `Command(resume=...)` and never re-executes A1.

For a widget response, render a compact, deterministic model-facing payload
from stored labels plus validated custom text. Never trust labels submitted by
the browser. For a composer response, preserve the student's exact validated
text. This prompt is content transport, not a new instruction hierarchy.

A2 carries two separate input surfaces through `_Turn`, `TurnRegistry.start`,
`run_turn`, `_prepare_turn_input`, partial/error anchoring, and terminal record
building:

- `model_input_text`: the server-rendered contextual payload sent to the model;
- transcript identity: exact optional `record_user_text`, user ID, response
  origin, and `project_user` flag.

For widget origin, `record_user_text=None` even on cancel/error/timeout. For
composer origin, the model receives contextual transport while the transcript
projects the exact U2 text/ID once. Never let the server-rendered model payload
become an editable user bubble or record anchor. `continuation_of=A1` is a valid
anchor for an otherwise userless terminal A2.

A2's output type is `str` only. The same restriction applies to the legacy v1
compatibility resume. `ask_student` is absent from both advertised output
schemas, so a second clarification round is impossible even if the prompt is
ignored. A2 inherits A1's skills and source configuration and cannot accept new
selections or source toggles.

## Versioned contracts

The SSE envelope stays protocol v1. The nested clarification payload owns its
version.

### Model draft and public spec

Keep the existing v1 models/readers for historical records, but tighten the v1
version field wire-compatibly to `Literal[1] = 1`. Add strict, frozen v2 models
with `extra="forbid"` and named limits in one domain module. A version-aware
dispatcher treats a missing `v` as legacy v1, dispatches literal 1/2, and
rejects malformed or unknown versions; do not depend on a loose discriminated
union accepting the current `v: int` model.

```python
class ClarifyOptionDraft(BaseModel):
    label: NonBlankBoundedText
    hint: NonBlankBoundedText | None = None

class ClarifyQuestionDraft(BaseModel):
    question: NonBlankBoundedText
    selection: Literal["single", "multiple"]
    options: list[ClarifyOptionDraft]  # 2..5

class ClarifyDraftV2(BaseModel):
    questions: list[ClarifyQuestionDraft]  # 1..3

class ClarifySpecV2(BaseModel):
    v: Literal[2] = 2
    questions: list[ClarifyQuestionV2]
```

Every model-correctable rule—blank/bounded strings, question/option counts,
case-insensitive duplicate labels, and reserved labels—lives in
`ClarifyDraftV2` validators so PydanticAI can retry the output tool. The output
type is consistently `ToolOutput(ClarifyDraftV2, name="ask_student")`.
Post-result normalization is total and performs code-owned ID assignment only;
it must not discover an error after the model run has already ended.

Normalization converts a validated model draft into the public spec and
assigns positional IDs in code:

- questions: `q1`, `q2`, `q3`;
- options: `q1_o1`, `q1_o2`, ...;
- trim surrounding whitespace but preserve meaningful internal wording;
- treat a missing hint as absent, not an empty string;
- do not require the model to generate IDs or a version.

Use conservative named limits, confirmed during implementation against prompt
and API limits: question 240 characters, label 80, hint 160, custom answer 1000,
composer clarification reply 4000, and an overall structured payload cap.
These are contract constants, not environment settings.

### Stored clarification record

```python
class PendingClarificationV2(BaseModel):
    spec: ClarifySpecV2
    response: ClarifyResponseV2 | None

class WidgetClarifyResponseV2(BaseModel):
    v: Literal[2] = 2
    mode: Literal["widget"]
    answers: list[ClarifyAnswerV2]

class ReplyClarifyResponseV2(BaseModel):
    v: Literal[2] = 2
    mode: Literal["reply"]
    text: str
    user_message_id: str
```

Widget answer validation is cross-field validation against A1's stored spec:

- exactly one answer per stored question;
- no missing, duplicate, or unknown question IDs;
- no duplicate or unknown option IDs;
- `single`: exactly one preset **or** nonblank custom text, never both;
- `multiple`: at least one preset and/or nonblank custom text;
- selected labels are resolved from the stored spec, never accepted from the
  client;
- custom wording is preserved verbatim after nonblank/length validation;
- the total payload is bounded before persistence or model use.

Do not serialize answers as a comma-joined string. A presentation summary and
the model-facing continuation payload are derived views of the structured
record.

### POST message request

Extend the existing `POST /v1/sessions/{session_id}/messages` body rather than
adding another endpoint. The body must select exactly one submission mode:

```text
normal turn:
  text
  optional skills/source_config/replace_message_id

widget clarification:
  clarify_response(mode=widget, answers=...)
  required in_reply_to=A1.message_id

composer clarification:
  text
  in_reply_to=A1.message_id from new clients
```

Rules:

- Structured clarification plus `text`, skills, source changes, or
  `replace_message_id` is invalid.
- `in_reply_to` must match the latest pending v2 assistant message under the
  registry claim.
- A stale, duplicate, already-answered, or mismatched structured response is a
  state conflict and leaves checkpoint state untouched.
- A structured response never falls through as a normal new message.
- For compatibility, a text-only request with omitted `in_reply_to` still
  answers the latest legacy or v2 pending clarification. New clients always
  send the ID.
- Source configuration is not persisted from an answer request; the
  continuation inherits the parked value.

Use one stable conflict envelope/status already understood by the client. Add
an application error code (for example `clarification_stale`) so the frontend
can distinguish this from an ordinary active-turn conflict without parsing
copy.

### SSE additions

Keep the current initial `clarify` event, now accepting v1 or v2 nested specs.
Add one acknowledgement event for continuation streams:

```json
{
  "v": 1,
  "type": "clarify_response",
  "data": {
    "clarify_message_id": "A1",
    "continuation_message_id": "A2",
    "response": { "v": 2, "mode": "widget", "answers": [] }
  }
}
```

It is emitted immediately after A2's `meta`, stored in the turn registry replay
buffer, and updates A1 rather than becoming an A2 content segment. Never place
custom text in logs. The transcript remains the reload source of truth.

Every physical A2 still gets an internal trigger-request UUID because current
`MetaData.user_message_id` is required. Extend meta/record identity explicitly
with `project_user`, `response_origin`, `continuation_of`, and
`editable_root_message_id`; do not infer widget origin from a missing ID or
overload A1's ID. Widget A2 sets `project_user=false`; composer A2 projects U2.

Reattach also needs a cursor-independent active-turn identity bootstrap. Today
a `Last-Event-ID` after `meta` can cause `attachActiveTurn` to seed from
transcript-tail A1 and merge later A2 deltas into it. Make the active registry
identity available on every attach—by an unsequenced meta snapshot, response
metadata, or an equivalent explicit bootstrap—regardless of the replay cursor.
The transport must establish A2's real assistant/trigger/root identity before
reducing any replayed content event.

### Turn-record identity

For v2:

- A1 retains U1's `user_message_id`, original `user_text`, `messages_offset`,
  skills, `source_config` snapshot, and message ID.
- A1 status is `awaiting_input` while pending, then `complete` when accepted or
  `cancelled` when dismissed.
- A2 receives a new message ID and `continuation_of=A1.message_id`.
- Widget-origin A2 has no user text/user ID projection.
- Composer-origin A2 points to U2 and projects exactly one ordinary user entry.
- Both carry an internal trigger-request ID; `project_user` alone controls
  transcript projection.
- U1 edit truncates A1 and every continuation after it.
- U2 is marked as a clarification reply and is not an edit/regenerate target.
- A1 and its linked A2 never offer Regenerate in this slice. A deliberate U1
  Edit may truncate the whole chain; continuation regeneration is future work.
- Legacy v1 records preserve `synthesized_answer` and replace-on-resume
  projection.

## Backend implementation slices

### Phase 0 — prove the runtime seam

Add a focused characterization test using PydanticAI `FunctionModel` and the
pinned package:

- valid output becomes typed `ClarifyDraftV2`;
- invalid output receives a model retry;
- `end_strategy="early"` skips sibling read and write function tools;
- `result.all_messages()` contains the output-tool call followed by Pydantic's
  synthesized output-tool `ToolReturnPart`, passes the pinned Google model's
  offline request mapper, and can seed a second `Agent.iter`;
- the second run sees the answer and no first-run function is executed again.

Gate: do not implement the lifecycle until this passes.

### Phase 1 — strict domain contracts

In `domain/specs.py` or a focused `domain/clarification.py` imported from it:

- retain v1 unchanged for read compatibility;
- add draft/spec/response v2 models and limits;
- add v1/v2 discriminated parsing;
- add normalization/ID generation;
- add response-against-spec validation;
- add pure presentation-summary and model-payload projection helpers.

Keep every transformation immutable. Do not scatter question limits between
the API, agent tool, and frontend.

### Phase 2 — agent output and atomic A1 persistence

Create a focused application module for clarification authoring/lifecycle; keep
`app/agent_node.py` as wiring:

- register `ToolOutput(..., name="ask_student")` only on normal runs;
- make `end_strategy="early"` explicit;
- replace the prompt's current “do not stop” rule with the locked authoring and
  judgement rules;
- when the result is `ClarifyDraftV2`, normalize it, append a `clarify`
  emission, and build status `awaiting_input` rather than `complete`;
- bypass `_empty_resolve_completion()` for a clarification result so a prior
  `resolve_school` step cannot synthesize a false final `delta`;
- if a valid `render_viz` was staged before the clarification output, flush it
  deterministically into A1 immediately before the clarify pointer; never lose
  staged visible work merely because the run ended in a question;
- persist completed Pydantic messages, usage, sources, ordered prefix segments,
  and A1 in the same agent-node state update; A1's versioned clarification
  record is the v2 source of truth, so do not duplicate its spec/response in a
  second pending-state object;
- return no final-answer `delta` for the output-tool result;
- make `run_turn` use the exact post-commit event order `clarify` → `sources` →
  optional `usage` → `done(awaiting_input)`, so pre-question citations remain
  honest and `TurnRegistry._observe()` retains cost telemetry;
- retain the old `__interrupt__` reader only for legacy checkpoint compatibility.

Do not expose `ask_student` as a normal step and do not add it to tool labels.

### Phase 3 — acceptance and A2 continuation

Add a small clarification lifecycle service used by the registry and runner:

- classify normal, widget-answer, composer-answer, legacy-answer requests;
- claim the session before reading pending state;
- validate target/status/payload without mutation;
- inherit skills and the source-config snapshot from A1;
- carry `model_input_text`, exact transcript text/ID, `project_user`, origin,
  and continuation/root IDs as separate fields through every happy/partial/
  terminal path;
- immutably update A1 to answered and create `ContinuationIntent` with one
  `graph.aupdate_state`;
- return a prepared continuation containing completed message history,
  deterministic model payload, A1/A2 IDs, origin, and transcript projection
  metadata;
- run A2 with text-only output and `continuation_of` metadata;
- route A2 cancel/error/timeout through the existing terminal persistence owner.

A2 is an intentionally userless assistant continuation for widget-origin
answers. Update the existing ghost-turn guard so `continuation_of` is a valid
durable anchor even when A2 has no `user_text` and streams no prose before an
error; do not silently drop that terminal record.

Use an explicit per-session operation/turn phase (`preparing` → `streaming` →
`finalized`) so all pending transitions share one serialization boundary:

- insert the claim synchronously before any checkpoint `await`;
- serialize pending cancel/delete against answer acceptance with the same claim;
- cancel before answer commit freezes A1 cancelled/unanswered;
- cancel after answer commit cancels A2 and preserves A1 answered;
- while `preparing`, attach must return a bounded retry/ready result rather than
  follow an unstarted empty buffer;
- every preparation failure closes/finalizes its buffer, releases its claim,
  leaves A1 pending if no commit occurred, and cannot strand followers;
- bound checkpoint preparation I/O with the existing turn timeout discipline.

Answer-shaped requests must be classified before the ordinary `StreamActive`
branch. A double/stale submit while A2 is active returns the typed clarification
conflict and never reaches generic 409 cancel-and-retry behavior. The claim must
cover validation, acceptance intent, and A2 task registration.

### Phase 4 — records, transcript, title, history rewrite

- Extend `Emission`/`build_segments` with `clarify`.
- Add `continuation_of` and v2 response metadata to records.
- Add an immutable helper that updates only the latest matching pending A1.
- Restrict `append_or_replace` and `synthesized_answer` to legacy v1 behavior.
- Project widget A1, optional U2, and A2 in correct order.
- Make reload and live render the same segment sequence.
- Update history rewrite so editing U1 removes A1, U2 if any, and linked A2;
  reject regenerate/edit of a clarification reply.
- Expose `editable_root_message_id=U1` for deterministic chain ownership and
  action gating, but hide/reject Regenerate on A1, U2, and A2. Only deliberate
  U1 Edit truncates this chain in this slice.
- Freeze unanswered A1 on cancel without starting a task.
- Preserve answered A1 on A2 error/cancel/timeout.
- Carry A1's source registry forward through the logical continuation so
  citation indices cannot collide or change meaning; snapshot the applicable
  registry on both records for independent transcript rendering.
- Persist an immutable `source_config` snapshot on every v2 A1. Legacy v1
  records do not have one and retain their current sticky-session fallback;
  never claim exact legacy inheritance that the stored data cannot prove.
- Update title extraction to choose the first nonblank assistant text, allowing
  A2 to title a conversation whose A1 was question-only.
- Define usage explicitly: preserve per-physical-run accounting; if the UI
  presents logical-turn usage, aggregate exactly once without changing billing
  logs.

### Phase 5 — API and protocol wiring

- Make `MessageBody` a validated exactly-one-of request without breaking
  existing text clients.
- Activate `in_reply_to` and bound it consistently with message IDs.
- Do not persist new source settings or trigger new-turn title side effects for
  a continuation answer.
- Add `clarify_response` to domain events, SSE guards, registry buffering, and
  fixtures.
- Return typed safe errors for stale/duplicate/malformed answers.
- Preserve the optional application error `code` through the frontend HTTP
  parser/error type so clarification conflicts branch before generic 409
  cancel-and-retry handling.
- Keep detailed validation context out of client errors and logs containing
  custom student text.

## Frontend implementation slices

### Phase 6 — versioned parsing and state model

In `frontend/src/api/chat/` and the turn model/reducer:

- model v1/v2 clarification as a discriminated union;
- add exact bounded v2 SSE guards rather than truthy/shape-only checks;
- add strict transcript sanitizers/normalizers for pending, widget-answered,
  reply-answered, cancelled, and legacy v1 records;
- add a `clarify` segment to live and replay state;
- have `useTurnEngine`/stream orchestration intercept `clarify_response` and
  immutably patch A1 in `persistedMessages`; the live A2 reducer must not turn
  that acknowledgement into an A2 content segment;
- keep A1 rendered while distinct A2 streams;
- bootstrap active A2 identity independently of the replay cursor before
  consuming any content event, including when `meta` and `clarify_response`
  themselves are older than `Last-Event-ID`;
- include the permanent Q→A record in whole-run copy/Markdown in a concise,
  deterministic format;
- preserve unknown future nested versions as a safe textual fallback instead
  of crashing the conversation.

### Phase 7 — submission ownership and concurrency

Use one feature-local hook for the active draft, keyed by:

```text
(session_id, clarify_message_id, spec_version)
```

It owns current question, selected option IDs, custom text, validation errors,
and send state. It is not module-global and is not duplicated between the
widget and composer. Reset it when that key/session changes; persistence across
unrelated session switches is not required. Preserve it through question
navigation, rerender, and ambiguous send reconciliation.

Add an explicit submission origin through `AiChatPage`, `useTurnEngine`, the
transport, and pending-send state:

- widget origin sends structured answers and no optimistic user bubble;
- composer origin sends text plus `in_reply_to` and retains the normal user
  bubble;
- widget origin marks A1 `sending` locally, then `answered` on authoritative
  acknowledgement;
- a network failure before the client observes acknowledgement is ambiguous:
  keep the draft in a checking/retry state and reconcile from the transcript
  (or idempotently retry with `in_reply_to`) before deciding A1 is interactive;
  if durable state says stale/already answered, hydrate and freeze A1;
- post-accept A2 error leaves A1 answered;
- clarification conflict never invokes the generic 409 behavior that cancels
  the active turn. Refresh/invalidate transcript and explain that the question
  was answered elsewhere;
- double click is idempotently blocked client-side and rejected server-side;
- a session/spec-key switch resets the active draft cleanly.

### Phase 8 — component and chat integration

Before implementation, use the shadcn MCP
`search_items_in_registries` from `frontend/`, in this order as required by the
project:

1. COSS registry;
2. `@ai-elements`;
3. `@shadcn` primitives;
4. optional 21st.dev registry if available.

Reuse the already-installed Button/Textarea/Accordion primitives. Search only
for the missing radio/checkbox/alert composition before adding custom code.
Build only the differentiating clarification composition. Split the current
monolith into focused feature components under
`features/ai-chat/components/clarify/` rather than growing one large file.

Suggested component responsibilities:

- `ClarifyBundle`: active/answered/cancelled shell and progress.
- `ClarifyQuestion`: legend, option rows, error, custom answer.
- `ClarifySummary`: compact permanent Q→A history.
- `useClarifyDraft`: immutable draft/navigation/validation state.

Integration work:

- render from the ordered clarify segment, not after all message segments;
- keep the widget at A1 while A2 appears as a separate streaming assistant
  message;
- hide skill and source menus while pending and omit both fields from the
  answer request;
- update composer placeholder/helper text and attach `in_reply_to`;
- expose U1 as the editable root, but hide/reject Regenerate on A1/U2/A2;
- suppress the ordinary action row on A1; retain feedback/copy on A2 but hide
  Regenerate for the continuation chain;
- preserve existing citation, source, feedback, copy, scroll anchoring,
  reattach, stop, and steering behavior for ordinary turns;
- use existing semantic design tokens. Add a token or shared primitive API
  before adding any one-off color, radius, shadow, or spacing value.

### Phase 9 — interaction polish and manual checks

Verify with mouse, keyboard, screen reader semantics, narrow mobile viewport,
software-keyboard simulation, refresh, detached reattach, and two tabs:

- one, two, and three question bundles;
- long but bounded question/label/hint/custom copy;
- radio, checkbox, custom-only, mixed multi/custom, Edit, Next, Send;
- send failure and retry with draft intact;
- stale submission answered in another tab;
- A1 stays visible while A2 streams and after A2 error/cancel;
- composer answer creates exactly one user bubble;
- widget answer creates no user bubble;
- pending and historical focus order, high zoom, reduced motion, contrast, and
  touch targets;
- no unexpected scroll jump when A2 starts or completes.

Store screenshots, videos, and logs only under `artifacts/`.

## High-value regression matrix

The project does not require reflexive TDD or a coverage target. These tests
earn their place because the lifecycle touches durable state, user identity,
tool execution, protocol compatibility, and transcript truth.

### Domain and agent

- One to three questions accepted; zero/four rejected.
- Two to five unique options accepted; blank, duplicate, reserved, or excess
  options rejected.
- Single/multiple response invariants and payload bounds.
- Server IDs and label resolution cannot be forged by the client.
- Normal run advertises `ask_student`; A2 does not.
- Output-tool sibling write call is skipped under `end_strategy="early"`.
- A2 uses completed provider history and never reruns an A1 tool.
- Legacy v1 compatibility resume also advertises no clarification output.
- A staged viz flushes before the clarify pointer and survives reload.
- Prompt/eval: mandatory ambiguity produces a real v2 `clarify` event plus
  `done(awaiting_input)`; a prose-only question does not pass.

### Persistence and lifecycle

- A1 record and provider history exist before the clarify event is exposed.
- Widget response updates A1 and appends A2 without a user entry.
- Composer response updates A1, projects one U2, then appends A2.
- A1 segments keep pre-question work before the permanent widget.
- Continuation inherits skills and source configuration.
- Stale ID, duplicate response, unknown option, missing question, mixed body,
  or changed source/skills leaves state untouched and releases the claim.
- Cancel pending A1 freezes it unanswered.
- Cancel/error/timeout A2 preserves accepted A1 and partial/error A2.
- Editing U1 removes its clarification and continuation chain.
- Clarification reply cannot be edited/regenerated.
- First-turn clarification offsets and restart-between-A1-and-answer work from
  Postgres checkpoint history.
- Hard restart with an `accepted` continuation intent resumes the same A2 ID;
  hard restart with a `running` intent never auto-replays A2 tools and exposes
  the explicit interrupted recovery state.
- Pending cancel racing answer acceptance is serialized on both sides of the
  commit boundary; preparation failure/timeout releases the claim and closes
  attach followers.
- Widget-origin A2 terminal records never contain internal `model_input_text`
  as `user_text`; composer-origin records project exactly U2 on complete,
  cancel, error, and timeout.
- Legacy v1 pending, resumed synthesized answer, and transcript replay remain
  readable.
- Auto-title skips blank A1 and uses A2's first substantive answer.

### Protocol and frontend

Maintain shared/golden fixtures for:

- live v2 pending clarification;
- pending transcript reload;
- widget-answered transcript;
- composer-answered transcript;
- cancelled unanswered transcript;
- `clarify_response` replay/reattach;
- reattach with a cursor after A2 `meta`/ack while A2 is unfinished: A1 remains
  frozen and later deltas render under the real A2 ID;
- legacy v1 transcript.

Component/reducer regressions:

- exact live/reload segment order;
- no widget disappearance while A2 streams;
- no duplicate bubble by origin;
- draft preserved on local navigation and ambiguous pre-ack failure until
  authoritative reconciliation resolves accepted versus pending;
- accepted state preserved on downstream error;
- stale conflict never cancels another tab's continuation;
- acknowledgement patches persisted A1 while the separate A2 reducer/state is
  unchanged;
- keyboard behavior, focus progression, accessible names/group semantics,
  announced errors/busy state, and reduced-motion class behavior;
- long-copy wrapping and narrow viewport layout.

Do not write brittle tests against model prose. Use `FunctionModel` for agent
control-flow facts and deterministic tests for state/contract behavior.

## File-level change map

Exact placement may shift after the implementation registry search, but the
responsibility map is fixed.

### Backend/domain

- `domain/specs.py` or new `domain/clarification.py`: v2 contracts, parsing,
  limits, normalization, response validation.
- `domain/events.py`: v1/v2 clarify event and `clarify_response` event.
- `app/clarify.py` or new focused `app/clarification.py`: output builder,
  presentation/model projections; isolate minimum legacy compatibility.
- `app/agent_node.py`: output wiring, result branch, atomic A1 state update,
  continuation output restriction.
- `app/run_turn.py`: native v2 preparation/streaming separated from legacy v1
  compatibility.
- `app/records.py`: clarify segment, continuation metadata, immutable A1 update.
- `app/turn_persistence.py`: A2 terminal metadata through complete/error/cancel.
- `app/turns.py`: claimed validation, inheritance, acceptance, task lifecycle.
- `app/transcript.py`: A1/U2/A2 projection plus v1 compatibility.
- `app/titles.py`: first nonblank assistant response.
- `app/state.py`: versioned pending metadata documentation/type handling.
- `api/routes/sessions.py`: request union, `in_reply_to`, safe conflict mapping.
- `config/assets/prompts/counselor.md`: authoring/judgement rules.
- `evals/`: clarification behavior case/scorer update.

Keep schema, validation, rendering, and lifecycle logic out of already-large
`agent_node.py`, `run_turn.py`, and `turns.py`; those files should only wire the
focused module into existing seams.

### Frontend

- `frontend/src/api/chat/types.ts`: v2 types, response event, transcript segment.
- `frontend/src/api/chat/sse.ts`: strict live-event parsing.
- `frontend/src/api/chat/legacy-replay.ts`: strict transcript normalization.
- `frontend/src/api/http/errors.ts` and its fetch/parser caller: preserve typed
  clarification conflict codes.
- `frontend/src/api/chat/transport.ts`: structured answer body.
- `frontend/src/features/ai-chat/model.ts`: clarify segment/state.
- `frontend/src/features/ai-chat/turn-reducer.ts`: live/replay response handling.
- `frontend/src/features/ai-chat/useTurnEngine.ts`: origin-aware send, draft,
  stale-conflict behavior, A1/A2 coexistence.
- `frontend/src/features/ai-chat/AiChatPage.tsx`: widget/composer orchestration.
- `frontend/src/features/ai-chat/components/ChatMessages.tsx` and the current
  `AssistantBody` inside `ChatMessage.tsx`: chronological widget and action
  gating; extract only if file size/cohesion justifies it.
- `frontend/src/features/ai-chat/components/ChatComposer.tsx`: pending copy and
  source/skill control state.
- replace `ClarifyWidget.tsx` with focused `components/clarify/` modules if the
  registry search does not supply the composition.
- adjacent focused tests and shared protocol fixtures.

## Implementation order and gates

1. **Runtime proof:** output tool + early sibling skip + reusable history.
2. **Contracts:** v2 domain models, normalization, response validation,
   v1 compatibility.
3. **Durable pending:** agent output, atomic A1, ordered clarify segment,
   initial events.
4. **Durable continuation:** claimed answer acceptance, A2 identity/history,
   inheritance, cancel/error/edit semantics.
5. **Wire surface:** API union, conflict codes, `clarify_response`, fixtures.
6. **Frontend state:** strict parsing, ordered segment, A1/A2 reconciliation,
   submission origin/draft/concurrency.
7. **Widget UI:** registry primitives, accessible interaction, responsive and
   historical states.
8. **Verification:** targeted backend/frontend suites, routine checks, focused
   eval, manual E2E/two-tab/accessibility pass.
9. **Documentation:** new ADR, living architecture, ADR index, plan graduation
   only after the feature is shipped and verified.

Do not start the frontend against guessed contracts. Freeze shared backend/FE
fixtures after gate 5, then build against them.

## Verification commands

Use the smallest focused commands during implementation, then close with:

```bash
uv run ruff check .
uv run mypy .
uv run pytest -m "not live_llm and not live_search and not live_db"

cd frontend
npm run typecheck
npm test
```

Run only the clarification-focused live eval cases if the eval harness supports
selection; otherwise record the cost and run the normal eval set once at final
verification. Do not make live LLM behavior a unit-test dependency.

## Documentation and decision records

Before implementation lands, add the next ADR (expected ADR 0033) covering:

- why structured output replaced LangGraph interrupt/deferred replay;
- why early output semantics protect sibling workspace tools;
- why A1 and A2 are separate assistant records;
- the v2 response/no-duplicate-bubble rule;
- the compatibility boundary for v1 records;
- which narrow clarify consequences of ADR 0022 and Agent V1 D2 are
  superseded, while their broader lifecycle protections remain.

Update:

- `docs/adr/README.md`;
- the clarify/protocol/transcript/session sections of `docs/ARCHITECTURE.md`;
- current prompt/eval documentation where it exists.

Do not retro-edit shipped MVP2 or Agent Mode plans. When implementation and all
verification are complete, graduate this file to a feature folder under
`specs/` and leave living behavior in `docs/`.

## Definition of done

- The model can emit one valid bundle of one to three questions through a
  typed output and cannot emit another during its continuation.
- No pre-question function or workspace write is replayed or raced with the
  clarification output.
- The pending widget appears only after its durable record/history exist.
- It never disappears: A1 stays in place while distinct A2 streams and after
  reload, reattach, failure, cancellation, or completion.
- Widget and composer submissions have correct, non-duplicated transcript
  semantics.
- All answer input is bounded, cross-validated, identity-scoped, and safe from
  stale/multi-tab submission.
- Skills/source config cannot change mid-continuation.
- Live SSE and stored transcript produce the same ordered conversation.
- v1 records/checkpoints remain readable and ordinary turns retain their
  current send, steer, cancel, resume, copy, source, citation, feedback, edit,
  regenerate, title, and scroll behavior.
- Focused regressions, routine backend/frontend checks, and manual
  accessibility/mobile/two-tab flows pass.
- The new ADR and living architecture describe what shipped; this plan remains
  in `plans/` until that point.
