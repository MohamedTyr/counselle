# Tasks redesign — visual design specification

Binding on the implementer. Every value below is either a real token from
`frontend/src/styles/` or a clearly-labelled proposed addition (§10). Where this
document and instinct disagree, this document wins.

Companions: `DESIGN.md` (the system — supersedes this doc on any conflict),
`plans/tasks-redesign-spec.md` (the behaviour — unchanged by this doc),
`frontend/src/styles/README.md` (the token contract).

---

## 0. Two corrections to the brief, before anything else

**0.1 — There is no dark theme.** The brief says "the app has a dark default theme;
both themes must be designed." That is false against the code. `DESIGN.md` §3.4 and
rule 7 state the app is light-only: no `.dark` class, no `prefers-color-scheme`
branch, no dark token set, `sonner.tsx` pins `theme="light"`. I verified it:

```
$ grep -rn "prefers-color-scheme|data-theme|dark:" frontend/src/ frontend/index.html
(no matches)
```

The two reference PNGs (`artifacts/tasks-upcoming-card.png`,
`artifacts/phase9-manual/tasks-all-seeded.png`) render dark because they were
captured through a browser force-dark filter, not because a dark theme exists.
Force-dark is also why the amber/red chips in those shots read as muddy brown.

**This spec is therefore light-only, per DESIGN.md.** Do not write a single `dark:`
variant. §10 gives the dark-side *intent* for every token I add, so that when a real
dark pass happens it stays what the tier system promises: a `primitives.css`-only
edit. That is the correct way to honour "both themes."

**0.2 — What the reference PNGs actually show, and what we are killing.** Current
Today row: a `rounded-xl` card, 1px border, drop shadow, 3-line body, and **six**
simultaneous meta objects (category chip, priority pill, assignee pill with icon,
due date with icon, reminder with icon, `···` menu). Eight of those cards stacked in
two lanes. Every row shouts equally, so nothing reads. The All-tasks view is worse: a
card per task containing a *nested* `Work / Due / Reminder` grid — a card inside a
card, which `DESIGN.md` rule 9 bans outright.

Count of distinct visual objects per row today: **9**. Target: **4 at rest** (checkbox,
title, one label, one date), with a fifth and sixth appearing only when they are true.

---

## 1. Design direction

**The reference bar is Things 3's typographic calm — and only that.** From Things we
take three things: a row that is type on a ground with no container; a strict left
spine that every title and every group header shares; and rhythm carried entirely by
the ratio between within-group space and between-group space. From Linear we take
one thing only: `tabular-nums` on every date so the right edge forms a real column.

**We refuse Linear's density-as-identity.** Linear's rows are dense because a triage
queue is a machine you operate. This is a seventeen-year-old's college applications,
opened at 11pm, and the emotional register is *reassurance*. So: no keyboard-shortcut
chrome on the surface, no icon rail, no status dots, no coloured category system, no
avatars, no board.

**The one sentence a reviewer can hold me to:** *a task list where the only marks on
the page are the words themselves, one wine flag, and — if the world has already
passed a date — one line of red.*

The defence against "minimal came out as bland grey list" is not decoration. It is
four measurable things, and each is a criterion in §12: a **6:1 rhythm ratio**
between group gap and row gap; a **hard 36px spine** shared by titles and headers; a
**typographic grammar where chip-shape means interactive and plain text means
informational**; and **subtraction by redundancy** — a row never repeats what its
group header already said, so Today's eight rows carry eight titles and almost
nothing else. A page that is 92% type and 8% everything else is not bland. It is
edited.

---

## 2. The list surface

### 2.1 Page scaffold

Render through `PageContainer` (`components/workspace/PageContainer.tsx`). This
closes DESIGN.md debt #5 for this route — `TasksRoute` currently hand-rolls the
scaffold and has already drifted to `pr-8 pl-6 md:pr-10`.

```tsx
<PageContainer
  title={viewTitle}          // "Today" | "Upcoming" | "Anytime" | "Logbook"
  subtitle={viewSubtitle}
  actions={<><SearchButton /><PlanWithCounselleButton /></>}
  width="wide"
  overlay={<><UndoToast /><TaskDetailPanel /></>}
/>
```

`width="wide"` = `mx-auto w-full max-w-4xl` (**896px**). Per DESIGN.md §8 this is the
tier for "linear read-and-enter surfaces," which is exactly what a task list is. A
36px row list run full-bleed at 1440px is the single fastest way to make this look
unfinished.

`PageContainer` supplies: `px-6 pb-6 md:px-10`, `gap-6` (24px) between header and
body, `overflow-y-auto` on the body column, and `PageHeader` at `min-h-16` (64px)
with its full-bleed `inset` rule.

**Page title / subtitle** — `PageHeader`'s guarantees, unchanged:
`text-xl font-semibold tracking-tight leading-none` on `--ink`;
subtitle `text-sm` on `--muted-foreground` (= `--ink-secondary`, gray-800).

| View | `title` | `subtitle` |
|---|---|---|
| Today | `Today` | `Thursday 4 September · 8 tasks` |
| Upcoming | `Upcoming` | `23 tasks over the next six weeks` |
| Anytime | `Anytime` | `14 tasks, no date` |
| Logbook | `Logbook` | `12 done this week` |

Sentence case; numbers get their noun (DESIGN.md §13.4). Never "8" alone.

**Actions**, right-to-left in the `shrink-0` actions column:
1. `Plan with Counselle` — `Button variant="outline" size="default"`, leading
   `Sparkles`. Copy says the noun, per §13.4; not "Plan with agent".
2. Search — `Button variant="ghost" size="icon"`, `Search` glyph,
   `aria-label="Search tasks"`, with a trailing `Kbd` reading `⌘K` at `sm:` and up.

**There is no "New task" button.** The quick-add bar is the capture affordance and a
second one is a lie about which is primary. Deleting it is a visible part of the
redesign.

### 2.2 Body column

`PageContainer`'s body is `flex shrink-0 flex-col gap-6`. Override to `gap-0` via
`className` and control spacing locally — the members here are not peer sections.

```
┌─ PageHeader (min-h-16) ───────────────────────────────────────┐
│  Today                                    [🔍] [✦ Plan …]     │
│  Thursday 4 September · 8 tasks                               │
├───────────────────────────── full-bleed rule (--hairline) ────┤
│                                   ↕ 24px (PageContainer gap-6)│
│  Today 8   Upcoming 23   Anytime 14        ← view tabs, h-8   │
│  ▔▔▔▔▔▔▔                                                      │
│                                   ↕ 16px (mb-4 on tab row)    │
│  ✦ You have three essays due in nine days.            ×       │  agent nudge (optional)
│                                   ↕ 12px                      │
│  ＋ Add a task…                                                │  quick-add, h-10
│                                   ↕ 8px                       │
│  ☐  Submit CSS Profile correction        Berkeley   due Fri   │  ← rows, 36px
│  ☐  Revise Georgia Tech scholarship essay  Essay · GT      ⚑  │
│  ☐  Research Purdue Honors prompts                            │
│                                   ↕ 24px                      │
│  Due soon 3                                                   │  ← group header, h-7
│                                   ↕ 4px                       │
│  ☐  Polish Common App final paragraph    MIT   overdue Jan 1  │
│                                   ↕ 24px                      │
│  12 done this week →                                          │  footer link
└───────────────────────────────────────────────────────────────┘
```

### 2.3 View tabs

Three views. Logbook is deliberately absent (spec §6.4: reachable from the Today
footer only).

- Container: `flex items-center gap-6 h-8 mb-4`. Left edge at the column's x=0 —
  page chrome, not list content, so it does **not** take the 36px spine.
- Item: `<button>`, `text-sm`, `relative h-8 inline-flex items-center gap-1.5`,
  `cursor-pointer`, `transition-[color] duration-150 ease-out`.
- Inactive: `--ink-faint`. Hover: `--ink-secondary`. **No background on hover** —
  a fill here would compete with the row hover fill 40px below it.
- Active: `--ink` + `font-medium`, plus a `2px` underline in `--brand`, drawn as
  `after:absolute after:inset-x-0 after:-bottom-px after:h-0.5
  after:rounded-full after:bg-[var(--brand)]`.
- Count: `text-sm --ink-faint tabular-nums`, always visible on all three, including
  the active one. Reads `Today 8`, not `Today (8)`.
- **No bottom rule under the tab row.** `PageHeader`'s rule is 24px above it; a
  second horizontal line 8px below the first is the exact "wireframe" failure
  DESIGN.md §3.3 documents.
- Focus: `focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]
  focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]
  focus-visible:rounded-sm outline-none`.
- `role="tablist"` / `role="tab"` / `aria-selected`; `1` `2` `3` shortcuts per spec §9.

### 2.4 Agent nudge (optional, at most one)

Rendered only when the agent has produced one. This is the page's **one tinted
surface** — the product's whole thesis is that a counselor is watching, and one wine
band at the top of an otherwise achromatic page is the composed way to say it.

- `flex items-start gap-2 rounded-md px-3 py-2 mb-3`
- fill `--brand-subtle` (wine-50), **no border, no shadow** — it is an inset-role
  surface (DESIGN.md Law 3: a fill is the entire signal).
