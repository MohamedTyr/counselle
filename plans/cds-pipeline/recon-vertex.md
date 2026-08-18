# Recon: Vertex AI / Gemini for the new CDS-PDF extraction engine

Scope: how Counselle calls Vertex today, how the old data-pipeline did native-PDF
Gemini extraction, current Vertex AI docs for PDF + structured JSON + pricing, and
a verdict for the new engine's model-call layer.

---

## 1. How Counselle calls Vertex today

**SDK/provider:** PydanticAI's `GoogleModel` (`pydantic_ai.models.google`) with the
`GoogleCloudProvider` (`pydantic_ai.providers.google_cloud`) — **not** the raw
`google-genai` SDK, and **not** ambient ADC/ADK. This is the agent-turn seam (ADR
0011: "Use PydanticAI's per-agent `model=`").

**Auth — Vertex Express Mode API key, not service-account/ADC.** This is called out
in the code as "the ONLY working auth path":

```python
# app/agent_node.py
def default_model_factory(settings: Any, model_setting: str) -> Model:
    """The real Gemini on Vertex Express Mode (notes §1 — the ONLY working auth path)."""
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    if not settings.vertex_api_key:
        raise RuntimeError(
            "COUNSELLE_VERTEX_API_KEY is not set — the counselor model cannot "
            "authenticate (Vertex Express Mode key required)."
        )
    return GoogleModel(
        model_name_from_setting(model_setting),
        provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
    )
```

`model_name_from_setting` strips the `"google-vertex:"` prefix — the provider prefix
itself is **not** usable with the Express-mode key, only the bare model name feeds
the explicit `GoogleModel` constructor (comment in `app/agent_node.py:247-251`).

The identical explicit-construction pattern is repeated for the cheap/title models
(`app/workspace/document_summary.py:126-139`, `app/titles.py:96-104`) — every
non-counselor cheap-model call rebuilds `GoogleModel(... , GoogleCloudProvider(api_key=settings.vertex_api_key))` the same way rather than resolving the bare
`"google-vertex:"` prefix through PydanticAI's `infer_model` (which would fall back
to ambient credentials this app can't authenticate with).

**Env vars (`config/settings.py`, `.env.example`):**
- `COUNSELLE_VERTEX_API_KEY` — the Express Mode key (preferred; wins if both set)
- `GOOGLE_APPLICATION_CREDENTIALS` — standard, **unprefixed**, path to a
  service-account JSON; documented as a fallback auth path but not exercised in code
- `COUNSELLE_GOOGLE_CLOUD_PROJECT` — optional, empty = ambient ADC project
- `COUNSELLE_GOOGLE_CLOUD_LOCATION` — default `us-central1`

Note: `google_cloud_project`/`google_cloud_location` are declared in `Settings` but
**not actually passed** to `GoogleCloudProvider(api_key=...)` anywhere in the
codebase today — Express Mode auth via API key alone doesn't need them wired
through this seam.

**Exact model-id strings in use** (`config/settings.py:162-178`):

| Setting | Value | Purpose |
|---|---|---|
| `model_counselor` | `google-vertex:gemini-3.5-flash` | Quick response mode |
| `model_counselor_think` | `google-vertex:gemini-3.1-pro-preview` | Think response mode |
| `model_cheap` | `google-vertex:gemini-2.5-flash` | generic cheap-tier seam |
| `model_clarifier` | `google-vertex:gemini-2.5-flash` | clarify draft |
| `model_title` | `google-vertex:gemini-2.5-flash` | chat auto-title (one no-tools call) |

