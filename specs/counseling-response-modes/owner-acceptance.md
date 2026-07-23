# Counseling response modes — owner acceptance checklist

Status: **pending owner sign-off**.

This checklist is the final human review gate for
`feat/counseling-response-modes`. The implementation, deterministic checks,
mocked browser QA, and focused live behavior eval cases are complete; the owner
still needs to review real interactions and explicitly accept or reject the
feature.

## Evidence already available

- Implementation branch: `feat/counseling-response-modes`.
- Latest verification/fix commit: `2ceba08 fix(counseling-modes): align mode menu styling`.
- Browser QA artifacts:
  `artifacts/counseling-response-modes/20260722T135009Z/`
  - `desktop-focused-default.png`
  - `desktop-mode-menu.png`
  - `desktop-deep-selected.png`
  - `mobile-375-deep-selected.png`
  - `mobile-specialized-skill-handoff.png`
  - `keyboard-reduced-motion-guided.png`
  - `qa-notes.md`
- Focused live behavior eval cases in `evals/questions.yaml`:
  - `response-mode-focused-direct`
  - `response-mode-deep-research-triangulates`
  - `response-mode-guided-counselor-converges`

## Owner review flow

Use the real local app, not component snapshots:

```bash
set -a
source /home/saifuddin/Projects/counselle/.env
set +a
./scripts/dev.py
```

Open the app and verify these interactions:

1. Start a new chat. Confirm **Focused Answer** is visible by default.
2. Open the mode menu. Confirm exactly three choices appear:
   **Focused Answer**, **Deep Research**, and **Guided Counselor**. Confirm
   the mode rows use the same compact one-line chrome and outer padding as the
   Sources menu.
3. Select each mode and confirm the closed composer label updates.
4. Use **More specialized skills...** to select a task skill; confirm the mode
   remains selected and the typed `@` skill behavior still works.
5. Send a Focused Answer question that could invite a long research tangent.
   Confirm it answers directly, cites factual claims, and avoids invented
   thresholds or unsupported numeric heuristics.
6. Send a Deep Research question requiring database evidence plus one current
   official-site fact. Confirm it triangulates material axes, separates CDS and
   official-site evidence, cites claims, and does not claim the deferred
   GPT-Researcher subsystem is running.
7. Send a Guided Counselor question. Confirm it gives useful guidance before
   asking at most one ordinary prose follow-up question, and no clarify widget
   or parked-turn behavior appears.
8. During an active response, try typing a normal steer. Confirm the running
   turn inherits its mode and does not raise a skill-selection error.
9. Regenerate an older response from a chat with a different historical mode.
   Confirm the selector rewinds to that historical branch's mode.
10. Refresh and switch between chats with different persisted modes. Confirm
    each chat displays its own latest persisted mode.
11. Inspect user messages in the transcript. Confirm specialized task skills
    can render as chips, but mode skills do not repeat as chips under every
    message.
12. Check desktop, 375px mobile, keyboard-only selection, and reduced-motion
    behavior for obvious clipping or broken focus.

## Acceptance decision

Owner should record one of:

- **Accepted** — feature can merge with owner sign-off complete.
- **Accepted with follow-ups** — feature can merge; follow-ups are tracked
  separately and are not blockers.
- **Rejected** — include concrete blocking issues to fix before merge.

Decision:

- [ ] Accepted
- [ ] Accepted with follow-ups
- [ ] Rejected

Owner notes:

```text
```
