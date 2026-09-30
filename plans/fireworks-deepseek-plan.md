# Switch the live model path to DeepSeek V4.1 Flash on Fireworks

Status: implemented (code, tests, docs); §7 verification in progress. Branch `worktree-feat-fireworks-deepseek`.

## 1. Problem

Every live model call goes to Gemini on Vertex:

- Quick and Think counselor turns
- the goal agent, goal judge and criteria writer
- auto-titles
- document summaries
- the eval judge

The owner has subscribed to Fireworks and wants the whole live path on
DeepSeek: cheapest, fastest, and as strong as possible, in both Quick and
Think.

The switch has to keep three things true:

- **Honesty.** Citations, value reading, and the goal judge stay as strict as
  they are now. The judge's eval gate is re-measured on the new model before
  merge.
- **One provider seam (ADR 0011).** The model is a setting. Provider-specific
  code lives in exactly one function.
- **Quick is fast, Think thinks.** Same model, different reasoning effort.

### Non-goals

- The parked CDS extraction system stays on Gemini, untouched: `adapters/cds_gemini.py`, `app/cds/`, the `model_cds_*` settings, `vertex_api_key`, `google_cloud_*`, and `google-genai`. It doesn't run (ADR 0038, `PARKED.md`). It builds its own genai client and never imports `app/vertex.py` (verified).
- No LiteLLM, no fallback provider, and no support for other providers until one is actually needed (§3 D3).
- No up-front prompt rewrites. Prompts change only if §7 shows a regression that a prompt fixes.
- Deep research stays deferred.

## 2. Verified facts (live probe, 2026-09-29, owner's key)

| Fact | Evidence |
|---|---|
| The only callable DeepSeek model is `accounts/fireworks/models/deepseek-v4p1-flash`. | `GET /v1/models` also lists `deepseek-v4-pro`, `-v4-pro-0813`, `-v4-flash-0731` and `-v4-flash-vision-exp`. Chat calls to both Pro ids return `404 NOT_FOUND … not deployed`. |
| Reasoning is **on by default**. | No reasoning parameter: 823 reasoning tokens for a two-sentence answer, 8.9s. |
| `reasoning_effort: "none"` turns it off. So does `thinking: {type: "disabled"}`. | 0 reasoning tokens, 1.8s. |
| `low` reasoned 428 tokens (5.1s). `high` reasoned 496 (6.7s). | One short question; real turns will differ. |
| Tool calling works with reasoning on and off. | A `get_weather` call was emitted correctly both ways. |
| Fireworks does not require `reasoning_content` to be sent back on a tool-result step. | Both variants succeed. |
| Streaming carries `reasoning_content` and `content` deltas. The first reasoning delta arrives 0.44s after the request. | At `high`. |
| Strict `json_schema` response format works. | Returned `{"met": true}`. |
| The reasoning text is **raw chain of thought**, not a summary. | e.g. `"We need answer. User says \"Say hi\". Need simply say hi…"` |
| With reasoning `none`, the probe called BU a "target" for a 3.6 GPA / 1380 SAT, which is wrong. With reasoning on, it called it a reach. | One sample, no tools. |
| The price is not settled. | The Fireworks serverless-pricing doc says $0.30 in / $0.006 cached / $1.20 out (Global) and $0.45 / $0.009 / $1.80 (US). The model page says $0.22 / $0.007 / $0.66. |
| **This workstation's IPv6 is broken, and Python does not fall back to IPv4.** | `curl` answers in 0.2s. `urllib` and `httpx` hang until timeout. An httpx client bound to IPv4 (`local_address="0.0.0.0"`) answers in 0.08s. |

Verified in the installed PydanticAI 1.107.0 and openai SDK:

- `infer_model("fireworks:…")` already resolves to `OpenAIChatModel` + `FireworksProvider`.
- Model-level `settings=` merges with run-level `model_settings`, and the run-level value wins.
- `ReasoningEffort` includes `"none"`.
- Streamed `reasoning_content` becomes `ThinkingPart(id="reasoning_content", provider_name="fireworks")`.
- This profile has `openai_supports_reasoning = False`, so `temperature` is kept.
- In `auto` send-back mode, a *foreign* provider's `ThinkingPart` is inlined as `<think>…</think>` text (`openai.py:1372-1390`).
- The SDK retries 408, 409, 429, 5xx, connection errors and timeouts, never 400/401/403. `max_retries=n` means n+1 total attempts.
- PydanticAI's DeepSeek profile marks only names starting `deepseek-v4-` as thinking-capable, and `deepseek-v4p1-flash` doesn't match. That's harmless while effort is always sent explicitly (R8).

