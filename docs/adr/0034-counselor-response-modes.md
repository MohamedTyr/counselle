# ADR 0034 — Counselor response modes

**Status:** Accepted

## Context

The counselor now needs two student-visible execution modes:

- **Quick** for the default, fast, lower-cost counselor path.
- **Think** for deeper reasoning with a stronger preview model when the target
  environment has verified quota and cost tolerance.

The old architecture assumed one configured counselor synthesis model plus a
global `thinking_stream` flag. That is too loose for a student-facing selector:
the browser must not choose arbitrary model ids or provider thinking settings,
and failures must never silently fall back from Think to Quick.

## Decision

- Add a server-owned `ResponseMode` contract with exactly `quick` and `think`.
  Browser requests may send only that product id, never a model id, provider
  prefix, thinking level, or `include_thoughts` flag.
- Resolve response modes in `app/model_selection.py`:
  - `quick` -> `settings.model_counselor`, Gemini `MINIMAL`, no requested
    provider thoughts.
  - `think` -> `settings.model_counselor_think`, Gemini `HIGH`, requested
    provider thoughts only when `settings.effective_thinking_stream` is true.
- Keep `COUNSELLE_MODEL_COUNSELOR` as Quick's setting for env compatibility.
  Add `COUNSELLE_MODEL_COUNSELOR_THINK` and the presentation fields served by
  `GET /v1/config`.
- Keep `thinking_stream` as a provider-thought display/request gate. It is not
  the response-mode selector. Disabling `thinking_stream` makes Think run the
  Think model at `HIGH` without requesting provider thought summaries.
- Persist session stickiness in `sessions.response_mode`; persist immutable
  execution truth per turn in `meta`, turn records, transcripts, usage, and
  logs.
- Use `response_mode_think_enabled` as the honest-disable switch. Disabled
  Think is omitted from `GET /v1/config` and explicit Think requests fail before
  session claim/model call; they are never remapped to Quick.
- Restrict the shipped model factory to `google-vertex:` counselor settings.
  Provider-generic construction remains a separate ADR-level change.

## Current model facts

Verified against Google documentation on 2026-07-22:

- `gemini-3.5-flash` is a GA Flash model with model code
  `gemini-3.5-flash`, text/image/video/audio/PDF inputs, text output,
  1,048,576 input tokens, 65,536 output tokens, and function calling.
- `gemini-3.1-pro-preview` is a preview Pro model with model code
  `gemini-3.1-pro-preview`, the same 1,048,576 / 65,536 token limits,
  function calling, structured outputs, thinking, and no announced shutdown
  date.
- Gemini 3 thought signatures are part of the model-history contract for
  maintaining reasoning context across API calls; stateless clients must carry
  signed thought blocks forward.
- Agent Platform Standard global pricing is represented in Settings as:
  `gemini-3.5-flash` $1.50/M input and $9.00/M output; and
  `gemini-3.1-pro-preview` $2.00/M input / $12.00/M output up to 200K input
  tokens, then $4.00/M input / $18.00/M output above 200K.
- Agent Platform Express Mode is documented as Preview, with rate limits that
  must be verified in the target environment before enabling Think broadly.

Source links:

- <https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash>
- <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview>
- <https://ai.google.dev/gemini-api/docs/gemini-3>
- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview>
- <https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing>
- <https://ai.google.dev/gemini-api/docs/deprecations>

## Rationale

The user chooses intent, not infrastructure. Mapping that intent server-side
keeps billing, provider features, and failure behavior honest while preserving
PydanticAI's native per-agent `model=` seam from ADR 0011.

Persisting both sticky preference and immutable execution facts avoids the
common chat bug where a later dropdown change rewrites history. It also makes
cost/eval comparison possible without joining ambiguous client state.

## Alternatives

- **Expose model ids in the browser.** Rejected: it lets clients select
  unpriced or unsupported models and bypasses the product capability list.
- **Use `thinking_stream` as the selector.** Rejected: it is a provider-thought
  visibility gate, not a model-routing decision.
- **Silently fall back from Think to Quick.** Rejected: it would lie about
  which model answered, corrupt eval/cost data, and hide quota failures.
- **Rename `model_counselor` to `model_counselor_quick`.** Rejected:
  env-compatibility is worth keeping; the model-selection module gives the
  old name the new precise meaning.

## Consequences

- ADR 0011 still governs per-agent model configuration, but its
  single-default-counselor wording is superseded for the counselor by this ADR.
- ADR 0028 still governs the run-as-message record and `thinking_stream`, but
  `thinking_stream` is clarified as a native provider-thought gate for Think,
  not the response-mode selector.
- The frontend must render only the advertised `response_modes` list from
  `/v1/config`; when Think is omitted, stale local Think selections normalize
  to Quick before sending.
- Rollout is gated by live Quick/Think smokes, two-mode eval comparison, cost
  review, and owner approval. Quick remains default regardless of Think status.
