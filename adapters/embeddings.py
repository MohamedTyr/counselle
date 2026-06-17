"""Vertex embeddings adapter (ADR 0008, phase-3 Slice B).

``gemini-embedding-001`` outputs 3072 dims by default and does **not** normalize
non-3072 outputs (live-verified 2026-06-10: L2 norm 0.5731 at 768 dims) — so every
call passes ``output_dimensionality=settings.embed_dimensions`` and we L2-normalize
the returned vectors ourselves before they go anywhere near cosine distance.

The SDK call is sync; we run it via ``asyncio.to_thread``. Batch embedding is
supported: ``embed_content`` accepts a list of contents and returns one embedding
per item (``gemini-embedding-001`` is explicitly exempt from the Vertex
one-content-per-call restriction — verified in google-genai's transformers).
"""

import asyncio
import math

from google import genai
from google.genai import types

from config.settings import get_settings

#: Vertex batch-embedding cap per the phase file (≤64 texts per call). An
#: external provider invariant, not a preference (CFG-08/LA-2: keep hardcoded).
BATCH_SIZE = 64
# Resilience tunables — kept as named constants (CFG-08 reviewed 2026-06: no
# current need to tune retry without a deploy; promote to Settings if the
# embedding path becomes flaky in prod).
_MAX_ATTEMPTS = 3
_BACKOFF_BASE_S = 1.0


def embed_model_version() -> str:
    """The version string baked into content hashes — a change re-embeds everything."""
    settings = get_settings()
    return f"{settings.embed_model}@{settings.embed_dimensions}"


def _l2_normalize(vector: list[float]) -> list[float]:
    """Unit-normalize; a zero vector is left as-is (nothing sane to divide by)."""
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0.0:
        return vector
    return [value / norm for value in vector]


def _client() -> genai.Client:
    """Express-mode Vertex client from Settings (phase-3 Step 0 as-built note)."""
    settings = get_settings()
    if not settings.vertex_api_key:
        raise RuntimeError("COUNSELLE_VERTEX_API_KEY is not set — embeddings unavailable")
    return genai.Client(vertexai=True, api_key=settings.vertex_api_key)


def _embed_batch_sync(client: genai.Client, texts: list[str]) -> list[list[float]]:
    """One batched embed_content call; raises on a short or empty response."""
    settings = get_settings()
    result = client.models.embed_content(
        model=settings.embed_model,
        contents=texts,
        config=types.EmbedContentConfig(output_dimensionality=settings.embed_dimensions),
    )
    embeddings = result.embeddings or []
    if len(embeddings) != len(texts):
        raise RuntimeError(
            f"embed_content returned {len(embeddings)} vectors for {len(texts)} texts"
        )
    vectors: list[list[float]] = []
    for embedding in embeddings:
        if embedding.values is None:
            raise RuntimeError("embed_content returned an embedding with no values")
        vectors.append(_l2_normalize(list(embedding.values)))
    return vectors


async def _embed_batch_with_retry(client: genai.Client, batch: list[str]) -> list[list[float]]:
    """Retry ×3 with exponential backoff; the final failure propagates."""
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            return await asyncio.to_thread(_embed_batch_sync, client, batch)
        except Exception:  # SDK transient errors are a moving target — catch broadly
            if attempt == _MAX_ATTEMPTS:
                raise
            await asyncio.sleep(_BACKOFF_BASE_S * 2 ** (attempt - 1))
    raise AssertionError("unreachable")


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts in batches of ≤64; every vector comes back L2-normalized."""
    if not texts:
        return []
    client = _client()
    vectors: list[list[float]] = []
    for start in range(0, len(texts), BATCH_SIZE):
        vectors.extend(await _embed_batch_with_retry(client, texts[start : start + BATCH_SIZE]))
    return vectors
