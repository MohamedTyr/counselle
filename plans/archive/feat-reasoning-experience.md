# Plan: feat/reasoning-experience — integrate the thinking-phase design into the app

Status: IMPLEMENTED (backend + frontend + reviews + tests green; live full-stack
turn pending pipeline DB restart — see §8)
Branch: feat/reasoning-experience (worktree)
Design target: `mockups/thinking-phase.html` (approved, merged to main)

## 1. Problem statement

Port the approved "reasoning/thinking phase" mockup into the **live app — backend and
frontend, not just UI**. The agent's thinking phase must render as a **collapsed-by-default**
glowing "current activity" header that expands into a chain-of-thought rail: thinking
narration lines + tool steps (status: working → done/error) + **source chips with real
favicons/logos**. When the turn finishes it collapses to "Thought for Ns", expandable forever.

Hard requirements from the goal:
- **The backend emits every datum the UI needs, dynamically. Nothing hardcoded per item.**
  School logos, web favicons, the Reddit logo — all derived from data at emit time.
- **A one-line thinking summary appears whether the model is a thinking model or not.**
- **Frontend uses the existing shadcn/LibreChat primitives + AI Elements patterns. Nothing
  built from scratch that a registry already ships.**

Non-goals (explicit): the `chat-experience.html` answer/viz reskin; new viz types; a
citations/`SourcesFooter` redesign (it stays); deploy (B6 still deferred).

## 2. What already exists (grounding — verified in code)

- **Thinking is already model-agnostic at the event layer** (`app/steps.py`): Path A native
  Gemini `ThinkingPart` (gated by `thinking_summaries`), Path B under-`THINKING_THRESHOLD_CHARS`
  pre-tool `TextPart` → `thinking` (ungated, any model). Steps come from tool-call/result
  events (`FunctionToolCallEvent`/`FunctionToolResultEvent`) — model-independent.
- **Steps already carry** `kind`, `tier`, `label`, `status`, and a one-tap receipt
  (`StepDetail`: query, domains, result_count, row_count, field_keys, schools, duration_ms).
- **The catalog** (`counselle_db/catalog.py`) loads `unitid → name` only (`school_names`).
- **`institution.website`** (IPEDS `WEBADDR`) has **100% fill** for all 2,746 schools
  (live-verified). `adapters/tavily_tools.py` already resolves `unitid → registrable domain`
  via `_registrable_domain()`; `domain/normalize.py` already applies the R8 `https://`
  scheme fix for `.website`.
- **Frontend timeline** = `ActivityTimeline.tsx` + `StepRow.tsx` + `ThinkingShimmer.tsx` +
  `stepMeta.ts`, mounted in vendored `…/Chat/Messages/Content/MessageContent.tsx` (lines
  141–150); props from `ChatContext.tsx` `assistantMessage()` over `turn-reducer` state.
- **Already installed**: LibreChat `Collapsible.tsx`, `Badge.tsx`, `Tooltip.tsx`, etc. (no
  `src/components/ui/`; no `@ai-elements` yet). Tier tokens + animation classes live in
  `frontend/src/styles/counselle.css` (ADR 0020: Counselle-native CSS only there).
- **Sources UI** already exists (`components/citations/SourcesFooter`, `CitationPopover`,
  `TierChip`) — keep it; the new chips are a *timeline-step* surface, not a replacement.

The gap is small and precise: **per-step source chips (favicon + label + url)** and a
**school-domain resolver**. Everything else is presentation.

## 3. Ordered task list (deps marked)

### Backend

- **B1. Shared domain/url util** (`domain/urls.py`, NEW). Factor `_registrable_domain` out of
  `adapters/tavily_tools.py` into `registrable_domain(url) -> str | None`; add
  `favicon_url(host) -> str` = `f"{FAVICON_CDN_BASE}?domain={host}&sz=64"`. `adapters/tavily_tools.py`
  imports it (dedup, no behavior change).
- **B2. Favicon CDN base = one config constant** (`config/settings.py`). `favicon_cdn_base:
  str = "https://www.google.com/s2/favicons"`. The *domain* is dynamic; the base is one
  swappable constant — this is the "nothing hardcoded per item" line. (dep: B1 reads it)
