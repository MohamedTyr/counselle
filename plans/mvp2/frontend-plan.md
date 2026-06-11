# MVP2 Frontend Plan — the LibreChat clone, built first, backend-free

> The execution plan for `frontend/`. Strategy per ADR 0020 and `architecture.md` §31: **clone LibreChat's design system and chat-commodity components exactly, recompose them for Counselle, build the Counselle-native surfaces in the same visual language — and run the whole thing against a mock transport so it's complete and demoable with zero backend.** Backend hookup is a later, separate stage (FE‑7, deliberately out of scope here).
>
> Grounded in a 4-agent recon of the LibreChat source (2026-06-11, repo at the pinned clone; MIT license — the notice ships in `vendor/`). Every file path and LOC figure below comes from that recon, not from memory.

---

## 0. The one rule (restated so it never drifts)

**Start from their code.** For every cloned surface: copy the real files, keep the JSX structure and every Tailwind class byte-identical, then *subtract* what MVP2 doesn't have (files, audio, mentions, branching, marketplaces) and *add* what LibreChat doesn't have (timeline, cards, citations, clarify, source control) — additions written only in their token/primitive vocabulary. We never restyle a vendored file; we never "re-implement inspired by."

---

## 1. What the recon established (the facts the plan stands on)

1. **The primitive layer lives in `packages/client/src/`, not `client/src/`.** All 57 UI primitives (Button, Dialog, Tabs, Switch, Tooltip, TextareaAutosize…), the 79 SVG icon components, ThemeProvider, the toast system, and the shared hooks (`useLocalize`, `useMediaQuery`, `useToastContext`) are the `@librechat/client` workspace package (~12.4k LOC). **Vendoring means copying that package**, plus exactly four things from `client/`: `tailwind.config.cjs`, `style.css` (2,960 lines — the entire `:root`/`.dark` token system, prose/markdown/hljs/scrollbar CSS, the streaming-cursor animations), `mobile.css` (323 lines, mobile sidebar), and `public/fonts/` (9 self-hosted Inter + Roboto Mono `.woff2` files referenced via a `$fonts` Vite alias).
2. **Theme mechanics:** `.dark`/`.light` class on `<html>`, localStorage key `color-theme` (`light|dark|system`), `darkMode: ['class']`, a `matchMedia` listener for system mode. `ThemeProvider.tsx` (266 LOC) is dependency-free — copy as-is.
3. **Styling is 100% Tailwind classes + CSS vars** across every target surface. No sass/CSS-modules/styled-components. Framer-motion appears nowhere in the composer/messages path (only in 2FA, which we drop). The streaming cursor and "thinking" pulse are **pure CSS** (`.result-streaming`, `.result-thinking`, `@keyframes blink/pulseSize` in `style.css`).
4. **The streaming-performance crown jewel is `MarkdownBlocks.tsx` + `splitMarkdown.ts`:** messages are split into top-level mdast blocks; each block is memoized on its content slice, so during streaming only the last, growing block re-parses. Self-contained (unified-ecosystem deps only). **Copy verbatim** — this is precisely the "stable block identity, no flicker" law from the PRD.
5. **Surface sizes (pre-strip):** sidebar/shell core ~29 files / ~3.3k LOC; composer minimal slice (no files/audio/mentions/commands) ~12 files / ~0.9k LOC; message rendering minimal slice (text-only, no tool-parts/artifacts/branching) ~30 files / ~3.2k LOC; landing ~0.5–0.7k; settings (3 tabs kept) ~1.7k; auth ~1.6k. With the substrate: **~24k LOC vendored pre-strip, landing around ~18–20k after stripping.**
6. **Coupling is architectural, not structural:** Recoil atoms, the `ChatContext → MessagesViewContext → MessageContext` stack, `librechat-data-provider` hooks, and `useLocalize` are the four recurring strips. The per-component strip lists from the recon are recorded per phase below.
7. **Submit semantics** live in `useTextarea.ts`'s `handleKeyDown`: Enter sends (an `enterToSend` preference), Shift+Enter newlines, Ctrl/Cmd+Enter always sends, IME composition (incl. the Safari `keyCode 229` check) never sends. Keep this hook (stripped); keep `react-textarea-autosize` (the real auto-grow primitive).
8. **Auth forms** are `react-hook-form` with inline rules and a pure-Tailwind floating-label trick — zero LibreChat coupling; half the auth files copy as-is. Google-only social login is a one-object edit in `SocialLoginRender.tsx`.