## 3. Decisions

**D1. One model for every live role.** Every live model setting defaults to
`fireworks:accounts/fireworks/models/deepseek-v4p1-flash`: `model_counselor`,
`model_counselor_think`, `model_cheap`, `model_title`, and, through their
`""`-means-cheap fallbacks, `goal_model`, `model_goal_judge` and
`model_goal_criteria`. It's the only serverless DeepSeek, so the only thing
that varies is reasoning effort. `model_clarifier` has no consumer anywhere
(verified), so it's deleted, not retargeted.

**D2. Three reasoning-effort settings; every call sends one explicitly.**
The model reasons by default, so omitting the parameter would silently make
every call slow and expensive.

| Setting | Default | Used by |
|---|---|---|
| `reasoning_effort_quick` | `low` | Quick counselor turns, and goal turns started in Quick |
| `reasoning_effort_think` | `high` | Think counselor turns, and goal turns started in Think |
| `reasoning_effort_cheap` | `none` | Titles, document summaries, goal criteria writer, goal judge |

The eval-set judge (`evals/runner.py`) is a measurement instrument, not a
product role. It runs at `high`, set by one named constant in the runner
(`EVAL_JUDGE_REASONING_EFFORT`), so every candidate run in §7.4 is scored by
the same judge.

The values are `Literal["none", "low", "medium", "high"]`.

- **Quick starts at `low`, not `none`.** The probe's one wrong answer came at
  `none`, and Quick is the student's main path. §7.4 runs the agent evals at
  both values, twice each. Quick moves to `none` only if all three hold:
  - no deterministic honesty or citation scorer fails at `none` on a case
    that passes at `low`, in either run;
  - the judge-scored criteria pass count at `none` is within one case of
    `low`;
  - median turn latency improves by at least 1.5s.

  Otherwise Quick stays at `low`.
- **Goal turns keep today's behavior.** The goal agent receives the turn's
  Quick/Think effort, just as it receives the turn's `GoogleModelSettings`
  today (`agent_node.py:1758` → `:1904`, `:2008`, `:1508`). The difference
  is that the effort now arrives on the model it's built with (see below),
  not as a per-run setting. No new knob.
- **The judge shares `cheap`.** If the §7.3 gate fails at `none`, the fix is
  to add a dedicated `reasoning_effort_goal_judge`. That's a gate outcome,
  not a default (YAGNI).

**How the effort reaches each call: one mechanism.** Every model is built
by `build_model(..., reasoning_effort=...)`. The argument is required, and
the effort becomes the model's default `settings=`. Everything that runs on
that model inherits it:

- **Counselor and goal-agent turns.** `default_model_factory(settings,
  model_setting, reasoning_effort)` passes `selection.reasoning_effort`.
  The per-run `GoogleModelSettings` block at `agent_node.py:1749-1760` is
  deleted, and the goal agent's `model_settings` argument goes with it.
- **The goal-only `SummarizingCompaction` tier (`model=None`).** It builds a
  fresh `Agent(ctx.model)` and runs it with no `model_settings` (harness
  `_summarizing_compaction.py:282-286`). Only a model-level default reaches
  it, so a per-run override would leave it reasoning at Fireworks' default.
  That's why the effort has to live on the model.
- **Every other role** gets `reasoning_effort_cheap`. The judge's per-run
  `temperature=0.0` merges on top.

**D3. `app/llm.py::build_model()` is the only provider-construction site.**
- It replaces the five hand-rolled `GoogleModel(...)` constructions and
  `app/vertex.py`.
- It supports `fireworks:` only:
  `OpenAIChatModel(name, provider=FireworksProvider(openai_client=AsyncOpenAI(base_url=FIREWORKS_BASE_URL, api_key=…, max_retries=settings.agent_model_retry_attempts - 1)), settings=OpenAIChatModelSettings(openai_reasoning_effort=…))`.
  `FIREWORKS_BASE_URL` is a module constant, because
  `FireworksProvider.base_url` is an instance property.
- The explicit construction, rather than `infer_model`, exists only to pass
  the key from Settings and the retry count.
