# CDS admin — UI/UX specification

**Scope:** the three admin screens in `frontend/src/features/cds-admin/` — Coverage (P6a),
Batch upload (P6b), Document review (P6c).
**Audience:** the three implementers, working in parallel, who will not talk to each other.
**Authority:** this document is the design contract. Where it contradicts `PLAN.md` §F, the
deviation is called out inline with a reason (search for **DEVIATION**). Workflow and API
shapes are locked by `PLAN.md` §D/§F — this spec does not change them.

**The bar, from the owner:** *"follow the frontend rules of the counselle app… look so good…
never overcomplicate things… the perfect ui/ux while being so fucking minimal."*
Minimal in **surface**; excellent in **craft**. Fewer controls, each one exactly right.

---

## 0. Read this first — the seven laws

Every disagreement between the three screens gets settled by one of these.

1. **The colour law.** Green = done and correct. Amber = *a human must act.* Blue = *the
   machine is working, or here's a fact.* Red = broken. Neutral/grey = inert, absent, or
   nothing-to-do. This law governs every chip, every icon, every border accent, on all
   three screens. Nothing else earns colour.
2. **Colour is never the only signal.** Every status carries an icon **and** a text label.
   Absence of a document is a visible glyph, not an absence of colour.
3. **Row-scoped errors are inline. Page- and action-scoped errors are toasts.** A 40-file
   batch must never fire 40 toasts.
4. **Never show a progress bar for a number we don't have.** Determinate `Meter` only when
   the API gives real `{done,total}`. Otherwise a spinner and honest words. (See §7, gap 4 —
   `fetch` gives us no upload progress, so upload has no bar.)
5. **No arbitrary Tailwind values, no hex, no inline colours.** Semantic tokens and existing
   primitive APIs only. The single sanctioned arbitrary value in this whole spec is the
   grid's height calc in §3.3.
6. **Density is earned, not uniform.** Controls that belong to one thought hug (`gap-2`/`gap-3`);
   separate ideas breathe (`gap-6`). Uniform padding everywhere is the tell of a template.
7. **Optimism where it's honest.** Rows appear the instant a file is dropped; edits mark
   dirty immediately. But a status never *claims* a server outcome we haven't got.

---

## 1. Shared foundations

### 1.1 Ownership and the shared module (read this, P6a/b/c)

`PLAN.md` §H already serialises ~30 minutes of P6a before the fan-out, to land
`api/cds-admin/{types,keys,hooks}`. **That serialised step is extended to include the
shared design module.** P6a delivers, before P6b/P6c start:

```
frontend/src/features/cds-admin/cds-status.tsx      ← THE status vocabulary (§2). Single source.
frontend/src/features/cds-admin/cds-format.ts       ← formatAcademicYear, formatWhen, formatBytes
frontend/src/features/cds-admin/CdsErrorCard.tsx    ← the page-level fetch-error card (§1.9)
frontend/src/features/cds-admin/CdsUnavailable.tsx  ← the 503 "not configured" state (§1.9)
frontend/src/api/cds-admin/hook-utils.ts            ← handleCdsError(error, ctx) → toast
```

**DEVIATION from PLAN §F3/§F4/§F5:** the plan gives each screen its own status mapper
(`coverage-status.ts`, `upload-status.ts`, `FlagChip.tsx`). Three parallel agents plus three
mappers guarantees three dialects. There is **one** module, `cds-status.tsx`, and all three
screens import from it. Nobody else defines a status→variant mapping.

`cds-format.ts` contract (so all three render years identically):

```ts
formatAcademicYear(2025)      // → "2024–25"   (en dash, not hyphen)
formatAcademicYearShort(2025) // → "’24–25"    (grid column heads only)
formatWhen(iso)               // → "2 min ago" under 24h, else "16 Aug"
formatBytes(n)                // → "4.2 MB"
```

### 1.2 Route context and page frame

All three routes live inside `WorkspaceShell` → `SidebarInset` → `WorkspaceOutlet`
(`PLAN.md` §F1). The outlet gives each page an absolutely-positioned flex box that fills
the inset and **already handles the route-change transition**. Do not add page-level entry
animation.

Every page therefore starts as a flex column that owns its own scrolling:

```tsx
<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-6 md:px-10">
```

