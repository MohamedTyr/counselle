# ADR 0016 — API-first agent service with one versioned streaming event protocol

**Status:** Accepted

## Context
The initial release is the agent service — no full frontend. The future is a full platform (web/mobile apps, accounts, chat history) like ChatGPT/Claude/Gemini. The PRD ships a deliberately minimal dev harness for early iteration. Without a defined contract between the agent and whatever renders it, the platform phase would require invasive rework — the classic prototype-to-product debt.

## Decision
1. **The core deliverable is the Counselle agent service**: a Python service exposing a small versioned HTTP API (`/v1`). Everything user-facing is a **client** of that API. The minimal dev harness (`harness/`) was an explicitly throwaway tool, retired once `frontend/` reached parity — ADR 0020.
2. **One streaming event protocol** carries every conversation: SSE events, each `{v, type, data}` with types `meta`, `delta` (prose tokens with inline citation markers), `viz` (render spec), `clarify` (clarify spec; stream parks awaiting input), `sources`, `usage`, `done`, `error` (user-safe message + trace_id; never leaks internals).
   **Single-flight per session:** a second `POST /v1/sessions/{id}/messages` while a turn is already streaming returns `409` — one active stream per session (in-process lock for the single-replica deployment; multi-replica needs a DB advisory lock).
3. **Versioning:** `v` on every event, `/v1` on routes, version fields inside the render/clarify specs. Additive changes don't bump; breaking ones do; clients ignore unknown event types.
4. **Auth posture:** the request context carries an **optional principal** populated by middleware, so auth is additive without route or orchestration changes (see ADR 0021).

## Rationale
- The viz event, clarify event, and prose stream were already designed as out-of-band channels (ADRs 0013, 0014); this unifies them into one contract instead of three ad-hoc ones.
- A frontend-agnostic protocol is the cheapest possible insurance for the platform future: new clients are additions, not migrations.
- SSE over HTTP is the simplest streaming transport that works everywhere; the event shapes are transport-agnostic if WebSocket is ever needed.

## Alternatives considered
- **Agent as a library imported by a future app** — rejected: couples the platform to the agent's internals; no independent deployability.
- **Build the real frontend now** — rejected by the PRD (the agent is the product; UI is a later phase).
- **WebSocket-first** — rejected: bidirectional streaming isn't needed (clarify answers arrive as ordinary messages); SSE is simpler and HTTP-native.

## Consequences
- Every frontend consumes identical events — the platform started with a working, tested API; the React SPA (ADR 0020) consumed the same protocol unchanged.
- The protocol becomes a compatibility surface to maintain (mitigated by versioning + additive-only discipline).
- The API edge owns translating graph output → protocol events; the orchestrator never knows about HTTP.
