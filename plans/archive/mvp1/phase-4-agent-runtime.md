# Phase 4 — The agent runtime (PydanticAI + LangGraph)

**Branch:** `feat/p4-agent-runtime`
**Objective:** the thinking agent: the LangGraph graph with durable sessions, the counselor agent on real Gemini, clarify-via-interrupt, the three Tavily tools gated by source-config, `render_viz`, skills, citation source registry, temporal context. After this phase a scripted conversation against the **real DB + real Gemini + real Tavily** works end to end (minus HTTP — that's Phase 5).

**Deferred reminder:** no GPT-Researcher, no verification pass (deep research is out of this plan). The graph leaves a clearly-marked seam (`research` node placeholder returning "deep research not available yet") so the follow-up plan adds it without restructuring.

## Inputs for builder agents
- `docs/ARCHITECTURE.md` §12, §12.1, §14, §15, §16, §17; ADRs 0013, 0014, 0015, 0019.
- Phases 1–3 packages. `config/assets/*` (menu, season, shortlist, static map).
- **Mandatory first step per builder:** docs-lookup (Context7/official docs) for the pinned versions of `pydantic-ai`, `langgraph`, `langgraph-checkpoint-postgres` — confirm: PydanticAI MCP stdio client class + streaming/event API + usage API; LangGraph `interrupt()`/`Command(resume=…)` semantics; `AsyncPostgresSaver` setup. Write findings into `plans/mvp1/notes-p4-apis.md` BEFORE coding. This is the anti-hallucination gate for the whole phase.

## Step 0 (orchestrator): `uv add pydantic-ai langgraph langgraph-checkpoint-postgres tavily-python httpx`; confirm `TAVILY_API_KEY` present in `.env` (it is — provided by the user).

## Design fixed points (no agent improvisation)

**Graph state** (`app/state.py`):
```python
class TurnState(TypedDict):
    messages: list[ModelMessage-compatible]      # conversation history (checkpointed)
    source_config: SourceConfig
    pending_clarify: ClarifySpec | None
    source_registry: list[RegisteredSource]      # index → Citation + label, built from tool results this turn
    viz_emitted: list[RenderSpec]
    usage: UsageData
    temporal: TemporalContext                    # today, season, data_calendar (rebuilt each turn)
```
**Graph** (`app/graph.py`): nodes `prepare` (build temporal context via counselle-db `get_data_calendar` + `domain.season`; assemble the toolset from `source_config` — ADR 0013) → `agent` (one PydanticAI run with tool loop) → END. Clarify is NOT a node: it's a **tool** (`ask_student`) whose implementation calls `langgraph.types.interrupt(clarify_spec.model_dump())` — the graph parks inside the agent node; resume feeds the student's answer back as the tool's return value. Checkpointer: `AsyncPostgresSaver` on `COUNSELLE_DB_APP_DSN`, `thread_id = session_id`. `checkpointer="memory"` setting swaps in `MemorySaver` for tests.
**(Eng-review D3, search-verified):** the Python saver has **no schema parameter** (open feature request, Mar 2026). Mechanism: append `?options=-csearch_path%3Dcounselle,public` to the checkpointer DSN so `.setup()` creates its tables in `counselle.*`; then a **fail-fast startup assertion** queries `information_schema.tables` and refuses to boot if any `checkpoint%` table exists outside the `counselle` schema (or none exists after setup). This assertion is a unit-tested function, not a comment.

**The toolset assembled per request** (`app/toolset.py`):
- Always: the `counselle-db` MCP server (stdio child process; all 10 tools) + `render_viz` + `ask_student` + `load_skill`.
- `source_config.web` → `search_web`; `.edu` → `search_school_site`; `.reddit` → `search_reddit` (menu filtered to `reddit_subreddits` allowlist when set). **A disabled source's tool object is never constructed** — unmounted, not hidden (ADR 0013).

**Citations & the source registry** (`app/sources.py`): every tool result that carries envelopes/web results is intercepted by a post-tool hook that (a) appends each distinct citation to `source_registry` assigning the next index `n`, and (b) rewrites the tool's return payload so each item is annotated `"[n]"`. The system prompt instructs: *cite by writing the bracketed numbers you were given next to the facts they support; never invent a number you weren't given.* The `sources` event (Phase 5) renders the registry — the LLM never constructs citation metadata.

**`render_viz` tool** (`app/viz.py`): `render_viz(type, unitids: list[int], field_keys: list[str] | None, test: Literal["sat","act","both"] | None)`:
- **(Eng-review D2):** render_viz calls `counselle_db.service` **directly in-process** (never through the MCP child). `comparison_table` → `compare_schools`; `stat_block` → `get_values` (or dossier section); `score_band` → `get_values` with FIXED keys per ADR 0014: sat→[`admissions.sat_ebrw_25/75`, `admissions.sat_math_25/75`] as two section rows, act→[`admissions.act_composite_25/75`]; the tool builds the `RenderSpec` (cells = envelopes, the spec validator already forbids fabricated SAT composites), appends to `state.viz_emitted`, and **returns to the LLM only** `{"ok": true, "viz": "<type> rendered with N values", "sources": ["[3]","[4]"]}` — numbers never enter the token stream (ADR 0014).

**Tavily tools** (`adapters/tavily_tools.py`): all three call tavily-python `search` (`search_depth="basic"`, `max_results=settings.search_max_results`, `include_answer=False`):
- `search_web(query)` — no domain filter; results → envelopes `field="web.search_result"`, tier `official` is WRONG — use tier `community`? No: ARCHITECTURE says web tier "varies" — fix it concretely: **web results get `tier="official"` only for .gov/.edu domains, else `tier="community"`** with `caveat="General web source — verify on the school's official site."`; vintage `f"Retrieved {today:%b %d, %Y} (live web)"`, url set.
- `search_school_site(unitid, query)` — tool resolves the domain itself: `get_values(unitid, ["institution.website","institution.admissions_url"])` → registrable domain → `include_domains=[domain]`; tier `official`, vintage "Retrieved … (school's official site)".
- `search_reddit(query, subreddits: list[str])` — validate subreddits ⊆ allowed menu (allowlist-filtered); `include_domains=[f"reddit.com/r/{s}" for s in subs]`; tier `community`, caveat "Community sentiment from Reddit — lived experience, not verified fact."
All three return `{results: [{title, url, snippet, marker "[n]"}]}` via the source registry hook. Wrap Tavily errors → tool-level `{error: "...", retryable: true}`; never raise through the graph.

**Counselor prompt** (`config/assets/prompts/counselor.md`) — the builder writes it from this outline, the orchestrator reviews word by word:
persona (kind + honest college counselor for a student; teach terms as they come up; never inflate or soften numbers); the honesty contract (use only tool-given values + markers; "not available" is a fine answer; community ≠ fact; benchmark caveats repeated to the student); DB-first rule (data calendar included below; go to web only past a cutoff or for live-cycle questions); the clarify judgment rule verbatim from ARCHITECTURE §12.1 (clarify / assume+state / default; one round; 2–4 options); school resolution etiquette (multi-campus → ask; not-in-DB → the graceful line); viz guidance (when comparing ≥2 schools or ≥4 numeric facts about one school, render a viz; score questions → score_band; bands are enrolled middle-50%, not cutoffs — teach that); season-aware framing; the static field map + dossier shortlist + subreddit menu + temporal context injected as template slots at the bottom.

**Skills** (`app/skills.py` + `skills/*/SKILL.md`): loader parses YAML frontmatter (name, description) + body; startup loads all metadata; `load_skill(name)` tool returns the body. Ship 4 skills (each ≤120 lines, written from the named doc sections): `dossier-assembly` (DATABASE_GUIDE §14.1 flow + section ordering + tier honesty), `school-comparison` (§14.2/14.3 + which fields matter per intent + render the table), `decode-coded-value` (R1 + escape-hatch helpers), `citation-and-recency` (vintage phrasing, earnings-lag wording, provisional wording).

## Work breakdown
- **Slice A:** state, graph, checkpointer, sessions row CRUD (`app/sessions.py`: create/get/touch using `counselle.sessions`). After API-notes doc.
- **Slice B:** toolset assembly + source registry + MCP client wiring.
- **Slice C:** Tavily tools (+ unit tests with respx-mocked HTTP; live marker tests).
- **Slice D:** render_viz + ask_student (interrupt) tools.
- **Slice E:** prompt + skills + temporal injection.
- **Slice F:** the runner: `app/run_turn.py` — `async def run_turn(session_id, user_text, source_config?) -> AsyncIterator[Event]` translating graph/agent events into domain `Event`s (delta/viz/clarify/usage/done) — **this is the exact function the API wraps in Phase 5**; plus `scripts/chat_cli.py`, a tiny REPL printing the event stream (the orchestrator's live-test harness).

## Tests
- Unit (memory checkpointer, FunctionModel/TestModel from pydantic-ai for the LLM): toolset honors source_config (reddit off → tool absent); registry assigns stable indices; render_viz returns no numbers in its LLM-visible payload; ask_student round-trips an interrupt (graph pauses → resume with answer → answer visible to model); subreddit allowlist enforced; session row created/touched; **the agent's tool loop is bounded by `settings.max_tool_rounds` (default 12) — test that an endlessly-tool-calling FunctionModel is cut off with a clean error** (eng-review).
- **Durability (eng-review D6, `@pytest.mark.live_db`):** automated restart-resume — graph instance A (Postgres checkpointer) parks on `ask_student`; instance A is disposed; a **fresh** instance B on the same DSN resumes the same `thread_id` with the answer and completes. This is ADR 0019's promise as a regression test (it also exercises the D3 schema assertion). The manual kill-the-process demo in the gate stays as theater, but the test is the guarantee.
- Live (`@pytest.mark.live_llm`, real Gemini + DB + Tavily; assertions are **structural**, never on prose):
  1. "Tell me about Duke University" → events contain ≥1 viz(stat_block) OR ≥6 delta-cited markers; done; every marker in prose ∈ registry; usage tokens > 0.
  2. "Is NYU good?" → a `clarify` event with 2–4 options; resume with "CS and affordability" → completes with Stern/CS-agnostic structural checks: ≥1 envelope-cited answer.
  3. "Compare Duke and Harvard on cost and selectivity" → viz(comparison_table) with 2 school columns.
  4. "What are people on Reddit saying about Pitzer dorms?" with reddit enabled → search_reddit called (inspect registry for reddit citations, tier community).
  5. Same question with `source_config.reddit=False` → no reddit citation anywhere; agent says it can't use Reddit.
  6. "What's Stanford's SAT range?" → score_band viz, two SAT section rows, no fabricated composite row.

## Live verification (orchestrator)
`uv run python scripts/chat_cli.py` — run the 6 conversations above by hand, eyeball the streams; then `uv run pytest -m live_llm -q` (expect some latency; run serially). Verify cost sanity: each turn's usage line < ~$0.05 with Flash/Pro defaults.

## Gate checklist
- [ ] API-notes doc exists and code matches it (reviewer cross-checks).
- [ ] All unit + live tests pass; clarify interrupt survives a process restart (manual: start chat_cli, trigger clarify, kill, restart, resume — Postgres checkpointer proof, ADR 0019).
- [ ] Source gating verified live both directions (test 4/5).
- [ ] No tool ever returns numbers to the LLM for viz (grep + reviewer).
- [ ] Prompt reviewed by the orchestrator personally, line by line, against the PRD honesty stories (6–12).

## Milestone commit
```
feat(agent): counselor runtime — graph, durable sessions, clarify interrupt, source-gated tools, render_viz, skills

PydanticAI + LangGraph per ADR 0003/0017/0019; per-request toolset from
source-config (ADR 0013); numbers never transit the LLM (ADR 0014); live
Gemini+DB+Tavily conversation suite green. Deep research seam stubbed.
```
