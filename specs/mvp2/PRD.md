# Counselle — MVP2 PRD: The Full-Stack App

> **Status:** MVP2 scope drafted 2026-06-11 (product level — the WHAT). The HOW (frontend stack, auth provider, exact protocol schemas) is deliberately not decided here; it comes in the MVP2 architecture/planning pass, same as MVP1's flow (PRD → architecture → ADRs → plan).
>
> **Relationship to MVP1:** MVP1 built the agent and proved it (PRD stories 1–38, 42–58 implemented; deep research 39–41 deferred to `specs/deep-research/plan.md`). MVP1 was deliberately **API-first** (ADR 0016 — every frontend is a client of the versioned SSE protocol) with **durable sessions** in Postgres carrying a nullable `user_id` waiting to be used (ADR 0019). MVP2 is therefore mostly **a real client + an identity layer + chat management + protocol extensions for work visibility**. The agent itself — the honesty machinery, the tools, the citation envelope — ships as-is.
>
> **MVP2 in one line:** take the MVP1 agent and wrap it in a ChatGPT-grade product — accounts, a persistent chat workspace, and a chat experience that finally does justice to the dossiers, comparisons, citations, and clarifying questions the agent already produces.

---

## Problem Statement

MVP1 proved the agent but shipped it on a deliberately throwaway dev harness: no accounts, no chat history a student can return to, and a rendering of the agent's output (dossiers, comparison tables, score bands, citations, clarifying questions) that demos the behavior without doing it justice. A student can't *use* Counselle today — they can only watch it work in a developer's sandbox.

Meanwhile the agent's most differentiating qualities are invisible in a bare chat surface: the work it does (database queries, .edu reads, Reddit checks), the provenance of every number, and the official-vs-community tiering all exist in the protocol and the envelopes but have no product expression worthy of them.

MVP2 closes that gap: a full-stack app a real student logs into, with the smoothest chat experience we can build, where the agent's honesty and its visible work *are* the product's look and feel.

## Solution

A ChatGPT-shaped web app over the MVP1 agent service:

1. **Auth** — signup/login (email + Google), the moment `user_id` stops being nullable in practice.
2. **A home screen** ("Where should we begin?") with a season-aware greeting and starter prompts that teach what the agent can do.
3. **The chat page** — the core of MVP2. Streaming answers with a live activity timeline (reasoning, tool calls, web searches), inline cited data cards, the clarifying-question widget, and a citation system rendered as a first-class visual grammar.
4. **Chat management** — a sidebar with history, search, auto-titles, rename, delete.
5. **Settings** — deliberately thin (no memory in MVP2): theme, default sources, account, data controls.
6. **A single static marketing landing page** as the logged-out front door.

Everything below the UI ships from MVP1 unchanged except the explicitly listed backend delta (§ Backend Delta).

---

## User Stories

### Auth & identity

1. As a student, I want to sign up and log in with email + password, so that my chats persist across visits and devices.
2. As a student, I want one-tap **Google sign-in** — students live in Google; this matters more for this audience than almost any other feature in MVP2.
3. As a student, I want a forgot-password flow (email reset), so that a lost password isn't a lost account.
4. As a student, I want signup to ask for nothing beyond name + email — no email-verification ceremony, no 2FA, no profile wizard — so that I'm asking my first question within seconds.
5. As the operator, I want every chat owned by a user (`user_id` populated on all new sessions), so that history, settings, and rate limits attach to a person.

### The front door

6. As a visitor, I want a single static marketing landing page — what Counselle is, one screenshot of a dossier, a sign-up CTA — so the product has a front door. One page, nothing more.
7. As a visitor, I hit a **signup wall** before chatting (MVP2 decision; guest "try one question" mode is deferred to a growth phase — it converts better but exposes anonymous Gemini/Tavily cost).

### Home screen (the "Where should we begin?" moment)