- **B3. Catalog school-domain** (`counselle_db/catalog.py`). Add a SECOND query (don't widen
  `_SCHOOL_NAMES_SQL` with a naive join — `field_values` is a ~2M-row table with a
  `(unitid, field_key, cycle_year)` key, so a bare `(unitid, field_key)` join can multiply
  school rows). Use a year-safe correlated form, e.g.
  `SELECT DISTINCT ON (unitid) unitid, value FROM field_values WHERE field_key =
  'institution.website' AND value IS NOT NULL ORDER BY unitid, cycle_year DESC NULLS LAST`.
  **Verify the live `field_values` schema (columns `unitid`, `field_key`, `value`,
  `cycle_year`) and `EXPLAIN` the plan hits the `field_key` index before committing.** Add
  `school_domains: dict[int, str]` (registrable domain, R8-normalized via B1) and
  `school_domain(unitid) -> str | None`. Swap into instance state in `_reload()` atomically,
  same pattern as `school_names`. (dep: B1)
- **B4. Protocol: `StepSource`** (`domain/events.py`). `class StepSource(BaseModel): label:
  str; favicon: str | None = None; url: str | None = None`. Add `sources: list[StepSource] |
  None = None` to `StepData` (NOT `= []` — `ev_step` only None-drops; an empty list would
  serialize as `"sources": []`. `| None` gets the same drop as `detail`/`tier`). `_emit_step`
  passes `sources=None` for `start`/`error`/close-synthesized events. `ev_step` drops it when
  None. FE types it `sources?: StepSource[]`. (dep: none)
- **B5. `StepMapper.sources_for(tool_name, args, content) -> list[StepSource]`**
  (`app/steps.py`). Uniform algorithm:
  - web/edu/reddit kinds (from **`content`**): per result in `content["results"]`, `host =
    registrable_domain(result["url"])`; `favicon = favicon_url(host)`; `label =
    _truncate(result["title"])` for reddit else `host`; `url = result["url"]`. **Dedup by url
    FIRST, then cap** at `_MAX_STEP_SOURCES = 8`. Reddit titles truncated via the existing
    `_truncate`/`_LABEL_QUERY_MAX_CHARS`.
  - db_tool/sql/viz (from **`args`**, via the existing `_school_names` unitid extraction —
    NOT `content`): per unitid, `domain = resolve_domain(unitid)`; `favicon =
    favicon_url(domain)`; `label = school_name(unitid)`; `url = website` (or None). (This is
    how the **school logo** appears — as a chip, dodging the dark-mode node-icon legibility
    problem the mockup already solved by moving logos to chips.)
  - else `None`. StepMapper gains `resolve_school_domain: Callable[[int], str|None]`. Return
    `None` (not `[]`) when there are no sources, so B4's drop rule fires. (dep: B1, B4)
- **B6. Attach sources on completion** (`app/steps.py` `EmissionRouter._finish_step`): build
  `sources` via the mapper and pass into `StepData`. Only on `end` (not `start`/`error`) —
  chips land when the step completes, matching the mockup. **`close()`-synthesized end/error
  events leave `sources=None`** (no result content available there — never call `sources_for`
  from `close()`). Persisted `step_records` carry the full `StepData` dict, so transcript
  replay gets chips for free. (dep: B5)
- **B7. Construction site** (`app/agent_node.py:315–318`): pass `resolve_domain =
  getattr(deps.catalog, "school_domain", None) or (lambda u: None)` into `StepMapper`. (dep: B3,B5)
