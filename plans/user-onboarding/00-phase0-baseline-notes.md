# Phase 0 baseline notes — registry component audit

Scratch note only (per plan lifecycle: `plans/` is local, not canonical). Records what
`Phase 0` found so Phase 3 ("shell, tokens, and assets") doesn't have to re-derive it.

## Acquisition

- `npx shadcn@latest add https://registry.watermelon.sh/r/onboarding-setup.json` from
  `frontend/` failed exactly as §11.1 predicted: `npm error Invalid Version:` before any
  inspection happens (bad `npx`-resolved shadcn version, not a registry problem).
- Fallback used, exactly as documented: `npm install` (no-op, already clean) then
  `npm exec shadcn -- add https://registry.watermelon.sh/r/onboarding-setup.json`.
  That succeeded and created exactly one file: `frontend/src/components/ui/onboarding-setup.tsx`.
- No dependency was added. `frontend/package.json` and `frontend/package-lock.json` show
  zero diff after install — the registry component only imports `motion/react` and
  `lucide-react`, both already installed (`motion@12.42.2`, `lucide-react@1.23.0`).
  Constraint "no new runtime dependency beyond lucide-react and motion" (README §1.10) holds.

## Demo-specific content/behavior to remove in Phase 3 (`OnboardingSetup` → generic shell)

All line numbers refer to `frontend/src/components/ui/onboarding-setup.tsx` as generated (249 lines).

