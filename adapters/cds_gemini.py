"""Raw google-genai client for the CDS admin pipeline's model call (PLAN §B1
`adapters/cds_gemini.py`, recon-vertex.md §5).

Deliberately **not** behind PydanticAI's ``Agent`` seam. ADR 0011's
per-agent ``model=`` seam is scoped to agentic, multi-turn, tool-looping chat
work; CDS extraction is a one-shot, deterministic, schema-constrained
provider call with no function tools, run from a worker job — exactly the
shape the old data-pipeline's ``GeminiExtractor`` already proved out with
the raw SDK. Wrapping it in ``Agent`` would be the pass-through wrapper ADR
0017 says to delete.

Auth is the shared Vertex Express Mode API key
(``COUNSELLE_VERTEX_API_KEY`` / ``settings.vertex_api_key``) — the same
credential three other call sites in this app already use, no new secret.
Model id always comes from ``Settings`` (ADR 0011), never a literal.

Every call runs the blocking SDK call in a thread (PLAN Risk 7) so it never
blocks the event loop that chat traffic shares.

Thought tokens (when ``thinking_budget`` is enabled) bill at the *output*
rate, not for free -- callers pricing a call must include
``Usage.thoughts_tokens`` alongside ``output_tokens``.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel

# The old pipeline's own extraction-call ceiling (recon-vertex.md §3),
# sized to the largest domain-group's plausible findings list.
DEFAULT_MAX_OUTPUT_TOKENS = 65_535
_SDK_RETRY_ATTEMPTS = 3
_HTTP_API_VERSION = "v1"
_DEFAULT_TIMEOUT_SECONDS = 180.0


class CdsGeminiError(Exception):
    """Base for typed CDS-extraction model-call failures — never swallowed."""


class CdsGeminiAuthError(CdsGeminiError):
    """``COUNSELLE_VERTEX_API_KEY`` is unset — the only working auth path
    (recon-vertex.md §1)."""


class CdsGeminiTruncatedError(CdsGeminiError):
    """The model stopped before finishing cleanly — never accept a
    truncated JSON candidate as a claim."""


class CdsGeminiEmptyResponseError(CdsGeminiError):
    """No candidates, or no schema-parsed structured output, came back."""


@dataclass(frozen=True)
class Usage:
    """Token accounting for one call — callers record cost from this."""

    prompt_tokens: int
    output_tokens: int
    thoughts_tokens: int
    cached_tokens: int
    total_tokens: int


@dataclass(frozen=True)
class GenerateResult:
    """One model call's typed output plus everything needed to record cost/latency."""

    parsed: BaseModel
    usage: Usage
    latency_seconds: float
    model_id: str
    finish_reason: str


def _strip_provider_prefix(model_setting: str) -> str:
    """``"google-vertex:gemini-3.1-flash-lite"`` -> ``"gemini-3.1-flash-lite"``.

    Duplicated from ``app.agent_node.model_name_from_setting`` rather than
    imported: ``adapters/`` may depend on ``domain/`` and vendor SDKs only
    (ADR 0017); importing from ``app/`` here would invert the layering.
    """
    return model_setting.split(":", 1)[-1]


def _build_client(settings: Any) -> genai.Client:
    if not settings.vertex_api_key:
        raise CdsGeminiAuthError(
            "COUNSELLE_VERTEX_API_KEY is not set — the CDS extraction model cannot authenticate."
        )
    return genai.Client(vertexai=True, api_key=settings.vertex_api_key)


