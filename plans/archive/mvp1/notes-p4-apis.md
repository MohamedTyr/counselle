# Phase 4 API notes — verified against installed sources (anti-hallucination gate)

**Date:** 2026-06-10. **Ground truth:** `.venv/lib/python3.12/site-packages/` (pinned: pydantic-ai 1.107.0, langgraph 1.2.4, langgraph-checkpoint-postgres 3.1.0 (+ langgraph-checkpoint 4.1.1), tavily-python 0.7.25, mcp 1.27.2, fastmcp 3.4.2, google-genai 2.8.0, psycopg 3.3.4).

Every snippet below was **executed** with `uv run python` against the installed packages unless marked "inspected only". The live Gemini auth gate (§1) **passed** with the real `COUNSELLE_VERTEX_API_KEY`.

**Builders: code against this file. If reality disagrees with this file, fix this file first.**

---

## 1. PydanticAI agent + Vertex Express-mode auth ⚠️ CRITICAL

### The verdict

- ❌ **Do NOT use the model string `"google-vertex:gemini-2.5-pro"`.** Two problems, both verified:
  1. The `google-vertex:` prefix is **deprecated** in 1.107 ("Use 'google-cloud:' instead", removed in v2.0) — `providers/__init__.py:141`.
  2. Any string form constructs the provider with **no api_key argument**; it falls back to `GOOGLE_API_KEY` / `GEMINI_API_KEY` env vars, and when those are absent it goes down the ADC path and raises `google.auth.exceptions.DefaultCredentialsError`. Our key lives in `COUNSELLE_VERTEX_API_KEY`, so the string form **cannot work** without leaking our key into a Google-named env var.

- ✅ **The 1.107 way: explicit `GoogleModel` + `GoogleCloudProvider(api_key=...)`.** `GoogleCloudProvider` is the renamed Vertex provider and natively supports **Vertex AI Express Mode** keys — its constructor docstring literally links the Express Mode docs, and it builds exactly the client the pipeline builds by hand:

```python
# providers/google_cloud.py:77-84 — what it does internally:
#   Client(vertexai=True, api_key=api_key, project=None, location=None, ...)
from pydantic_ai import Agent
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google_cloud import GoogleCloudProvider

provider = GoogleCloudProvider(api_key=settings.vertex_api_key)  # COUNSELLE_VERTEX_API_KEY
model = GoogleModel("gemini-2.5-pro", provider=provider)
agent = Agent(model, instructions=..., deps_type=Deps)
```

Rules inside `GoogleCloudProvider.__init__` (verified at `providers/google_cloud.py:55-84`):
- `api_key` given, no `credentials`/`project`/`location` → `Client(vertexai=True, api_key=...)` = Express Mode. No project, no location, no ADC.
- If any of `credentials`/`project`/`location` is passed, `api_key` is **silently nulled** (`google_cloud.py:64-65`) and it goes ADC. Never pass those.
- A pre-built client also works: `GoogleCloudProvider(client=genai.Client(vertexai=True, api_key=...))` (`google_cloud.py:55-57`) — this is the 1.107 equivalent of the pipeline's pattern, but the `api_key=` form is simpler and identical in effect.
- Legacy `GoogleProvider(vertexai=True, api_key=...)` still works but emits `PydanticAIDeprecationWarning` and just delegates to `GoogleCloudProvider` (`providers/google.py:152-176`). Don't use it.

### Live auth gate — PASSED ✅

Ran against real Vertex with the `.env` key (2026-06-10):

```text
OUTPUT: Hello, Counselle
USAGE: requests=1 input_tokens=13 output_tokens=366 total=379
client.vertexai = True | provider.name = google-cloud | base_url = https://aiplatform.googleapis.com/
```

Note the 366 output tokens for a one-sentence reply: **Gemini 2.5 Pro thinks by default** and thinking tokens bill as output. The cost lever is `GoogleModelSettings(google_thinking_config=...)` (`models/google.py:241,252` — all fields `google_`-prefixed). Worth setting a thinking budget on the cheap tier.