- Any other prefix raises `ValueError` naming the setting.
- A Settings validator runs the same check at boot, so a misconfigured env
  fails there, not mid-turn.
  - **One rule.** `FIREWORKS_MODEL_PREFIX = "fireworks:"` lives in
    `config/settings.py`, and `app/llm.py` imports it. The `app → config`
    direction is allowed by ADR 0017.
  - **Scope.** The validator checks `model_counselor`,
    `model_counselor_think`, `model_cheap`, `model_title`, `goal_model`,
    `model_goal_judge` and `model_goal_criteria`. It skips `""` values
    (they fall back to cheap) and never looks at `model_cds_*`.
- Adding a second provider later is one branch here plus an ADR.
- This keeps ADR 0011's mechanism (the model is an env value) without
  claiming untested provider support.

**D4. The Vertex live path is deleted** (house rule: no compatibility layers).
Deleted:
- `app/vertex.py`, `tests/app/test_vertex.py`
- `UnsupportedCounselorProvider`, `_require_vertex_prefix`, `_VERTEX_PREFIX`, `google_thinking_config`
- both `except UnsupportedCounselorProvider` blocks (`run_turn.py:589`, `:821`), since D3's boot validator makes the error impossible at turn time
- the `model_clarifier` setting

**D5. The raw-reasoning feed is off by default (`thinking_stream = false`),
and it's gated in the router, not the request.**

- *Why off.* Gemini returned short thought summaries. DeepSeek returns raw
  chain of thought: speculative, with uncited numbers. Shown beside a cited
  answer, a student reads the guess as fact. That violates the honesty
  carve-out.
- *Why the router.* DeepSeek can't be asked to "reason but don't return it".
- *What changes.* `EmissionRouter` (`app/steps.py`) takes
  `emit_thinking: bool`. `_emit_thinking` (`steps.py:1164`) is the single
  place that both writes the `thinking` event and appends to
  `thinking_lines`, so it returns early when the flag is false.
  - Only `ThinkingPart` / `ThinkingPartDelta` text reaches
    `_emit_thinking` (`_feed_thinking` / `_flush_thinking`,
    `steps.py:1150-1162`), so only that text is affected.
  - Pre-tool-call assistant text never goes there. It goes to
    `narration` (`_end_text_part` → `_flush_text_as_narration`,
    `steps.py:1097-1120`) and is unaffected.
  - `PartEndEvent` handling and the `next_part_kind == "thinking"` logic
    (`steps.py:1103`) are untouched.
  - The router is constructed at `agent_node.py:1941`, with
    `emit_thinking=settings.thinking_stream`.
  - The parameter defaults to `True`, so the 15 existing `EmissionRouter(`
    test call sites don't change.
- *Clean-up.* The deprecated `thinking_summaries` alias and
  `effective_thinking_stream` are deleted. Nothing reads them once the
  request-side `include_thoughts` is gone. The Gemini wording in the
  `thinking_stream` comment (`settings.py:256-260`) is rewritten.
- *Owner Q1:* keep it off, or turn it on after reading sample transcripts.

**D6. Earlier turns' `ThinkingPart`s are stripped from the history handed to
the model.**

- Checkpointed history of existing chats contains Gemini thoughts.
  PydanticAI would inline them as `<think>` text in assistant messages.
- DeepSeek's own multi-turn contract drops earlier reasoning anyway.
- `_split_user_message` (`agent_node.py:~310`) is the only place
  `state["messages"]` becomes `message_history` (verified: clarify
  continuations and goal resumes go through it). It returns a new list:
  - each `ModelResponse` is rebuilt with `dataclasses.replace(msg, parts=[p for p in msg.parts if not isinstance(p, ThinkingPart)])`;
  - responses left with no parts are dropped;
  - the D6 test also checks that dropping one leaves a history PydanticAI
    accepts (adjacent `ModelRequest`s are allowed).
- The checkpoint is never rewritten.
- Within one run, PydanticAI's `auto` mode still sends Fireworks'
  `reasoning_content` back on tool-result steps, which is DeepSeek's
  documented contract.

**D7. Cost stays conservative.** The Gemini `model_prices` entries are
deleted. No live model uses them, the CDS code doesn't read `model_prices`,
and `tests/api/test_usage.py` has its own fixture. One entry replaces them, keyed
`accounts/fireworks/models/deepseek-v4p1-flash`. `estimate_cost` receives the
full `fireworks:…` string (`agent_node.py:1215`, `turns.py:977`) and its
bare-name fallback strips only up to the first `:` (verified). It's priced at
the highest Global doc price, $0.30 in / $1.20 out, until the owner confirms
the account price (Q2). `ModelPriceTier` has no cached-input rate, so cached
tokens are overcounted. That means the goal budget binds earlier, never
later.