`px-6 md:px-10` is not arbitrary: it is exactly what `PageHeader`'s `-mx-6 px-6 md:-mx-10
md:px-10` negative gutter is built to cancel, so the header rule bleeds edge-to-edge while
content stays on the gutter.

**DEVIATION from the Schools template:** `SchoolsRoute` uses `pl-6 pr-8 md:pr-10` and puts the
whole page in one scroll container. It does that because of `WorkspaceScrollIndicator`. The
CDS screens don't use that component, and — more importantly — a data tool must keep its
header, counters and filters pinned while only the data moves. So: **the page does not
scroll; the data region scrolls.**

### 1.3 Typography — the exact classes, no improvisation

| Role | Classes | Where |
|---|---|---|
| Page title | *(supplied by `PageHeader`)* `text-xl leading-none font-semibold tracking-tight` | Coverage, Upload |
| Screen identity (review) | `font-heading text-base font-medium tracking-tight` | Review header strip |
| Section heading | `font-heading text-lg font-medium` | Upload drop-zone title, Review section headers, error cards |
| Body / table content | `text-sm` | everywhere |
| Table column head | *(supplied by `TableHead`)* | all tables |
| Meta, helper, sub-line | `text-xs text-muted-foreground` | everywhere |
| Any number that can change | add `tabular-nums` | counters, counts, page numbers, sizes, progress |
| Emphasised inline number | `font-medium text-foreground tabular-nums` | counters line, `4/8 domains` |
| Monospace | **never** — Geist Variable with `tabular-nums` is the house numeric treatment | — |

There is no numeric type-scale token in this design system (§7, gap 3). The table above **is**
the scale for these three screens. Do not introduce a size outside it.

### 1.4 Token whitelist

Use only these. Anything else is a violation of the AGENTS.md house rule.

**Surfaces / text:** `bg-background` `text-foreground` `bg-card` `text-card-foreground`
`bg-popover` `text-popover-foreground` `bg-muted` `text-muted-foreground` `bg-accent`
`text-accent-foreground` `bg-secondary`
**Lines / focus:** `border-border` (implicit via the global `* { border-border }`, so bare
`border` / `border-b` / `border-t` is correct and preferred) · `border-input` · `ring-ring`
**Status colour:** `text-success` `text-warning` `text-info` `text-destructive` and their
`border-*` counterparts. **Backgrounds for status come from `Badge` variants only** — never
`bg-warning` etc. directly.
**Radii:** `rounded-sm` `rounded-md` `rounded-lg` `rounded-xl` (map to `--radius-*`)

**Forbidden:** `--workspace-*`, `--task-*`, `--activity-*`, `--profile-*`, `--essay-*`,
`--onboarding-*`, `--shell-*`, `--chart-*` — all feature-private. Also forbidden: any hex,
any `oklch()`/`color-mix()` written by hand, any `text-[…]`/`bg-[…]` arbitrary value.

**No `--cds-*` tokens are minted.** The existing `Badge` variants cover all five statuses,
all seven upload row states and all three flag severities (§2). If you think you need a new
token, you're about to build something this spec didn't ask for — stop.

### 1.5 Focus, hover, and what is clickable

The primitives already ship the house focus ring. Any **custom** interactive element (a grid
cell button, an editable value) must reproduce it verbatim:

```
outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background
```

Rules:
- **Hover changes background, never size or position.** `hover:bg-accent` for controls,
  `hover:bg-muted` for table rows. No scale, no lift, no shadow-on-hover.
- **Everything clickable is a real `<button>` or `<a>`.** No `onClick` on a `div`, no
  `cursor-pointer` on a non-button. The one exception is `TableRow` with `onClick`, which
  the Schools template already establishes — and even there the row must contain a focusable
  control that does the same thing.
- **Transitions:** `transition-colors` only, default duration. Nothing else animates except
  the two motions named in §4.5 and §5.7.

### 1.6 Density and rhythm

- Coverage grid row: **44px** (`h-11`). Tight enough to see 12 schools at once, tall enough
  for a 22px chip with air.
- Upload staging row: **56px** (`h-14`) — it carries two lines (filename + meta) and inline
  controls.
- Review metric row: **28px** (`py-1.5` on `text-sm`) — this screen may render hundreds of
  rows and speed is the whole point.
- Vertical rhythm on Coverage/Upload, deliberately **not** uniform:
  `PageHeader` → `mt-4` → counters → `mt-3` → filter bar → `mt-5` → data region.
  Counters and filters hug (one control cluster); the data region gets real air.

### 1.7 Loading — skeleton shapes

Skeletons mirror final geometry exactly so nothing jumps when data lands. Local per-page
skeleton components, as `SchoolsSkeleton` does — **not** a shared generic one.

- **Coverage** (`CoverageSkeleton`): `Skeleton h-4 w-80` (counters) · `Skeleton h-8 w-full
  max-w-2xl` (filters) · then inside the bordered grid frame: `Skeleton h-10 w-full` (head)
  + 6 × `Skeleton h-11 w-full` in a `space-y-px` stack.
- **Upload** (`BatchSkeleton`, only on reload with `?batch=` in the URL): 3 × `Skeleton h-14
  w-full`. A freshly opened, empty batch shows the **empty state**, not a skeleton.
- **Review** (`ReviewSkeleton`): left — `Skeleton className="aspect-[8.5/11] w-full max-w-2xl"`;
  right — 3 × (`Skeleton h-9 w-full` + 5 × `Skeleton h-7 w-full`).

Never a full-page spinner. Never a spinner overlay on already-rendered data.

### 1.8 In-progress states — the thing this tool actually is

This tool is mostly *watching async work*. The in-progress vocabulary is therefore
first-class, not an afterthought.

| Phase | Where | Visual | Poll |
|---|---|---|---|
| `uploading` | Upload row | `info` chip, `Loader2 animate-spin`, label **Uploading** | — (in-flight request) |
| `detecting` | Upload row | `info` chip, `Loader2 animate-spin`, label **Detecting** | — (same request; §7 gap 4) |
| `queued` | Upload row, Coverage cell, Review header | `info` chip, `Clock` (**not** spinning — it isn't running), label **Queued** | 2s / 4s |
| `running` | Upload row, Coverage cell, Review header | `info` chip, `Loader2 animate-spin`, label **Extracting**, plus determinate `Meter` where `progress:{done,total}` exists | 2s / 4s |
| `saving` (an edit) | Review metric row | the value dims to `opacity-64`; no spinner | — |

Polling intervals (TanStack `refetchInterval`, returned from a function so it stops):
- Coverage: **4000ms** while any visible cell is `processing`; `false` otherwise.
- Jobs (Upload): **2000ms** while any row is non-terminal; `false` otherwise.
- Document review: **3000ms** while `extraction.status` is `queued`/`running`; `false` otherwise.

Never refetch on window focus for these three (`refetchOnWindowFocus: false`) — an admin
alt-tabbing to a PDF should not see the table reshuffle.

### 1.9 Errors and empties

Four distinct treatments; do not blur them.

1. **Page-level fetch failure** → `CdsErrorCard` (P6a), which is the Schools error card
   verbatim so it looks native:
   ```tsx
   <div className="rounded-xl border bg-card p-6">
     <div className="max-w-md space-y-3">
       <h2 className="font-heading text-lg font-medium">{title}</h2>
       <p className="text-sm text-muted-foreground">{message}</p>
       <Button onClick={onRetry}>Try again</Button>
     </div>
   </div>
   ```
2. **`503` — CDS admin not configured** (the pipeline DSN is unset, `PLAN.md` §C3) →
   `CdsUnavailable` (P6a): the `Empty`/`EmptyHeader`/`EmptyMedia variant="icon"`/`EmptyTitle`/
   `EmptyDescription` family, icon `DatabaseZap`, title *"CDS admin isn't configured"*, body
   *"This server has no pipeline database connection. Set `COUNSELLE_DB_PIPELINE_DSN` and
   restart."* No retry button. All three screens render this on a 503, identically.
3. **Mutation failure** → `toast.error(...)` via `handleCdsError`, mirroring
   `api/workspace/hook-utils.ts` (a **mirror**, not a reuse — the messages differ):
   | `TransportError.kind` | message |
   |---|---|
   | `unauthorized` | "Your session expired. Sign in again." *(also invalidate `authQueryKey`)* |
   | `conflict` | "That changed on the server. Reload and try again." |
   | `invalid_edit` | "That edit was rejected: {detail}." |
   | `rate_limited` | "Too many requests. Wait a moment." |
   | `network` | "Could not reach the server." |
   | default | "That action failed. Please try again." |
4. **Row-scoped failure** → inline, in the row's status cell, `destructive` chip + a
   `text-xs text-muted-foreground` reason line. Never a toast (law 3).

Empty states use the `Empty*` family, always inside `className="rounded-xl border bg-card"`
as `SchoolsRoute` does.

### 1.10 Responsive — say it plainly

**This is a desktop admin tool.**

| Width | Behaviour |
|---|---|
| **≥1280px** | The design as specified. This is the target. |
| **1024–1279px** | Supported, degraded: Coverage school column 240px (from 280); Upload hides the **Size** and **Pages** columns; Review keeps two panes but requests page images at `w=1100`. |
| **<1024px** | Functional, not designed. Coverage scrolls horizontally (the sticky school column earns its keep). Upload table scrolls horizontally. Review collapses to one column, viewer above data. No bespoke layout, no bottom sheets, no card-list rewrites. |

**DEVIATION from PLAN §F5:** the plan's mobile "per-metric view-page `Sheet`" is **cut**.
It is real work for a user who does not exist. Single-column stacking below `lg` is enough.

### 1.11 Accessibility baseline

- **All three data surfaces are real `<table>`s.** The coverage matrix is genuinely tabular
  (schools × years), so native semantics beat `role="grid"`. Requirements:
  - `<caption className="sr-only">` on every table describing it.
  - Year heads: `<TableHead scope="col">`. School cell: `<TableCell scope="row" render={<th/>}>`
    — `TableCell` takes a `render` prop path via base-ui; if that fights you, use a plain
    `<th scope="row" className={/* same classes */}>`.
  - **No `role="grid"` and no roving-tabindex arrow navigation.** With ~4 rows at rest and a
    bounded search result set, Tab is fine and the ARIA grid pattern is a bug farm. This is a
    deliberate cut — see §8.
- **Every interactive cell has a complete accessible name**, because the visual label is a
  4-word chip: `aria-label="Yale University, 2024–25 — needs review. Open document review."`
- **Live regions, sparingly.** One `aria-live="polite"` per screen, on the summary line only
  (coverage counters / upload readiness sentence / review flag summary). Never per row, never
  per cell — a 3-second poll across 40 rows would make a screen reader unusable.
- **Focus management on viewer page jump (§5.7): focus does not move.** Clicking an evidence
  chip changes the left image and announces *"Showing page 12"* in the polite region. Stealing
  focus into the viewer would eject the admin from the field they're about to edit — that
  would destroy the two-minute target.
- **Focus on state change:** when a metric editor closes, focus returns to the value button
  it opened from. When a dialog closes, focus returns to its trigger (the primitives do this).
- **Reduced motion:** honoured via `useReducedMotion()` from `motion/react` (already a
  dependency, precedent in `ActivitiesRoute`). The only two motions in this spec (§4.5 drag
  overlay, §5.7 evidence flash) degrade to an instant, non-animated state change.
- **Contrast:** all status chips use existing `Badge` variants, which are already tuned
  against `--background` in this theme. Don't re-tint them with opacity modifiers.

### 1.12 Theme

The app is **dark-only on this branch** (`:root` and `.dark` currently define identical dark
values). Do not design a light variant, do not add `dark:` prefixes to feature code. Because
every colour comes from a semantic token, a future light theme costs nothing here.

---

## 2. THE STATUS VOCABULARY

**One definition. All three screens. `features/cds-admin/cds-status.tsx`, owned by P6a.**

### 2.1 Document status — the five

These describe *a school-year's CDS document*. They appear in coverage cells, in upload rows
after processing starts, and in the review header. Identical everywhere.

| Status | `Badge variant` | Icon (lucide) | Short label (grid) | Full label | Means |
|---|---|---|---|---|---|
| `none` | **no badge** | `Plus`, revealed on hover/focus | — | Not uploaded | No document for this school-year |
| `processing` | `info` | `Clock` when queued · `Loader2 animate-spin` when running | **Processing** | Queued / Extracting | An extraction is queued or running |
| `needs_review` | `warning` | `Flag` | **Review** | Needs review | Candidate document, extracted, awaiting a human |
| `approved` | `success` | `CircleCheck` | **Approved** | Approved | Active — this data reaches students |
| `failed` | `destructive` | `OctagonX` | **Failed** | Failed | Extraction failed; re-runnable |

Icon choices deliberately echo the app's own toast icon set (`components/ui/sonner.tsx` uses
`CircleCheckIcon`/`TriangleAlertIcon`/`OctagonXIcon`/`Loader2Icon`) so a toast and a chip about
the same event look like the same system.

`processing` carries two icons because a queued job is not a running job and a spinning
spinner for a job that hasn't started is a small lie (law 4 / AGENTS.md principle 3).

### 2.2 `partial` is a modifier, not a status

`Cell.partial_domains` exists in the API. A document can be **approved and incomplete**.
Do not invent a sixth status. Render the `approved` chip, and beneath it a
`text-xs text-muted-foreground tabular-nums` marker `9/13`. The `Tooltip` and the `aria-label`
spell it out: *"Approved — 9 of 13 domains extracted."*

### 2.3 Upload row status — the seven (Batch upload only)

A different axis (a *file's* readiness), but obeying the same colour law.

| Row status | `Badge variant` | Icon | Label | Reason sub-line (`text-xs text-muted-foreground`) |
|---|---|---|---|---|
| `uploading` | `info` | `Loader2 animate-spin` | Uploading | — |
| `detecting` | `info` | `Loader2 animate-spin` | Detecting | "Reading school and year…" |
| `matched` | `success` | `CircleCheck` | Ready | — |
| `needs_input` | `warning` | `CircleHelp` | Needs input | "Pick a school" / "Pick a year" / "Pick a school and year" |
| `replaces_existing` | `info` | `ArrowRightLeft` | Replaces | "Supersedes the 2024–25 document" *(links it)* |
| `duplicate` | `secondary` | `Copy` | Duplicate | "Already uploaded {formatWhen}" *(links the existing document)* |
| `failed` | `destructive` | `OctagonX` | Failed | the server's `error_message`, verbatim |

`duplicate` is `secondary` — neutral, inert, nothing to do — per the colour law. It is the one
row state that is *not* a problem and *not* progress.

### 2.4 Flag severity — the three (Document review only)

| Severity | `Badge variant` | Icon | Label |
|---|---|---|---|
| `error` | `destructive` | `OctagonX` | Error |
| `warning` | `warning` | `TriangleAlert` | Warning |
| `info` | `info` | `Info` | Note |

A flag chip is `size="sm"` and shows only the icon plus the flag `code` (e.g. `C1`); the
human-readable `message` is the row's expanded text, not tooltip-only — see §6.6.

**"Unresolved"** = severity `error` or `warning` with no pending edit covering its
`metric_ref`. `info` flags never block Approve.

### 2.5 The module's shape

```tsx
// features/cds-admin/cds-status.tsx  — P6a, before fan-out
export type CdsStatus = "none" | "processing" | "needs_review" | "approved" | "failed";
export type UploadRowStatus = "uploading" | "detecting" | "matched" | "needs_input"
                            | "replaces_existing" | "duplicate" | "failed";
