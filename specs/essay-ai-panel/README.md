# Essay AI panel

An AI panel that works on one essay: it already has the draft, the prompt, the
school, the word limit and the student's current selection, it proposes concrete
edits rather than answering admissions questions, and every edit it proposes is a
tracked change the student accepts or rejects.

One plan, in three parts, in the order they were built.

| File | What it built |
|------|---------------|
| [`plan/implementation-plan.md`](plan/implementation-plan.md) Part 0 | The binding contract — ten corrections (C1–C10) that override the three parts wherever they disagreed with each other or with the live tree. Read this before the parts; several of them describe the implementation and the part they correct does not. |
| Part 1 | The backend: the per-turn `Surface(chat\|essay)`, the essay system prompt asset and its code-built context block, the tool profile, suggest-mode writes and the `essays.suggestions` shape, the accept/reject API, per-essay chat sessions, and the four new skills. |
| Part 2 | The editor: tracked-change decorations, the hover popover, the keyboard model, the pending-changes bar, serialized non-optimistic resolution, and the panel's layout and focus rules. |
| Part 3 | Chat-surface reuse: `AiChatPage` in a narrow variant instead of a second chat, the shared `EssayDocumentSurface`, the main chat's document panel, and the mutation receipt as a door into it. |

The graduated architecture description lives in `docs/ARCHITECTURE.md` §39 and
ADR 0037 (which amends ADRs 0013 and 0030). This plan is a historical record and
is not retro-edited.

## Where it diverged from the plan

Recorded here because the plan itself is a historical record and is not
retro-edited.

### Not built at first pass, closed later (2026-09-07)

Three plan requirements shipped after the panel itself did. They are recorded
here because the shape they landed in is not the shape the plan drafted.

- **Part 2 §4, the word-count projection**, now appends `· N if you accept all`
  to the header. **It does not use the plan's arithmetic.** The plan summed
  `countWords(new_text_plain) - countWords(old_text_plain)` over the pending
  rows, and that number can be wrong twice over: `resolve_all_suggestions`
  applies each change to the result of the last one, so a change overlapping one
  already applied is *skipped* rather than added; and `countWords` counts runs of
  non-whitespace, so a change can merge or split words at its own edges while
  counting none of its own (deleting the one space in "a b" loses a word;
  `countWords(" ") - countWords("")` is zero). `word-projection.ts` instead
  rebuilds the text the student would be left with, in the same string space the
  header already counts, and counts it — and returns nothing at all where that
  text is not knowable (a change spanning a paragraph break, overlapping anchors,
  an anchor it cannot re-find, or its own reading of the document disagreeing
  with the count already on screen). Verified live: a 52-word essay with three
  seeded changes projected 45, and the server's own `word_count` after accept-all
  was 45 — reached both in one bulk accept and one change at a time.