Priced in `model_prices` (`config/settings.py:403-416`, USD/1M tokens, "Standard
PayGo, global endpoint, verified 2026-07-22"):
- `gemini-2.5-flash`: $0.30 in / $2.50 out
- `gemini-3.5-flash`: $1.50 in / $9.00 out
- `gemini-3.1-pro-preview`: $2.00 in / $12.00 out (long-context tier $4/$18 over 200k tokens)

**Model construction call sites** (all three follow the identical explicit pattern
above — grep for `GoogleCloudProvider` to find future copies):
- `app/agent_node.py:254-273` (`default_model_factory`, the counselor)
- `app/workspace/document_summary.py:113-139` (`_summary_model`, doc summaries)
- `app/titles.py:90-104` (`_title_model`, chat titles)

**Determinism knob in use:** `GoogleModelSettings(google_thinking_config={...})` for
thinking level/thought streaming (`app/agent_node.py:789-800`); no explicit
`temperature` is set anywhere in the app today (defaults to the provider's
default, ~1.0) — the agent's use case is conversational, not extraction, so this
isn't a precedent to copy for the CDS engine.

---

## 2. Structured output — the pattern to copy

PydanticAI's `Agent(output_type=...)` is the seam, backed by three strategies:
`ToolOutput` (function-calling based), `NativeOutput` (real `response_schema`/
`response_mime_type=application/json` on the wire), `PromptedOutput` (schema stuffed
into the prompt, weakest). Confirmed in
`.venv/lib/python3.12/site-packages/pydantic_ai/output.py` and
`pydantic_ai/models/google.py:1274-1281` (`_map_response_schema` builds the JSON
schema dict sent as `response_json_schema` — see `google.py:889-950`).

**Counselle's current usage is `ToolOutput`, not `NativeOutput`:**

```python
# app/clarification.py
def ask_student_output_type() -> list[Any]:
    return [str, ToolOutput(ClarifyDraftV2, name="ask_student")]
```

```python
# app/agent_node.py
output_type: list[Any] = [str] if is_continuation else ask_student_output_type()
agent: Agent[TurnDeps, str | ClarifyDraftV2] = Agent(
    ...,
    output_type=output_type,
    end_strategy="early",
)
```

This is appropriate for the counselor because the model is also calling function
tools in the same turn — `ToolOutput` lets a structured result coexist with
ordinary tool calls. **The document-summary and title agents use plain `Agent(model, system_prompt=...)` with no `output_type` at all** — they return free text and
parse/validate it by hand (`normalize_document_summary` in
`document_summary.py:142-167`), not schema-enforced JSON.

**Retry/validation behavior:** `Agent(..., retries=2)` on the counselor
(`app/agent_node.py:831`) — "a tool that fails once for a transient/schema reason
gets one more chance before the turn dies" (comment references
`plans/fix-search-fields-resilience.md` Bug C). No retry override on the
summary/title agents (PydanticAI default of 1).

**For the CDS engine, copy `NativeOutput`, not `ToolOutput`.** The extraction task
has no function tools in the loop and wants the wire-level `response_schema`
guarantee the old pipeline already validated (see §3) — `NativeOutput(WindowExtraction)` is the PydanticAI-idiomatic equivalent of the old
pipeline's `types.GenerateContentConfig(response_schema=WindowExtraction)`.

---

## 3. What the OLD pipeline did (`counselle-data-pipeline/src`)

**SDK: raw `google-genai`, not PydanticAI.** `library/vertex.py` and
`library/extractor.py` both do `from google import genai; from google.genai import types` and construct `genai.Client(vertexai=True, api_key=settings.vertex_api_key.get_secret_value())` directly — no Agent framework at all. This is a deliberate,
documented choice, not an oversight (see §5 Verdict).

**Model, locked, never `"latest"`:** `gemini-3.1-flash-lite`
(`config.py:19`: `cds_extract_model: str = "gemini-3.1-flash-lite"`). The
"eight-call" plan is explicit: *"Use `gemini-3.1-flash-lite`, never a `latest`
alias"* (`specs/eight-call-cds-extraction/plan/eight-call-cds-extraction.md:32`).

**PDF transport: native inline bytes, `application/pdf`, not GCS URI, not File
API:**

```python
# library/extractor.py — GeminiExtractor.extract_document
response = self._client.models.generate_content(
    model=model_id,
    contents=[
        types.Part.from_bytes(data=document.pdf_bytes, mime_type="application/pdf"),
        prompt,
    ],
    config=types.GenerateContentConfig(
        temperature=0,
        max_output_tokens=MAX_OUTPUT_TOKENS,  # 65_535
        response_mime_type="application/json",
        response_schema=WindowExtraction,
        http_options=types.HttpOptions(
            api_version="v1",
            timeout=self._settings.model_timeout_seconds * 1000,
            retry_options=types.HttpRetryOptions(attempts=SDK_RETRY_ATTEMPTS),  # 3
        ),
    ),
)
```

The plan's rationale: no GCS/Files-API bucket to manage, no 48h TTL to track, the
PDF is small enough to inline every time. `response_schema=WindowExtraction`
(a Pydantic `BaseModel`) is passed straight to `GenerateContentConfig` — the SDK
converts it to a JSON schema itself; the app never hand-builds one.