export type FlagSeverity = "error" | "warning" | "info";

export const cdsStatusMeta: Record<CdsStatus, {
  variant: BadgeVariant | null; Icon: LucideIcon | null; label: string; shortLabel: string;
}>;
export const uploadRowStatusMeta: Record<UploadRowStatus, { … }>;
export const flagSeverityMeta:   Record<FlagSeverity,   { … }>;

export function StatusChip(props: {
  status: CdsStatus; running?: boolean; size?: "sm" | "default"; short?: boolean;
}): React.ReactElement | null;                       // returns null for "none"
export function UploadStatusChip(props: { status: UploadRowStatus }): React.ReactElement;
export function FlagChip(props: { severity: FlagSeverity; code: string }): React.ReactElement;
```

`*.test.ts` for the three maps is one of the few tests that earns its place (PLAN §F7):
assert every status key has a label and an icon, and that no two statuses share a variant
within the same axis.

---

## 3. Screen 1 — Coverage

Route `/app/admin/cds`. The home screen. Answers *"what do we have?"* in one glance.

### 3.1 The real design problem, and the answer

2,746 schools exist; roughly four have documents. A 2,746 × 5 matrix that is 99.8% empty is
not a grid, it's a void with four pixels in it. Three moves solve this:

1. **Default scope is "With documents."** The backend already supports it (`all_schools`
   defaults false, `PLAN.md` §D row 1). At rest the grid is ~4 rows: small, dense, entirely
   legible, no scrolling. That is the correct home screen — it shows *what we have*.
2. **"All schools" is a find mode, not a browse mode.** Toggling it does **not** dump 2,746
   rows. With the toggle on and the search box empty, the table body renders a single
   centred prompt: *"Search 2,746 schools by name to add a document."* Rows appear only as
   the query matches (server-side, `limit`). The toggle changes *what search reaches*, not
   *what is rendered*.
3. **Empty cells recede.** An empty cell is not a grey chip — it is near-nothing: a centred
   `·` at `text-muted-foreground/40`, which becomes a `Plus` at `text-muted-foreground` on
   row-hover or cell-focus. Filled cells therefore pop off a quiet field, and a mostly-empty
   row reads as "this school has one edition," not as five failures.

That third move is the single highest-leverage visual decision on this screen.

### 3.2 Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ CDS Coverage                                              [ Batch upload ]           │  PageHeader
├──────────────────────────────────────────────────────────────────────────────────────┤
│ 4 schools · 5 editions · 1 needs review · 0 failed · 12 missing                      │  counters (clickable)
│                                                                                       │
│ [🔍 Search schools…            /]  [ With documents │ All schools ]  [Missing year ▾] [⚑ Needs review] │
│                                                                                       │
│ ┌───────────────────────────────────────────────────────────────────────────────────┐│
│ │ School                    │ ’20–21 │ ’21–22 │ ’22–23 │ ’23–24 │ ’24–25 │          ││  ← sticky top
│ ├───────────────────────────┼────────┼────────┼────────┼────────┼────────┤          ││
│ │ ◧ Harvard University      │   ·    │   ·    │  ✓ Approved     │  ✓ Approved      ││
│ │   Cambridge, MA           │        │        │        │        │                  ││
│ ├───────────────────────────┼────────┼────────┼────────┼────────┼────────┤          ││
│ │ ◧ Yale University         │   ·    │   ·    │   ·    │ ✓ Appr │ ⚑ Review         ││
│ ├───────────────────────────┼────────┼────────┼────────┼────────┼────────┤          ││
│ │ ◧ Univ. of Pennsylvania   │   ·    │   ·    │   ·    │ ⟳ Proc │   +              ││  ← + on row hover
│ │                           │        │        │        │  4/8   │                  ││
│ ├───────────────────────────┼────────┼────────┼────────┼────────┼────────┤          ││
│ │ ◧ Cornell University      │   ·    │   ·    │ ✕ Faild│   ·    │   ·              ││
│ └───────────────────────────┴────────┴────────┴────────┴────────┴────────┘          ││
│   ↑ sticky left column                                            ↑ scrolls          ││
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Layout and the sticky trap

```tsx
<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-6 md:px-10">
  <PageHeader title="CDS Coverage" actions={<Button variant="outline" render={<Link to="/app/admin/cds/upload"/>}>
      <Upload data-icon="inline-start" />Batch upload</Button>} />
  <CoverageCounters className="mt-4" … />
  <CoverageFilters   className="mt-3" … />
  <div className="mt-5 min-h-0 flex-1 pb-6">
    <CoverageGrid … />
  </div>
