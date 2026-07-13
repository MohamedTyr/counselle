# Profile UI/UX refresh plan

**Status:** proposed scratch plan
**Scope:** `frontend/src/features/profile/` and the profile-specific design tokens only.
**Intent:** turn the profile from a long settings-like intake form into a calm, trustworthy application-context workspace. All profile fields remain optional; the UI must never imply that blank data is incomplete, or invent a student fact.

## Product decisions

1. Keep `/app/profile` as the sole route, but separate its three jobs with in-page tabs: **Profile**, **Documents**, and **Memory**. This removes the current requirement to scroll through ten profile sections before reaching uploaded documents or agent memories.
2. Within **Profile**, retain the counselor-intake order from `PROFILE_SECTIONS`, but render sections as a multiple-open accordion. Basics opens by default; the user can keep adjacent sections open while entering related information.
3. Do not show a completion percentage. Every field is optional by design, so a percentage would create false pressure. Section triggers instead use factual summaries such as “No details yet” or “3 details added.”
4. Preserve field-level autosave. Add visible, truthful status: `Saving…`, `Saved`, and `Couldn’t save — retry`; do not add a competing Save button to every section.
5. Keep the current warm, dark workspace palette. The profile earns a denser field treatment, not a separate theme or bright accent color.

## Current-state findings

- `ProfileRoute` currently renders ten equal `ProfileSectionCard`s in a two-column grid, followed by Documents and Memories in the same long scroll.
- Every field uses compact `sm` controls; object fields and repeatable rows add more bordered boxes inside the surrounding cards. This produces excess chrome without a clear reading hierarchy.
- Text inputs save on blur and discrete controls save immediately, but the interface has no pending/saved state. Query errors fall through to empty-looking profile content; Documents and Memories conflate loading/error with an empty state.
- The existing config-driven model, merge-patch helpers, and per-field drafts are the correct seams to preserve. The plan changes presentation and validation behavior, not the API contract.

## Registry and primitive policy

Frontend discovery is mandatory before implementation.

1. **COSS first.** Reuse the installed Base UI-compatible primitives where they fit. The COSS registry has been checked for `@coss/accordion`, `@coss/tabs`, and `@coss/form`; use its multiple-open accordion and field composition as the implementation reference.
2. **Use the installed primitives before adding anything.** `Tabs`, `Accordion`, `Card`, `Input`, `Textarea`, `Select`, `Dialog`, `Badge`, `Empty`, `Skeleton`, `Separator`, and `Meter` are already present. Inspect their local APIs and compose them rather than duplicating them.
3. If semantic `Field`/`FieldLabel`/`FieldError` composition is genuinely missing, inspect `@coss/form` and its dependencies first, then add only the required COSS components using the project runner. Do not hand-roll a parallel form system.
4. **AI Elements is not a fit** for this non-conversational form surface. **Magic** and **Watermelon** are not configured registries in `components.json`; do not introduce them speculatively. Shadcn is the fallback only after COSS does not supply the needed commodity primitive.
5. Before any registry install, run the project-aware registry search/view commands; after an install, read each added file and verify Base UI composition, keyboard behavior, imports, and token usage.

## Design system

### Layout

- Use one main reading column for active profile content (`max-w` sized for form scanning) rather than a masonry-like two-card grid. Inside a section, use a two-column field grid only for short, peer fields; narrative fields and lists span the full width.
- Header stack: page title and concise purpose, autosave status at the right on desktop / below on mobile, then the top-level tabs. No dashboard metrics or decorative hero treatment.
- Each accordion trigger contains section title, one-line description, and a factual data summary. Open panels use vertical rhythm and separators; avoid nested-card framing.
- At desktop widths, tabs remain a compact horizontal row. At narrow widths, preserve the same order with horizontally scrollable tab triggers only if needed; never make the form horizontally scroll.

### Form controls

- Add profile-scoped semantic tokens in `src/index.css` for field surface, border, hover border, focus border/ring, label, helper text, and section divider. Feature components consume these tokens—no raw colors.
- Profile text/select controls are comfortable desktop/mobile form controls (roughly 40 px visual height), with a quiet raised warm-charcoal surface, low-contrast border, and unmistakable keyboard focus. Keep existing shared input behavior intact outside Profile.
- Visible labels remain mandatory. Show helper text for concepts that need it (for example GPA scale, SAI, or comma-separated list syntax), not under every simple field.
- Replace tri-state boolean selects with an accessible three-option segmented/radio control: Not set, Yes, No. Closed preference sets use the existing chip/toggle vocabulary with clear selected states.
- String-list fields get explicit “Separate with commas” guidance. If the smallest implementation remains comma parsing, show the parsed values as read-only chips after blur; do not change the wire format.
- Nested objects (SAT, high school, residence) become titled internal field groups separated by a `Separator`, not a bordered card inside a card. Repeatable entries become compact structured rows with one clearly primary field, readable remove action, and the existing safe local-draft behavior.