**Page images:** used only for the disposable *smoke test* (`vertex.py`), which
rasterizes the first 1-2 pages via PyMuPDF (`fitz`) into PNG `Part.from_bytes(...,
mime_type="image/png")` — **not** the production extraction path. Production
extraction sends the native PDF only; it never rasterizes pages into images. (Your
GOAL CONTEXT mentions sending page images for checkbox grids — the old pipeline
never needed this because native PDF vision already reads checkbox/table content;
worth validating on your own checkbox-grid pages before adding an image path.)

**Page routing — evolved across two ADRs, ending at 8 calls total for the current
manifest:**

1. **ADR 0007** (superseded in part): one whole-document call per manifest-
   configured *domain group* (7 groups today), each getting the **entire** original
   PDF — no page routing. Rejected a routing pre-call at the time: *"after implicit
   caching it saves under $0.01 per document while adding a serial dependency and a
   silent-domain-loss failure mode."* This ADR **superseded** an earlier
   `specs/eight-call-cds-extraction/` design (20-page chunks × 4 weight-balanced
   metric partitions = `ceil(pages/20)*4` calls) — that plan is what named
   `gemini-3.1-flash-lite` originally; the model choice survived, the chunking
   scheme didn't.
2. **ADR 0008** (current): reversed the "no routing" call — full-scale testing
   showed page-narrowed calls improve accuracy once a safe whole-document fallback
   exists for any routing shortfall. Adds **one extra whole-document routing call**
   before the 7 group calls: it receives the full PDF plus each domain's ID + CDS
   item-label `source_hints` (never full metric definitions), returns detected
   first/last physical page per domain (`ROUTING_MAX_OUTPUT_TOKENS = 4096`,
   `DocumentRouting` response schema). Detected ranges are padded ±2 pages
   (`ROUTING_PAGE_PAD = 2`) and merged into disjoint clusters
   (`_merge_page_ranges`); each group call then gets its narrowed page subset
   (`narrow_document`) **or**, on any routing shortfall, the whole PDF unchanged —
   *"a bad or missing routing result only costs the narrowing benefit, never
   correctness."*
   **Net: 1 routing call + 7 domain-group calls = 8 scheduled Gemini calls per
   full extraction**, regardless of page count.

**Prompt strategy:** long, explicit instruction block per domain-group call
(`extractor.py:495-516`) — the model is told to (a) check every allowed metric
before finishing, (b) return *only* metrics with a visible institution-provided
answer, (c) never emit `not_reported` (a blank cell is an omission, not a claim —
enforced downstream too), (d) use `not_in_template_version` only when table/header
structure *proves* the row/column doesn't exist in that school's CDS edition, (e)
treat `source_hints` (CDS section letters, e.g. "CDS section C") as mandatory
section boundaries, (f) ignore glossary/definitions pages. Every finding requires a
non-blank `excerpt` (Pydantic `min_length=1` + a validator) — this is the model's
citation, verified locally afterward, never trusted blind.

**Determinism:** `temperature=0` on every extraction/routing call. No `seed` param
used.

**Verification is entirely local, not model-trusted:** typed-value coercion
(`_typed_value`), physical-page-in-document fencing, cross-call conflict detection
by semantic value equality (`_semantic_value_key`/`_metric_outcome`) when the same
metric is somehow claimed twice, and `_merge_page_ranges` bounds. The model's JSON
is a *claim*; the packet-builder is the honesty gate — same posture as Counselle's
domain-core citation discipline (ADR 0017).

**Cost/latency notes found in the old pipeline's own docs:** ADR 0007's own
estimate for adding the routing call was "**under $0.01 per document**" even before
the model was downgraded to `gemini-3.1-flash-lite` — i.e. the pipeline's own prior
belief is that whole-run cost is already a few cents at most. No pricing table is
persisted in-repo (`eight-call-cds-extraction.md:152`: *"Do not add a new billing
subsystem or pricing table in this change"*) — usage is logged
(`prompt_token_count`, `cached_content_token_count`, `candidates_token_count`,
`thoughts_token_count` per call) but not priced in code.

---

## 4. Current Vertex AI / Gemini docs (web research — no Context7 MCP available in
this environment; used direct web search + fetch instead)

**a. Sending a PDF.** Two paths, same as the old pipeline already chose correctly:
- **Inline bytes** (`Part.from_bytes(data=..., mime_type="application/pdf")` /
  base64 in the REST body): current inline-payload ceiling is **~50 MB per PDF /
  up to ~1000 pages** (Gemini treats each PDF page as one image internally). This
  is what the old pipeline uses and what the new engine should keep using — CDS
  PDFs are single-digit MB, well under the ceiling, and inlining avoids any
  GCS/Files-API lifecycle management.