</section>
```

**The trap, stated so nobody loses an hour to it.** `Table`'s container div is hardcoded
`"relative w-full overflow-x-auto"`. `overflow-x: auto` makes that div a scroll container on
**both** axes, with auto height — so `sticky top-0` inside it has nothing to stick to and
silently does nothing. `Table`'s `className` goes to the inner `<table>`, not the container.

The fix uses the primitive's own `render` prop (base-ui `useRender` merges classNames), so
**no change to `table.tsx`**:

```tsx
<Table
  render={<div className="h-full max-h-full overflow-auto overscroll-contain rounded-xl border" />}
  className="w-full max-w-5xl table-fixed"
>
```

`h-full` inside the `min-h-0 flex-1` parent gives the container a real bounded height →
sticky works on both axes, and the page itself never scrolls.

*(This `max-h`/`h-full` pairing is the one sanctioned deviation from "no arbitrary values" —
and it isn't even arbitrary, it's plain Tailwind.)*

### 3.4 Column geometry

```tsx
<colgroup>
  <col style={{ width: 280 }} />                    {/* school; 240 below 1280px */}
  {years.map(y => <col key={y} style={{ minWidth: 112 }} />)}
</colgroup>
```

Table is `table-fixed w-full max-w-5xl` — the year columns share the remaining width equally
(~148px each at 5 years on a 1440 screen), and `minWidth: 112` forces horizontal scroll once
there are enough years that labels would crush. `max-w-5xl` stops a 5-column matrix from
being stretched across 1900px into a lonely strip.

**DEVIATION from PLAN §F3:** the plan specifies fixed 88px year columns. 88px cannot hold a
labelled chip, which would force icon-only cells and break law 2 (colour never the sole
signal). 112px minimum with `1fr` distribution keeps text labels and still never reflows.

### 3.5 Sticky cells, and the hover problem

```
thead th          : sticky top-0  z-20 bg-background
tbody td:first    : sticky left-0 z-10 bg-background
thead th:first    : sticky top-0 left-0 z-30 bg-background
```

A sticky cell must be **opaque**, which kills the `TableRow` hover tint underneath it. Do not
fight this with `color-mix`. Both the row and the sticky cell take the same solid semantic
token, and `cn`'s `twMerge` cleanly replaces the primitive's default hover:

```tsx
<TableRow className="group/row h-11 hover:bg-muted">
  <TableCell className="sticky left-0 z-10 bg-background transition-colors group-hover/row:bg-muted">
```

### 3.6 The cell

The whole cell is the hit target (≈148 × 44). `TableCell className="p-0 text-center"`, one
button filling it.

```tsx
// populated
<button
  type="button"
  onClick={() => navigate(`/app/admin/cds/documents/${cell.document_id}`)}
  aria-label={`${school.name}, ${formatAcademicYear(year)} — ${meta.label}. Open document review.`}
  className="flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-sm transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
>
  <StatusChip status={cell.status} running={…} short />
  {partial && <span className="text-xs text-muted-foreground tabular-nums">{n}/{m}</span>}
</button>

// empty
<button … onClick={() => navigate(`/app/admin/cds/upload?school_id=${id}&year=${year}`)}
  aria-label={`${school.name}, ${formatAcademicYear(year)} — not uploaded. Upload a document.`}
  className="… group/cell">
  <span className="text-muted-foreground/40 transition-colors group-hover/row:hidden">·</span>
  <Plus className="hidden size-3.5 text-muted-foreground group-hover/row:block group-focus-visible/cell:block" />
</button>
```

`Tooltip` on populated cells only, `delayDuration` default, content:
`extractor_version` · `formatWhen(updated_at)` · `N/M domains` · `error_code` when failed.
Empty cells get no tooltip (the `aria-label` and the `+` say everything).

### 3.7 Counters — a sentence that is also a filter

One `text-sm` line with `aria-live="polite"`. Numbers `font-medium text-foreground
tabular-nums`, words `text-muted-foreground`, `·` separators.

```
4 schools · 5 editions · 1 needs review · 0 failed · 12 missing
```

**Non-zero attention counts are buttons.** Clicking *"1 needs review"* applies the needs-review
filter (and toggles it off when already applied, with `aria-pressed`). Zero counts render
plain and inert — a `0 failed` you can click is a small lie about there being something there.
`schools` and `editions` are never interactive.

### 3.8 Filter bar

One row, `flex flex-wrap items-center gap-2`. Four controls, no more.

1. **Search** — `InputGroup` + `InputGroupAddon` (`Search` icon) + `InputGroupInput`,
   `className="w-full max-w-sm"`, placeholder *"Search schools"*. A trailing
   `InputGroupText` renders the `/` keycap hint; pressing `/` anywhere on the page (outside
   an input) focuses it, `Escape` clears and blurs. Debounce 250ms into the URL.
2. **Scope** — `Tabs` + `TabsList` + two `TabsTab`: `With documents` | `All schools`, styled
   `sm:h-7 sm:px-2 sm:text-xs` exactly as `SchoolsRoute`'s filter tabs.
3. **Missing year** — `DropdownMenu` + `DropdownMenuRadioGroup`, options `Any year` +
   one per year, label rendered exactly like `SchoolsRoute`'s `DropdownOptionLabel`
   (label left, count right in `text-xs text-muted-foreground tabular-nums`). Trigger is
   `Button variant="outline"` with a `ChevronDown data-icon="inline-end"`.
4. **Needs review** — a filter chip: `Button variant="outline" size="sm"` with
   `aria-pressed`, `Flag` icon; when active it gets `bg-accent`.

**All four live in the URL** (`useSearchParams`: `q`, `scope`, `missing`, `review`) so a
filtered view is linkable and survives reload. This matches the repo's URL-state convention.

### 3.9 States

- **Loading** → `CoverageSkeleton` (§1.7).
- **Error** → `CdsErrorCard`, title *"Could not load coverage"*.
- **503** → `CdsUnavailable`.
- **Empty, scope = with-documents, no filters** → `Empty` family, icon `FileStack`, title
  *"No CDS documents yet"*, description *"Upload a batch of PDFs to get started."*,
  `EmptyContent` → `Button` → upload route.
- **Empty, filters applied** → not the `Empty` family; a single spanning `TableCell
  className="h-24 text-center text-muted-foreground"` reading *"No schools match these
  filters."* — exactly the `SchoolsTable` precedent. Keeping the frame visible tells the
  admin the data still exists behind the filter.
- **Scope = all-schools, empty query** → same spanning cell, reading *"Search 2,746 schools
  by name to add a document."* (`total` comes from the API).
- **Partial** → per §2.2.
- **Processing** → cell polls at 4s and flips in place. No overlay, no page-level spinner,
  no toast on completion. The counters line updates in the same tick; because it's the only
  live region, the change is announced once, as a sentence.

---

## 4. Screen 2 — Batch upload

Route `/app/admin/cds/upload`, `?batch=<uuid>` (reload-safe), optional `?school_id=&year=`
prefill arriving from an empty coverage cell.

### 4.1 The shape of the screen

One page, start to finish. The staging table **becomes** the job table — no navigation, no
modal, ever. The drop zone's prominence is inversely proportional to how much work is
already staged: hero when empty, a slim strip once rows exist.

### 4.2 Wireframe — empty

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Coverage                                                                            │
│ Batch upload                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                       │
│   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐    │
│   │                              ┌────┐                                        │    │
│   │                              │ ⬆  │                                        │    │
│   │                     Drop Common Data Set PDFs here                         │    │
│   │              School and year are detected automatically.                    │    │
│   │                        [ Choose files ]                                     │    │
│   │                    PDF only · up to 50 MB each                              │    │
│   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘    │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Wireframe — staged

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Coverage        Batch upload                                                        │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ ─ ─ Drop more PDFs, or [choose files] ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │  56px strip
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│ ┌───────────────────────────────────────────────────────────────────────────────────┐│
│ │ File                     │ School             │ Year    │ Pgs │ Status      │     ││  ← sticky
│ ├──────────────────────────┼────────────────────┼─────────┼─────┼─────────────┼─────┤│
│ │ harvard_2024-2025.pdf    │ Harvard University │ 2024–25 │  38 │ ✓ Ready     │  🗑 ││
│ │ 4.2 MB                   │                    │         │     │             │     ││
│ ├──────────────────────────┼────────────────────┼─────────┼─────┼─────────────┼─────┤│
│ │ scan_0043.pdf            │ [ Pick a school ▾] │ [ ▾  ]  │  41 │ ? Needs input│  🗑 ││
│ │ 6.1 MB                   │                    │         │     │  Pick a school│    ││
│ ├──────────────────────────┼────────────────────┼─────────┼─────┼─────────────┼─────┤│
│ │ yale_2024.pdf            │ Yale University    │ 2024–25 │  36 │ ⇄ Replaces  │  🗑 ││
│ │ 3.8 MB                   │                    │         │     │  Supersedes #14│   ││
│ ├──────────────────────────┼────────────────────┼─────────┼─────┼─────────────┼─────┤│
│ │ ~~penn_2023.pdf~~        │ Univ. of Penn.     │ 2023–24 │  40 │ ⧉ Duplicate │  🗑 ││
│ │ 5.0 MB                   │                    │         │     │  Uploaded 12 Aug│  ││
│ └──────────────────────────┴────────────────────┴─────────┴─────┴─────────────┴─────┘│
├──────────────────────────────────────────────────────────────────────────────────────┤
│ 2 ready · 1 needs a school · 1 duplicate skipped          [ Process all (2) ]        │  sticky footer
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Layout

```tsx
<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-6 md:px-10"
         onDragOver={…} onDragLeave={…} onDrop={…}>
  <PageHeader title="Batch upload" actions={<Button variant="ghost" render={<Link to="/app/admin/cds"/>}>
      <ArrowLeft data-icon="inline-start" />Coverage</Button>} />
  <FileDropZone variant={rows.length ? "strip" : "hero"} className="mt-4" />
  <div className="mt-4 min-h-0 flex-1">
    <StagingTable … />        {/* same bounded-height render-prop pattern as §3.3 */}
  </div>
  <BatchActionBar className="shrink-0" />
