# Backend, frontend, and execution plan

[Back to plan overview](README.md)

## 19. Backend implementation

### 19.1 New `app/onboarding.py`

Own:

- ordered step tuple;
- status and step literals;
- Pydantic progress model;
- command body model;
- immutable initial-state factory;
- parser for absent/malformed/current settings state;
- transition function with idempotency rules;
- `update_onboarding_progress(pool, user_id, command)`.

The transition function should be pure and directly testable. The write function performs a parameterized `jsonb_set` update and returns the stored normalized state.

Do not mutate the existing settings dictionary. Construct a new nested object.

### 19.2 Update `api/users_db.py`

- When creating any new user, merge the initial version-1 onboarding state into otherwise supplied settings.
- Preserve any supplied non-onboarding settings.
- Do not overwrite an explicitly trusted internal onboarding state if future fixtures/migrations supply one.
- This path covers password and OAuth creation.

### 19.3 New `api/routes/onboarding.py`

- Thin authenticated PATCH route.
- `require_json`.
- Existing workspace write rate limit.
- Calls the app service with `user.id`.
- Returns the typed state.
- No workspace change row or SSE event: onboarding progress is UI flow state, not student Profile data.

### 19.4 Update `api/routes/me.py`

Protect the reserved `settings.onboarding` key from generic settings replacement:

- treat `settings` on `/v1/me` as an RFC 7396-style top-level patch: omitted keys are preserved, an explicit null value deletes an ordinary setting, and `settings: null` is rejected rather than clearing the whole object;
- reject attempts to write the reserved `onboarding` key through `/v1/me` with 422;
- onboarding changes only through `/v1/onboarding`;
- keep name updates atomic with the resulting merged settings;
- update the existing route test that currently expects settings replacement.

This prevents a later theme/source-config update from silently erasing completion state.

### 19.5 Update `api/main.py`

Register the new router under `/v1`.

### 19.6 No database migration

No schema change is required:

- new users receive the state at creation;
- existing users remain absent/grandfathered;
- `settings jsonb` already exists and cascades with account deletion.

Do not add onboarding columns or a table.

## 20. Frontend implementation

### 20.1 API and types

Add `frontend/src/api/http/onboarding.ts`:

- `OnboardingStatus`
- `OnboardingStep`
- `OnboardingProgress`
- `OnboardingCommand`
- safe parser for `MeData.settings.onboarding`
- `patchOnboarding(command)`

Add a React Query mutation that updates both the onboarding-specific cache and `authQueryKey`'s nested settings immutably.

### 20.2 Route gate

Add `frontend/src/app/auth/OnboardingGate.tsx` between `RequireAuth` and workspace routes.

Behavior matrix:

| State                | Visiting `/app/*`      | Visiting `/onboarding`                                                                       |
| -------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| absent/grandfathered | allow                  | allow and initialize on start                                                                |
| `not_started`        | redirect to onboarding | allow                                                                                        |
| `in_progress`        | redirect to onboarding | allow/resume                                                                                 |
| `deferred`           | allow                  | allow/resume                                                                                 |
| `completed`          | allow                  | allow only with ephemeral `onboardingCompletion: true`; otherwise redirect to `/app/profile` |
| malformed            | allow; never trap user | show recoverable error when onboarding is explicitly opened                                  |

Preserve an intended deep link only for deferral. Completion intentionally goes to the AI home to create the activation moment.

The completion mutation must set the ephemeral route flag before the updated `authQueryKey` can cause the gate to re-evaluate. This is a navigation/display flag only—never persist it in settings or the URL. Clear it when leaving onboarding. A page refresh intentionally drops it and sends the completed user to Profile.

Use React Router history state for `step`, sanitized `returnTo`, and the one-time completion flag. Push state when moving forward, consume it when navigating back, and validate every requested step against persisted progress so crafted history state cannot jump ahead. Persist none of these navigation details in the URL.

Align the authenticated fallback destination with the existing `/app` index by changing the no-deep-link default in `safeAuthDestination` from `/app/tasks` to `/app/ai`. Continue to accept only sanitized paths beginning with `/app`; never route a stored external URL.

### 20.3 Feature folder

Create focused files under `frontend/src/features/onboarding/`:

- `OnboardingRoute.tsx` — orchestration only.
- `OnboardingStepForm.tsx` — common form/focus/save wrapper.
- `steps/BasicsStep.tsx`
- `steps/AcademicStep.tsx`
- `steps/DirectionStep.tsx`
- `steps/ContextStep.tsx`
- `steps/FitStep.tsx`
- `OnboardingCompletion.tsx`
- `OnboardingAside.tsx`
- `OnboardingChoiceGroup.tsx`
- `OnboardingTagInput.tsx`
- `onboarding-steps.ts` — ordered definitions, titles, image paths.
- `onboarding-profile-patch.ts` — pure patch construction and normalization.
- `onboarding-validation.ts` — pure input validation.
- `onboarding-draft.ts` — sessionStorage serialization/versioning.
- `onboarding-prompts.ts` — deterministic completion prompt selection.

Keep functions under 50 lines and files under 800 lines. Do not place all five screens in one giant route file.

### 20.4 Registry shell

