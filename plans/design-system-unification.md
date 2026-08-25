# Design-system unification

Audit of the whole frontend (6 parallel code auditors + live browser measurement at
1440x900). Goal: one design system every page follows, instead of a per-page world.

## Verdict

The colour layer is genuinely good. The 4-tier token system in `src/styles/README.md`
is real and honoured: **zero raw colour literals outside `primitives.css`**, zero
hardcoded Tailwind palette classes anywhere that ships, zero family tokens reaching past
`semantic.css` to a primitive. The impeccable slop detector returns `[]` across
`src/styles`, `src/components/ui`, and `src/features`. This is authored design, not
template output — several files carry real design arguments in comments.

The fragmentation is not in the colours. It comes from four structural gaps:

1. There is **no type scale and no spacing scale** — colour has four strict tiers and a
   law; type has nothing at all.
2. There is **no page scaffold** — `PageHeader` exists, the container around it is a
   copy-pasted string.
3. There are **two component lineages** (Base UI and Radix) shipping the same primitives
   from the same folder, with different recipes.
4. **Same job, different component, per page** — tabs, empty states, progress bars,
   search fields, cards and CTAs each have 2–5 competing implementations.

Fixing 1 and 2 removes most of the perceived inconsistency.

---

## Measured evidence (live, 1440x900)

Every page uses the same `PageHeader` component, and still:

| | Tasks | Schools | Essays | Activities | Profile |
|---|---|---|---|---|---|
| Header bar height | 64px | 64px | 64px | **52px** | **60px** |
| Content column width | 1064 | 1064 | 1064 | **896** | **768** |
| Page title left edge | 336 | 336 | 336 | 336 | **352** |
| Title ↔ content aligned | yes | yes | yes | **off by 84px** | **off by 140px** |
| Tab style | — | **underline** | segmented | segmented | segmented |
| Tab height / size | — | 32px/14px | 28px/12px | 32px/14px | **28px/12px** |
| Empty-state fill | white | white | white | **grey trough, dashed** | section surface |
| Header CTA | white outline | **solid wine** | white outline | **none** | none |

The header bar has no fixed height, so the divider under the title sits at a different y
on three of five pages. Activities and Profile centre their content but leave the header
full-bleed, so the page title floats free of its own column.

---

## Root causes, ranked

### 1. No type scale, no spacing scale — HIGH

`grep` for `--space-*`, `--text-*`, `--font-size`, `--leading`, `--tracking` across all
five token files returns **zero matches**. `theme.css` binds three font *families* and
nothing else.

What exists instead, all hand-authored literals in `index.css`: **12 font sizes, 6 font
weights, 9 line-heights, 3 letter-spacings**. Plus one-off arbitrary values scattered
through features: `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[13px]`,
`text-[15px]`, `text-[26px]`, `text-[0.8125rem]`, `text-[1.35rem]`, `text-[1.625rem]`,
`tracking-[-0.006em]`, `tracking-[-0.02em]`.

The only spacing rhythm in the codebase is `--md-flow*` (8 values) scoped to
`.markdown-response` and shared with nothing.

This is the single biggest cause. Every heading size and every gap on every page is an
independent judgement call because there is nothing to converge on.

### 2. No page scaffold — HIGH

`components/workspace/PageHeader.tsx` is shared by 5 routes. The container around it is
this string, copy-pasted verbatim into 4 files:

```
<section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
  <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
```

`ActivitiesRoute.tsx:441`, `SchoolsRoute.tsx:94`, `TasksRoute.tsx:357`,
`EssaysRoute.tsx:713`. `ProfileRoute.tsx:159` has already drifted (`px-6 pb-6 md:px-10`,
no outer `<section>`, own `mx-auto max-w-3xl`). `gap` is 24px on three pages, 20px on
Schools.