---

## 2. Repo shape & the import-alias scheme (so vendored imports never get rewritten)

The single highest-friction part of vendoring is import paths. We make them a non-event with three aliases:

```
frontend/
├── package.json / vite.config.ts / tsconfig.json
├── tailwind.config.cjs            # cloned verbatim (then: 2 token additions, §FE-4)
├── postcss.config.cjs             # cloned verbatim (postcss-import, preset-env, tailwindcss, autoprefixer)
├── public/fonts/                  # the 9 .woff2 files, cloned
├── index.html
└── src/
    ├── styles/
    │   ├── style.css              # cloned verbatim from client/src/style.css
    │   ├── mobile.css             # cloned verbatim
    │   └── counselle.css          # OURS: --official-* / --community-* tokens, per theme
    ├── vendor/librechat/
    │   ├── UPSTREAM.md            # pinned commit hash + per-directory source map
    │   ├── LICENSE                # LibreChat's MIT license, verbatim
    │   ├── client/                # ← packages/client/src (the primitive substrate)
    │   └── app/                   # ← the vendored client/src subset (components/, hooks/, utils/, Providers/ — same relative paths as upstream)
    ├── app/                       # OURS: routes, app shell composition, jotai atoms, mock auth
    ├── api/                       # OURS: protocol client — types, Transport seam, turn reducer, fixtures
    └── components/                # OURS: timeline/, cards/, citations/, clarify/, source-control/
```

**Vite/tsconfig aliases:**

| Alias | Points to | Why |
|---|---|---|
| `@librechat/client` | `src/vendor/librechat/client` | Vendored app-level components import the package by name today — imports compile untouched |
| `~` | `src/vendor/librechat/app` | Inside `client/src`, `~/` means `client/src/` — keeping the same relative tree under `vendor/librechat/app/` means `~/utils`, `~/hooks/...` resolve untouched |
| `$fonts` | `public/fonts` | `style.css` `@font-face` urls resolve untouched |
| `@/` | `src` | All Counselle-authored code — visually distinct from vendored imports |

Inside `vendor/librechat/client`, the package's own `~` self-alias is handled by a per-directory tsconfig path (or a sed pass at vendor time — decide when cutting; the recon confirmed the package ships its own tsconfig with `~` → its own `src`).

**Vendor rules (physical, enforced by review):** no restyling inside `vendor/`; every strip is a *deletion or props-rewire*, never a class change; `UPSTREAM.md` records the pinned commit and maps each vendored directory to its upstream path; re-syncs are deliberate tasks against that commit. `vendor/` is exempt from the house file-size rules — it's a clone, not our code.

**Dependencies to install (from the recon, trimmed):** react 18 + react-dom, typescript, vite + `@vitejs/plugin-react`, tailwindcss 3.4 + tailwindcss-animate + tailwindcss-radix + postcss-import + postcss-preset-env + autoprefixer, the `@radix-ui/*` set the package peers on, `@ariakit/react`, `@headlessui/react` (settings dialog only), lucide-react, clsx + tailwind-merge + class-variance-authority, jotai, `@tanstack/react-query`, react-router-dom, react-hook-form, react-textarea-autosize, react-markdown + remark-gfm + remark-supersub + rehype-highlight (+ the `mdast-util-*`/`micromark-extension-*` set that `splitMarkdown.ts` needs), react-transition-group (scroll-to-bottom fade only), react-virtualized (sidebar list; revisit in FE‑6), dompurify.

