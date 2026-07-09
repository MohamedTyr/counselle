# Plan — update `AGENTS.md` with the code-quality philosophy

## Problem statement

We refined a "startup-lazy" engineering philosophy: keep code short and
un-over-engineered (the good half of ponytail) **without** sacrificing
features, architecture, or future-proofing (the bad half). The concrete pillars:

1. **Reuse, don't overwrite** — extend existing code; don't rewrite or
   re-implement next to it. (This is the user's core pain: the model overwrites
   working code and over-complicates it.)
2. **Optimize for rewrite cost, not diff size** — the lazy version is right
   only when it can be *extended* later without a rewrite; pay the *small*
   structural cost when the shortcut would force one.
3. **One source of truth / no magic values** — anything a dev might tune lives
   in one place; change-in-one-place is the goal.
4. **Things that change together live together** — the meta-principle behind
   cohesion, feature-organization, and "don't edit 50 files for one change."
5. **AI-agent coding practices** — orchestration/tools/prompts independently
   editable, LLM as a boundary adapter, tool schemas as an API, authz in the
   tool, structured I/O at the boundary, test-tools-hard / eval-the-agent.

**Goal:** fold the *missing* pieces into `AGENTS.md` surgically.

**Non-goals:**
- Not rewriting `AGENTS.md`. Not restating principles it already covers.
- Not creating a separate skill file (the user asked for AGENTS.md; a skill can
  come later if wanted).
- Not touching any code, ADRs, or `docs/`.

## Guiding constraint (we must practice what we preach)

`AGENTS.md` already covers a large share of this. Duplicating it would be
ironic and wrong. Every proposed edit is checked against: *is this already
stated somewhere in the doc?* If yes → sharpen the existing line, don't add a
new one. New text is added **only** for genuinely absent ideas.

## Review incorporated (2 parallel passes)

An architect (soundness/placement) and a codebase fact-check both reviewed the
first draft. Changes applied:

- **[fact-check] Tool descriptions are NOT versioned data assets** — they're
  inline docstrings; ADR 0018 doesn't cover them (externalizing them would be
  over-engineering). Change 4 now scopes "versioned content" to prompts only.