Install and adapt `frontend/src/components/ui/onboarding-setup.tsx` as specified in §11. It stays presentation-only and receives children/media/navigation props.

Before building a missing commodity control, search the shadcn/COSS registries from `frontend/`. Use existing local primitives first. The tag-entry behavior may be a small feature component if no compatible registry item fits; do not add an entire form framework.

### 20.5 Tokens

Add onboarding semantic aliases in `frontend/src/index.css`, each derived from the existing workspace family. Expected roles:

- page background;
- frame surface;
- form surface;
- media caption surface;
- border/soft border;
- primary/primary foreground;
- selected surface/border;
- muted/soft foreground;
- focus ring;
- error foreground/surface.

Do not add raw registry hex colors inside feature components. Do not change global workspace colors to make onboarding work.

### 20.6 Profile re-entry

In `ProfileRoute`:

- show `Guided setup` near the page header for absent/grandfathered or deferred state;
- do not show it for completed users;
- the full Profile remains visible and primary;
- no completion banner or nagging percentage.

### 20.7 AI handoff

Extend `AiComposerRoute` location state parsing with an optional `draftPrompt` string.

- Initialize the composer value from a valid non-empty bounded string.
- Clear route state after hydration so refresh/back does not repeatedly overwrite what the student types.
- Never call submit automatically.
- The normal server greeting and composer remain unchanged.

## 21. Implementation phases and gates

### Phase 0 — baseline and registry acquisition

1. Run backend routine tests and frontend typecheck/tests before changes.
2. Capture current `/app/profile`, auth, and AI home screenshots into `artifacts/onboarding/baseline/`.
3. Run the exact registry installation command and fallback only as documented in §11.1.
4. Read every generated line and record the demo-specific behavior to remove.
5. Confirm no unrelated dirty essay files are touched; the worktree currently contains user-owned essay changes.

**Exit:** registry source is present, dependency diff understood, and baseline is green or existing failures are documented.

### Phase 1 — progress backend

1. Add typed progress state and pure transitions.
2. Initialize new password/OAuth users.
3. Add authenticated progress route.
4. Protect the reserved settings key and merge generic settings safely.
5. Register the route.
6. Add focused transition, route-auth, user-scope, idempotency, initialization, and settings-preservation tests.

**Exit:** new users get `not_started`; existing absent state remains grandfathered; generic settings writes cannot erase onboarding; all focused backend tests pass.

### Phase 2 — frontend data and routing

1. Add types/parser/client/mutation.
2. Add `OnboardingGate` and `/onboarding` route outside `WorkspaceShell` but inside auth.
3. Implement state matrix and deep-link behavior.
4. Add Profile re-entry.
5. Add route/gate tests.

**Exit:** new, deferred, completed, grandfathered, malformed, and unauthenticated routing behavior is deterministic.

### Phase 3 — shell, tokens, and assets

1. Refactor the installed registry component into the generic shell.
2. Add semantic onboarding tokens.
3. Build the desktop/tablet/mobile layout.
4. Produce and promote the five approved media assets.
5. Add reduced-motion behavior and media fallbacks.
6. Verify the empty shell at every required viewport before adding all form density.

**Exit:** the component still visibly retains the supplied design's composition and polish, while matching Counselle's theme with no raw demo styling.

### Phase 4 — questions and profile writes

Implement in order:

1. shared choice, tag, progress, error, and draft primitives;
2. Basics;
3. Academic snapshot;
4. Academic direction;
5. Context;
6. Fit;
7. pure patch builders and validation;
8. save/progress sequencing and partial-failure retry.

After each screen, compare its outgoing patch to the mapping in §9 and verify a second unrelated Profile field survives.

**Exit:** all questions, choices, conditional fields, validation, omission/null/false behavior, and resume behavior match this document.

### Phase 5 — completion and activation

1. Build the truthful completion receipt from returned Profile data.
2. Add deterministic prompts.
3. Add editable AI composer draft handoff.
4. Confirm no automatic session or model call occurs.
5. Confirm the first manually submitted turn receives the newly saved Profile through existing student context.

**Exit:** a student can finish, choose a prompt, review/edit it, send it, and receive an answer capable of using their saved context.

### Phase 6 — hardening and visual review

1. Run focused frontend and backend tests.
2. Run typecheck, lint, and routine suite.
3. Run `jest-axe` states.
4. Keyboard-test the complete flow.
5. Test reduced motion.
6. Test required viewports and 200% zoom.
7. Test slow network, Profile 422, Profile 500, progress failure after Profile success, rate limit, image failure, and refresh midstep.
8. Review screenshots for alignment, contrast, cropping, density, and component coherence.
9. Remove dead demo props/styles/assets.
10. Perform a final code review for mutation, hardcoded values, accidental null clearing, and PII logging.

**Exit:** all acceptance criteria pass and no critical/high review issue remains.

### Phase 7 — documentation and graduation

1. Update living architecture docs only if the final implementation changes the auth/settings or route architecture materially.
2. Add an ADR only if implementation departs from the existing settings/profile decisions; do not create one reflexively.
3. Once shipped and verified, move this finalized plan to `specs/user-onboarding/plan/` and update `specs/README.md`.
4. Delete or archive superseded onboarding scratch notes instead of duplicating them.