- `Sparkles` 14px at `--brand-subtle-ink`, `aria-hidden`, `mt-px` for optical centring.
- text `text-[13px] leading-5 --brand-subtle-ink`, `text-pretty`.
- dismiss: `Button variant="ghost" size="icon"` `size-6 -my-0.5 -mr-1 shrink-0`,
  `X` 14px, `aria-label="Dismiss"`.
- Enter: `opacity 0→1, translateY(-4px)→0`, **200ms `ease-out`**. Exit: `opacity`,
  **150ms**. Reduced motion: opacity only, both.

### 2.5 Group headers

One treatment, every view.

```
      Due soon 3
      ╰─ x = 36px (the spine) — aligns with every task title below
```

| Property | Value |
|---|---|
| box | `flex h-7 items-center pl-[var(--task-row-spine)] pr-2 -mx-2 px-2` … see note |
| name | `text-[13px] font-medium` on `--ink` |
| count | `ml-2 text-[13px] tabular-nums` on `--ink-faint` |
| space above | `mt-6` (24px) on every group except the first in the list |
| space below | `mb-1` (4px) |
| dividers | **none** |

*Box note, exactly:* `class="sticky top-0 z-[var(--z-sticky)] -mx-2 flex h-7 items-center bg-[var(--canvas)] pr-2 pl-[calc(var(--task-row-spine)+--spacing(2))]"`. The
`-mx-2` + `bg-[var(--canvas)]` pair is what lets a hovered row's fill scroll cleanly
underneath a sticky header instead of peeking out at its edges. The `+--spacing(2)`
in the padding compensates the `-mx-2` so the text still lands at exactly 36px from
the *list's* left edge.

**Sticky in Upcoming and Anytime only.** Today has at most two groups; a sticky
header there is machinery for a problem that does not exist.

**The rhythm is the design.** 24px between groups against 0px between rows is a
**6:1 ratio** against the 4px header-to-first-row gap. That single ratio is what
makes a flat list read as composed rather than as a dump. It is a numbered
acceptance criterion (§12.4) precisely because it is the first thing an implementer
will "tidy" into a uniform 12px and destroy.

**Group names, by view** (sentence case, never uppercase — DESIGN.md §6.5 reserves
the app's one uppercase treatment for the sidebar):

- Today: main list has **no header** (the page title is the header). `Due soon` at the
  bottom.
- Upcoming: `Deadlines without a plan` first (see below), then `Today`, `Tomorrow`,
  `Wednesday`, `Thu 11 Sep`… for days 3–7, then `Week of 22 September` ×3, then
  `October`, `November`.
- Anytime: the derived label — `MIT`, `Essay · Yale`, and `Unlabelled` last.
- Logbook: `Today`, `Yesterday`, `Tue 2 Sep`…

**`Deadlines without a plan`** is the one exception header. Same geometry, but its
name renders on `--ink-secondary` rather than `--ink`, and the group is closed by a
`--hairline` rule below its last row (`mt-3 h-px bg-[var(--hairline)]`, full column
width, no negative margins). It is the only rule in the list body, and it exists to
say "this group is a different kind of thing from the dated ones beneath it."

### 2.6 Today footer

`mt-6`, at the spine, `text-[13px] --ink-faint`, `inline-flex items-center gap-1`,
trailing `ArrowRight` 14px. Copy: `12 done this week` (the arrow is the affordance;
do not also write "→" in the string). Hover `--ink-secondary`. Focus-visible
`ring-2 ring-[var(--focus-ring)] ring-offset-2 ring-offset-[var(--canvas)] rounded-sm`.
Opens Logbook.

---

## 3. TaskRow

The most important object in the design. One component; every list, every
application page, every essay page, search results, Logbook.

### 3.1 Geometry

```
 x=0   8      24  36                                                     right edge
 │     │       │   │                                                          │
 ├─────┼───────┼───┼──────────────────────────────────────────────────────────┤
 │  ←8→│  ☐16  │←12│ Submit CSS Profile correction ✦   Berkeley  due Fri  ⚑  │  36px
 ├─────┴───────┴───┴──────────────────────────────────────────────────────────┤
       ╰─ checkbox    ╰─ THE SPINE (x=36px). Titles and group headers only.
```

| Property | ≥768px | <768px |
|---|---|---|
| height | **36px** (`h-9`) | **44px** (`h-11`) |
| horizontal padding | `px-2` (8px) | `px-2` (8px) |
| checkbox column | 16px (`size-4`) | 16px + `pointer-coarse:after` 44px hit area |
| gap checkbox→title | 12px (`gap-3`) | 12px |
| spine (title left edge) | **36px** | **36px** |
| gap title→right zone | 12px (`gap-3`) | 12px |
| right-zone internal gap | 8px (`gap-2`) | 8px |
| row-to-row gap | **0** | **0** |

The 44px touch height follows DESIGN.md §7.2's documented inversion (the app is
tuned *larger* on touch, smaller on desktop). Do not "fix" it to 36px everywhere.

Structure:

```tsx
<li className="…row…">
  <Checkbox />                                  {/* 16px, shrink-0 */}
  <div className="flex min-w-0 flex-1 items-center gap-1.5">
    <span className="truncate">{title}</span>
    {isAgentCreated && <Sparkles />}            {/* 12px */}
  </div>
  <div className="flex shrink-0 items-center gap-2">
    {label}{whenChip}{deadlineChip}{flag}
  </div>
</li>
```

The row is a `<li>` inside `<ul role="list">`; the list is `<ul className="-mx-2">`
so a row's hover fill bleeds 8px past the text column on both sides and reads as a
slab under the words rather than a box around them.

### 3.2 What is visible at rest — the named problem, solved

The current design's core defect is that it shows everything always. The rule that
replaces it, and it is a hard rule:

> **The redundancy rule.** A row never repeats what its group header, its page
> title, or its default value already said.

Applied:

| Element | Visible at rest when |
|---|---|
| Checkbox | always |
| Title | always |
| Agent glyph | `created_by = counselle` — always, but neutral (§9) |
| Derived label | a label exists **and** the group is not already that label |
| When chip | `when` differs from the group's date **and** the group is not date-derived |
| Deadline chip | `deadline ≤ today+7` **or** `deadline < today` |
| Flag | `flagged = true` |
| Reorder grip | never (revealed on hover, Today only — §3.9) |
| Schedule affordance | never (revealed on hover when no When chip — §3.9) |
| `···` menu | **never, in any state.** Deleted. Actions live in the detail panel and on the keyboard. |

Consequence, which is the point: **a Today list of eight tasks renders eight
checkboxes, eight titles, and typically two or three other marks in total.** In
Upcoming, grouped by day, the When chip is suppressed on every row. In Anytime,
grouped by label, the label is suppressed on every row.

### 3.3 Checkbox

Reuse `components/ui/checkbox.tsx` unmodified. Do not build a circle; do not build a
second checkbox.

