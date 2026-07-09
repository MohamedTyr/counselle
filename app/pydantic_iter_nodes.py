"""Small adapter around PydanticAI iteration node classes.

Keep private ``pydantic_ai._agent_graph`` imports isolated here. Call sites
should prefer ``Agent.is_model_request_node`` / ``Agent.is_call_tools_node`` for
checks, and use these exports only for annotations or explicit fallback checks.
"""

from __future__ import annotations

from pydantic_ai._agent_graph import CallToolsNode, ModelRequestNode

for _node in (ModelRequestNode, CallToolsNode):
    if not hasattr(_node, "stream"):
        raise RuntimeError(f"{_node.__name__} no longer exposes stream(ctx)")

__all__ = ["CallToolsNode", "ModelRequestNode"]
