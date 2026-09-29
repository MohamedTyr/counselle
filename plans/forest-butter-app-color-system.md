# Forest / Butter — whole-app color implementation plan

Status: proposed implementation plan; no implementation is authorized by this document alone.
Prepared: 2026-09-13. Scope: all mounted public and authenticated frontend surfaces.

This plan follows the owner's accepted white workspace and subtle forest-gray sidebar. It supersedes the earlier Evergreen/Citron direction **for the future implementation**, including the separate orange/wine landing palette. It does not change the running application or the current design-system documentation until implementation begins.

## 1. The finished experience

A student works between university research, task planning, and long-form essay writing on a laptop in ordinary daylight, often for an extended session. White working surfaces keep reading clear; the quiet forest-gray sidebar provides a persistent spatial boundary; forest identifies the product and its controls; butter supplies a small, warm invitation to begin.

The color strategy is restrained. Brand identity comes from consistent placement, not the amount of green on the screen. Most pixels remain white or neutral. A student should recognize the same action, selection, warning, and unavailable value anywhere in the app without relearning a color code.

The accepted sidebar itself, the white Schools workspace, and the existing shared essay document are the visual anchors. Do not substitute an unrelated reference product or start another palette exploration.

### Binding decisions

| Role | Decision | Reason |
| --- | --- | --- |
| Main workspace | Pure white, `#FFFFFF` | Owner explicitly accepted this beside the sidebar. |
| Sidebar | Preserve its exact accepted mixture: 92% `--gray-100` + 8% `--forest-200`, in OKLab | Do not derive it from the new white canvas or return to dark/sage chrome. |
| Identity and page-title ink | Forest `#204122` | Connects each page to the sidebar without tinting all reading text. |
| Routine primary action | Forest `#275028`, inverse `#FCFCFC` | Stable, legible action language throughout the product. |
| Invitation action | Butter `#F9EA92`, forest `#204122` text | Reserved for the specific entry points listed below. |
| Soft selection | `#EDF5EC`, forest `#204122` text | Makes selected content evident without turning lists into dark blocks. |
| Global sidebar current item | Keep solid `#275028` with `#FCFCFC` text | Current application location needs stronger emphasis than a selected filter or row. |
| Body, essay, data, labels | Existing neutral ink roles | Sustained reading must not become a wall of green text. |
| Error, warning, success | Separate existing Red, Amber, Leaf semantic roles | Brand colors cannot replace operational meaning. |
| Data visualization | Preserve neutral quantitative charts and labeled ordered fit scale | Color must not imply that a school is better, safer, or more certain. |
| Theme | One light appearance across mounted routes | OS dark preference must not resurrect the landing's old palette. No new dark theme. |

### Palette placement and attention

1. The sidebar's New chat is the only butter action in an authenticated workspace view. Keep it visible and unchanged.
2. Page actions such as Add school, Add activity, Create essay, Save, Submit, and Send use forest. Secondary peers use neutral outline or ghost treatment.
3. Public landing and auth pages may each have one butter primary invitation in a visible action group. This exception is explicit because the sidebar is absent.
4. Selected items, progress, and brand links use forest roles, never butter. Butter does not mean selected, unfinished, flagged, AI-generated, warning, or successful.
5. No butter page background, green body tint, colored decorative side stripe, selection dot, gradient text, or new decorative gradient.
6. Preserve layout, density, typography, radii, icon library, and working interactions. This is a color-system migration, not a page-layout rewrite.

## 2. Scope and exclusions

### Included

- `/`: routed React landing page, its interactive plan/conversation demo, and its entry-document theme metadata.
- `/login`, `/register`, `/onboarding` and mounted onboarding artwork.
- All `/app` shell states, profile/account controls, and routed school, task, activity, essay, and AI surfaces.
- `/app/admin/facts`, including loading, error, empty, operational status, tables, and controls.
- Shared primitives and portal surfaces: buttons, fields, menus, date pickers, dialogs, sheets, toasts, tooltips, tabs, badges, skeletons, and charts.
- Development galleries as consumers used for validation; their fixtures and routing remain intact.
- Design-system documentation and currently accepted brand documentation when implementation is complete.

### Explicit exclusions

- Backend behavior, database, agent prompts, data schemas, content semantics, feature delivery, and API changes.
- Building Calendar: `/app/calendar` currently renders `RouteSurface`; only its inherited colors change.
- Reviving parked CDS screens under `pages/cds-*` / `features/cds-admin/*`. Shared-token compatibility still must not break their existing tests.
- Dead/vendor AI scaffolding without production importers. Production imports currently include `components/ai-elements/message.tsx` and `inline-citation.tsx`; confirm imports before classifying a file as dead.
- Historical experiments in `frontend/public/palette-preview.html`, `palette-first-directions.html`, `sidebar-directions.html`, palette JSON, and preview fonts. Preserve them as historical comparisons; do not change their colors to make an audit pass.
- Logos of universities, favicons, user uploads, document images, photographs, syntax-highlighted content, and information-bearing external assets. Do not recolor them to forest.
- Existing typography/layout/motion debt unrelated to a changed color state. Record an observed blocker; do not expand into an unrelated redesign.

## 3. Architecture: one system, four tiers

Preserve the current import order in `frontend/src/index.css`: primitives → semantic/elevation → feature families → shadcn bridge → Tailwind theme. Do not add a parallel theme provider, style registry, palette library, or component-local color constants.

| Tier | Owner files | Implementation rule |
| --- | --- | --- |
| Primitives | `frontend/src/styles/primitives.css` | Raw OKLCH values live here. Retain exact accepted Forest/Butter conversions. |
| Semantic meaning | `semantic.css`, `elevation.css` | Own selection, action, invitation, ink, status, focus, and surface decisions; own all color mixes. |
| Component/family roles | `shell.css`, `workspace.css`, `schools.css`, `task.css`, `activity.css`, `essay.css`, `profile.css`, `onboarding.css` | Alias semantics by the role needed by that family; no literal colors or local mixes. |
| Public adapters | `shadcn.css`, `theme.css`, component classes | Expose existing roles consistently. A `var(--token)` utility is allowed. A raw Tailwind palette utility is not. |

A generic `bg-card`, `bg-background`, or `text-muted-foreground` is not automatically a bug. Trace the bridge first. Change a consumer only when its current semantic meaning is wrong, or it bypasses an established family role. Do not replace every utility mechanically.

### Preserve these primitives

