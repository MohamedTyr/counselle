"""Live smoke check for the four-tool counselle-db MCP boundary."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from config.settings import DbChildSettings, serialize_db_child_environment

EXPECTED_TOOLS = {"resolve_school", "get_school_profile", "get_domain", "query_database"}


def structured(result: Any) -> dict[str, Any]:
    assert not result.isError, result.content
    assert isinstance(result.structuredContent, dict), result.content
    return result.structuredContent


async def main() -> None:
    settings = DbChildSettings()  # type: ignore[call-arg]
    server = StdioServerParameters(
        command=sys.executable,
        args=["-m", "counselle_db.server"],
        env=serialize_db_child_environment(
            settings, uv_cache_dir=os.environ.get("UV_CACHE_DIR")
        ),
    )
    async with stdio_client(server) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        names = {tool.name for tool in (await session.list_tools()).tools}
        assert names == EXPECTED_TOOLS, f"expected {sorted(EXPECTED_TOOLS)}, got {sorted(names)}"

        seed = structured(
            await session.call_tool(
                "query_database",
                {
                    "sql": (
                        "SELECT school_id,domain_id FROM "
                        "cds_library.active_cds_domain_packets "
                        "WHERE packet IS NOT NULL AND current_definition_match IS TRUE "
                        "ORDER BY school_id,domain_id LIMIT 1"
                    )
                },
            )
        )
        assert seed.get("row_count") == 1, seed
        columns = seed["columns"]
        row = seed["rows"][0]
        unitid = row[columns.index("school_id")]
        domain_id = row[columns.index("domain_id")]
        resolved = structured(await session.call_tool("resolve_school", {"query": str(unitid)}))
        assert resolved.get("status") == "match", resolved
        school = resolved["school"]
        assert school["unitid"] == unitid
        coverage = resolved["coverage"]
        domains = coverage["usable_domain_ids"]
        assert domain_id in domains, "selected packet must be usable under the current manifest"

        profile = structured(await session.call_tool("get_school_profile", {"unitid": unitid}))
        assert profile.get("groups"), profile
        domain = structured(
            await session.call_tool(
                "get_domain", {"unitid": unitid, "domain_id": domain_id}
            )
        )
        assert domain.get("availability", {}).get("configured", 0) > 0, domain
        denied = await session.call_tool(
            "query_database", {"sql": "SELECT id FROM cds_library.schools LIMIT 1"}
        )
        denied_error = (denied.structuredContent or {}).get("error")
        assert denied.isError or denied_error == "tool_error", denied
        print(json.dumps({"tools": sorted(names), "unitid": unitid, "domain": domain_id}))


if __name__ == "__main__":
    asyncio.run(main())
