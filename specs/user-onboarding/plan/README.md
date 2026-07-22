# User onboarding — product, UX/UI, backend, and execution plan

**Status:** approved direction; implementation not started  
**Date:** 2026-07-21  
**Scope:** first-run onboarding for authenticated student applicants, plus a voluntary guided-setup re-entry from Profile  
**Canonical while active:** this file in `plans/`; graduate it to `specs/user-onboarding/plan/` only after the feature ships and is verified  
**Visual foundation:** `npx shadcn@latest add https://registry.watermelon.sh/r/onboarding-setup.json`

## Plan map

Read these files in order. Together they are one implementation contract:

1. `README.md` — outcome, scope, architecture facts, locked decisions, state flow, and progress contract.
2. [`01-questions-and-data.md`](01-questions-and-data.md) — every question, choice, validation rule, Profile path, completion behavior, and patch rule.
3. [`02-ui-ux-spec.md`](02-ui-ux-spec.md) — Watermelon customization, visual system, media, responsive behavior, motion, focus, accessibility, failure states, and privacy.
4. [`03-implementation.md`](03-implementation.md) — backend/frontend file plan and phased execution gates.
5. [`04-verification.md`](04-verification.md) — earned tests, commands, security review, visual quality gate, and definition of done.

Section numbers intentionally continue across files so references such as “§11.1” remain unambiguous.

## 1. Outcome

Build a five-step, approximately three-minute onboarding flow that gives Counselle the small set of student facts it uses most often, without turning first use into the full ten-section Profile form.

The flow must:

1. look and feel like a premium, native Counselle surface;
2. retain the supplied Watermelon component's strongest visual idea: a compact asymmetric form-and-media composition with smooth step transitions;
3. write directly into the existing typed Profile, never into a duplicate onboarding profile;
4. preserve all Profile merge semantics and existing values;
5. let the student skip any question or defer the entire flow;
6. resume from the first unfinished step;
7. finish by moving the student toward a genuinely personalized first conversation;
8. never generate, infer, round, or silently clear a student fact;
9. work with keyboard, touch, screen readers, reduced motion, short viewports, and slow or failed networks;
10. add no new runtime dependency beyond what the registry component already uses (`lucide-react` and `motion`, both already installed).

The activation event is **not** “onboarding completed.” It is: **the student starts a first conversation whose answer can visibly use the saved profile.**

## 2. Product boundary

### In scope

- One authenticated route: `/onboarding`.
- A five-step form plus a completion state.
- One voluntary `Do this later` exit.
- Resume behavior.
- A `Guided setup` entry from Profile for deferred and grandfathered users.
- Profile writes through the existing `PATCH /v1/profile` service path.
- Typed onboarding-progress state stored under the existing user `settings` JSON.
- A dedicated authenticated onboarding-progress endpoint.
- A route gate for genuinely new users.
- A deterministic post-onboarding prompt handoff; no automatic model call.
- Cohesive local media assets for the registry component's right panel.
- Focused backend, frontend, accessibility, and integration tests.
- Browser verification at the required responsive widths.

### Explicitly out of scope

- Replacing or reducing the full Profile page.
- A second profile schema or `onboarding_answers` table.
- Asking for essays, activities, awards, recommenders, disciplinary history, health information, full course rigor, class rank, AP/IB details, or family narrative.
- Uploading documents during onboarding.
- Agent memory collection.
- Chancing, admissions predictions, reach/target/safety labels, or any judgment of the student's competitiveness.
- A model call to summarize the form.
- Auto-sending a prompt after completion.
- A completion percentage. Every field is optional, so “78% complete” would create false pressure.
- Confetti, gamification, badges, streaks, mascots, glassmorphism, gradient decoration, or a bright student-app palette.
- A new analytics SDK. If product analytics is added later, this flow can emit events through that existing surface.
- Forcing existing users through onboarding at rollout.

## 3. Why this exact amount of information

The onboarding is the Profile's frequently used subset. A field belongs here only if it changes common advice across many conversations.

| Included                                        | Frequent decision it improves                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| Preferred name                                  | Natural address and trust                                                 |
| Grade level + graduation year                   | Timing, urgency, deadlines, and next actions                              |
| GPA type/value/scale                            | Basic academic calibration without pretending to read the full transcript |
| SAT/ACT + planned tests                         | Submit/withhold and retake discussions                                    |
| Intended majors + certainty + specialized paths | Program fit, direct admission, and curricular constraints                 |
| Residence + citizenship/visa                    | In-state, international, and eligibility context                          |
| First-generation status                         | Advising context and support pathways                                     |
| Aid need + budget + merit priority              | Affordability strategy and list construction                              |
| Regions + size + setting                        | Common fit filtering                                                      |
| Must-haves + dealbreakers                       | The student's non-negotiables                                             |

