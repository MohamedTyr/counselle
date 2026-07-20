# Agent mutation receipts — reviewed UI/UX and implementation plan

**Status:** independently reviewed and implementation-ready; implementation not started  
**Scope:** the 29 agent workspace and memory mutation tools, their public step-receipt contract, live streaming, durable replay, copy/export, the chat activity trace, and `/dev/tool-calls`.  
**Primary surfaces:** `domain/events.py`, `app/steps.py`, `app/tool_overflow.py`, `app/workspace/agent_tools_*`, `frontend/src/api/chat/`, and `frontend/src/features/ai-chat/`.  
**Lifecycle:** keep this file in `plans/` while the work is active. After implementation and verification, graduate the final record to `specs/agent-mutation-receipts/` and update `docs/ARCHITECTURE.md`.

## 1. Outcome

Replace generic write rows such as `Essay updated` and `Tasks added` with compact, trustworthy receipts that answer three questions without expansion:

1. What happened?
2. Which object or input was affected?
3. What is the most important resulting state?

Expansion answers the audit question: what changed, moved, succeeded, failed, was skipped, or remains unknown?

The experience must feel like a calm action history inside the conversation, not a developer console, toast stack, or wall of cards.

## 2. Non-negotiable product principles

1. **Glance before inspect.** The collapsed row is useful on its own.
2. **Different work earns different UI.** Tasks, schools, essay metadata, essay content, activities, honors, profile, and memory use purpose-built bodies.
3. **One visual grammar.** All receipts share rail alignment, spacing, disclosure, state language, accessibility, and semantic tokens.
4. **Truth beats visual consistency.** Partial, unchanged, failed, and indeterminate work must never be styled or worded as success.
5. **No guessed diffs.** Identity changes and rank movements appear only when captured authoritatively inside the mutation transaction.
6. **No raw tool UI.** Only typed, validated, bounded, allowlisted receipt data crosses the public seam.
7. **Minimize sensitive retention.** Private prose stays excluded except for one explicit, bounded product exception: the new active note in `remember`/`update_memory`, because that text is the memory object's only useful identity. The receipt makes its durable-history consequence explicit; later update/forget does not redact the earlier chat receipt.
8. **Stable history.** Live and replayed receipts are semantically equivalent. Old or malformed receipts fall back without losing the surrounding step or answer.
9. **KISS.** Reuse the existing warm-dark design system, `ToolBeat`, Radix `Collapsible`, Lucide icons, React Router, and semantic tokens. Add no package, endpoint, database table, or second mutation path.

## 3. Current-state diagnosis

- `frontend/src/features/dev-tool-call-gallery/tool-call-fixtures.ts` gives every listed write `detail.summary = "Change completed"` and the note `Generic mutation`.
- `WriteToolWidget` suppresses that generic summary, so the student sees only labels such as `Essay updated`.
- Mutation tools often return useful titles, rows, normalized fields, warnings, and skipped items, but `StepMapper` keeps only a summary for workspace and memory writes.
- Write-tool routing currently reaches `WriteToolWidget` before registered write-specific UI such as `school_added`.
- The workspace change log is intentionally a thin invalidation log. It has no authoritative before/after payload and is not the source for this feature.
- Raw tool arguments and results are correctly excluded from `StepDetail`; this plan preserves that boundary.
- Oversized tool reduction currently allowlists selected `public_receipt` fields and would drop a new `mutation` field unless explicitly changed.
- Stored current transcripts are not yet protected by one shared nested mutation parser.
- A cancelled or errored turn can retain an unresolved write start even though the database operation may already have committed.

## 4. Locked experience model

### 4.1 Shared shell, specialized bodies

Build one `MutationReceiptShell` and these body renderers:

1. `TaskMutationWidget`
2. `SchoolMutationWidget`
3. `EssayMutationWidget` for object and metadata actions
4. `EssayContentMutationWidget` for `edit_essay` and `write_essay`
5. `ActivityMutationWidget`
6. `HonorMutationWidget`
7. `ProfileMutationWidget`
8. `MemoryMutationWidget`
9. `LegacyMutationFallback`

The shell owns lifecycle, outcome, disclosure, accessibility, motion, and rail geometry. A family widget owns its hierarchy and semantics. Specialized widgets must consume typed fields; they must never infer meaning from backend-written English labels.

### 4.2 Three disclosure levels

**Glance — always visible**

- Past- or present-tense action and textual outcome.
- Server-resolved subject identity for committed work, or exact item accounting for a batch. Memory is the sole privacy exception: collapsed remember/update identifies the note count and active-state consequence; its new content appears only after expansion, while forget never repeats old content.
- One family-specific result line.
- First actionable issue for partial, failed, or unknown work.
- A descriptive control when more exists: `View 4 changes`, `View new order`, `Review 1 skipped`, or `View memory notes`.

**Inspect — inline disclosure**

- Affected-item list.
- Typed field changes.
- Authoritative before → after where available.
- Ordered edit-operation summaries and word metrics.
- Resulting activity/honor order.
- Per-input dispositions, notices, cascades, and scoped recovery.

**Act — existing destination**

- A link may open the current post-state object or family list when the destination is known to resolve.
- No undo, restore, retry, or other mutation button lives inside a receipt in this phase.
- Unknown/partial receipts never offer a blind retry. They offer a safe verification destination or tell the agent to re-read current state.

### 4.3 Disclosure policy

- Every receipt starts collapsed, including partial, failed, profile, and memory receipts.
- Partial/failed/unknown truth and immediate recovery remain visible outside the collapsed region.
- Replayed receipts also start collapsed.
- The shell uses controlled disclosure state. A live update never reopens a receipt the user closed and never moves focus or scroll.
- A single persistent trigger changes between `View …` and `Hide …`; the trigger itself never disappears while its content is open.
- The whole row is not clickable. Only the disclosure button and explicit destination links are interactive.

This policy wins over auto-open because it protects privacy and prevents 15 adjacent partial actions from becoming a card wall.

### 4.4 Expandability by action

Always expandable when a valid terminal receipt exists for:

- any metadata update with at least one inspectable change;
- `duplicate_essay`;
- `edit_essay` and `write_essay`;
- `reorder_activities` and `reorder_honors`;
- `update_profile` and `update_memory`;
- any batch with more than two inputs, any non-committed input, notices, omissions, or cascade facts.

Simple single create/archive/restore/remember/forget actions are expandable only when they contain more than the glance line.

## 5. Business state model

`step.status` remains the transport lifecycle:

```text
start | end | error
```

`mutation.outcome` is the business truth:

```text
success | no_change | partial | failed | unknown
```

Meanings:

| Outcome | Required meaning | Example copy |
|---|---|---|
| `success` | At least one durable change is confirmed and no requested input is incomplete | `Updated “Submit FAFSA”` |
| `no_change` | No durable change occurred; all inputs were already in the requested state, duplicates, or otherwise safely skipped | `No changes to activities` |
| `partial` | At least one durable change is confirmed and at least one input failed, was skipped, or was not attempted; no item is commit-ambiguous | `Added 3 of 4 schools` |
| `failed` | Nothing changed, failure is confirmed, and no item is commit-ambiguous | `Couldn’t update “Why Stanford?”` |
| `unknown` | At least one write may have committed but final state cannot be proven | `Action interrupted — final task state is unknown` |

Warnings do not determine outcome. A character-budget warning after every requested write succeeds is still `success`.

No settled turn may display a spinner or present-tense write claim. Terminalization distinguishes two cases:

- A `RetryPromptPart` or tool-schema/argument-validation rejection proves the function never ran: synthesize `step.status="error"`, `outcome="failed"`, and an unresolved body with no subject inferred from invalid arguments.
- A known write may have entered execution but has no authoritative terminal receipt when the turn settles through cancellation, timeout, budget, or unexpected error: synthesize `step.status="error"`, `outcome="unknown"`.

Unknown copy is fixed and non-accusatory:

> This may have completed. Check the workspace before asking Counselle to try again.

## 6. Public receipt contract

### 6.1 Shape: one envelope, typed bodies

Add `StepDetail.mutation: WorkspaceMutationReceipt | None` in `domain/events.py`.

Use one common envelope plus a discriminated body union. This is neither one flat generic bag nor 29 unrelated protocols.

```python
class WorkspaceMutationReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    v: Literal[1] = 1
    family: MutationFamily
    action: MutationAction
    outcome: MutationOutcome
    body: MutationBody
    notices: tuple[MutationNotice, ...] = ()
    omissions: MutationOmissions = MutationOmissions()
```

`MutationBody` is a discriminated union on `kind`:

```text
batch | update | state_transition | duplicate | reorder |
essay_edit | essay_write | profile | memory | unresolved
```

Required typed bodies:

- `BatchMutationBody`: requested input positions and per-position disposition.
- `UpdateMutationBody`: one subject plus typed field changes.
- `StateTransitionMutationBody`: create/archive/restore/remember/forget state with subject(s) and optional cascade.
- `DuplicateMutationBody`: explicit `source` and `copy` roles.
- `ReorderMutationBody`: authoritative resulting order and optional authoritative old ranks.
- `EssayEditMutationBody`: subject, ordered edit operations, transaction-authoritative structural locations, and final word metrics—no essay prose. Each operation has `location = paragraph_range | word_range | unavailable`, operation kind, and before/after word counts.
- `EssayWriteMutationBody`: subject, replacement mode, previous/final word metrics, and budget—no draft excerpt.
- `ProfileMutationBody`: sections with stable section keys and field changes.
- `MemoryMutationBody`: operation-specific active-note facts and content exposure rules.
- `UnresolvedMutationBody`: no domain identity; carries only a literal family verification destination and an optional attempted count that is already trusted/validated. It is valid only for `outcome in {failed, unknown}` when authoritative identity is unavailable. `unknown` always uses this body; other outcomes may not.

Pydantic validators enforce the allowed family/action/body combinations. For example, `family="task", action="forget"` and `action="reorder", body.kind="update"` are invalid. Unresolved-body collapsed copy is fixed: confirmed pre-invocation rejection says `Couldn’t start this action`; commit-ambiguous execution says `Action interrupted — final <family> state is unknown`.

### 6.2 Server-resolved subjects and destinations

```python
class MutationSubject(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    title: BoundedDisplayText
    resource_ref: UUID | None = None
```

The surrounding family defines the subject kind, so the subject does not duplicate a potentially contradictory `kind` field. `resource_ref` is a validated UUID returned by the authenticated mutation/service, never a raw string echoed from tool input.

User-authored subject text carries explicit truncation facts through `BoundedDisplayText`:

```python
class BoundedDisplayText(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str
    truncated: bool = False
    original_graphemes: int | None = Field(default=None, ge=1)
```

One shared grapheme-cluster validator/truncator—not Pydantic's code-point `max_length`—enforces 240 grapheme clusters. `truncated=True` requires `original_graphemes` to exceed the serialized grapheme count; `truncated=False` forbids a contradictory larger original count. The independent UTF-8 receipt-byte cap still applies. The UI never infers truncation from an ellipsis. When `truncated=True`, it visibly says `Title truncated` or `Preview truncated`.

### 6.3 Typed changes

Each family owns an allowlisted `Literal`/enum type for `field_key` and `section_key`; the body-specific change model uses that type rather than unrestricted `str`. Notice codes are bounded to 64 lowercase ASCII characters plus `_`/`-`. The frontend maps stable keys to localized display labels. Unknown keys reject receipt construction instead of becoming public by accident.

```python
class MutationChange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    field_key: TaskFieldKey | SchoolFieldKey | EssayFieldKey | ActivityFieldKey | HonorFieldKey | ProfileFieldKey
    operation: Literal["set", "clear", "replace", "delete", "move", "state_only"]
    before: MutationValue | None = None
    after: MutationValue | None = None
```

`MutationValue` is a discriminated union for `text`, `enum`, `enum_list`, `text_list`, `reference`, `reference_list`, `date`, `datetime`, `integer`, `decimal`, `boolean`, `count`, and `word_budget`. Lists and references have explicit item/count bounds. Dates, booleans, numbers, enums, and references cross as typed/raw values; the frontend formats them with `Intl`. Text values use `BoundedDisplayText`.

Cross-field validators enforce:

- `set` requires `after`.
- `clear` and `delete` require neither a magic display string nor an empty-string sentinel.
- `replace` requires `after`; `before` is present only when transactionally captured.
- `move` requires typed ranks.
- `state_only` carries no value and renders `… updated`, `… cleared`, or equivalent frontend-owned copy.

### 6.4 Batch accounting

Every batch body has one `MutationItem` per requested input position, including repeated IDs:

```python
class MutationItem(BaseModel):
    input_index: int = Field(ge=0)
    disposition: Literal[
        "changed", "unchanged", "skipped", "failed", "not_attempted", "unknown"
    ]
    subject: MutationSubject | None = None
    reason: BoundedDisplayText | None = None
    recovery: BoundedDisplayText | None = None
```

Definitions:

- `requested` means validated request-array positions, not unique IDs.
- A repeated input ID remains a separate input position and is `skipped` with a duplicate-input reason after its first applicable occurrence.
- A successful durable change is `changed`.
- Same-value updates, unchanged reorders, already-active restores, and already-present adds are `unchanged` or `skipped` according to action semantics; neither claims a write.
- `not_attempted` means processing stopped before that position.
- `unknown` means the position may have committed.

The model derives counts from the items; it does not accept independent contradictory count fields. It validates contiguous unique `input_index` values and the outcome rules in §5. The core `{input_index, disposition}` row for every requested position is mandatory and can never be omitted. Under size pressure, optional subject/reason/recovery fields are removed first and counted as omitted item details.

