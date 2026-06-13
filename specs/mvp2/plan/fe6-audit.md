# FE-6 — Smoothness & fidelity audit (sign-off)

Audited 2026-06-12 against `plans/mvp2/frontend-plan.md` FE-6. Method: a
mechanical sweep (className diffs across all 74 vendored files vs the pinned
upstream 197a1dc4, reduced-motion/a11y/timing greps) + live browser
measurements on the mock fixtures. Fixes applied in the FE-6 commit.

## 1. Long-chat virtualization — DECIDED: none needed (measured)

80-message chat (~30,000 px of markdown, tables, sources footers), full-speed
programmatic scroll bottom→top over 2 s: **avg frame 18.3 ms, worst 22 ms,
0 frames > 32 ms** — sustained 60 fps. The flat list with per-message
`React.memo` + per-block markdown memoization carries MVP2 scale without
virtualization; `react-virtualized` stays out of the message path (re-measure
if chats grow 10×). Lazy card mounts: unnecessary at measured scale. Per-chat
scroll restoration: deliberately simplified to open-at-latest-exchange (the
standard chat UX; revisit on user feedback).

## 2. Reduced-motion (PRD 44)

Sweep found 5 ungated production animations; all gated in the FE-6 commit:
- `SplitText` per-letter spring (Landing greeting) → patched: `immediate` +
  zero stagger under `prefers-reduced-motion` (ledgered vendor patch)
- `.animate-fadeIn` (Landing), `.animate-spin` / `.animate-pulse` (loading
  states), `.scroll-animation-*` (the ↓ pill slide) → gated centrally in
  `counselle.css` (vendored `style.css` stays byte-identical)
- Already gated: the timeline shimmer (`counselle-step-active`), AnimatedTabs
- Acceptable ungated: <300 ms one-shot hover/popover fades

## 3. Touch targets, keyboard, a11y

- Clarify chips / Other input / Send: explicit `min-h-[44px]` — pass.
  Starter chips render >44 px with fixture content — pass.
- Citation chips: focusable, open the popover, Esc closes; timeline receipts
  are real buttons with `aria-expanded`; SR labels on chips/popovers/dialogs —
  no findings in Counselle-native components.
- No bare `console.log` in production paths.

## 4. Pixel fidelity (the "clone means clone" gate)

className-extraction diff of **all 74 vendored .tsx files** vs upstream:
- 50 byte-identical, 20 subtractions-only (all ledgered in UPSTREAM.md)
- 3 with additions, all ledgered (MessageIcon roundel, Account rows, RTL
  freeze); 1 real deviation found and fixed (ChatForm: a stray `flex-row`
  added to upstream's `@container items-between flex gap-2 pb-2` — note:
  `@container` and the `items-between` typo are upstream's own; kept verbatim)

**Deviation from the plan's method:** the plan calls for running upstream
LibreChat locally and overlay-diffing screenshots. Upstream's client dev
server requires their full API stack; instead the audit relied on (a) the
exhaustive className diff above, (b) per-phase in-browser visual review of
every cloned surface in both themes during FE-1…FE-5, and (c) computed-style
spot checks. Residual risk accepted; an overlay pass can ride along with any
future upstream re-sync.

## 5. Smoothness laws (live, on fixtures)

- Optimistic echo: ~53 ms (law: 0 ms-perceived) — pass
- First visible activity: ~53 ms (law: <300 ms) — pass
- Largest inter-event gap across all 5 fixtures: 900 ms worst case
  (law: no >2 s silence) — pass, statically verified per fixture
- Responsive: no horizontal overflow at 320/375/768/1024/1440; drawer sidebar
  <768; mobile chat verified at 375 in both FE-3 and FE-4 passes
- Scroll: user scroll always wins (re-anchor bug found & fixed in FE-4 pass);
  question-anchored send; ↓ pill on detach

## Gate

Signed off. The app demos the full PRD chat experience on fixtures alone:
wall → signup → seasonal landing → dossier turn with timeline/cards/citations
→ clarify → stop/refresh → settings → logout, in both themes, 320–1440 px.