8. As a student, I want a greeting that uses the admissions calendar the agent already computes — in June: "It's list-building season — where should we begin?"; in October: something deadline-aware — so the app feels like a counselor who knows what month it is (free product personality from MVP1 story 29).
9. As a student, I want a big centered composer and **starter prompt chips** that teach the agent's signature capabilities, one per capability: "Give me the full profile on NYU" (dossier), "Compare Duke and Vanderbilt on cost" (compare), "Public schools in California under a 30% admit rate" (find/filter), "What does it cost if my family makes $60k?" (money).
10. As a user, I want the **source-control dropdown on the composer** (web / .edu / Reddit toggles, per-subreddit allowlist under Reddit, the database always-on and shown as such), set per request, **sticking for the conversation**, changeable any time — the product shape of MVP1's per-request source config (stories 42–44).

### The chat page — turn lifecycle

11. As a student, I want my sent message to appear **instantly** (optimistic echo at 0ms), the composer to clear, and the viewport to scroll once so **my question sits at the top of the screen** with the answer filling downward into stable space — never a page chasing its own bottom.
12. As a student, I want visible agent activity within ~200–300ms of sending — never a frozen spinner, never dead air. The agent's actual work *is* the loading state.
13. As a student, I want a live **activity timeline** while the agent works: each step one line with a source icon (database cylinder / globe for web / graduation cap for .edu / subreddit chip for Reddit) and a **human label** — "Looking up NYU", "Querying the database: admissions & cost fields", "Searching the web: *nyu cs acceptance rate 2026*", "Reading admissions.nyu.edu", "Checking r/nyu" — with an animated shimmer on the active step and a check when done.
14. As a student, I want short **reasoning summaries** interleaved in the timeline as muted text lines ("The database covers admissions, but this year's deadline needs the live site"), so I see *why* the agent takes each step.
15. As a student, I want any timeline step expandable on tap to full receipts: the actual query, domains hit, result count, fields fetched — full transparency one tap deep.
16. As a student, I want the timeline to **collapse to a one-line receipt when the answer completes** — "Used the database, nyu.edu, and r/nyu · 7 steps · 12s" — expandable forever. The work never disappears; it gets out of the way.
17. As a user, I want a disabled source to be **impossible to appear in the timeline**, so the source-control toggle is visibly real (MVP1 story 44 made tangible).
18. As a student, I want the answer to stream as progressively rendered markdown — stable block identity, no flicker as half-formed syntax completes, a soft caret at the stream edge, no typewriter gimmicks beyond real token arrival — with body text at a ~68ch reading measure, so an answer reads like a counselor's letter, not a wall.
19. As a student, I want citation chips to materialize inline **as the text streams**, not appended afterward.
20. As a student, I want visualization cards to land **inline in the prose flow at the point the agent invokes them** (never a side panel): the announcing timeline step triggers a correctly-sized skeleton card; data fills with a ~200ms fade; text already on screen never reflows.
21. As a student, I want each completed answer to end with a grouped **Sources footer** (official block and community block, each entry with its vintage) and an action row: copy, regenerate, thumbs up/down.
22. As the operator, I want thumbs up/down wired to a feedback endpoint feeding the **eval set**, so user feedback is an engineering instrument, not decoration.

### The chat page — clarifying questions

23. As a student, I want the clarifying widget inline in the stream where the agent paused: the question, 2–4 tappable chips with hint sublabels, and "Other" expanding to a free-text field (MVP1 stories 13–17 rendered properly).
24. As a student, I want the composer placeholder to switch to "Pick one, or just type…" while a clarifying question is open — because **typing is answering**; the chips are a shortcut, never a modal (MVP1 story 16).
25. As a student, I want a tapped chip to instantly become my next message bubble and the turn to resume; afterward the widget **freezes into a record** of what was asked and chosen, so the transcript stays honest.

### The chat page — citations

26. As a student, I want inline citation chips with the official/community visual grammar: official = cool accent, community = warm — used identically everywhere (chips, timeline steps, cards, sources footer). Squint-test: I always know which kind of claim I'm reading.
27. As a student, I want tapping a chip to open an **anchored popover** (not a modal): source name, vintage ("IPEDS 2024-25 provisional"), caveat, link. Keyboard-reachable, Esc closes, screen-reader labeled.

