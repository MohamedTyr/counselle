# ADR 0010 — Skills are authored as SKILL.md (open standard)

**Status:** Accepted

## Context
The PRD wants to write SKILLS the agent invokes when needed. We want them futureproof and not locked to one vendor or framework.

## Decision
Author skills as **SKILL.md** files (the open standard: YAML frontmatter with `name`+`description`, Markdown body, optional `scripts/`). Keep **skills (workflow knowledge)** separate from **MCP servers (transport/access)**.

## Rationale
- SKILL.md became a vendor-neutral standard adopted across 30+ tools; the same skill is portable (Claude API/SDK, and others).
- Progressive disclosure (metadata at startup, full instructions only when triggered) keeps context lean.
- MCP answers "how to reach external systems"; skills answer "how to do this job consistently" — separate layers (`docs/research/agent-stack-evaluation.md`).

## Alternatives considered
- Framework-specific tool decorators (LangChain `@tool`, CrewAI tasks, OpenAI agents-as-tools) as the canonical skill — rejected (vendor lock-in). Use thin per-framework adapters if needed, with SKILL.md as the canonical definition.

## Consequences
- MVP1 ships **4 skills**: `dossier-assembly`, `school-comparison`, `decode-coded-value`, `citation-and-recency`. (`deep-research-with-citations` is deferred with the GPT-Researcher subsystem — ADR 0009.)
- Skill metadata loads at startup; the full body is returned on demand via a `load_skill(name)` tool always present in the agent's toolset (progressive disclosure).
- Skills load on top of PydanticAI (ADR 0003).