| Primitive | Approved value/reference | Uses |
| --- | --- | --- |
| `--gray-0` | `oklch(100% 0 0)` | White canvas and raised surfaces. |
| `--gray-10` | Existing exact conversion of `#FCFCFC` | Foreground on solid forest. |
| `--gray-25` | Existing 99% neutral | Very quiet secondary background where explicitly assigned. |
| `--gray-100` | Existing 97% neutral | Recessed workspace wells and preserved sidebar mix. |
| `--forest-50` | Existing exact conversion of `#EDF5EC` | Soft selection. |
| `--forest-200` | Existing exact conversion of `#C6D3C4` | Light ordered data step and subtle edges/mixes. |
| `--forest-600` | Existing exact conversion of `#315333` | Secondary forest ink on chrome. |
| `--forest-700` | Existing exact conversion of `#275028` | Primary app action. |
| `--forest-800` | Existing exact conversion of `#204122` | Identity, page title, links, focus, action hover. |
| `--butter-300` | Existing exact conversion of `#F9EA92` | Invitation action. |

Do not regenerate or approximate these values. Keep the neutral and status ramps unless the contrast gate identifies a specific failing role. Remove obsolete Evergreen/Citron primitives only after production references have migrated and a reference scan confirms no remaining consumers. Do not rename Evergreen primitives to Forest while leaving their old values in place.

## 4. Exact semantic assignments

### Surfaces and text

| Role | Target | Notes |
| --- | --- | --- |
| `--canvas` | `var(--gray-0)` | Main page stays pure white. |
| `--surface-raised` / `--surface-overlay` | `var(--gray-0)` / raised alias | Cards and overlays are white; hierarchy comes from structure/elevation. |
| `--surface-inset` | `var(--gray-100)` | A neutral grouping well, not a tinted card. |
| `--surface-sunken` / `--surface-trough` | Alias inset | Preserve the existing semantic relationship. |
| `--surface-quiet` | `var(--gray-25)` | Only where a near-invisible quiet background is already needed. |
| `--field-surface` | `var(--surface-raised)` | Editable fields remain white. |
| `--field-surface-canvas` | `var(--canvas)` | Unboxed editing stays at canvas level. |
| `--surface-selected` | `var(--forest-50)` | Selected content, not normal row rest. |
| `--chrome-surface` | `color-mix(in oklab, var(--gray-100) 92%, var(--forest-200))` | Locked sidebar color, independent of `--canvas`. |
| `--ink` | Existing `var(--gray-900)` | Body, student essay, school values, table rows. |
| `--ink-secondary`, `--ink-muted`, `--ink-faint`, `--ink-placeholder` | Retain existing readable neutral aliases | All real information and placeholders must meet text contrast. No additional opacity. |
| New `--heading-ink` | `var(--forest-800)` | Page titles, public headings, auth titles. |
| New `--link-ink` / `--link-ink-hover` | `var(--forest-700)` / `var(--forest-800)` | Link affordance is also shown through underline or a clear control/position. |

Do not apply `--heading-ink` using a global `h1,h2,h3` selector. The shared page title aliases it; reading content and student-written headings keep their document/prose ink. Workspace section labels, table headers, and data-card titles stay neutral.

Keep existing neutral hover/press formulas (4% / 7% neutral overlay) on neutral rows and controls. Their result follows the correct local surface. Soft selected hover/press is separately defined below so neutral hover cannot wipe a selection.

### App action and selection

| Existing role | Target |
| --- | --- |
| `--brand` | `var(--forest-700)` |
| `--brand-hover` | `var(--forest-800)` |
| `--brand-active` | `color-mix(in oklab, var(--forest-800) 90%, var(--gray-900))` |
| `--brand-edge` | `var(--brand)` |
| `--brand-edge-hover` | `var(--brand-hover)` |
| `--brand-edge-active` | `var(--brand-active)` |
| `--on-brand` | `var(--gray-10)` |
| `--on-brand-quiet` | `color-mix(in oklab, var(--gray-10) 12%, transparent)`; keyboard-hint overlay fill inside a primary CTA, **not** a text color |
| `--brand-subtle` / `--brand-chip` | `var(--forest-50)` |
| `--brand-subtle-ink` / `--brand-chip-ink` | `var(--forest-800)` |
| `--brand-subtle-border` | `var(--forest-200)` for decorative grouping only |
| `--brand-muted` | `var(--forest-600)` |
| `--focus-ring` | `var(--forest-800)` |
| `--brand-scale-3` | `var(--forest-700)` |
| `--brand-scale-2` | `color-mix(in oklab, var(--forest-700) 50%, var(--forest-200))` |
| `--brand-scale-1` | `var(--forest-200)` |
| New `--selection-ink` | `var(--forest-800)` |
| New `--selection-hover` | `color-mix(in oklab, var(--forest-50) 96%, var(--forest-800))` |
| New `--selection-pressed` | `color-mix(in oklab, var(--forest-50) 93%, var(--forest-800))` |

Family aliases for selected rows, filter chips, editable multi-select items, scheduler choices, and local navigation must consume this soft-selection recipe. Add those aliases only where the family needs them. Keep the global sidebar current item solid forest. Selected state is persistent; hover and press must never make it look unselected.

### Invitation action

Add these semantic roles, then alias the existing `--chrome-action*` roles to them. This preserves the accepted sidebar appearance while giving public entry points the same source of truth.

| New semantic role | Target |
| --- | --- |
| `--invitation` | `var(--butter-300)` |
| `--invitation-hover` | `color-mix(in oklab, var(--butter-300) 95%, var(--gray-900))` |
| `--invitation-active` | `color-mix(in oklab, var(--butter-300) 90%, var(--gray-900))` |
| `--on-invitation` | `var(--forest-800)` |

Add one opt-in `invitation` variant to the existing shared `Button`, used by auth and onboarding submit/continue controls. Do not change the default button to butter. This variant is justified by multiple product consumers, not solely by the landing. Landing's authored buttons may retain their current markup and layout while aliasing these semantics locally. Sidebar New chat keeps its current sidebar primitive and simply inherits the shared invitation roles.

### Borders, focus, and elevation

