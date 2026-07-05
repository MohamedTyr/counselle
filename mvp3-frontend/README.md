# Counselle MVP3 Frontend Prototype

This is the independent MVP3 frontend prototype for Counselle. It is a Vite,
React, TypeScript, Tailwind 4, and shadcn-style workspace app used to explore
the agentic admissions workbench before wiring the production backend.

The current app is intentionally fixture-backed. Keep demo data isolated as the
refactor progresses so real API adapters can replace fixtures without rewriting
screens.

## Commands

```bash
npm install
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
```

`npm run dev` serves the app at the Vite URL printed in the terminal.

## Quality Gates

Run these before and after architecture changes:

```bash
npm run test && npm run lint && npm run typecheck && npm run build
```

The current build may warn about a large JS chunk. That warning is expected
until the router/code-splitting phase lands; do not ignore new build errors.

## Refactor Plan

The active architecture plan lives at:

```text
../plans/mvp3-frontend-architecture-refactor.md
```

Phase 0 adds this test harness and baseline smoke coverage. Later phases move
the prototype toward explicit app shell, workspace state, domain, fixtures, and
feature boundaries.
