# Phase 6 — The dev harness (the deliberately minimal chat)

**Branch:** `feat/p6-harness`
**Objective:** the PRD's minimal web chat — one static page, vanilla JS, zero build step, consuming the v1 protocol exactly like the future platform will. Throwaway by design (`harness/`), but every MVP1 behavior must be *visible and clickable* here, because this is what the user tests.

## Inputs for builder agents
- `docs/ARCHITECTURE.md` §6 (events), §17 (viz), §12.1 (clarify), §16 (citation UX); PRD stories 13–17, 35–38, 42–50.
- The Phase 5 protocol tests (the SSE framing contract).

## Work breakdown

### Slice A — page + stream plumbing (`harness/index.html`, `harness/app.js`, `harness/style.css`)
- Served at `/harness` via FastAPI `StaticFiles`. Layout: header (session id + "new chat" + source dropdown), scrollable message list, input box. **Plain** — system font, one accent color, no framework, no design ambition (PRD: zero design effort).
- SSE consumption: POST via `fetch` + ReadableStream line parser (matches Phase 5 test 8's framing). Render `delta` text incrementally into the current assistant bubble (markdown-lite: paragraphs, bold, lists — a 30-line formatter, no library).
- `meta` → stash trace_id (shown small under each answer for debugging); `error` → red bubble with trace_id; `usage` → faint "tokens/cost" footer line per turn.

### Slice B — citations UX (PRD: inline expandable markers)
- `sources` event → registry map `n → {tier, label, citation}`.
- Post-process rendered text: `[n]` → superscript chip, colored by tier (official = blue `OFF`, community = orange `COM`).
- Click chip → popover: label, source, vintage, caveat (if any), url link (if any), raw_table (small mono). One open at a time; ESC closes. This *is* the locked citation UX — treat its look as fixed by the PRD words: clean by default, full detail one tap away.

### Slice C — the three viz components + clarify widget (`harness/viz.js`, `harness/clarify.js`)
- `viz` event mounts in stream order (ADR 0014):
  - **stat_block**: titled card, sections of label/value rows; each cell shows `display` + a tiny tier chip; `available:false` → muted "not available"; cell click → same citation popover.
  - **comparison_table**: `<table>`, schools as columns, per-cell value + chip; "not available" cells muted.
  - **score_band**: pure CSS horizontal band per row (a track div 200–800 for SAT sections / 1–36 for ACT; filled span from p25→p75 cell raw values; numeric labels at both ends). No chart library. If a band cell is unavailable → "not reported" row.
- `clarify` event → inline widget in the message list: question, 2–4 option chips with hint tooltips, **always an "Other…" free-text input**, multi-select checkboxes when `multi_select`. Selecting/submitting sends `POST …/messages {text, in_reply_to}`. Typing a normal message instead also works (the chips are a shortcut, not a modal — PRD 16): the input box stays enabled.

### Slice D — source dropdown (PRD 42–44)
- Header dropdown: Web ✓/✗, .edu ✓/✗, Reddit ✓/✗ + expandable per-subreddit checkboxes (menu fetched from a tiny new endpoint `GET /v1/meta/sources` added in this phase: returns the subreddit menu + defaults; 10-line route). DB shown as always-on (disabled checkbox, labeled "always on").
- Selection builds the `source_config` sent with every message. Persist in `localStorage`.

## Tests
- No JS test framework (throwaway code — PRD/plan: no UI-level testing). Instead: **the orchestrator's manual script** below + one Python test that `/harness` serves 200 and `GET /v1/meta/sources` matches the menu asset.

## Live verification (orchestrator walks ALL of these in a browser; then the user repeats — this phase's "Try it yourself" IS the product demo)
1. New chat → "Tell me about Duke" → streamed prose + stat block + clickable citation chips showing vintages ("IPEDS 2024-25 (provisional)" etc.).
2. "Is NYU good?" → clarify chips appear; pick "Cost & affordability" → answer follows it; repeat and instead *type* a custom reply → also works.
3. "Compare Duke and Harvard on cost and selectivity" → comparison table, per-cell chips, any missing cell reads "not available".
4. "What's Stanford's SAT range?" → score band, two SAT section bars, labels at 25th/75th.
5. Toggle Reddit off → ask a campus-vibe question → no community chips anywhere, agent states Reddit is off. Toggle on + restrict to r/ApplyingToCollege → community chips cite only that sub.
6. Ask about a 2-year college ("Santa Monica College") → graceful "not in our database".
7. Refresh mid-conversation → transcript still there (session persistence visible).
8. Kill the server during a clarify, restart, answer → resumes (ADR 0019 demo).

## Gate checklist
- [ ] All 8 walkthrough items pass for the orchestrator, then for the user.
- [ ] Every event type the protocol can emit has a visible rendering (incl. `error`).
- [ ] Markdown degradation: with JS viz disabled (`?noviz=1` flag renders specs as plain markdown tables), tables/stat blocks still readable (ARCHITECTURE §17).
- [ ] Zero console errors during the walkthrough.

## Milestone commit
```
feat(harness): minimal dev chat — stream, expandable citations, 3 viz, clarify widget, source dropdown

Throwaway client of the v1 protocol (ADR 0016); citation UX per PRD
(inline markers, official/community chips, tap-to-expand).
```