- Keep structural hairlines neutral, using existing `--hairline` / `--edge`; use them to divide dense content and bound white rows where needed. Do not color every border forest.
- A border that is the only visible boundary of an input/checkbox/control must achieve 3:1 against its adjacent background. Set `--edge-control` to `--gray-600` and `--edge-control-strong` to `--gray-700`; do not use `--forest-200` for an essential outline.
- Checked controls use forest with near-white check/dot; unchecked controls stay neutral. Invalid controls use danger boundary plus error text/icon.
- Focus is a 2px forest ring with a 2px offset matching the local surface. On solid forest elements, the offset must expose the surrounding light surface; within a solid selected sidebar row, use the existing inverse local focus role for the sibling action.
- Do not remove a structural border because focus is visible; resting controls must still be identifiable.
- Default and invitation buttons are flat fills. Remove decorative CTA drop shadows from their recipe; retain focus shadows/rings. No new lift-on-hover.
- White list rows/cards get a structural edge, no decorative drop shadow. Inset wells get fill, no rim. Menus/dialogs/sheets retain semantic elevation, without a decorative border plus a wide shadow on the same surface.
- Replace any residual Evergreen-based elevation color with Forest only where it is still used for a real branded elevation role. Delete unused CTA shadow roles after their consumers are removed; do not recolor dead tokens for completeness.

Keep `--workspace-border`, `--workspace-task-card-border`, and `--workspace-upcoming-task-card-border` on `--edge`; keep `--workspace-border-soft` on `--hairline` and upcoming-card hover edge on `--edge-strong`. These edges structure content and are not input outlines. Keep generic `--edge-panel` / `--edge-panel-strong` for panel structure. Move `--workspace-composer-border` to `--edge-control` because it bounds an editable control. Menus that use elevation remove their decorative border at the shared popup owner; retain `--workspace-dropdown-border` for any genuine internal structural divider, not as an invisible second outline.

The composer change deliberately replaces its current low-contrast `--edge-panel` rationale with a visible functional perimeter: one 1px gray-600 edge, no decorative drop shadow, unchanged radius/padding. Do not stack a second visible textarea border inside it or increase the resting edge width. Update the old rationale in `workspace.css` so the change cannot later be mistaken for an accidental token substitution.

## 5. Shared component state contract

Apply the same state precedence everywhere: invalid/destructive semantics remain visible; focus is additive; persistent selection survives hover/press; loading and disabled prevent activation without destroying labels or keyboard behavior.

| Component/state | Appearance and behavior |
| --- | --- |
| Default Button | Forest fill, near-white label/icon; hover forest-800; pressed `--brand-active`. |
| Invitation Button | Butter fill, forest label/icon; invitation hover/pressed; never white text on butter. |
| Secondary/outline/ghost | Neutral resting surface/text; neutral hover/press; forest only for meaningful active selection/link. |
| Destructive / destructive-outline | Existing danger semantics; confirm and delete remain distinguishable from ordinary cancellation. |
| Disabled | Neutral disabled surface and existing disabled ink. Do not achieve disabled by fading a saturated green/yellow slab. Keep non-color disabled cues and native semantics. |
| Loading | Keep the active variant's normal legible foreground/fill and existing spinner/layout. Preserve focusable `aria-disabled`, `data-loading`, and activation guard. Exclude loading from static-disabled recoloring. |
| Text input / textarea | White fill; neutral readable label/placeholder; essential control edge; forest focus; danger invalid state. Preserve autofill legibility. |
| Select / combobox | Same field trigger; white portal; neutral highlighted option; selected option soft forest plus existing checkmark. Preserve scroll arrows and placeholder distinction. |
| Checkbox / radio / switch | Neutral off state with visible boundary; forest on state with inverse mark; additive focus and danger invalid recipe. |
| Segmented tabs | Neutral track; selected tab white with forest label and existing structural state cue. Do not paint every selected tab solid forest. |
| Row/filter/local-nav selection | Forest-50 with forest text, selected-hover/pressed roles; existing checkmark, weight, or `aria-current` retained. No added dot or side stripe. |
| Dropdown/context/command menu | White surface; neutral unselected rows; highlighted row soft forest; danger text only on destructive action. Portal remains outside clipping ancestors. |
| Date picker | White grid; forest current selection and inverse label; range interior soft forest; Today is an outline/label state, not a warning. Disabled days remain distinguishable. |
| Tooltip | Forest-800 background, gray-10 text, arrow matches surface; preserve delay, portal, and focus behavior. |
| Dialog/sheet | White content, neutral scrim, neutral footer well if present; destructive action retains danger. Keep focus trap and focus return. |
| Toast / undo | White elevated surface, neutral body, semantic icon for actual status; Undo uses forest link treatment. No butter toast background. |
| Badge | Keep all seven existing variants: default/secondary use neutral label roles; destructive/error remain two aliases of danger; outline remains neutral; success and warning retain their status roles. Do not merge or remove variants used by parked screens/tests. |
| Skeleton | Existing neutral skeleton roles on their actual surface; no green pulse or butter shimmer. |
| Empty state | Neutral explanation and icon, forest action; no invented status or decorative brand-colored box. |
| Error state | Danger icon/heading or detail where necessary, readable neutral explanation and Retry control; remain visible outside collapsed work details. |

Interactions remain interruptible. Preserve existing duration/easing tokens; color/opacity feedback on frequent controls is instant or at most 150ms. Keyboard focus and keyboard navigation are immediate. Do not add entrance animation, stagger, bounce, icon morphs, or press scaling as part of this color migration. Keep reduced-motion behavior, coarse-pointer targets, and hover media-query gating intact. Do not use `transition: all`.

## 6. Status and data meaning

### Keep color meanings independent

| Meaning | Color decision | Additional cue |
| --- | --- | --- |
| Ordinary task/application/essay stage | Neutral | Written status label. |
| Flagged task | Forest brand ink, no yellow wash | Flag icon and accessible name. |
| Real warning / approaching external deadline | Existing Amber semantics | Label/icon and date, not color alone. |
| Failure / overdue / invalid / destructive | Existing Red semantics, respecting current feature behavior | Error text, date, icon, or destructive verb. |
| Actual success | Existing Leaf semantics | Check/icon and explicit success label. |
| Saving / running / streaming | Neutral progress treatment | Spinner, progress label, stop control, or timeline state. |
| Missing / unpublished / not available | Readable neutral muted ink | Preserve exact availability wording. Never disabled opacity. |
| AI provenance / Counselle touched this | Neutral identity/control treatment | Existing actor label/icon; no butter highlight. |

Do not change which condition constitutes overdue, warning, success, or completeness. The migration changes presentation, not product logic. Leaf and Forest are visually related, so meaning must be carried by the existing label/icon/structure. Never recolor Leaf to Forest just to shrink the palette.