- **Files API / GCS URI**: only worth it above the inline ceiling or for
  cross-request reuse (Files API storage: 2 GB/file, 20 GB/project, 48h default
  TTL). Not needed for CDS PDFs.

**b. Page images alongside text in one request.** Supported — `contents` accepts a
mixed list of `Part`s (text, PDF bytes, PNG/JPEG bytes) in any combination in a
single `generate_content` call; this is exactly the pattern the old pipeline's
smoke test already exercises (`vertex.py:26-35`, list of `types.Part.from_bytes`
PNGs + a text instruction). For checkbox grids specifically: try native PDF vision
first (it already reads checkboxes/tables in the old pipeline's production path)
before adding a second rasterized-image call — only add images if a documented
accuracy gap shows up on real checkbox-grid pages.

**c. Strict JSON output against a schema.** `GenerateContentConfig(response_mime_type="application/json", response_schema=<PydanticModel>)` (or
`response_json_schema` for a raw JSON-schema dict) is still the mechanism — pass a
Pydantic `BaseModel` class directly and the SDK derives the schema, exactly as the
old pipeline's `WindowExtraction`/`DocumentRouting` models already do.
Interaction with PydanticAI: `NativeOutput(SomeModel)` on `Agent(output_type=...)` is the PydanticAI-level equivalent — it builds the same
`response_json_schema` under the hood (`pydantic_ai/models/google.py:889-950`,
`_map_response_schema`). Do **not** use `ToolOutput` for this — that goes through
function-calling, not the wire-level schema constraint, and is the wrong tool for a
no-function-tools, pure-extraction call.

**d. Determinism knobs.** `temperature=0` (used by the old pipeline, confirmed
current). A `seed` parameter exists in `GenerateContentConfig` but Gemini does
**not** guarantee bit-identical determinism even with `temperature=0` + a fixed
seed — treat both as "reduce variance," not "guarantee reproducibility," and keep
leaning on the old pipeline's local verification layer as the real correctness
gate rather than model-output stability.

**e. Current pricing for the cheap Flash tier** (Vertex AI PayGo, USD per 1M
tokens, as surfaced by web search in August 2026 — cross-check against
`cloud.google.com/vertex-ai/generative-ai/pricing` before shipping, since these
figures come from third-party aggregators, not a direct fetch of Google's own
pricing page, which this environment couldn't reach):

| Model | Input /1M | Output /1M | Note |
|---|---|---|---|
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | **Retiring 2026-10-16** |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | Cheapest after retirement; **what the old pipeline already uses** |
| `gemini-2.5-flash` | $0.30 | $2.50 | Matches Counselle's own `model_prices` entry exactly |
| `gemini-3.5-flash` | $1.50 | $9.00 | Matches Counselle's own `model_prices` entry exactly (this is the counselor's Quick model, not a cheap tier) |

**PDF tokenization:** Gemini tokenizes each PDF page as one image tile — **258
tokens/page** is the figure corroborated across Google's own token-counting docs
and third-party trackers (images ≤384×384 count as 258 tokens flat; larger pages
get tiled at 768×768 but CDS PDFs are text-dominant single-page-per-tile, so 258
tokens/page is the right estimate to budget against). This is the single most
load-bearing number in the cost arithmetic below.

**f. Batch mode / context caching.**
- **Batch API: flat 50% discount, up to 24h turnaround, no SLA.** This is the
  single best lever for this workload — CDS extraction is an offline bulk job
  (hundreds of schools, no live user waiting), the textbook Batch API use case.
  Note: **the old pipeline's extractor does not use Batch mode today** (it calls
  `client.models.generate_content` synchronously per call) — this would be a new
  addition, not a copy of prior art. Batch mode requires the raw `google-genai`
  `client.batches.create(...)` surface (or the equivalent Vertex `BatchPredictionJob`), not PydanticAI's synchronous `Agent.run()` — another reason
  this engine should not go through PydanticAI's `Agent` (see §5).
