# ADR 0019 — Platform-ready sessions: Postgres-checkpointed from day one, user-nullable identity

**Status:** Accepted

## Context
MVP1 needs in-session working memory only (PRD). The platform phase adds persistent chats, user accounts, profiles, and long-term memory. The classic retrofit pain in chat products is bolting durable identity onto an in-memory prototype — a migration of meaning, not just of data.

## Decision
1. **Every conversation is a session with a durable `session_id` from day one.** In-session working memory *is* the LangGraph state for that session — one mechanism.
2. **State persists via LangGraph's own Postgres checkpointer** in Counselle's `counselle.*` schema (memory-backed checkpointer in tests — same seam, different adapter). Sessions and parked clarify interrupts survive restarts.
   **Implementation note (eng-review D3, search-verified):** the Python `AsyncPostgresSaver` has **no schema parameter** (open feature request, Mar 2026). Mechanism: append `?options=-csearch_path%3Dcounselle,public` to the checkpointer DSN so `.setup()` creates its tables in `counselle.*`, plus a **fail-fast startup assertion** that queries `information_schema.tables` and refuses to boot if any `checkpoint%` table exists outside the `counselle` schema.
3. **A thin `counselle.sessions` row** (session_id, created_at, **nullable `user_id`**, title, default source-config) fronts the checkpoint data. The platform phase adds `counselle.users` and starts populating `user_id` — purely additive.
4. **Counselle owns its schema and migration chain** (`migrations/`, over `counselle.*` only — never the pipeline's `public.*`/`raw.*`, which remain read-only per ADR 0012).
5. **Retention is a knob** (TTL/cleanup in Settings), defaulting to keep-everything until there's a reason not to.

## Rationale
- The checkpointer is the stack's native persistence seam (ADR 0017) — using it costs nothing extra now and *is* the platform's chat-history storage later; a bespoke session store would be a reinvented wheel.
- Postgres is already running; no new infrastructure.
- `user_id` nullable now means the platform lands as new rows + a foreign key, never a re-keying migration of existing meaning.
- Durable interrupts make clarifying questions robust across restarts for free.

## Alternatives considered
- **In-memory sessions for MVP1** — rejected: trades a trivial day-one choice for a guaranteed future migration; also loses parked clarifications on restart.
- **Building users/auth/profiles now** — rejected: deferred by the PRD; only the *shape* is prepared, not the feature.
- **A separate database for Counselle state** — rejected: new infrastructure with no current benefit; the schema boundary inside the existing Postgres is sufficient isolation.

## Consequences
- Counselle gains a migration tool and chain (yoyo-migrations, plain SQL, over `counselle.*` only) — a small permanent responsibility.
- The durability promise is enforced by a required regression test: a graph instance parks on a clarify interrupt, is disposed, and a **fresh** instance on the same DSN resumes the same `thread_id` and completes (eng-review D6).
- The pipeline DB hosts a second schema owned by a different service; the boundary is the schema name and role grants.
- `GET /v1/sessions/{id}` (transcript read) works from day one, which is the platform's chat-history read endpoint already.