**Deliberately NOT installed (the recon's drop list):** recoil (+ vite-plugin-node-polyfills, only needed by recoil), `librechat-data-provider` (typed `declare module` stub for the ~3 type imports), i18next/react-i18next, remark-math/rehype-katex/katex, mermaid, monaco, react-dnd, framer-motion & @react-spring/web (unused in our surfaces; add later only if a kept primitive demands it), @marsidev/react-turnstile, input-otp, rc-input-number, @tanstack/react-table, dicebear, speech/audio packages.

**The four standard strips, standardized once:**

1. **Recoil → gone.** UI prefs (`enterToSend`, `showScrollButton`, `maximizeChatSpace`, font size) become Jotai atoms in `@/app/state` with the same localStorage keys where it matters; per-instance atom families (`showStopButtonByIndex`, `messagesSiblingIdxFamily`) become local state or vanish with their feature.
2. **Contexts → one thin layer.** Their `ChatContext → MessagesViewContext → MessageContext` stack flattens to our own `ChatContext` (conversation, isSubmitting, submit/stop handlers — backed by the mock transport in this plan) + their slim `MessageContext` kept as-is (CodeBlock needs it).
3. **data-provider hooks → `@/api`.** Every `useGet*/use*Mutation` swaps for a TanStack Query hook over our protocol client (mock transport now, HTTP later — same interface).
4. **`useLocalize` → a 10-line lookup.** Vendor a **trimmed copy of `client/src/locales/en/translation.json`** and reimplement `useLocalize` as a flat key→string lookup. (An identity stub would render raw `com_ui_*` keys — the recon's caveat; the English JSON keeps every label byte-identical with no i18next.)

---

## 3. The mock-first architecture (zero backend, full app)

`src/api/` is built in this plan with **two implementations of one `Transport` seam**:

```ts
interface Transport {
  sendMessage(sessionId, body): AsyncIterable<ProtocolEvent>   // the SSE stream shape
  attach(sessionId, lastEventId): AsyncIterable<ProtocolEvent> // resume
  cancel(sessionId): Promise<void>
  sessions / transcript / auth / config / feedback ...          // the REST surface
}
```

- **`MockTransport` (this plan):** replays **fixture event streams** — handwritten JSON files of protocol events (`meta/step/thinking/delta/viz/clarify/sources/usage/done` per `architecture.md` §27) — with realistic timing (token cadence on `delta`, step start→end gaps), plus fixture sessions/users/config. Scenario catalog: *dossier turn* (steps + stat block + citations), *comparison turn* (table + per-cell citations), *score-band turn*, *clarify turn* (pause → chip answer → resume), *find/filter turn*, *error turn*, *cancelled turn*, *"not in our database" turn*, *long chat* (virtualization fodder), *Reddit-enabled vs disabled turn* (timeline difference). These fixtures are written to the protocol spec now and **reconciled with the backend's exported fixtures when it lands** (the §34 contract-fixture mechanism — the reconciliation is the contract test).
- **`HttpTransport` (FE‑7, later):** fetch-streaming SSE against `/v1`. Nothing above the seam changes — that's the whole point.
- **The turn reducer** (`src/api/turn-reducer.ts`, per ADR 0020): pure events→view-state (block list, steps, skeletons, receipt), no React. Both the live stream and the persisted-transcript shape reduce through it.
- Dev switch: `VITE_TRANSPORT=mock|http` (mock is the default until FE‑7).

---

## 4. Phases

Each phase ends at a **gate**; phases are sequential (each builds on the last's vendored substrate). LibreChat upstream commit is pinned in FE‑0 and never moves mid-plan.

### FE‑0 — Scaffold & substrate (the pixels arrive before any feature)

Vendor: `packages/client/src` → `vendor/librechat/client`; `tailwind.config.cjs`, `style.css`, `mobile.css`, fonts; postcss config. Write `UPSTREAM.md` + MIT notice. Set up Vite + aliases + the provider stack the recon specified (QueryClient → Theme → RadixToast → Toast — **no RecoilRoot**; jotai needs no provider). Reimplement `useLocalize` over the trimmed English JSON. Stub `librechat-data-provider` types. A bare AppShell route renders: empty sidebar column + empty chat column + theme toggle.

**Gate:** build green; both themes switch via the `color-theme` key incl. system mode; Inter/Roboto Mono render from `$fonts`; a sampler page of vendored primitives (Button, Dialog, Switch, Tabs, Tooltip, TextareaAutosize) renders identically in both themes.

### FE‑1 — The shell: sidebar + layout

Vendor (strip lists from recon §sidebar): `routes/Root.tsx` layout (sidebar column + content + the mobile `translateX` drawer + backdrop), `UnifiedSidebar/*` (4 files), `SidePanel/Nav.tsx`, `Nav/`: AccountSettings, SearchBar, NewChat, NavToggle, NavLink, `Conversations/`: Conversations (virtualized list), Convo, ConvoLink, RenameForm, ConvoOptions + DeleteButton, `ActivePanelContext`, `useNavScrolling`, `useNavHelpers`, `utils/convos.ts` (`groupConversationsByDate` — copy as-is), `Chat/Menus/OpenSidebar.tsx`.

**Subtract:** BookmarkNav, FavoritesList/FavoriteItem, ProjectsSection, marketplace links, Share/Project/Archive/Duplicate menu items, shift-instant-delete, token balance + My Files + Help links in AccountSettings, `useSideNavLinks`'s panel zoo (our link list = conversations only), `ConversationEndpointIcon` (→ one Counselle mark). **Rewire:** `sidebarExpanded`/`search` atoms → jotai; conversation list/rename/delete → `@/api` mock hooks; `useTitleGeneration` → mock titles in fixtures.

**Gate:** sidebar pixel-matches reference screenshots (protocol §5) in both themes, desktop + mobile drawer; date-grouped fixture history; search filters; rename/delete work against the mock store; collapse animation matches.

### FE‑2 — Composer + landing (the first Counselle recomposition)

Vendor the **minimal composer slice** (~12 files): ChatForm (stripped), SendButton, StopButton, CollapseChat, `useTextarea` (keep `handleKeyDown`/paste/IME exactly), `useHandleKeyUp`, `useAutoSave` (logic kept, Recoil out), `useFocusChatEffect`, TextareaAutosize, `utils/resize.ts`. Vendor Landing.tsx + ConversationStarters.tsx + SplitText.

**Subtract:** all of `Files/` (15 files), AudioRecorder/StreamAudio, Mention ×2 + MentionItem, PromptsCommand/SkillsCommand, BadgeRow/EditBadges/PendingManualSkillsChips, TextareaHeader (multi-convo). **Rewire:** react-hook-form stays (it's their form skeleton); `useSubmitMessage` → our ChatContext submit → MockTransport; send⇄stop on mock `isSubmitting`.

**Add (Counselle-native, their vocabulary):** the **source-control dropdown** in the composer's bottom row (web/.edu/Reddit toggles + per-subreddit allowlist + "database always on" row — built from vendored DropdownPopup/Switch primitives); the landing greeting fed by the config fixture (season-aware text); starter chips bound to the fixture's four signature prompts; composer drafts → localStorage per session.

**Gate:** landing + composer pixel-match reference (minus the deliberate additions); Enter/Shift+Enter/Cmd+Enter/IME behave exactly as upstream; drafts survive refresh; source dropdown sticks per conversation (mock store).

### FE‑3 — Messages & streaming (the hardest vendoring, the biggest payoff)

Vendor the **text-only message slice** (~30 files): MessagesView (+ MessagesViewContent), MultiMessage→Message→MessageContainer→MessageRender path, MessageContent/Markdown/**MarkdownBlocks/splitMarkdown (verbatim)**/MarkdownComponents/markdownConfig (trimmed)/MarkdownErrorBoundary/MarkdownLite/Container, CodeBlock/CodeBar/CopyButton/LangIcon, ScrollToBottom (+ its CSSTransition), HoverButtons + SubRow, PlaceholderRow, MessageIcon (simplified), the slim MessageContext + CodeBlockContext (as-is), `useMessageScrolling`/`useMessageActions`/`useMessageProcess` (stripped), `useCopyToClipboard`, `utils/languages.ts`. Keep the `.result-streaming`/`.result-thinking` CSS (already in style.css).

**Subtract:** SiblingSwitch + `messagesSiblingIdxFamily` (no branching — PRD decision 4), Fork, MessageAudio, artifacts (provider/plugin/components), citations-theirs/MCP-UI/highlighted-text plugins, math (remark-math/rehype-katex + `preprocessLaTeX`), Mermaid, tool-call `Parts/`, ParallelContent, search-highlight path. **Keep their Feedback (thumbs) and EditMessage** — MVP2 needs both (thumbs → feedback endpoint; edit → truncate-and-re-ask per PRD decision 4); wire both to mock handlers.

**Build (ours):** the **turn reducer** + MockTransport streaming; our **question-anchored scroll orchestration** (sent message pins to top, answer fills downward, "↓ Latest" pill — *deliberately replacing* their bottom-chasing behavior per PRD decision 8, while keeping their ScrollToBottom component as the pill's body).

**Gate:** a streamed mock dossier turn renders with stable block identity (completed blocks never re-render — verify with React DevTools profiler), CSS cursor at the stream edge, zero CLS; stop works mid-stream; edit truncates and re-asks in the mock; copy/thumbs function; transcript reload (mock) reproduces the same render through the same reducer.

### FE‑4 — The Counselle-native surfaces (where our design effort actually goes)

All in `@/components`, built **only** from vendored primitives + tokens + the two new semantic pairs (`counselle.css`: `--official-*` cool / `--community-*` warm, defined per theme; mapped in the tailwind config — the *only* token addition ever allowed):

- **Activity timeline:** step rows (source icon + human label), shimmer on active (CSS, reduced-motion aware), thinking lines as muted text, expandable receipts, collapse-to-one-line-receipt at `done`, "research" kind reserved. Renders from the reducer's `steps[]` — identically for live streams and persisted step records.
- **Citation system:** inline chips (official/community grammar), anchored popover (Radix Popover; keyboard + Esc + SR-labeled), the sources footer (official block / community block, vintages).
- **The three cards** + states: dossier stat block (sections, CDS-depth badge, per-value chips, collapsible + sticky mini-nav, tabular numerals), comparison table (sticky first column, per-cell citation popovers, no winner-highlighting, phone variant), score band (per-section bands, never a composed 1600, the permanent teaching caption), the designed **"not available"** muted state, the **"not in our database"** card, the stream-error card. Skeletons sized from render-spec shape before data (CLS ≈ 0).
- **Clarify widget:** chips + hint sublabels + "Other" free-text, composer placeholder swap ("Pick one, or just type…"), freeze-to-record after answering.

**Gate:** every honesty-surface component test from `architecture.md` §34 passes against fixtures (NA states, tier-chip fidelity, no-1600, no-winner-highlight, unknown-card→markdown fallback, clarify freeze); the full mock scenario catalog plays end-to-end and looks like the PRD's "anatomy of one turn."

### FE‑5 — Settings, auth pages, chat management completion

Vendor: Settings.tsx shell (HeadlessUI Dialog + Radix Tabs) with **exactly three tabs** — General (theme via ThemeSelector; + our default-source-preset control), Account (name/email/password rows, connected-Google row; 2FA/avatar-upload stripped), Data (ClearChats + DeleteAccount kept; import/shared-links/API-keys/cache dropped) — plus DangerButton, ToggleSwitch (Recoil→props), OGDialog confirmations. Vendor the auth set: AuthLayout (our logo), Login/LoginForm, Registration, RequestPasswordReset, ResetPassword, SocialLoginRender (**Google only**), SocialButton, ErrorMessage, Footer, BlinkAnimation, a simplified Startup layout (config from fixture). Mock auth: a jotai session atom + fixture user; the signup wall redirect; data controls clear the mock store.

**Gate:** settings modal and all four auth pages pixel-match reference in both themes; the full logged-out → signup → landing → chat → settings → logout loop works entirely on mocks.

### FE‑6 — Smoothness & fidelity audit (the laws, verified)

- Long-chat virtualization decision executed (their `react-virtualized` vs lighter — measured on the long-chat fixture; 60fps scroll required), lazy card mounts, per-chat scroll restoration.
- `prefers-reduced-motion` audit (shimmer/transitions/SplitText all gated); 44pt touch targets; responsive sweep at 320/375/768/1024/1440; keyboard reachability of chips/popovers/menus.
- **The pixel-fidelity audit (the "clone means clone" gate):** run upstream LibreChat locally from the pinned commit; screenshot the five cloned surfaces (sidebar, composer, message thread, settings modal, login) at fixed viewports in both themes; overlay-diff against ours. For recomposed layouts where overlay can't apply, assert computed styles (font, size, color, padding, radius) of the cloned components match upstream. Differences are either (a) a deliberate, listed subtraction/addition, or (b) a bug.
- Latency theater on mocks: echo 0ms; first timeline activity <300ms; no >2s visual silence in any fixture scenario.

**Gate:** the audit checklist signed off; the app demos the full PRD chat experience on fixtures alone.

### FE‑7 — Backend hookup (separate stage, out of scope here)

`HttpTransport` (fetch-SSE), real auth cookies, reattach via `GET .../stream`, real sessions/feedback/config, fixture reconciliation against the backend's exported protocol fixtures, delete `harness/`. Planned with the backend-delta plan, not now. **Nothing in FE‑0…FE‑6 may import anything below the Transport seam** — that's what makes this stage a swap.

---

## 5. Risks & watch-items (frontend-specific)

| Risk | Mitigation |
|---|---|
| A stripped Recoil/context read silently changes a component's *behavior* (e.g. `centerFormOnLanding`, `maximizeChatSpace` defaults) | At vendor time, freeze each removed atom's **default value** as a constant where it was read; the fidelity audit catches visual drift |
| `~` alias collisions between vendored app files and the vendored package's self-alias | Two-alias scheme (§2) + per-directory tsconfig; verified in FE‑0 before any surface lands |
| The English-JSON `useLocalize` misses keys (renders raw `com_ui_*`) | Trim pass driven by a grep of vendored files' `localize(` calls; a dev-mode console.warn on missing keys |
| Their question-irrelevant behaviors leak through kept hooks (e.g. `useAutoSave` cache keys) | Each kept hook gets a one-line header comment naming what was stripped; mock-store keys are ours |
| Our question-anchored scroll fights vendored `useMessageScrolling` assumptions | We own scroll orchestration in FE‑3; their hook is vendored for its viewport math only — decided there, not discovered later |
| Fixture drift vs the eventual backend | Fixtures follow `architecture.md` §27 schemas verbatim; FE‑7's reconciliation against backend-exported fixtures is the contract test, and the turn reducer is the single consumer |
| `react-virtualized` is heavy/aging | Decision deferred to FE‑6 with a measurement, default = keep theirs (clone-first) |

## 6. What done looks like

A student-shaped demo: open the app logged out, hit the signup wall, register (mock), land on "Where should we begin?" with season greeting and four starter chips, ask for the NYU dossier, watch the timeline work (steps, thinking, shimmer), see the stat block land inline with citation chips, tap a chip for the popover, answer a clarify question, stop a stream, refresh mid-answer (mock reattach), rename the chat, flip to dark mode, delete everything in Data controls — all pixel-faithful to LibreChat where cloned, all Counselle where it matters, and not one byte of backend running.