### Documents and Memory

- Documents get their own tab with a clear upload action, then a concise list of document records. Keep the current honest readability status badges and summary behavior.
- Memory gets its own tab and remains read-only except for “Forget.” Clearly state that these are agent-captured notes, not user-authored profile fields.
- Deleting a document or memory requires the existing `Dialog` confirmation primitive, naming the record and explaining the consequence. Never rely on color alone for destructive intent.

## Implementation phases

### Phase 0 — Baseline and component verification

- Read the current APIs for installed `Tabs`, `Accordion`, `Dialog`, `Select`, `Input`, and `Textarea`.
- Inspect COSS `p-accordion-3`, `p-tabs-11`, and `p-form-1` as behavior/composition references. Search COSS first for any missing field or radio primitive; inspect Shadcn only as fallback.
- Capture the current Profile route behavior in focused tests before changing layout: loading, successful render, mutation pending/success/error, Documents and Memory loading/error/empty states, destructive actions, and keyboard navigation.
- Confirm no local profile/API changes are needed for presentation work; retain RFC-7396 minimal patches and current server normalization.

### Phase 1 — Route hierarchy and truthful states

- Refactor `ProfileRoute` into top-level Profile/Documents/Memory panels using the installed `Tabs` API.
- Add a compact autosave status component driven by `useUpdateProfile` lifecycle state. It announces state changes politely and provides a retry path for a failed last patch.
- Give profile, documents, and memories distinct loading, error, retry, and empty states. An empty-state message may render only after a successful empty query.
- Replace the two-column section-card grid with a single profile content column and a multiple-open accordion. Preserve `PROFILE_SECTIONS` as the source of field order and labels.

### Phase 2 — Profile field system

- Introduce profile-only tokens and a small shared field shell around the existing control primitives. Apply it consistently to scalar, select, textarea, list, object, and object-list fields.
- Update `ProfileSectionCard` into an accordion section with a factual populated-data summary.
- Rework `ProfileObjectField` to semantic grouping plus separators; remove the nested-card appearance.
- Rework `ProfileObjectListField` into compact, labeled entry rows. Preserve incomplete drafts locally until required fields are complete.
- Use a documented COSS field/radio/toggle primitive only when needed; otherwise compose the already-installed primitives. Do not replace global inputs/selects just to style Profile.

### Phase 3 — Data-entry clarity and integrity

- Add client-side validation and nearby recovery copy for numeric fields before a PATCH, while retaining server validation as authority. Validate only constraints that are deterministic and user-correctable (score ranges, rank/class-size relationship, GPA bounds, dates/years).
- Fix the empty repeatable-item defaults so adding a sensitive item cannot silently choose a value (for example, a Hook must start unselected rather than defaulting to Legacy).
- Expose already-modeled fields that are currently absent from the configuration when confirmed against the backend contract: recommender “Asked?” first; ACT section scores only if the schema/presentation work stays small.
- Add honest helper text for list parsing and complex admissions vocabulary. Avoid speculative guidance or required-field language.

### Phase 4 — Documents, Memory, and destructive actions

- Rebuild the document upload presentation around a clear file-selection action and structured metadata, retaining immediate upload once a file is selected unless product behavior changes explicitly.
- Add accessible confirmation dialogs for document archive and memory forget actions; keep controls keyboard reachable and disabled while their mutation is pending.
- Ensure document-processing statuses retain their present, factual wording; error messages identify the failed action and recovery path.

### Phase 5 — Visual and interaction quality pass

- Check all Profile-only tokens against the existing warm dark palette for contrast: normal labels/help text at AA, focus visibility, disabled clarity, selected chip clarity, and destructive treatment.
- Verify 375 px, tablet, and desktop layouts; no horizontal overflow, clipped popup, or overly dense controls.
- Verify keyboard order, visible focus, radio/toggle semantics, live autosave feedback, and reduced-motion behavior for accordion/tabs.
- Run the focused frontend tests, typecheck, and visual review against the running main-branch dev server. Use a code review before committing; retain the existing product visual register rather than applying the generic “app store” design-system suggestion returned by the external design search.

## Acceptance criteria

- Profile, Documents, and Memory are separately navigable without changing the route or losing data.
- All ten profile sections retain their existing field semantics and backend patch behavior, but are substantially easier to scan and enter.
- Every field has a visible label; every save/error/loading state is truthful and recoverable.
- Profile inputs have one consistent, accessible visual vocabulary and do not alter the composer or other workspace surfaces.
- No empty state appears during a loading or failed query.
- Repeatable and destructive actions cannot silently invent or delete sensitive student context.
- The implementation uses existing/COSS registry primitives where appropriate, adds no speculative dependency, and passes typecheck plus focused regression coverage.