Everything niche remains in `/app/profile`, where the full typed record already exists.

## 4. Current architecture facts the implementation must preserve

1. `app/workspace/models.py` already defines the complete typed `Profile` and `ProfilePatch` models.
2. `GET /v1/profile` lazy-creates and returns the user's profile.
3. `PATCH /v1/profile` is authenticated, rate-limited, actor-attributed, and user-scoped.
4. `app/workspace/service_profile.py` applies RFC 7396-style deep merge semantics:
   - omitted key = leave existing value alone;
   - explicit `null` = clear the existing key;
   - object = merge recursively;
   - array = replace the array.
5. Profile decimals must be sent as decimal strings, never JavaScript numbers.
6. `app/student_context.py` rebuilds the Profile into the agent context on every authenticated turn. Once onboarding writes the Profile, no prompt duplication or cache invalidation layer is needed.
7. User settings already live in `counselle.users.settings jsonb` and are returned by `GET /v1/me`.
8. `PATCH /v1/me` currently replaces the whole `settings` object. Onboarding must not use that route directly because it could erase theme/source settings or later be erased by them.
9. Authentication and registration already flow through `AsyncpgUserDatabase.create`, including Google OAuth-created users.
10. The workspace visual system is already dark and tokenized in `frontend/src/index.css`.
11. `motion`, `lucide-react`, the local Button, Input, Select, Popover, Command, Skeleton, and other required primitives already exist.
12. The AI home route can accept local React Router state with a small extension; the first prompt must be prefilled, not auto-submitted.

## 5. Locked product decisions

These are implementation requirements, not open questions.

1. **Five steps, one completion state.** There is no separate welcome screen and no sixth “review everything” form step.
2. **All questions are optional.** Blank screens may be continued.
3. **No required-field asterisks.** Only conditionally necessary coherence checks apply, such as a GPA scale when a GPA value is entered.
4. **No duplicate storage.** Answers write into the existing Profile paths listed below.
5. **Progress is separate from profile data.** Only flow state goes in `users.settings.onboarding`.
6. **New users are gated; existing users are grandfathered.** An absent onboarding key means a pre-feature account and must not force a redirect.
7. **Deferral is respected.** `Do this later` changes status to `deferred`; the gate does not reopen automatically on the next login.
8. **Deferred users can resume manually** from a `Guided setup` action on Profile.
9. **Completed users edit the full Profile.** Direct navigation to `/onboarding` after completion redirects to `/app/profile`.
10. **Profile writes happen before progress writes.** A step is never marked complete if its profile patch failed.
11. **The first agent prompt is never sent without a user action.** Completion can prefill a draft; the student still presses Send.
12. **The Watermelon component is used as the structural foundation.** Its demo form model and raw visual styling are replaced, while its split composition, media panel, and transition character remain recognizable.

### Friction budget

- Five data screens maximum; completion is not counted as another form step.
- No screen contains more than five visible question groups before progressive disclosure.
- The common path does not require typing more than preferred name, one GPA pair, and optional tags; the rest uses fast choice controls.
- A student who skips everything can reach Counselle in under 45 seconds.
- A student entering a representative useful profile can finish in about 3 minutes.
- Validate those claims with at least three timed browser passes before shipping. If the representative path repeatedly exceeds 4 minutes, simplify controls or copy; do not add a sixth step.

## 6. Experience statement and visual lane

**Scene:** A student opens Counselle at a desk after school, often at night, slightly anxious and wanting calm direction without feeling interrogated.

**Color strategy:** restrained. Warm dark neutrals carry almost the entire surface; the existing warm-ivory primary color is reserved for progress, selected state, focus, and the main action.

**Personality:** focused, quiet, credible, premium, direct.

**Visual anchors:**

- the supplied Watermelon onboarding component for composition and step rhythm;
- Counselle's existing workspace for color, typography, controls, and density;
- a well-edited admissions workbook for the feeling of one purposeful question at a time.

The surface must not look like a generic SaaS setup wizard, a playful school app, a glassy AI product, or a full settings page placed inside a modal.

## 7. End-to-end route and state flow

### 7.1 New password registration