Keep these exact status mappings: success surface/border/foreground/solid → Leaf 50/200/700/600; warning → Amber 50/200/800/600; danger → Red 50/200/700/600, solid hover Red-700, solid pressed Red-800, edge Red-700, edge hover Red-800. In `TaskRow.tsx`, overdue date/icon already uses danger foreground; due-soon date uses warning foreground; ordinary date uses secondary ink; the “due” label stays faint readable ink. `--task-flag-ink` remains an alias of brand.

### Essays

- Student prose and student headings keep neutral document ink and the existing document font.
- Insertion keeps `--success-fg` / Leaf; deletion keeps `--danger-fg` for its strike/decoration, while the student's deleted words retain document ink.
- Stale suggestions keep their neutral dotted cue, preview, and Outdated label.
- Accept and Reject remain symmetric neutral outline buttons through `ResolveButtons.tsx`. Accept is not a green/butter primary action; Reject is not a destructive red action.
- Pending-change counts/disclosure stay neutral. Expanded suggestion rows use existing insertion/deletion cues, not a butter queue background.
- Browser text selection in the document uses soft forest with neutral/forest readable text. Keep tracked-change decoration visible through it; if the soft fill conceals an underline, strengthen the decoration through its status role, not a new brand color.
- Preserve suggestion focus advancement, busy focus retention, word projection, autosave/resync, pending readout honesty, and editor/panel shared implementation.

### Charts and tables

- Preserve `--school-chart-mark: var(--ink)` and neutral chart tracks, axis labels, ticks, and values.
- The Reach/Target/Safety balance bar is the sole ordered Forest scale: dark/medium/light use `--brand-scale-3/2/1`. Preserve its existing category-to-step assignment, visible labels, counts, and separators. It is not a red/yellow/green risk gauge.
- `VizBlock` currently renders typed stat blocks and comparison tables, not a categorical chart suite. Do not invent series palettes or color individual universities.
- Links/citation buttons inside visualization cells inherit the same action/selection rules as other sources.
- Preserve non-brand identities (school logos, favicons) and neutral missing-value language. Keep vendor SVG selector literals such as `[stroke='#ccc']` when they match upstream attributes; they are selectors, not theme paints.

## 7. Surface-by-surface implementation map

### Shell and shared page titles

Paths in this section are relative to `frontend/src/`; sibling filenames inherit the preceding directory unless stated otherwise.

Files: `app/shell/WorkspaceShell.tsx`, `features/shell/AppSidebar.tsx`, `MainNav.tsx`, `features/ai-sidebar/ChatSessionList.tsx`, `ChatSessionRow.tsx`, `components/workspace/PageContainer.tsx`, `PageHeader.tsx`, `styles/shell.css`, `workspace.css`, and sidebar rules in `index.css`.

Keep the accepted sidebar pixels, butter New chat, solid active navigation, resize behavior, collapse, mobile sheet, account avatar/menu, and chat-row action focus. Alias its action tokens to invitation without changing their computed values. Add `--workspace-page-title: var(--heading-ink)` to `styles/workspace.css` and apply it to the default `h1` in `components/workspace/PageHeader.tsx` (currently around line 69). `PageContainer` only passes the title through. School detail supplies `SchoolCrumbs` instead of this header title; its visible school-name heading belongs to `SchoolIdentityBlock` and must explicitly consume the same title role. Map custom route title owners to this role rather than applying global heading CSS.

The custom title targets are fixed: `SchoolIdentityBlock` is the local function in `features/schools/SchoolDetailRoute.tsx` (h1 around line 269), not a separate file; also update the route-title elements in `features/essays/EssayEditorRoute.tsx`, `features/ai-composer/AiComposerRoute.tsx`, and `app/routes/RouteSurface.tsx`. Auth `AuthLayout.tsx`'s `CardTitle` consumes `--heading-ink` directly through a semantic utility: there is no auth family CSS and no need to create a one-role layer. Add `--onboarding-heading-ink: var(--heading-ink)` in `styles/onboarding.css` for the title elements in `components/ui/onboarding-setup.tsx` and `features/onboarding/OnboardingCompletion.tsx`; leave `--onboarding-foreground` neutral for body/labels. Landing headings use a dedicated landing heading alias. Do not color a whole title container when it also contains metadata or body copy.

Recovery/error headings are an explicit exception to identity page titles: keep neutral `--ink` for the session-check error h1 in `app/auth/RequireAuth.tsx`, malformed-progress recovery h1 in `app/auth/OnboardingGate.tsx`, and profile-load error h1 in `features/onboarding/OnboardingRoute.tsx`. Preserve their existing danger/status cues and Retry actions. They describe a failure, not the normal page identity; no Forest heading override or auth behavior change is required. The development tool gallery's normal page h1 in `features/dev-tool-call-gallery/ToolCallGalleryPage.tsx` consumes `--workspace-page-title`.

### Schools

Files in `features/schools/`: `SchoolsRoute.tsx`, `MyListPanel.tsx`, `SchoolsTable.tsx`, `SchoolMobileList.tsx`, `SchoolDetailRoute.tsx`, `SchoolFactsNav.tsx`, and `explore/{ExplorePanel,SchoolResultCard}.tsx`; plus `styles/schools.css`.

The Schools lane also owns `features/schools/{SchoolWorkspace,SchoolEssaysSection,school-workspace-fields,school-cells}.tsx`, `features/schools/facts/` (including `SchoolFactsPanel`, `FactTable`, and `SchoolFactsSection`), and `features/schools/facts/charts/` (including `FactDistributionChart`, `FactOrdinal`, `FactRangeChart`, `chart-shell`, and `chart-tokens`). Preserve the separate list/table `SchoolIdentity` in `school-cells.tsx` as neutral row content. Move inline `color-mix` in `SchoolWorkspace.tsx` into a semantic role with a school-family alias; its selected state uses the exact selection recipe, not a new mix.

Add school and real form-submit actions become forest; external school links stay secondary links. Active filter chips and local facts navigation use soft selection. School/application rows are white with a neutral structural edge. On-list badges use soft forest plus the existing label. Ordinary list/stage badges remain neutral. Preserve the facts missing-data and caveat vocabulary. Apply the labeled ordered fit scale centrally. Confirm desktop table and mobile list use the same roles.

### Tasks

Files in `features/tasks/`: `TasksLayout.tsx`, `TodayView.tsx`, `UpcomingView.tsx`, `AnytimeView.tsx`, `LogbookView.tsx`, `TaskRow.tsx`, `TaskRowMenu.tsx`, `TaskDetailPanel.tsx`, `SchedulerPopover.tsx`, and quick-add components; plus `styles/task.css`.