| State | Appearance |
|---|---|
| rest | `size-4 rounded-[4px]`, `border border-input` (= `--edge-control`, gray-500), no fill |
| row-hover | border → `--edge-control-strong` (gray-600, 3.61:1). Inherited from the primitive's own hover; if absent, add `group-hover/row:border-[var(--edge-control-strong)]` |
| own hover | same as row-hover; no fill change |
| focus-visible | `border-ring` + `ring-3` at `--focus-ring` (primitive default) |
| checked | `bg-primary` (= `--brand`, wine-600), `border-primary`, `CheckIcon` 14px in `--primary-foreground` |
| disabled | `opacity-64` (migrate the primitive from its current `opacity-50` while you are here — DESIGN.md debt #11) |

The primitive already ships `after:-inset-x-3 after:-inset-y-2`, giving a 40×36px hit
area at rest. On coarse pointers add `pointer-coarse:after:min-h-11
pointer-coarse:after:min-w-11`.

Clicking the checkbox must `stopPropagation` so it never also opens the detail panel.

### 3.4 Title

| | Value |
|---|---|
| type | `text-sm` (14px) `font-normal` (400) `leading-5` |
| colour | `--ink` (gray-900) |
| overflow | `truncate` — single line, always. **Never `line-clamp-2`** |
| `title` attr | the full title, so a truncated row is still readable on hover |

**`font-normal`, not `font-medium`.** This is deliberate and it is the load-bearing
typographic decision on the page. Forty medium-weight titles is a wall. The only
`font-medium` in the list body is the group header, so weight alone carries the
hierarchy — which is DESIGN.md principle 1.3.2 ("hierarchy comes from surface and
weight, not from chrome") taken literally.

Click opens the detail panel. Double-click enters inline edit: the title becomes a
borderless `Input` sized to the row, `--surface-inset` fill, `rounded-sm`,
`ring-[3px] --focus-ring`, `-mx-1 px-1` so the text does not shift. Enter commits,
Escape reverts, blur commits (DESIGN.md §17.3, autosave on blur, no Save button).

### 3.5 Agent glyph

`Sparkles` from lucide, **12px**, `--ink-faint`, `shrink-0`, sat 6px after the title
(`gap-1.5` on the title flex row), `aria-hidden="true"`, with an adjacent
`<span className="sr-only">Created by Counselle</span>`.

**It takes no hue.** DESIGN.md §14.2 already decided this exact question and wrote
down why: "'Assigned to Counselle' was drawing the done green; it is not a completed
task." In this product Counselle creates most tasks, so an agent glyph with a hue
would light up 60% of every list — which is Law 2's "the ordinary state of a record
gets no colour," verbatim.

### 3.6 Derived label

**Plain text. Not a badge, not a chip, no fill, no border.**

| | Value |
|---|---|
| type | `text-xs` (12px) `font-normal` `leading-4` |
| colour | `--ink-faint` (gray-700) |
| content | `Berkeley` · `Essay · Georgia Tech` · `Financial aid` — per spec §2.3 |
| overflow | `truncate max-w-[7rem] sm:max-w-[11rem]` |
| separator | the `·` is `U+00B7` with hair spaces, rendered in the same colour — no lighter middot, that is fussy |

This is the second load-bearing decision. Forty grey `Badge` chips down the right
side *is* the bland-grey-list failure, arriving disguised as design-system
compliance. The grammar that replaces it:

> **Chip-shape means interactive. Plain text means informational.**

Only two things on this page are ever chip-shaped: the When chip (§3.7, and only
under the cursor) and the agent-change chip (§9.4). Everything else is type.

This is not a new invention — it is DESIGN.md §15.4's sources-rail rule ("a source
is a row, not a card: no fill, no border, no shadow… a fill only appears when the row
reacts") applied one level down, to the meta inside a row.

### 3.7 When chip

Interactive: opens the scheduler popover (§6).

| State | Appearance |
|---|---|
| rest | `text-xs tabular-nums --ink-secondary`, `rounded-sm px-1.5 -mx-1.5 h-5 inline-flex items-center`, **background `transparent`** |
| own hover | background `--surface-inset`; nothing else changes |
| own active | background `--control-quiet-active` |
| focus-visible | `ring-2 ring-[var(--focus-ring)] ring-offset-1 ring-offset-[var(--canvas)]` |
| open (popover showing) | background `--surface-inset`, held |

The `px-1.5 -mx-1.5` pair is mandatory: the padding is **always** present so the
background can appear on hover with **zero layout shift**. An implementer who adds
padding on hover has introduced a 12px jitter on the most-hovered element on the page.

Content: `Today` · `Tomorrow` · `Fri` (within 7 days) · `Fri 12 Sep` (beyond) ·
`12 Sep 2027` (different year). Never a bare ISO date.

`aria-label={`Reschedule ${title}, currently ${whenLabel}`}`.

### 3.8 Deadline chip

**The honesty surface of this row.** Not a chip in the visual sense — plain text,
`shrink-0`, `text-xs tabular-nums`, structured as a faint word plus a stated date so
that status is never colour alone (DESIGN.md rule 35). This also fixes, rather than
repeats, the known violation logged in §14.3 against `school-cells.tsx` ("a red date
and nothing else — no icon, no label").

| State | Condition | Word | Date | Glyph |
|---|---|---|---|---|
| **normal** | `today+3 < deadline ≤ today+7` | `due` in `--ink-faint` | `--ink-secondary` `font-normal` | none |
| **due soon** | `today ≤ deadline ≤ today+2` | `due` in `--ink-faint` | `--warning-fg` (amber-800) `font-medium` | none |
| **overdue** | `deadline < today` | `overdue` in `--danger-fg` `font-medium` | `--danger-fg` `font-medium` | `CircleAlert` 12px, `--danger-fg`, leading, `aria-hidden` |
| **hidden** | `deadline > today+7` or null | — | — | — |

Rendered: `due Fri` · `due Sat` (amber date) · `⚠ overdue Jan 1` (all red).

`aria-label` on the overdue span: `Overdue — deadline was 1 January`.

**Three deliberate refusals:**

1. **`≤ today+2` for amber, not `≤ today+7`.** Seven days of amber in a seven-day
   window paints the whole Due-soon section amber and the signal dies. Two days out
   of seven means at most two amber dates on any screen.
2. **No red fill, no red border, no red row background, no coloured left border.**
   Overdue is *ink*. Red 12px text at `--danger-fg` (red-700) on gray-50 is loud
   enough to find in a scan of forty rows, and three of them do not turn the page red
   the way three red pills would. A `border-left` accent is banned outright.
3. **The deadline does not get a calendar icon.** Two calendar-ish glyphs on one row
   (When and Deadline) is exactly the ambiguity the whole two-date model exists to
   remove. Words disambiguate; icons do not.

### 3.9 Flag

`Flag` from lucide, **14px**, `fill="currentColor"`, colour **`--brand`** (wine-600),
`shrink-0`, last item in the right zone.

**Claim, in one sentence, as DESIGN.md §22 requires:** *the flag is not a state of
the task — it is the student's own mark on it, which is the same claim `--brand`
already makes for "the current selection," and keeping it out of red is what lets red
mean exactly one thing on this page: a date the world has already passed.*

This is a deliberate, documented refinement of DESIGN.md §14.2, which maps
`priority: high → error`. That mapping was correct when priority was a three-step
scale in a badge; here `flagged` is a boolean the *student* sets, and the row already
has a red channel that means something else. Write the sentence above as a comment at
the site in `task-config.ts`.

Interactive: click toggles (`f` from the keyboard). Same hover treatment as the When
chip — `rounded-sm p-0.5 -m-0.5`, background `--surface-inset` on hover.
Unflagged rows show nothing; there is **no ghost outline flag** at rest, and no
flag affordance revealed on hover (`f` and the detail panel header are the paths).

### 3.10 Revealed on hover / focus

Two things, both `opacity-0 → opacity-100`, `transition-[opacity] duration-150
ease-out`, gated behind `@media (hover: hover) and (pointer: fine)` so a tap on
touch does not trigger them (Emil: touch devices fire hover on tap).

1. **The schedule affordance.** When a row has no When chip (the common case in
   Today and Upcoming, by the redundancy rule), row-hover reveals a `CalendarPlus`
   14px button at `--ink-faint` in the When chip's exact slot, opening the same
   scheduler. Because the slot is reserved by an `h-5 w-5` placeholder at rest, **no
   layout shift occurs.** Keeps "reschedule from any surface in ≤2 clicks" true
   (spec §13) without permanent chrome.
2. **The reorder grip, Today only.** `GripVertical` 14px at `--ink-faint`,
   `cursor-grab` / `active:cursor-grabbing`. It lives in a 16px gutter that belongs
   to the **list container**, not the row: in Today the `<ul>` takes `pl-4` and the
   grip is absolutely positioned at `left-0`, vertically centred. The row's own
   geometry — and the 36px spine — is byte-identical across all four views. Per
   DESIGN.md §17.5 the drag is armed by pointerdown on the grip only.
   Coarse pointers: hidden entirely; `⌥↑/↓` is the accessible and mobile path.

Both must be reachable without a pointer: they appear on
`:focus-within` as well as `:hover`.

### 3.11 Row states

| State | Fill | Other |
|---|---|---|
| **rest** | none (`--canvas` shows through) | no border, no shadow, ever |
| **hover** | `--canvas-hover` (4% ink into canvas, `in oklab`) | `rounded-md` (8px); `transition-[background-color] duration-150 ease-out` |
| **pressed** | `--canvas-active` (7%) | same radius; no transform, no scale |
| **focus-visible** | `--canvas-hover` | `ring-2 ring-[var(--focus-ring)] ring-offset-1 ring-offset-[var(--canvas)] rounded-md outline-none` |
| **selected** (detail panel open on this row) | `--surface-selected` (wine 10% into canvas) | `rounded-md`, no ring. Holds while the panel is open |
| **selected + hover** | `--task-row-selected-hover` (§10) | |
| **done, animating out** | see §4 | |
| **pending / saving** | `opacity-64` on the whole row | right zone replaced by `Saving…`, `text-xs --ink-faint` |
| **failed** | rest fill | right zone: `Couldn't save` `text-xs --ink-faint` + `Retry` ghost button; `role="alert"` on the message |

`rounded-md` (8px) not `rounded-lg` (10px): on a 36px-tall slab, 10px starts to read
as a pill. 8px is the ladder's "a control inside a control," which is what a row in a
list is.

**No hover border. No hover shadow. No hover transform. No scale on press.**
DESIGN.md rules 23 and 31; both were tried in this codebase before and rejected.

### 3.12 Overflow and responsive

Title is `min-w-0 flex-1 truncate`; right zone is `shrink-0`. The title always
yields first, which is correct — the title is recoverable by hover/open, the dates
are not.

Right-zone drop order under width pressure, most-dropped first:

1. **When chip** — `hidden sm:inline-flex` when a Deadline chip is also present.
   (It is usually already suppressed by the redundancy rule.)
2. **Derived label** — `max-w-[7rem]` truncation below `sm:`, never removed.
3. **Deadline chip** — never dropped.
4. **Flag** — never dropped.

| Viewport | Row | Column | Detail | Notes |
|---|---|---|---|---|
| **375px** | `h-11` (44px) | 327px (`px-6` gutters) | bottom `Sheet` | Grip hidden. Right zone caps at `max-w-[50%]`. Tab row fits at `text-sm`. Scheduler stays an anchored popover (280px fits) with `collisionPadding: 12`. |
| **768px** | `h-9` (36px) | ≈672px minus the 48px collapsed rail | bottom `Sheet` | All right-zone items visible. Sticky group headers active. |
| **1440px** | `h-9` (36px) | **896px, centred** | docked 416px aside | List does not stretch; the `max-w-4xl` cap is the point. |

The detail panel becomes a docked aside at `lg:` (1024px), not `md:` — below 1024px
a 416px panel leaves under 300px of list, which is worse than a sheet.

---

## 4. Completion motion

The single most-repeated interaction in the product. Choreographed to the
millisecond; every value below is from DESIGN.md §12.2–12.3 or justified inline.

### 4.1 The timeline

```
 t=0                   120           300                440
 │                     │             │                  │
 ├─ checkbox fills ────┤             │                  │
 ├─ strike draws ──────────┤ (180)    │                  │
 ├─ title fades to faint ─────┤ (200) │                  │
 │                                    ├─ row fades ──────┤
 │                                    │                  ├─ row unmounts
 │                                    │                  ├─ siblings spring up
 │                                    │                  ├─ counter decrements
 │                                    │                  ├─ undo toast enters
```

**1. Checkbox — `t=0`, `120ms`, `ease-out`.**
Background `transparent → --brand` and border `--edge-control → --brand`, both
`transition-[background-color,border-color] duration-[120ms] ease-out`. The
`CheckIcon` indicator: `opacity 0→1` and `scale(0.8)→scale(1)`, same 120ms ease-out.
**Never `scale(0)`** — nothing in the real world appears from nothing.

120ms, not 150ms: this is direct press feedback, and Emil's button-press band is
100–160ms. It must land before the user's finger lifts.

**2. Strike-through — `t=0`, `180ms`, `ease-out`.**
A `::after` overlay on the title span:

```css
.task-title::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  top: 50%;
  height: 1px;
  background: var(--ink-faint);
  clip-path: inset(0 100% 0 0);
  transition: clip-path 180ms ease-out;
}
[data-done="true"] .task-title::after { clip-path: inset(0 0 0 0); }
```

`clip-path` is compositor-safe — no layout property is touched, so DESIGN.md rule 28
is satisfied without an exception comment. The rule *draws* left-to-right, which
reads as the act of crossing something off rather than as a state flipping.

**3. Title colour — `t=0`, `200ms`, `ease-out`.** `--ink → --ink-faint`,
`transition-[color]`. Slightly slower than the strike so the line arrives first and
the text settles behind it.

**4. Row exit — `t=300`, `140ms`, `ease-out`.** `opacity 1 → 0` only. No translate,
no scale, no height. The 300ms hold is spec §3's stated dwell and it is load-bearing:
it is the window in which the student sees the thing they just did.

**5. Siblings — `t=440`.** `AnimatePresence` unmounts; siblings carry
`layout="position"` and the **existing tasks spring, reused not reinvented**:
`{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }` (DESIGN.md §12.3).

`layout="position"` and not `layout`: position-only means no height is animated, so
the vacated 36px closes instantly while the rows below *travel*. Animating height
would be a layout property with an alternative available, which rule 28 forbids.

**6. Group count — `t=440`.** Decrements. `tabular-nums` guarantees no reflow.
If a group empties, it unmounts with `opacity 140ms ease-out` and the next group
springs up with the same preset.

**7. Undo toast — `t=440`.** Existing 5s sonner. Entering at 440 rather than 0 keeps
it from competing with the row for attention during the moment that matters.

### 4.2 Un-checking (Logbook)

Not a mirror — restoration should feel like a correction, not a ceremony.
Checkbox empties in `100ms ease-out`; strike retracts `clip-path` in `120ms ease-out`
(exit faster than enter, ~65%); the row leaves the Logbook at `t=200` with the same
140ms fade. No spring on re-entry into the destination list — the student is not
looking at it.

### 4.3 `prefers-reduced-motion: reduce`

Not "no animation" — fewer and gentler, and the *pacing* is preserved so the
interaction stays legible.

| Step | Reduced-motion behaviour |
|---|---|
| Checkbox | colour change only, 120ms. No `scale` on the indicator. |
| Strike | `text-decoration-line: line-through` applied instantly at `t=0`; the `::after` overlay is `display: none`. |
| Title colour | unchanged — 200ms colour transitions are safe and aid comprehension. |
| Row exit | `opacity`, **100ms**, still starting at `t=300`. |
| Siblings | `transition={{ duration: 0 }}` — instant reflow, no spring. |
| Nudge / panel / popover | opacity-only variants, durations unchanged. |

Implement via `useReducedMotion()` from `motion` for the `motion.*` components and
`@media (prefers-reduced-motion: reduce)` for the `::after` rule (DESIGN.md §12.5).

---

## 5. Quick-add bar

The affordance the whole spec hangs on. Its design idea: **it is the same shape as
the thing it creates**, and it is invisible until you need it.

### 5.1 The three states

```
 rest       ＋  Add a task…                                      transparent
 hover      ＋  Add a task…                                      --canvas-hover
 focus      ＋  Berkeley CSS Profile [fri]                       --surface-raised + border + ring
```

| Property | Rest | Hover | Focus |
|---|---|---|---|
| height | `h-10` (40px) all viewports | " | " |
| padding | `px-2` | " | " |
| fill | `transparent` | `--canvas-hover` | `--field-surface` (= `--surface-raised`) |
| border | `border border-transparent` | `border-transparent` | `border-[var(--edge-control)]` |
| ring | none | none | `ring-[3px] ring-[var(--focus-ring)]` |
| radius | `rounded-md` | `rounded-md` | `rounded-md` |
| leading glyph | `Plus` 16px `--ink-faint` at the checkbox slot (x=8..24) | " | " |
| input left edge | **36px — the spine** | " | " |
| text | `text-sm --ink` | " | " |
| placeholder | `Add a task…` at `--ink-placeholder` | " | " |
| shadow | none | none | none |

`h-10` fixed and `border-transparent` at rest: both exist so that **nothing shifts by
a pixel** when the bar activates. An implementer who adds the border only on focus
has introduced a 1px jump on the most-focused element in the feature.

Focus treatment is DESIGN.md §11.4's form-control rule verbatim
(`focus-visible:border-ring focus-visible:ring-[3px]`), and `ring-[3px]` not
`ring-2` — this is a form control, and moving controls to 3px on touch is the
sanctioned direction of that split.

Placeholder copy, per spec §4.1: `Add a task…` — the spec's fuller
`Add a task… e.g. "Berkeley CSS Profile fri"` is too long for 860px at 14px on
mobile. Instead: placeholder is `Add a task…`; the example lives in a **hint line
shown only on first focus of a session**, `mt-1.5 pl-9 text-xs --ink-faint`, reading
`Try "Berkeley CSS Profile fri" — dates are picked up as you type.` Dismisses on
first successful create and does not return.

Keyboard: `n` focuses from anywhere (guarded so it does not fire while typing);
`Esc` blurs and clears. Enter creates and **returns focus to the input**, cleared,
ready for the next — never a modal, never a ghost row.

### 5.2 Inline parsed tokens

Implemented as a **mirror layer**: an absolutely-positioned `<div aria-hidden>`
rendering the same string with token `<span>`s, behind an `<input>` with
`color: transparent` and `caret-color: var(--ink)`. Both share identical
`font`, `letter-spacing`, `padding` and `line-height`.

**This technique already exists in this codebase** — the composer's skill highlight,
`--workspace-composer-skill-highlight` / `-underline` /
`-radius` in `workspace.css`. Reuse the mechanism; do not invent a second one.

| Token state | Fill | Ink | Shape |
|---|---|---|---|
| parsed | `--task-parse-token-surface` (→ `--brand-subtle`, wine-50) | `--task-parse-token-ink` (→ `--brand-subtle-ink`) | `rounded-sm px-0.5 -mx-0.5` |
| parsed + hover | `--task-parse-token-hover` (→ `--brand-chip`, wine-100) | unchanged | `cursor-pointer` |
| un-parsed (clicked off) | none | `--ink` | none |

- `px-0.5 -mx-0.5` again: the padding is always in the mirror's box model, so
  toggling the fill never re-flows the mirror out of register with the input.
  **A mirror that drifts one pixel from its input is the single most visible bug
  this component can have. Verify it at 375px and at 1440px, in the browser.**
- **Un-parse affordance:** token spans get `pointer-events: auto` (the mirror layer
  is `pointer-events: none` otherwise). Click reverts the token to plain ink and
  excludes that exact substring from parsing for the remainder of this input
  session. `title="Keep as text"`; `cursor-pointer`; no underline, no ×, no tooltip
  chrome — the hover fill change is the entire affordance, which is the same
  restraint the rest of the row uses.
- Transition on the fill: `transition-[background-color] duration-150 ease-out`.
- **Only one hue.** `@school`, `#essay`, dates, `by …` and `!` all take the same
  wine tint. Colour-coding token *kinds* would put four hues in one input and is
  precisely the Law 2 violation this design system was built to end.

### 5.3 Waiting hint (spec §4.3)

Triggered when the title contains `waiting on` / `waiting for` / `wait for` and no
date parsed. Renders **below** the input, outside its focus ring:

```
 ＋  waiting on Ms. Lee's rec letter                              [focused field]
      When should you check on this?   Today  Tomorrow  Next week  Pick a date
      ╰─ x=36, the spine
```

- container `mt-1.5 pl-9 flex flex-wrap items-center gap-2`
- question `text-xs --ink-secondary`, exactly: `When should you check on this?`
- chips: `h-7 rounded-md px-2 text-[13px] --ink-secondary`, fill
  `--control-quiet-surface`, hover `--control-quiet-hover`, active
  `--control-quiet-active`, `focus-visible:ring-2 ring-[var(--focus-ring)]`.
  Four of them: `Today` `Tomorrow` `Next week` `Pick a date`.
- Enter without choosing → the task lands in Anytime. The hint never blocks submit.
- Enter/exit: `opacity` + `translateY(-4px)`, **150ms `ease-out`**. Reduced motion:
  opacity only.

### 5.4 Pending and retry (spec §4.4)

The row appears in the list **immediately** on Enter, at `opacity-64`, right zone
showing `Saving…` in `text-xs --ink-faint`. The input is **not** cleared until the
server confirms.

On failure: opacity returns to 1; right zone shows `Couldn't save` (`text-xs
--ink-faint`) followed by a `Retry` `Button variant="ghost" size="sm"` at
`text-xs h-6 px-1.5`. The message carries `role="alert"`. Auto-retry runs twice with
backoff before the manual button appears. **No modal, no toast, no red.** A network
blip is not a danger state, and spending the page's only red on it would cost the
overdue signal its meaning.

---

## 6. Scheduler popover

One component. Row chip, quick-add hint, both detail-panel date rows, agent-proposed
dates — all of them.

### 6.1 Shell

| Property | Value |
|---|---|
| width | **`w-[280px]`**, fixed in both modes (see §6.3 — nothing resizes) |
| fill | `--surface-overlay` (= `--surface-raised`, gray-25) |
| border | **none** |
| shadow | `--elevation-2` |
| radius | `rounded-lg` (10px — a control) |
| padding | `p-1.5` (6px) |
| z-index | `z-[var(--z-dropdown)]` |

Borderless: DESIGN.md rule 11 — `--elevation-2` (12px blur) must not share an
element with a border. A 1px border plus a 12px shadow is the banned glassy look.

### 6.2 Rows — single column, not a 2×2 grid

The spec's ASCII shows a 2×2 chip grid. **Use a single column of six rows instead.**
Behaviour is identical; the reason is that every row then has the same shape, which
lets each one carry its resolved date *and* its shortcut without three columns
fighting for 280px. Showing the resolved date is an honesty win — "next week" is
otherwise a guess.

```
┌──────────────────────────────────┐  280px
│  Today              Sep 4    [T] │  h-8
│  Tomorrow           Sep 5    [M] │
│  This weekend       Sep 6    [W] │
│  Next week          Sep 8    [K] │
│  ────────────────────────────    │  --hairline
│  Pick a date…                [P] │
│  Anytime                     [A] │  ("No deadline" in deadline mode)
└──────────────────────────────────┘
```

| Part | Spec |
|---|---|
| row | `h-8 rounded-md px-2 flex items-center gap-2 cursor-default w-full text-left` |
| label | `text-[13px] --ink`, `flex-1` |
| resolved date | `text-xs tabular-nums --ink-faint`, right-aligned before the Kbd |
| shortcut | `<Kbd>` primitive, `h-5 min-w-5`, `bg-muted text-muted-foreground text-xs` |
| hover / keyboard-highlight | background `--surface-hover` (4% into raised) |
| pressed | `--surface-active` (7%) |
| current value | `--brand-subtle` fill + `--brand-subtle-ink` label + a `Check` 14px in place of the Kbd |
| separator | `my-1.5 -mx-1.5 h-px bg-[var(--hairline)]` |
| `Anytime` label | reads **`No deadline`** when the popover is editing `deadline` (spec §5) |

`Today` shows no resolved date (it would read `Today  Sep 4  T` — the date is the
word). `Pick a date…` and `Anytime` show no date.

Shortcuts are always visible, not hover-revealed. This popover is where the keyboard
map (spec §9) gets taught, and a hidden hint teaches nothing.

### 6.3 Calendar mode

`Pick a date…` swaps the popover's contents **in place**. The shell is already
`w-[280px]`; it does not resize.

- Reuse `components/ui/calendar.tsx`. Month grid only, **no time selection**
  (spec §5, and §2.5 — `when` and `deadline` are dates, not datetimes).
- Selected day: `--brand` fill, `--on-brand` numeral, `rounded-md`.
- Today (when not selected): the numeral in `--brand` `font-medium`, plus a
  **3px `--brand` dot centred 2px below the numeral**. Not a ring — a ring on today
  beside a fill on selected is two competing rings in one grid.
- Hovered day: `--surface-hover`, `rounded-md`.
- Outside-month days: `--ink-disabled`, not rendered as clickable.
- Header: month name `text-[13px] font-medium --ink`, `‹ ›` as
  `Button variant="ghost" size="icon" className="size-7"`.
- A back affordance returns to the list: a `ChevronLeft` + `Back` row at the top,
  `h-7 text-xs --ink-faint`.
- `Escape` closes the whole popover from either mode (does not step back).

**The swap:** crossfade, **120ms `ease-out`**, with `filter: blur(2px)` on the
outgoing layer for the duration. The blur bridges two differently-shaped contents so
the eye reads one transformation rather than two objects trading places. Blur is
capped well under the 20px Safari-cost threshold. Reduced motion: plain 100ms
crossfade, no blur.

### 6.4 Enter / exit

| | Properties | Duration | Easing |
|---|---|---|---|
| enter | `opacity 0→1`, `scale(0.97)→scale(1)` | **150ms** | `ease-out` |
| exit | `opacity 1→0` | **100ms** | `ease-out` |

- `transform-origin: var(--transform-origin)` from Base UI's popover, so it scales
  **from the chip that opened it**, not from its own centre.
- `scale(0.97)`, never `scale(0)`.
- Exit is opacity-only and ~65% of enter — exits should feel like the system getting
  out of the way.
- 150ms sits in Emil's 125–200ms band for small popovers; DESIGN.md's 200ms "base"
  tier is for full surfaces (sheets, rails), which this is not.
- Reduced motion: opacity only, same durations.

---

## 7. Detail panel

### 7.1 Shell

| Viewport | Presentation |
|---|---|
| `< lg` (1024px) | `Sheet` from the bottom, full width, `max-h-[85dvh]`, `rounded-t-2xl` |
| `≥ lg` | Docked right `<aside>`, **`w-[26rem]` (416px)**, full height |

416px reuses the sources rail's established docked-aside width (DESIGN.md §15.4) —
one docked-panel width in the app, not two.

Docked surface: `--surface-raised` fill, `border-s border-[var(--edge)]`,
`--elevation-0`. It is **content you edit**, not chrome, so unlike the sources rail
it does not sit on `bg-sidebar`. The list has no raised level, so the panel is the
page's single raised object — rule 9 satisfied.

**Reflow:** while open at `≥ lg`, the `PageContainer` body column takes
`lg:pr-[26rem]`. The padding **snaps at `t=0`** (no transition) while the panel
slides in over 200ms. Animating `padding-right` would be a layout property with a
perfectly good alternative; the instantaneous shift under an arriving panel reads as
the panel pushing, which is what you want anyway.

Panel enter: `opacity 0→1`, `translateX(16px)→0`, **200ms `ease-out`** (base tier,
"enter/exit of surfaces"). Exit: `opacity`, `translateX(12px)`, **150ms `ease-out`**.
Reduced motion: opacity only, both.

### 7.2 Contents — 6 rows and one footer, nothing else

```
┌─ w-[26rem], p-6 ──────────────────────────────┐
│  ⚑                                       ×    │  header, h-8
│                                               │  ↕ 16px
│  Submit CSS Profile correction               │  ① title, text-lg
│  for Berkeley                                 │
│                                               │  ↕ 16px
│  Double-check parent income line, attach     │  ② notes
│  the translated bank note, then confirm.     │
│                                               │  ↕ 16px
│  ─────────────────────────── --hairline ──── │
│                                               │  ↕ 16px
│  When       Friday 5 September                │  ③
│  Deadline   Jan 1 · from Berkeley             │  ④
│  Link       Berkeley · CSS Profile essay      │  ⑤
│                                               │
│  ───────────────────────────────────────────  │  --hairline
│  Created Sep 2 by Counselle · Updated 3h ago  │  footer
└───────────────────────────────────────────────┘
```

**Header** — `flex h-8 items-center justify-between`.
- Flag toggle (⑥): `Button variant="ghost" size="icon" className="size-8"`,
  `Flag` 16px. Unflagged: outline glyph at `--ink-faint`. Flagged:
  `fill="currentColor"` at `--brand`. `aria-pressed`, `aria-label="Flag task"`.
- Close: same button spec, `X` 16px, `aria-label="Close"`. `Escape` also closes.

**① Title** — auto-growing borderless `Textarea`. `text-lg` (18px) `font-medium`
`leading-snug` `--ink`, `text-balance`. Not `text-xl` — that size is reserved for
the page title (DESIGN.md §6.2), and a task title outranking the page it lives on is
wrong.

**② Notes** — `text-sm leading-relaxed --ink-secondary`, `min-h-[4.5rem]`,
auto-grow, placeholder `Add notes` at `--ink-placeholder`.

**③–⑤ Field rows** — a `<dl>` at `gap-3` (12px):
- `<dt>` `w-20 shrink-0 text-xs --ink-faint`, values: `When`, `Deadline`, `Link`.
- `<dd>` `text-sm --ink`, a button opening the scheduler (③④) or the combined
  school/essay picker (⑤).
- Absent values render as **words**, never blank (rule 34): `Anytime`,
  `No deadline`, `Not linked`, at `--ink-placeholder`.
- **④ Deadline inheritance** (spec §2.4): when `deadline` is null and the linked
  application has one, render `Jan 1` in `--ink-secondary` followed by
  `· from Berkeley` in `--ink-faint text-xs`. No italic — italic is reserved in this
  app for evidence excerpts (§15.4) and borrowing it here dilutes that.
- **⑤ Link**: `Berkeley` in `--ink`, and when an essay is set,
  `· CSS Profile essay` in `--ink-secondary`. One picker; choosing an essay sets both.

**The editability signal — one rule for all five editable regions.** This is the
answer to "signals editability without shouting," and it must be identical
everywhere:

| State | Treatment |
|---|---|
| rest | nothing. No border, no fill, no underline, no pencil icon. |
| hover | `--surface-hover` fill (4% into the raised panel), `rounded-md`, with `-mx-2 px-2 -my-1 py-1` so the fill hugs the text without moving it. `transition-[background-color] duration-150 ease-out`. |
| focus | `--surface-inset` fill, `ring-[3px] ring-[var(--focus-ring)]`, `rounded-md`, **no border**. Same negative-margin padding. |

Same negative-margin trick as everywhere else in this spec: padding is always
present, only the fill appears. Autosave on blur, no Save/Cancel (DESIGN.md §17.3).

**Footer** — `mt-auto pt-4 border-t border-[var(--hairline)]`, one line,
`text-xs --ink-faint`, `truncate`: `Created Sep 2 by Counselle · Updated 3h ago`.
Not `tabular-nums` — these are words with dates in them, not a numeric column.

---

## 8. Empty states

`Empty` primitive with `variant="icon"`, which ships two rotated ghost copies of the
glyph behind the real one (DESIGN.md §10.4) — depth without a shadow, and the exact
reason this feature needs **no illustration**. Icon 24px at `--ink-faint`.

Shape, per §13.2: icon + title + one sentence + at most one primary and one
secondary CTA. Sentence case, second person, present tense, say the noun.

| Surface | Icon | Title | Sentence | Actions |
|---|---|---|---|---|
| **Today** (nothing planned) | `CalendarCheck` | **Nothing planned** | Pull something over from Upcoming, or ask Counselle to plan your day. | `[Plan with Counselle]` `[Go to Upcoming]` |
| **Today** (all done) | `CheckCheck` | **Today is done** | Everything you planned for today is finished. | `[Open logbook]` |
| **Upcoming** | `CalendarDays` | **Nothing scheduled ahead** | Give a task a When date and it will show up here. | `[Go to Anytime]` |
| **Anytime** | `Inbox` | **Nothing waiting** | Tasks with no date live here. Add one above. | none — the quick-add is 40px away |
| **Logbook** | `Archive` | **Nothing completed yet** | Finished tasks land here, newest first. | none |
| **Search** (§13.3 filtered-to-zero, not empty) | `Search` | **No tasks match** | Nothing matches "{query}" in open or done tasks. | `[Clear search]` |

Layout: centred in the column, `py-16` (Today/Upcoming/Anytime/Logbook) or `py-12`
(search, which sits under a live query and should not push it off-screen). Title
`text-sm font-medium --ink`; sentence `text-sm --ink-secondary text-pretty
max-w-[36ch]`; CTAs `Button size="sm"`, primary `variant="default"`, secondary
`variant="ghost"`.

Two rules the implementer will be tempted to break:

1. **Search-no-results is a different template from empty.** The user has data; a
   filter is hiding it. Name what is responsible and offer to relax it (§13.3).
   Never show "Nothing completed yet" to someone who typed a query.
2. **The Today empty state is not an achievement screen.** No confetti, no "Great
   job!", no illustration of a person. Things 3's Today does not go red when you fail
   and does not throw a party when you succeed; that emotional flatness is the
   feature.

---

## 9. Colour and semantics

### 9.1 The complete permitted list

This is the whole palette for this feature. Anything not on this list is a bug.

| Token | Resolves to | Where it may appear | The one claim it makes |
|---|---|---|---|
| `--canvas` | gray-50 | the page ground behind every row | — |
| `--canvas-hover` | 4% ink into canvas | row hover, quick-add hover | — |
| `--canvas-active` | 7% ink into canvas | row pressed | — |
| `--surface-raised` | gray-25 | detail panel, quick-add on focus, popover | — |
| `--surface-hover` / `--surface-active` | 4% / 7% into raised | popover rows, panel field hover | — |
| `--surface-inset` | gray-150 | When-chip hover, panel field focus, calendar track | — |
| `--surface-selected` | wine 10% into canvas | the row whose panel is open | the current selection |
| `--hairline` | gray-300 | the two rules in the panel, the one under "Deadlines without a plan" | — |
| `--edge` | gray-400 | the docked panel's left seam | — |
| `--edge-control` / `-strong` | gray-500 / 600 | checkbox border rest / hover; quick-add focus border | — |
| `--ink` | gray-900 | row titles, group names, panel title, active tab | — |
| `--ink-secondary` | gray-800 | When chip, normal deadline date, notes, page subtitle | — |
| `--ink-faint` | gray-700 | derived label, counts, the word "due", agent glyph, footer, inactive tab | — |
| `--ink-placeholder` | gray-700 | quick-add placeholder, absent field values | — |
| `--ink-disabled` | gray-650 | outside-month calendar days | — |
| **`--brand`** | wine-600 | **the flag glyph · the active tab underline · the checked checkbox · the selected calendar day** | the student's own mark, and the current selection |
| `--brand-subtle` / `-ink` | wine-50 / wine-ink-on-50 | the agent nudge · parsed tokens · the popover's current value | — |
| `--brand-chip` | wine-100 | parsed-token hover | — |
| **`--warning-fg`** | amber-800 | **a deadline date, and only when `deadline ≤ today+2`** | this needs you, soon |
| **`--danger-fg`** | red-700 | **the word `overdue`, its date, and its `CircleAlert`. Nothing else.** | the world has already passed this date |
| `--focus-ring` | wine-500 | every focus ring in the feature | — |

**Not permitted anywhere in this feature:** `--success-*` (nothing here is "done" for
longer than 440ms), `--danger-surface` / `-border` (overdue is ink, never a fill),
`--warning-surface` / `-border`, `--label-surface` (§3.6 killed the chip),
`--brand-scale-*` (nothing here is an ordered scale), any `info`/blue (there is none),
any new hue.

### 9.2 How overdue reads without the page turning red

Four mechanisms, stacked:

1. **Red is ink, not surface.** No fill, no border, no row tint, no left stripe.
   Twelve-pixel red type on gray-50 is a strong scan target without occupying area.
2. **Red has exactly one owner on the page.** Not priority (that is wine now, §3.9),
   not errors (a failed save is `--ink-faint` text, §5.4), not danger buttons (there
   are none in the list). One meaning, so it never has to be disambiguated.
3. **Amber absorbs the near misses.** `today` … `today+2` is amber, so the red
   population is only genuinely-missed dates — typically 0–2 rows.
4. **Word + glyph + hue.** `⚠ overdue Jan 1` survives colourblindness, greyscale
   printing, and a screen reader. Rule 35 satisfied triple-redundantly, on the model
   `VerdictBand` already sets (§14.3).

### 9.3 How the agent's presence is signalled

Three distinct signals, deliberately at three different volumes:

| Signal | Treatment | Why that volume |
|---|---|---|
| **created by Counselle** (permanent) | `Sparkles` 12px, `--ink-faint`, after the title | It is the *ordinary* case in this product. Law 2's corollary: the ordinary state of a record gets no colour. |
| **changed by Counselle** (transient, 24h — spec §8.3) | a real chip: `text-xs px-1.5 h-5 rounded-sm`, `--brand-subtle` fill, `--brand-subtle-ink`, reading `Counselle` | It is temporary and it is a claim about something that just happened to a record the student did not touch. Chip-shape is earned. |
| **the nudge** (page level, at most one) | `--brand-subtle` band, §2.4 | It is the agent *speaking*, not a status. |

Ordering in the right zone when the change chip is present: it displaces the derived
label for its 24 hours (`label` is `hidden` while `changedByAgent` is true). Two
context marks on one row is one too many, and the recent change is the more urgent of
the two.

### 9.4 Cross-check against DESIGN.md §14, explicitly

| DESIGN.md §14 says | This spec does | Status |
|---|---|---|
| Five badge variants, no others | Uses **zero** badges in the list body. The only badge-shaped object is the agent-change chip, which is bespoke `--brand-subtle` and not a `Badge` variant. | **Reuse by subtraction.** No new variant added; none needed. |
| `waiting: warning`, `done: success`, `todo`/`doing`: secondary | All four statuses are deleted by spec §3. Amber is reassigned to "deadline ≤ today+2" — still Law 2's "needs you." | Consistent |
| Priority `high: error`, med/low secondary | Priority becomes the flag; flag becomes `--brand`, **documented as a deliberate refinement** with its one-sentence claim (§3.9) | **Divergence, declared.** Write the sentence at the site. |
| Category: all seven share one `--label-*` chip | Category picker deleted (spec §2.3); the derived label is plain `--ink-faint` text, no chip | Consistent, and it removes the last consumer of `--label-*` in tasks |
| Assignee: both secondary, "not a completed task" | Agent glyph is `--ink-faint`, no hue — the same reasoning, applied one step further | Consistent |
| Deadlines: ≤14 days → error badge | This spec: ≤2 days → amber ink, <0 → red ink, no badge | **Divergence, declared.** 14 days of red is why the current board reads as an alarm. |
| Status is never colour alone (§14.3) | Every coloured element carries a word or a glyph or both | Consistent |
| Known violation: `school-cells.tsx` red date with no icon or label | This spec fixes the pattern rather than copying it | Improvement |

---

## 10. Token additions

Kept as short as I could make it. **Zero new primitives. Zero new semantic roles.
Zero new hues.** Every addition is either a named dimension or an alias, and the
whole set replaces the 70 `--task-*` lane tokens that spec §12 deletes.

### Tier 3 — `styles/task.css` (rewritten)

| Token | Value | Justification |
|---|---|---|
| `--task-row-height` | `--spacing(9)` (36px) | Recurs in the row, the quick-add slot, the group-header rhythm, and the drag ghost. A literal `36px` in five files is exactly the drift DESIGN.md §7.2 exists to prevent. |
| `--task-row-height-touch` | `--spacing(11)` (44px) | The `<768px` counterpart, per the documented touch inversion. |
| `--task-row-spine` | `calc(--spacing(2) + --spacing(4) + --spacing(3))` (36px) | **The most important token here.** Group headers, the quick-add input, the waiting hint and the footer link all align to it. Written as a `calc` of its three parts (padding + checkbox + gap) so that changing the checkbox size re-derives the alignment instead of silently breaking it. |
| `--task-row-hover` | `var(--canvas-hover)` | Alias, so a row list embedded on a raised surface later re-points in one place instead of forty. Alias chains are explicitly sanctioned (`styles/README.md` tier 3). |
| `--task-row-active` | `var(--canvas-active)` | " |
| `--task-row-selected` | `var(--surface-selected)` | " |
| `--task-row-selected-hover` | `color-mix(in oklab, var(--surface-selected), var(--ink) 4%)` | The one state with no existing token: hovering the already-selected row. `in oklab` per §3.2 — both operands are barely chromatic. Mirrors the existing `--task-card-selected-hover-background` formula, which is being deleted. |
| `--task-flag-ink` | `var(--brand)` | Names the claim so the §3.9 comment has somewhere to live and so a future reversal to `--danger-fg` is one line. |
| `--task-parse-token-surface` | `var(--brand-subtle)` | The quick-add mirror layer. Named because the mirror is fragile and its three colours must be found together. |
| `--task-parse-token-ink` | `var(--brand-subtle-ink)` | " |
| `--task-parse-token-hover` | `var(--brand-chip)` | " |

**Ten tokens, replacing seventy.** All resolve to tier 2. None reaches a primitive.

### Tier 4 — `styles/theme.css`

| Token | Value | Justification |
|---|---|---|
| `--text-chrome` | `0.8125rem` (13px), with `--text-chrome--line-height: 1.25rem` | DESIGN.md §6.3 explicitly asks for this ("the fix, small, do it when you next touch this area") and debt #13 tracks it. This feature uses 13px in five places (group headers, scheduler rows, hint chips, nudge, footer). Adding it here makes `text-chrome` a real utility and lets the implementer delete five `text-[13px]` literals rather than add five more. |

### Optional but recommended — `styles/motion.css` (new tier-2-adjacent file)

DESIGN.md debt #3 ("no duration/easing tokens — the scale is real but every value is
a literal") and debt #2 ("motion constants are copy-pasted in four files"). This
feature adds ~14 more motion literals. `elevation.css` is the precedent for a
non-colour scale living at tier 2.

```css
--duration-fast: 150ms;   --duration-base: 200ms;   --duration-slow: 340ms;
--duration-press: 120ms;  --duration-exit: 100ms;
--ease-out-standard: cubic-bezier(0, 0, 0.2, 1);      /* Tailwind's ease-out */
--ease-out-shared:   cubic-bezier(0.22, 1, 0.36, 1);  /* route / shared element */
--ease-out-expo:     cubic-bezier(0.16, 1, 0.3, 1);   /* list entrance */
```

**This is out of scope for a tasks redesign and must not block it.** Every duration
and curve in this document is written as a literal so the feature can ship without
it. If the implementer does take it, replace the literals; do not add both.

### Dark-mode intent (for the future primitives-only pass)

None of the ten `--task-*` tokens carries a value; all are aliases or dimensions, so
a dark pass touches **zero** of them. The two that would need thought are already
handled by tier 2: `--task-row-hover` becomes a *lightening* mix rather than a
darkening one (that decision belongs in `--canvas-hover` in `semantic.css`, one
place), and `--task-row-selected-hover`'s `var(--ink) 4%` should become
`var(--gray-0) 4%` under a dark palette (again a semantic-layer concern once
`--ink` inverts). That is the tier system working as designed, and it is why this
spec adds no dark values today.

---

## 11. Density and type scale

Every text element in the feature. `--muted-foreground` resolves to `--ink-secondary`
(gray-800); I name the semantic role, not the shadcn bridge, throughout.

| # | Element | Class | Size | Weight | Line-height | Colour |
|---|---|---|---|---|---|---|
| 1 | Page title | `text-xl` | 20px | 600 | `leading-none` | `--ink` |
| 2 | Page subtitle | `text-sm` | 14px | 400 | 1.25rem | `--ink-secondary` |
| 3 | Tab label, active | `text-sm` | 14px | 500 | 1.25rem | `--ink` |
| 4 | Tab label, inactive | `text-sm` | 14px | 400 | 1.25rem | `--ink-faint` |
| 5 | Tab count | `text-sm` | 14px | 400 | 1.25rem | `--ink-faint` · `tabular-nums` |
| 6 | Agent nudge body | `text-chrome` | 13px | 400 | 1.25rem | `--brand-subtle-ink` |
| 7 | Quick-add placeholder | `text-sm` | 14px | 400 | 1.25rem | `--ink-placeholder` |
| 8 | Quick-add input text | `text-sm` | 14px | 400 | 1.25rem | `--ink` |
| 9 | Parsed token | `text-sm` | 14px | 400 | 1.25rem | `--task-parse-token-ink` |
| 10 | First-focus hint | `text-xs` | 12px | 400 | 1rem | `--ink-faint` |
| 11 | Waiting-hint question | `text-xs` | 12px | 400 | 1rem | `--ink-secondary` |
| 12 | Waiting-hint chip | `text-chrome` | 13px | 400 | 1.25rem | `--ink-secondary` |
| 13 | **Group header name** | `text-chrome` | 13px | **500** | 1.25rem | **`--ink`** |
| 14 | Group header count | `text-chrome` | 13px | 400 | 1.25rem | `--ink-faint` · `tabular-nums` |
| 15 | **Row title** | `text-sm` | 14px | **400** | 1.25rem | `--ink` |
| 16 | Row title, done | `text-sm` | 14px | 400 | 1.25rem | `--ink-faint` + strike |
| 17 | Derived label | `text-xs` | 12px | 400 | 1rem | `--ink-faint` |
| 18 | When chip | `text-xs` | 12px | 400 | 1rem | `--ink-secondary` · `tabular-nums` |
| 19 | Deadline word `due` | `text-xs` | 12px | 400 | 1rem | `--ink-faint` |
| 20 | Deadline date, normal | `text-xs` | 12px | 400 | 1rem | `--ink-secondary` · `tabular-nums` |
| 21 | Deadline date, due soon | `text-xs` | 12px | **500** | 1rem | `--warning-fg` · `tabular-nums` |
| 22 | Deadline, overdue (word + date) | `text-xs` | 12px | **500** | 1rem | `--danger-fg` · `tabular-nums` |
| 23 | Agent-change chip | `text-xs` | 12px | 400 | 1rem | `--brand-subtle-ink` |
| 24 | Pending / retry message | `text-xs` | 12px | 400 | 1rem | `--ink-faint` |
| 25 | Today footer link | `text-chrome` | 13px | 400 | 1.25rem | `--ink-faint` → `--ink-secondary` on hover |
| 26 | Scheduler row label | `text-chrome` | 13px | 400 | 1.25rem | `--ink` |
| 27 | Scheduler resolved date | `text-xs` | 12px | 400 | 1rem | `--ink-faint` · `tabular-nums` |
| 28 | Scheduler `Kbd` | `text-xs` | 12px | 500 | 1rem | `--muted-foreground` |
| 29 | Calendar month name | `text-chrome` | 13px | 500 | 1.25rem | `--ink` |
| 30 | Calendar day numeral | `text-xs` | 12px | 400 | 1rem | `--ink` · `tabular-nums` |
| 31 | Panel title | `text-lg` | 18px | 500 | `leading-snug` | `--ink` |
| 32 | Panel notes | `text-sm` | 14px | 400 | `leading-relaxed` | `--ink-secondary` |
| 33 | Panel field label (`dt`) | `text-xs` | 12px | 400 | 1rem | `--ink-faint` |
| 34 | Panel field value (`dd`) | `text-sm` | 14px | 400 | 1.25rem | `--ink` |
| 35 | Panel field value, absent | `text-sm` | 14px | 400 | 1.25rem | `--ink-placeholder` |
| 36 | Panel inheritance note | `text-xs` | 12px | 400 | 1rem | `--ink-faint` |
| 37 | Panel footer | `text-xs` | 12px | 400 | 1rem | `--ink-faint` |
| 38 | Empty-state title | `text-sm` | 14px | 500 | 1.25rem | `--ink` |
| 39 | Empty-state sentence | `text-sm` | 14px | 400 | 1.25rem | `--ink-secondary` |

**Six sizes across thirty-nine elements: 20 / 18 / 14 / 13 / 12.** No `font-bold`
anywhere. No uppercase anywhere. No letter-spacing adjustment anywhere except the
page title's inherited `tracking-tight`. `tabular-nums` on every number that sits in
a column or updates in place (rows 5, 14, 18, 20, 21, 22, 27, 30) — DESIGN.md §6.6.

Contrast: `--ink-faint` (gray-700, L 52%) on `--canvas` (gray-50, L 98.4%) is the
lowest-contrast text in the feature. **Run the repo's contrast script and write the
measured ratio in a comment next to every colour choice at 12px** (DESIGN.md §3.3's
standing convention). If any 12px element measures below 4.5:1, promote it to
`--ink-secondary`; do not shrink the type to compensate.

---

## 12. Visual acceptance criteria

Objectively verifiable. A reviewer should be able to check each with a ruler, a
colour picker, or a grep.

**Geometry**
1. Row height measures exactly **36px** at ≥768px and exactly **44px** below 768px.
2. Every row title's left edge and every group header's text left edge measure
   **36px** from the list's left edge, in all four views, at all three breakpoints.
3. Row-to-row vertical gap is **0px**. There is no divider, rule, border or shadow
   between any two rows anywhere in the feature.
4. Space above a group header is **24px**; space below it is **4px**. The ratio is 6:1.
5. Content column never exceeds **896px** and is centred above that.
6. The header bar measures **64px** on every task view (`PageHeader`'s `min-h-16`).

**Colour budget**
7. On a Today list with no overdue task and no flag, **zero** chromatic pixels appear
   in the list body. Everything is gray-25 through gray-900.
8. The only red anywhere on a task page is the word `overdue`, its date, and its
   `CircleAlert` glyph. Grep: `--danger-` appears in no CSS rule that sets
   `background`, `border-color` or `fill` in this feature.
9. The only amber is a deadline date where `0 ≤ deadline − today ≤ 2`.
10. Wine appears in at most four roles per screen: the flag glyph, the active tab
    underline, a checked checkbox, and the selected-row fill. Plus, at most once, the
    agent nudge band.
11. **At most one tinted surface exists on the page**, and it is the agent nudge.
12. No more than **four hue families** (neutral, wine, amber, red) appear on any
    single screen, and never more than three at once.

**Grammar**
13. Nothing in the list body is chip-shaped at rest. The When chip's fill appears on
    hover only; the agent-change chip is the sole permanent exception.
14. No `Badge` component is rendered anywhere in the list body.
15. The derived label has no background, no border and no radius.
16. Every element that carries a hue also carries a word, a glyph, or both.

**Type**
17. The only `font-medium` in the list body is the group header name (plus the two
    emphasised deadline states).
18. Six type sizes total: 20 / 18 / 14 / 13 / 12. Grep for `text-[` finds only
    `text-chrome` (or `text-[13px]` if the token is not taken).
19. Row titles are single-line `truncate`; no `line-clamp` exists in `TaskRow`.

**States and motion**
20. Hovering a row changes **only** `background-color`. No border, shadow, transform
    or scale appears. Grep the row's classes for `transition-all` → 0 hits.
21. Every interactive element in the feature shows a visible `focus-visible` ring:
    checkbox, title, When chip, flag, quick-add, every scheduler row, every calendar
    day, every panel field, every tab, the footer link.
22. Toggling `prefers-reduced-motion: reduce` removes every transform and spring in
    the feature while leaving all opacity and colour transitions intact — and the
    completion interaction still takes ~440ms end to end.
23. No element's position or size shifts by any amount on hover or focus. Verify
    specifically: the When chip, the flag, the quick-add border, the parsed-token
    mirror, and the hover-revealed schedule affordance.
24. The scheduler popover scales from its trigger, not from its centre
    (`transform-origin: var(--transform-origin)` present).

**Content**
25. No absent value renders blank or as a dash. Grep the feature for `"—"` and `"-"`
    as rendered strings → 0 hits.
26. Every empty state uses the §13.2 template; search-no-results uses §13.3's
    distinct template.
27. Every string is sentence case. No Title Case button labels, no uppercase.

**Deletions actually happened**
28. `TaskBoard`, `TaskColumn`, `AllTasksTable`, `useTaskDrag`, `useTaskSelection`,
    `useIsResizing` are absent from the bundle.
29. `task.css` contains ten tokens, not seventy, and none references a primitive.
30. Exactly one task row component exists in the bundle.

---

## 13. Anti-slop review

The five most likely ways an implementer makes this ugly, and the rule that stops
each. These are ranked by probability, and each maps to a numbered criterion above.

**1. Every meta item becomes a `Badge`.**
This is the most likely failure by a wide margin, because it *looks* like design-system
compliance — the badge primitive exists, it has a `secondary` variant, `--label-*`
is right there. Forty grey pills down the right margin is precisely "bland grey
list," arriving disguised as correctness.
→ **Rule: chip-shape means interactive; plain text means informational.** Only the
When chip (fill on hover only) and the 24-hour agent-change chip may be chip-shaped.
The derived label, the deadline and the counts are type. Criteria 13–15.

**2. A hairline appears between every row.**
The reflex when a list has no cards is to reach for `divide-y`. It converts a
composed list into a spreadsheet and it doubles the number of horizontal lines on
the page from 1 to 41.
→ **Rule: zero dividers between rows.** Separation is the 24px/4px group rhythm and
nothing else. The only rules in the list body are the single one closing "Deadlines
without a plan," and the two inside the detail panel. Criteria 3–4.

**3. The row title ships at `font-medium`.**
DESIGN.md §6.4 calls `font-medium` "the emphasis default," and a task title feels
like it deserves emphasis. Forty of them is a wall of even weight with no hierarchy
left to give.
→ **Rule: row titles are 400. The only `font-medium` in the list body is the group
header name.** Weight is the hierarchy; if everything is emphasised, nothing is
(principle 1.3.5). Criterion 17.

**4. The list gets wrapped in a `Card` — or the rows get card chrome back.**
DESIGN.md §17.2 names a "list" shape as "one raised panel, rows separated by
hairlines," and an implementer reading only that line will wrap this in a bordered,
shadowed panel. On a page whose entire thesis is subtraction, that puts a box around
the thing and reintroduces the chrome the redesign deleted.
→ **Rule: the list has no container.** Rows sit directly on `--canvas`. The precedent
in this system is §15.4's sources rail — flat rows on a surface, "a fill only appears
when the row reacts" — not §17.2's panel. The page's one raised level is the detail
panel, so rule 9 is satisfied and adding a panel here would break it. Criteria 3, 7.

**5. Overdue becomes a red pill, a red row, or a red left border.**
The instinct is that "important" means "filled." Three red pills turn a forty-row
list into an alarm, and a `border-left` accent is banned outright as a pattern that is
never intentional.
→ **Rule: overdue is ink — word, glyph, hue — and never a fill, a border, a row tint
or a stripe.** Red has exactly one owner on this page. Priority moved to wine
specifically so it would not compete (§3.9), and near-misses moved to amber
specifically so red stays rare (§3.8). Criteria 8–10.

*Sixth, honourable mention, because it is cheap to prevent:* reaching for a new grey
for the row hover, or hand-tuning `bg-muted/40`. Use `--canvas-hover` / `--canvas-active`.
A translucent fill is a value that changes depending on what is behind it — which is
the exact reason DESIGN.md §11.1 exists. Criterion 20.

---

## 14. Open questions for the owner

Two, both declared divergences from DESIGN.md §14.2 rather than gaps:

1. **The flag takes `--brand` (wine), not `--danger-fg` (red).** §14.2 currently maps
   `priority: high → error`. Rationale and the required one-sentence claim are in
   §3.9. If reversed, red then means two things on the same row and criterion 8 must
   be rewritten.
2. **Deadline urgency is 2 days (amber) / overdue (red), not 14 days (red).**
   §14.2's schools mapping uses "≤14 days → error badge." Fourteen days of red in a
   list this size is why the current board reads as an alarm. If reversed, criteria
   9–10 must be rewritten.

Both are small, both are one-line reversals in `task-config.ts`, and both should be
decided before implementation rather than during.