**D8. Display names.**

- Quick: `DeepSeek V4.1 Flash`.
- Think: `DeepSeek V4.1 Flash · Thinking`.
- `model_counselor_think_preview` becomes `false`.
- The frontend renders these from `/v1/config`, so no frontend code changes.
- The browser gate (§7.6) confirms the two modes read as distinct in the
  mode picker.

**D9. The Fireworks key is a secret setting.**

- Add `fireworks_api_key: str | None` to the masked `_SECRET_FIELDS`.
- Outside `development`, `_validate_deploy_auth_posture` fails boot when the
  key is empty. Every live model is now Fireworks, so no per-field check is
  needed.
- The key check goes **after** the existing user-agent placeholder check.
  That way `test_placeholder_user_agent_fails_boot_outside_development`
  (`test_settings.py:298`, `match="placeholder"`) still sees its error first.
- In development, `build_model` raises a clear "COUNSELLE_FIREWORKS_API_KEY
  is not set" error on first use. So the routine suite never needs a key.

## 4. Tasks (in order)

4.1 **Settings** (`config/settings.py`)
- Add `fireworks_api_key`, the three `reasoning_effort_*` fields, and the
  prefix validator (D3) and boot check (D9).
- Retarget the model defaults (D1) and delete `model_clarifier`.
- Set the display names and preview flag (D8), add the price entry (D7), and
  set `thinking_stream=False`.
- Delete `thinking_summaries` / `effective_thinking_stream` (D5).
- `agent_model_retry_attempts` gets `Field(default=3, gt=0)` (today it's a
  bare `int`, `:190`), so `attempts - 1` in `build_model` can never go
  negative. A one-line test in `test_settings.py` pins it.
- Reword the comments that name Gemini or the genai retry filter: `:183-190`
  (retry) and `:256-260` (thinking). The retry comment should say the value
  is total attempts, and `build_model` passes `attempts - 1` to the SDK.

4.2 **`app/llm.py`** (new, ~40 lines): `build_model(settings, model_setting,
*, reasoning_effort) -> Model`, per D3. `reasoning_effort` is required, so no
call can omit it. The bare model name comes from
`model_name_from_setting`.

4.3 **`app/model_selection.py`**
- `CounselorModelSelection` loses `thinking_level` and `include_thoughts`,
  and gains `reasoning_effort`, set from `reasoning_effort_quick` or
  `reasoning_effort_think`.
- Delete everything named in D4.
- Rewrite the `model_name_from_setting` docstring (Express-key and
  `GoogleModel` text).
- `model_name_from_setting` **stays**, and so does its `agent_node`
  re-export. `build_model` uses it, and so does parked CDS code:
  `app/cds/service_ingest.py:31` and `service_review_approve.py:42` import
  it via `app.agent_node`, and `adapters/cds_gemini.py:88` calls it.

4.4 **Call sites → `build_model`**
- `agent_node.py::default_model_factory` (`:278`) gains a `reasoning_effort`
  parameter. Both callers (`:1505`, `:1898`) pass `selection.reasoning_effort`.
  The `GoogleModelSettings` block at `:1749-1760` is deleted.
  `_run_goal_loop`'s `model_settings` parameter (`:1327`) is **replaced** by
  `reasoning_effort`. The loop passes it to its wrap-up agent's
  `default_model_factory(settings, model_setting, reasoning_effort)` call
  (`:1505`), and the `model_settings=` at `:1508` goes (D2).
- `goal_judge.py::_vertex_model` (`:119`), renamed `_model`. `temperature=0.0`
  is unchanged.
- `titles.py` (`:92`) and `workspace/document_summary.py::_summary_model`
  (`:114`), which becomes one `build_model` call.
- `evals/runner.py::build_judge_agent` (`:87`), with
  `EVAL_JUDGE_REASONING_EFFORT = "high"` (D2).
- Rewrite the stale comments and docstrings:
  - `app/deps.py:6,45`
  - `agent_node.py:279-300` (`default_model_factory`) and `:~976`
  - `titles.py:92`
  - `steps.py:27,1105`
  - `domain/events.py:290`
  - `app/usage.py:30-53` (examples, and "Google's long-context rates")