- **Part 2 §6's selection-scoped quick-action chips** now render under the
  selection chip. Two departures. The plan said the row "swaps from generic
  suggestions" — there was no generic quick-action row in `ChatComposer` to swap,
  so the chips are purely additive and appear only with a selection attached. And
  the verbs are the ones `EssayPanelEmpty` already shipped ("Make this more
  specific" / "Tighten this" / "Show, don't tell"), not the plan's drafted
  "Shorten" — one list now lives in `essay-quick-actions.ts` and both surfaces
  read it, because two lists of the same three offers would drift the moment
  either was reworded.
- **`components/ai-elements/suggestion.tsx` was deleted, not adopted.** The plan
  named it as the component this row would finally give a caller. It does not
  fit: it wraps shadcn's Radix `ScrollArea`, and this repo's `ui/scroll-area.tsx`
  is a Base UI rewrite with a different contract (a `size-full` root that renders
  its own scrollbars), so `Suggestions` would have stretched to its parent's
  height and left a stray `ScrollBar` inside the content. Its `Suggestion` half
  was a `Button` wearing `rounded-full px-4`, a shape `DESIGN.md` §5 reserves for
  avatars, dots and tracks. Both halves would have been overridden more than
  used, so the chips are a plain `Button` row and the file is gone.
- **Part 2 §3.4's focus advance on resolve** now moves focus to the row that took
  the resolved one's place, the row above it when the last one goes, the
  disclosure, or — when the bar itself is leaving — back into the document. Two
  things the plan did not anticipate. It arms only when focus was genuinely
  inside the bar, because a pointer click never focuses these buttons at all
  (`ResolveButtons` prevents the mousedown default so accept cannot pull the
  caret out of the essay), so the mouse path needs nothing. And it fires on the
  resolved row *leaving the list*, not on the resolving lock clearing: those two
  arrive in **separate renders** — the query cache notifies on its own schedule —
  and a first pass keyed on the lock alone read the not-yet-updated list, called
  a successful accept a failure, and dropped focus to `<body>`. That was caught
  in a real browser, not by the tests.

Measured in-browser for all three: the projection against a hand-verified 45; the
chips at a true 8.00px gap, 32px tall on desktop and wrapping cleanly at 375px;
and `document.activeElement` after every resolve edge (mid-list row, last row,
list-emptying row, accept-all, reject-all) — never `<body>`.

### Re-architected during implementation

- **The hover mechanism is plugin state, not a DOM attribute.** Part 2 §2.1/§3.2
  specified that hovering one fragment of a change writes
  `data-suggestion-hovered` onto every fragment sharing its id, so a plain
  attribute-selector CSS rule highlights the group. That approach **hangs the
  editor**: mutating attributes inside ProseMirror's managed DOM is treated as
  external interference, and the resulting `DOMObserver` redraw loop is
  unbounded. The shipped version keeps `hoveredId` in the plugin's own state and
  re-renders the decorations through ProseMirror's own pipeline. Worth noting for
  the next person: this was **invisible to jsdom** — the tests passed against the
  broken mechanism, and the loop only exists in a real layout engine.
- **The editor panel's dock threshold moved from 1024 to 1280.** Part 2 §5.2
  recommended a `Sheet` below `lg:` (1024px). Reserving 380px of panel out of a
  narrower column left the essay at roughly 19 characters a line, which is not a
  readable measure, so the panel covers the document below 1280 instead of
  splitting it. (That threshold is still keyed to the viewport rather than to the
  container — see `TODOS.md`.)
- **The main chat's document panel docks on a measured row, not on a
  breakpoint.** Part 3 §5 attached it at `lg:` the way `SourcesRail` attaches.
  The workspace sidebar is 340px expanded and 48px collapsed, so the same 1280px
  viewport falls on both sides of any viewport breakpoint — and the wrong side
  silently truncated the essay with no scrollbar to recover it. The shipped panel
  observes its own row's width against a 1000px floor and falls back to a
  full-width `Sheet` below it.

### Added after the plan

- **`PendingChangesReadout` is not in the plan at all.** It was added after a
  live incident: the agent told a student "I have proposed a suggestion — take a
  look at your panel" on a turn where it made no edit tool call, and nothing on
  screen contradicted it, because the pending-changes bar unmounts at zero — the
  one state the claim was false in was the one state with no surface. The fix is
  a code-owned band, mounted on both surfaces that host an essay conversation,
  sourced from the server's essay record rather than the message stream, and
  honest at zero as loudly as at N.

  Two things about it are deliberate and should not be "simplified" later.
  First, `countPendingChanges` is a shared function rather than arithmetic in
  each component, because the first version was not: the band printed
  "3 waiting" directly above the bar's "Counselle proposed 2 changes", and an app
  that visibly disagrees with itself has spent the exact credibility this band
  exists to hold. Second, **it is not a validator.** It does not inspect,
  classify, gate, rewrite or retry anything the model says. This repo removed its
  programmatic answer-validation layers on purpose, and the two levers used here
  — prompt hardening and provenance display — are the sanctioned ones. ADR 0037
  records the constraint.
- **The essay prompt gained an explicit "an edit exists only when the tool says
  it does" section**, along with a matching paragraph in `counselor.md` for the
  same tools in the main chat, from the same incident. Part 1 §2.3's drafted
  prompt had a "Suggestions, not silent edits" section that said what the panel
  does; it did not pin the *order* — call the tool, read what came back, report
  only that — or give the model a non-embarrassing script for the not-yet-edited
  case, which is what a finished-sounding false claim is written to avoid.
