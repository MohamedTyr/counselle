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

### Not built

- **Part 2 §4, the word-count projection, was not built.** The header's word
  count was to append `· N if you accept all` whenever pending suggestions carry
  a net word delta. It shows the current count only. This is the one of the three
  gaps with a real argument for closing: a student cutting to a word limit is the
  exact case the panel exists for.
- **Part 2 §6's selection-scoped quick-action chips were not built.** The
  selection chip itself ships (`ChatComposer.tsx`'s `selectionChip`); the three
  verbs that were to replace the generic quick-action row while a selection is
  attached — "Make specific" / "Shorten" / "Show don't tell" — did not, and
  `components/ai-elements/suggestion.tsx` still has the zero importers the plan
  explicitly wanted it to stop having.
- **Part 2 §3.4's focus advance on resolve was not built.** Resolving a row in
  the pending-changes list was to move focus to the next row's Accept button.
  Resolution works; focus does not advance. (The *popover* path's focus handling,
  which returns the caret to the document, did ship.)

All three are in `TODOS.md` with their exact plan references, as deliberate gaps
for an owner to decide on rather than oversights.

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