1. **Business-domain props, not Profile-shaped** (lines 10-24, 33-46): `focusOptions`/
   `selectedFocus`/`onFocusChange`, `revenue`/`onRevenueChange`, `role`/`onRoleChange`,
   `imageUrl` (singular, not the shell's `media: {src, alt, position, caption}` shape).
   None of this matches the target `OnboardingSetupProps` shell API in §11.4. The whole
   props surface must be replaced; nothing here is reusable as-is except `step`/`totalSteps`/
   `onContinue` (rename to `onContinue` unchanged) and the general step/media split.
2. **Hardcoded "revenue" custom dropdown** (lines 48-65, 124-187): local `isRevenueOpen`
   state, outside-click handler, hardcoded `revenueOptions = ['$100k – $200k', ...]`,
   absolute-positioned panel at `z-[100]` (the "arbitrary z-index" §11.3 flags). Entire
   block must go — Profile-shaped fields use the project's existing Select/Command/Popover
   primitives per §11.4, not a bespoke dropdown.
3. **Hardcoded "role" text input** (lines 189-199): plain `<input>` for `role`, no
   relation to any onboarding question in `01-questions-and-data.md`. Remove.
4. **`focusOptions` chip row** (lines 89-121): `CheckCircle2` chip-select pattern styled
   with raw orange (`#F87742`, `#FA692E`, `#FFF0E9`, `#2A1A14`). This is the closest visual
   idea to a real "choice control," but the raw hex must become semantic
   `--workspace-*`/onboarding tokens (§12.3 "raw orange... hex colors" to replace) and the
   options must come from the real per-step question data, not the demo's `FocusOption[]`.
5. **Raw hex colors throughout**, not tokens — must all become semantic tokens:
   - Card/background: `#EFEDF5`, `#F5F5F7`, `#0A0A0A`, `#1a1a1a`, `#111`, `#0F0F0F`
   - Text: `#111`, `#EEE`, `#99999B`, `#666`, `#8F8E92`, `#4B5563`, `#999`, `#979799`,
     `#8B8B8D`, `#A2A2A4`, `#444`, `#D7D7D7`
   - Borders/dividers: `#E5E7EB`, `#D1D5DB`, `#222`, `#333`, `#EEEDF3`, `#E5E5ED`,
     `#d6d5db`, gray-200 dashed
   - Continue button: `bg-[#0F0F0F]` light / `dark:bg-[#EEE]` — the plan explicitly wants
     the existing warm-ivory primary reserved for the main action instead.
6. **Fixed 5-bar progress indicator** (lines 209-216): `Array.from({ length: 5 })` is
   literally hardcoded to 5, not derived from the `totalSteps` prop it sits next to —
   exactly the bug §11.3 calls out ("five decorative bars that do not actually derive from
   `totalSteps`"). Must become `Array.from({ length: totalSteps })`.
7. **Outer card radius 24px** (`rounded-[24px]`, line 75) vs. spec's 16px outer / 12px
   inner-control family (§12.1). Inner card uses 18px (line 79) — also non-conforming.
8. **Heavy shadow** (`shadow-xl` line 75, `shadow-2xl` on the dropdown line 154,
   `shadow-lg`/`shadow-sm` on the button) vs. spec's "existing short workspace shadow
   language, maximum 8px blur" (§12.1).
9. **Dashed divider** (line 87: `border-t-[1.6px] border-dashed border-gray-200`) — §11.3
   flags this explicitly; spec wants "spacing, fieldsets, and quiet separators only"
   (§12.2), no dashed rule.
10. **12px explanatory copy** (line 83: `text-[12px]` subtitle) vs. spec's 15–16px
    description text (§12.3).
11. **Large hover scale + spring/bounce transitions** (lines 99-101 `whileTap={{scale:0.97}}`
    on chips; lines 219-222 `whileHover={{scale:1.04}}`/`whileTap={{scale:0.96}}` with a
    bouncy `spring` config `{stiffness:320, damping:30, mass:0.7}` on the Continue button)
    — §11.3 flags "large hover scaling and spring/bounce transitions" as something to
    replace with calmer motion, and reduced-motion handling is entirely absent.
12. **No Back button** — footer (lines 203-228) only renders `STEP n/total` + a single
    `Continue` button. `canGoBack`/`onBack` from the target shell API (§11.4) has no
    equivalent here.
13. **No defer ("Do this later") affordance** — nothing corresponds to `onDefer` in the
    target shell API; §11.3 lists this as a missing state to add.
14. **No loading/saving/error states** — no `isSaving`, `saveStatus`, or `error` handling
    anywhere; the Continue button has no disabled/loading affordance. Target shell API
    requires all three.
15. **No reduced-motion handling** — all `motion.div`/`motion.button`/`motion.img`
    animations run unconditionally; no `prefers-reduced-motion` check. Required per
    README §1.9 and §11.3.
16. **Unlabelled decorative image** (lines 234-244): `<motion.img src={imageUrl} .../>`
    has no `alt` attribute at all (not even `alt=""`). Target shell API's `media.alt` is
    typed as the literal `""` (decorative-only, deliberately empty) — the current markup
    doesn't even set that; a screen reader will fall back to the filename. Must fix.
17. **`inter` class name littered in JSX** (line 78: `className="inter order-2 ..."`) —
    dead/no-op class (no such Tailwind utility, and Counselle already uses the Geist
    variable family, not Inter, per §12.3). Drop it.
18. **Fixed `totalSteps`-unaware footer layout** assumes exactly one continue action;
    the real flow's completion state (a 6th "view", not a form step, per README §5.1)
    isn't representable by this component as-is and will need the `completion` content
    variant mentioned in §11.4.

## What's worth keeping (per §11.2, confirmed present in the generated file)

- Full-page centered composition, `grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]` desktop split
  (close to the spec's ~60/40 form/media split — needs ratio tuning, not a rewrite).
- `AnimatePresence`-driven image swap keyed by `imageUrl` (lines 233-244) — the "animated
  media change by step" idea to preserve, once wired to reduced-motion and the real
  `media` prop shape.
- The step/footer relationship (progress + primary action together) — compact and
  reusable once counts/labels are generalized.
- Overall two-surface nesting (outer frame + inset white/near-black card) reads as
  intentional polish; keep the *idea*, restyle with tokens/radii/shadow per §12.1.

## Not touched

This phase did not modify `onboarding-setup.tsx` — it was only read in full. Phase 3
("shell, tokens, and assets") does the actual refactor into the `OnboardingSetupProps`
shape from §11.4.