Rows remain neutral at rest; selected detail row soft forest; completion checkbox forest when checked. Flag ink and parser chips use brand/soft brand roles, not butter. Preserve current deadline/status conditions and the When versus Deadline distinction. Date selections follow the shared picker recipe. Detail fields stay white. Fix only semantically wrong generic aliases in the layout error/loading branches; preserve row menu, keyboard, drag/reorder, undo, and selection behavior.

### Activities and honors

Files in `features/activities/`: `ActivitiesRoute.tsx`, `ActivityRow.tsx`, `HonorRow.tsx`, `ActivityDrawer.tsx`, `HonorDrawer.tsx`, `SectionStatus.tsx`, `activity-indicators.tsx`; plus `styles/activity.css`.

Include `features/activities/activities-config.ts` and `activity-form-controls.tsx` in the same lane; they own shared presentation that individual rows inherit.

Neutral inset list trough, white rows, forest Add/Save, soft active/deep-linked row. Drawers use white fields and neutral grouping wells. Capacity and completeness are labeled data; only actual constraints/errors use status colors. Keep reorder grips, touch actions, optimistic state, and undo intact.

### Profile, documents, memory

Files in `features/profile/`: `ProfileRoute.tsx`, `ProfileSectionNav.tsx`, `ProfileSectionCard.tsx`, `ProfileScalarField.tsx`, `ProfileObjectListField.tsx`, `DocumentsSection.tsx`, `MemoriesSection.tsx`; plus `styles/profile.css`.

Include `features/profile/profile-control-styles.ts`; update its field/selected/error recipes once rather than patching every field caller.

Soft forest selected section/multi-select, white fields, neutral grouping wells. Saving is neutral; save failure is danger plus Retry; saved state retains its current explicit status. Upload and document actions forest, secondary actions neutral, destructive confirmations danger. Preserve draft lifetimes, autosave, section scroll reset, upload progress, and memory actions. Do not invent a Settings route.

### Chat and composers

Files: `features/ai-composer/{AiComposerRoute,AiComposer}.tsx` and `composer-control.ts`; `features/ai-chat/{AiChatRoute,AiChatPage}.tsx`; **the mounted `features/ai-chat/components/` subtree**, including `ChatMessages`, `ChatMessage`, `AgentRunView`, `ToolBeat`, `CitationRenderer`, `SourcesRail`, `MessageSources`, `VizBlock`, `ChatComposer`, `ToolWidgets`, `Clarify*`, and `mutation-receipts/`; `components/ai-elements/{message,inline-citation}.tsx`; `styles/workspace.css` and related chat/markdown rules in `index.css`.

Assistant answers remain unboxed on white. User questions use a neutral inset bubble, not a green/butter bubble. Composer is white with an identifiable neutral boundary and forest focus/send. Stop retains its stop-square and accessible state, with neutral treatment unless an actual error occurs. Mode/source/skill chips use soft forest only when selected. Thinking/tool progress is neutral; tool errors remain visible and semantic. Citations use forest link/soft-chip roles and existing keyboard buttons; source rows are neutral with transient soft-forest target highlight. Keep provenance, unavailable-value, cancellation, and stream-order behavior.

`features/ai-composer/composer-control.ts` exports `composerSendButtonClass`, which affects both Send and Stop. Do not force Forest classes onto the shared helper indiscriminately: Send is default/Forest; Stop retains its current `secondary` variant and neutral fill. An error belongs to the error readout, not to recoloring Stop as destructive.

### Essay library, editor, and AI panel

Files in `features/essays/`: `EssaysRoute.tsx`, `EssayLibraryCard.tsx`, `EssayEditorRoute.tsx`, `EssayEditorHeader.tsx`, `EssayDocumentSurface.tsx`, `EssayDocumentPanel.tsx`, `EssayChatPanel.tsx`, `PendingChangesReadout.tsx`; and the nested `features/essays/suggestions/{SuggestionsBar,ResolveButtons,SuggestionPopover}.tsx`. Token declarations live in `styles/essay.css`; the tracked-change selectors live in `styles/essay-suggestions.css`, imported by `index.css`.

Library cards are white structural surfaces; progress uses forest; metadata/stages stay neutral. Document remains white, neutral prose. Editor toolbar selected controls soft forest. Dock frame uses existing neutral inset role and its transcript/document stays white; do not reuse the sidebar fill for every panel. Apply the suggestion contract in §6 exactly. Essay chat inherits the shared chat recipe; no second chat color system.

### Auth, onboarding, and active admin

Files: `features/auth/{LoginRoute,RegisterRoute,AuthLayout,AuthField}.tsx`; `features/onboarding/{OnboardingRoute,OnboardingStepForm,OnboardingCompletion,OnboardingAside,OnboardingChoiceGroup,OnboardingTagInput}.tsx`, `onboarding-steps.ts`, and `steps/{BasicsStep,AcademicStep,DirectionStep,ContextStep,FitStep}.tsx`; `components/ui/onboarding-setup.tsx`; `features/admin-facts/{AdminFactsPage,StatTiles,TabHealthTable,RecentPassesTable,CoverageGapsSection,UnmappedLabelsSection,RunPassButton}.tsx` and its `crawl-status` module. The auth gates under `app/auth/` are verification targets, not behavior-change targets.

Login/Register: white surface, forest heading, neutral fields, butter form submit, forest text links. OAuth/provider marks retain their original brand assets; provider buttons are neutral. Errors use danger. Loading keeps focus and legibility.

Onboarding: white workspace, existing shell composition, forest heading/progress, soft selected choice, butter Continue/Finish, neutral Back/Skip. Retry is an operational action and stays Forest, even on an onboarding screen. Public onboarding SVGs are owned artwork and are included: recolor purple decorative areas through the exact Forest source-asset mapping in §9; do not apply a global CSS filter. Preserve their geometry and accessibility. Neutral backgrounds stay neutral; illustrations do not need an additional butter accent beside Continue.

Facts admin: mounted `/app/admin/facts` only. White tables/panels, forest operational actions, neutral filters and ordinary lifecycle labels; semantic status for actual warnings, errors, and successes. No butter operational controls. Preserve gates, permissions, refresh/crawl behavior, timestamps, and raw facts. Parked CDS redirects remain redirects.

### Public landing

Files: `features/landing/LandingPage.tsx`, `PlanDemo.tsx`, `landing.css`, owned Counselle logo asset, and active HTML entry metadata.

