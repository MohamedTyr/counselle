# ADR 0037 — The per-turn agent surface (`chat` | `essay`)

**Status:** Accepted

## Context

The essay editor needed an AI panel that works *on one essay*: a workshop
partner that already has the draft, the prompt, the school, the word limit,
and the student's current selection in front of it, that proposes concrete
edits instead of answering admissions questions, and that cannot reach the
workspace mutations belonging to other objects. That is a different agent
*behaviour* from the counselor, driven by a different system prompt and a
narrower action space — but it is the same agent *runtime*: the same
`agent.iter()` loop, the same emission router, the same clarify lifecycle,
the same turn record, the same steering/replay/usage machinery.

None of the existing per-turn seams expressed it:

- **Source config (ADR 0013)** gates *external* sources; it has no vocabulary
  for the workspace tools or the DB tools, and no notion of a scoped object.
- **Response mode (ADR 0034)** picks a model and a response-mode skill; it
  deliberately does not change the tool profile or the system prompt asset.
- **Skills (ADR 0010)** are progressive-disclosure workflow text. A skill can
  tell the model how to work; it cannot make a tool unreachable.

Two further requirements shaped the decision. First, an agent edit inside the
panel must be *reviewable* — a suggestion the student accepts or rejects —
rather than a direct write, which ADR 0030 explicitly reserved as a future
layer over the same `{old_text, new_text}` edit mechanic. Second, a
clarifying-question continuation (ADR 0035's A2) has to run under the same
prompt and the same tool profile as the A1 that asked the question; a
continuation that silently widened back to the counselor would remount every
tool the panel exists to withhold.

## Decision

**One per-turn value — `Surface` (`domain/surface.py`, a `StrEnum` of `chat`
and `essay`) — selects the system prompt asset, the tool profile, and the
essay write mode, at the single point where the PydanticAI `Agent` is
constructed.**

- **It travels the existing per-turn path, not a new one.** The wire carries
  `surface` plus, for `essay`, a nested `essay_context: {essay_id, selection}`
  on `POST /v1/sessions/{id}/messages`, parsed and validated at the route
  (`_parse_surface_request`); `essay_context` is required for `essay` and
  refused for `chat`, so essay state cannot be smuggled onto a chat turn.
  Below the route it is flattened to plain scalars on `turn_ids` — the same
  checkpointed bag that already carries `response_mode` and `model` — through
  `TurnRegistry.start` and `run_turn`. `run_agent_node` reads it back with
  `_surface_from_ids`. An absent or unrecognized value is `chat`, so every
  pre-existing checkpoint, test harness call, and direct-graph invocation keeps
  its exact behaviour and a chat turn's checkpoint is byte-unchanged.
- **The route re-derives ownership from the session row.** An `essay` turn is
  accepted only when the session's own `essay_id` matches the request's; a
  main-chat session never accepts one. The essay a turn is about is then read
  once, at turn start, through `service_essays.get_essay` under the
  authenticated `user_id` — never from anything the model supplied.
- **Surface selects the prompt asset.** `essay` renders
  `config/assets/prompts/essay_partner.md` with `{essay_context}`,
  `{student_context}`, and `{temporal_context}`; `chat` renders `counselor.md`
  unchanged. The essay block is built in code (`app/prompt.render_essay_context`)
  and says so when it truncates, so the model can never mistake an excerpt for
  the whole draft.
- **Surface narrows the tool profile before the `Agent` is built, in code.** On
  `essay`: the workspace tool list is filtered to an explicit allowlist — the
  essay tools minus create/duplicate/archive/restore, every workspace *read*
  (the student's real material, which is what the agent reaches for instead of
  inventing), and the two memory-note writes — and `render_viz` is not built at
  all. External search is untouched and still governed by the request's source
  config. Everything else — `read_tool_result`, `load_skill`, the plan tool — is
  surface-agnostic. (Precisely: `render_viz` is *never constructed*, ADR 0013's
  literal shape; the withheld workspace tools are constructed by the shared
  factory and then dropped from the mounted list. Either way they are never
  handed to the model, which is the property ADR 0013 is about.)
- **Surface selects the write mode.** `build_workspace_tools(write_mode=…)`
  fixes `direct` (chat, unchanged) or `suggest` (essay panel) when the tools
  are built, so it is a property of the turn and never something a tool call
  can choose. The one carve-out: an essay that is empty when the turn starts
  is written directly, because a first draft has no prior text to review
  against.
- **Continuations inherit the surface.** `accept_clarification` reads A1's own
  `turn_ids` and carries `surface`/`essay_id`/`essay_selection` onto A2, so a
  resumed essay turn runs the same prompt and the same narrowed profile it was
  asked under. Fail-closed the same way: anything absent or malformed is chat.

### The ADR 0013 exception: in-hook MCP denial

ADR 0013's rule is **unmounted, not hidden** — gating happens in code at
construction time, never in the prompt. This feature ships the first sanctioned
exception to the *mechanism*, and none to the principle.

`get_domain` and `query_database` do not belong on the essay surface: they are
the metric-heavy Common Data Set reads, and CDS metrics belong in the main
chat. But the four `counselle-db` tools are exposed through one `MCPToolset`
object over one stdio child process. `MCPToolset` is indivisible — it cannot be
partially mounted, and the only way to withhold two of its four tools by
construction would be a *second* toolset and a second long-lived child process
purely to carry a different hook.

Instead, the two tools are denied inside the toolset's existing per-run result
hook: `ESSAY_SURFACE_DENIED_MCP_TOOLS` in `app/toolset.py`, checked in
`annotate_mcp_result` against `ctx.deps.surface`, returning `counselle_db`'s own
tool-error shape **before** the call reaches the child process or the database.
`TurnDeps` is the per-run deps object rebuilt on every node execution, so the
surface rides it the same way `registry` and `tool_overflow` already do.

What this preserves, and what it gives up:

- **Preserved:** the denial is in code, not prose. A model that ignores its
  instructions still cannot read a domain packet from this surface. Nothing
  about the refusal lives in `essay_partner.md`.
- **Given up:** the two tools' schemas are still in the model's context, so the
  model can *attempt* the call and be refused, rather than never seeing it.
  That costs a few tokens and one wasted tool call in the worst case.

The exception is scoped exactly to "an indivisible vendor toolset". Any tool we
construct ourselves — every workspace tool, `render_viz` — is still unmounted,
never denied. ADR 0013 carries a pointer to this record.

### Honesty on this surface: prompt hardening plus provenance display, and no validator

The essay panel's failure mode is not a wrong number, it is a wrong claim: the
agent told a student it had proposed a suggestion on a turn where it made no
edit tool call at all. The panel's pending-changes bar unmounts at zero, so the
one state the claim was false in was the one state with no surface to
contradict it.

Two levers close it, and deliberately only two:

1. **Prompt.** `essay_partner.md` (and `counselor.md` for the same tools in the
   main chat) pins the order — call the tool, read what came back, report only
   that, never the count you meant to propose — and gives an explicit
   non-embarrassing script for the not-yet-edited case, so "want me to draft
   that as a suggestion?" is a complete turn.
2. **Provenance display.** `PendingChangesReadout` is a code-owned band, mounted
   on both surfaces that host an essay conversation, sourced from the server's
   essay record rather than the message stream, and honest at zero as loudly as
   at N — "None" is the reading that refutes the claim. `countPendingChanges` is
   the single source of truth for the waiting/outdated split, so the band and
   the bar can never print two different numbers for one fact.

**No output validator was added, and none may be.** Nothing here scans,
classifies, blocks, rewrites, or retries the model's prose. This repo removed
its programmatic answer-validation layers on purpose; agent-authored inline
citations and code-owned provenance display are the honesty gates, and
reintroducing a text-inspecting validator is out of bounds. That constraint is
recorded here rather than in an ADR of its own because this ADR is the first
place a decision was made *under* it — the removal itself predates this work
and has no ADR to amend, and writing a standalone record for a decision whose
context we did not author would be fabricating a decision trail. If the
constraint is ever revisited, that revisit earns its own ADR.

## Alternatives

- **A second PydanticAI `Agent` instance, or a parallel `run_essay_agent_node`.**
  Rejected. Almost nothing in `run_agent_node` is chat-specific — the emission
  router, marker strippers, clarify handling, tool-overflow middleware, usage
  accounting, turn-record building, steering, and replay safety are all
  surface-agnostic. Duplicating it to change which prompt string and which tool
  list get used would be roughly a thousand lines of copy-paste that drifts the
  first time a streaming or clarify fix lands in only one copy.
- **A second LangGraph graph (`prepare → essay_agent → END`).** Rejected for the
  same reason: `prepare` builds temporal and student context, neither of which
  is chat-specific. Only tool assembly and prompt assembly differ, and branching
  inside the one node is strictly smaller than forking the graph.
- **A prompt flag — mount everything, tell the model what not to call.**
  Rejected outright: exactly what ADR 0013 exists to prevent. A model that
  ignores the instruction, or is coaxed past it, would still be able to invoke
  tools that authorize real writes to other workspace objects.
- **A second `MCPToolset` (and a second stdio child process) carrying a
  narrower tool list.** Rejected: it buys back "unmounted" for two tools at the
  cost of doubling the DB child-process footprint and adding a second
  `AppDeps` field and a deploy-sizing note. The in-hook denial above keeps the
  property that matters — refusal in code, before the round trip.
- **Expressing the essay profile as an extension of the source config
  (ADR 0013's object).** Rejected: source config is a *student-visible*
  per-request preference about external sources. The surface is not a
  preference — it is which UI asked — and overloading one object with both
  would make a user-facing dropdown structurally able to change the agent's
  identity.
- **Per-essay chat threads in `localStorage`.** Rejected: the conversation
  about an essay is a property of the essay and must follow it across devices.
  It is a nullable `essay_id` on `counselle.sessions` instead (see
  `docs/DATABASE_GUIDE.md` §10).

## Consequences

- **Adding a third surface is a prompt asset, an allowlist, and an enum
  member** — not a graph, a node, or an agent. The cost of the next one is
  bounded by construction.
- **Every future change to the agent node must ask "which surface?"** at
  exactly two branch points (prompt assembly, tool assembly) and nowhere else.
  A change that needs a third branch point is the signal that the surface has
  outgrown a per-turn flag.
- **`turn_ids` grows three optional keys.** They are written only for a non-chat
  surface, so chat checkpoints are unchanged and old checkpoints replay as chat
  by absence. `turn_ids` is msgpack-plain scalars only; a nested essay context
  is unpacked at the route, never checkpointed as a structure.
- **The essay surface can still search the web.** Research grounds "why this
  school" material, so external search is deliberately not narrowed; only the
  metric-heavy DB reads and the non-essay workspace mutations are.
- **The two denied MCP tools remain in the model's context on the essay
  surface** — see the exception above. If that token cost or the wasted-call
  path ever matters, the fix is a second toolset, and the trade is already
  written down.
- **`essay_context_max_chars` currently bounds two different things** — the
  essay markdown inlined into the prompt and the selection accepted at the
  route. One knob, two limits; recorded in `TODOS.md`.