4.5 **`app/run_turn.py`**: remove both `except UnsupportedCounselorProvider`
blocks and the import.

4.6 **`app/steps.py`**: the `emit_thinking` gate (D5).

4.7 **`app/agent_node.py::_split_user_message`**: the history strip (D6).

4.8 **Delete** `app/vertex.py` and `tests/app/test_vertex.py`.

4.9 **Tests**, only where they break or pin an honesty or integrity rule:

| File | Change |
|---|---|
| `tests/app/test_model_selection.py` | Rewritten for `reasoning_effort`. The `anthropic:` cases (`:100,105`) are deleted. |
| `tests/test_settings.py` | Covers defaults, masking, the prefix validator (including `""` skipped and `model_cds_*` ignored), and the D9 boot check. `test_real_user_agent_boots_outside_development` (`:306-322`) now sets `COUNSELLE_FIREWORKS_API_KEY`. Delete the `model_clarifier` assertion (`:87-94`) and the `thinking_summaries` / `effective_thinking_stream` tests (`:212-226`, including `test_deprecated_thinking_summaries_env_overrides…`). |
| `tests/app/test_profile_memory_services.py` | Every `_summary_model` test: the `GoogleModel`/Vertex ones (`:695-750`) and the `anthropic:` pass-through ones (`:665-690`, `~787`, `~879`). They are replaced by one test that `_summary_model` calls `build_model` with `model_cheap` and `reasoning_effort_cheap`. Any other test here that sets a non-Fireworks `model_cheap` uses a Fireworks string. |
| `tests/app/test_goal_judge.py` | 8 `_vertex_model` monkeypatch sites become `_model`. |
| `tests/app/test_goal_loop.py` | Update the stub Settings (`:914-938`): drop `thinking_summaries` / `effective_thinking_stream`, add `reasoning_effort_*`. The `google-vertex:` strings in `_PricedSettings` become Fireworks-shaped labels with their own price entries. At the eight `model_settings=None` call sites (`:158`, `:257`, `:350`, `:654`, `:779`, `:870`, `:1094`, `:1227`), the argument is replaced by `reasoning_effort` (D2). |
| `tests/app/test_run_turn.py` | The stub Settings (`:86-97`) gets the same change. Drop the `UnsupportedCounselorProvider` cases and Vertex patches. Rewrite the `_CapturingAgent` / `_run_node_capturing_model_settings` tests (`:440-660`), which assert `google_thinking_config`. They monkeypatch `default_model_factory` and assert the `reasoning_effort` it receives: Quick → `reasoning_effort_quick`, Think → `reasoning_effort_think`, and a goal turn → the turn's effort. |
| `tests/app/test_turns_edge_cases.py` | Drop the `UnsupportedCounselorProvider` cases and Vertex patches. |
| `tests/app/test_live_llm.py:322-395` | The three hardcoded `google-vertex:` `meta.model` assertions read the Settings value. |

Before starting 4.9, grep `tests/` for every real `Settings(` or env
construction that sets a live model field to a non-Fireworks prefix.
`SimpleNamespace` stubs don't go through the validator. Each hit is fixed
in its row above, or added as a row.

New tests, each pinning a rule:
- `tests/app/test_llm.py`: `build_model` raises on a missing key and on a
  non-`fireworks:` prefix. With a dummy key, it builds without touching the
  network.
- **Request-body tests.** One harness serves both of these: the real
  `build_model` model, backed by an `AsyncOpenAI` on an
  `httpx.MockTransport` that captures the request body. No test hits the
  network.
  - A built model's request body carries the requested `reasoning_effort`.
  - The goal judge's request body carries both `temperature: 0.0` and
    `reasoning_effort: "none"`.

  `FunctionModel` can't prove this, because it doesn't carry
  `build_model`'s default settings.
- The router emits no `thinking` event and appends no `thinking_lines`
  when `emit_thinking=False`, and still emits when true (D5).
- `_split_user_message` strips prior-turn `ThinkingPart`s, drops emptied
  responses, and leaves its input list unchanged (D6).

Fixtures that use `google-vertex:` only as an opaque label (usage math,
protocol fixtures, CDS tests) stay as they are.

4.10 **Local environment** (a one-time step for whoever runs this locally;
not app code). Make Python prefer IPv4 on this workstation:
`precedence ::ffff:0:0/96 100` in `/etc/gai.conf`. Nothing in §7 runs locally
until this is done (R1).