### 6.5 Notices, errors, and recovery ownership

`mutation.notices` is plural and contains non-error informational or warning facts such as Common App limits and school cascade effects:

```python
class MutationNotice(BaseModel):
    kind: Literal["info", "warning"]
    code: str
    message: BoundedDisplayText
```

Overall error and recovery copy has one owner: existing `StepDetail.error` and `StepDetail.next_actions`.

- Receipt construction attaches a safe root error plus `recovery`, `safe_retry`, and `stop_condition` to `public_receipt`.
- `StepMapper` reads the effective ordinary-or-overflow receipt and maps the safe message to `StepDetail.error` and recovery guidance to `next_actions`.
- `mutation` never duplicates the same overall error/recovery.
- A batch item may have `reason` and `recovery` only when scoped to that incomplete item.
- Raw `asyncpg` or other exception text is logged server-side with trace context and replaced by a fixed public error code/message.

### 6.6 Omission and size bounds

Lock these v1 limits:

| Bound | Limit |
|---|---:|
| Complete serialized mutation receipt | 6,144 UTF-8 bytes |
| Requested batch items | 20 |
| Serialized subjects/items | 20 |
| Field changes | 20 |
| Reorder entries | 20 |
| Notices | 6 |
| User-authored title/display text | 240 grapheme clusters |
| Item reason | 240 grapheme clusters |
| Item recovery | 320 grapheme clusters |
| Active memory-note display | existing 200-character domain cap |

Every string and list has a model-level bound. Builders reduce deterministically before overflow in this order: optional metadata, tail notices, tail changes, tail subjects/items. They never cut JSON or silently drop core identity/accounting.

Omissions are separate and exact:

```python
class MutationOmissions(BaseModel):
    subjects: int = Field(default=0, ge=0)
    changes: int = Field(default=0, ge=0)
    item_details: int = Field(default=0, ge=0)
    notices: int = Field(default=0, ge=0)
    edit_operations: int = Field(default=0, ge=0)
```

The UI names the category: `12 of 20 changes shown`, never a vague `8 omitted`.

The worst-case 20-row accounting skeleton must serialize below 2,048 bytes in a locked test, leaving room for the envelope inside the 6,144-byte mutation cap. Reduction may remove optional item identity/reason/recovery but never an accounting row.

`agent_tool_result_max_chars` remains the spill trigger, not a hard post-spill size guarantee; the current reducer already returns a compact envelope that can exceed very small test thresholds. Add a separate `WORKSPACE_COMPACT_RESULT_MAX_BYTES = 10_240`. For overflowed writes, preserve the mutation first, then shrink/omit agent preview/sketch and optional receipt detail until the entire compact result fits 10,240 UTF-8 bytes. Assert the full compact-result size after reduction, including with `max_result_chars=300`.

### 6.7 Parsing and forward compatibility

Add `StepDetail.mutation_contract: Literal[1] | None` as an independent capability marker on every newly terminalized write, including synthesized failed/unknown writes. Preserve it through overflow even if the nested mutation is damaged. Implement one reusable frontend `parseMutationReceipt(unknown)` function and use it for live SSE and stored transcript replay.

- A malformed top-level step still follows existing top-level validation.
- Marker present + valid mutation renders the specialized receipt.
- Marker present + missing, malformed, oversized, or unknown-version mutation is a current corrupted receipt: drop the invalid payload, record safe telemetry, and synthesize the same safe `unknown` presentation. It must never fall through to a success-sounding legacy row.
- Marker absent + no mutation is a pre-feature historical step and may use the legacy summary.
- Never kill an otherwise valid assistant stream because this additive enhancement is malformed.
- Sanitize current stored steps from both `segments` and `step_record`; do not protect only unmistakable legacy transcripts.

Live and replayed receipts must be structurally and semantically equal, not byte-for-byte equal.

## 7. Receipt construction and transaction truth

### 7.1 Source of truth

Add `app/workspace_mutation_receipts.py` beside the existing `app/workspace_step_receipts.py`.

It owns pure, immutable builders, bounds, stable field keys, typed values, exposure rules, and outcome validation. Each mutation tool calls the appropriate builder while it still has validated request context and authoritative committed results. `process_tool_result` does not build receipts because it does not receive tool arguments or domain-specific transaction facts.

The existing workspace change-event row remains unchanged and is not used for diffs.

### 7.2 Atomic versus intentionally partial operations

Before frontend work, make the write guarantees match the tool contracts:

**All-or-nothing batches**

- `create_tasks`: move the validated batch into one service transaction; its docstring already promises all-or-nothing.
- `create_essays`: move the validated batch into one service transaction; remove the current acknowledged partial-commit branch because its docstring promises all-or-nothing.
- `create_activities`: preserve its existing batch transaction.
- `create_honors`: use one locked batch transaction so duplicate/cap checks and inserts cannot race into a partial result.
- Bulk valid-task archive remains a single service operation.

Atomic batches must compose the same connection-scoped service primitives used by HTTP and agent callers; tools do not issue SQL or create a second mutation path. Every object change row is written inside that transaction, and the existing thin `ChangeEvent` notifications publish only after successful commit, preserving ADR 0027.

**Deliberately per-item batches**

- `add_schools` keeps its documented add-what-can-be-added behavior.
- `archive_schools`, `archive_essays`, `archive_activities`, `archive_honors`, and `forget` keep their documented per-item progress semantics unless a small existing service can make the valid subset atomic without changing product behavior.

Per-item tools must:

1. record a disposition for every input position;
2. catch only expected operational failures;
3. return confirmed earlier commits plus failed/not-attempted remainder;
4. reconcile current state when the connection outcome makes a write ambiguous;
5. mark the current item `unknown` when reconciliation cannot prove commit state;
6. never swallow a programming error or persist raw database text.

Injected-failure coverage is required after item 1 and item N−1. Implementation does not proceed to widgets until every multi-write tool has an explicit, tested atomic-or-partial guarantee.

### 7.3 Authoritative identity and before-state

- Archive services return archived display identity from the same transaction, preferably `UPDATE … RETURNING` or a locked row followed by update.
- Update services return the before and after state needed for identity/status diffs from one transaction.
- Reorder services lock the active list, capture old order, write new order, and return both before commit.
- School cascade counts come from the archive/restore transaction when exact; otherwise the notice uses factual nonnumeric copy.
- No prefetch outside the mutation transaction may support `Renamed A to B`, `moved #4 → #1`, or archived-title claims.
- If authoritative before-state is genuinely unavailable for a non-identity field, show only the final value. Identity changes must retain authoritative old and new values.

### 7.4 Cancellation and unresolved writes

Do not shield a database write through terminal emission in this phase; that would change cancellation semantics and deserves separate evaluation.

The single owner is `EmissionRouter`'s terminal step-closure path. Before it yields/buffers the terminal `done` or `error` event, it closes every open known write exactly once:

- `RetryPromptPart`/schema rejection before invocation → `step.status="error"`, `outcome="failed"`, unresolved body.
- invocation may have entered a commit-capable region without terminal proof → `step.status="error"`, `outcome="unknown"`, unresolved body.

It builds these from the exact 29-tool presentation registry, never untrusted call arguments, and includes `mutation_contract=1`. The exact synthesized terminal step is emitted live and becomes the same structure materialized into both `steps` and `segments`. `app/records.py` remains a pure materializer and never invents a receipt after the live stream.

Test interruption at three boundaries:

1. before the service call;
2. during the service call;
3. after commit but before terminal step emission.

All three must settle without a spinner. If the runtime cannot prove no commit, it uses `unknown`; it never guesses failure or invites a blind retry. Add a separate invalid-arguments test proving pre-invocation rejection is `failed`, not `unknown`.

## 8. Durable privacy and field exposure

### 8.1 Retention decision

Receipts are stored in both step records and transcript segments. Private prose remains excluded except for one deliberate product exception: the new active content of `remember` and `update_memory`, capped by the existing 200-character memory limit and hidden until expansion. This is new durable transcript retention. Later update/forget removes the note from active memory but does not redact an earlier chat receipt. That tradeoff is accepted because the note text is the memory object's only meaningful identity and the requested UX must let the student inspect what Counselle saved.

The receipt never persists:

- raw tool arguments/results, SQL, parameters, provider data, secrets, IDs from untrusted input, or version/control tokens;
- task or school notes;
- essay prompts or essay body text, including deleted/replaced text and draft excerpts;
- activity `story` content;
- profile free text, including health, disciplinary, hardship, family, and context notes;
- old memory-note contents in update/forget receipts;
- any value excluded by the field exposure matrix below.

### 8.2 Exposure matrix

| Family/field | Exposure | Receipt behavior |
|---|---|---|
| Task title, status, category, priority, assignee, dates, links | exact typed value | before/after when transactionally captured |
| Task notes | `changed_only` | `Notes updated` or `Notes cleared` |
| School name, list type, application status, round, deadlines, test plan, intended major | exact typed value | family-specific change row |
| School notes | `changed_only` | content hidden |
| Essay title, school, type, status, word limit, deadline | exact typed value | metadata rows |
| Essay prompt/prompt link | `changed_only` | `Prompt updated`, `linked`, or `cleared` |
| Essay body edits | structural only | operation, safe paragraph/word location, affected-word counts, final word metrics; no prose |
| Full essay write | structural only | replacement/draft state and word metrics; no excerpt |
| Activity position, organization, type, grades, timing, hours/weeks, continuation, rank | exact typed value | character and rank UI |
| Activity description | `changed_only` plus exact character count/budget | no description prose in the receipt |
| Activity story | `changed_only` | `Story notes updated/cleared` |
| Honor title, grades, recognition levels, rank | exact typed value | chips and order UI |
| Profile fields in `PROFILE_EXACT_PATHS` below | exact typed value | grouped by section |
| Profile fields in `PROFILE_CHANGED_ONLY_PATHS` below | `changed_only` | section/field changed; value hidden |
| Remember/update-memory new active content | exact, max 200 chars, expanded only | identifies what Counselle will actively remember |
| Update-memory old content | never | do not preserve superseded note text |
| Forget-memory content | never in the forget receipt | state only; earlier chat history is not redacted |

Memory copy is precise:

- `Saved to memory` / `Updated memory` for active notes.
- `No longer remembered` for `forget`, never `deleted forever`.
- Expanded forget copy: `Removed from Counselle’s active memory. You can ask it to remember this again.`

The product must not claim that forgetting redacts earlier conversation history.

Profile exposure is default-deny and mechanically complete. The code-owned maps use normalized schema paths (`[]` for list elements and `*` for dynamic dict keys):

**`PROFILE_EXACT_PATHS`**

```text
basics.preferred_name, basics.pronouns, basics.grade_level,
basics.graduation_year, basics.high_school.name, basics.high_school.type,
basics.high_school.city, basics.high_school.state, basics.high_school.country,
academics.gpa_unweighted, academics.gpa_weighted, academics.gpa_scale,
academics.class_rank, academics.class_size, academics.school_ranks,
academics.grade_trend.trend, academics.current_courses[],
testing.sat.total, testing.sat.ebrw, testing.sat.math, testing.sat.date,
testing.act.composite, testing.act.date,
testing.planned_tests[].test, testing.planned_tests[].date,
testing.psat.total, testing.psat.nmsqt_status,
testing.ap_scores[].subject, testing.ap_scores[].score,
testing.ib.programme, testing.ib.predicted, testing.ib.final,
testing.english_proficiency.test, testing.english_proficiency.score,
testing.english_proficiency.date,
background.residence.city, background.residence.state,
background.residence.country, background.languages[], background.community_type,
interests.intended_majors[], interests.major_certainty,
interests.alternate_majors[], interests.preprofessional[],
preferences.sizes[], preferences.settings[], preferences.regions[],
preferences.max_distance_from_home, preferences.climate,
preferences.must_haves[], preferences.dealbreakers[]
```

**`PROFILE_CHANGED_ONLY_PATHS`**

```text
basics.notes,
academics.grade_trend.why, academics.rigor_summary, academics.notes,
testing.act.sections.*, testing.notes,
background.citizenship, background.visa_status, background.first_gen,
background.family_education, background.hooks[].kind,
background.hooks[].detail, background.notes,
circumstances.disruptions, circumstances.responsibilities,
circumstances.health_learning, circumstances.disciplinary,
circumstances.notes,
aid.need_aid, aid.budget_per_year, aid.sai_estimate, aid.css_complexity,
aid.loan_appetite, aid.merit_priority, aid.applying_for_scholarships, aid.notes,
interests.career_direction, interests.notes,
preferences.campus_culture, preferences.notes,
narrative.spike, narrative.defining_experiences,
narrative.self_description, narrative.values_motivations,
narrative.essay_angles, narrative.notes,
people.recommenders[].name, people.recommenders[].role_or_subject,
people.recommenders[].why_them, people.recommenders[].asked,
people.counselor_context, people.family_stance, people.other_support,
people.notes
```

`PROFILE_NEVER_PATHS` is empty for current public `ProfilePatch` leaves. Container objects are not display rows. A schema-traversal test requires the normalized current leaf set to equal the disjoint union of these three maps. Adding or renaming a profile field therefore fails until its exposure is deliberately classified; there is no silent fallback to exact display.

## 9. Family-specific widget anatomy and examples

All examples show the intended hierarchy, not final pixel styling.

### 9.1 Tasks

Tools: `create_tasks`, `update_task`, `archive_tasks`, `restore_task`.

Distinct anatomy: task state strip, due date, priority, and linked school/essay. Notes are state-only.