Keep the current composition, content, responsive behavior, and demo interactions. Replace the orange/wine identity fully. Base surface is white; headings/wordmark forest-800; body neutral; primary invitation butter/forest; secondary and sign-in links forest; neutral demo frames; soft-forest selected example tab and saved-plan selection. Demo tasks/rows use the same semantic meanings as the actual app, including neutral running state and status-only success/error. Remove the landing's automatic dark palette override. Preserve reduced-motion behavior. Do not introduce a new dark forest hero, additional cards, gradients, or new imagery.

The landing's current variables are overloaded, so use this explicit migration rather than a search/replace of old hues:

| Landing role | Target / consumer change |
| --- | --- |
| `--landing-canvas` | `var(--canvas)` |
| `--landing-ink` | `var(--ink)` for body; move heading and focus consumers to the dedicated roles below |
| New `--landing-heading-ink` | `var(--heading-ink)` for public headings/wordmark only |
| `--landing-muted`, `--landing-surface-muted` | `var(--ink-secondary)` for actual supporting text |
| `--landing-surface` / `--landing-surface-ink` | `var(--surface-raised)` / `var(--ink)` |
| `--landing-tint` | `var(--surface-selected)` |
| `--landing-edge`, `--landing-faint` | `var(--edge)`; remove local border-color mixes and reference the role directly |
| `--landing-accent` | `var(--brand)` for checked-task fill and actual app-style actions; focus consumers move to `--focus-ring` |
| `--landing-on-dark` | `var(--on-brand)` only for solid forest/checkmark consumers; invitation label uses `--on-invitation` explicitly |
| `--landing-dark` | Retire after moving the conversation slip to new `--landing-conversation-surface: var(--surface-inset)` and `--landing-conversation-ink: var(--ink)`; do not inherit inverse text on the now-light slip |
| `--landing-shadow` | Alias new semantic `--illustration-shadow-color: color-mix(in oklab, var(--gray-1000) 12%, transparent)`; this is a shadow **color**, not a whole shadow declaration |

Move old `--landing-ink` button-fill consumers to invitation or brand according to §1; move its control-border consumers to `--edge-control` where essential and `--edge` where decorative. `.landing-signin` is a text/outline link, never a butter-filled action. A selected `.example-tab` uses soft selection, not a dark filled button. Keep existing shadow offsets/radii on the illustration-only composition unless a border-plus-shadow combination conflicts with §4, in which case remove the decorative outer border.

Calendar: shared title/canvas only. Keep the current placeholder honest.

## 8. Before / after review decisions

| Before | After | Why |
| --- | --- | --- |
| Evergreen workspace action beside Forest sidebar selection | One Forest action/selection vocabulary | Adjacent controls should feel like one product. |
| Orange/wine public landing and dark preference override | White/Forest/Butter public surface using shared semantics | The brand survives the transition from public page to signed-in app. |
| Butter available only as chrome-specific meaning | Shared invitation roles with explicit eligible consumers | Reuse the accepted accent without making every button yellow. |
| Selected states vulnerable to generic hover aliases | Persistent soft selection with dedicated hover/pressed roles | Selection remains legible during interaction. |
| Generic control edges used without role/contrast distinction | Essential control boundary separated from decorative hairline | Subtle structure must not make fields disappear. |
| Branded CTA shadows and varying local color rules | Flat shared action recipes; semantic overlay elevation | Consistent emphasis and cleaner density. |
| Potential migration of all greens/yellows by hue | Separate brand, status, essay-change, and quantity contracts | Similar hues do not mean interchangeable semantics. |
| Documentation describes both old and current directions | One current Forest/Butter contract with historical direction labeled | Future agents should not restart the palette debate. |

## 9. Implementation sequence and ownership

Do these phases in order. Parallel feature work may begin only after foundation and shared-state contracts are settled. Every worker must preserve others' edits and work only in its assigned files. No phase requires a new backend endpoint, library, or theme runtime.

### Phase 0 — baseline and evidence

1. Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `styles/README.md`, `docs/BRAND_DIRECTION.md`, and this plan. Confirm actual current imports/routes because the working tree contains ongoing uncommitted changes.
2. Record `git status --short`, current branch/HEAD, and the implementation diff baseline. Preserve current router, landing, Vite, essay, token, and sidebar edits; never reset the working tree to HEAD.
3. Capture full-screen baseline screenshots at 1440×900 and 390×844: Schools with sidebar, task list, chat turn/composer, essay editor/panel, profile form, landing, and an open menu/dialog. Include one longer populated screen; do not validate only empty states.
4. Record computed canvas/sidebar values. The sidebar baseline is immutable for this migration. White canvas must remain `rgb(255,255,255)`.
5. Run the relevant existing frontend tests to identify baseline failures. Record known task-detail flakes by test name; do not silently call them new regressions or fixed.

Use one evidence root, `artifacts/forest-butter/<UTC-run-timestamp>/`, with `baseline/`, `after/`, `contrast.json`, and `verification.md`. Name screenshots `<route>-<state>-<width>x<height>.png`. The verification record lists each required journey, whether it used real or fixture data, result, screenshot path, and any unverified condition.

### Phase 1 — foundation owner

Owned files: `primitives.css`, `semantic.css`, `elevation.css`, `shadcn.css`, `theme.css`.

This phase owns definitions/adapters only. Phase 2 owns `shell.css` and shared `workspace.css`; Phase 3 owns `schools.css`, `task.css`, `activity.css`, `profile.css`, `essay.css`, and `essay-suggestions.css`; Phase 4 owns `onboarding.css` and landing-local aliases. Do not let multiple workers edit the same family sheet concurrently.

1. Apply §4 mappings explicitly, including the `--illustration-shadow-color` semantic specified in the landing table. Add only the named missing semantic roles; keep raw colors in primitives.
2. Set raised/overlay white and inset gray-100. Keep body/status colors independent from brand changes.
3. Bridge `--primary`/foreground and focus to the new Forest roles. Add Tailwind adapters for invitation/heading/link only if needed by their consumers.
4. Add selected-hover/pressed roles and update no feature file until aliases are ready.
5. Compute declared contrast for every changed text/control pair and every composited state. Check all CSS variables resolve and no cycles exist.
6. Do not delete Evergreen primitives yet: consumers in landing/elevation/families may still be in flight.

### Phase 2 — shared components and shell owner

Owned files: shared `components/ui/*` actually affected (explicitly including `button.tsx`, `sidebar.tsx`, fields, menus, and portals), shared page header/scaffold, `shell.css`, relevant shared `workspace.css` roles, sidebar family components and shared/sidebar/markdown rules in `index.css`.