</section>
```

### 4.5 The drop zone

`FileDropZone.tsx` — native HTML5 DnD, no dependency (PLAN decision 7; `TaskBoard.tsx` is
the in-repo precedent).

- **Hero variant** (`rows.length === 0`): `rounded-xl border border-dashed p-12`, containing
  the `Empty` family — `EmptyMedia variant="icon"` with `Upload`, `EmptyTitle` *"Drop Common
  Data Set PDFs here"*, `EmptyDescription` *"School and year are detected automatically."*,
  `EmptyContent` with a `Button` (**Choose files**) and a `text-xs text-muted-foreground`
  line *"PDF only · up to 50 MB each"*.
- **Strip variant** (rows exist): `flex h-14 items-center justify-center gap-2 rounded-lg
  border border-dashed text-sm text-muted-foreground` — *"Drop more PDFs, or"* +
  `Button variant="link" size="sm"` **choose files**.
- **Dragging** (either variant): `border-ring bg-accent/50` on the zone.
- **The whole page is a drop target.** Once rows exist, aiming at a 56px strip is annoying.
  A dragenter on the page container renders a full-bleed overlay:
  `pointer-events-none absolute inset-4 z-40 rounded-xl border-2 border-dashed border-ring
  bg-background/80 flex items-center justify-center` with `font-heading text-lg font-medium`
  *"Drop to add to this batch"*. Cheap; removes all aiming.
- **Accessibility:** the zone contains a visually-hidden real
  `<input type="file" multiple accept="application/pdf" />` with a `<label>`; the **Choose
  files** button triggers it. The zone itself is not a tab stop (the input is).
- **Rejection:** non-PDF or over-cap files never create a row — one `toast.error` summarising
  (*"3 files skipped — PDF only, 50 MB max"*). This is page-scoped, so a toast is right (law 3).

### 4.6 Staging table

Columns and widths (`table-fixed`, `colgroup`):

| Col | Width | Content |
|---|---|---|
| File | `1fr`, min 240 | `text-sm font-medium truncate` filename + `text-xs text-muted-foreground tabular-nums` size. Duplicate rows: `line-through decoration-muted-foreground` on the filename. |
| School | 260 | Matched → `text-sm truncate`. Always clickable → opens `SchoolPicker`. Unmatched → `Button variant="outline" size="sm"` *"Pick a school"*. |
| Year | 132 | `Select` with `SelectButton` `size="sm"`, options from the API's year list. |
| Pages | 72 | `text-xs text-muted-foreground tabular-nums`, `—` while unknown. *Hidden <1280px.* |
| Status | 180 | `UploadStatusChip` + reason sub-line. |
| *(actions)* | 48 | `Button variant="ghost" size="icon-sm"` `Trash2`, `opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100`. |

**There is no separate edit mode.** School and year are always directly editable, in place, on
every row — not just `needs_input` rows. Making the admin click "edit" to fix a wrong
detection is friction with no upside.

`SchoolPicker.tsx` — `Popover` + `Command`/`CommandInput`/`CommandList`/`CommandItem`,
querying `GET /admin/cds/schools?q=`, 250ms debounce, `CommandEmpty` → *"No school matches."*
Popup width `w-80`. Item shows `name` (`text-sm`) + `city, state` (`text-xs
text-muted-foreground`). Selecting fires `PATCH /uploads/{id}` and the row's status
re-derives from the response.

### 4.7 The action bar

Sticky bottom inside the page (not `fixed` to the viewport — it must respect the sidebar):
`sticky bottom-0 -mx-6 flex items-center justify-between gap-4 border-t bg-background px-6
py-3 md:-mx-10 md:px-10`.

- **Left:** the readiness sentence, `text-sm`, `aria-live="polite"`, numbers `font-medium
  text-foreground tabular-nums`:
  `2 ready · 1 needs a school · 1 duplicate skipped`
- **Right:** one primary `Button` — **`Process all (2)`**. Disabled when zero ready.

**The blocking reason lives in the sentence, never in a tooltip on a disabled button.** A
disabled button with a hidden explanation is the most common small cruelty in admin tools.

### 4.8 Lifecycle and states

1. **Drop** → a row is inserted **optimistically, immediately**, with the real filename and
   size from the `File` object, status `uploading`. This is the moment the screen feels fast.
2. **Upload** → one `POST /admin/cds/uploads` per file, max 4 in flight (`useBatchUpload`).
   Per-file isolation is structural: one request, one row, one failure boundary.
3. **Response lands** → the row's school, year, page count and status fill in **in place**;
   no re-sort, no re-mount, no list animation. (Rows are keyed by client id, not index.)
4. **Failure** → the row goes `failed` with the server reason inline. The batch continues.
5. **Process all** → `POST /uploads/{batch_id}/process`. Rows in the response's `queued` array
   flip to the **document status** vocabulary (`processing`, §2.1) and the table starts
   polling `GET /admin/cds/jobs?batch_id=…` at 2s. Rows in `skipped` keep their staging
   status and gain the skip reason inline.
6. **Running** → the status cell shows the `processing` chip plus a determinate
   `Meter`/`MeterTrack className="h-1 rounded-full"`/`MeterIndicator` driven by the real
   `progress:{done,total}`, with `4/8 domains` in `text-xs tabular-nums` beside it.
7. **Done** → `approved`/`needs_review`/`failed` chip, and the actions column gains a
   `Button variant="link" size="sm"` **Review** → `/app/admin/cds/documents/{id}`.
8. **Batch complete** → the action bar's sentence becomes `12 done · 1 failed` and the
   primary button becomes `Button variant="outline"` **Open coverage**. One `toast.success`
   *"Batch finished — 12 documents extracted."* (page-scoped, so a toast is correct).

**Reload safety:** `batch_id` is in the URL, staging lives in Postgres. On mount with
`?batch=`, fetch `GET /uploads?batch_id=` and rebuild; show `BatchSkeleton` while loading.

**Empty states:** no batch → hero drop zone (that *is* the empty state; no separate `Empty`
block). Batch fetched but empty → hero drop zone plus `text-xs text-muted-foreground`
*"This batch is empty."*

---

## 5. Screen 3 — Document review

Route `/app/admin/cds/documents/:documentId`. Where accuracy is actually enforced.

**The one metric that matters: an admin clears a flagged document in under two minutes.**
Every decision below is subordinate to that.

### 5.1 What makes two minutes possible

Four things, in order of leverage:

1. **A flag queue, not a document.** The admin's job is not "read this document," it's
   "resolve N flags." `n` / `p` walk the unresolved flags. Each jump does three things at
   once: scrolls the metric into view, focuses its value, and moves the left viewer to the
   evidence page. One keystroke, full context.
2. **Evidence chip → page jump, without focus theft** (§1.11).
3. **Collapsed by default, except what's flagged.** A manifest has 1,149 metrics. On load,
   expand only the sections with unresolved flags; collapse the rest. Accordion panels are
   unmounted when closed, so the DOM stays small — **this is why no virtualisation is
   needed** (§8).
4. **The blocking reason is a sentence in the action bar**, always visible, never a tooltip.

### 5.2 Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ‹  Yale University · 2024–25   ⚑ Needs review   yale_cds_2024.pdf · 36pp             │
│                                                        [ Re-run ]  [ Reject ]        │  56px strip
├──────────────────────────────────┬───────────────────────────────────────────────────┤
│  ‹  4 / 36  ›        [ Fit ▾ ]   │  ⚑ 3 unresolved of 7    ‹ n / p ›   ☑ Flagged first│
│ ┌──────────────────────────────┐ │ ┌───────────────────────────────────────────────┐ │
│ │                              │ │ │ ▾ A. General information        12/14  ⚑1     │ │
│ │                              │ │ │   Institution name        Yale University     │ │
│ │      [ page image ]          │ │ │   Control                 Private   [p.1]     │ │
│ │                              │ │ │ ⚑ Total enrolment         12,060   [p.3]      │ │
│ │                              │ │ │   ⚠ B1: undergrad (6,590) > total (12,060)    │ │
│ │                              │ │ │                                                │ │
│ │                              │ │ │ ▸ B. Enrolment and persistence  38/41          │ │
│ │                              │ │ │ ▾ C. First-time admission        9/22  ⚑2     │ │
│ │                              │ │ │ ⚑ C1 Admitted, total      8,412  [p.8] ✎      │ │
│ │                              │ │ │   ✕ C1: admits (8,412) > applicants (7,932)   │ │
│ └──────────────────────────────┘ │ └───────────────────────────────────────────────┘ │
├──────────────────────────────────┴───────────────────────────────────────────────────┤
│ 3 unresolved flags — resolve them, or approve anyway   [Approve anyway]  [ Approve ] │  sticky
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Layout

**No `PageHeader` on this screen.** It's a workbench, not a list page; the 72px a
`PageHeader` costs is a whole metric row of PDF. Instead a 56px identity strip that carries
the same information density in one line. Justified deviation — state it in the PR.

```tsx
<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <ReviewHeader className="flex h-14 shrink-0 items-center gap-3 border-b px-6 md:px-10" />
  <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <PdfPageViewer  className="min-h-0 border-r" />   {/* own scroll */}
    <ReviewPanel    className="min-h-0" />            {/* own scroll */}
  </div>
  <ApproveBar className="shrink-0 border-t px-6 py-3 md:px-10" />
