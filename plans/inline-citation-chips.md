# Inline citation chips + sources sidebar redesign

**Status:** proposed scratch plan
**Scope:** `frontend/src/components/ai-elements/inline-citation.tsx`, `frontend/src/features/ai-chat/citations.ts`, `frontend/src/features/ai-chat/components/CitationRenderer.tsx`, `frontend/src/features/ai-chat/components/ChatMessage.tsx`, `frontend/src/features/ai-chat/components/SourcesRail.tsx`, and their tests. No backend changes — `domain/envelope.py`'s `Citation`/`CitationEnvelope` contracts (v2) are read-only inputs here.
**Intent:** one visual citation-chip component, used everywhere a `[n]` marker resolves, that (a) carries real source metadata (favicon for web/edu/reddit, real school favicon + CDS year for cds/profile), (b) never leaks the backend's raw, gappy registry index to the user, and (c) opens a sidebar that looks like a finished product surface, not a debug list.

## Problem statement

Today (`CitationRenderer.tsx:53-114`) there are **two different chip implementations** behind one `[n]` marker:

- CDS/profile markers render a bare `<Button variant="secondary">[{entry.index}]</Button>` — a number, no icon, no metadata preview.
- web/edu/reddit markers render an `InlineCitation`/`HoverCard` badge showing only the **hostname** (`InlineCitationCardTrigger`, `inline-citation.tsx:80-101`), via a `sources: string[]` prop that was designed for a multi-source-per-marker case this app never uses (each `[n]` always resolves to exactly one `ReplaySourceEntry` via `uniqueSourceByIndex`).

Both paths print `entry.index` — the source's position in the **whole-registry** array (`message.sources`, cumulative across every tool call the turn made) — not its position among the sources actually *cited*. A message that cites 9 distinct sources can legitimately show `[3]`, `[14]`, `[30]` inline, and the sidebar header ("N sources") is correct while the visible numbers inside the bracket badges are not sequential and not capped at N. This is the literal bug: *"i don't want it to have for example 9 sources used and number some sources 30."*

The sidebar (`SourcesRail.tsx:52-97`) inherits the same raw-index leak (`[{entry.index}] {entry.label}`, line 70) and is visually a flat bordered-card list with no icon, no real hierarchy beyond a tier `Badge`.

## Non-goals

- `VizBlock.tsx`'s per-cell `CellValue` (`VizBlock.tsx:23-66`) — the Official/Community pill inside stat blocks/comparison tables — stays as-is. It is a table-cell affordance answering "is this cell backed by an official or community source," not an inline citation marker, and redesigning it is a separate table-UX decision. `VizBlock`'s existing `SchoolHeading` favicon pattern (`VizBlock.tsx:77-95`) is reused, not replaced.
- Narration segments (`NarrationBeat` in `AgentRunView.tsx:77-94`) keep resolving citations exactly as today (against the full `message.sources` registry). Only their **display numbering** is out of scope for the strict "≤ N, sequential" guarantee — narration is ephemeral agent chatter, not the answer's receipts, and forcing it through the same sequential-across-the-whole-message map risks silently hiding a legitimately-cited narration source whose index falls outside the answer's own used-set. Only the **answer** segment and the **sidebar** get the sequential renumbering.
- No change to `domain/envelope.py`, the SSE protocol, or `SourceEntry`/`Citation` shapes. This is a pure rendering-layer fix.
- Legacy replay entries (`LegacySourceEntry`, `types.ts:131-144`, stored-transcript compatibility only) get the same chip shell for consistency but keep a generic globe icon — there is no typed `Citation.source` union to key off for a v1 blob.

## Current-state findings (exact)

