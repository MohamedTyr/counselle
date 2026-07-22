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
- The current skill set is:
  - public response-mode workflows: `focused-answer`, `deep-research`, `guided-counselor`;
  - public task workflows: `school-comparison`, `school-deep-dive`;
  - internal support workflows: `citation-and-recency`, `db-recipes`.
- `dossier-assembly` remains only as a non-advertised compatibility alias that canonicalizes to `school-deep-dive` for old parked/persisted selections. `decode-coded-value` was removed when the CDS Library packet contract eliminated the old IPEDS-code problem class.
- Public skills can optionally belong to trusted product groups. The `response-mode` group powers the composer counseling-mode selector while still executing through the existing selected-skills contract; group validation prevents selecting multiple response modes in one turn.
- Skill metadata loads at startup; the full body is returned on demand via a `load_skill(name)` tool always present in the agent's toolset (progressive disclosure), or preloaded server-side when the student explicitly selects public skills for a turn.
- Skills load on top of PydanticAI (ADR 0003).