- **[fact-check] "Read vs mutation tools separate" is file-size-driven, not an
  authz boundary** (the modules' own docstrings say so). Change 4's authz bullet
  now states the real practice: every tool scopes to `user_id` from turn state.
- **[fact-check] LLM lives in `app/` behind the `model=` seam, not in the IO
  `adapters/` layer.** Dropped "the model is an adapter like external IO";
  reworded to "isolate the model call" citing ADR 0011 + 0017 correctly.
- **[architect] Added the missing edit-restraint rule** (smallest diff; don't
  restructure code you merely pass through) — the rule that maps most directly
  to the user's pain. Now a House rule (Change 3).
- **[architect] De-duped Change 1 bullet 1 against line 130** — folded the
  extend/anti-overwrite idea into the new House rule; Change 1 drops to two
  philosophy bullets. Change 3 single-source bullet now cross-refs line 136 so
  the doc doesn't carry two "no hardcoded values" rules.
- **[both] Kept the rewrite-cost trigger strict** ("would *force* a rewrite").

## Gap analysis — already covered vs. missing

| Idea from our discussion | Status in AGENTS.md | Action |
|---|---|---|
| Startup-not-enterprise, value×ease | ✅ "How we build" | leave |
| KISS / YAGNI / no speculative abstraction | ✅ principle 1 + "How we build" | leave |
| Never reinvent the wheel / use libraries | ✅ principle 2 | leave |
| Search before adding a helper/service | ✅ House rules bullet 2 | leave |
| Verify before editing (don't assume paths) | ✅ House rules bullet 1 | leave |
| Files<800, functions<50, many small, by-feature | ✅ House rules | leave |
| Layering, deps inward, separation of concerns | ✅ ADR 0017 in stack | leave (cross-ref only) |
| Config single-source, hardcode only invariants | ✅ ADR 0018 in stack | **sharpen** into a House rule |
| Model-agnostic | ✅ ADR 0011 | leave |
| Honesty carve-out | ✅ principle 3 | leave |
| **Reuse, don't OVERWRITE (extend, not rewrite)** | ⚠️ implied by "search before adding" only | **ADD** as House rule (Change 3) |
| **Smallest diff; don't restructure code you pass through** | ❌ absent — the rule closest to the user's pain | **ADD** as House rule (Change 3) |
| **Rewrite-cost over diff-size** | ❌ absent | **ADD** |
| **Clear beats short (readability > cleverness)** | ❌ absent | **ADD** |
| **DRY is about knowledge, not shape (false DRY)** | ⚠️ frontend DRY only | **ADD** (one line) |
| **Meta-principle: change-together lives-together** | ❌ absent (it's the *why* under by-feature) | **ADD** once, as framing |
| **AI-agent coding practices** | ⚠️ scattered across ADRs 0006/0011/0017/0018 as *architecture*, never as *how to write agent code* | **ADD** short section |

## Proposed changes (exact wording)

### Change 1 — sharpen "How we build: startup mode, not enterprise"

Append two bullets after the existing list (before "When in doubt…"). *(The
"extend, don't overwrite" instinct moved to a concrete House rule — Change 3 —
because it's edit-discipline, not philosophy, and belongs next to "verify before
editing." Per architect review.)*

> - **Optimize for rewrite cost, not diff size.** The lazy version is right when
>   it can be *extended* later without a rewrite. Only when the shortcut would
>   *force* a future rewrite — global state that can't become per-user (cf.
>   `user_id` nullable-until-platform, ADR 0019), a schema welded to one provider
>   (ADR 0011), logic fused into a route handler — pay the *small* structural
>   cost now. The trigger is strictly "would this force a rewrite," never "might
>   structure help someday." Good structure is cheap future-proofing; speculative
>   features are expensive. Do the first, skip the second.
> - **Clear beats short.** "Minimal" means minimal *surface and complexity*, not
>   fewest characters. A dense one-liner you decode at 3am is debt, not
>   laziness. Boring and readable wins over clever and short.

### Change 2 — add the meta-principle as a one-line frame

Add a single italic lead line at the top of **House rules** (before the first
bullet), because it's the *why* behind by-feature organization, cohesion, and
the config rule already there:

> *Guiding rule: things that change together live together; things that change
> for different reasons stay apart. "Don't make someone edit 50 files for one
> change" is the test.*

### Change 3 — add House-rules bullets (edit-discipline + single-source + DRY nuance)

Add three bullets to **House rules**, near the existing edit-discipline cluster
(lines 129–130, "verify before editing" / "search before adding"):

> - **Change existing code by extension, with the smallest diff.** Reuse and
>   extend what's here; don't rewrite, restructure, or rename working code you're
>   only passing through to make a change. Before *replacing* code, understand
>   why it's shaped that way, then replace *deliberately* — a refactor is its own
>   change, never smuggled into an unrelated edit. (Pairs with "search before
>   adding" above: that guards against re-implementing; this guards against
>   overwriting. Refactoring genuinely-bad code is allowed — deliberately, not
>   incidentally.)
> - **One source of truth; no magic values.** Any value a dev might reasonably
>   tune — a limit, timeout, model id, threshold, URL, prompt, user-facing
>   string — is named once and read from there (the ADR 0018 Settings surface or
>   a versioned data asset), never a literal repeated across files. Values that
>   *are* the logic and would never be "configured" stay inline. Test: *would
>   someone change this without changing the logic?* Yes → one place; no →
>   inline. (The frontend design-token rule at line 136 is the UI instance of
>   this — not a second rule.)
> - **DRY is about knowledge, not shape.** Centralize a rule or fact that has
>   one reason to change. Do **not** merge two blocks that merely look alike but
>   change for different reasons — that false-DRY couples things that should
>   move independently. Extract on shared meaning, not coincidence.

### Change 4 — add a short "Writing the agent" section

New section after **House rules** (the doc is *about* an agent but has no
guidance on how to *write* agent code; these operationalize ADRs 0006/0011/0017/0018
as coding rules, not new decisions):

> ## Writing the agent
>
> - **Prompts are versioned content, not literals in control flow.** Agent
>   prompts live as data assets (ADR 0018, `config/assets/prompts/`), so
>   iterating on a prompt never touches the loop. Tool *descriptions* stay as the
>   tool's docstring next to its code — that's correct and not worth
>   externalizing; just keep them accurate, since the description is the contract
>   the model reads.
> - **Isolate the model call.** The LLM sits behind PydanticAI's per-agent
>   `model=` seam (ADR 0011) and out of the pure `domain/` core (ADR 0017). Keep
>   the surrounding logic deterministic and testable; don't scatter model calls
>   through business logic.
> - **Tool schemas are an API.** One tool, one clear capability; tight schema;
>   the description is the contract the model reads. No god-tool with a mode
>   flag. Curate the action space — enough tools to be capable, few enough to not
>   bloat context.
> - **Authz lives in the tool, never in the model.** Every workspace tool scopes
>   to the authenticated `user_id` from turn state (`WHERE user_id = $1`), never
>   to anything the model supplies. Authority is server-side and identity-bound.
> - **Typed output at the tool boundary.** Data tools return typed, validated
>   structures — the citation envelope (ADR 0006) is the model to follow: decode
>   and validate at the edge, hand the rest of the system types, not raw strings.
> - **Test tools hard, eval the agent.** Tools are ordinary code — unit-test them
>   deterministically. Fuzzy end-to-end behavior belongs in the eval set
>   (`evals/`, `uv run python -m evals.runner`), not brittle string assertions.

## Risk register

1. **Duplication / bloat** (highest). The doc already covers ~half of this.
   Mitigation: gap-analysis table above; every add is checked as absent first;
   Change 4 explicitly cross-refs the ADRs it operationalizes instead of
   restating them. Reviewers must confirm no new bullet repeats an existing one.
2. **Contradiction with existing lines.** e.g. "Extend, don't overwrite" vs
   "search before adding" — should read as the same instinct sharpened, not a
   competing rule. Mitigation: reviewer checks for tension.
3. **Accuracy of agent claims.** Change 4 asserts things about the codebase
   (turn-state `user_id`, read/mutation tool split, prompts as data assets).
   Mitigation: reviewer verifies against `app/`, `evals/`, ADR 0018 before we
   commit the wording.
4. **Placement.** New "Writing the agent" section vs folding into House rules.
   Mitigation: reviewer opinion; default to a small standalone section since
   it's a distinct concern.

## File change manifest

- `AGENTS.md` — modify only (Changes 1–4). No other files.