A sixth route (`app/routes/RouteSurface.tsx`) is a second, incompatible scaffold with its
own header shape — and it never renders `children` at all (the prop isn't declared), so
the Calendar route it serves can't display content.

### 3. Two component lineages — HIGH

Base UI and Radix both ship the same primitives from `src/components/ui/`:

- **Two DropdownMenus.** `menu.tsx` (Base UI, `--workspace-dropdown-*` tokens,
  `shadow-lg/5`, inset-highlight pseudo) has **3 importers**. `dropdown-menu.tsx` (Radix,
  same tokens, flat `shadow-md`, no highlight) has **10 importers**. The majority
  implementation is the one that doesn't match the app's elevation language, and nothing
  signals which is canonical.
- **Three overlay recipes.** Base UI family (`border` + `--workspace-dropdown-surface` +
  inset highlight) / Radix dropdown (same tokens, flat shadow) / Radix `dialog.tsx` +
  `hover-card.tsx` (`bg-popover` + `ring-1 ring-[var(--edge)]` instead of a border, no
  highlight).
- **Four focus rings.** `ring-[3px] ring-ring/24` (Base UI fields) / `ring-3
  ring-[var(--focus-ring)]` (Radix checkbox, radio) / `ring-2 ring-ring ring-offset-1`
  (Button, Badge, Accordion) / `outline-2 outline-[var(--onboarding-ring)]` (onboarding).
  On top of that, features split `ring-2` vs `ring-3` vs `ring-[3px]` for the same state.
- **Four "selectable option" components.** `RadioGroup`, `SegmentedControl`, `Menu`'s
  switch variant, and `OnboardingChoiceGroup`'s hand-rolled tile.

### 4. Tier inversion in `Badge` — HIGH

`components/ui/badge.tsx` is a shared, app-wide primitive. Its `default`/`secondary`/
`info`/`success`/`warning` variants resolve to `--task-todo-pill-*`, `--task-doing-pill-*`,
`--task-done-pill-*`, `--task-waiting-pill-*`.

So Schools status badges, Essay status badges, Activity chips and Profile document badges
all take their colour from the **Tasks feature's private token family**. The README's tier
rule says tier-4 components rest on tier-2 (`semantic.css`) and tier-3 families alias
tier-2 — this is exactly backwards. Renaming a `--task-*` token breaks badges app-wide.

Meanwhile `schools.css:17-33` defines a complete `--school-verdict-{reach,target,safety,
unknown}-{surface,border,ink}` family with **zero consumers anywhere in the repo**.

### 5. Same job, different component — MED

- **Tabs**: Schools uses the underline variant; Activities, Essays and Profile use the
  filled segmented variant. Same `Tabs` component, opposite look, no rule.
- **Empty states**: `bg-card` + solid border (Tasks, Schools, Essays) /
  `bg-[var(--control-track)]` + `border-dashed` (Activities) /
  `bg-[var(--profile-section-surface)]` (Profile).
- **Progress bars**: the real `Meter` primitive (Schools essay word count) / a hand-rolled
  div-in-div with inline width (`school-cells.tsx:174-180`) / a hand-rolled span-in-span
  (`EssayLibraryCard.tsx:84-99`). Three implementations, three token sets.
- **Search fields**: shadcn `Input` (Essays, Tasks) / a hand-built `rounded-xl`
  `--school-search-*` field (Explore) / an `h-11 rounded-[10px] !bg-transparent` field
  (chat sidebar).
- **Cards**: at least five recipes in Tasks alone; across surfaces `rounded-xl` vs
  `rounded-2xl`, `--elevation-1` vs raw `shadow-xs/5`, `--surface-raised` vs
  `--surface-raised-soft`. The Profile Documents `<Card>` is the clearest seam — it keeps
  shadcn's unoverridden `rounded-2xl` + `shadow-xs/5` right beside a `rounded-xl` +
  `--elevation-1` accordion, one tab-click apart.
- **Primary CTA**: solid wine with `--elevation-cta` (Schools) vs white outline with
  `--elevation-1` (Tasks, Essays) vs none (Activities, Profile). No rule for which page
  gets a solid CTA.

### 6. Radius sprawl — MED

7 bound steps (`--radius-sm`…`--radius-4xl`) plus **10+ unbound literals**:
`rounded-[2px]`, `[3px]`, `[4px]`, `[5px]`, `[9px]`, `[10px]`, `[12px]`, `[13px]`,
`[.25rem]`, and bare `rounded` (unbound → stock Tailwind) at `ToolWidgets.tsx:92` and
`TaskDetailSheet.tsx:145`. Two family files restate a bound value as a literal:
`workspace.css:68` (`0.625rem` = `--radius-lg`) and `workspace.css:84` (`0.375rem` =
`--radius-sm`).

### 7. Dead surface — LOW, but it's where the only real violations live

- `components/ai-elements/`: **11 of 13 files have zero importers** (~3,900 lines). That
  dead code contains the only hardcoded Tailwind palette colours that ship in the repo
  (`tool.tsx:59-65`: `text-yellow-600`, `text-blue-600`, `text-green-600`,
  `text-orange-600`, `text-red-600`) and the only raw `shadow-sm` (`artifact.tsx:20`).
- `--school-verdict-*` (12 tokens), `--brand-muted`, `--edge-panel-strong`: zero
  consumers. `--brand-muted`'s comment claims it drives the sidebar resizer; the resizer
  actually uses `--sand-300`.

---

## Fix plan

### Phase 1 — Give type and space the same treatment colour already has

New tier-2 file `src/styles/type.css`, imported after `semantic.css`:

- `--text-2xs … --text-3xl` (one ladder, ~8 steps), `--weight-regular/medium/semibold`,
  `--leading-tight/snug/normal/relaxed`, `--tracking-tight/normal`.
- Bind them in `theme.css` `@theme inline` so `text-sm`, `font-medium` etc. resolve to
  *our* ladder, not Tailwind's.
- Add `--space-*` for the layout rhythm the routes currently hand-pick (`gap-5` vs
  `gap-6`, `pr-8 pl-6` vs `px-6`).
- Migrate `index.css`'s 12 sizes / 6 weights / 9 line-heights onto it as the first
  consumer, then sweep the ~11 arbitrary `text-[Npx]` sites in features.
- Keep the essay document scale (`--font-document`, Georgia) deliberately separate — it's
  documented as a distinct sheet and should stay one.

### Phase 2 — One page scaffold

- Extract `components/workspace/PageContainer.tsx` holding the shared
  `<section>`/scroll-div pair, a fixed header height, one content `gap`, and an optional
  `width` prop (`full` | `wide` | `narrow`) mapping to the three max-widths that exist
  today. Route all six pages through it.
- Give `PageHeader` a fixed height so the divider lands at the same y everywhere, and a
  subtitle slot (Profile currently fakes one with two `<p>`s using two different tokens).
- Make the content column and the page title share one left edge on every page — that
  single change kills the Activities 84px and Profile 140px offsets.
- Delete `RouteSurface.tsx` (it's a second scaffold that also drops its children) and
  route Calendar through `PageContainer`.

### Phase 3 — Collapse the duplicate lineages

- Pick one dropdown implementation. `menu.tsx` (Base UI) matches the app's elevation
  language; migrate the 10 `dropdown-menu.tsx` importers and delete the loser.
- Normalise `dialog.tsx` and `hover-card.tsx` onto the `--workspace-dropdown-*` +
  `border` + inset-highlight recipe.
- One focus ring per *role* (field / actionable / card hit-area), named and documented —
  not four recipes and three spellings.
- Fold `shadow-xs/5` and the `before:shadow-[0_1px_…]` inset trick into a named
  `--elevation-hairline` step so shadcn primitives and feature cards cast the same shadow.

### Phase 4 — One component per job

- **Badge**: repoint the generic variants at `--neutral-surface` / `--info-*` /
  `--success-*` / `--warning-*` in `semantic.css`, and make `task.css`'s `--task-*-pill-*`
  alias those instead of the reverse. Then either wire Schools' badges through
  `--school-verdict-*` or delete that dead family.
- **Tabs**: one variant for in-page view switching. Underline for page-level navigation,
  segmented for filters — pick, document, apply. Fix the 32/14 vs 28/12 size split.
- **Empty state**: one recipe. Dashed `--control-track` reads best as "add something".
- **Progress**: delete both hand-rolled bars, use `Meter`.
- **Cards**: one primitive with documented variants. Start by overriding the Profile
  Documents `<Card>` to `rounded-xl` + `--elevation-1`.
- **CTA rule**: one solid brand button per page, in the header, always. Everything else
  outline or ghost.

### Phase 5 — Delete

- The 11 unused `ai-elements` files (or comment why they're kept, as `ChatMessages.tsx`
  already does for `conversation.tsx`).
- `--school-verdict-*` if not wired up, `--brand-muted`, `--edge-panel-strong`.
- Fix `--brand-muted`'s inaccurate comment if it's kept.

### Phase 6 — Make it stick

- Extend `styles/README.md` beyond "colour literals only in primitives.css" to cover type,
  spacing, radius and the one-component-per-job rule.
- Lint: ban `rounded-[`, `text-[`, `shadow-[0` outside an allowlist. The colour law is
  held today because it's greppable and stated; the other axes aren't stated at all.

## Order

Phase 1 and 2 first — they're the ones the eye actually reads, and they're additive
(a new token file, one extracted component) rather than invasive. Phase 3 is the largest
diff. Phases 4–6 can land incrementally.

---

## Status

**Phase 2 started.** `components/workspace/PageContainer.tsx` now exists and owns the
`<section>`/scroll-div pair, the header height, the gutter rhythm, and the content column.
`PageHeader` gained `min-h-16`, a `columnClassName` so the title tracks the body column,
and a real `subtitle` slot. Activities and Profile — the two pages whose titles floated
free of their content — are migrated. Content widths collapsed from three tiers to two
(`full` for dense data surfaces, `wide` for linear read-and-enter surfaces).

Measured after, at 1440x900:

| | Tasks | Schools | Essays | Activities | Profile |
|---|---|---|---|---|---|
| Header height | 64 | 64 | 64 | 64 | 68 (subtitle variant) |
| Title left edge | 336 | 336 | 336 | 428 | 428 |
| Tab row left edge | — | 336 | — | 428 | 428 |

Title and content now share a left edge on every page. `tsc --noEmit` clean; 159 tests
across the touched surfaces pass. Three failures in `ChatSessionList` and `auth-routes`
are pre-existing — verified by stashing the change and re-running.

**Still to do:** migrate Tasks, Schools and Essays onto `PageContainer` (they already
match the target metrics, so this is deduplication rather than a visual fix), delete
`RouteSurface.tsx`, then Phases 1 and 3–6.