1. `AsyncpgUserDatabase.create` initializes `settings.onboarding` to version 1, status `not_started`, step `basics`.
2. Registration logs the user in as it does today.
3. The authenticated route gate reads `useMe()`.
4. `not_started` causes a redirect to `/onboarding`.
5. Opening `/onboarding` changes progress to `in_progress` without changing Profile data.
6. The route loads Profile and hydrates each step from existing values.

### 7.2 New Google OAuth user

The same database adapter creates the user and initializes the same onboarding state. No OAuth-specific frontend branch is allowed.

### 7.3 Existing account at rollout

1. `settings.onboarding` is absent.
2. The gate treats absence as `grandfathered`, not `not_started`.
3. The user enters the workspace normally.
4. Profile exposes a quiet `Guided setup` action.
5. Choosing it opens `/onboarding`; the start action creates an `in_progress` version-1 state.

### 7.4 Deferral

1. Student chooses `Do this later`.
2. Previously completed steps remain saved.
3. The current unsaved step draft remains in user-scoped `sessionStorage` for tab refresh/resume, but is not treated as server truth.
4. Progress changes to `deferred` at the same current step.
5. Student enters the sanitized `/app/*` destination they originally requested; when there is no explicit deep link, use `/app/ai`.
6. Future logins do not force onboarding.
7. `Guided setup` resumes the deferred step.

### 7.5 Completion

1. The Fit profile patch succeeds.
2. Progress changes to `completed` with a server timestamp.
3. The route sets ephemeral React Router state `{ onboardingCompletion: true }`, allowing the completion view to remain mounted despite the now-completed gate state.
4. The completion view renders from the returned Profile, not from an optimistic copy.
5. Student chooses either `Ask Counselle` or one of the personalized starting prompts.
6. `/app/ai` opens. A chosen suggestion is prefilled as an editable draft.
7. Only pressing Send creates the session/turn.

## 8. Progress state contract

Store only this data under `users.settings.onboarding`:

```json
{
  "version": 1,
  "status": "not_started | in_progress | deferred | completed",
  "current_step": "basics | academics | direction | context | fit",
  "updated_at": "2026-07-21T12:34:56Z",
  "completed_at": null
}
```

Rules:

- `updated_at` and `completed_at` are server-owned ISO timestamps.
- `current_step` means the first step not yet completed; it moves forward monotonically.
- Back navigation is local UI state and does not move persisted progress backward.
- `completed_at` is non-null only for `completed`.
- A completed state cannot be reset through the onboarding endpoint.
- Profile edits never change onboarding status.
- Clearing the Profile later never reopens onboarding.
- No answers or PII are copied into this progress object.

### Endpoint

Add authenticated `PATCH /v1/onboarding` with a command-shaped body:

```json
{ "action": "start" }
{ "action": "advance", "step": "basics" }
{ "action": "defer" }
{ "action": "complete", "step": "fit" }
```

Return the normalized progress state.

Transition table:

| Stored state               | Command                        | Result                                                |
| -------------------------- | ------------------------------ | ----------------------------------------------------- |
| absent/grandfathered       | `start`                        | `in_progress`, `basics`                               |
| `not_started`, `basics`    | `start`                        | `in_progress`, `basics`                               |
| `deferred`, any step       | `start`                        | `in_progress`, same step                              |
| `in_progress`, `basics`    | `advance(basics)`              | `in_progress`, `academics`                            |
| `in_progress`, `academics` | `advance(academics)`           | `in_progress`, `direction`                            |
| `in_progress`, `direction` | `advance(direction)`           | `in_progress`, `context`                              |
| `in_progress`, `context`   | `advance(context)`             | `in_progress`, `fit`                                  |
| `in_progress`, any step    | `defer`                        | `deferred`, same step                                 |
| `in_progress`, `fit`       | `complete(fit)`                | `completed`, `fit`, server `completed_at`             |
| already advanced/completed | repeated successful command    | unchanged current state; 200 idempotent response      |
| `completed`                | `start`, `advance`, or `defer` | unchanged completed state; frontend routes to Profile |

Validation:

- `start` accepts absent/grandfathered, `not_started`, or `deferred`; it preserves the saved current step when resuming.
- `advance` with the persisted current step advances to the next fixed step. A named step earlier than the current step is an idempotent retry; a named step later than the current step is rejected.
- Repeating an already successful `advance` is idempotent: return the current later state instead of failing.
- `complete` is accepted only for `fit` after the Profile write succeeds.
- `defer` preserves `current_step`.
- Completed state returns unchanged for repeated `complete`.
- Malformed actions or step names return 422.
- The route uses the authenticated user id only; no user id is accepted from the body.
- Apply the existing workspace write rate limit and `require_json` dependency.
