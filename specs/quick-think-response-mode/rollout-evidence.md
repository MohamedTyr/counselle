# Quick / Think Rollout Evidence

Date: 2026-07-23

This file records the close-out evidence for the graduated Quick/Think response
mode plan. The raw run outputs remain under gitignored `artifacts/`, per the
project artifact policy; this checked-in note points at the accepted evidence so
older failed comparison attempts are not mistaken for the final gate.

## Eval Comparison

The initial aggregate comparison under
`artifacts/quick-think-response-mode/20260722T2037Z-eval-compare/` and the first
targeted rerun under
`artifacts/quick-think-response-mode/20260722T2202Z-targeted-rerun/` were
superseded by per-case reruns after scorer and prompt hardening.

Accepted final evidence:

- `artifacts/quick-think-response-mode/20260723T054315Z-per-id-live-rerun/`
  contains one accepted passing Quick report and one accepted passing Think
  report for each of these six non-narration eval ids:
  - `routing-cross-school-sql`
  - `denominator-best-aid`
  - `routing-profile-identity`
  - `routing-current-deadline-web`
  - `composition-mixed-db-web`
  - `clarify-ambiguous-school`
- `artifacts/quick-think-response-mode/20260723T062536Z-narration-request-shaped-live-rerun/`
  is the final narration-specific rerun after the request/negation hardening;
  both Quick and Think `narration-tool-work` reports pass there.

Do not use the `narration-tool-work` subdirectories under
`20260723T054315Z-per-id-live-rerun/` as final evidence. Their names predate the
final scorer/runtime fixes, but their report headers show `passed: 0`; the
`20260723T062536Z-narration-request-shaped-live-rerun/` reports supersede them.

Each accepted case directory has `status.txt` with `pass` and a report markdown
whose header records the mode, resolved model, attempted count, and passed
count. The final accepted model mapping is:

- Quick: `google-vertex:gemini-3.5-flash`
- Think: `google-vertex:gemini-3.1-pro-preview`

## Clean Verification

Verified from a clean detached worktree at commit `fec2c1a`:

```bash
uv run ruff check app api domain config tests evals
# All checks passed.

uv run mypy .
# Success: no issues found in 235 source files

uv run pytest tests/domain/test_response_mode.py tests/app/test_model_selection.py tests/app/test_sessions.py tests/app/test_turns.py tests/app/test_run_turn.py tests/api/test_protocol.py tests/api/test_b4.py tests/api/test_routes_unit.py tests/evals/test_scorers.py -q
# 322 passed in 72.66s

uv run pytest -m "not live_llm and not live_search and not live_db"
# 1549 passed, 225 deselected in 23.10s

cd frontend
npm run typecheck
# tsc --noEmit passed

npm test -- --run src/api/chat/config.test.ts src/features/ai-composer/AiComposerRoute.test.tsx src/features/ai-chat/components/ChatComposer.test.tsx src/features/ai-chat/useChatSession.test.tsx src/features/ai-chat/useTurnEngine.test.tsx src/features/ai-chat/AiChatPage.test.tsx
# 6 files passed, 82 tests passed
```

The clean-worktree routine backend run loaded `.env` as a dotenv file rather
than exporting it into the shell environment; exporting those variables directly
changes `tests/scripts/test_dev.py`'s environment expectations and is not the
project's normal test shape.
