# SAT Practice — UI/UX specification

Companion to `plan.md` (§7). Information architecture, the control set and every interaction
are liprep's — `parity-inventory.md` is their source. This file specifies the *material*:
how those things are built from Counselle's design system (`DESIGN.md`, cited as D§n) so an
engineer can build it with no designer in the loop.

Method: /impeccable `shape`, product register (design serves the task); /better-ui for
detail. **Where better-ui and DESIGN.md disagree, DESIGN.md wins** (§9).

---

## 1. Scene, register, principles

*A junior at a desk after school, laptop open for a forty-minute drill, one question at a
time, anxious about pace.* → light theme, no decoration, the question is the only object on
screen, feedback immediate and unambiguous, numbers legible at a glance.

Colour strategy: **restrained** — tinted neutrals, the brand as the single accent (the one
primary action per screen), a status hue only where a state is claimed.

What liprep's skin carried that ours does not, and why that is not a product change:
navy/gold retro chrome, IBM Plex, blob SVGs, cosmetic module icons, hover scaling and
floating-blob animation (X3, X5). The brief says "with our design system".

---

## 2. Colour (D§2 Law 2: a hue makes one claim; D§3.1: never a brand tint beside a success tint)

| liprep | What it means | Here |
|---|---|---|
| green ✓ / red ✕ | correct / incorrect — a state | `--success-*` / `--danger-*`, always with icon **and** word (D§14.3) |
| green / amber / coral difficulty (three unrelated palettes across dashboard, navigator and pace matrix) | an **ordered** scale, not a state | **one neutral encoding everywhere**: the band number, the tier word (Easy / Medium / Hard), and where space is tight a 1 / 2 / 3-segment ink tick (`--ink-secondary`). No hue: the navigator and the analytics rows put difficulty beside status hues, and D§3.1 forbids a brand tint beside a success tint (their pale ends measure 1.04:1). One datum, one visual language — a deliberate divergence from liprep, recorded |
| amber bookmark | marked for review — not a warning | ink icon; outline = off, filled = on (one SVG, fill marks active) |
| ● amber "upsolved" | correct after a miss | success hue, distinct glyph (`RotateCcw`), the word in the legend and the accessible name |
| indigo EBRW / orange Math | two categories — and upstream uses the pair **only inside the analytics modal**; the dashboard cards and the practice screen carry no section colour | no hue (D§15.5: series are never told apart by decorative colour). Section = a `Badge secondary` ("EBRW" / "Math"), position, and in charts shape and stroke (§7) |
| donut: green / amber / red | never-missed / upsolved / **latest attempt incorrect** | `--success-solid`; `--success-solid` with a dot pattern at full strength (no opacity derivation, D§11.5); `--danger-solid` — the same claim as ✕. Unattempted questions are not in the donut |
| mastery chip: green / amber / red / grey | an **ordered** reading of first-try accuracy | Mastered → `Badge success` ("ready" is a real state). Developing, Needs focus, Untested → `Badge secondary`: practising at 62 % or 40 % is the ordinary state, not a warning or an error (D§2.2, D§14.2's "fourteen days of red" lesson). The percentage and the neutral `Meter` carry the order. Claim comment in `sat-analytics.ts` per D§22 |
| yellow highlighter | the student's own mark | `--sat-highlight` → `--warning-surface`. The one deliberate exception to "amber = warning": a highlighter is yellow by universal convention, sits only under body text, and no warning is ever drawn there. Body ink over it is measured and recorded (D§3.3). Documented in `sat.css` and in DESIGN §2.2 beside Law 2 |
| navy 5-step heatmap | ordered intensity | `--sat-heat-0…4`: `--surface-inset`, then `color-mix(in oklch, var(--brand-scale-3) 25 / 50 / 75 / 100 %, var(--surface-inset))` — `oklch` because the operand is saturated (D§3.2; precedent `schools.css`). No status hue appears in that rail. The count is in each cell's accessible name and tooltip |
| figure outline | depth for base64 images | `--image-outline: color-mix(in oklch, var(--gray-1000) 10%, transparent)` in `semantic.css` (tier 2 — no new primitive, no literal), drawn as `outline` with `outline-offset: -1px` |

All `--sat-*` tokens live in `styles/sat.css` and resolve only through `semantic.css`. No
colour literal. No `dark:`.

---

## 3. Dashboard (`/app/sat`)

`PageContainer width="full"`, `title="SAT practice"`, `actions={<Button variant="outline">`
`<ChartColumn/> Analytics</Button>}`. The greeting (F1, O9) is `subtitle`: **one line**,
"{main} — {sub}", from 13 Counselle-voiced pairs in `sat-copy.ts`, picked once per mount.
It is the recorded exception to the no-prose-under-a-title house rule; if the owner drops
it (O9), the header has no subtitle.

### 3.1 Layout — container queries on the content column

The dashboard lives beside the sidebar, so widths are **content** widths:
`cw = viewport − sidebar (312 expanded / 48 collapsed) − 80 px padding`. The body is
`@container`; thresholds are on `cw`, never on the viewport (D§7.4).

| `cw` | Arrangement (liprep's order, F18) | Topics width → module columns | Reached at (viewport, sidebar expanded / collapsed) |
|---|---|---|---|
| ≥ 1496 | Activity 252 · Topics · Filters 252, gaps 24 | ≥ 944 → two columns ≥ 460 | 1888 / 1624 |
| 936 – 1495 | Topics left; right column 272 with Filters above Activity, gap 24 | 640 – 1199 → two columns 308 – 587 | 1328 / 1064 — **the common laptop case**: at 1440 expanded, `cw` 1048, Topics 752, two columns of 364 |
| 640 – 935 | Filters and Activity side by side (1fr 1fr); Topics full width below | 640 – 935 → two columns 308 – 455 | 1032 / 768; a 1280 laptop with the sidebar open (`cw` 888) lands here |
| < 640 | one column: Filters → Topics → Activity; **Start session** sticky at the bottom of the scroll container | one module per row | phone |

Thresholds are chosen so the arrangement coming in is never narrower for Topics than the two
columns need (640): crossing 936 takes Topics from 935 to 640 — still two columns — and
crossing 1496 takes it from 1199 to 944. (The rails are 252 in the three-region row and 272 as a
single right column, following upstream's own bands, F18. Below `md:` the sidebar is a sheet
and `PageContainer`'s gutter is `px-6`, so `cw = viewport − 48`.) Column width = (Topics − 24) / 2: the Topics panel has
**no interior padding** (§3.2), only the 24 px gutter between its two columns.

The two module columns sit in their own `@container` and stack when **the Topics region** is
narrower than 640 — upstream's rule is a 900 px *viewport* query that fires while its page
still has room (F18); the container query is what it was reaching for.

### 3.2 Topics — the page's one raised object

One raised panel (`--surface-raised` + `--edge` + `--elevation-1`, `rounded-xl`) holding the
two module columns, split by a `--hairline` rule (D§17.2 "a list"; one raised level, Law 3).
Column header: the short section label ("EBRW" / "Math", X6) at `text-sm font-semibold`,
and a `Button variant="ghost" size="sm"`: "Select all" / "Deselect all". The panel itself has
no padding: rows are full-bleed with `px-4`, so the hairlines run edge to edge; the two
columns are separated by a 24 px gutter holding the vertical hairline.

Rows, `h-9`, separated by `--hairline`:
- **Domain row:** `Checkbox` (checked / **indeterminate** / unchecked — E-4 repairs the
  primitive first: today its filled on-state never renders and an indeterminate box draws a
  check) + domain name
  `font-medium` + count.
- **Skill row:** indented 24 px; `Checkbox` + name (wraps to two lines; never truncates —
  the long Math names are the content) + count.
- The whole row is the hit target (a `<label>`); hover `--surface-hover`.
- Counts: `tabular-nums`, right-aligned, `--ink-secondary`, `text-sm`. While `/counts`
  refetches the previous numbers stay (`keepPreviousData`) at `opacity-64`, 150 ms — no
  skeleton flash; they change on every filter click.

### 3.3 Filters — flat, on the canvas, no card

Three cards in a row is the identical-grid tell; hierarchy comes from surface (D§1.3.2).
A heading "Filter" (`text-sm font-semibold`), then, at `gap-4`:
- **Status:** `SegmentedControl columns={2}` full width (E-3): All · Unsolved · Mistakes ·
  Bookmarks (with `Bookmark` icon).
- **Exclude Bluebook:** `Checkbox` + label "Exclude Bluebook practice questions".
- **Difficulty:** heading "Difficulty (1–7)"; three rows. Left: the tier as a
  `Button variant="ghost" size="sm"` — "Easy (1–3)" with its ink tick — which toggles the
  tier (F7). Right: the band toggles — **`ToggleBand`** (enabling refactor E-6): a thin
  wrapper over Base UI's `toggle-group` (`multiple`; the group's values are strings, so the wrapper maps band `number ↔ string` at its boundary; its items expose
  `aria-pressed` and emit the `data-pressed` that `lib/segmented-control.ts`'s so-far-unused
  `pressed` recipe keys on), drawn in `SegmentedControl`'s own root trough, so they share the
  status control's selected language. `SegmentedControl` itself is a
  single-select radio group and cannot do this. Each shows its number, `size-8`, with the
  D§11.8 coarse-pointer hit area; no fill colour.
- **Start session:** the page's single primary `Button`, full rail width, `size="lg"`;
  `loading` only while the navigation *to the practice route* is in flight (plan §5.1).
  Disabled uses D§11.5's quiet fill, and an inline `text-xs --ink-secondary` line names the
  actual cause (F8): "Select at least one skill" or "Select at least one difficulty band".

### 3.4 Activity — flat, on the canvas

Heading "Activity". Month grid on the `Calendar` primitive with a custom
`components.DayButton`: it **stays a focusable button** (react-day-picker's roving focus and
paging keep working, and the tooltip opens on focus) but has no selection behaviour,
`cursor-default`, and no pressed state (F14b). `aria-label="September 19: 12 questions"`;
`Tooltip` anchored to the cell with the same text; `data-heat="0…4"` paints
`--sat-heat-*`; cell `size-8`, `rounded-md`; today ringed with `--edge-strong` at 1 px — `today` is the date read once at mount (plan §4.4) and passed to the calendar, so the ring does not move at midnight (F14b). The primitive's `mode` stays `single` (its default) with no `selected` / `onSelect`, so nothing is selectable.
Weeks start Sunday; leading blanks only. Paging unbounded; intensity relative to the
student's **all-time** busiest day; future days are level 0 and read "0 questions" (F14a).
Below: the Less → More legend (five swatches, `aria-hidden`, with visible "Less" / "More");
the streak line (`Flame` + "12 day streak", only when > 0); "Today": EBRW n · Math n ·
time, `tabular-nums`.

### 3.5 Dashboard states

| State | Render |
|---|---|
| taxonomy / first counts loading | `Skeleton` rows inside the Topics panel only |
| `/stats` loading | Activity shows a `Skeleton` month grid; the streak and Today lines are **not rendered** — never a level-0 calendar or "0" counts while the data is in flight (D§1.1) |
| `/stats` error | `ErrorCard` in the Activity region: **"Could not load your activity"** / "The workspace could not reach your practice history." / `[Try again]` |
| `/counts` error | `ErrorCard` in the Topics region: **"Could not load question counts"** / "The workspace could not reach your question counts." / `[Try again]` |
| brand-new student | the ordinary dashboard (every count is the whole bank). The calendar renders in full, every cell level 0 (F14c); where the streak and Today block will appear, one `text-sm --ink-secondary` line: "No practice yet" |
| filtered to zero | counts read 0; Start stays enabled and lands on the practice screen's filtered-to-zero state (Q2), as upstream |
| bank not loaded (fresh environment) | `Empty` (no action — there is nothing a student can retry): **"Question bank not loaded"** / "The question bank has not been loaded on this server." — operators only |

---

## 4. Practice screen — the Bluebook frame

Full viewport, `h-dvh`, a column: top bar · reading region (flex) · bottom bar. Nothing
floats except the tools.

```
┌ top bar 56 (52 ≤860) ───────────────────────────────────────────────────────┐
│ Section 1: Reading and Writing      [⏱ 01:42][⏸]     Highlight · Info ·  ✕ │
├──────────────────────────────┬──────────────────────────────────────────────┤
│ passage (own scroll)         │ [12]  Mark for review                 [ABC̶] │
│ 65ch, 16 px / 1.7            │ stem                                         │
│                              │ (A) … (B) … (C) … (D) …                      │
│                              │ ▾ Explanation    ▸ Previous attempts (2)     │
├──────────────────────────────┴──────────────────────────────────────────────┤
│ [Question 12 of 148 ▴]                                     [Check answer ↵] │
└ bottom bar 64 (60 ≤860) ─────────────────────────────────────────────────────┘
```

- **Surfaces.** Bars are `--chrome` with a `--hairline` seam toward the reading region: a
  surface's role follows what it *does* (D§2.2 Law 3), and a fixed app bar is chrome — the
  sources rail (D§15.4) is the precedent for chrome outside the sidebar. It also gives the
  frame real separation; a raised bar would be the same white as the page. **Ghost (transparent) controls on the
  bars take the chrome state family** — `hover:bg-[var(--chrome-hover)]` /
  `[:active,[data-pressed]]:bg-[var(--chrome-pressed)]` (the repo's pair form: `Button` is a plain
  `<button>`, so `data-pressed` alone reaches only what Base UI renders — here just the navigator
  trigger) — not `Button`'s canvas-level ghost hover, which
  lands within 0.001 L of `--chrome` and would be invisible (D§11.1: a hover is mixed into the
  surface it sits on). An **`outline`** control on a bar — the timer pill, its pause button, the
  bottom-bar counter — carries its own `--surface-raised` fill and keeps `Button`'s own states.
  Reading region `--canvas`. Two columns (`1fr 1fr`) split by a `--hairline`, each its own
  scroll container, padding `px-10 py-6` (`px-10` is `PageContainer`'s own gutter); both reset to the top on navigation (Q11a).
  Math / no stimulus: one centred column, `max-w-[860px]` (Q12 — an upstream constant,
  commented as such).
- **Type.** Question content is the product and gets a prose scale, not `text-sm`: a named
  local scale in `sat.css` (as D§6.7 does for assistant prose) — 16 px / 1.72 (D§6.5's prose leading), passage capped
  at 65ch, `text-wrap: pretty`. Chrome stays `text-sm`. Timer and counters `tabular-nums`.
- **Top bar, left:** "Section 1: Reading and Writing" / "Section 2: Math" (Q4), `text-sm
  font-medium`, truncates first when space runs out.
- **Top bar, centre — the timer (Q5, Q5a, Q6, Q25a):** a `ButtonGroup`: a pill
  `Button variant="outline" size="sm"` showing `Timer` icon + `MM:SS` (or "Show" when
  hidden; tooltip "Toggle timer visibility"), and an icon `Button variant="outline" size="sm"` `Pause` / `Play` (tooltip
  "Pause timer" / "Resume timer", `aria-pressed`). Every index change sets it to 0 **and
  running**; hidden / shown is not reset.
- **Top bar, right — tools:** `Button variant="ghost" size="sm"`, icon + label; labels
  collapse to icon-only with tooltips below 860 (Q7). R&W: Highlight (`Highlighter`,
  `aria-pressed`; disabled with a tooltip where unsupported). Math: Calculator
  (`Calculator`, `aria-pressed`), Reference (`Triangle`). Both: Info (`Info`), Exit (`X`,
  tooltip "Exit to SAT practice"). **At 375:** section label truncates, then tool labels
  are already icons; the timer never drops; five 36 px controls + timer fit in 375 with
  `gap-1`.
- **Question strap:** a row, `h-10`, `--surface-inset` fill, `rounded-lg`, no border (Law 3
  inset corollary). Left: the question number in a `size-7` ink square (`--ink` fill,
  `--on-ink` text — a new tier-2 token `--on-ink: var(--gray-0)` beside `--on-brand`, with its measured ratio in a comment; `sat.css` never reaches a primitive — `rounded-md`, `tabular-nums`) and "Mark for review" — `Button
  variant="ghost" size="sm"` with `Bookmark` (filled when on), `aria-pressed`. Right, MCQ
  only: the eliminate-mode toggle — icon button, a letter-with-strike glyph (`Strikethrough`
  from Lucide), `aria-pressed`, tooltip "Toggle option elimination". **Controls in the strap take the
  quiet-control family** — `hover:bg-[var(--control-quiet-hover)]` /
  `[:active,[data-pressed]]:bg-[var(--control-quiet-active)]` — not `Button`'s ghost hover, which is
  mixed into canvas and lands *lighter* than `--surface-inset`. Their on-state is carried by the
  glyph (filled `Bookmark`; `Strikethrough` at full ink vs `--ink-secondary`), never by a fill:
  `secondary`'s fill is the strap's own.
- **Answer choices.** A `div role="group" aria-label="Answer choices"` of four full-width
  row **buttons with `aria-pressed`** — upstream's semantics. (No `radiogroup`: its arrow
  keys would *select*, which upstream's do not — a product change.) Row: `min-h-12` (a content row, not chrome — deliberately off D§7.2's control heights),
  `rounded-lg`, `px-3 gap-3`; a `size-8` letter disc (`rounded-full`, 1 px `--edge` — `--edge-strong` when the row is hovered or selected; never `--edge-control`, which `semantic.css` reserves for empty form fields,
  letter `text-sm font-medium`, optically centred) + content.

  | State | Treatment |
  |---|---|
  | rest | 1 px `--edge`; `--canvas` fill |
  | hover | `--canvas-hover` (D§11.1); border unchanged |
  | press | `--canvas-active` |
  | focus-visible | `ring-2` `--focus-ring` |
  | selected | disc `--brand` fill + `--on-brand` letter; border `--edge-strong` |
  | eliminated | content `line-through` + `--ink-disabled`; row `aria-disabled`, not selectable; stays so after submit (Q20) |
  | revealed · correct | `--success-surface` + `--success-border`; `Check` + "Correct answer" (`--success-fg`) right-aligned; wins over eliminated styling |
  | revealed · your wrong answer | `--danger-surface` + `--danger-border`; `X` + "Your answer" |
  | revealed · other | rest, `aria-disabled` |
  | selected, once revealed | the brand disc is dropped: disc returns to `--edge-strong` + ink letter, and the row's verdict fill carries the claim — a brand fill never sits inside a success- or danger-tinted row (D§3.1) |

  The strike control is a separate `size-9` icon button to the row's right — the option's
  letter with a rule through it; tooltip and accessible name "Eliminate choice B" /
  "Restore choice B" (Q38b); present only in eliminate mode and only before submit.
- **SPR.** Visible label "Student-produced response" bound to an `InputGroup` with
  `max-w-80` on the group (`Input`'s `className` lands on its wrapper), tabular digits, `type="text"` with **no `inputMode`** (`decimal` offers neither `/` nor `−` on iOS or
  Android, and Q21's mask accepts both), the 7-character mask, placeholder "e.g. 3/4 or 0.75"; after submit it is **`readOnly`**, not `disabled` — locked per Q18, still announced, and a native `disabled` would throw keyboard focus to `<body>` for a student who submitted with Enter from inside it (D§11.6). After
  submit the wrapper takes the success or danger edge, and the verdict line reads "Correct"
  or "Incorrect. Accepted: 7/6, 1.166, 1.167" (Q23) — in an `aria-live="polite"` region
  shared with the MCQ verdict.
- **After submit — `SatRevealPanel`**: the existing `Collapsible` primitive, **keyed by
  `question_id` with `defaultOpen`** — uncontrolled, so it resets on every revisit exactly as
  upstream's hard-coded `<details open>` does (Q27), and it brings the app's one disclosure
  pattern (chevron rotate + height transition, D§12.4) instead of a sixth: "Explanation" open,
  rendered only when the rationale is non-empty; "Previous attempts (2)" closed, its trigger
  carrying "Solved" / "Not solved yet". `--surface-inset`, `rounded-lg`, no border;
  triggers `select-none`. Attempt row: `Badge success` "Correct" / `Badge error`
  "Incorrect" · "Answer: B" `font-medium` · right-aligned `Timer` "42s" · "Sep 19, 02:41 PM" (upstream's two-digit hour, Q28)
  in `text-xs --ink-secondary`. Entrance: the D§12.4 *surface enter*
  (`motion-safe:animate-in fade-in slide-in-from-bottom-2`, 200 ms `ease-out`), no stagger.
  Nothing else animates on the hot path.
- **Bottom bar, left:** `Button variant="outline"`: "Question 12 of 148" + `ChevronUp` /
  `ChevronDown`. **Right:** the primary `Button size="lg"`, which never moves: "Check
  answer ↵" → "Next ↵" → "Finish session" (a link; no ↵, Enter does nothing on the last
  question). The ↵ is a text glyph in `--on-brand` ink inside the button, not a `Kbd`
  (whose surface is tuned for canvas). Press feedback is `Button`'s own state machine
  (D§11.3).
- **Navigator (Q29–Q31).** Desktop: `Popover`, 400 px wide, `max-h-[520px]`, scrolls,
  `--elevation-2`, anchored above the counter; light-dismiss and `Esc` (Q29a). Below 860:
  bottom `Sheet`, `max-h-[80dvh]`. Header "Question bank" + close. Legend: Correct ·
  Incorrect · For review · Upsolved — with a caption "✓ ✕ this session · Upsolved across all
  your attempts" so one cell's two time horizons are legible. Grid: **6 columns** (5 below
  860, 4 below 480), `gap-2`; cell = `aspect-square` button, `rounded-md`, 1 px `--edge`,
  number centred `tabular-nums`; difficulty ink tick bottom-centre; status glyph top-right
  (● and ✕ can both appear, Q31); bookmark top-left; current cell = 2 px inset `--edge-strong` ring + `font-medium` + `aria-current="true"` (`--focus-ring` is reserved for `:focus-visible`, so a focused cell and the current cell never look alike).
  Hover `--surface-hover` (no scale, X5). Accessible name "Question 12, hard, incorrect,
  upsolved, marked for review". Choosing a cell closes the navigator; **every** index change — cell, Next or Enter — clears
  any text selection (Q30a); focus returns to the question heading. Rows use
  `content-visibility: auto` — a 1,900-question session is legal — no virtualisation
  library.
- **Exit (✕)** returns to `/app/sat` without confirmation, as upstream (Q3): submitted
  attempts are saved; an unsubmitted selection is not work.
- **≤ 860 px.** One column; passage under the strap, above the stem (Q15); bottom bar keeps
  both controls; tools go fullscreen.

### 4.1 Tool windows (`SatToolWindow`)

An **overlay tier**, like a popover — not a second raised object on the page, so Law 3's
one-raised-level rule is untouched. `--surface-raised`, `--elevation-3`, **no border** (D§4: elevation-2/3 never pair with one),
`rounded-xl`; content inset 4 px with `rounded-lg` (concentric: 12 = 8 + 4). Header `h-10`,
`select-none`, `cursor-grab` / `cursor-grabbing`: title left ("Calculator" + a `Badge
secondary` "SAT graphing"; "Reference sheet"), then icon `Button`s with tooltips — Dock /
Float (calculator only, one control, Q35), Close. A 16 px resize handle in the bottom-right
gutter (`cursor-nwse-resize`), outside the iframe. Drag and resize move by `transform` /
size only, `will-change: transform` set on drag start and cleared on end.

Keyboard (D§16, D§17.6's convention): a labelled non-modal `role="dialog"`; with the header
focused, arrows move ±16 px, Shift+arrows resize ±16 px; `Esc` closes; on open, focus goes
to the header; on close, back to the toolbar button. Below 860: fullscreen, header shows
"Back to question".

Reference sheet content: a scroll area; row 1 = the four 2-D formula figures plus the
special-right-triangles figure in a double-width cell (upstream's layout); row 2 = the other
seven; then the three fact lines at the prose scale. Figures are `select-none`, not draggable.

### 4.2 Question Info dialog

`Dialog`, `max-w-[480px]`; below `sm:` it is full-width with `m-4`. A `<dl>` in two columns
(term `--ink-secondary`, definition `--ink`): Question ID (mono, + "Search for a tutorial"
external link with `ExternalLink`), Section, Domain, Skill, Score band "5 / 7", Difficulty,
Item type, Created, Updated (Q38's rule); absent values read "not available" (D§13.4).
Footer: `Button variant="outline"` "Report an issue" (`Flag`).

### 4.3 Practice states (D§13 templates)

| State | Render |
|---|---|
| session loading | the frame at once, with `Skeleton` blocks in the reading region; bars live (Q2a) |
| `/session` failed | `ErrorCard` in the reading region: **"Could not load this session"** / "The workspace could not reach your question list." / `[Try again]` |
| body loading | `Skeleton` in the question pane only; timer, bars, navigator live |
| body failed | `ErrorCard`: **"Could not load this question"** / "The workspace could not reach question 12." / `[Try again]`; navigation still works |
| filtered to zero (D§13.3) | `Empty` — not an error: **"No questions match"** / "{filter} is the narrowest filter — {N} questions match everything else." / `[Relax {filter}]` `[Back to filters]`. Computed **only when the session comes back empty**: four candidates — *Skills* (→ all skills), *Difficulty* (→ all bands), *Question status* (→ All), *Bluebook questions* (→ included). One parallel batch of **four `/counts` calls**: three with a single filter relaxed (N = the sum over the *selected* skills), plus one with the current filter unrelaxed, whose rows the *Skills* candidate sums over all 29 (`/counts` ignores the skill selection, plan §4.5). The unrelaxed call is skipped when the dashboard's counts query is already in cache. The narrowest is the candidate with the largest N; ties resolve in the order listed. `[Relax …]` rewrites that one parameter in the URL (the `sat-filters.ts` codec) and the session reloads. If every N is 0: "No questions match" / "Nothing matches even with one filter removed." / `[Back to filters]` |
| unknown id | `Empty`: **"Question not found"** / "Question 1a2b3c4d is not in the question bank." / `[Back to SAT practice]` |
| submit failed | `toast.error` "Could not check your answer. Try again."; the button returns to Check answer; nothing recorded |

`EmptyTitle` renders a `div`; these states pass a real heading (`<h2>`) through it so the
page keeps a heading outline.

---

## 5. Analytics

`Dialog` (A16): `max-w-[1160px]` (D§8's panel width; upstream 1180), `h-[min(900px,92dvh)]`;
fixed header · one scrolling body · pinned footer drawer. **Below `md:` a full-bleed
`Sheet variant="full"`** (enabling refactor E-7: today `Sheet` caps its width and puts viewport
insets where a `className` cannot reach) — opaque, full height, sticky header (A17). Closes on overlay, ✕ and `Esc` (A15).
Header: `ChartColumn` + "Analytics and progress" (upstream's restating subtitle is dropped,
A16a), then `Tabs` — the five upstream tabs, each with its Lucide icon: Overview `LayoutDashboard` · Radar web `Radar` · Pace matrix `Timer` · Score bands `ChartNoAxesColumn` · All domains and skills `List` — then Close. The dashboard's Analytics
button shows `loading` while `/stats` is pending and leaves it when the query **settles,
success or error** — on error it still opens the dialog, whose body carries the `ErrorCard`
and its `[Try again]`; upstream's button is silently inert until its stats exist (A1). The tab strip scrolls horizontally and never
wraps; below `md:` it drops to its own full-width row, with edge fades made by
`mask-image: linear-gradient(to right, transparent, black 24px, black calc(100% - 24px),
transparent)` — keywords only, no colour literal. The dialog is the raised level; panels
inside are **inset regions with headings** (`--surface-inset`, `rounded-xl`, `p-6`), never
cards in a card. It fetches `/stats`; the dashboard rail shares that query.

Breakpoints (on the dialog's own container): < 960 → KPI row 4 → 2, chart pairs stack, skill
rows go vertical, radar list `max-h-[360px]`; < 768 → KPI 1 column, footer actions stack,
radar list `max-h-[320px]`.

- **Overview.** KPI row, four groups — statements, not the hero-metric template: label
  (`text-xs --ink-secondary`), value (`text-lg font-medium tabular-nums` — `text-xl` is the
  page title's size, D§6.2), supporting line, and upstream's secondary figure **wherever it
  carries different data**: (1) First-try accuracy — value and its supporting line "48 unique questions attempted"; upstream's pill repeats the value and is dropped.
  (2) EBRW — unique questions **attempted** (A2's word fix) + `Badge secondary` first-try
  %, line "~42s average · 1h 12m total". (3) Math — same. (4) Upsolve — "31 / 48" currently
  correct of attempted, `Badge secondary` "6 corrected", line "17 unsolved mistakes".
  Then the section comparison as a two-column `Table` (rows: first-try accuracy · overall
  accuracy · average pace · upsolved); the mastery donut (centre: unique **attempted**)
  beside a three-row legend carrying the numbers — "Correct, never missed" · "Upsolved" ·
  "Unsolved"; and "Skills to reinforce" with the line "Your four lowest first-try accuracies, whatever the volume" (A5 — upstream's "highest error frequency" is not what is ranked), its rows: section chip · skill ·
  "12 attempts · ~48s" · first-try % · `Button variant="outline" size="sm"` "Practice
  drill" (A6: launches that one skill with the dashboard's current bands / status / Bluebook and never touches the saved topic selection — plan §5.3). Hidden when no skill has data (A5).
- **Radar.** Chart left, "Domain summary" right (A7): eight rows — domain, first-try %,
  neutral `Meter` (E-5), "14 questions · ~51s". The list is its own scroll area. Stacks
  below 960.
- **Pace matrix.** One full-width chart + legend; below `md:` the chart keeps a 16:9 minimum
  and quadrant names move to a legend beneath.
- **Score bands.** `SegmentedControl` (All sections · EBRW · Math) + chart.
- **Domains and skills.** `SegmentedControl` (All domains (8) · EBRW (4) · Math (4), A10) + search
  (`InputGroup` with `Search` icon and a clear button; matches skill name, skill code or
  domain name, A10). Domain groups: section chip, domain name, summary "14 attempted ·
  71 % first try · ~51s". Skill rows: name · mastery `Badge` (§2) · neutral `Meter` + % ·
  overall % · "9 (14)" attempted (attempts) · pace · `Button variant="ghost" size="sm"`
  "Practice" (the same A6 payload rule as the drill button). Below 960 rows become stacked blocks (D§17.6). Search with no match →
  D§13.3: **"No skills match"** / "Your search is the narrowest filter — {N} skills match
  everything else." / `[Clear search]`.
- **Loading:** header and tabs live; the body is `Skeleton` blocks in the tab's layout.
  **`/stats` error:** `ErrorCard` in the body — **"Could not load your progress"** / "The
  workspace could not reach your practice history." / `[Try again]`.
- **Empty state** (no attempts, A18): each tab's body is one `Empty` — **"No practice
  yet"** / "Answer a few questions and your progress appears here." / `[Start practising]`
  — never an empty axis.
- **Footer drawer (A11).** Collapsed: "1,204 attempts · ~46s average pace" + "Data and
  progress" with a chevron. Expanded: `Button variant="outline"` "Export progress"
  (`Download`, an `<a download>`), "Import progress" (`Upload`, file input, cleared after
  each pick), and `Button variant="destructive-outline"` for reset. Feedback via `sonner`:
  "Exporting 2026-09-19.liprep…" on click — the export is a plain download link, so the page never observes completion and must not claim it; the browser's own download UI is the success signal (A12's banner, made honest) · "Imported 1,204 attempts and 37 bookmarks." Failure (A13b):
  "That file is not a progress export." (422) · "That file is too large to import." (413) ·
  otherwise "Could not import that file. Try again." — nothing is changed on failure.
- **Import confirms first.** It replaces everything, even with an empty file (A13a), so after
  the file is picked: `Dialog role="alertdialog"` — **"Replace your SAT progress?"** / "This
  replaces 1,204 attempts and 37 bookmarks with the contents of {file}. Export first if you
  want a copy." / `[Cancel]` `[Replace progress]`. Upstream imports with no question asked; a
  guard on reset and none on an equally destructive import would be incoherent — recorded in
  the inventory's differences table.
- **Reset (A14) — upstream's guard, exactly:** three presses, the label changing each time,
  no timeout: "Reset progress" → "Press again to continue" → "One more press" → the third
  press resets the counter and opens the confirmation. That is a plain `Dialog` given
  `role="alertdialog"` (the app has no AlertDialog primitive; this also closes D§16.2's
  gap): **"Reset all SAT progress?"** / "This deletes 1,204 attempts and 37 bookmarks. Your
  saved filters stay. Export first if you want a copy." / `[Cancel]` `[Reset progress]`
  (`variant="destructive"`, `loading` while it runs; overlay-click disabled meanwhile). On
  success both dialogs close. It is a confirmation rather than D§17.4's
  optimistic-delete-with-undo because a five-second undo is the wrong guard for erasing
  months of history; the app's one existing confirm (`DocumentsSection`) is the same shape.
  No shake (D§12.1).

---

## 6. Every new control's states

All: focus-visible ring (D§11.4: `ring-2` for buttons, `ring-[3px]` for form controls);
disabled = D§11.5; coarse-pointer hit area = D§11.8; transitions name their properties,
150 ms `ease-out`.

| Control | Rest | Hover / press | On / selected | Disabled / loading |
|---|---|---|---|---|
| Status segments (`SegmentedControl`), band toggles (`ToggleBand`, E-6) | segmented item | its own | the raised segment (`data-checked` / `aria-pressed`) | — |
| Tier label button | ghost | ghost | — (it is an action, not a state) | — |
| Topic row | transparent | `--surface-hover` / `--surface-active` | `Checkbox` state | counts dim at 64 % while refetching |
| Select all | ghost sm | ghost | label flips | — |
| Start session | primary lg | primary (`--elevation-cta-hover`) | — | quiet fill + reason line |
| Heatmap cell | `--sat-heat-n` | tooltip only; no fill change | today = 1 px `--edge-strong` | — |
| Timer pill, pause | outline sm | outline (its own fill, its own states) | `aria-pressed`; the state is carried by content — the pill's label flips to "Show", the pause icon to `Play` | — |
| Bottom-bar counter | outline | outline (its own) | chevron flips, `aria-expanded` | — |
| Tool buttons | ghost sm | chrome family (§4) | `aria-pressed` → rendered as `Button variant="secondary"` + filled icon: the quiet-control family (`--control-quiet-surface` / `-hover` / `-active`) has its own monotonic ladder. (`secondary`'s own press step keys on `data-pressed` alone — existing primitive debt, so an on-toggle shows surface and hover but no press step; not a P7 bug.) **Rule for every toggle here: an on-state is never lighter than its own hover, and never the same fill as the surface under it** (inside the strap that rules out `secondary`, so the glyph carries the state) — so it cannot borrow the 7 % pressed step, which a 4 % hover would undercut — and never `--surface-selected`, a lime tint that would sit beside the success tint (D§3.1) | Highlight when unsupported: **`aria-disabled`**, not native `disabled` — a disabled button fires no pointer events, so its explanatory tooltip would never open (precedent `RunPassButton.tsx`) |
| Mark for review | ghost sm | quiet family (§4) | filled icon + `aria-pressed` | optimistic; rolls back on error |
| Eliminate-mode toggle | ghost icon | quiet family (§4) | `aria-pressed`; the glyph carries it (full ink on, `--ink-secondary` off) — no fill | MCQ only |
| Strike button | ghost icon | ghost | — | hidden after submit |
| Answer choice | §4 table | | | |
| Navigator cell | 1 px `--edge` | `--surface-hover` | current = 2 px inset `--edge-strong` + `font-medium` | — |
| Check answer / Next | primary lg | primary | — | Check: disabled until an answer exists; `loading` while in flight |
| Tool window header buttons | ghost icon | ghost | Dock ↔ Float label flips | — |
| Analytics tabs | `Tabs` | its own | its own | — |
| Drawer trigger | ghost, full width | ghost | chevron flips, `aria-expanded` | — |
| Practice drill / Practice | outline sm / ghost sm | theirs | — | — |
| Reset (three-press) | destructive-outline | its own | label = press count; never auto-disarms (A14) | — |

Radii (D§5): rows, cells and band toggles are controls-in-a-surface → `rounded-md`; answer
rows, strap, reveal panels → `rounded-lg`; panels and windows → `rounded-xl`.

---

## 7. Charts

All through `components/ui/chart.tsx`, the **plot** wrapped in `ChartFigure`
(`components/workspace/chart-figure.tsx` after E-2) — real API
`{children, summary}`: it marks the plot `aria-hidden` and adds an sr-only `figcaption`. So
legends, side lists and anything clickable sit **outside** it, as `AcademicComparisonPlot`
already does. Each `summary` is a sentence generated from the same data
(`sat-analytics.ts`). Hover tooltips are an enhancement: every value is also present as text
in the adjacent legend, list or table. Constants are named after S13–S15. This is the app's
second sanctioned Recharts surface; D§15.5 is amended to say so (plan §7).

| Chart | Recharts | Encoding without hue |
|---|---|---|
| Radar (A7, A7a, S15) | `RadarChart`, 8 axes, 0–100 | first-try = filled polygon, `--brand-scale-2` at 25 % + solid 2 px stroke; overall = dashed 2 px `--ink` stroke, no fill. Axis and tooltip labels are upstream's eight short forms (A7); grouped EBRW / Math by an outer arc label. An axis with no data plots at the 0.05 floor as upstream, **and** its label reads "no data". Tooltip at the hovered axis with both values |
| Pace matrix (A8, S13) | `ScatterChart` + four `ReferenceArea`s | x 15–130 s, y first-try accuracy 0–100 %, split at 50 % and 72.5 s — **labelled on the axis**, where upstream leaves it unmarked. EBRW = filled circle, Math = hollow square; radius `max(6, min(14, 5 + 1.5n))`; quadrant names as in-plot text on `--surface-inset`. Tooltip anchored to the dot, carrying upstream's three data: "{n}% first-try accuracy · {t}s average pace · {k} attempts". Subtitle: "Your four weakest and four strongest skills, by first-try accuracy" |
| Score bands (A9, S14) | `ComposedChart`: `Bar` + `Line type="monotone" connectNulls={false}`, two labelled y-axes (accuracy %, pace s) | bars `--ink` at the chart tokens' bar opacity; pace line `--brand-scale-3` with dot markers and "42s" labels, clamped at 140 s; a band with no attempts = outlined ghost bar + "—", **and the line breaks there** (S14) |
| Donut (A4) | `PieChart` | §2's three fills; centre = unique attempted + the word "attempted"; each slice also a legend row with its number |

---

## 8. Copy (D§13; O2)

Sentence case, no exclamation marks, second person. "Check answer", "Next", "Finish
session", "Mark for review", "Explanation", "Previous attempts (2)", "Solved" / "Not solved
yet", "Try again" (never "Retry"). Section labels exactly where upstream places each (X6).
Every string lives in `sat-copy.ts`. Absent values read "not available".

---

## 9. Motion — DESIGN.md governs

| Moment | Spec | Source |
|---|---|---|
| hover, press, focus, count-dimming | colour / opacity, 150 ms `ease-out` | D§12.2 Fast |
| reveal panels, dialog, popover, sheet, tool window open | `animate-in fade-in slide-in-from-*`, 200 ms `ease-out` | D§12.4 surface enter |
| press feedback | `Button`'s built-in state machine — **no** `scale(0.96)` | D§11.3 over better-ui |
| staggered reveal | none (the one sanctioned stagger is the 22 ms list stagger; no list enters here) | D§12.4 over better-ui |
| easing | `ease-out` — **not** better-ui's `cubic-bezier(0.2, 0, 0, 1)` | D§12.3 over better-ui |
| hover transforms, decorative motion | none (X5) | D§12.1 rules 1, 5 |
| icons | Lucide at default stroke width, sized by container | D§7.3 over better-ui's stroke matching |
| tool drag / resize | `transform` / size only; `will-change` on drag start, cleared on end | D§12.1 rule 2; better-ui |
| `Meter` fill | the primitive's existing transition, unchanged (known debt, D§20 — not this branch's to alter for every other meter) | — |
| reduced motion | `motion-safe:` on every reveal; drag is user-driven and stays | D§12.5 |

better-ui applies where DESIGN is silent: concentric radii, image outlines, `currentColor`
icons with fill marking the active state, optical centring of the letter disc, strike glyph
and number square, tabular numerals, transitions that name their properties.

---

## 10. Accessibility (D§16)

`header` / `main` / `footer` landmarks on the practice frame. Focus: on index change → the
question heading (`tabIndex={-1}`, "Question 12"); after submit → stays on the primary
button, which becomes "Next" (submitting with Enter from inside the SPR input **moves** focus there); on navigator close → the question heading if a cell was
chosen, else the counter button; on tool open → the window header, on close → its toolbar
button; dialogs trap and restore focus (primitives). One `aria-live="polite"` region for
verdicts. Every icon-only control has a name and a tooltip, and names follow state (Q38b).
Both blank rules carry "blank space" (Q39). MathML keeps College Board's `alttext` (the
sanitiser's `ADD_ATTR` is what preserves it); base64 figures keep their `alt`. Status is
never colour alone. `jest-axe` on the three composed screens.
