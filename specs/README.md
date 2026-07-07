# specs/ — the permanent home for PRDs and plans

This is the canonical, shareable record of **what we decided to build and how**, for every MVP and feature. When you want to know "what was the plan for X, and is it done?", this is where you look.

Each MVP or feature gets its own folder:

```
specs/
├── <mvp-or-feature>/
│   ├── PRD.md          # the WHAT — product requirements (added when scoped)
│   ├── architecture.md # the HOW — design spec (optional; when a feature has one)
│   └── plan/           # the execution plan — phase/step files (the HOW + sequencing)
```

A feature that only ever gets an execution plan can have just `plan/`; one that only gets a PRD can have just `PRD.md`. Both is the norm for a full MVP.

## What's here today

| Folder | What it is | State |
|--------|-----------|-------|
| [`mvp1/`](mvp1/) | The MVP1 agent — `PRD.md` (stories 1–58) + `plan/` (phases 0–7). | Shipped |
| [`mvp2/`](mvp2/) | The MVP2 full-stack app — `PRD.md`, `architecture.md` (the HOW, merged into `docs/ARCHITECTURE.md` Part II), and `plan/` (ship-plan, wire-contract, frontend-plan, the FE-6 audit). | Shipped (B0–B5, B7 hardening; B6 deploy deferred) |
| [`mvp3/`](mvp3/) | The MVP3 workspace — `workspace-design.md`, `feature-showcase.md`, and `plan/workspace-implementation-plan.md` for the persistent Schools/Tasks/Essays/Activities workspace and agent-ready service seam. | Workspace shipped |
| [`agent-mode/`](agent-mode/) | Agent V1 — the plan to replace counselor chat with one transparent Codex-style agent mode, including tool contracts, visible run traces, and live E2E review gates. | Scoped; implementation not started |
| [`deep-research/`](deep-research/) | The deferred deep-research feature (PRD stories 39–41) — approved `PRD.md` plus the original `plan.md` stub. | Scoped; implementation not started |

## The lifecycle (how a plan gets here)

1. **Draft locally** in [`../plans/`](../plans/) while a feature is actively being worked on. That folder is ephemeral scratch space.
2. **When the work is finished and verified perfect**, relocate the finalized PRD/plan here, into `specs/<feature>/`. This is the "we approved it and it's done / being implemented" snapshot teammates rely on.
3. Documents here are **historical records of decisions**, not living docs. The living system description lives in [`../docs/`](../docs/) (`ARCHITECTURE.md`, `DATABASE_GUIDE.md`, `adr/`). Don't rewrite a shipped plan's narrative after the fact — if a decision changes, that's a new ADR or a doc update, not a retro-edit here.