</section>
```

Two independently scrolling columns, per PLAN §F5. No resize handle (PLAN cut list).

**Header strip contents,** left to right:
`Button variant="ghost" size="icon-sm"` (`ArrowLeft`, → coverage) ·
`font-heading text-base font-medium` school name · `text-muted-foreground` `·` ·
academic year · `StatusChip` · `text-xs text-muted-foreground truncate` filename + `36 pp` ·
spacer · `Button variant="outline" size="sm"` **Re-run** · `Button
variant="destructive-outline" size="sm"` **Reject**.

Re-run and Reject live up here, away from Approve. Destructive and constructive actions
sharing a corner is how people mis-click.

### 5.4 Left pane — the viewer

`PdfPageViewer.tsx`, ~80 lines. `<img src={pageImageUrl(documentId, page, 1400)} />` inside a
`ScrollArea`. No PDF.js (PLAN decision 6).

- **Toolbar** (`flex h-10 shrink-0 items-center gap-2 border-b px-4`):
  `Button size="icon-sm" variant="ghost"` `ChevronLeft` · a `w-12` `Input` with the page
  number (`text-center text-sm tabular-nums`, commit on Enter/blur, clamped) · `text-sm
  text-muted-foreground tabular-nums` `/ 36` · `ChevronRight` · spacer · a `Select` with
  `Fit width` / `Actual size`.
- **Image:** `<img alt={`Page ${page} of ${pageCount}`} className="mx-auto w-full max-w-3xl
  rounded-lg border" loading="eager" />`. Pre-fetch page ±1 with a hidden `<img>` so `[`/`]`
  feel instant — the endpoint is `Cache-Control: immutable`, so this is free after the first
  visit.
- **Loading a page:** keep the previous page visible at `opacity-64` rather than blanking to
  a skeleton. Blanking makes fast paging feel like a slideshow of nothing.
- **Failed render:** replace the image with a bordered box, `text-sm text-muted-foreground`
  *"Could not render page 4."* + `Button variant="outline" size="sm"` **Retry**.
- **Imperative API:** `goToPage(n: number, opts?: { flash?: boolean })`, exposed via `ref`
  and called by the right pane. Flash = §5.7.
- **Announcement:** the viewer owns nothing; the page announcement goes through the screen's
  single polite live region (§1.11).

### 5.5 Right pane — the flag bar

`flex h-10 shrink-0 items-center gap-3 border-b px-4 text-sm`, `aria-live="polite"`:

- `FlagChip`-style summary: `⚑ 3 unresolved of 7` — the `3` in `font-medium text-warning
  tabular-nums`, or `text-muted-foreground` when zero.
- `‹` `›` `Button size="icon-sm" variant="ghost"` — prev/next unresolved flag, with
  `aria-keyshortcuts="p"` / `aria-keyshortcuts="n"`.
- Spacer.
- `Checkbox` + label `text-xs text-muted-foreground` **Flagged first** (default on, mirrored
  to `?flagged=1`). When on, flagged metrics sort to the top of their own section.
- `Button size="icon-sm" variant="ghost"` `?` → a `Popover` listing shortcuts, rendered with
  `CommandShortcut` keycaps from `command.tsx`.

### 5.6 Right pane — sections and metric rows

`Accordion` (multiple open), one `AccordionItem` per domain in CDS letter order
(`review-order.ts`). **Do not set `keepMounted`** — closed panels must unmount (§5.1.3).