Verified against installed source: `pydantic_ai/providers/google_cloud.py:20-84`, `pydantic_ai/models/google.py:459-495`, `pydantic_ai/models/__init__.py:1118` (string dispatch), `pydantic_ai/providers/__init__.py:135-145` (deprecation).

---

## 2. PydanticAI MCP client (stdio) ⚠️ SURPRISE: `MCPServerStdio` is deprecated

`MCPServerStdio` still exists and works in 1.107 but **emits `DeprecationWarning` at construction** ("removed in v2. Use `MCPToolset(...)`") — verified by constructing one. The 1.107-native class is **`MCPToolset`** (`pydantic_ai/mcp.py:1990`), built on the fastmcp client. For an arbitrary command (our `counselle-db-mcp` entry point) use fastmcp's `StdioTransport`:

```python
import os
from fastmcp.client.transports import StdioTransport   # fastmcp/client/transports/stdio.py
from pydantic_ai.mcp import MCPToolset

db_toolset = MCPToolset(
    StdioTransport(
        command="uv",
        args=["run", "counselle-db-mcp"],
        env={...},                       # see env note below
        cwd=str(REPO_ROOT),              # optional
    ),
    id="counselle-db",                   # optional; tool_error_behavior='retry' is the default
)
agent = Agent(model, toolsets=[db_toolset])    # mounts all 10 tools
```

