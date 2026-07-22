# Verification and definition of done

[Back to plan overview](README.md)

## 22. Tests that earn their place

### Backend

- Initial state is injected for password-created and OAuth-created users.
- Existing user with absent key remains grandfathered.
- Start, advance, defer, resume, complete transitions.
- Advance and complete retries are idempotent.
- Completed cannot regress.
- Auth is required.
- Authenticated id, not body input, scopes the write.
- Malformed commands return 422.
- Generic `/me` settings updates preserve onboarding and reject direct reserved-key writes.
- Non-onboarding settings survive onboarding progress writes.

### Pure frontend logic

- Each step produces the exact minimal Profile patch.
- Untouched/skipped fields are omitted.
- Explicit clear produces null only for a pre-existing value.
- False booleans survive.
- Decimal strings remain strings and are not rounded.
- Planned SAT/ACT edits preserve unrelated planned tests.
- Existing extra majors/must-haves/dealbreakers are not accidentally dropped.
- Validation ranges and GPA coherence.
- Deterministic prompt selection.
- Draft version/user scoping.

### Frontend integration

- New user is redirected once.
- Deferred user reaches workspace and is not nagged again.
- Guided setup resumes the right step.
- Completed user cannot rerun the short wizard and is sent to Profile.
- The progress mutation does not redirect away before the one-time completion screen renders; reloading that screen does redirect to Profile.
- Profile-load failure never shows empty controls.
- Blank step can continue.
- Invalid non-empty field focuses and announces an error.
- Successful step saves Profile before progress.
- Profile success/progress failure retries progress only.
- Completion prompt prefills but does not submit.
- Back preserves entered state.
- Reload restores same-user session draft.
- Saved conditional values are visible after hydration and excess Profile list values survive onboarding edits.
- axe checks for representative states.

Do not add brittle tests for exact animation frames, generated class strings, or every line of UX copy.

## 23. Verification commands

```bash
# Backend focused
uv run pytest tests/api/test_onboarding.py tests/api/test_auth.py

# Existing honesty/profile regression
uv run pytest tests/api/test_profile_documents_memories_routes.py \
  tests/app/test_profile_memory_services.py tests/app/test_student_context.py

# Backend routine suite
uv run pytest -m "not live_llm and not live_search and not live_db"

# Backend static checks
uv run ruff check .
uv run mypy .

# Frontend
cd frontend
npm run typecheck
npm test
npm run lint
npm run build
```

Use the real local API and frontend for final browser review. Generated screenshots and logs stay under `artifacts/onboarding/`.

## 24. Security and honesty review

- Every write is authenticated and scoped from server identity.
- No user id in request bodies.
- Parameterized SQL only.
- No answers in logs, URL, analytics, error reporting, or progress settings.
- No automatic inference from locale/IP/account metadata.
- No automatic Profile clearing from hidden conditional fields.
- No float conversion for GPA/budget.
- No fabricated interpretation in live captions or completion receipt.
- No model-generated summary that could distort values.
- No auto-submitted model call.
- Existing rate limiting remains active.
- Generic settings updates cannot erase onboarding progress.
- Account deletion continues to remove Profile and settings through the existing user cascade.

## 25. Final visual quality gate

The flow is not ready merely because it works. It must pass all of these:

- The supplied Watermelon composition is still recognizable and is clearly the foundation.
- The screen unmistakably belongs to the existing Counselle workspace.
- No raw orange/demo palette remains.
- No raw hex colors live in onboarding feature components.
- No custom dropdown duplicates the local Select/Popover system.
- No nested-card clutter.
- No radius over 16px on structural surfaces.
- No wide border-plus-shadow ghost-card treatment.
- No body copy below 14px.
- No decorative uppercase eyebrow.
- No gradient text, glass card, confetti, or AI-themed illustration.
- The main action is obvious within two seconds.
- The next question begins above the fold on a 375×667 screen.
- The context step feels calm despite being the densest step.
- The media crops remain strong at 1024 and 1440.
- Every transition has a reduced-motion equivalent.
- Keyboard focus is always visible.
- Empty/skipped answers never look like errors.
- The completion receipt contains facts, not evaluation.
- The first personalized prompt is editable and not auto-sent.
- Timed skip path is under 45 seconds and the representative useful path is about 3 minutes, never repeatedly over 4 minutes.

## 26. Definition of done

This feature is complete only when:

1. every question and mapping in §9 is implemented exactly;
2. the Watermelon component is installed from the supplied registry and adapted as specified;
3. new password and OAuth users enter onboarding correctly;
4. existing users are not forced through it;
5. deferral is respected across logins;
6. Profile data saves through the existing service/event path;
7. the agent sees saved data on the next turn without a duplicate context path;
8. no skipped field clears existing data;
9. settings writes cannot erase onboarding state;
10. completion produces a truthful receipt and editable AI handoff;
11. all required loading/error/retry/resume states work;
12. responsive, keyboard, screen-reader, contrast, zoom, and reduced-motion checks pass;
13. focused tests and the repository's routine checks pass;
14. final screenshots are reviewed at all required widths;
15. no critical/high code or design-review issue remains;
16. the finished plan is graduated from `plans/` to `specs/` only after shipping.

There are no unresolved product decisions in this plan. If implementation discovers a genuine schema or architecture conflict, stop and amend the plan explicitly rather than silently inventing a sixth step, a second data store, or a different visual system.