```text
Updated “Submit FAFSA”
Due Oct 1 → Oct 15 · Priority High             View 2 changes

  Status        In progress
  Due           Oct 1 → Oct 15
  Priority      High
  Open task
```

Batch creates show first two task titles plus `+N`; archive lists committed titles and incomplete inputs separately.

### 9.2 Schools

Tools: `add_schools`, `update_school`, `archive_schools`, `restore_school`.

Distinct anatomy: application-stage strip with list type, round, deadline, intended major, and cascade notice.

```text
Added 3 of 4 schools
Stanford · Yale · Brown · Princeton skipped    Review 1 skipped

  Added
  • Stanford University — Target · REA
  • Yale University — Reach · RD
  • Brown University — Reach · RD

  Skipped
  • Princeton University — already on your list
```

Archive copy says `Removed from your list` and explains task/essay cascade. It never implies permanent deletion.

### 9.3 Essay objects and metadata

Tools: `create_essays`, `update_essay`, `duplicate_essay`, `archive_essays`, `restore_essay`.

Distinct anatomy: document metadata, word budget, school/type, and explicit source → copy roles.

```text
Copied “Common App personal statement”
New copy: “Common App personal statement — v2”    View copy

  Original      Common App personal statement
  Copy          Common App personal statement — v2
  Status        Drafting
  612 / 650 words — 38 remaining
  Open current essay
```

Prompt contents are never shown. Archive has no item deep link because the active essay route may not resolve it.

### 9.4 Essay content

Tools: `edit_essay`, `write_essay`.

Distinct anatomy: edit-operation timeline and exact word-budget meter, not metadata rows and not persisted prose.

```text
Edited “Common App personal statement”
3 targeted edits · 612 / 650 words — 38 remaining    View edits

  1  Paragraph 2 · Replaced 14 → 18 words
  2  Paragraph 5 · Deleted 9 words
  3  Paragraphs 7–8 · Inserted 22 words

  Final length   612 / 650 words — 38 remaining
  Open current essay
```

`essay_markdown.apply_edits` derives each locator from the exact version-checked document as that ordered edit is applied; locators are attached only if the final document commits. A spanning edit uses a paragraph range; if paragraph boundaries cannot be mapped, use authoritative word offsets; otherwise say `Location unavailable`. Never substitute a model-written topic or excerpt. `write_essay` says `Drafted` or `Replaced full draft`, includes previous/final word counts when authoritative, and shows `662 / 650 words — 12 over` with tabular numerals. It does not duplicate the draft into durable chat history.

### 9.5 Activities

Tools: `create_activities`, `update_activity`, `archive_activities`, `restore_activity`, `reorder_activities`.

Distinct anatomy: Common App rank, position/organization, time commitment, character budgets, and numbered order.

```text
Reordered activities
Research Assistant moved #4 → #1               View new order

  1  Research Assistant · Stanford AI Lab
  2  Debate Captain · Lincoln High School
  3  Robotics Team Lead · FRC 254
```

If old ranks were not captured in the locked transaction, glance copy is `New #1: Research Assistant`; movement is never inferred. Story notes render state-only.

### 9.6 Honors

Tools: `create_honors`, `update_honor`, `archive_honors`, `restore_honor`, `reorder_honors`.

Distinct anatomy: rank, recognition-level badges, grade chips, and the Common App 100-character title budget.

```text
Updated “National Physics Olympiad Finalist”
Recognition: National · Grades 11–12             View 2 changes

  Recognition   [National]
  Grades        [11] [12]
  Title         42 / 100 characters
```

### 9.7 Profile

Tool: `update_profile`.

Distinct anatomy: section index followed by section-grouped definition lists. It is not a flat list of every profile field.

```text
Updated profile
Testing · Academics · Personal context           View 5 changes

  Testing
  SAT plan       Taking in October

  Academics
  GPA scale      4.0

  Personal context
  Context notes updated · content hidden
```

### 9.8 Memory

Tools: `remember`, `update_memory`, `forget`.

Distinct anatomy: restrained note surface with active/updated/no-longer-remembered state. Active note contents appear only after expansion.

```text
Saved 2 notes to memory
Counselle will use these in future conversations    View memory notes

  • Prefers urban campuses near public transit.
  • Needs strong need-based financial aid.
```

Forget:

```text
2 notes are no longer remembered
Removed from Counselle’s active memory

  You can ask Counselle to remember this information again.
```

The forget receipt does not repeat the forgotten text.

For one note, use `Saved a note to memory` and `A note is no longer remembered`. Memory is the sole exception to the global glance-identity rule: collapsed remember/update shows count plus active-state consequence; expansion shows the new active content; forget always remains count/state-only.

## 10. Tool-to-widget matrix

| Tool | Body/widget emphasis | Valid post-state destination |
|---|---|---|
| `create_tasks` | batch task rows | created task |
| `update_task` | status/due/priority change | current task |
| `archive_tasks` | batch dispositions | task list only |
| `restore_task` | restored state | restored task |
| `add_schools` | application batch/dispositions | created application |
| `update_school` | stage/round/deadline change | current application |
| `archive_schools` | cascade + batch dispositions | school list only |
| `restore_school` | restored cascade | restored application |
| `create_essays` | document batch | created essay |
| `update_essay` | metadata changes | current essay |
| `duplicate_essay` | source → copy | copied essay |
| `archive_essays` | batch dispositions | essay list only |
| `restore_essay` | restored metadata | restored essay |
| `edit_essay` | structural edit operations + words | current essay |
| `write_essay` | draft replacement + words | current essay |
| `create_activities` | Common App rows/budgets | created activity |
| `update_activity` | fields/budgets | current activity |
| `archive_activities` | batch dispositions | activities list only |
| `restore_activity` | resulting rank | restored activity |
| `reorder_activities` | ordered list/moves | activities list |
| `create_honors` | recognition/grade rows | created honor |
| `update_honor` | recognition/grade changes | current honor |
| `archive_honors` | batch dispositions | activities list only |
| `restore_honor` | resulting rank | restored honor |
| `reorder_honors` | ordered list/moves | activities list |
| `update_profile` | section groups | profile |
| `remember` | active notes | no link until a stable memory URL exists |
| `update_memory` | new active note | no link until a stable memory URL exists |
| `forget` | state only | no item link |

Use application IDs, not UNITIDs, for school detail routes. Use React Router `Link`, not imperative navigation. A server-emitted resource reference is eligible only when the action's post-state route demonstrably resolves; missing/unauthorized targets fail gracefully in the destination surface.

## 11. Frontend architecture

### 11.1 Routing priority

Update `frontend/src/features/ai-chat/components/ToolWidgets.tsx` with explicit write priority:

1. Preserve existing search and read-tool routing.
2. For a write with validated `detail.mutation`, render `MutationReceiptRenderer` before generic write UI or historical `ui.widget` routing.
3. For `status="start"` and an exact known write tool, render `MutationPendingRow` from the exact 29-tool presentation registry.
4. For a terminal known write with `mutation_contract=1` but missing/invalid mutation data, render a safe synthesized unknown row.
5. For a terminal known write with no marker and no mutation, render `LegacyMutationFallback`/existing `WriteToolWidget` because it is pre-feature history.
6. Keep `task_added` and `school_added` compatibility only for historical steps.

Do not infer write tools or labels by substring. The frozen `WRITE_TOOLS` registry is exhaustive and shared with presentation mapping tests.

### 11.2 Copy/export

Extend the existing `frontend/src/features/ai-chat/step-receipts.ts` with one pure `mutationGlanceText` formatter. The collapsed renderer and `runMarkdownOf()` use the same safe formatter so visible and copied action summaries agree.

Copy/export includes only the glance receipt. It excludes expanded memory contents and any inspect-only detail.

### 11.3 Scroll anchoring

Expansion changes the run's `scrollHeight`. Extend `frontend/src/features/ai-chat/useQuestionAnchoredScroll.ts` with `ResizeObserver` only to recompute whether the scroll-to-bottom control is needed. Disclosure must never trigger automatic scrolling or question-anchor advancement. The disclosure trigger remains in view and focused.

### 11.4 Gallery layout

The narrow gallery currently reserves a fixed metadata column that can squeeze the actual widget to roughly 200 px. In `ToolCallGalleryPage.tsx`, stack fixture metadata above the receipt in narrow mode or use a receipt-level container query. The receipt—not the viewport—owns its compact breakpoint.

## 12. Visual, responsive, and accessibility specification

### 12.1 Visual system

- Preserve Counselle's warm-dark product register, Geist typography, semantic tokens, icon language, and 16 px activity rail.
- Default surface is a flat timeline row. Expanded content may use a subtle existing muted surface and internal separators; no card shadow stack.
- Success remains mostly neutral. Partial uses existing warning tokens. Failed uses destructive tokens. Unknown uses warning/neutral interruption language, never success green.
- Do not import the generic pink/gradient AI aesthetic suggested by broad design-system search; it conflicts with the committed product identity.

### 12.2 Semantic HTML

- `<dl>` for field/value changes and document metrics.
- `<ol>` for activity/honor order and essay edit operations.
- `<ul>` for subjects, notices, and incomplete items.
- Labelled groups for profile sections; do not pollute the page heading hierarchy.
- Before/after arrows are decorative (`aria-hidden`) while adjacent copy supplies the semantic relationship.
- Wrap user-authored inline text in `<bdi dir="auto">`; use logical CSS spacing.

### 12.3 Disclosure and focus

- Use the existing Radix `Collapsible` with a native button trigger.
- Trigger exposes `aria-expanded`, `aria-controls`, and an action-specific accessible name.
- Enter and Space toggle it. Focus remains on the trigger after open/close.
- Every interactive target is at least 44 × 44 CSS px.
- Internal links follow the disclosure control in logical DOM order.

### 12.4 Live announcements

Own announcements in one persistent visually hidden node at the run/chat level, not inside each receipt:

```text
role="status" aria-live="polite" aria-atomic="true"
```

- Announce a running → terminal transition once.
- Do not announce transcript hydration or disclosure expansion.
- Deduplicate by `turn_id + step_id + outcome`, including React StrictMode.
- Queue/coalesce rapid terminal updates so they are not overwritten.
- A confirmed no-commit error uses one assertive `role="alert"` path and is excluded from the polite queue to prevent duplicate speech.
- Running rows expose visible text plus `aria-busy="true"`; decorative skeletons are `aria-hidden`.

### 12.5 Reflow and bidi

- Required floor: 320 CSS px container width, plus checks at the gallery's 375 px mode.
- Verify browser zoom at 200% and 400%, WCAG text-spacing overrides, and 100+ character unbroken strings.
- Every flex/grid text child uses `min-width: 0`; user text uses `overflow-wrap: anywhere`.
- Change rows stack vertically at the receipt container breakpoint.
- Before/after content is never a horizontal diff and no nested horizontal scrolling is allowed.
- Test mixed Arabic/Hebrew and Latin names, dates, and numerals.

### 12.6 Motion and contrast

- Use a 150–200 ms opacity/translate disclosure transition. Do not assume an installed height-animation primitive.
- Reduced motion removes receipt entry, chevron, loader, and disclosure motion.
- Opening/closing never uses bounce, elastic easing, or stagger.
- Normal and interactive text must reach at least 4.5:1; large text at least 3:1; meaningful icons, focus indicators, and required component boundaries at least 3:1 against adjacent colors.
- Measure actual composited colors—not source token values—for default, hover, focus, partial, failed, unknown, muted/opacity states, and both default/expanded surfaces. Verify visible focus in forced-colors mode.

## 13. Backend implementation phases

### B0 — Mutation truth audit and service guarantees

- Inventory every termination path for all 29 tools: normal return, notice/warning, no-change, handled error, raised database error, unexpected exception, cancellation, timeout, and post-commit/pre-emission interruption.
- Lock each multi-write tool to the atomic or intentionally partial category in §7.2.
- Make create-task, create-essay, and create-honor batch behavior match their all-or-nothing contracts.
- Make archive/update/reorder services return transaction-authoritative identity and before-state.
- Replace raw PostgreSQL error interpolation with fixed safe messages and server-side logging.
- Add the exhaustive profile exposure maps and schema-completeness check before profile receipts can serialize.

Gate: no receipt/UI work begins until all commit-capable paths can produce confirmed dispositions or `unknown`.

### B1 — Typed models, builders, overflow, and unresolved terminal state

- Add strict frozen Pydantic receipt models and validators to `domain/events.py`.
- Add pure builders in `app/workspace_mutation_receipts.py`.
- Add `StepDetail.mutation` and map safe root `error`/recovery.
- Add and independently preserve `StepDetail.mutation_contract=1` for all new terminal writes.
- Update `app/tool_overflow.py` to validate and preserve a bounded mutation plus safe original status/error/recovery fields.
- Make `result_is_error` inspect the effective public receipt for ordinary and overflowed results.
- Terminalize pre-invocation rejection as unresolved `failed`; terminalize invocation without proof as unresolved `unknown` in the emission owner.
- Preserve `summary` as compatibility fallback.

Overflow tests cover just-under and far-over thresholds and compare parsed structure, not JSON key ordering.

### B2 — Task and school receipts

- Emit typed task state/date/priority/link bodies and note state-only changes.
- Emit school stage/round/deadline/list bodies, per-input add/archive dispositions, and exact/factual cascade notices.
- Keep historical `task_added` and `school_added` compatibility.

### B3 — Essay object and content receipts