- Constructor: `MCPToolset(client, *, id=, max_retries=, tool_error_behavior='retry'|'error', process_tool_call=, cache_tools=True, init_timeout=, read_timeout= (default 5 min), ...)` — `mcp.py:2127-2163`.
- **Env semantics:** the child does **not** inherit the parent env. `StdioTransport(env=...)` flows into the MCP SDK, which merges your dict over `get_default_environment()` (PATH, HOME, … only) — `mcp/client/stdio/__init__.py:127`. So the `COUNSELLE_*` vars the MCP server needs **must be passed explicitly** in `env=`.
- **Lifecycle:** `MCPToolset` is an async context manager with reference counting (`mcp.py:2384`). `Agent.__aenter__` enters all *construction-time* toolsets (`agent/__init__.py:2724`) — so either `async with agent:` for the app lifetime, or `async with db_toolset:` in the FastAPI lifespan. Without that, the run machinery enters/exits the toolset per run (subprocess churn; fastmcp's `keep_alive=True` default softens this by reusing the subprocess across connections).
- `process_tool_call` hook (for the **source-registry interception**, Slice B): `ProcessToolCallback = Callable[[RunContext[Any], CallToolFunc, str, dict[str, Any]], Awaitable[ToolResult]]` — receives `(ctx, call_tool, name, args)`; await `call_tool(name, args)` and post-process/rewrite its return value before the model sees it. `mcp.py:1934-1966`.

Verified against installed source: `pydantic_ai/mcp.py:1406` (legacy class + deprecation), `:1990-2263` (MCPToolset), `fastmcp/client/transports/stdio.py:50-67` (StdioTransport ctor), `mcp/client/stdio/__init__.py:51-127` (env merge). Constructed live in a script — both classes.

---

## 3. Function tools, deps, and per-run toolset assembly

```python
from dataclasses import dataclass
from pydantic_ai import Agent, RunContext
from pydantic_ai.toolsets import FunctionToolset

@dataclass
class Deps:                      # our per-turn deps object (source_config, registry, services…)
    tag: str

tavily_ts = FunctionToolset()    # toolsets/function.py:45

@tavily_ts.tool                  # docstring → description; works sync or async; toolsets/function.py:146
async def search_web(ctx: RunContext[Deps], query: str) -> dict:
    """Search the live web."""
    return {...}                 # ctx.deps is the Deps instance; ctx.tool_call_id available

agent = Agent(model, deps_type=Deps, toolsets=[db_toolset])   # always-on tools at construction
```

**Per-run toolsets: YES.** `run()`, `run_stream()`, `run_stream_events()`, and `iter()` all take `toolsets: Sequence[AbstractToolset] | None` documented as "**Optional additional** toolsets for this run" (`agent/abstract.py:255-365`) — i.e. **additive** to construction-time toolsets, exactly what ADR 0013's per-request gating needs:

```python
run_toolsets = []
if source_config.web:    run_toolsets.append(web_ts)      # disabled → never constructed
if source_config.reddit: run_toolsets.append(reddit_ts)
result = await agent.run(user_text, deps=deps, toolsets=run_toolsets, ...)
```

Verified by execution: a `FunctionToolset` passed only at `run()` time was called by `TestModel` (its `FunctionToolCallEvent` appeared in the stream). `RunContext` fields: `deps`, `messages`, `tool_call_id`, `retry` (`_run_context.py:37-66`).

---

## 4. Streaming + events + usage

**Use `agent.run_stream_events()`** — the one call that yields text deltas AND tool events AND the final result (this is what `run_turn` translates into domain `Event`s). It returns `AgentEventStream` which **must be used as `async with`** (bare iteration is deprecated, `result.py:965-1016`):

```python
from pydantic_ai.messages import (
    PartStartEvent, PartDeltaEvent, PartEndEvent, TextPartDelta,      # messages.py:2713/2742/2758
    FunctionToolCallEvent, FunctionToolResultEvent, FinalResultEvent, # messages.py:2833/2874/2783
)
from pydantic_ai.run import AgentRunResultEvent                       # run.py:626 (also re-exported from pydantic_ai)

async with agent.run_stream_events(user_text, deps=deps, toolsets=ts, usage_limits=ul,
                                   message_history=history) as stream:
    async for ev in stream:
        match ev:
            case PartDeltaEvent(delta=TextPartDelta(content_delta=text)):
                ...                                   # → delta event
            case FunctionToolCallEvent(part=part):
                part.tool_name, part.args, part.tool_call_id   # tool call observed
            case FunctionToolResultEvent(part=part):
                ...                                   # ToolReturnPart | RetryPromptPart
            case AgentRunResultEvent(result=result):
                ...                                   # final AgentRunResult
```

Observed live event order with `TestModel` (one tool call → text answer):
`PartStartEvent, PartEndEvent, FunctionToolCallEvent, FunctionToolResultEvent, PartStartEvent, FinalResultEvent, PartDeltaEvent, PartDeltaEvent, PartEndEvent, AgentRunResultEvent`.
Filter text deltas with `isinstance(ev, PartDeltaEvent) and isinstance(ev.delta, TextPartDelta)` — thinking/tool-call deltas come through the same event with different delta kinds (`ModelResponsePartDelta`, `messages.py:2705`).

Alternatives (exist, not needed): `run_stream()` → `StreamedRunResult` ctx manager (text-centric); `iter()` → node-by-node `AgentRun` (`abstract.py:1328`).

**Usage:** `result.usage` is a **property** in 1.107 — calling it as `result.usage()` works but emits `PydanticAIDeprecationWarning`. Shape (`RunUsage`, `usage.py:182-194`): `requests`, `tool_calls`, `input_tokens`, `output_tokens`, `total_tokens` (property), `details: dict`. Verified live: `requests=1 input_tokens=13 output_tokens=366`.

---

## 5. Message history (serialize for checkpointing)

```python
from pydantic_ai.messages import ModelMessage, ModelMessagesTypeAdapter  # messages.py:2373/2377

msgs: list[ModelMessage] = result.all_messages()       # full history incl. this run
raw: bytes = ModelMessagesTypeAdapter.dump_json(msgs)  # or .dump_python(msgs, mode='json') → plain list[dict]
back: list[ModelMessage] = ModelMessagesTypeAdapter.validate_json(raw)   # or .validate_python(...)

await agent.run("next turn", message_history=back, ...)  # param: Sequence[ModelMessage]
```

Round-trip executed and verified (dump → validate → new run with history). `ModelMessage = Annotated[ModelRequest | ModelResponse, Discriminator('kind')]`; the adapter is a `pydantic.TypeAdapter(list[ModelMessage])` with base64 bytes handling.

**For the LangGraph state:** store `ModelMessagesTypeAdapter.dump_python(msgs, mode='json')` (plain dicts) in `TurnState.messages`, not the message objects — see serde warning in §8.

---

## 6. Bounding the tool loop (`settings.max_tool_rounds`)

`UsageLimits` (`usage.py:263`) — pass per run:

```python
from pydantic_ai.usage import UsageLimits
from pydantic_ai.exceptions import UsageLimitExceeded

ul = UsageLimits(request_limit=settings.max_tool_rounds)   # default request_limit=50; usage.py:272
# also available: tool_calls_limit, input_tokens_limit, output_tokens_limit, total_tokens_limit
```

`request_limit` = number of **model requests** in the run; each tool round costs one request, so it is exactly "max tool rounds (+1 for the final answer)". Checked **before** each request (`usage.py:380-382`), raising `UsageLimitExceeded`.

Verified by execution: an endlessly tool-calling `FunctionModel` with `request_limit=3` raised `UsageLimitExceeded: The next request would exceed the request_limit of 3`. The runner must catch `UsageLimitExceeded` and convert to a clean error event (the phase test demands "cut off with a clean error").

---

## 7. LangGraph: StateGraph, interrupt(), Command(resume=), custom streaming

### Imports

```python
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command, Interrupt, StreamWriter   # types.py:811/759/535/136
from langgraph.config import get_stream_writer                            # config.py:126
```

### interrupt() — semantics in 1.2.4, all verified by execution

- `interrupt(value)` works **inside arbitrary nested async functions** under a node — it reads the config from a `ContextVar` (`langgraph/config.py:17-29` → `langchain_core.runnables.config.var_child_runnable_config:166`), which propagates through `await` chains on Python 3.12. Our `ask_student` tool calling `interrupt(clarify_spec.model_dump())` from inside the PydanticAI tool executor **works** (tested with an `await`-crossing nested call).
- First call raises `GraphInterrupt`; the run "parks". The value surfaces as `result["__interrupt__"]` → tuple of `Interrupt(value=..., id=...)` (in `ainvoke` result, in `astream` `updates` chunks, and in `(await graph.aget_state(cfg)).tasks[*].interrupts`).
- Resume: `await graph.ainvoke(Command(resume=answer), config)` with the **same `thread_id`** — `interrupt()` then returns `answer` inside the node. Verified end-to-end.
- **⚠️ THE BIG CAVEAT — resume RE-EXECUTES the node from the start** (`types.py:824`: "The graph resumes from the start of the node, **re-executing** all logic"). Verified: the node function ran **twice**. Resume values match interrupts **by order of occurrence within the task** (`types.py:826-828`). Design consequences for our `agent` node (one PydanticAI run containing the tool loop):
  1. On resume, the **entire PydanticAI run replays**: the model is re-called from the start of the turn (re-billed), and any DB/Tavily tools the model called before `ask_student` are re-executed. DB reads are cheap/idempotent; this is acceptable for MVP1 but must be understood — it is NOT "continue from inside the tool".
  2. The replayed LLM run is **not deterministic** — if on replay the model doesn't call `ask_student` (or calls it with a different question), the resume value is consumed by whatever the *first* `interrupt()` call in the re-executed node is, or never consumed. Mitigation: keep temperature low isn't enough; accept the risk for MVP1 (clarify happens early in a turn, before most tool calls) and assert structurally in tests. Flag in code comments.
  3. Anything with side effects before the interrupt (source-registry writes, viz_emitted) must be **rebuilt by the replay**, not accumulated externally, or you get duplicates. Keep all per-turn accumulation inside the node's returned state update.
- A checkpointer is **required** for interrupts (verified: works with `MemorySaver`).

### Custom streaming out of a node mid-run

`get_stream_writer()` returns a `StreamWriter = Callable[[Any], None]`; call it with any payload; consume with `stream_mode="custom"`:

```python
async def agent_node(state: TurnState):
    writer = get_stream_writer()           # works inside the node frame (ContextVar)
    writer({"delta": "..."})               # emitted mid-node
    ...

async for mode, chunk in graph.astream(inputs, cfg, stream_mode=["custom", "updates"]):
    # ("custom", {"delta": "..."}) ... ("updates", {"__interrupt__": (Interrupt(...),)})
```

Verified: custom chunk arrived before the interrupt chunk, with `stream_mode` as a list giving `(mode, chunk)` tuples. This is how `run_turn` forwards PydanticAI deltas (writer is captured in the node frame; per the docstring it can be called from inside nodes/tasks — on Python ≥3.11 nested async is fine, same ContextVar mechanism as interrupt; **verified working from the node frame, pass the writer down or call `get_stream_writer()` near the top of the node**).

Graph assembly is the classic API (verified):
```python
g = StateGraph(TurnState); g.add_node("agent", agent_node); g.add_edge(START, "agent"); g.add_edge("agent", END)
graph = g.compile(checkpointer=saver)
cfg = {"configurable": {"thread_id": session_id}}
```

---

## 8. AsyncPostgresSaver

```python
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver   # checkpoint/postgres/aio.py:40
```

Two construction modes (both inspected at `aio.py:45-88`):

```python
# (a) short-lived: async context manager — closes the connection on exit (aio.py:65-88)
async with AsyncPostgresSaver.from_conn_string(dsn) as saver:
    await saver.setup()

# (b) long-lived app (recommended): own the connection/pool
from psycopg import AsyncConnection
from psycopg.rows import dict_row
conn = await AsyncConnection.connect(dsn, autocommit=True, prepare_threshold=0, row_factory=dict_row)
saver = AsyncPostgresSaver(conn)        # also accepts AsyncConnectionPool (Conn type, _ainternal.py:10)
await saver.setup()                     # MUST be called once; runs its own migrations (aio.py:90)
```

The three connection kwargs above are exactly what `from_conn_string` uses internally (`aio.py:107-109`) — replicate them when owning the connection. `setup()` creates `checkpoint_migrations`, `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` in the **first schema of `search_path`**; there is no schema parameter.

**search_path DSN trick — confirmed.** psycopg's conninfo accepts `options`; verified by execution:

```python
psycopg.conninfo.conninfo_to_dict('postgresql://u:p@host:5432/db?options=-csearch_path%3Dcounselle,public')
# → {'options': '-csearch_path=counselle,public', ...}
```

So `COUNSELLE_DB_APP_DSN + "?options=-csearch_path%3Dcounselle,public"` (use `&` if the DSN already has a query string) puts the saver's tables in `counselle.*`. The D3 fail-fast assertion then checks `information_schema.tables` as specced.

**Serde — what the state may contain.** `JsonPlusSerializer` (`checkpoint/serde/jsonplus.py:82`, ormsgpack-based). Verified by execution:
- plain dicts/lists/str/int/float/None: clean round-trip ✅
- pydantic `BaseModel` and dataclasses: round-trip **but** emit *"Deserializing unregistered type … will be blocked in a future version"* warnings (allowlist via `LANGGRAPH_STRICT_MSGPACK` / `allowed_msgpack_modules`, `jsonplus.py:97-119`)
- tuples come back as **lists** ⚠️

**Rule for `TurnState`: keep it msgpack-plain.** Store `SourceConfig`/`ClarifySpec`/`RenderSpec`/envelopes as `model_dump()` dicts and messages via `ModelMessagesTypeAdapter.dump_python(..., mode='json')`; re-validate on read. No tuples in state.

---

## 9. tavily-python 0.7.25

```python
from tavily import AsyncTavilyClient            # tavily/async_tavily.py:42
from tavily.errors import (UsageLimitExceededError, InvalidAPIKeyError,
                           BadRequestError, ForbiddenError, TimeoutError)  # tavily/errors.py

client = AsyncTavilyClient(api_key=settings.tavily_api_key)   # falls back to TAVILY_API_KEY env

resp: dict = await client.search(
    query,
    search_depth="basic",            # Literal["basic","advanced","fast","ultra-fast"], default None (server default)
    max_results=settings.search_max_results,
    include_domains=[...],           # Sequence[str]; also exclude_domains
    include_answer=False,            # bool | Literal["basic","advanced"]
    timeout=60,                      # seconds, capped at 120 internally
)
```

Signature verified at `async_tavily.py:257-280` (also: `topic`, `time_range`, `include_raw_content`, `country`, …). Returns the **raw API dict**: `{"query", "results": [{"title", "url", "content", "score", ...}], "response_time", ...}` — `content` is the snippet field (`async_tavily.py:305-307` passes results through untouched).

Error mapping (`async_tavily.py:148-168`): 429→`UsageLimitExceededError`, 403→`ForbiddenError`, 401→`InvalidAPIKeyError`, 400→`BadRequestError`, timeout→`tavily.errors.TimeoutError` (shadows builtin — import the module or alias it). Catch all of these (plus `httpx.HTTPError`) in the tool wrappers → `{error: ..., retryable: true}`.

Constructed live (dummy key) ✅; no live search performed.

---

## 10. Test doubles

```python
# LangGraph memory checkpointer (checkpointer="memory" mode)
from langgraph.checkpoint.memory import MemorySaver      # alias: MemorySaver = InMemorySaver (memory/__init__.py:631)

# PydanticAI fake models (models/test.py:62, models/function.py:46)
from pydantic_ai.models.test import TestModel
from pydantic_ai.models.function import FunctionModel, AgentInfo
from pydantic_ai.messages import ModelResponse, ToolCallPart, TextPart

agent = Agent(TestModel(), deps_type=Deps)
# TestModel calls ALL mounted tools once by default (call_tools='all'), then answers;
# also: custom_output_text=..., call_tools=['only_these']

def endless_tool_caller(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name="lookup", args={"q": "x"})])
loop_agent = Agent(FunctionModel(endless_tool_caller), deps_type=Deps)
# FunctionDef: Callable[[list[ModelMessage], AgentInfo], ModelResponse | Awaitable[ModelResponse]]
# (function.py:290; streaming variant takes an AsyncIterator)
```

All executed ✅ (the `FunctionModel` snippet is the exact rig for the max-tool-rounds unit test, §6).

---

## Surprises that affect the Phase 4 design (summary for the orchestrator)

1. **Model string `"google-vertex:..."` is unusable with our key** — deprecated AND env-var-only auth. Use explicit `GoogleModel("gemini-2.5-pro", provider=GoogleCloudProvider(api_key=...))`. Express Mode is first-class (§1). Settings should hold provider+model parts, not one PydanticAI model string, OR map the string to the explicit constructor in one factory function.
2. **`MCPServerStdio` is deprecated in 1.107** → use `MCPToolset(StdioTransport(command=..., args=..., env=...))`. Child env is NOT inherited — pass `COUNSELLE_*` vars explicitly (§2).
3. **Interrupt resume re-executes the whole agent node**, replaying the PydanticAI run (model re-billed; pre-clarify tool calls re-run; replay is non-deterministic). The plan's phrase "the graph parks inside the agent node" is true at the graph level but NOT at the Python-frame level. Accepted for MVP1; per-turn accumulators must live in node-returned state, not external mutables (§7).
4. **Checkpointer serde will block unregistered pydantic/dataclass types in a future version** (and mangles tuples→lists today) — keep `TurnState` msgpack-plain via `model_dump()` / `ModelMessagesTypeAdapter.dump_python(mode='json')` (§8).
5. `result.usage` is a **property** now; `usage()` warns (§4).
6. `run_stream_events()` is the single streaming API for deltas + tool events + result; must be consumed via `async with` (§4).
7. Per-run `toolsets=` is **additive** to construction-time toolsets — mount the always-on MCP toolset at `Agent(...)`, gate Tavily per run (§3).
8. Gemini 2.5 Pro thinking tokens inflate output usage (~366 tokens for "Hello"); `google_thinking_config` is the cost lever for the Flash tier (§1).