4.11 **Docs**
- **New `docs/adr/0043-fireworks-deepseek-default-model.md`** (0042 is
  taken). It records D1–D5 and supersedes only ADR 0011's *default value*
  and *any-provider-without-code* claim, and ADR 0034's Gemini thinking
  protocol. Add a row to `docs/adr/README.md`.
- `docs/ARCHITECTURE.md`: the models row `:131`, the settings row `:522`,
  Quick/Think `~:761`, the "Gemini/Tavily budget" line `:875`, and the
  thinking-stream text.
- `docs/DEPLOY.md`: "Models / GCP" becomes "Models". It covers the key, the
  efforts, and `THINKING_STREAM` (`:142`). GCP creds are only needed to
  revive the parked CDS.
- `.env.example`: the model lines, the key, the efforts, prices, and
  `THINKING_STREAM`. Delete the `MODEL_CLARIFIER` line (`:21`) and the
  `THINKING_SUMMARIES` comment block (`:61-63`).
- `evals/goal_judge/README.md`: the model line.
- `CLAUDE.md`: the stack bullets ("Model config", "Models"), plus a dated
  status entry when this ships.
- `TODOS.md`: the open items that aren't closed by merge:
  - price confirmation, if still open;
  - the CDS still being on Gemini;
  - **before the app is deployed (B6):** the app's privacy copy must name
    Fireworks as the model processor. Today the only privacy page is the
    landing waitlist's (`frontend/src/features/landing/`), and it names no
    model provider, so nothing shipped goes stale with this change.

## 5. File manifest

| Action | Files |
|---|---|
| new | `app/llm.py`, `docs/adr/0043-fireworks-deepseek-default-model.md` |
| delete | `app/vertex.py`, `tests/app/test_vertex.py` |
| modify (code) | `config/settings.py`, `app/model_selection.py`, `app/agent_node.py`, `app/run_turn.py`, `app/steps.py`, `app/goal_judge.py`, `app/titles.py`, `app/workspace/document_summary.py`, `app/deps.py` (comments), `domain/events.py` (docstring), `evals/runner.py` |
| modify (docs) | `.env.example`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, `docs/adr/README.md`, `evals/goal_judge/README.md`, `CLAUDE.md`, `TODOS.md` |
| modify (tests) | `tests/app/test_model_selection.py`, `tests/test_settings.py`, `tests/app/test_profile_memory_services.py`, `tests/app/test_goal_judge.py`, `tests/app/test_goal_loop.py`, `tests/app/test_run_turn.py`, `tests/app/test_turns_edge_cases.py`, `tests/app/test_live_llm.py`, the existing router and agent-node test files (new D5/D6 tests), a new `tests/app/test_llm.py` |
| untouched | `adapters/cds_gemini.py`, `app/cds/**`, `domain/specs.py` (its recursive-`$ref` note holds for any strict-schema provider), `scripts/finish_render_staging.py`, `scripts/verify_cds_adapters.py` (CDS/deploy-only Vertex mentions) |

**Exit criterion.** `grep -rnE "GoogleModel|app\.vertex|google-vertex|google_thinking_config" app config evals api domain --include=*.py`
may match only:
- `app/cds/**`
- `domain/cds/**`
- the `model_cds_*` settings defaults

Mentions of "Gemini" in prose (e.g. the parked `gemini-native-pdf-*`
extractor versions, `domain/specs.py:133`) are out of scope for the grep.

## 6. Env after the switch

```
COUNSELLE_FIREWORKS_API_KEY=fw_...
COUNSELLE_MODEL_COUNSELOR=fireworks:accounts/fireworks/models/deepseek-v4p1-flash
COUNSELLE_MODEL_COUNSELOR_THINK=fireworks:accounts/fireworks/models/deepseek-v4p1-flash
COUNSELLE_MODEL_CHEAP=fireworks:accounts/fireworks/models/deepseek-v4p1-flash
COUNSELLE_MODEL_TITLE=fireworks:accounts/fireworks/models/deepseek-v4p1-flash
COUNSELLE_REASONING_EFFORT_QUICK=low
COUNSELLE_REASONING_EFFORT_THINK=high
COUNSELLE_REASONING_EFFORT_CHEAP=none
COUNSELLE_THINKING_STREAM=false
```

## 7. Verification (the merge gate)