- Emit metadata, duplicate roles, archive identity, and restore state.
- Emit structural edit operations and word metrics without essay prose.
- Emit safe paragraph/word locators derived by `essay_markdown.apply_edits` from the exact version-checked edit sequence.
- Emit full-write previous/final word metrics and exact over/remaining budget.
- Preserve current-essay links only for resolvable post-state actions.

### B4 — Activity and honor receipts

- Emit Common App fields, rank, time commitment, grade/recognition data, and character-budget notices; activity description prose remains state-only.
- Emit story changes as state-only.
- Emit authoritative before/new order from locked transactions.

### B5 — Profile and memory receipts

- Group profile changes by stable section key and apply the exposure matrix.
- Emit the explicitly approved bounded active memory content only for remember/update; never old/forgotten content, and document that later forget does not redact prior receipts.
- Use `No longer remembered` state semantics and exact per-input dispositions.

## 14. Frontend implementation phases

### F0 — Shared validation and model integration

- Add mirrored discriminated types.
- Build one tolerant nested mutation parser used by SSE and transcript replay, plus capability-marker parsing that distinguishes current corruption from pre-feature history.
- Sanitize current stored `segments` and `step_record` shapes.
- Add shared backend-shaped contract fixtures; do not maintain divergent hand-written shapes.

### F1 — Shell, dispatch, live region, and legacy fallback

- Implement `MutationReceiptShell`, `MutationReceiptRenderer`, pending registry, controlled disclosure, and run-level announcements.
- Apply the routing priority in §11.1.
- Render marker-present malformed/unknown-version receipts as safe unknown; reserve legacy fallback for marker-absent pre-feature history.
- Add glance-only copy/export formatting.

### F2 — Specialized widgets

- Implement the eight family-specific anatomies in §9.
- Share only knowledge that truly changes together: disclosure, subject rows, typed values, budget meter, notices, and incomplete-item sections.
- Keep essay operations, reorders, profile sections, and memory notes structurally distinct.
- Use one action-aware route helper and React Router links.

### F3 — Gallery and density acceptance surface

Replace generic mutation fixtures with production-shaped cases:

- running, success, no-change, partial, failed, and unknown;
- same-value update and unchanged reorder;
- repeated input IDs and all-skipped batches;
- injected failure after item 1 and N−1;
- cancellation at all three boundaries;
- long/unbroken and bidi subject text;
- every omission category and total receipt budget;
- essay edit/write word-budget states without prose;
- school cascade and archived-link suppression;
- profile sensitive fields and memory forget;
- unknown version, malformed nested values, oversized stored receipt, and legacy fallback;
- 15 adjacent mixed receipts and 15 adjacent partial receipts.

Fix the gallery's narrow metadata layout before treating its 375 px mode as evidence.

### F4 — Scroll, responsive, accessibility, and visual polish

- Add disclosure-aware scroll-height observation without auto-scroll.
- Verify controlled focus and replay behavior.
- Verify the full matrix in §16 in real chat density.

## 15. File-level change map

Expected backend files:

- `domain/events.py`
- `app/workspace_mutation_receipts.py` — new, beside `app/workspace_step_receipts.py`
- `app/steps.py`
- `app/tool_middleware.py`
- `app/tool_overflow.py`
- `app/steps.py` / `EmissionRouter` terminal-close owner for synthesized failed/unknown receipts; `app/records.py` stays a pure materializer
- the eight `app/workspace/agent_tools_*` mutation modules
- the relevant task/application/essay/activity service modules for atomicity and authoritative returns
- focused existing step, overflow, transcript, and workspace-tool tests

Expected frontend files:

- `frontend/src/api/chat/types.ts`
- `frontend/src/api/chat/sse.ts`
- `frontend/src/api/chat/legacy-replay.ts`
- `frontend/src/features/ai-chat/model.ts`
- `frontend/src/features/ai-chat/step-receipts.ts`
- `frontend/src/features/ai-chat/turn-reducer.ts`
- `frontend/src/features/ai-chat/useQuestionAnchoredScroll.ts`
- `frontend/src/features/ai-chat/components/AgentRunView.tsx`
- `frontend/src/features/ai-chat/components/ToolWidgets.tsx`
- `frontend/src/features/ai-chat/components/WriteToolWidget.tsx` — legacy fallback only
- `frontend/src/features/ai-chat/components/write-tools.ts`
- `frontend/src/features/ai-chat/components/mutation-receipts/MutationReceiptShell.tsx`
- `frontend/src/features/ai-chat/components/mutation-receipts/*MutationWidget.tsx`
- `frontend/src/features/ai-chat/components/mutation-receipts/mutation-format.ts`
- `frontend/src/features/ai-chat/components/mutation-receipts/mutation-routes.ts`
- `frontend/src/features/dev-tool-call-gallery/ToolCallGalleryPage.tsx`
- `frontend/src/features/dev-tool-call-gallery/tool-call-fixtures.ts`
- focused existing SSE/model/reducer/AgentRunView/scroll/replay tests

Required documentation after shipping:

- `docs/ARCHITECTURE.md` — public mutation receipt, privacy, replay, and unknown-state behavior.
- No retro-edit to shipped MVP2 wire-contract plans.
- No new ADR is required if this remains additive to ADRs 0028/0029. Write one only if implementation changes those decisions.

No migration, endpoint, package, workspace route, or change-log schema change is planned.

## 16. Verification matrix

These tests earn their place because this feature is a durable honesty/privacy boundary.

### 16.1 Backend contract and transaction tests

- Every family/action accepts only its required body kind.
- Model-level outcome/action/body/count invariants reject contradictions.
- Unresolved bodies are accepted only for targetless `failed`/`unknown`; `unknown` cannot use a domain body.
- Every requested batch input position receives exactly one disposition.
- Same-value updates and unchanged reorder never claim a change.
- All-or-nothing create batches roll back on injected item N failures.
- Deliberately partial batches report confirmed commits, failed/skipped/not-attempted inputs, and ambiguous commits as unknown.
- Pre-invocation schema rejection is failed; cancellation before/during/after possible execution never leaves a running terminal receipt and uses unknown when commit cannot be disproved.
- Archive identities and rank movements come from the mutation transaction.
- Identity changes preserve authoritative before and after.
- Raw database exception text never enters the public receipt.
- Exposure-matrix fields are absent or state-only as required.
- Receipt arrays, grapheme-bounded strings, omissions, mandatory item skeleton, 6,144-byte receipt budget, and 10,240-byte compact-result budget are enforced, including low spill thresholds.
- Overflow preserves the validated mutation and safe root error/recovery.
- Public-receipt model-visible size/token cost stays bounded.
- The same synthesized terminal step is observed live, stored in `steps` and `segments`, and replayed structurally equivalent.

### 16.2 Frontend contract and interaction tests