- **B8. One-line thinking, both model classes** — verify, don't fabricate. Read the system
  prompt (`config/assets/prompts`, `build_system_prompt`); if it doesn't already ask for a
  short one-line rationale before a tool batch, add a concise honest instruction ("before
  using tools, state in one short line what you're about to check and why"). This makes
  non-thinking / non-narrating models produce Path-B thinking lines. **No code-synthesized
  fake thoughts** (honesty carve-out). The collapsed ticker also falls back to the live step
  *label* when no thinking line is pending — always truthful. (dep: none)
- **B9. Backend tests** (`tests/…`): `registrable_domain`/`favicon_url`; catalog domain load
  (live or fixtured); `sources_for` per kind (web→domain label, reddit→title label, db→school
  label, empty otherwise, dedup, cap); `ev_step` drops empty `sources`, keeps populated;
  router attaches sources on `end` only. **Regenerate the protocol golden fixtures** that the
  FE contract test reads (they now include `sources`). (dep: B4–B7)

### Frontend

- **F1. protocol.ts**: add `StepSource` type (`{label: string; favicon?: string; url?:
  string}`) + `sources?: StepSource[]` on `StepData` (optional — matches B4's None-drop).
  (dep: B4)
- **F2. Component foundation — DECIDED (no try-and-fallback).** The `@ai-elements` CLI targets
  `@/components/ui/` which doesn't exist here (LibreChat vendors primitives under `~/`), and
  its components are RSC-flavored shadcn wrappers over Radix — installing fights the alias
  layout and would fail typecheck. **Build `ReasoningTrace` on `@radix-ui/react-collapsible`
  directly** (already a dep, the exact upstream the AI-Elements `Reasoning`/`ChainOfThought`
  wrap) + lucide + `counselle.css`. This IS "use the component, not scratch" — we compose the
  same primitive the registry composes. One-line comment in the component records why. (dep: none)
- **F3. `ReasoningTrace.tsx`** (NEW, replaces `ActivityTimeline`): collapsed header (a separate
  child component, own `useState`, so the rail doesn't re-render on every ticker tick) = orb +
  current-activity shimmer (cycles thinking lines + active step labels, `MIN_DWELL` dwell) +
  duration + chevron; expanded rail = think nodes (italic) + step nodes (kind icon via
  `iconFor`, label, spinner→check→x, **source chips**) with the per-step connector line; done
  = collapsed "Thought for Ns" / derived receipt, expandable. Reuse `stepMeta` + the reducer's
  `deriveReceipt`/`deriveDurationMs`. Chip = favicon `<img alt="" onError=hide>` + label,
  "+N more" (a `<span aria-hidden>`). **Implementation correctness (prescribed):**
  - **Ticker** = `useRef` for queue/pumping-flag/timer-id (NOT `useState` — avoids the
    stale-closure freeze); functional `setState` for the displayed line; `useEffect` cleanup
    cancels the pending timer on unmount/cancel.
  - **Wall-clock timer** = `setInterval` 100ms → `useState` (10 fps, cheap), or rAF → ref +
    imperative DOM. Pick the `setInterval` form (simpler, imperceptible cost).
  - **Completed step nodes** = `React.memo`'d, keyed on the reference-stable `StepData` object
    (completed steps keep identity across reducer updates) so chips don't recompute while a
    later step streams.
  - **Trigger a11y** = static `aria-label` ("Agent thinking, expand to see steps" live /
    "Thought for Ns, expand" done) — NOT `aria-labelledby` the shimmer (it changes per tick).
  (dep: F1, F2)
- **F4. counselle.css**: port the orb `@property --angle` + conic-gradient keyframes, the chip
  reveal, and the gradient shimmer — all inside the existing `prefers-reduced-motion` guard,
  in `counselle.css` only. (dep: none)
- **F5. Mount + retire shimmer** (`MessageContent.tsx`, `ChatContext.tsx`): swap
  `ActivityTimeline → ReasoningTrace`. **Mount guard (concrete):** `!isCreatedByUser &&
  (message.isThinking === true || (message.timeline?.length ?? 0) > 0)` — so the component
  renders the orb + "Thinking…" during the send→first-event dead air, **absorbing
  `ThinkingShimmer`** (delete it + its mount). `ReasoningTrace` derives live-ness from
  `turnStatus` internally. After the merge, `isThinking` is vestigial except as the mount
  trigger — keep it as the dead-air flag in the projection (it still gates the zero-entry
  render); do NOT delete it. Keep `timeline`/`status`/`receipt`/`durationMs`. (dep: F3)
- **F6. Frontend tests**: a `turn-reducer` test — `start` (no sources) then `end` (with
  sources) merges to a step carrying `sources`; `start`+`end` both source-less → no `sources`
  key. A `ReasoningTrace` render test: collapsed shows current activity; expand shows steps +
  chips; **done→collapse→re-expand still shows chips + receipt**; reduced-motion degrades
  (static legible text). Add `sources`-shape assertion to `protocol-fixtures.test.ts`'s `step`
  case; update fixtures expectations. (dep: F3, B9)

### Verify

- **V0. CSP check (before V2)**: grep `api/main.py` + headers for a `Content-Security-Policy`
  `img-src`. If strict, widen it to allow the favicon CDN host (or `https:`) so chips show
  logos. If no CSP is set in dev, note it for the deferred deploy (DEPLOY.md). Add `api/main.py`
  to the manifest only if an edit is needed.
- **V1. Build/lint/types**: `uv run ruff check . && uv run mypy .`; `cd frontend && npm run
  typecheck && npm test`; backend `uv run pytest -m "not live_llm and not live_search"`.
- **V2. E2E** (:8000 + :5173, browse/Playwright): the canonical prompt "Compare Stanford to
  MIT for CS, what SAT do I need? Mine's a 1520." Assert: orb spins, activity cycles, expand
  shows db steps + web/reddit chips, **school/web chips render with their label text** (assert
  the chip + label, not raw `<img>` visibility — a CDN miss hides the favicon by design),
  done collapses to "Thought for Ns". Light + dark. Screenshot both.

## 4. Behavior list (numbered, testable)

1. A web/edu search step's completed event carries one `StepSource` per result (deduped by
   url, ≤8), each with a `favicon` URL derived from the result host and `label` = host.
2. A reddit search step's sources use the post **title** as `label` (favicon = reddit host).
3. A db/sql/viz step that named school unitid(s) carries one `StepSource` per school: `label`
   = school name, `favicon` derived from the school's `institution.website` domain.
4. A step with no resolvable sources carries `sources: []`, and `ev_step` omits the field.
5. `sources` attach only to a step's `end` event, never `start` or `error`.
6. `catalog.school_domain(unitid)` returns the R8-normalized registrable domain for any of
   the 2,746 schools, `None` for an unknown unitid.
7. `favicon_url(host)` = `{favicon_cdn_base}?domain={host}&sz=64`; base is config, swappable.
8. A thinking line is emitted before tool batches for a non-thinking model (via the prompt +
   Path B); the collapsed ticker never shows an empty/`{}` activity (falls back to step label).
9. Persisted (reloaded) turns render the same chips as the live stream (step_record carries
   `sources`).
10. `ReasoningTrace` collapsed by default; expands to the rail; reduced-motion disables orb +
    shimmer (static legible text), per the existing media guard.
11. A broken favicon image hides gracefully (chip keeps its label; no broken-image glyph).

## 5. Risk register

1. **CSP `img-src` may block the favicon CDN.** Verify the app's CSP (api/main.py / headers);
   if strict, allow the CDN host (or `https:`) or self-proxy. Mitigation tracked; favicons are
   non-blocking (onError-hide) so a block degrades to label-only, never breaks the trace.
2. **Favicon CDN latency/availability.** Client-side `<img>` is async + onError-hidden; never
   on the critical render path.
3. **Non-thinking / non-narrating models** may still skip narration → prompt instruction +
   truthful step-label fallback in the ticker (no fabricated thoughts — honesty carve-out).
4. **AI-Elements install friction** in the LibreChat-vendored layout → compose-on-primitives
   fallback (F2 decision), still registry-grade, not from scratch.
5. **Protocol fixture drift.** The FE contract test (`protocol-fixtures.test.ts`) reads
   backend-generated golden fixtures; regenerate them in B9 or the contract test fails.
6. **`field_values` exact column names** (`field_key` vs `key`, `unitid` presence) — confirm
   live during B3 before writing the JOIN.

## 6. File change manifest

Backend: `domain/urls.py` (NEW), `config/settings.py` (M), `counselle_db/catalog.py` (M),
`domain/events.py` (M), `app/steps.py` (M), `app/agent_node.py` (M),
`adapters/tavily_tools.py` (M, import shared util), `config/assets/prompts/*` (M, maybe),
`tests/**` (M/NEW), protocol golden fixtures (regen).

Frontend: `src/api/protocol.ts` (M), `src/components/timeline/ReasoningTrace.tsx` (NEW),
`src/components/timeline/stepMeta.ts` (M, maybe), `src/styles/counselle.css` (M),
`…/Chat/Messages/Content/MessageContent.tsx` (M), `src/app/ChatContext.tsx` (M, maybe),
`src/components/timeline/ThinkingShimmer.tsx` (DELETE), `ActivityTimeline.tsx`/`StepRow.tsx`
(DELETE or fold into ReasoningTrace), `src/test/protocol-fixtures.test.ts` (M), FE tests (NEW).

## 7. Review resolutions (architect + FE reviews folded in)

- **C1** catalog JOIN → B3 now uses a year-safe `DISTINCT ON (unitid) … ORDER BY cycle_year
  DESC` second query + live-schema verify + EXPLAIN. No naive `(unitid, field_key)` join.
- **H1** wire-drop → B4 uses `sources: list[StepSource] | None = None` (None-dropped like
  `detail`), never `[]`. FE `sources?:`.
- **C2/B6** `close()`-synthesized events carry `sources=None`; `sources_for` never called there.
- **H2** db sources come from `args` (existing `_school_names`), search sources from `content`.
- **M2/L1** reddit labels truncated; dedup-by-url before the cap.
- **F2** AI-Elements install rejected (alias/RSC friction); compose on `@radix-ui/react-collapsible`
  directly — the registry's own upstream. Recorded inline.
- **F5** concrete mount guard `isThinking || timeline.length>0`; ThinkingShimmer deleted;
  `isThinking` kept solely as the dead-air mount flag.
- **F3** ticker via refs (no stale-closure freeze) + cleanup; `setInterval` 100ms timer;
  `React.memo` completed nodes on stable `StepData` ref; static `aria-label` on the trigger.
- **F6** reducer merge test (start→end sources) + done-collapse-reexpand test +
  `protocol-fixtures` `sources` assertion.
- **V0** CSP `img-src` check added before E2E. **V2** asserts chip+label, not `<img>` visibility.
- **B8 gap (M5)**: behavior 8 (a non-thinking model actually narrating) is only fully provable
  under a live model; the non-live tests prove the *system can* emit + the ticker label
  fallback. Accept; a live smoke check covers the rest in V2.
- **CSS**: `@property --angle` orb has a modern-browser floor; the `prefers-reduced-motion`
  guard is also the old-Firefox fallback (static orb). Noted in `counselle.css`.

## 8. Build log + verification (final)

**Implemented.** Backend B1–B9, frontend F1–F6 all done. Two phase review loops
ran (Sonnet): backend → "clean" (3 LOW fixes applied: userinfo-strip, +2 tests);
frontend → "fix-then-ship" → fixes applied → second pass caught a `formatDurationMs`
"9m 60s" boundary bug → fixed + covered.

**Green:** `ruff` clean · `mypy` clean (44 files) · backend full suite **530 passed**
(when DB up); **176 DB-independent tests pass** with DB down · frontend `tsc` clean ·
`vite build` ok · **40 frontend tests pass** · protocol golden fixtures regenerated
(now carry `sources`) and the FE contract test asserts the StepSource shape.

**Visual E2E (real component, not the mockup):** a throwaway harness mounted the real
`ReasoningTrace` against the real tokens/CSS/Radix and was screenshotted light + dark.
Both render correctly — real CDN favicons (Stanford, the MIT seal, usnews, reddit
snoos), tier-colored kind icons, the connector rail, thinking lines, the receipt, and
the live timer in `Nm Ms` form. Dark mode is legible: favicons sit on white plates
inside dark chips (the dark-logo concern, solved). Harness removed after.

**One deviation from the plan:** the favicon CDN base is a module constant in
`domain/urls.py` (`FAVICON_CDN_BASE`), not a `config/settings.py` field — `domain/`
must not import `config/` (ADR 0017 layering). The host is still fully dynamic; only
the base is the one swappable constant.

**Blocked, not done — the live full-stack turn (V2 live path).** The pipeline Postgres
(`localhost:5432`) is currently down (it was up at session start; the catalog loaded
2,746 school domains live). A real Gemini+Tavily turn can't run without it. Everything
is in place; once the DB is back, run:

```bash
# backend live turn — prints each end-step's sources (school chips + web favicons):
uv run pytest -m live_llm -q -x        # or the one-off script in the session log
# full app E2E: uv run uvicorn api.main:create_app --factory --port 8000
#               cd frontend && npm run dev   → send the canonical Stanford-vs-MIT prompt
```