0. **Baseline** (agent evals and criteria writer only). Run the agent eval
   set and the §7.5 criteria check on `main` (Gemini).
   - The last report (`evals/report-2026-07-16.*`) predates ADR 0038's tool
     rework, so it's no baseline.
   - The goal-judge gate needs no re-run. Its bar is absolute (TPR/TNR
     1.000), and the Gemini pass is already on record
     (`evals/goal_judge/REPORT-20260916T160355Z.md`).
   - This needs working Vertex creds. If they're gone, see owner Q3.
1. `uv run ruff check . && uv run mypy .`, plus the routine suite with **no**
   `.env` sourced:
   `uv run pytest -m "not live_llm and not live_search and not live_db"`.
   Green, apart from the failures already recorded in `TODOS.md`. The §5
   grep exit criterion also holds.
2. `uv run pytest -m live_llm`.
3. **Goal-judge gate** (`evals/goal_judge/`, all cases in `cases.yaml`,
   currently n≥43).
   - It must reach TPR 1.000, TNR 1.000 and FPR 0.000 on **two consecutive
     runs**, including the adversarial padding subset.
   - That `temperature=0.0` is actually sent is pinned by the §4.9 test,
     not inferred from these runs.
   - If it fails at `none`, add `reasoning_effort_goal_judge` and re-run at
     `low`. If it still fails, stop and escalate. The judge never ships
     weaker.
4. **Agent eval set** (`uv run python -m evals.runner`). Runs: Quick at
   `low` ×2, Quick at `none` ×2, and Think at `high` ×1.
   - Each run sets the effort through the environment, e.g.
     `COUNSELLE_REASONING_EFFORT_QUICK=none`.
   - The report's filename or header records the effort, so the runs are
     distinguishable.
   - D2's latency rule reads the runner's existing per-question latency
     stats (`_comparison_stats` / `_percentile`).
   - **Deterministic scorers** (citation, value reading, honesty checks,
     which need no judge) are compared case by case with the §7.0 baseline.
     They may not regress at the shipped settings.
   - **Judge-scored criteria** are compared only across the new runs. Every
     new run uses the same DeepSeek judge (D2), so those comparisons are fair.
     Against the Gemini-judged baseline, a judge-scored difference is
     hand-read, not counted, because the baseline's judge is a different
     model.
   - Any other regression is listed in the PR for the owner.
   - The Quick default is decided here, by the D2 rule.
5. **Criteria-writer spot check.** Run the 5 goal statements in
   `evals/goal_judge/criteria_examples.yaml` (or 5 fixed ones if it holds
   fewer) through `derive_criteria`. Run them on DeepSeek, and on Gemini
   (`main`) too if Vertex creds exist (Q3). The properties below are
   absolute on both. Each criterion must
   describe an outcome, not a step. None may be padded or split. None may
   turn "add a task" into "the task is complete".
6. **Real browser, live backend** (see the in-browser gate setup), on a
   throwaway account:
   - a Quick turn with a DB lookup and citations;
   - a Think turn: no raw-reasoning feed, the work timeline intact, and a
     visible working state during the silent reasoning period (no blank
     screen);
   - a `/goal` run to "All done";
   - a `/goal` run that pauses on `ask_student` and resumes after an
     answer;
   - a clarify-widget continuation;
   - an essay-panel edit that lands as a suggestion, with the pending-changes
     readout correct;
   - a pre-switch chat continued, with no `<think>` text in the reply (D6);
   - the Quick/Think picker labels (D8).
7. Record in the PR, next to the §7.0 Gemini baseline, all from the `usage`
   events:
   - per-turn latency, TTFT (to the first visible token) and cost;
   - for each §7.6 goal run: rounds, reasoning tokens and cost, compared with
     the default goal budget (`goal_max_cost_usd`).

   A Think-started goal inherits `high` in the agent and its summarizer on
   every round, so this is where hidden reasoning tokens would compound.

## 8. Risks

- **R1. Local IPv6 hang.** On this machine every Python call to Fireworks
  hangs until it times out. The fix belongs in the environment (4.10);
  forcing IPv4 in app code would be coding around one laptop's network. If
  the deploy host shows the same symptom, revisit it there.
- **R2. Quality at low effort, and cost at high effort.** Quick defaults to
  `low` and the cheap roles to `none`. §7.4, §7.5 and §7.6 measure quality.
  In the other direction, a Think-started goal reasons at `high` every
  round. If §7.7 shows it eating the goal budget early, the remedy is a
  settings change (lower `reasoning_effort_think`, or a goal-specific effort
  added then), not code. Every remedy is a settings
  change.