1. Implement the opt-in `Button` invitation variant; default remains Forest. Preserve loading and ref/focus contracts.
2. Apply the complete state recipes in §5 to the shared primitives, not to isolated screenshots.
3. Make page-title and link roles available through actual shared owners. Do not recolor student content or neutral data headings.
4. Alias sidebar CTA to invitation. Verify its computed resting, hover, press, active-row, and background values are unchanged.
5. Centralize essential control edge and focus offset rules. Inspect portal surfaces against both white content and sidebar context.
6. Remove unused decorative CTA elevation consumers and preserve functional focus rings.

### Phase 3 — product feature owners

Parallel lanes: (A) Schools + `schools.css`; (B) Tasks + `task.css`; (C) Activities/Profile + their family CSS; (D) Chat/Essay + their CSS. Shared-file changes go through the phase-2 owner, not competing edits.

For each lane: trace family aliases first; apply §7; inspect every direct `--brand` use for meaning; fix semantically wrong generic utilities; verify selection/hover/pressed/focus/disabled/loading/error/empty combinations. Keep behavior unchanged. Report actual file paths touched and the relevant browser evidence before handing the lane back.

### Phase 4 — public, onboarding, and admin owner

1. Read the active landing selectors before remapping them. Replace local palette literals with landing-family aliases to shared semantics; all mixes belong in semantic roles. Do not duplicate the approved hex values in `landing.css`.
2. Map `.landing-primary` to invitation; `.landing-secondary`, `.landing-signin`, `.landing-nav-example`, `.save-example`, `.replay-button`, and `.expand-example` to their action/secondary roles; `.example-tab` uses soft selection when active. Ensure a local override does not restore orange on hover/active/dark preference.
3. Update the external owned logo `frontend/src/features/landing/assets/counselle.svg`: replace its `#291e19` fill with `#204122`. Preserve its current image loading and geometry; document this source-asset exception. CSS variables do not cross an external-image boundary.
4. Recolor the exact source assets `frontend/public/onboarding/{basics,academic,direction,context,fit}.svg`, loaded by `features/onboarding/onboarding-steps.ts` and `OnboardingAside.tsx`. Replace `#a674ad` → `#c6d3c4`, `#875090` → `#275028`, `#6f3a78` → `#204122`, and `#989898` → `#525252`; retain `#525252`, `#dbdbdb`, `#f0f0f0`, `#ffffff`, `#fcfcfc`, and `#f5f5f5`. Preserve geometry, existing gradient structure, and accessibility; no new gradients or artwork. These static source-asset colors are a documented exception to CSS primitive ownership, with exactly that resulting-value allowlist. Do not inline five illustrations or introduce an SVG loading library solely to access CSS variables.
5. Set `theme-color` to `#FFFFFF` in both `frontend/index.html` and `frontend/landing.html` (add the meta element to the existing head if absent). HTML metadata needs a literal: list it as a deliberate entry-document exception. Preserve the current entry wiring; do not restore deleted `frontend/public/landing.html`.
6. Delete the entire `@media (prefers-color-scheme: dark)` palette block in `features/landing/landing.css`; preserve other reduced-motion/responsive media rules. Auth/onboarding/admin inherit shared primitives and receive only needed family-role changes.
7. Validate `features/dev-onboarding-shell-gallery/OnboardingShellGalleryPage.tsx` with the updated source assets, and `features/dev-tool-call-gallery/ToolCallGalleryPage.tsx` with shared tool widgets. Move the latter's inline visual `color-mix` into the appropriate semantic/family role; neutral work states use existing neutral surfaces, selected states use §4. Do not create gallery-only alternative colors.

### Phase 5 — cleanup and documentation owner

1. Run a scoped reference scan over production source for `evergreen`, `citron`, the landing orange/wine roles, and raw paint literals. Inspect results, not just counts.
2. Remove unused old primitives and shadow roles once zero production consumers remain. Do not keep a deprecated second brand ramp indefinitely.
3. Retain legitimate masks, vendor selectors, source assets, external identities, and excluded experiment files. Remove stale documentation exceptions, such as an AppSidebar mask exception if the code no longer contains it.
4. Update `docs/BRAND_DIRECTION.md`, `DESIGN.md`, and `styles/README.md` to the completed current system. Replace conflicting current Evergreen/Citron guidance; preserve historical experimentation only in explicitly historical sections/assets. Record surface/role/state/asset rules once and cross-reference them.
5. Update this plan's execution checklist/evidence links without claiming owner acceptance or moving it into shipped specs prematurely.

## 10. Validation and release gate

### Automated verification

From `frontend/`, run these verified existing package scripts:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

The scripts currently resolve to `tsc -b --noEmit`, `vitest run`, `eslint .`, and `tsc -b && vite build`, respectively. Run `git diff --check` from the repository root. Do not run the whole-project write-mode formatter on this dirty tree; format only files changed by the implementation.

Relevant existing coverage includes shell/navigation, chat/sidebar, schools, tasks, activities/profile, chat protocol and citations, essay suggestions/projection, and shared controls. Run targeted suites after the responsible phase, then the complete frontend suite once the implementation is integrated. Do not repeatedly run broad checks without a new change or failure.

Add tests only for meaningful new behavior/contracts introduced by the implementation, such as invitation variant loading retaining focus and selected hover retaining a state cue if the relevant component logic changes. Pure color substitutions need rendered verification, not tests that merely duplicate CSS literals. Do not modify existing test expectations to hide an interaction regression.

### Color verification

Record **computed foreground and actual composited background**, not only token declarations. Use WCAG contrast calculation from rendered colors.

These planning calculations use the declared approved colors and correct OKLab-to-linear-sRGB conversion. For OKLCH neutrals, relative luminance is `L³`; do not gamma-decode linear channels a second time. The sidebar mix is approximately `#F1F2F1` when rounded to 8-bit sRGB; its authoritative value remains the CSS mixture, not that rounded hex.

