"""Live Vertex embedding smoke check (Phase 3 Step 0).

Embeds "acceptance rate" via the express-mode genai client and asserts the
vector has exactly ``embed_dimensions`` floats. Run: uv run python scripts/embed_smoke.py
"""

import math

from google import genai
from google.genai import types

from config.settings import get_settings


def main() -> None:
    settings = get_settings()
    if not settings.vertex_api_key:
        raise SystemExit("COUNSELLE_VERTEX_API_KEY is not set")
    client = genai.Client(vertexai=True, api_key=settings.vertex_api_key)
    result = client.models.embed_content(
        model=settings.embed_model,
        contents="acceptance rate",
        config=types.EmbedContentConfig(output_dimensionality=settings.embed_dimensions),
    )
    assert result.embeddings is not None
    values = result.embeddings[0].values
    assert values is not None
    norm = math.sqrt(sum(v * v for v in values))
    print(f"model={settings.embed_model} dims={len(values)} l2_norm={norm:.4f}")
    assert len(values) == settings.embed_dimensions, "wrong dimensionality"


if __name__ == "__main__":
    main()