### The chat page — the cards

28. As a student, I want the **dossier stat block** to be the best-looking thing in the app (it's the wedge): a school header (name, location, **CDS-depth badge phrased honestly**: "Deep data · CDS extracted" vs "Standard data · IPEDS + Scorecard"), then sections — Admissions, Cost & Aid, Outcomes, Academics, Student Body — each a label/value grid; every value carries its citation chip; long dossiers get collapsible sections with a sticky mini-nav; all numbers in tabular figures.
29. As a student, I want "not available" rendered as a **designed muted state** — never an empty cell, never papered over (MVP1 stories 10, 21).
30. As a student, I want the **comparison table** with a sticky first column (the dimension), schools as columns, horizontal scroll past two schools, and **per-cell citations on tap** (popover — hover doesn't exist on phones); "not available" cells visibly distinct from zero.
31. As a student, I want **no winner-highlighting** in comparison tables — the table doesn't editorialize; honesty expressed as restraint.
32. As a student on a phone, I want the comparison table to adapt structurally (two columns side-by-side with a school switcher, or stacked dimension pairs) — never a pinch-zoom desktop table.
33. As a student, I want the **SAT/ACT score band** as a horizontal range visual per section (EBRW and Math separately — never summed to a fabricated 1600; ACT composite directly), the middle-50% band filled, 25th/75th labeled, with the permanent teaching caption: "Half of enrolled students scored inside this band. It's not a cutoff." — the card teaches the concept by its anatomy (MVP1 stories 27, 47).
34. As a student, I want **community cards** to be a different *voice*, not a different decoration: quote-styled, subreddit chip, warm tint, permanent label "Community voice — experiences, not statistics"; never a number presented as data, never chart-shaped (MVP1 stories 33, 49).
35. As a developer, I want the card renderer **forward-compatible**: an unknown card type degrades to the markdown fallback (MVP1's degrade rule, kept in MVP2's renderer), so future cards — deep research's included — can never break an older client.

### The chat page — smoothness guarantees

36. As a student, I never wait more than ~2 seconds without a visible **state change** somewhere on screen.
37. As a student, my scroll always wins instantly: streaming never fights my scroll position; a "↓ Latest" pill appears when I'm detached; completion never yanks the viewport.
38. As a student, I can **stop** a streaming answer at any moment (send button becomes stop); sending a new message mid-stream stops and re-asks; all animations are interruptible.
39. As a student, **refreshing mid-answer never breaks the chat**: the page reconnects to the in-flight stream or lands on the completed transcript. A chat must be unbreakable by F5.
40. As a student with the same chat open in two tabs (or on two devices), I want sanity, not corruption: **one active stream per chat**; other tabs show a "generating…" indicator on that chat in the sidebar and catch up from the transcript when it completes.
41. As a student, I want to **never lose a typed word**: composer drafts persist per chat; a failed send keeps my text in the composer with an inline retry.
42. As a student with a long chat, I want a virtualized message list, lazily mounted cards, and per-chat scroll restoration, so old conversations open instantly and scroll at 60fps.
43. As a student, nothing that arrives later may move what I'm already reading: every async element reserves its space first (skeletons sized before data). CLS ≈ 0 is a product requirement.
44. As a student with reduced-motion preferences, I want shimmer and transitions to respect `prefers-reduced-motion` fully.
45. As a student on a phone, I want 44pt+ touch targets on chips and cells, the composer pinned above the keyboard, and real responsive card variants (not shrunk desktop).

### Chat management (sidebar)

46. As a student, I want a sidebar with **New chat**, **Search chats** (title search is enough), and my history grouped by recency (Today / Yesterday / Previous 7 days / older).
47. As a student, I want chats **auto-titled** from the first exchange (cheap-tier model), renameable, and deletable with a confirm.
48. As a student, I want the sidebar to collapse on small screens, with the user card at the bottom leading to settings and logout.

### Settings (deliberately thin — no memory in MVP2)

49. As a user, I want a settings modal (ChatGPT-style) with exactly three sections:
    - **General:** theme (light / dark / system), **default source-control preset** (so a user who never wants Reddit doesn't toggle it every chat).
    - **Account:** name, email, change password, connected Google account.
    - **Data controls:** delete all chats, delete account.
    No profile fields, no memory toggles, no personalization — those arrive with the platform phase.

### Operator / developer

50. As the operator, I want **per-user rate limiting** — MVP2 is the first time strangers can spend the Gemini/Tavily budget.
51. As the operator, I want the SSE protocol extended with granular **work-visibility events** (see Backend Delta) so the activity timeline renders real work, not theater.
52. As a developer, I want the deferred deep-research feature to have UI room reserved: the timeline/streaming treatment must extend naturally to a long-running "researching…" phase when `specs/deep-research/plan.md` lands — design for it, don't build it.

---

## The Chat Experience Spec (the centerpiece — design intent in full)

### The five laws of the page

1. **Never a silent moment.** From the instant a question is sent, something truthful is always visibly happening. No frozen spinners, no dead air — the agent's actual work *is* the loading state.
2. **The work is the trust.** Reasoning, tool calls, and searches aren't debug output — they're the product's honesty made visible. A student watching "Reading admissions.nyu.edu…" learns the answer is grounded before reading a word of it.
3. **Layout never jumps.** Nothing that arrives later may move what the student is already reading. Every async element reserves its space first. CLS ≈ 0 is a feature requirement, not a perf metric.
4. **The chat is always a chat.** Nothing blocks the composer — not streaming, not a clarifying question, not an error. Typing always works; stopping always works.
5. **Honesty has a visual grammar.** Official vs community is a *color-and-shape system* used identically everywhere — citation chips, timeline steps, cards, sources footer.

### Anatomy of one turn

| Phase | What happens |
|---|---|
| **T+0ms — echo** | User message renders optimistically; composer clears; one scroll puts the question at the top of the viewport; the answer fills downward into stable space. No continuous auto-scroll. |
| **T+~200ms — timeline** | The activity strip appears, live and expanded: steps stream in with source icons + human labels; shimmer on the active step; reasoning summaries interleave as muted lines; every step expandable to receipts (query, domains, result counts, fields). |
| **Streaming prose** | Incremental markdown rendering; stable block identity; no flicker on half-formed syntax; soft caret at the stream edge; citation chips materialize inline as they stream; ~68ch measure. |
| **Inline cards** | The announcing step triggers a correctly-sized skeleton in the prose flow; data fills with a ~200ms fade; text above never reflows. |
| **Completion** | Timeline collapses to its one-line receipt; Sources footer (official / community blocks, vintages); action row (copy, regenerate, thumbs); usage stays hidden from students. |

### Latency theater budget

- Echo: 0ms (optimistic).
- First visible agent activity: < 300ms.
- Maximum time without a visible state change: ~2s.

### Error and edge states

- Stream error → inline error card with a retry that re-asks.
- "Not in our database" → a designed honest card, not plain text (MVP1 story 5 given a real treatment).
- Empty states teach the interface (the home screen's starter chips are the canonical example).

### Motion rules

150–250ms, ease-out, transform/opacity only; shimmer only on genuinely active steps; no decorative or orchestrated motion; everything interruptible; full `prefers-reduced-motion` support.

---

## Visual Direction

**Register:** product (the tool disappears into the task). The design-system tooling's reflex suggestion of a playful/kids direction ("education" → Comic Neue/Baloo) was explicitly rejected — Counselle's user is a 17-year-old making the highest-stakes decision of their life so far; the register is **trust, not playfulness**.

**Scene sentence (theme decision):** *a 17-year-old on her phone at 11pm anxiety-scrolling about deadlines, and the same kid on a school Chromebook at noon* — so **both themes are real**: default to system preference, both light and dark designed deliberately, contrast verified independently per theme.

**Color:** Restrained strategy. Neutrals tinted toward the brand hue (never pure #000/#fff). **One cool accent owns "official"; one warm hue owns "community"** — that semantic axis *is* the brand, and it is the only place color carries meaning. Accent otherwise reserved for primary actions and state.

**Typography:** one well-tuned sans (Inter or the system stack) carrying everything; fixed rem scale (product UI, not fluid); **tabular numerals for all data, everywhere**; ~68ch prose measure; density allowed inside cards, air around prose.

**Bans (from the design laws):** gradient text, glassmorphism-as-default, side-stripe accent borders, hero-metric templates, identical card grids, winner-highlighting in comparisons, emoji-as-icons, anything that looks like a default template.

---

## Backend Delta (the only changes to the MVP1 service)

The user-facing app requires these extensions; everything else ships as-is.

1. **`step` events in the SSE protocol** — start/end per tool call with kind (db tool / web search / .edu search / Reddit search / SQL / skill), a human label, and an expandable detail payload — emitted from the agent loop (PydanticAI tool hooks / graph nodes). The single biggest enabler: today's protocol (`meta`/`delta`/`viz`/`clarify`/`sources`/`usage`/`done`/`error`) has no granular work visibility.
2. **`thinking` events** — short reasoning summaries between steps.
3. **Stream resume + cancel** — reconnect semantics (Last-Event-ID replay or transcript catch-up) and a stop endpoint.
4. **Auth + users** — accounts (email + Google), sessions owned by users (`user_id` populated; ADR 0019 anticipated this).
5. **Chat CRUD API** — list / rename / delete / search, plus **auto-titling** on the first exchange (cheap tier). The conversations themselves are already persisted by the LangGraph Postgres checkpointer.
6. **Message-feedback endpoint** (thumbs) wired toward the eval set.
7. **Per-user rate limiting.**

## Ships As-Is from MVP1

The agent and all its honesty machinery: the citation envelope and normalization engine (R1–R12), field discovery, the counselle-db service/MCP layers, Tavily search tools and source-control enforcement, the clarify spec, the viz render-spec contract (model picks shape, tool fetches numbers), season/temporal awareness, skills, sessions/checkpointing, the eval runner.

## Every MVP1 Capability and Where It Lives in MVP2

| MVP1 capability (PRD stories) | MVP2 surface |
|---|---|
| Dossier (1–5) | Dossier stat block card — the flagship component |
| Honest answers (6–12) | Message rendering + citation grammar + "not available" states |
| Clarifying questions (13–17) | Inline chips widget; composer stays live; frozen record after |
| Compare & find (18–21) | Comparison table card; no winner-highlighting; NA cells distinct |
| Majors, money, outcomes (22–26) | Dossier sections + prose + per-value citations |
| Test scores & season (27–31) | Score-band card; season-aware home greeting; live-date answers |
| Reddit community voice (32–34) | Community cards (warm tier); subreddit steps in timeline; per-subreddit toggles |
| Citations & trust (35–38) | Inline chips + popovers + sources footer + vintage everywhere |
| Deep research (39–41, deferred) | UI room reserved in the timeline treatment; not built |
| Source control (42–44) | Composer dropdown; sticks per conversation; enforced absence from timeline/citations |
| Visualizations (45–50) | The three inline cards, skeleton-first, numbers never via the model |
| Conversation & session (51–52) | Durable owned chats; the activity timeline is story 52's "visible reasoning steps" fully realized |
| Operator stories (53–58) | Unchanged; plus rate limiting and feedback→eval |

## Decisions Made in This PRD (locked)

1. **Signup wall, no guest mode** in MVP2 (guest "try one question" deferred to a growth phase — better funnel, but anonymous cost exposure).
2. **One static marketing landing page** — what Counselle is, one dossier screenshot, signup CTA. Nothing more.
3. **Mobile-first design** for the hard components (dossier card, comparison table) — students are on phones, even if demos are on desktop.
4. **No message branching.** Editing an old message truncates the chat after it and re-asks — no ChatGPT-style conversation trees.
5. **The activity timeline is live theater during generation only**; on revisiting an old chat it renders as the collapsed receipt by default.
6. **Auth is minimal:** email + password + Google OAuth + password reset. No email-verification ceremony, no 2FA, no profile wizard.
7. **Settings are thin** (three sections; no memory/personalization fields) until the platform phase.
8. **Question-anchored scrolling** (sent message pins to top; answer fills downward) over bottom-chasing auto-scroll.
9. **Cards are inline in the prose flow** — never a side panel.
10. **Thumbs feedback feeds the eval set** — feedback is an engineering instrument.

## Out of Scope (deferred, deliberately)

### Parked for MVP3 (from the gap pass, 2026-06-11)

- **Suggested follow-up chips** — 2–3 contextual follow-ups generated by the agent at `done` ("Compare this with BU", "What about aid for internationals?").
- **School-name autocomplete in the composer** — typeahead over the ~2,746 in-database institutions, fed by the existing resolve-school data; also makes "not in our database" tangible before sending.
- **Designed rate-limit / outage UX states** — the kind, honest limit message with reset time and the provider-outage treatment. (Rate limiting itself ships in MVP2 with a plain generic message.)
- **Thumbs-down reason chips** — *wrong number · outdated · didn't answer · too generic*, making feedback consumable by the eval set. (Plain thumbs ship in MVP2.)
- **Power-user keyboard layer** — Esc to stop, Cmd+K chat search, focus management beyond composer basics. (Enter / Shift+Enter is table stakes and ships in MVP2.)

### Considered and rejected in the gap pass (2026-06-11)

First-run micro-tooltips/activation steering; source-degradation honesty notices (a failed search step gets no special answer-level treatment); thin-data dossier section collapse; Terms/Privacy/minimum-age work beyond defaults; a turn-latency target + cheap-model fast path for simple questions (live with full-graph latency); dossier/comparison PDF export; operator analytics.

### Standing deferrals

- **Memory / personalization** — no stored profile, no cross-session memory (platform phase).
- **Chancing, essay/activity writing, deadline tracking / process management** — still the "doing" layer (MVP1 deferrals stand).
- **Deep research** — own follow-up (`specs/deep-research/plan.md`); MVP2 only reserves UI room for it.
- **Guest mode** — growth phase.
- **Chat sharing links** — later.
- **Billing / plans / quotas beyond rate limiting** — later.
- **Admin dashboard** — later.
- **Native mobile apps** — the web app is responsive; native is later.
- **Branching conversations** — locked out (decision 4).
- **2FA, email verification, SSO beyond Google** — later.

## Process Notes for the Build Phase

- Before any frontend code: run `$impeccable teach` + `$impeccable document` to create **PRODUCT.md** and **DESIGN.md** (neither exists yet — confirmed by the context loader 2026-06-11), so the design context and tokens are locked before pixels.
- The MVP2 architecture pass decides the HOW: frontend stack, auth implementation, protocol schema details, rate-limiting mechanism — none of it is decided in this PRD.
- MVP1's testing philosophy carries over: test where lying to a student is possible; the eval set remains the agent-level harness; UI testing scope is an architecture-pass decision.

## Documentation Map

| Document | What it holds |
|---|---|
| `specs/mvp1/PRD.md` | MVP1 PRD — the agent (stories 1–58, decisions, deferrals) |
| `specs/mvp2/PRD.md` | This document — the full-stack app over the agent |
| `docs/ARCHITECTURE.md` | MVP1 system design; to be extended in the MVP2 architecture pass |
| `docs/adr/` | Architectural decisions; MVP2 will add its own (frontend stack, auth, protocol v2) |
| `specs/mvp2/` | The MVP2 architecture pass (done 2026-06-11): `specs/mvp2/architecture.md` (the HOW spec) + ADR drafts 0020–0023; plan files under `specs/mvp2/plan/` |
| `specs/deep-research/plan.md` | The deferred deep-research follow-up |