**Section header** (`AccordionTrigger`), one line:
`font-heading text-base font-medium` letter + title · spacer · `text-xs text-muted-foreground
tabular-nums` `12/14 verified` · `FlagChip` count when > 0.
A section with an unresolved `error` flag gets `border-l-2 border-destructive`; with only
warnings, `border-l-2 border-warning`; otherwise `border-l-2 border-transparent`. A 2px rail
is enough — do not tint whole section backgrounds.

**Metric row** — `grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-1.5 text-sm`:

| Slot | Content |
|---|---|
| Label | metric `title`, `truncate text-muted-foreground`; `Tooltip` carries the full title + `description`. A leading `Flag` icon in `text-warning`/`text-destructive` when flagged. |
| Value | the click-to-edit button (§5.8). `font-medium tabular-nums` for numbers. Unavailable → `text-muted-foreground` italic-free text: `Not reported` / `Not extracted` / `Conflict`. |
| Evidence | `Button variant="ghost" size="xs"` — `FileText` + `p. 8`. Absent evidence → nothing (not a disabled button). |

**Availability is text, not a badge.** With hundreds of rows, a badge per row is visual
noise. Reserve badges for flags — the things that need attention. Availability reads as a
muted word in the value slot.

**Flag detail** renders directly under its metric row, not in a tooltip:
`flex items-start gap-2 pb-1.5 pl-6 text-xs` + `FlagChip severity code` + the `message` in
`text-muted-foreground`. The message is already human-readable from the API
(*"C1: admits (8,412) > applicants (7,932)"*) — print it, don't paraphrase it.

### 5.7 Evidence chip → page jump

Click (or `Enter`) on the evidence chip:

1. `viewerRef.current.goToPage(n, { flash: true })`.
2. Flash = a `ring-2 ring-ring` on the image container for 900ms, faded in/out with
   `transition-shadow`. Under `useReducedMotion()`, the ring appears and disappears with no
   transition.
3. Announce *"Showing page 8"* in the polite region.
4. **Focus does not move** (§1.11).

### 5.8 Click-to-edit

Reuses the repo's `useSyncedDraft` dirty/commit/revert pattern (see §7 gap 6 for where it
should live).

**Resting state** — the value is a button that looks like text:
```
rounded-sm -mx-1 px-1 text-left transition-colors hover:bg-accent
outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background
```
`aria-label={`Edit ${metric.title}, currently ${display}`}`.

**Editing** — the row expands in place (never a modal, never a popover; the left pane must
stay visible). Three stacked fields, `mt-1.5 space-y-2 rounded-lg border bg-card p-3`:

1. **Value** — `Input` (number/text) or `Select` (enum), autofocused, `size` default.
2. **Page** — `Input` `w-20 tabular-nums`, prefilled from the original finding.
3. **Excerpt** — `Textarea rows={2}`, prefilled from the original finding, **required**.
   Helper `text-xs text-muted-foreground`: *"What the document actually says on page 8."*
   Empty → Save disabled + `text-xs text-destructive` *"An excerpt is required."*

This enforces `PLAN.md` §B5.3 (evidence stays truthful) in the UI, not only at the API. It is
the honesty carve-out made visible, and it is worth the extra two fields.

Footer of the editor: `Button size="sm"` **Save** · `Button size="sm" variant="ghost"`
**Cancel** · right-aligned `text-xs text-muted-foreground` `⌘↵ save & next flag`.

