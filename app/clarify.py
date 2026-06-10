"""The ``ask_student`` clarify tool — interrupt-backed (ARCHITECTURE §12.1).

Clarify is NOT a graph node: this tool validates a :class:`ClarifySpec` and
calls ``langgraph.types.interrupt()`` from inside the agent node's tool loop
(notes-p4-apis §7 — interrupt reads the run config from a ContextVar, so it
works in nested calls under a node). The graph parks durably; the API edge
streams the spec as a ``clarify`` event; the student's answer resumes the
graph via ``Command(resume=answer)`` and becomes this tool's return value.

⚠️ Resume RE-EXECUTES the agent node from its start (notes §7): the whole
PydanticAI run replays and resume values match interrupt calls by order of
occurrence. This function is deterministic given its arguments — validation
happens before the single ``interrupt()`` call, so a replayed identical call
consumes the resume value correctly. Accepted MVP1 risk: a non-deterministic
replay may phrase the question differently (notes §7 point 2).
"""

import logging
from typing import Any

from langgraph.types import interrupt
from pydantic import ValidationError

from domain.specs import ClarifySpec

logger = logging.getLogger(__name__)

_CONSTRAINT_ERROR = (
    "ask_student error: provide between 2 and 4 options, each an object with "
    "'label' and 'hint' strings. Ask ONE focused question with at most 4 "
    "options — the widget always adds a free-text 'Other' field, never add "
    "one yourself."
)


def ask_student(
    question: str,
    header: str,
    options: list[dict[str, Any]] | None,
    multi_select: bool = False,
) -> str:
    """Ask the student ONE focused clarifying question and wait for the answer.

    Use this ONLY when underspecification materially changes the answer and
    there is no sensible default. If one reading is clearly likeliest, answer
    it and state the assumption instead; if a reasonable default exists, just
    answer. One round per turn — never an intake form.

    Args:
        question: The question text shown to the student.
        header: A short label above the answer chips (e.g. "What matters").
        options: 2-4 answer chips, each ``{"label": ..., "hint": ...}`` —
            ``label`` is the choice, ``hint`` says what picking it means. Do
            NOT add an "Other" option; the widget always renders free text.
        multi_select: Whether the student may pick several options.

    Returns:
        The student's answer as text. A typed free-text reply ALWAYS counts
        as the answer, even when it matches no option — treat it as such.
    """
    try:
        spec = ClarifySpec(
            question=question,
            header=header,
            multi_select=multi_select,
            options=options or [],  # type: ignore[arg-type]  # pydantic validates the dicts
        )
    except ValidationError:
        logger.warning(
            "ask_student: ClarifySpec validation failed — returning constraint error to the model "
            "(question=%r, options_count=%d)",
            question,
            len(options) if options is not None else 0,
        )
        return _CONSTRAINT_ERROR
    # The ONE interrupt call — deterministic in position (see module docstring).
    answer = interrupt(spec.model_dump(mode="json"))
    return answer if isinstance(answer, str) else str(answer)