- `Citation` (`domain/envelope.py:41-58`, mirrored in `frontend/src/api/chat/types.ts:30-47`): **corrected per technical review** — `validate_identity` (`envelope.py:60-115`) does not actually forbid a `url` on `cds`/`profile` citations; `url` is referenced nowhere in that validator except the external-source branch (line 95), and `db_fields` (lines 62-70) never includes `url`. The true guarantee is empirical, not contractual: the two known construction sites (`app/tool_middleware.py:55-65` for `cds`, `:92-98` for `profile`) simply never pass `url`. `cds` citations carry `school_unitid` + `academic_year` (both required, line 77); `profile` citations carry `school_unitid` but **forbid** `academic_year` (part of `db_fields[:5]`, checked at line 91). `web`/`edu`/`reddit` always require `url` and forbid all seven DB-identity fields (lines 95-98). Practical consequence for this plan: the chip/sidebar code must not assume `cds`/`profile.url` is `undefined` at the type level — it should simply prefer the domain-map favicon (Design decision 3) and academic-year/profile metadata for those source kinds regardless of whether `url` happens to be set, rather than branching on "cds citations never have a url."
- There is **no domain on `Citation`** for `cds`/`profile`, so a school favicon can't be built from the citation alone. `SchoolRef` (`types.ts:74-78`) and `TabularRenderSpec.columns: SchoolRef[]` (`types.ts:82-88`) — the viz spec already attached to the same message when a CDS fact is rendered in a stat block/comparison table — **does** carry `{unitid, domain}` and is exactly what `VizBlock.tsx:84-89` already uses to fetch `https://www.google.com/s2/favicons?domain=...&sz=32`. A second, slightly inconsistent favicon call site exists at `school-cells.tsx:39-49` (`sz=64`, hostname-from-URL instead of raw domain) — not this plan's concern to unify, but the new chip/sidebar code should standardize on the `VizBlock.tsx` `sz=32` raw-domain form since that's the pattern actually being reused.
- `AssistantChatMessage.blocks: ContentBlock[]` (`model.ts:49-51`) is "the final citeable answer's content only... never the render order" — i.e. it does **not** include narration segments. `citedIndexesForMessage`/`sourcesUsedByMessage` (`citations.ts:47-58`, `93-111`) are already scoped to `blocks`/`text`, which is why the sidebar's "N sources" count is already correct today — only the visible **number inside each chip** is wrong, not the sidebar count. **Confirmed by review:** narration text is invisible to both functions (narration lives in `message.segments`, never folded into `blocks`), and `NarrationBeat` (`AgentRunView.tsx:77-95`) renders `CitationRenderer` against the full, unfiltered `message.sources` registry. This means a narration `[n]` marker really can reference a raw index outside the answer's used-set — see Risk 4.
- `sourcesUsedByMessage` already dedupes to entries whose `index` is unique in the registry and is cited exactly once as a Set member (`citations.ts:104-111`) — this is the exact "used" set to renumber sequentially; no new filtering logic is needed, only a numbering pass on top of its existing output. Confirmed both `SourceEntry` and `LegacySourceEntry` declare `index: number` at the same structural position, so `ReplaySourceEntry.index` resolves cleanly across the union for sort/map purposes.
- `MessageSourcesPayload` (`types.ts:149-152`) is constructed in exactly one place, `sourcesPayloadFor` (`citations.ts:113-119`), consumed by `MessageSources.tsx` and `ChatMessages.tsx`'s `onOpenCitation` handler (`ChatMessages.tsx:87-96`) — confirmed via a full-tree grep to be the only production construction site (test fixtures aside) — one seam to extend, not several.
- `Badge` (`components/ui/badge.tsx`) is a Base UI `useRender` polymorphic component (`badgeVariants` + `render` prop) — it can render as a real `<button>` while keeping badge styling, which the current trigger does not do (it's a bare `span` today for the external-source path, only the CDS/profile path used a real `Button`). **Confirmed safe by review, not just a hoped-for pattern:** `HoverCardTrigger asChild` (Radix `Slot`) already composes a ref into `Badge`'s default `span` render in production today (`inline-citation.tsx:85-100`); tracing `useRenderElement.js`'s `evaluateRenderProp` shows it explicitly re-attaches `props.ref` onto the cloned element regardless of which host tag `render` specifies, and `Slot` does the matching `mergedProps.ref = composedRef` before cloning. Swapping the trigger's rendered tag from `span` to `<button type="button" />` via `render` does not change this mechanism — it is not an open risk to "check during Phase 2," it is verified.

## Registry and primitive policy

Per `AGENTS.md` §"Frontend components — search registries first": shadcn MCP → COSS → `@ai-elements` → `magic` (optional) → custom, in that order.

1. The shadcn MCP tool was not available in this session (`ToolSearch` for shadcn registry tools returned nothing usable — only `mcp__magic__*`, `DesignSync`, and browser tools). `frontend/components.json` has `@ai-elements`, `@coss`, `@kokonutui` configured; **before writing new component code**, run (from `frontend/`) `npx shadcn@latest view @coss/<candidate>` / `@kokonutui/<candidate>` for a footnote/citation/tooltip-badge primitive, using search terms "citation", "footnote", "source", "reference badge". Record the result (fit / no-fit) in the plan before proceeding — do not skip this step even though a prior pass (this conversation) did not have live registry access.
2. `inline-citation.tsx` **is already the vendored `@ai-elements` citation primitive** (`InlineCitation*` family, header comment absent but shape matches the [AI Elements inline-citation](https://elements.ai-sdk.dev) block). Per rule 3 ("check `@ai-elements`... for anything chat/agent/AI-shaped"), this is the correct base to *edit in place*, not replace — AGENTS.md's house rule "change existing code by extension, with the smallest diff" applies directly: extend `InlineCitationCardTrigger`'s props rather than adding a second parallel chip component.
3. If `magic` (21st.dev) is available and step 1 finds no COSS/kokonutui fit, run `mcp__magic__21st_magic_component_inspiration` with query "citation chip" / "footnote badge" as a design reference only — not to import a component wholesale, since the chip must compose with the existing `HoverCard`-based `InlineCitationCard` machinery already wired through `CitationRenderer.tsx`.
4. Sidebar: `Sheet`/`SheetContent` (mobile) and the bespoke `<aside>` (desktop) in `SourcesRail.tsx` stay — no registry component models "a filterable receipts drawer keyed to inline markers" closely enough to swap in wholesale; this is exactly the case AGENTS.md rule 5 describes ("Counselle's differentiating honesty surfaces... built new on the MVP3 design system"). The redesign is a visual/hierarchy pass on the existing structure, using existing tokens (`bg-card`, `bg-muted`, `text-muted-foreground`, `ring-ring`, etc. — already in use, no new hardcoded colors per the design-token house rule) plus the new favicon/school-icon and `Badge`-as-button pattern from the chip.

## Design decisions

1. **One chip component, one trigger shape.** `InlineCitationCardTrigger` becomes `{ index: number; icon?: ReactNode }` (dropping the unused `sources: string[]` / `getCitationSourceLabel` hostname-guessing path entirely — dead code once the redesign lands, since the hostname now lives in the hover-card body, not the trigger). Renders via `Badge`'s `render={<button type="button" />}` so every chip — CDS, profile, web, edu, reddit, legacy — is a real, keyboard-operable button with `aria-label={"Open source " + index}`, not a mix of `<Button>` and bare `<span>`.
2. **Sequential display numbers, in first-appearance order, capped at N.** **Revised per technical review** — the original draft sorted by raw registry `index` ascending, which fixes the *magnitude* problem (no number `> N`) but not *order*: since registry index reflects backend tool-call order, not prose order, a message reading "...per community reports [14], the official CDS figure [3] confirms..." would have shown the visually-first chip as `[2]` and the visually-second as `[1]` — a real footnote-reading-order regression. Fixed by ordering on first appearance in the document instead:
   ```ts
   // citedIndexesIn / sourceIndexesForViz already return Sets in encounter
   // order (JS Set preserves insertion order), so walking blocks in order
   // and merging those sets gives a true first-appearance order for free —
   // no new marker-scanning logic, just a fold over the existing per-block scans.
   export function citedIndexOrderForMessage(message: {
     blocks?: AssistantChatMessage["blocks"];
     text?: string;
   }): number[] {
     const seen = new Set<number>();
     const order: number[] = [];
     const pushAll = (indexes: Iterable<number>) => {
       for (const index of indexes) {
         if (!seen.has(index)) { seen.add(index); order.push(index); }
       }
     };
     const blocks = message.blocks ?? [];
     if (blocks.length > 0) {
       for (const block of blocks) {
         if (block.kind === "markdown") pushAll(citedIndexesIn(block.text));
         else if (block.kind === "viz") pushAll(sourceIndexesForViz(block.spec));
       }
     } else if (message.text !== undefined) {
       pushAll(citedIndexesIn(message.text));
     }
     return order;
   }

   export function citationDisplayNumbers(
     orderedIndexes: ReadonlyArray<number>,
   ): Map<number, number> {
     return new Map(orderedIndexes.map((index, i) => [index, i + 1]));
   }
   ```
   In `AssistantBody`, compute `usedSources = sourcesUsedByMessage(message)` (unchanged, existing dedup/filter) and `order = citedIndexOrderForMessage(message).filter((i) => usedSources.some((e) => e.index === i))` (guards against a first-seen index later dropped by the duplicate-registry-index dedupe), then `citationDisplayNumbers(order)` — memoized on `message`, passed only into the **answer** segment's `CitationRenderer` call.

   **Corrected during this planning pass (caught before review, not by it):** the first draft claimed "`SourcesRail` runs the identical computation on `payload.sources`" — that's wrong and would have shipped a numbering mismatch between the inline chips and the sidebar. `payload.sources` (`MessageSourcesPayload.sources`) is just the filtered `ReplaySourceEntry[]` list; first-appearance order needs `message.blocks` (document position), which `SourcesRail` never receives — it only ever gets a `MessageSourcesPayload`, never the full message (`SourcesRail.tsx` props are `{payload, onClose, isMobile}`). So `SourcesRail` **cannot** independently reproduce the same order from `payload.sources` alone. Fix: `sourcesPayloadFor` (`citations.ts:113-119`) already receives the full `message`, so it computes `displayNumbers` there (calling the exact same `citedIndexOrderForMessage`/`citationDisplayNumbers` pair) and attaches it to the payload — see the `MessageSourcesPayload` shape change in Design decision 3.5 below. `SourcesRail` then simply reads `payload.displayNumbers`, never recomputes. This still satisfies "same pure functions, same inputs, no drift" — the functions are just invoked once (inside `sourcesPayloadFor`) instead of independently in two components that don't have equal access to `message`.

   `CitationChip`'s `displayNumbers` prop is optional; when absent (narration, and every existing test that doesn't pass it) it falls back to `entry.index` — non-breaking for the narration path and for tests that don't care about renumbering.
3. **Real school favicon for CDS/profile chips, not a generic glyph.** New `citations.ts` helper:
   ```ts
   export function schoolDomainsFromBlocks(
     blocks: AssistantChatMessage["blocks"] | undefined,
   ): Map<number, string> {
     const domains = new Map<number, string>();
     for (const block of blocks ?? []) {
       if (block.kind !== "viz" || !isTabularRenderSpec(block.spec)) continue;
       for (const column of block.spec.columns) {
         if (column.unitid !== null && column.domain) domains.set(column.unitid, column.domain);
       }
     }
     return domains;
   }
   ```
   Computed once in `AssistantBody` alongside `displayNumbers` — same `useMemo(() => schoolDomainsFromBlocks(message.blocks), [message])` call — threaded the same way (answer segment only — narration citations that lack an accompanying viz table keep the generic fallback). `CitationChip` looks up `citation.school_unitid` in this map; on a hit, renders `<img src="https://www.google.com/s2/favicons?domain=..&sz=32">` — the exact `VizBlock.tsx:84-89` pattern, same size, same rounding — so a CDS chip for Yale sitting next to a Yale comparison table shows the literal Yale favicon. On a miss (CDS/profile citation with no paired viz in this message), falls back to a generic `SchoolIcon` (lucide, already imported elsewhere in `ToolWidgets.tsx:5`) — this is the **only** remaining generic-icon case, and only because no domain exists to resolve.
   - Risk flagged: if a message cites `cds`/`profile` sources for a school never rendered in any viz table in that same message, the fallback fires. This is expected to be uncommon (CDS numeric facts are usually accompanied by a stat block/comparison table) but not eliminated — acceptable given `Citation` has no domain field and adding one is a backend/contract change out of scope here.
3.5. **`MessageSourcesPayload` gains two fields, computed once at its one construction site.** Same problem as Design decision 2's correction: the sidebar (`SourcesRail`) needs both `displayNumbers` and `schoolDomains` to render matching numbers/icons, but it only ever receives a `MessageSourcesPayload`, never the full `message` those maps are derived from. Since `sourcesPayloadFor(message, active?)` (`citations.ts:113-119`) is confirmed (Item 7 of the technical review, full-tree grep) to be the **only** production construction site for `MessageSourcesPayload`, it is the correct — and only necessary — place to compute both maps once and attach them:
   ```ts
   export type MessageSourcesPayload = {
     sources: ReplaySourceEntry[];
     active?: SourceFocus;
     displayNumbers: Map<number, number>;
     schoolDomains: Map<number, string>;
   };
   ```
   `sourcesPayloadFor` internally calls the same `citedIndexOrderForMessage` → `citationDisplayNumbers` pair and `schoolDomainsFromBlocks(message.blocks)` it already has everything needed for. `SourcesRail` reads `payload.displayNumbers`/`payload.schoolDomains` directly — it must never attempt to recompute either from `payload.sources` alone, which structurally cannot carry document position or viz-column domains. This is a real (if small) type change, not just an internal implementation detail — `MessageSources.test.tsx`'s exact-match `toHaveBeenCalledWith(payload)` assertion will need its expected object updated (flagged in Phase 5), and any other test constructing a `MessageSourcesPayload` literal (`SourcesRail.test.tsx`) needs the two new required fields added to its fixtures.
4. **web/edu/reddit chips get a real favicon**, built from the citation's own `url` — new `citations.ts` helper `faviconUrlForCitation(citation)` reusing the same `google.com/s2/favicons` service (already used twice in this codebase: `VizBlock.tsx:88`, `school-cells.tsx:46`) rather than introducing a third favicon strategy.
5. **Hover-card body carries the metadata that matters**, per source kind — this is new content, not present in either existing path today:
   - web/edu/reddit: friendly label (`friendlySourceName`, existing), hostname, tier badge (Official/Community, existing pattern from `VizBlock.tsx:49-51`), snippet if present, safe external link.
   - cds: friendly label, "Common Data Set · {academic_year}" line (new `citationYearLabel` helper), tier badge (always Official per the domain validator), snippet if present.
   - profile: friendly label ("School profile"), tier badge, snippet if present — no year, since `Citation.academic_year` is `cds`-only by the domain validator (`envelope.py:84-92`).
   - legacy: friendly label from the raw `citation.source` string, safe link if present — no tier badge (v1 shape has no typed tier guarantee beyond what's already rendered today).
   - **This list governs the inline hover-card body only.** It does not govern whether the sidebar shows a link (see Design decision 6's explicit carve-out) — those are two independent rendering decisions that happen to share a data source.
6. **Sidebar visual pass**, same data, better hierarchy: each `SourceRow` gets the same icon (favicon/school-favicon/generic, from `payload.schoolDomains`/`faviconUrlForCitation`) at the front of its header line, next to the *sequential* `[N]` (from `payload.displayNumbers`, not `entry.index`), tier badge unchanged, then the existing metadata line, snippet, link, and (CDS only) the existing sorted evidence list / omitted-count line — none of that internal CDS evidence machinery changes.
   - **Link behavior is explicitly independent of Design decision 5's per-kind hover-card list, and must not change.** Today `SourceRow` renders a link for *any* entry with a `safeExternalUrl(entry.citation.url)`, regardless of source kind (`SourcesRail.tsx:53`, `82-84` — no branching on `citation.source`). `SourcesRail.test.tsx`'s `cds()` fixture (line 7) sets a `url` on a CDS citation specifically to exercise this, and the "renders marker order... and safe links" test (lines 22-32) asserts `getAllByRole("link")` has length 2 (one web, one CDS) on that basis. Design decision 5 says the *inline hover-card* for CDS doesn't list a link — that's about what the hover-card body composes, not a claim that CDS citations never carry a resolvable URL (Current-state findings' corrected Citation-validator note applies here too: nothing stops a future CDS citation from carrying a `url`). The sidebar keeps its existing kind-agnostic `href` rendering unchanged; do not port decision 5's per-kind list into `SourceRow`.
   - DOM ids (`source-row-{entry.index}`, `` source-evidence-{index}-${encodeURIComponent(eid)} ``) **stay keyed on the raw registry index** — that's an internal wiring detail (focus targeting from `SourceFocus`, which itself carries the raw index end-to-end through `sourceFocusForCell`/`markerIndex`) and must not be renumbered, only the human-visible label text changes.

## Implementation phases

### Phase 0 — Registry check (must run before Phase 1)
- `cd frontend && npx shadcn@latest view @coss/<candidate>` for citation/footnote/reference-badge primitives per the Registry policy above; document fit/no-fit inline in this plan file before touching code.

### Phase 1 — Data helpers (`citations.ts`)
- Add `citedIndexOrderForMessage`, `citationDisplayNumbers`, `schoolDomainsFromBlocks`, `faviconUrlForCitation`, `citationYearLabel`.
- Export the currently-private `hostOf` (or an equivalent `hostnameOfCitation`) for reuse in the hover-card body text.
- Extend `sourcesPayloadFor` to compute and attach `displayNumbers`/`schoolDomains` (Design decision 3.5) — its only signature-visible change is the return type gaining those two fields; `message`/`active` parameters are unchanged.
- No changes to `sourcesUsedByMessage`, `citedIndexesForMessage` signatures — pure additions alongside them.
- `types.ts`: add `displayNumbers: Map<number, number>` and `schoolDomains: Map<number, string>` to `MessageSourcesPayload`.

### Phase 2 — One chip component
- `inline-citation.tsx`: redesign `InlineCitationCardTrigger` to `{ index, icon }`, `Badge`-as-button; delete `getCitationSourceLabel` and the `sources: string[]` prop it served (dead once callers move to `index`/`icon`). Leave the carousel/quote/source sub-components alone — unused by this feature but not this plan's concern to prune speculatively (YAGNI cuts both ways: don't delete working exports nobody asked to remove).
- `CitationRenderer.tsx`: collapse the two-branch `CitationChip` into one function covering cds/profile/web/edu/reddit/legacy, each selecting its icon and hover-card body per Design decision 5. New optional props `displayNumbers?: Map<number, number>` and `schoolDomains?: Map<number, string>` on `CitationRendererProps`, both defaulting to "no map" (identity/generic fallback) so every existing caller compiles unchanged until Phase 3 wires them.

### Phase 3 — Wire the answer path
- `ChatMessage.tsx`'s `AssistantBody`: compute `displayNumbers` (via `citedIndexOrderForMessage` + `citationDisplayNumbers`, filtered against `sourcesUsedByMessage(message)`) and `schoolDomains` (via `schoolDomainsFromBlocks(message.blocks)`) through `useMemo` keyed on `message`; pass both into `SegmentBeat` and apply them only in the `case "answer"` branch's `<CitationRenderer>` call. `NarrationBeat`'s call keeps its current props (no renumbering, no school-icon upgrade) per the stated non-goal. This duplicates the same two pure-function calls `sourcesPayloadFor` makes for the sidebar payload (Phase 1) — intentional, not drift-risk, since both call sites feed the same `message` into the same functions and get identical Maps.

### Phase 4 — Sidebar
- `SourcesRail.tsx`: read `payload.displayNumbers`/`payload.schoolDomains` directly inside `SourcesRailBody` (no recomputation — see Design decision 3.5) for the visible `[N]` prefix and per-row icon; keep the existing kind-agnostic link rendering exactly as today (Design decision 6's explicit carve-out); keep every DOM id, focus-scroll, and evidence-sort behavior exactly as today.

### Phase 5 — Tests
- `CitationRenderer.test.tsx`: update the "external markers keep the named citation behavior" test to assert the unified button role/aria-label (`Open source 7`) instead of hostname text; add a case proving `[12]`/`[30]`-style raw indices render as sequential `1`/`2` when a `displayNumbers` map is supplied; add a case proving first-appearance order (a source cited later in the text but with a lower raw index still gets the *later* display number); add a case for CDS-with-matched-viz-domain rendering the real favicon `src` vs. CDS-without-viz falling back to the generic icon.
- `SourcesRail.test.tsx`: add a case asserting the sidebar's visible number matches a supplied `displayNumbers` map from the payload (not recomputed) while `source-row-*` DOM ids stay on raw `entry.index`; **update every existing `MessageSourcesPayload` fixture literal** in this file (lines 23, 35, 37, 47, 53 per the technical review's Item 7/11 findings) to include the two new required fields; **explicitly keep the existing "renders marker order, CDS metadata, page-sorted evidence, omitted count and safe links" test's `getAllByRole("link")).toHaveLength(2)` assertion passing unchanged** — this is a regression guard for Design decision 6's link-independence carve-out, not a test to rewrite.
- `citations.ts`'s own test (`citations.test.ts`): add `describe` blocks for `citedIndexOrderForMessage` (first-appearance order across mixed markdown/viz blocks, and across duplicate mentions of the same index) and `citationDisplayNumbers` (given an explicit order, not a sort) — these are new pure functions with the honesty-adjacent job of "never show a number a human wasn't shown," worth a real unit test per `AGENTS.md`'s "logic gnarly enough that a test is the fastest way to trust it" carve-out, not skipped under the no-TDD default.
- `MessageSources.test.tsx`: **update, not skip** — `sourcesPayloadFor`'s return shape now includes `displayNumbers`/`schoolDomains`, so the existing `expect(onOpen).toHaveBeenCalledWith({ sources: [...], active: undefined })` assertion (line 18) must be updated to include the two new fields with their expected computed values, or loosened to `expect.objectContaining(...)` if exact-matching the Maps is awkward. **This corrects the original plan draft's claim that this file needed no changes** (technical review Item 11 territory — the review didn't catch this specific test because the original draft avoided the `MessageSourcesPayload` type change entirely; that avoidance turned out to be unsound once first-appearance ordering and sidebar school-icons were added, per Design decision 3.5 above).

### Phase 6 — Verify
- `cd frontend && npm run typecheck && npm test` (per `AGENTS.md`'s Commands section — the only frontend gate this repo defines; no separate lint-zero-tolerance/coverage-percentage gate is asserted anywhere in `AGENTS.md`, so none is invented here).
- Manual check in the running app (`npm run dev`) against a real turn that mixes web + reddit + CDS citations, confirming: chip icons match source kind, hover-card metadata reads correctly, sidebar numbers match inline numbers exactly, a message with e.g. 30 registry entries but 9 cited ones never shows a number above 9, and citation numbers read in the same order a human reads the prose (first-appearance, not backend tool-call order).

## Risks

1. CDS/profile chips without an accompanying viz table in the same message fall back to a generic icon (documented in Design decision 3) — acceptable, not silently wrong (no fake per-school icon is invented).
2. Favicon services (`google.com/s2/favicons`) can 404/return a blank icon for obscure domains — same risk the codebase already accepts in `VizBlock.tsx`/`school-cells.tsx`; no new mitigation invented here (no error boundary/fallback chain beyond what those call sites already do, i.e. none — an empty favicon square is the existing accepted behavior).
3. **`MessageSourcesPayload` is a wire-adjacent-feeling but actually purely-derived type** — adding required fields to it is safe (nothing serializes this type over the network; it's a client-only view-model built fresh by `sourcesPayloadFor` on every render), but every test file that hand-constructs a `MessageSourcesPayload` object literal instead of calling `sourcesPayloadFor` must be updated in the same PR or TypeScript will fail the build, not just individual tests. Phase 5 enumerates the two known files (`SourcesRail.test.tsx`, `MessageSources.test.tsx`); a final `grep -rn "MessageSourcesPayload = {" frontend/src` (or equivalent literal-construction search) during Phase 5 is the safety net in case a third site exists that wasn't surfaced by the technical review's full-tree grep (which was scoped to production code, not exhaustively to every test literal shape).
4. **Narration citations remain exposed to the exact raw-index problem the user reported, just in a different UI region.** Confirmed by technical review (Item 5): `NarrationBeat` renders inline (not collapsed by default) and resolves `[n]` markers against the full, unfiltered `message.sources` registry with no renumbering — a narration sentence citing a source that never made it into the final answer's `blocks` can still show a raw index like `[30]`. This is a deliberate, documented scope cut (see Non-goals) rather than an oversight, but it means the fix is *not* total for every citation surface in the product — only the answer prose and the sidebar. If this residual gap turns out to matter in practice (e.g. narration is more visually prominent than assumed), the follow-up is straightforward: extend `citedIndexOrderForMessage`/`sourcesUsedByMessage`'s scan to include narration segment text, at the cost of the "answer's receipts vs. ephemeral chatter" distinction Design decision 2/Non-goals currently draws.