| Foreground / background | Calculated ratio | Decision |
| --- | ---: | --- |
| Forest-800 / white | 11.41:1 | Page titles and strong forest ink. |
| Forest-600 / accepted sidebar | 7.76:1 | Sidebar secondary text stays readable. |
| Gray-10 / Forest-700 | 9.04:1 | Primary action / selected-sidebar label. |
| Gray-10 / Forest-800 | 11.12:1 | Primary hover / tooltip label. |
| Gray-10 / defined primary pressed mix | 11.82:1 | Primary pressed label. |
| Forest-800 / Butter | 9.35:1 | Invitation label. |
| Forest-800 / invitation hover mix | 8.34:1 | Invitation hover label. |
| Forest-800 / invitation pressed mix | 7.41:1 | Invitation pressed label. |
| Forest-800 / Forest-50 | 10.25:1 | Soft selected label. |
| Gray-700 / white; sidebar | 8.11:1; 7.24:1 | Readable secondary information. |
| Gray-900 / white; sidebar | 18.47:1; 16.48:1 | Neutral body/data ink. |
| Gray-600 / white; sidebar | 3.64:1; 3.25:1 | Essential boundary, not ordinary text. |
| Gray-500 / white | 2.15:1 | Decorative structure only. |
| Gray-650 / white; sidebar | 2.67:1; 2.38:1 | Disabled-only; never placeholder or metadata. |
| Leaf-700 / Leaf-50 | 7.12:1 | Existing success foreground/surface. |
| Amber-800 / Amber-50 | 11.42:1 | Existing warning foreground/surface. |
| Red-700 / Red-50 | 8.84:1 | Valid danger foreground/surface pair. |
| Amber-600 / Amber-50 | 4.41:1 | Fails normal text; do not use as warning text. |

These are declared-palette calculations, not a claim that every current rendered state passes. Browser verification remains mandatory, particularly alpha-composited disabled/loading controls and status decorations.

- Normal text, metadata that conveys information, and placeholder text: at least 4.5:1.
- Large text: at least 3:1; prefer 4.5:1 where practical with the approved palette.
- Essential icons, control boundaries, checks, and visible focus: at least 3:1 against adjacent colors.
- Decorative separators and purely disabled controls are not treated as ordinary text, but disabled state must remain recognizable. Zero counts, missing values, and loading labels are not disabled content.
- Measure each default/hover/pressed/selected/selected-hover/invalid/loading pair and focus on white, inset, sidebar, soft selection, solid forest, and butter.
- A pale selection fill is supplemented by the existing persistent non-color state cue. Do not claim the pale fill alone gives 3:1.
- If a supporting pair fails, change its semantic role's lightness or boundary, preserve the approved five anchor colors, and remeasure. Do not introduce a new hue or adjust an accepted anchor casually.

### Real-browser routes and states

| Surface | Required journey |
| --- | --- |
| Shell | All nav items, Tasks descendant active state, sidebar search, active chat hover action, account menu, collapse, resize, mobile sheet, keyboard focus. |
| Schools | Empty/populated My list; Explore search/filter/no results; Add school; sorting/list type; mobile list; school facts, missing data, caveats, charts; Your application; unknown school and legacy redirect. |
| Tasks | Today/Upcoming/Anytime/Logbook; empty and populated; quick-add parsing; complete and undo; flag; When/Deadline scheduling; row menu/right-click; keyboard and drag reorder; selected detail; query/mutation failure. |
| Activities/Honors | Add/edit drawer, selected deep link, reorder, delete and undo, empty/limit states, per-section error/retry, coarse-pointer controls. |
| Profile | Section selection; text/select/multi-select; Saving/Saved/failure/retry; Documents loading/upload/error; Memory empty/list/action/confirmation; guided setup entry. |
| Chat | Empty composer, mode/source/skill controls, disabled/send/loading/stop, long answer, user bubble, running/settled/error tools, clarify/cancel, citations→rail, mutation receipt→essay panel, copy/feedback/regenerate. |
| Essays | Library and editor; selected toolbar; long prose; pending queue collapsed/expanded; insert/delete/stale; popover; Accept/Reject busy/focus advance; projected count; save/resync; AI panel empty/loading/retry/stream; docking and mobile. |
| Public/auth/onboarding | Landing hero/demo/tabs/save/replay; login/register focus/invalid/loading/provider button; onboarding every step, selected choice/progress/back/continue, all owned artwork. |
| Facts admin | Authorized entry, normal/loading/empty/error states, filters/table/operational controls; keep authorization intact. |
| Calendar | Honest placeholder with shared white canvas and forest page title; no invented calendar UI. |
| Development galleries | `/dev/tool-calls`: running/settled/error and receipt fixtures; `/dev/onboarding-shell`: every step/image and shell state. Use a dev build; these routes are intentionally absent from production. |
| Portals | Open dropdown/select/context menu/command/date picker/tooltip/dialog/sheet/toast; focus trap and return, clipping, selected/destructive rows. |

Test at 1440×900, 1024×768, 768px width, and 390×844; include a narrow 320px check for overflow on the changed public/auth controls. Check keyboard-only, coarse pointer, 200% zoom, reduced motion, and emulated dark OS preference (the app still renders the selected light palette). Use real browser screenshots and computed styles; jsdom is insufficient for color acceptance.

Use existing `/dev/tool-calls` and its fixtures for hard-to-reach tool states. Protocol fixtures in `tests/fixtures/protocol/` provide streamed, cancelled, clarify, and replay cases. Use authorized existing data or clearly labeled deterministic browser fixtures. Never claim fixture-driven checks verified the live backend. Do not trigger a crawl or destructive real-data operation to take a screenshot.

### Definition of complete

- [ ] White canvas and accepted sidebar background remain exactly preserved in the browser.
- [ ] All mounted routes use Forest/Butter identity; no orange/wine/Evergreen/Citron production styling survives outside explicit exceptions.
- [ ] Butter occurs only at the documented invitation entry points.
- [ ] Body/prose/data remain readable neutral; page-title/action/link roles are consistent.
- [ ] Every changed interactive component has the full state matrix, including selection plus hover/focus and loading plus disabled semantics.
- [ ] Status, essay edits, data availability, provenance, and ordered quantities retain their meanings.
- [ ] All required rendered text/control/focus pairs pass measured contrast.
- [ ] Desktop/mobile and portal screenshots show a coherent surface hierarchy without accidental green panels or missing boundaries.
- [ ] Shared component behavior, keyboard interaction, autosave/streaming/undo, and responsive layout pass existing tests and browser journeys.
- [ ] Typecheck/lint/build pass; test failures are resolved or demonstrated with baseline evidence as pre-existing, and any unresolved blocker is stated.
- [ ] Current docs agree, obsolete production palette roles are removed, and legitimate asset/mask/vendor exceptions are explicit.
- [ ] Reviewers independently inspect the integrated diff and browser evidence; serious findings are fixed before the work is presented as finished.

The implementation report must name changed areas, the exact checks performed, screenshots/evidence paths, and remaining limitations. Do not claim the app is “perfect” from a token swap or a single screenshot; the standard is the verified system above.