- Validated mutation routing beats generic write and historical `ui.widget` routing.
- Every exact write tool has a pending presentation and terminal family/action fixture.
- Marker-present invalid/unknown/oversized mutation data becomes safe unknown without losing the step or answer; marker-absent pre-feature data uses legacy fallback.
- Glance copy names confirmed objects or exact accounting and matches copy/export.
- Expanded memory content is excluded from copy/export.
- Each family renders its specified anatomy.
- `success`, `no_change`, `partial`, `failed`, and `unknown` have distinct text and non-color cues.
- No settled turn displays a spinner.
- Disclosure state survives live terminal replacement without reopening, focus movement, or auto-scroll.
- One live-region announcement occurs per terminal transition; hydration/expansion is silent; alert errors are not duplicated.
- Archived/forgotten items have no dead object link.
- Missing/unauthorized destinations fail gracefully.
- Reflow, bidi, composed/decomposed Unicode, combining marks, emoji ZWJ sequences, long tokens, reduced motion, forced colors, and 44 px targets meet §12.

### 16.3 Manual UX review

| Dimension | Required checks |
|---|---|
| Width | 320 px receipt container, gallery 375 px mode, tablet, normal desktop chat |
| Zoom/spacing | 200%, 400%, WCAG text-spacing override |
| Density | 1, 5, and 15 receipts; 15 partial receipts |
| Text | short, 100+ characters, unbroken token, Arabic/Hebrew + Latin |
| State | running, success, no-change, partial, failed, unknown, legacy |
| Input | mouse, keyboard only, touch targets |
| Motion | normal and reduced-motion |
| Contrast | all semantic states and forced-colors |
| Replay | live terminal versus reload; malformed and unknown versions |
| Privacy | every field in the exposure matrix |
| Assistive technology | NVDA with Chrome and Firefox; VoiceOver with Safari |

Manual assistive-technology scenarios:

- one running → success announcement;
- partial accounting spoken once;
- rapid terminal bursts queued/coalesced without dropping outcome truth;
- assertive failure not duplicated by the polite region;
- transcript hydration and disclosure expansion silent;
- `View …` / `Hide …` and expanded state announced correctly.

Review questions:

1. Can the student identify every confirmed changed object, or exact batch accounting, without expanding?
2. Does each expanded widget answer the domain-specific audit question without developer language?
3. Are partial, unchanged, failed, and unknown states impossible to confuse with success?
4. Do the eight families feel purpose-built while remaining one product?
5. Does a long run remain calm?
6. Is any private, dead-linked, oversized, or non-authoritative data visible?

### 16.4 Commands

At implementation time, confirm real test paths with `rg --files`, run the smallest focused suites while iterating, then:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check . && uv run mypy .
cd frontend && npm run typecheck && npm test
```

## 17. Acceptance criteria

### Product and UX

- Every confirmed mutation names the affected subject or reports exact batch accounting, except memory's explicit privacy rule: collapsed remember/update shows count/state and expansion shows new active content; forget is always count/state-only.
- Every update reports stable field changes at the exposure level allowed in §8.
- Every content mutation identifies the essay, operation scale, and final word budget without persisting essay prose.
- Every reorder exposes the resulting order and only transaction-authoritative movement.
- Every partial, no-change, failed, and unknown result is explicit in the collapsed row.
- Every family uses the distinct anatomy in §9.
- Expansion is inline, purposeful, collapsed by default, keyboard accessible, touch friendly, and reduced-motion safe.
- Immediate error/unknown recovery never requires expansion.
- Fifteen adjacent receipts remain scannable and do not become a wall of cards.

### Technical truth and safety

- One versioned envelope with typed body variants covers all 29 tools.
- One independent `mutation_contract=1` marker distinguishes current receipt corruption from pre-feature history.
- Every receipt satisfies strict family/action/body/outcome/accounting validators.
- No settled turn displays a running write.
- Interrupted writes never guess success or failure; unresolved commit state is `unknown` with a safe verification path.
- All-or-nothing tool promises are transactionally true; intentionally partial tools account for every input.
- Identity and rank claims come from the mutation transaction, never a racy pre-read.
- No raw tool payload, sensitive excluded field, raw database error, or dead archive/forget link crosses the wire.
- The sole deliberate retention expansion—new active remember/update content—is capped, inspect-only, excluded from copy/export, and documented as remaining in prior chat history after later update/forget.
- Marker-present malformed or unknown-version current receipts become safe unknown; only marker-absent pre-feature receipts degrade to legacy.
- Overflow, live SSE, persistence, replay, copy/export, and historical fallback preserve the same semantic receipt.
- All 29 tools and every commit-capable termination class are represented in contract fixtures/tests.

## 18. Explicit non-goals

- A single generic mutation card.
- Twenty-nine unrelated wire protocols.
- Raw JSON/tool argument inspection.
- Persisted essay diffs, draft excerpts, task/school notes, activity stories, profile free text, or forgotten memory contents.
- A modal or side sheet for receipt details.
- Undo/redo or retry mutations inside receipts.
- New workspace routes or archive-detail screens.
- A database audit-log redesign.
- A new frontend dependency or visual-system replacement.

## 19. Review gate and resolution log

Implementation starts only when a final reviewer pass records no unresolved critical/high findings in this file.

### First independent review pass

| Reviewer | Focus | Material changes incorporated |
|---|---|---|
| Product UI/UX | hierarchy, copy, distinct widgets | locked eight anatomies, collapsed glance requirements, action-aware links, exact budget copy |
| Accessibility | disclosure, live regions, reflow, bidi | persistent announcer, controlled disclosure, 320 px/zoom floor, semantic HTML, `<bdi>`, 44 px targets |
| Backend correctness | transactions, partial commits, privacy, bounds | unknown outcome, atomicity corrections, per-input dispositions, transaction-authoritative diffs, exposure matrix, byte cap |
| Frontend architecture | dispatch, replay, copy, scroll, gallery | exact routing priority, shared tolerant parser, glance formatter, ResizeObserver rule, narrow gallery fix |
| Architecture/ADR fit | public seam, overflow, error ownership | typed `StepDetail.mutation`, existing error/next-actions ownership, overflow preservation, required architecture update |
| Adversarial | contradictions and failure modes | discriminated body union, no magic strings, no settled spinners, omission categories, strict invariants |

### Final review pass

**2026-07-20: PASS.** Product UI/UX, accessibility, backend correctness, frontend architecture, architecture/ADR fit, and adversarial reviewers independently re-read the corrected plan. All six reported no unresolved critical/high findings.

The final pass specifically verified:

- eight genuinely distinct widget anatomies and useful collapsed copy;
- targetless pre-invocation failure versus commit-ambiguous unknown state;
- one live-and-durable terminalization owner;
- marker-based current-corruption versus historical fallback behavior;
- mandatory batch accounting under overflow and low spill thresholds;
- transaction-authoritative identity, diffs, and rank movement;
- the explicit bounded active-memory retention exception and default-deny profile exposure;
- grapheme-safe text, measurable contrast, real screen-reader coverage, reflow, bidi, focus, and motion.