- **Context/implicit caching: cached input priced at ~10% of standard input
  (90% discount on cache hits).** Only pays off when the *same* bytes recur across
  calls with the identical prefix. Within one school's extraction, the routing
  call and the 7 group calls each carry a **different** (routing = full doc,
  groups = narrowed/possibly-different page subsets) PDF payload, so cross-call
  caching inside one document's run is not guaranteed to hit — the old pipeline's
  own ADR 0007 already banked this ("place the whole PDF part before the prompt so
  all calls in a run share a cacheable prefix") for the pre-routing whole-document
  design; it still helps whenever the routing fallback sends the full PDF to
  multiple groups. Across *different* schools' PDFs there is no shared prefix at
  all — caching does not help across schools, only (partially) within one school's
  8 calls.

---

## 5. Verdict — the new engine's model-call layer

**Do not put this behind PydanticAI's `Agent`.** ADR 0011's PydanticAI seam is
scoped to *agentic* per-agent model swapping (the counselor, cheap-tier chat
helpers) — a multi-turn tool loop with a chat-shaped `model=` knob. CDS extraction
is a **one-shot, deterministic, schema-constrained provider call with no function
tools**, run from a worker/batch job, not a chat turn. The old pipeline already
made this call correctly and explicitly: it calls `google.genai.Client` directly,
bypassing any agent framework. Wrapping this in `Agent(output_type=NativeOutput(...))` would work mechanically, but it buys nothing (no tool loop to
share) while blocking the one feature that actually matters for cost — **Batch
mode**, which only exists on the raw SDK's `client.batches` surface, not through
`Agent.run()`. Per ADR 0017's "no pass-through wrappers... a module whose
interface is as complex as what it hides gets deleted" — an `Agent` wrapper here
would be exactly that pass-through.

**What to actually copy:**
1. **SDK:** `google-genai`'s `genai.Client(vertexai=True, api_key=settings.vertex_api_key)` — same auth path Counselle already uses everywhere
   (`COUNSELLE_VERTEX_API_KEY`, Express Mode), same credential the pipeline shared
   deliberately (ADR 0011: *"We share only Vertex/GCP credentials with the data
   pipeline"*). No new env var, no new secret.
2. **Layering (ADR 0017):** this is I/O against an external provider → belongs in
   `adapters/` (alongside `adapters/tavily_tools.py`, `adapters/email.py`), called
   from whatever `app/`-layer worker/script drives the extraction run — never
   imported by `domain/`. The result of extraction (typed packets) is the honesty-
   critical artifact; keep the verification/merge logic (typed-value coercion,
   page fencing, conflict detection — copy the old pipeline's `_typed_value`/`_metric_outcome`/`_merge_page_ranges` shape) local to this adapter or a sibling
   pure module, exactly as the old pipeline separates `GeminiExtractor` (the
   provider call) from `build_packets_from_results` (the local verification gate).
3. **Model id: `gemini-3.1-flash-lite`, pinned, never `"latest"`.** Already
   battle-tested by the old pipeline at this exact task; cheapest currently-priced
   tier ($0.25/$1.50 per 1M) once `gemini-2.5-flash-lite` retires 2026-10-16 — do
   not build against a model that's already scheduled to disappear.
4. **PDF transport:** inline `Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")`, whole document or a page-routed narrowed subset — not
   GCS, not Files API. Add a rasterized-page-image call only if/when a real
   checkbox-grid accuracy gap is measured; don't build it speculatively (YAGNI).
5. **Structured output:** `GenerateContentConfig(temperature=0, response_mime_type="application/json", response_schema=<YourPydanticModel>)` — pass
   the Pydantic model class directly, exactly like `WindowExtraction`/`DocumentRouting`. `max_output_tokens` sized to the largest domain group's
   plausible output (old pipeline: 65,535 for extraction calls, 4,096 for the
   routing call).
6. **Page routing:** reuse the two-phase shape (ADR 0007 + ADR 0008) rather than
   reinventing it — one cheap whole-document routing call (small output, `source_hints` only) → padded/merged page clusters → per-domain-group narrowed
   calls with a whole-document fallback on any shortfall. This is proven prior art
   with a documented accuracy win and a safe failure mode.
7. **Retries:** SDK transport retries only (`HttpRetryOptions(attempts=3)`), no
   hand-rolled retry loop on top — matches both the old pipeline's explicit
   decision and Counselle's own "trust the SDK's retry" comment pattern.
8. **Batch mode:** worth adding for the *first* production run of a bulk job
   (hundreds of schools with no live-user wait) via `client.batches.create(...)`
   — flat 50% cost cut, and the natural fit for "extract CDS PDFs for hundreds of
   schools." This is new relative to the old pipeline (which ran synchronous
   serial calls) but is a low-risk win precisely because this workload has no
   latency requirement.

### Per-school cost estimate (arithmetic shown)

Assumptions, stated explicitly (flag for validation against real CDS PDFs):
- 30-page PDF, `gemini-3.1-flash-lite` ($0.25/1M in, $1.50/1M out)
- 258 tokens/page (§4e)
- 8 scheduled calls/school (1 routing + 7 domain-group, per ADR 0008's locked shape)
- Conservative/worst case: routing narrowing fails or isn't yet built, so **all 8
  calls carry the full 30-page PDF** (this over-states cost — it's a ceiling, not
  the expected case)
- Per-call non-PDF overhead: routing call ≈ 800 tokens (domain IDs + source_hints
  only, no full metric definitions); each group call ≈ 1,500 tokens (its slice of
  metric definitions + instructions, per `provider_contract`)
- Output: routing ≈ 300 tokens (small `DomainPageRange` list, capped at 4,096);
  each group call ≈ 1,200 tokens average (a `WindowExtraction` findings list)

```
PDF tokens per call = 30 pages × 258 tokens/page = 7,740

Routing call:
  input  = 7,740 (PDF) + 800 (contract)   =  8,540 tokens
  output = 300 tokens

7 group calls (each):
  input  = 7,740 (PDF) + 1,500 (contract) =  9,240 tokens
  output = 1,200 tokens

Totals:
  input  = 8,540 + 7 × 9,240  = 8,540 + 64,680  = 73,220 tokens
  output = 300   + 7 × 1,200  = 300   + 8,400    =  8,700 tokens

Cost = 73,220/1,000,000 × $0.25  +  8,700/1,000,000 × $1.50
     = $0.018305            +  $0.01305
     = $0.0314 per school  (~3.1 cents, worst case, no narrowing/caching)
```

With page-routing narrowing working as designed (each group call sends only its
padded/merged page cluster, typically well under the full 30 pages) this drops
further — matching ADR 0007's own finding that the routing/narrowing delta is
"under $0.01 per document" either way. **Call it $0.02–$0.03/school** as the
realistic band, **$0.03/school as a safe ceiling**.

At $0.03/school ceiling:
- 100 schools ≈ **$3**
- 300 schools ≈ **$9**
- 500 schools ≈ **$15**
- 1,000 schools ≈ **$30**

With Batch mode's flat 50% discount (§4f) on top, the ceiling halves to
**~$0.015/school** (~$15 for 1,000 schools). This is negligible either way — the
model/architecture choice should be driven by accuracy and reliability, not cost.

---

## Sources (web)

- [Gemini pricing in 2026 — CloudZero](https://www.cloudzero.com/blog/gemini-pricing/)
- [Google Vertex AI Pricing: Complete Enterprise Guide (2026) — CloudZero](https://www.cloudzero.com/blog/google-vertex-ai-pricing/)
- [Gemini 3.1 Flash Lite — API Pricing & Providers — OpenRouter](https://openrouter.ai/google/gemini-3.1-flash-lite)
- [Document understanding — Gemini API — Google AI for Developers](https://ai.google.dev/gemini-api/docs/document-processing)
- [Structured Outputs and Response Schemas — googleapis/python-genai — DeepWiki](https://deepwiki.com/googleapis/python-genai/3.5-structured-outputs-and-response-schemas)
- [How to Use Gemini File API for Large File Processing on Vertex AI](https://oneuptime.com/blog/post/2026-02-17-how-to-use-gemini-file-api-for-large-file-processing-on-vertex-ai/view)
- [File input methods — Gemini Generate Content API — Google AI for Developers](https://ai.google.dev/gemini-api/docs/generate-content/file-input-methods)
- [Gemini API Batch vs Context Caching: Complete Cost Optimization Guide (2026) — YingTu](https://yingtu.ai/en/blog/gemini-api-batch-vs-caching)
- [Gemini Pricing in 2026 for Individuals, Orgs & Developers — Finout](https://www.finout.io/blog/gemini-pricing-in-2026)
- [Token counts for image processing inside PDF documents — Gemini API Developer Forum](https://discuss.ai.google.dev/t/token-counts-for-image-processing-inside-pdf-documents/112376)

**Caveat:** Context7 MCP was not available in this environment (no matching
deferred tool), so all "current docs" claims above came from web search +
`WebFetch`, not a direct Google-hosted API reference fetch (several direct fetches
to `ai.google.dev`/`cloud.google.com` were blocked or redirected in this
sandbox). Re-verify the pricing table and the 258-tokens/page figure against
`cloud.google.com/vertex-ai/generative-ai/pricing` and the official document-
understanding page before finalizing a cost commitment.