def _build_parts(prompt: str, *, pdf_bytes: bytes | None, image_pngs: Sequence[bytes]) -> list[Any]:
    if pdf_bytes is None and not image_pngs:
        raise CdsGeminiError("generate_structured needs pdf_bytes and/or image_pngs")
    parts: list[Any] = []
    if pdf_bytes is not None:
        parts.append(types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"))
    for png in image_pngs:
        parts.append(types.Part.from_bytes(data=png, mime_type="image/png"))
    parts.append(prompt)
    return parts


def _resolve_thinking_level(thinking_level: str) -> types.ThinkingLevel:
    """Case-insensitive string -> SDK enum, e.g. ``"low"`` -> ``ThinkingLevel.LOW``.

    ``types.ThinkingLevel`` is itself a case-insensitive enum, but its own
    ``_missing_`` hook only *warns* on an unrecognised value and fabricates a
    throwaway member instead of raising -- exactly the silent-typo failure
    mode this adapter must not have. Look the resolved name up in
    ``__members__`` explicitly so a typo'd level surfaces as a loud,
    immediate ``CdsGeminiError`` instead of quietly requesting whatever the
    SDK's fallback happens to mean.
    """
    name = thinking_level.strip().upper()
    member = types.ThinkingLevel.__members__.get(name)
    if member is None:
        valid = ", ".join(
            sorted(m for m in types.ThinkingLevel.__members__ if m != "THINKING_LEVEL_UNSPECIFIED")
        )
        raise CdsGeminiError(
            f"unrecognised thinking_level {thinking_level!r} -- expected one of: {valid}"
        )
    return member


def _usage_from_metadata(metadata: types.GenerateContentResponseUsageMetadata | None) -> Usage:
    if metadata is None:
        return Usage(
            prompt_tokens=0, output_tokens=0, thoughts_tokens=0, cached_tokens=0, total_tokens=0
        )
    return Usage(
        prompt_tokens=metadata.prompt_token_count or 0,
        output_tokens=metadata.candidates_token_count or 0,
        thoughts_tokens=metadata.thoughts_token_count or 0,
        cached_tokens=metadata.cached_content_token_count or 0,
        total_tokens=metadata.total_token_count or 0,
    )


def _generate_sync(
    *,
    settings: Any,
    model_setting: str,
    prompt: str,
    response_schema: type[BaseModel],
    pdf_bytes: bytes | None,
    image_pngs: Sequence[bytes],
    max_output_tokens: int,
    timeout_seconds: float,
    thinking_budget: int = 0,
    thinking_level: str | None = None,
) -> GenerateResult:
    client = _build_client(settings)
    model_id = _strip_provider_prefix(model_setting)
    parts = _build_parts(prompt, pdf_bytes=pdf_bytes, image_pngs=image_pngs)
    # thinking_budget=0 (and thinking_level=None) must produce the exact
    # config this call built before thinking existed -- omit thinking_config
    # entirely rather than pass it as disabled, so the byte-identical-by-
    # default invariant actually holds. thinking_level and thinking_budget
    # are alternative controls (measured: thinking_budget is a discrete tier
    # selector, not an allowance, on gemini-3.1-flash-lite); sending both
    # would be ambiguous, so thinking_level wins and thinking_budget is
    # dropped entirely when a level is given.
    extra_config_kwargs: dict[str, Any] = {}
    if thinking_level:
        extra_config_kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_level=_resolve_thinking_level(thinking_level)
        )
    elif thinking_budget != 0:
        extra_config_kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_budget=thinking_budget
        )
    config = types.GenerateContentConfig(
        temperature=0,
        max_output_tokens=max_output_tokens,
        response_mime_type="application/json",
        response_schema=response_schema,
        http_options=types.HttpOptions(
            api_version=_HTTP_API_VERSION,
            timeout=int(timeout_seconds * 1000),
            retry_options=types.HttpRetryOptions(attempts=_SDK_RETRY_ATTEMPTS),
        ),
        **extra_config_kwargs,
    )

    started = time.monotonic()
    response = client.models.generate_content(model=model_id, contents=parts, config=config)
    latency_seconds = time.monotonic() - started

    candidates = response.candidates or []
    if not candidates:
        raise CdsGeminiEmptyResponseError(f"model {model_id} returned no candidates")
    finish_reason = candidates[0].finish_reason
    if finish_reason != types.FinishReason.STOP:
        label = getattr(finish_reason, "value", finish_reason)
        raise CdsGeminiTruncatedError(
            f"model {model_id} did not finish cleanly (finish_reason={label})"
        )
    parsed = response.parsed
    if parsed is None:
        raise CdsGeminiEmptyResponseError(f"model {model_id} returned no schema-parsed output")
    if not isinstance(parsed, BaseModel):
        # The SDK's response.parsed is typed BaseModel | dict | Enum because
        # response_schema can be any of those; this adapter's contract is
        # "callers always pass a Pydantic model", so anything else is a
        # genuine, surfaced failure rather than a silent best-effort cast.
        raise CdsGeminiEmptyResponseError(
            f"model {model_id} returned {type(parsed).__name__}, expected a Pydantic model"
        )

    return GenerateResult(
        parsed=parsed,
        usage=_usage_from_metadata(response.usage_metadata),
        latency_seconds=latency_seconds,
        model_id=model_id,
        finish_reason=finish_reason.value,
    )


