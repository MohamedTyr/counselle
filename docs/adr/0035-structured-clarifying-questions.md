# ADR 0035 — Structured clarifying questions

**Status:** Accepted

## Context

Counselle's original clarification path used LangGraph `interrupt()` as the
product mechanism: the graph parked, the next student message resumed the same
node, and the resumed execution replayed the node's pre-question work. That
was acceptable for the first full-stack app, but it created three product and
integrity problems:

1. **Replay risk.** PydanticAI output-tool semantics end the run early. A
   clarification should therefore commit the exact pre-question work once and
   must not replay sibling tools or workspace writes after the student answers.
2. **Transcript truth.** A pending question and the continuation answer are two
   distinct assistant records: A1 asked, A2 answered after the student supplied
   missing context. Reusing one assistant id made reload, reattach, cancellation,
   feedback, and action gating harder to reason about.
3. **Frontend semantics.** Widget answers and composer replies have different
   transcript behavior. A widget answer should not create a user bubble; a
   composer reply should create exactly one user bubble. Both need the same
   server-side validation and stale-submit protection.

## Decision

- Replace the product clarification path with a PydanticAI structured output
  tool named `ask_student`. The model may emit one bundle of one to three
  questions. Each question has a stable id, `single`/`multiple` selection, and
  two to five stable option ids. The product shell owns headings, progress,
  buttons, and the free-text "Something else" affordance.
- Keep PydanticAI's `end_strategy="early"` behavior as part of the safety
  model: once `ask_student` wins, sibling tool calls from the same model turn
  are not executed.
- Persist A1 before exposing it. The backend writes the pending A1 turn record
  and provider history atomically, then streams the `clarify` event followed by
  `done(awaiting_input)`.
- Accept answers through `POST /v1/sessions/{id}/messages` with `in_reply_to`
  plus either:
  - a structured widget `clarify_response`, or
  - composer text, converted server-side into a reply response.
- Continue as A2, a new assistant record with `continuation_of=A1`. A2 inherits
  A1's source config, selected skills, and response mode; it does not advertise
  `ask_student`.
- Store a durable `continuation_intent` while accept-then-continue is in flight.
  `accepted` intents are safe to retry after restart. `running` intents do not
  auto-replay A2 tools; they expose the interrupted-recovery state instead.
- Emit a `clarify_response` acknowledgement before A2 `meta`, so clients can
  freeze A1 while streaming the separate A2 message.
- Preserve v1 historical records as read-only compatibility. New live and
  transcript clarification records use v2.

## Rationale

The model can still ask a question, but the system owns every part that must be
trustworthy: ids, validation, answer provenance, state transitions, concurrency,
and transcript projection. Splitting A1 from A2 also matches what the student
sees: "I need this detail" and "here is the answer using that detail" are
different events in the conversation.

Using the existing messages endpoint keeps the API small. `in_reply_to` names
the pending A1 record, while the optional structured body distinguishes widget
submissions from composer replies without adding a second route.

## Alternatives

- **Keep LangGraph `interrupt()` as the main path.** Rejected: it re-executes
  the interrupted node after resume, so pre-question tools and workspace writes
  can rerun or drift from what the student watched live.
- **One assistant message/id for A1 and A2.** Rejected: it hides the lifecycle
  boundary and makes reload, cancellation, error, feedback, and action gating
  ambiguous.
- **A dedicated answer endpoint.** Rejected: the existing message endpoint
  already owns session claim, SSE streaming, conflict mapping, rate limiting,
  and auth. A second route would duplicate that surface.
- **Let the frontend validate labels instead of ids.** Rejected: option labels
  are presentation text. The server validates question ids and option ids from
  the persisted A1 spec.

## Consequences

- ADR 0022's broader turn registry, resume, cancel, and history-rewrite
  protections remain, but its clarify-park lifecycle is superseded for new
  records. Historical v1 records still replay through the compatibility path.
- ADR 0028's "run is the message" record model remains the transcript truth
  surface; A1 and A2 are now separate run records connected by
  `continuation_of`.
- The frontend must render ordered clarify segments chronologically and keep
  A1 visible while A2 streams, errors, cancels, or completes.
- Widget-origin A2 records never synthesize user text; composer-origin A2
  records project exactly one user message.
- The eval scorer for mandatory clarification now requires a real v2
  `clarify` event ending in `done(awaiting_input)`; prose-only follow-up
  questions do not satisfy the contract.
