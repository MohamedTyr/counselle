# TODOS

## Implement the session-TTL cleanup job
- **What:** a periodic task that enforces `settings.session_ttl_days` — delete expired rows from `counselle.sessions` and their checkpoint data (by `thread_id`) from the LangGraph checkpointer tables.
- **Why:** the Settings surface ships the knob (ADR 0019 names retention as configurable) but nothing executes it; with the keep-everything default this is harmless for months, but a knob connected to nothing is config-surface debt.
- **Pros:** config honesty; disk hygiene before it's ever a problem.
- **Cons:** touches the checkpointer's internal tables (small coupling to library internals — re-verify table names on library upgrades).
- **Context (start here):** lives next to the reconciler interval task in the API lifespan (`api/main.py`); the deletion is two statements inside one transaction; add a `cleanup: {last_run, deleted}` line to `/v1/health`.
- **Depends on / blocked by:** Phase 4 checkpointer landed (tables exist in `counselle.*` per eng-review D3).
- *(Logged from /plan-eng-review, 2026-06-10. Note: CI pipeline was proposed and explicitly declined by the user the same day.)*

## Community card viz type (deferred from MVP1)
- **What:** implement the `community_card` type in `RenderSpec` and the corresponding harness renderer for qualitative/Reddit content.
- **Why:** the architecture designed it (ARCHITECTURE §17) but it was not built in MVP1 — `RenderSpec.type` currently accepts only `stat_block | comparison_table | score_band`. Community/Reddit content falls back to prose narration in the delta stream.
- **Context:** see `domain/specs.py` (`RenderSpec`) and ARCHITECTURE §17. No honesty risk deferred — community content is never quantified anyway; this is a UX improvement only.
- *(Logged from Phase 7 Slice D docs audit, 2026-06-11.)*