async def generate_structured(
    *,
    settings: Any,
    prompt: str,
    response_schema: type[BaseModel],
    pdf_bytes: bytes | None = None,
    image_pngs: Sequence[bytes] = (),
    model_setting: str | None = None,
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
    thinking_budget: int = 0,
    thinking_level: str | None = None,
) -> GenerateResult:
    """One schema-constrained Gemini call: PDF bytes and/or page-image PNGs
    in, a validated ``response_schema`` instance out, plus usage/latency.

    ``temperature=0``, native inline PDF (``Part.from_bytes(mime_type=
    "application/pdf")``), ``response_mime_type="application/json"``,
    ``response_schema=response_schema`` — the SDK derives the wire schema
    from the Pydantic model directly. ``image_pngs`` lets a caller also (or
    instead) send rasterized page images — the C7 checkbox-grid vision
    fallback for the third of the corpus with no textual mark at all
    (recon-cds-corpus.md §4c).

    ``model_setting`` defaults to ``settings.model_cds_extract``; pass
    ``settings.model_cds_detect`` explicitly for the cheap per-file
    school+year detection call. Model id is never a literal — it always
    comes from the resolved ``Settings`` string (ADR 0011).

    Raises a typed ``CdsGeminiError`` subclass on any failure (auth, empty
    response, truncated candidate) — never returns a partial/guessed result.
    Transport retries only (``HttpRetryOptions(attempts=3)``); no
    hand-rolled retry loop on top (recon-vertex.md §5.7).

    ``thinking_budget`` defaults to ``0`` (disabled) — the same behaviour as
    before this parameter existed. ``-1`` is the provider's automatic
    budget; a positive integer requests an explicit token budget. Thought
    tokens bill at the output rate (see module docstring); price
    ``Usage.thoughts_tokens`` whenever this is non-zero.

    ``thinking_level`` defaults to ``None`` (unused, same as before this
    parameter existed) and, when given, TAKES PRECEDENCE over
    ``thinking_budget`` — the two are alternative controls on the same
    underlying setting, never combined. Pass one of the SDK's
    ``types.ThinkingLevel`` member names case-insensitively (e.g.
    ``"low"``); an unrecognised value raises ``CdsGeminiError`` rather than
    silently falling back to no thinking.
    """
    resolved_model_setting = model_setting or settings.model_cds_extract
    timeout_seconds = float(
        getattr(settings, "cds_model_timeout_seconds", _DEFAULT_TIMEOUT_SECONDS)
    )
    return await asyncio.to_thread(
        _generate_sync,
        settings=settings,
        model_setting=resolved_model_setting,
        prompt=prompt,
        response_schema=response_schema,
        pdf_bytes=pdf_bytes,
        image_pngs=image_pngs,
        max_output_tokens=max_output_tokens,
        timeout_seconds=timeout_seconds,
        thinking_budget=thinking_budget,
        thinking_level=thinking_level,
    )
