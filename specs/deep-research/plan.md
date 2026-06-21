# Plan stub: Deep research (PRD stories 39–41)

This is the deferred scope from the MVP1 implementation plan. PRD stories 39–41 cover the GPT-Researcher-based deep-research subagent: the embedded research subgraph inside LangGraph, the researcher and verifier agents, source-type tagging, the verification pass, and the research cost levers (depth/breadth/concurrency/cost-ceiling knobs in Settings). The graph currently remains `prepare -> agent -> END`; this plan adds the research route and subgraph.

The design is fully specified in `docs/ARCHITECTURE.md` §13 (deep-research subsystem) and the rationale for GPT-Researcher is in ADR 0009 (`docs/adr/0009-deep-research-gpt-researcher.md`). The bake-off that led to the GPT-Researcher choice is in `docs/research/deep-research-bakeoff.md`. The Settings surface already has the deep-research knobs; this plan implements the code that reads them.
