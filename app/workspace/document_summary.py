"""Best-effort cheap-model summaries for extracted student documents."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from pydantic_ai import Agent

from app.workspace.models import DocumentCreate
from config.settings import load_prompt

logger = structlog.get_logger(__name__)

DocumentSummaryGenerator = Callable[[DocumentCreate], Awaitable[object]]
ModelFactory = Callable[[], Any]

_SUMMARY_LINES = ("Type", "Topics")
_SUMMARY_LINE_MAX_CHARS = 120
_SUMMARY_MAX_CHARS = 240
_SUMMARY_TYPES = frozenset(
    {
        "academic record",
        "activity record",
        "application material",
        "essay draft",
        "financial aid material",
        "other",
        "recommendation material",
        "school record",
        "test record",
    }
)
_SUMMARY_TOPICS = frozenset(
    {
        "academics",
        "activities",
        "application",
        "coursework",
        "essay",
        "financial aid",
        "preferences",
        "recommendations",
        "testing",
        "work experience",
    }
)


async def summarize_document(
    settings: Any,
    *,
    title: str,
    doc_type: str,
    extracted_text: str,
    model_factory: ModelFactory | None = None,
) -> str | None:
    """Return a concise summary, or ``None`` when the optional model call cannot help."""
    if not extracted_text.strip():
        return None
    excerpt = extracted_text[: settings.document_summary_excerpt_max_chars]
    try:
        agent = Agent(
            _summary_model(settings, model_factory),
            system_prompt=load_prompt("document_summary").strip(),
        )
        prompt = (
            f"Title: {title}\nType: {doc_type}\n\n<student-document>\n"
            f"{excerpt}\n</student-document>"
        )
        result = await asyncio.wait_for(
            agent.run(prompt), timeout=settings.document_summary_timeout_s
        )
        return normalize_document_summary(result.output)
    except Exception:
        # Summaries improve list context but are never allowed to block uploads.
        logger.warning(
            "document summary model call failed; upload will continue",
            doc_type=doc_type,
            extracted_text_length=len(extracted_text),
        )
        return None


def make_document_summary_generator(
    settings: Any, model_factory: ModelFactory | None = None
) -> DocumentSummaryGenerator:
    """Build the production upload callback from the app's cheap-model seam."""

    async def generate(data: DocumentCreate) -> str | None:
        if data.extracted_text is None:
            return None
        return await summarize_document(
            settings,
            title=data.title,
            doc_type=data.doc_type,
            extracted_text=data.extracted_text,
            model_factory=model_factory,
        )

    return generate


#: Only this provider prefix needs the explicit Vertex Express Mode auth path
#: below (see ``app.agent_node.default_model_factory``); every other
#: provider-prefixed string resolves fine through PydanticAI's own
#: ``infer_model``.
_GOOGLE_VERTEX_PREFIX = "google-vertex:"


def _summary_model(settings: Any, model_factory: ModelFactory | None) -> Any:
    if model_factory is not None:
        return model_factory()
    model_setting: str = settings.model_cheap
    if not model_setting.startswith(_GOOGLE_VERTEX_PREFIX):
        # PydanticAI resolves this provider-prefixed string to the configured
        # provider/model pair, so summaries follow the same cheap-model Settings seam.
        return model_setting
    # The bare "google-vertex:" prefix resolves to an ambient-credentials
    # GoogleCloudProvider, which this app can't authenticate with (notes §1 on
    # app.agent_node.model_name_from_setting/default_model_factory). Build the
    # model the same explicit way the counselor model does, but for the cheap
    # model setting.
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    from app.agent_node import model_name_from_setting

    if not settings.vertex_api_key:
        raise RuntimeError(
            "COUNSELLE_VERTEX_API_KEY is not set — the cheap model cannot "
            "authenticate (Vertex Express Mode key required)."
        )
    return GoogleModel(
        model_name_from_setting(model_setting),
        provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
    )


def normalize_document_summary(value: object) -> str | None:
    """Accept only privacy-bounded list metadata, never arbitrary model prose."""
    if not isinstance(value, str):
        return None
    lines = [" ".join(line.split()) for line in value.splitlines() if line.strip()]
    if "\n".join(lines) == "NO_SUMMARY":
        return None
    if len(lines) != len(_SUMMARY_LINES):
        return None
    values: list[str] = []
    for label, line in zip(_SUMMARY_LINES, lines, strict=True):
        prefix = f"{label}: "
        if not line.startswith(prefix):
            return None
        value = line.removeprefix(prefix)
        if len(value) > _SUMMARY_LINE_MAX_CHARS:
            return None
        values.append(value)
    if values[0] not in _SUMMARY_TYPES or not _summary_topics_are_private(values[1]):
        return None
    summary = "\n".join(
        f"{label}: {value}" for label, value in zip(_SUMMARY_LINES, values, strict=True)
    )
    if len(summary) > _SUMMARY_MAX_CHARS:
        return None
    return summary


def _summary_topics_are_private(value: str) -> bool:
    topics = [topic.strip() for topic in value.split(",")]
    return 2 <= len(topics) <= 3 and len(set(topics)) == len(topics) and all(
        topic in _SUMMARY_TOPICS for topic in topics
    )


def is_no_document_summary(value: object) -> bool:
    """Return whether the model deliberately reported insufficient source text."""
    return isinstance(value, str) and "\n".join(
        " ".join(line.split()) for line in value.splitlines() if line.strip()
    ) == "NO_SUMMARY"
