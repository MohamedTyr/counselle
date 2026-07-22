# UI/UX specification

[Back to plan overview](README.md)

## 11. Watermelon component integration

### 11.1 Acquisition

From `frontend/`, run the user's exact registry command first:

```bash
npx shadcn@latest add https://registry.watermelon.sh/r/onboarding-setup.json
```

The planning audit on 2026-07-21 found that `npx shadcn@latest` currently exits with `npm Invalid Version` before inspection. If that remains true during implementation:

1. run `npm install` and verify `npm ls --depth=0` is clean;
2. use the already-installed project CLI without changing the registry source:

   ```bash
   npm exec shadcn -- add https://registry.watermelon.sh/r/onboarding-setup.json
   ```

3. do not copy the JSON by hand or replace it with a lookalike component;
4. record the exact successful command in the implementation handoff.

The registry currently targets `components/ui/onboarding-setup.tsx` and depends on packages already installed.

### 11.2 What to preserve

- Full-page centered composition.
- Desktop asymmetric form/media split.
- The inner form surface and visual breathing room.
- Animated step replacement.
- Animated media change by step.
- Compact progress/footer relationship.
- The component's sense of polish and focus.

### 11.3 What to replace

- Hardcoded `focusOptions`, `revenue`, and `role` props.
- The custom absolute-positioned revenue dropdown.
- Raw orange, white, gray, and black hex colors.
- Fixed five decorative bars that do not actually derive from `totalSteps`.
- Tiny 12px explanatory copy.
- Oversized 24px outer-card radius.
- Heavy `shadow-xl`/`shadow-2xl` treatment.
- Dashed divider.
- Large hover scaling and spring/bounce transitions.
- Missing Back, defer, loading, error, and reduced-motion states.
- Missing semantic choice/selection behavior.
- Unlabelled decorative image.
- Arbitrary z-index.

### 11.4 Refactored shell API

Keep the registry component generic. Its responsibility is composition, not Profile knowledge.

```ts
type OnboardingSetupProps = {
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  children: React.ReactNode;
  media: {
    src: string;
    alt: "";
    position?: string;
    caption: React.ReactNode;
  };
  canGoBack: boolean;
  continueLabel: string;
  isSaving: boolean;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  error?: string;
  onBack: () => void;
  onContinue: () => void;
  onDefer: () => void;
};
```

Completion may use the same shell with a `completion` content variant or a separate `OnboardingCompletion` body inside it. Do not add business-field props back into the UI primitive.

## 12. Visual specification

### 12.1 Page and frame

- Page: `min-h-dvh`, `--shell-background`, no workspace sidebar or mobile shell header.
- Desktop padding: 24px minimum, 32px when space allows.
- Main frame: maximum width 1120px; maximum useful height around 720px; never force content clipping on shorter screens.
- Desktop columns at `lg` and above: approximately 60% form / 40% media.
- Frame surface: `--workspace-surface`.
- Form surface: `--workspace-surface-raised`.
- Border: one subtle `--workspace-border`; do not combine it with a wide decorative shadow.
- Radius: 16px outer, 12px inner/control family.
- Shadow: if needed, use only the existing short workspace shadow language, maximum 8px blur.
- The entire panel must remain visually balanced at 1024, 1280, and 1440 widths.

### 12.2 Form column

- Form content maximum reading width: 520px.
- Desktop inline padding: 40–48px.
- Top brand row: logo/name at left, `Do this later` at right.
- Progress sits below the brand row and above the heading.
- Heading and description form one tight group.
- Questions have larger separation than fields belonging to the same question.
- Desktop form body may scroll internally on short viewports; brand/progress and footer remain visible when possible.
- Do not wrap each question in a separate card. Use spacing, fieldsets, and quiet separators only where they improve grouping.

### 12.3 Typography

- Font: existing Geist variable family only.
- Screen heading: 26px mobile, 28px desktop; weight 600–650; line-height about 1.15; tracking no tighter than `-0.025em`; balanced wrapping.
- Description: 15–16px, line-height 1.55, max 60ch, `--workspace-foreground-soft`.
- Question legend: 15px, medium/semibold, `--workspace-foreground`.
- Helper and status text: 14px minimum; never use the registry's 12px body copy.
- Controls: 16px on mobile to prevent viewport zoom; current compact desktop typography may reduce to 14px only where the existing primitive does so accessibly.
- No uppercase tracked eyebrow. `Step 2 of 5` is sentence case.

### 12.4 Controls

- Reuse local Button, Input, Select, Popover/Command, and date/input primitives.
- Single choice uses semantic radio-group behavior.
- Multiple choice uses semantic toggle/checkbox behavior with `aria-pressed` or checkbox state.
- Selected state combines background, full border, check icon, and text state; color is never the sole signal.
- Default choice surface: `--workspace-composer-control-surface`.
- Hover: `--workspace-composer-control-hover-surface` and border.
- Selected: `--profile-control-selected-surface`, `--profile-control-selected-border`, and a visible check.
- Focus: existing `--workspace-ring`, at least 2px visible.
- Minimum coarse-pointer target: 44×44px with at least 8px between adjacent hit areas.
- Text inputs use visible labels; placeholders are examples, never labels.
- Primary action uses the existing warm-ivory Button. Back is ghost or outline. Defer is a quiet text action.

