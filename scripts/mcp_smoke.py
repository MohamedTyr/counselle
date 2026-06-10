"""Live smoke check for the counselle-db MCP server (phase 2, Slice C).

Spawns the server over stdio, asserts all 10 tools are registered, and resolves
"Duke" against the live database. Run: ``uv run python scripts/mcp_smoke.py``.
"""

import asyncio
import json

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

EXPECTED_TOOL_COUNT = 11
SERVER = StdioServerParameters(command="uv", args=["run", "python", "-m", "counselle_db.server"])


async def main() -> None:
    async with stdio_client(SERVER) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        tools = (await session.list_tools()).tools
        names = sorted(tool.name for tool in tools)
        assert len(tools) == EXPECTED_TOOL_COUNT, f"expected {EXPECTED_TOOL_COUNT}, got {names}"
        print(f"{len(tools)} tools: {', '.join(names)}")
        result = await session.call_tool("resolve_school", {"query": "Duke"})
        assert not result.isError, result.content
        print(json.dumps(result.structuredContent, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
