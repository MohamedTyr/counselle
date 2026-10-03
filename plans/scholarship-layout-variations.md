# Scholarship layout variations

Owner request: replace the enclosing scholarship card with several distinctly
different layouts, retaining the Beams design system. The owner selected Award tiles on 2026-10-02. The scholarship page now uses
the polished card layout. The `/dev/scholarships` comparison gallery ran on mock
fixtures and was not carried onto `feat/scholarships`; it survives in the
`card-redesign backup` stash.

## Directions

- **Open list:** generous rows directly on the canvas; aligned award and date columns.
- **Award tiles:** individual horizontal tiles in a two-column layout; award and
  application requirements get their own hierarchy.
- **Deadline agenda:** a date rail with individual opportunities grouped by deadline.
- **Compare:** a compact, borderless comparison table with explicit requirement columns.

All use existing semantic colors, Geist, sponsor logos, scholarship formatting,
search and detail components. The owner's request deliberately explores beyond
DESIGN.md §17.2's original single raised list panel. That section now records
the selected independent card layout. The development gallery uses the existing illustrative
fixtures and labels them as such. Saving is session-local in this preview.

## Verification

Check each layout at desktop and mobile widths, long scholarship names, search,
no-results state, no-essay filtering, saved filtering, keyboard navigation,
detail opening/closing, reduced motion, and text contrast. Run typecheck and
the existing scholarship tests; review changed code.

## Results

- Live preview: `http://localhost:5175/dev/scholarships` with shareable
  `?layout=open|tiles|agenda|compare` choices.
- Browser checked all four layouts at 320, 390, 768 and 1440px: no content overflow.
- Each layout passed search/no-results recovery, no-essay filtering, saving,
  Saved filtering, detail opening, Escape dismissal and focus restoration.
- Keyboard Enter opens the detail. Reduced motion removes its translate and
  transition, including the portaled backdrop. No layout entrance animation.
- Main text tokens measured at least 7.75:1 on the inset surface and 8.81:1
  on white. Ink and deadline-warning text exceed those values.
- Typecheck, scoped ESLint, diff whitespace check and all 13 existing scholarship
  eligibility tests passed. Code review has no remaining actionable findings.
- Full frontend tests were attempted and interrupted after reporting five failures
  in SchoolsRoute, AddSchoolDialog, SchoolWorkspace, TasksLayout and ExplorePanel.
  Those tests are outside this change; their baseline was not established here.
  The full suite is not claimed green.
- Eight desktop/mobile screenshots and the broad test log are local artifacts in
  `artifacts/scholarship-variants/`. Physical devices, Safari, Firefox and assistive
  technology were not tested.


## Selected cards — 2026-10-02

The actual `/app/scholarships` route and Award tiles preview share one card
component. Individual cards use Beams surfaces, 12px corners, sponsor identity,
a short summary, distinct award and deadline columns, and application requirements.
Cards form two columns when their container has enough room, then one column.
A dedicated save toggle is separate from the full-card details action.

Details open in the existing Sheet at every width. The page no longer auto-opens
a scholarship or reserves a permanent detail column. Keyboard shortcuts apply only
while a card control has focus; Enter/Space open details. Closing returns focus to
the activated button, including pointer activation without browser focus. If a saved
card disappears, focus returns to the result count. Missing deadlines are distinct
from rolling deadlines. The favicon fallback improvements remain in place.

Verification:

- 23 focused tests passed across card behavior, sponsor logos, and eligibility.
  Typecheck, scoped ESLint and whitespace checks passed.
- Chromium browser checks passed at 320, 390, 768 and 1440px with no page overflow.
  Checked For you, All, Saved, closed cards, search/no-results recovery, whole-card
  clicks, independent saving, keyboard navigation, Escape, and focus recovery.
- Touch emulation measured save targets at 44×44px. Reduced motion removes Sheet
  movement; forced colors retain the 2px focus outline.
- Browser axe check passed with color-contrast excluded: that installed scanner
  reports NaN for the design system's color format. Separate browser canvas color
  measurements found card text contrast of 8.81:1–18.71:1 against the card surface.
- Code review has no remaining blockers. Browser checks used mocked authentication
  and the branch's existing scholarship fixtures; backend integration was not tested.
- Screenshots, browser script/results, and check logs are in
  `artifacts/scholarship-cards/`. No physical device or screen reader verification.
  WebKit could not launch because its system libraries are unavailable.
- The earlier full-suite failures above remain outside this pass; only the focused
  checks are claimed green. Implementation awaits the owner's visual acceptance.
