# ADR 0020 — MVP2 frontend: LibreChat-cloned design system & components on React/Vite/Tailwind

**Status:** Accepted (2026-06-12; drafted in the MVP2 architecture pass, 2026-06-11)

## Context
MVP2 needs a ChatGPT-grade web app (PRD-mvp2). Designing a chat product's design system and commodity components (sidebar, composer, message rendering, settings) from scratch is the highest-risk, lowest-differentiation work in the project. The product decision: clone the look of LibreChat — an MIT-licensed, mature open-source chat UI — exactly (colors, fonts, spacing, components), but recomposed for our product ("a house from the castle's bricks"). Counselle's differentiating surfaces (activity timeline, cited cards, clarify widget) don't exist in LibreChat and must be built.

## Decision
1. **The frontend stack is LibreChat's rendering stack** (verified against the repo): React 18 + TypeScript, Vite, Tailwind CSS 3.4 + their CSS-variable theme, Radix UI, lucide-react, TanStack Query, react-router, react-markdown + remark-gfm, react-textarea-autosize, framer-motion, Inter/Roboto Mono. We stay on their majors while cloning (no Tailwind v4 migration).
2. **Tokens are copied wholesale first**: their `tailwind.config.cjs` + `style.css` (the `:root`/`.dark` CSS-variable theme) + fonts, essentially verbatim — guaranteeing pixel fidelity for cloned *and* new components. Pruning comes later, never first.
3. **Cloned components are vendored** in `frontend/src/vendor/librechat/`: JSX structure and Tailwind classes preserved exactly; their Recoil/data-provider wiring stripped and replaced with props. A pinned upstream commit (`UPSTREAM.md`) + the MIT notice live in that directory. No restyling inside `vendor/`; re-syncs are deliberate tasks.
4. **Cloned surfaces:** sidebar/nav + conversation list, composer, message shell + markdown renderers + action row, settings dialog, new-chat landing + starter chips, auth pages. **Never taken:** their backend/data-provider, Recoil, branching UI, file uploads, multi-endpoint selector, i18n, Mermaid/KaTeX/Monaco, speech.
5. **Counselle-native components** (timeline, dossier stat block, comparison table, score band, citation chips/popovers, sources footer, clarify widget, "not in our database" card) are built new, using only the cloned tokens, primitives, spacing, and motion timings — plus exactly two new semantic token pairs: `--official-*` (cool) and `--community-*` (warm).
6. **Client state is Jotai** (their newer atoms are already Jotai); Recoil is not adopted. Server state is TanStack Query over our own thin protocol client (`src/api/` — the only module that knows the backend exists).
7. **The turn reducer is a named pure module** (`src/api/turn-reducer.ts`): protocol events in → turn view-state out (block list, steps, skeletons, receipt), no React imports; components are dumb draws over it. It reduces live streams and the persisted transcript through one code path, and is tested against **fixture payloads exported by the backend's protocol tests** — Python↔TypeScript drift caught by shared fixtures, no contract-test machinery.

## Rationale
- The clone requirement *determines* the stack: identical pixels require running their classes against their tokens on their primitives. Conveniently, that stack is the boring industry standard.
- Tokens-first is the cheapest possible path to "exact same colors, fonts, spacing, everything" — fidelity is achieved in two files, not by eyeballing components.
- The vendor quarantine separates "cloned, don't touch" from "ours, designed" — keeping the lego rule physical and re-syncs possible.
- MIT license makes the clone legal; the notice requirement is trivial.
- Building only the honesty surfaces ourselves concentrates our design effort exactly where Counselle differentiates.

## Alternatives considered
- **Design a system from scratch** (with the design-skill tooling) — rejected by product decision: slower, riskier, and the user explicitly wants LibreChat's look.
- **Fork LibreChat wholesale and carve it down** — rejected: we'd inherit their Express/Mongo backend, Recoil stores, branching, i18n, and hundreds of files to delete; carving down a castle is more work than borrowing bricks, and the result fights our FastAPI/SSE backend.
- **Use their `@librechat/client` published component package** — rejected: it packages their data coupling and update cadence; we need frozen pixels, not a live dependency on their roadmap.
- **A component library (shadcn/ui etc.) styled to look similar** — rejected: "similar" is not "clone"; the requirement is exact.

## Consequences
- `frontend/` joins the monorepo as a pure protocol client; `harness/` is deleted at parity.
- We own a fork-in-miniature: cloned files don't auto-update; upstream improvements arrive only by deliberate re-sync against the pinned commit.
- Each cloned surface drags 3–10 support files (hooks, ui atoms) into `vendor/` — accepted; the quarantine absorbs them.
- The two semantic token pairs are the only color additions allowed to the cloned system; any further color-with-meaning is a design-system decision, not a tweak.
- Tailwind/React major upgrades are coupled to upstream re-sync decisions.