- **R3. Judge weakening.** A cheap judge is the one most exposed to padding
  attacks (`plans/goal-mode-plan.md` R2). §7.3 is a hard gate.
- **R4. Price ambiguity.** The docs give three different prices. D7 prices
  high. The owner confirms (Q2).
- **R5. Single serverless model.** If Fireworks retires or renames
  `deepseek-v4p1-flash`, every call fails. The fix is one setting. The
  failure surfaces as the existing user-safe error event.
- **R6. Silent Think.** With the reasoning feed hidden, a `high` Think turn
  may show nothing but its working state for several seconds. §7.6 checks
  that it never looks frozen.
- **R7. Tool-schema dialect.** Fireworks gets OpenAI-style strict schemas
  instead of Gemini's. A rejection shows up in §7.2 as a 400, and is fixed
  in the schema.
- **R8. PydanticAI profile gap.** `deepseek-v4p1-*` isn't recognized as
  thinking-capable. This is harmless while effort is always explicit. A
  PydanticAI upgrade that starts honoring the profile could change request
  shape, and the `test_llm.py` / D5 tests would catch it.
- **R9. Transport retries count** changes meaning: genai's attempts become
  the SDK's `max_retries + 1`. Handled in D3 (`attempts - 1`).

## 9. Rollback

Rollback is **`git revert` only**. Env changes alone can't restore Gemini,
because the Vertex path is deleted (D4). There's no migration and no schema
change. Chats created on DeepSeek, replayed on Gemini after a revert: the
Gemini mapper drops foreign or unsigned `ThinkingPart`s (`google.py:1617`).
Whether Gemini 3 accepts function-call history without its own thought
signatures is **unverified**. If a revert is ever needed, check one
DeepSeek-era chat first. A revert also needs working Vertex creds (Q3). If
they're gone, reverting doesn't restore a working app.

## 10. Owner decisions

- **Q1.** Keep the raw DeepSeek reasoning feed hidden (D5, recommended), or
  show it?
- **Q2.** Confirm the account's V4.1 Flash price on the Fireworks billing
  page (D7).
- **Q3.** Are Vertex creds still available for the §7.0 Gemini baseline? If
  not, §7.4 uses an absolute bar instead: zero deterministic
  citation/honesty scorer failures at the shipped settings, plus the owner
  reading 10 full transcripts (5 Quick, 5 Think) and signing off. The stale
  2026-07-16 report is never the bar.
- **Q4.** Confirm the Fireworks account's data terms: zero data retention,
  and no training on prompts or outputs. Student essays, profiles and chats
  go there instead of Google. Minors' data makes this the owner's call.
  - Q4 does **not** gate the merge. Evals use synthetic questions, and the
    app isn't deployed.
  - It **does** gate production traffic and any real student data.
  - Until it's answered, dev and eval runs use only synthetic or throwaway
    accounts.

## 11. Implementation notes (deviations from this plan)

- **Price entry is a boot check.** Every non-empty live model setting must have a
  `model_prices` entry keyed by its name without `fireworks:`, or boot fails. An
  unpriced model would cost $0 in the goal ledger and `goal_max_cost_usd` would
  never bind (review finding).
- **Deploy paths the §5 manifest missed.** `render.yaml` wires
  `COUNSELLE_FIREWORKS_API_KEY` instead of the Vertex key, and
  `scripts/finish_render_staging.py` requires it. §5 listed the script as
  untouched; it is the live deploy path, so it changed.
- **More tests changed than §4.9 listed:**
  `tests/app/test_ask_student_output_tool_seam.py` now maps the clarify history
  through the production OpenAI-compatible mapper instead of Gemini's;
  `tests/api/test_routes_unit.py` stub settings; the protocol fixtures' opaque
  `meta.model` label (regenerated, model-label diff only);
  `tests/evals/test_scorers.py` for the effort in the report name. A test pins
  the `thinking_stream` → router wiring.
- **Eval reports carry the effort** in the file name
  (`report-<date>[-<mode>]-<effort>`) and the header, so §7.4's runs are
  distinguishable.
- **§4.10 done on this workstation** (2026-09-29): `/etc/gai.conf` gained the
  IPv4 precedence line (backup at `/etc/gai.conf.bak-20260929`).
- `README.md`, `scripts/chat_cli.py` and `docs/adr/0028-*.md` (status note: the
  `thinking_stream`-on default is reversed) were also updated.