### 12.5 Progress

- Text: `Step n of 5`.
- Five equal semantic segments are legitimate because this is a real sequence.
- Current and completed segments use warm ivory; future segments use the quiet border/surface ramp.
- Include accessible `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and a textual label.
- Do not imply question completion or data completeness; progress means position in the flow only.

### 12.6 Media panel

The right side keeps the supplied component visually special while doing product work.

- Upper approximately 72%: full-bleed editorial image.
- Lower approximately 28%: solid `--workspace-surface` caption block, not glass and not overlaid blurred text.
- Caption label: `What Counselle will keep in mind`
- Caption sentence updates only from values already entered or loaded.
- Image is decorative and has `alt=""`; the caption carries all meaning.
- No campus names, college logos, readable personal documents, rankings, fake UI, or identifiable real minors.
- Use a coherent generated/licensed series with the same lens, grain, contrast, lighting, and crop language.

Required image roles:

| Step      | Image role                                | Composition                                                                                                   |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Basics    | A student planning at a desk after school | Warm evening side light, calendar/notebook shapes, no readable writing, calm negative space                   |
| Academic  | Reviewing academic materials              | Close editorial crop of hands, notebook, calculator/book edges; no fake transcript text or visible score      |
| Direction | Exploring subjects                        | Library/studio/lab-adjacent materials without disciplinary cliché or logos                                    |
| Context   | Practical planning                        | Student/family planning moment or map/notebook still life; no visible financial numbers or personal documents |
| Fit       | Looking forward                           | Campus-path or open study-space scene without an identifiable institution                                     |

Asset workflow:

1. Generate/source candidates into `artifacts/onboarding/`.
2. Review crops at the actual panel ratio in both 1024 and 1440 layouts.
3. Promote only selected, reviewed assets into `frontend/public/onboarding/`.
4. Export responsive AVIF/WebP where supported; target roughly 1600px long edge and under 250KB each without visible degradation.
5. Preload the next step's image after the current image loads.
6. Do not block the form on media loading; use a stable tinted surface and subtle skeleton.

## 13. Responsive behavior

### Desktop — 1024px and above

- Show the full 60/40 split.
- Keep media height aligned with the form frame.
- Keep footer visually anchored to the bottom of the form column.
- If the form body overflows on a short viewport, scroll only the body region; focus must scroll the invalid field into view.

### Tablet — 768px to 1023px

- Use one centered form surface, maximum width about 680px.
- Hide the large media panel; keep its live caption as a compact, non-card text row below the description.
- Maintain desktop-like spacing with 32px inline padding.
- Do not turn the image into a top banner that pushes the first question below the fold.

### Mobile — below 768px

- Full-width, single-column surface.
- Page padding 16px; remove decorative outer-frame layering if it creates nested borders.
- Brand/progress remain at the top.
- Hide media entirely; show only the short live caption when it contains real data.
- Footer is sticky to the bottom with solid background, top separator, and safe-area padding.
- Back and Continue remain reachable when the software keyboard opens.
- Continue is full-width; Back may sit beside it only if both retain 44px targets and readable labels.
- Never horizontally scroll the form, chips, progress, errors, or footer.
- Chip groups wrap naturally.
- Tag input and date fields stay at 16px.

### Required visual test sizes

- 375×667
- 390×844
- 768×1024
- 1024×768
- 1280×800
- 1440×900

Also test 200% browser zoom at 1280px and a short 1024×600 viewport.

## 14. Motion specification

Retain the registry component's polish while removing bounce and decorative scale.

| Motion           | Specification                                                                    |
| ---------------- | -------------------------------------------------------------------------------- |
| Initial frame    | 220ms opacity + 8px upward settle, ease `[0.22, 1, 0.36, 1]`                     |
| Forward step     | old content exits 12px left; new enters 16px right; opacity crossfade; 200–220ms |
| Back step        | exact directional reverse                                                        |
| Media change     | 260ms crossfade with maximum scale change `1.015 → 1`; no spring                 |
| Progress segment | 180ms background/foreground transition                                           |
| Choice selection | 140–160ms border/background/check transition                                     |
| Button press     | optional scale to 0.985; no hover scaling                                        |
| Error appearance | 160ms opacity; no shake                                                          |

Rules:

- Use `motion/react` already installed.
- Animate opacity and transform, not layout dimensions.
- Do not gate default visibility on JavaScript animation completion.
- `useReducedMotion()` removes translate and scale. Reduced-motion transitions are instant or a maximum 120ms opacity crossfade.
- Focus moves after the new heading is present, not during exit animation.
- Rapid double-clicks cannot queue multiple transitions or writes.

## 15. Interaction and focus model

1. The screen heading receives programmatic focus with `tabIndex={-1}` after a step transition. Do not autofocus the first input and unexpectedly open the mobile keyboard.
2. Tab order follows visible reading order: defer, progress/body controls, Back, Continue.
3. Enter submits from a normal text/number field only when no combobox/tag menu is open.
4. Enter inside a tag input commits a tag instead of advancing.
5. Space toggles focused choice controls.
6. Escape closes a Select/Popover/Command surface; it does not exit onboarding.
7. Forward step changes push the step key into React Router history state, never the URL. Browser Back returns to an earlier visited onboarding step without moving persisted progress backward. At step one, a new `in_progress` user remains gated and exits through the explicit `Do this later` action; a deferred/grandfathered voluntary visitor may return to the prior workspace destination.
8. Continue remains enabled when a screen is blank. It becomes loading/disabled only during an active save.
9. Non-empty invalid fields do not silently block with a disabled button. Continue validates, renders a clear error, and focuses the first invalid control.
10. Selections are reversible.
11. `Do this later` is always available except during the small critical section of an active save; after the request settles it becomes available again.
12. No confirmation modal is used for deferral because nothing destructive happens.

## 16. Accessibility requirements

- WCAG 2.2 AA target.
- Body and helper text contrast at least 4.5:1; large text at least 3:1.
- Placeholder examples also meet 4.5:1.
- One `<main>` and one visible `<h1>` per step.
- Every question is a `<fieldset>` with a visible `<legend>` where choices belong together.
- Every input has a visible associated label.
- Error messages use `aria-describedby` and invalid controls use `aria-invalid`.
- Step-change announcement: `Step 3 of 5, What are you drawn to?` in a polite live region.
- Save failure uses `role="alert"`; `Saving…`/`Saved` uses a polite status region.
- Progress exposes its current numeric value and text.
- Decorative images are removed from the accessibility tree.
- Selected choices expose semantic state, not just a Check icon.
- All pointer actions work with keyboard.
- All coarse-pointer targets are at least 44×44px.
- Focus is never trapped.
- Focus indicators are not clipped by overflow containers.
- Reduced motion is honored.
- At 200% zoom, content reflows without loss, overlap, or horizontal scrolling.
- Run `jest-axe` against step 1, the densest context step, error state, and completion state.

## 17. Loading, error, empty, and recovery states

### Initial load

- Render the branded shell immediately.
- Form body uses stable skeleton lines/controls matching the active step's approximate geometry.
- Media area uses its stable surface; no blank white flash.
- Do not display empty inputs before Profile has loaded, preventing accidental overwrite of saved values.

### Profile load failure

- Heading: `We couldn’t load your Profile`
- Body: `Your saved information is still safe. Try again before continuing.`
- Primary action: `Try again`
- Secondary action: `Do this later`
- Never render an apparently empty form after the query fails.

### Progress load/parse failure

- If `settings.onboarding` is malformed, do not force the gate.
- `/onboarding` shows: `We couldn’t load your setup progress.` and a Retry action.
- Log only the structural error and user id correlation already allowed by server logging; never log answers.

### Step validation error

- Field-level message adjacent to the field.
- One step-level alert only for an error not attributable to one field.
- Draft remains untouched.

### Network/profile save failure

- Copy: `We couldn’t save this step. Your answers are still here.`
- Actions: `Try again` and `Do this later`.
- Keep the student on the step.
- Do not clear session draft.

### Progress save failure after Profile success

- Copy: `Your answers were saved, but we couldn’t move to the next step. Try again.`
- Retry only the progress request.

### Rate limit

- Use the shared transport error message and retry-after value when present.
- Continue stays disabled until the displayed retry period passes or a manual retry is permitted by the shared policy.

### Media failure

- Keep the stable media surface and caption.
- Do not show broken-image chrome or block the form.

### Completion reload

- A just-completed user remains on the completion view only while ephemeral route state contains `onboardingCompletion: true`.
- Refreshing that page or directly navigating to `/onboarding` as a completed user has no ephemeral flag and redirects to Profile.
- The completion UI is not treated as permanent history; the Profile is the permanent record.

## 18. Draft and privacy behavior

- Persist only the active unfinished step draft in `sessionStorage`, keyed by authenticated user id and onboarding version.
- Never use global localStorage for these answers.
- Never place answers in URL query parameters, route paths, logs, telemetry, or error strings.
- Clear a step draft after its Profile and progress writes succeed.
- Clear all onboarding drafts on completion and logout.
- Ignore and remove drafts with another user id or unsupported version.
- Server Profile is authoritative. On load, merge a same-user session draft only over the specific active step and clearly treat it as unsaved local state.
- Do not claim encryption or special privacy guarantees in UI copy.
- The existing account-deletion cascade already removes Profile and settings; no new deletion path is needed.