**Commit** → optimistic: the row shows the new value immediately with an **edited** marker
(a `size-1.5 rounded-full bg-warning` dot before the label, `Tooltip` *"Edited, pending
approval"*), plus a `toast.success` carrying an **Undo** action (sonner's `action` prop —
consistent with the repo's undo-toast convention). Server rejection → revert the row, inline
`text-xs text-destructive` under it, and `handleCdsError` fires the toast.

**Focus on close:** returns to the value button.

### 5.9 Keyboard map

Global on the screen; **all suppressed while an `input`/`textarea`/`[contenteditable]` has
focus**, except `Escape`, `Enter` and `⌘/Ctrl+Enter`.

| Key | Action |
|---|---|
| `n` / `p` | Next / previous **unresolved flag** — scroll into view + focus value + jump viewer |
| `j` / `k` | Next / previous metric row within expanded sections |
| `e` or `Enter` | Edit the focused metric |
| `Escape` | Cancel the editor (revert) |
| `Enter` | Commit the editor |
| `⌘↵` / `Ctrl↵` (in editor) | Commit and jump to the next unresolved flag |
| `[` / `]` | Previous / next page in the viewer |
| `⌘↵` / `Ctrl↵` (not in editor) | **Approve** — only when Approve is enabled |
| `?` | Shortcut popover |

`a` for approve is **deliberately not bound**: a single unmodified letter that activates an
irreversible action, on a screen where the admin is constantly typing, is a trap. `⌘↵` is the
universal "submit" idiom and costs nothing.

Expose the bindings to assistive tech with `aria-keyshortcuts` on the corresponding buttons.

### 5.10 The approve bar

`sticky bottom-0 flex items-center justify-between gap-4 border-t bg-background px-6 py-3
md:px-10`, spanning **both** panes — approve is a decision about the document, not about the
data pane.

- **Left, `text-sm`, `aria-live="polite"`** — one sentence, three forms:
  - blocked: `3 unresolved flags — resolve them, or approve anyway`
  - clean with edits: `Ready to approve · 4 pending edits`
  - clean: `Ready to approve`
- **Right:**
  - blocked → `Button variant="outline"` **Approve anyway** + `Button disabled` **Approve**.
  - clean → `Button` **Approve** only.

**Approve anyway** opens a `Dialog`:
title *"Approve with 3 unresolved flags?"*; body — the flag list (`FlagChip` + message, each
a button that closes the dialog and jumps to that metric — an escape hatch back to doing it
properly); a **required** `Checkbox` *"I've checked these against the document."*; an optional
`Textarea` note (recorded in `cds_admin_audit`); footer `Button variant="ghost"` **Cancel** +
`Button variant="destructive"` **Approve with 3 unresolved flags** (disabled until the
checkbox is ticked). The confirm button repeats the count — no generic "Confirm".

**Reject** opens a `Dialog` with a **required** reason `Textarea` and a `destructive`
confirm. On success → navigate to coverage + `toast.success`.

**Re-run** → `POST …/rerun`, no dialog (it's non-destructive and re-runnable). The header
status flips to `processing` and the screen starts polling at 3s. Toast: *"Re-extraction
queued."*

**A 409 from Approve** (flags appeared or changed server-side) is **not** a toast — refetch,
re-render the blocking sentence, and move focus to the flag bar's next-flag button. The
screen tells the truth about why it refused.

### 5.11 States

- **Loading** → `ReviewSkeleton` (§1.7).
- **Error / 404** → `CdsErrorCard`, title *"Could not load this document"*, plus a link back
  to coverage.
- **503** → `CdsUnavailable`.
- **Extraction still running** → the panes render, the right pane shows an `Empty` block
  (icon `Loader2 animate-spin`, title *"Extracting…"*, description with the determinate
  `Meter` and `4/8 domains`), and the approve bar is replaced by the same sentence. The left
  viewer works immediately — the PDF is already there, so the admin can start reading.
- **Extraction failed** → right pane `Empty`, icon `OctagonX`, title *"Extraction failed"*,
  the `error_code` in `text-xs text-muted-foreground`, `EmptyContent` → `Button` **Re-run**.
- **No flags** → the flag bar reads `No flags` in `text-muted-foreground`; the `‹ ›` buttons
  are disabled; all sections start **collapsed**, and the right pane shows a one-line hint
  *"Everything extracted cleanly. Spot-check a section, then approve."*
- **Partial** → sections absent from the manifest simply don't render; the header strip adds
  `text-xs text-muted-foreground` `9/13 domains`.

---

## 6. Cross-screen consistency checklist

Before any of the three PRs merges, verify:

- [ ] Every status chip came from `cds-status.tsx`. No local variant maps.
- [ ] Every academic year rendered through `formatAcademicYear` (en dash, `2024–25`).
- [ ] Zero hex, zero `oklch()`, zero `text-[…]`/`bg-[…]`, zero `--task-*`/`--workspace-*`.
- [ ] Every changing number has `tabular-nums`.
- [ ] Every custom interactive element has the §1.5 focus-ring string, verbatim.
- [ ] Page-level fetch errors use `CdsErrorCard`; 503 uses `CdsUnavailable`.
- [ ] Row errors are inline; action errors are toasts. No screen does both for one event.
- [ ] Every table has an `sr-only` caption and `scope` attributes.
- [ ] Exactly one `aria-live="polite"` region per screen.
- [ ] `refetchOnWindowFocus: false` on all cds-admin queries; every `refetchInterval` returns
      `false` once terminal.
- [ ] Skeleton geometry matches loaded geometry (no jump).

---

## 7. Design-system gaps — honest list, minimal fixes

| # | Gap | Severity | Minimal fix | Owner |
|---|---|---|---|---|
| 1 | **`Table` cannot do sticky header/column.** Its container className is hardcoded `relative w-full overflow-x-auto`, which silently defeats `sticky top-0`. | Medium — a real trap, one hour lost per person who hits it | **No primitive change.** Use the container's `render` prop to add `h-full overflow-auto` (§3.3). Documented here so all three implementers get it right first time. If a fourth screen needs it, *then* add a `stickyHeader` prop to `table.tsx`. | all |
| 2 | **`Badge` variants are wired to feature-private `--task-*` tokens.** `variant="success"` resolves to `--task-done-pill-bg`. The recon says `--task-*` is private to the tasks feature, yet a shared primitive depends on it. | Medium — a latent inconsistency, not a blocker | Introduce semantic aliases in `index.css` — `--pill-neutral-bg/-fg`, `--pill-info-*`, `--pill-success-*`, `--pill-warning-*` — set to the existing `--workspace-*-pill-*` values, and repoint `badge.tsx` at them. ~12 lines, **zero visual diff**, un-privatises the primitive. **Owner's call, and if done it must land *before* P6a/b/c fan out.** If declined: nothing breaks — implementers use the `variant` API and never touch the raw token. | owner / pre-P6a |
| 3 | **No numeric type-scale tokens.** Sizes are ad-hoc Tailwind classes per page. | Low | Not worth fixing for three screens. §1.3 pins the exact classes so the three agents can't drift. Revisit when a fourth surface appears. | — |
| 4 | **`Meter` is determinate-only, and `fetch` gives no upload progress.** `PLAN.md` §F4 specifies a `Meter` for per-file upload progress, but the house client (`safeFetch` → `fetch`) has no upload progress events; only XHR does. | **High — the plan asks for a bar we cannot honestly fill** | **Drop the upload progress bar.** Show the `uploading` chip with a spinner. Use `Meter` only for **extraction** progress, where `GET /jobs` returns real `{done,total}` (§4.8.6). Do not add an indeterminate bar and do not switch the upload call to XHR for a cosmetic bar. This is law 4 and AGENTS.md principle 3. | P6b |
| 5 | **No indeterminate progress primitive.** | Low | Not needed — see gap 4. `Loader2 animate-spin` is the house indeterminate signal. Do not build one. | — |
| 6 | **`useSyncedDraft` is private to `SchoolWorkspace.tsx`** (an 8-line local function), but §5.8 needs exactly it. | Low | Extract verbatim to `frontend/src/lib/useSyncedDraft.ts` and update the single import in `SchoolWorkspace.tsx`. A genuine DRY win under AGENTS.md's "search before adding / extend by the smallest diff", and it touches one line of an unrelated file. **P6c owns it** (no other screen needs it, so there's no parallel-edit conflict). Copy-pasting the hook into `features/cds-admin/` is the wrong answer. | P6c |
| 7 | **No error-message mapper for cds-admin.** `api/workspace/hook-utils.ts::handleMutationError` is workspace-copy-specific. | Low | Mirror it as `api/cds-admin/hook-utils.ts` with the §1.9 message table. A mirror, not a reuse — the two have different reasons to change (AGENTS.md: "DRY is about knowledge, not shape"). | P6a |
| 8 | **No split-pane, no PDF renderer.** | — | Already resolved by `PLAN.md` decision 6 (server-side PNG) and a two-column CSS grid. No design-system addition needed. | — |
| 9 | **No keycap primitive outside `command.tsx`.** | Low | `CommandShortcut` is exported and renders keycaps fine; use it inside the shortcuts `Popover`. No addition. | P6c |

**Net:** one high-severity honesty issue (gap 4, resolved by removing a bar), one optional
token cleanup (gap 2), one 8-line extraction (gap 6), and one trap that this document
defuses (gap 1). **No `--cds-*` tokens. No new primitives.**

---

## 8. What makes this feel excellent — and what doesn't

### Worth the effort

1. **Empty cells that recede and reveal.** A near-invisible `·` that becomes `+` on row
   hover. This is what turns a 99%-empty matrix from "broken" into "quiet." Highest
   leverage detail on the whole project, and it costs about six lines.
2. **Counters that are filters.** *"1 needs review"* is the sentence and the button. Reading
   the summary and acting on it become the same gesture.
3. **`n` / `p` flag walking that moves three things at once** — scroll, focus, and PDF page.
   This is the entire two-minute budget in one keybinding.
4. **Focus that doesn't get stolen on page jump.** Invisible when right, infuriating when
   wrong.
5. **Staging rows that become job rows in place.** No navigation, no modal, no "your batch is
   processing" screen. One table, whole lifecycle. Rows keyed by client id so nothing
   re-mounts.
6. **`tabular-nums` on everything that polls.** Numbers changing under a 2-second refresh
   without the row twitching is the difference between "live" and "flickery."
7. **Blocking reasons as sentences, always visible.** `3 unresolved flags — resolve them, or
   approve anyway` in the action bar beats a disabled button with a tooltip, every time.
8. **The excerpt field on every edit.** Two extra fields that make the honesty rule physical
   rather than a comment in the API layer.
9. **Prefetching viewer pages ±1.** The endpoint is immutable-cached; paging becomes
   instant for free.
10. **Confirm buttons that repeat the number** — *"Approve with 3 unresolved flags"*, not
    *"Confirm"*.

### Deliberately not worth it

1. **A resizable split pane in review.** Two grid columns. Add a handle if an admin asks.
   (Already `PLAN.md`'s cut list — reaffirmed.)
2. **Virtualising the 1,149-metric list.** Collapsed accordions with unmounted panels solve
   it for free. A virtualiser is a dependency, a scroll-restoration bug, and a
   `scrollIntoView` problem for the flag walk.
3. **ARIA grid pattern + roving tabindex on the coverage matrix.** Native table semantics
   plus complete `aria-label`s per cell get us real accessibility; a hand-rolled grid widget
   gets us subtle keyboard bugs. Revisit only if the default view ever routinely shows 50+
   rows.
4. **A bespoke mobile layout, and PLAN §F5's per-metric `Sheet`.** Desktop tool. Stack and
   scroll below `lg`, and stop.
5. **Column resizing on the coverage grid.** `useColumnLayout` exists and is tempting. The
   matrix has fixed semantics; resizing a year column serves nobody.
6. **Animating coverage cell transitions.** A colour change under a 4-second poll is enough.
   Animating it puts motion exactly where the eye should *not* be pulled.
7. **Multi-select + bulk actions in staging.** "Process all" is the bulk action. Per-row
   delete covers the rest.
8. **A thumbnail rail or continuous scroll in the viewer.** Paged + `[`/`]` + evidence jumps
   is faster than scrolling 36 pages, and it's a tenth of the code.
9. **A light-theme pass.** The app is dark-only on this branch; every colour here is a
   semantic token, so a future light theme costs nothing and pre-building it costs real time.
10. **Toasts on background completions.** One toast when a *batch* finishes. Zero toasts when
    an individual coverage cell flips — the cell flipping *is* the notification.
