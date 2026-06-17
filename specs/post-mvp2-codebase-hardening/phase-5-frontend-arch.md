# Phase 5 — Frontend Architecture (de-god, untangle, dead code, ownership)

> **Execution:** follow the per-phase loop in `plans/audit/REMEDIATION-PLAN.md` §2
> (DISPATCH Opus implementers → GATE → ≥3 Sonnet reviewers, completeness-weighted →
> FIX → RE-REVIEW until unanimous SHIP → COMMIT). Implement **EVERYTHING** below;
> miss nothing. **This phase is almost entirely behavior-preserving** — it is
> extraction, file moves, dead-code deletion, one state-ownership change, one
> context collapse, and one documentation decision. The only finding that changes
> runtime data flow is FE-SOURCECFG-DUAL (and it changes *where* the truth lives,
> not what the student sees). Everything else MUST be a pure refactor. **Prove it
> with the existing tests staying green + a behavior diff** (reviewers diff the
> streaming/identity behavior, not just the line count).
>
> **READ THE REAL CODE.** Every snippet below was checked against the tree on
> 2026-06-16, but line numbers drift. The shapes are the contract; the line
> numbers are hints.

---

## Scope & files touched

**The single highest-risk file in the entire remediation plan is
`src/app/ChatContext.tsx`.** It owns streaming, identity reconciliation, cancel
concurrency, and optimistic echoes. The split (FE-CHATCONTEXT-GOD +
FE-CONSUMESTREAM-SIZE) is **pure extraction with zero behavior change**. See the
cross-phase note: **Phase 4's FE-correctness tests MUST already be landed and
green before this phase begins** — they are the safety net that proves the
extraction didn't regress streaming/identity/cancel.

Files created:
- `frontend/src/api/projectTranscript.ts` — pure transcript→ChatMessage projection helpers (no React).
- `frontend/src/app/useTurnEngine.ts` — the stream-loop + turn-lifecycle hook extracted from `ChatContext`.
- `frontend/src/api/streamReconcile.ts` — pure `consumeStream` helpers (`reconcileMetaIds`, `persistTerminalTurn`, `persistErroredTurn`).
- `frontend/src/api/sourceConfigStore.ts` — the **moved** real source-config store (was `api/mock/sourceStore.ts`).
- `frontend/src/lib/logger.ts` — the tiny logger seam (FE-CONSOLE-WARN).

Files moved/renamed:
- `src/api/mock/sourceStore.ts` → `src/api/sourceConfigStore.ts` (FE-MOCK-MISLABEL).

Files deleted:
- `src/api/mock/feedbackStore.ts` (FE-DEADCODE-MOCK — 0 references).
- `src/api/mock/authStore.ts` (FE-DEADCODE-MOCK — 0 production importers).
- `src/vendor/librechat/app/components/Chat/Input/ChatForm.tsx` (FE-DEAD-CHATFORM).
- `src/app/AppShell.tsx` (FE-DEAD-APPSHELL).
- `src/components/citations/RevealDbContext.tsx` (FE-CITATIONS-CONTEXT-SPRAWL — collapsed into RevealStateContext).

Files modified (importers / consumers):
- `src/app/ChatContext.tsx` (de-godded — composes the new hook + helpers).
- `src/api/source-config.ts`, `src/api/hooks.ts`, `src/app/settingsSync.ts`,
  `src/components/composer/ChatComposer.tsx`, `src/components/composer/SourcesControl.tsx`,
  `src/components/composer/CounselleComposer.tsx`, `src/components/composer/index.ts`,
  `src/components/source-control/SourceDropdown.tsx`, `src/components/source-control/DefaultSources.tsx`,
  and the two test files (`composer/__tests__/keyboard.test.tsx`,
  `composer/__tests__/source-bridge.test.ts`) — all the `mock/sourceStore` importers.
- `src/api/mock/store.ts`, `src/api/mock/messagesStore.ts` (dead exports trimmed).
- `src/components/citations/DbClaim.tsx`, `MessagePreview.tsx`,
  `vendor/.../Content/MessageContent.tsx`, the dbClaim test (RevealDb collapse).
- `src/app/useQuestionAnchoredScroll.ts` (throttle→useMemo).
- `src/api/http/sse.ts`, plus the ChatContext warn site (logger seam).
- `src/vendor/librechat/UPSTREAM.md` (FE-COUPLING ownership note).

**Out of scope (explicit, do NOT do):**
- No re-vendor / upstream resync of LibreChat (master §5).
- No wire-protocol change.
- No new product behavior.
- FE-SSE-NOSCHEMA is owned by **Phase 4** (per the matrix) — do not implement it here.
- The favicon/timeouts/config knobs are **Phase 6**. The throttle constant
  `SCROLL_HANDLER_THROTTLE_MS` stays a local constant (it is not a config knob).

---

## Gate commands (for this phase)

```bash
cd frontend && npm run typecheck && npm test && npm run build
```

All three MUST be green before review. `npm test` must show **zero** skipped/renamed
tests beyond the deliberate file moves below. The full backend gate is unaffected by
this phase but run it once before the phase commit per §2.4.

---

## Findings & fixes

Order: HIGH → MEDIUM → LOW.

---

### FE-MOCK-MISLABEL — real production source-config store lives under `api/mock/`  [HIGH]

- **Files:** `src/api/mock/sourceStore.ts` (move target); importers:
  `src/api/source-config.ts:12`, `src/api/hooks.ts:18`, `src/app/settingsSync.ts:22-25`,
  `src/app/ChatContext.tsx:34`, `src/components/composer/ChatComposer.tsx:23-27`,
  `src/components/composer/SourcesControl.tsx:14,23`,
  `src/components/composer/CounselleComposer.tsx:18`,
  `src/components/composer/index.ts:12`,
  `src/components/source-control/SourceDropdown.tsx:20`,
  `src/components/source-control/DefaultSources.tsx:13`,
  `src/components/composer/__tests__/keyboard.test.tsx:14`,
  `src/components/composer/__tests__/source-bridge.test.ts:17`.

- **Problem:** `sourceStore.ts` is **live production state** — `getSourceConfig`,
  `updateSourceConfig`, `getDefaultSourceConfig`, `setDefaultSourceConfig`, the
  `SourceConfig`/`Subreddit` types, and the `SUBREDDITS` constant are imported by
  the **real HTTP path** (`api/hooks.ts`, `source-config.ts`, `settingsSync.ts`,
  `ChatContext`). The transport switch (`selectTransport.ts`) defaults to `http`,
  so `mock/` is *not* the production path — yet the most important client-pref
  store sits inside it. Anyone who "deletes the mock folder" breaks the live app.
  The file header even lies: "FE-7 replaces this with the real backend."

- **Fix:**
  1. **Move the file verbatim** (content unchanged) from
     `src/api/mock/sourceStore.ts` to `src/api/sourceConfigStore.ts`. Use
     `git mv` so history is preserved.
  2. Update its header comment — strip the "FE-7 replaces this / mock" framing.
     New header:
     ```ts
     /**
      * Source-config client store — the per-conversation source toggles
      * (database always-on; web/edu/reddit; subreddit selection) and the
      * user's DEFAULT config for new chats (Settings → General).
      *
      * This is PRODUCTION client state, not a mock. localStorage is the LOCAL
      * cache / default surface; the server is the source of truth per session
      * (see source-config.ts toWire/fromWire and ChatContext's transcript seed).
      */
     ```
     (Phase 6 owns CFG-09-style externalisation of the `SUBREDDITS` menu; do not
     move that constant out of this file here — just keep it.)
  3. **Update every importer's path.** Before/after, one identical mechanical
     change per site:
     - `from '@/api/mock/sourceStore'` → `from '@/api/sourceConfigStore'`
     - `from './mock/sourceStore'` (in `source-config.ts`, `hooks.ts`) →
       `from './sourceConfigStore'`
     Concretely:
     - `source-config.ts:12`: `import { SUBREDDITS, type SourceConfig, type Subreddit } from './sourceConfigStore';`
     - `hooks.ts:18`: `import { setDefaultSourceConfig } from './sourceConfigStore';`
     - `settingsSync.ts:22-25`: `} from '@/api/sourceConfigStore';`
     - `ChatContext.tsx:34`: `import { getSourceConfig, updateSourceConfig } from '@/api/sourceConfigStore';`
       (this import may be *removed entirely* by FE-SOURCECFG-DUAL below — coordinate;
       if FE-SOURCECFG-DUAL lands in the same pass, ChatContext no longer imports
       the store at all.)
     - `ChatComposer.tsx:23-27`, `SourcesControl.tsx:23`, `CounselleComposer.tsx:18`,
       `index.ts:12`, `SourceDropdown.tsx:20`, `DefaultSources.tsx:13`,
       both test files: same path swap.
     - `SourcesControl.tsx:14` is a **comment** referencing `@/api/mock/sourceStore` —
       update the comment text too.
  4. Grep-confirm zero stragglers (see acceptance).
  5. Leave `mock/` containing only `transport.ts` (MockTransport), `store.ts`,
     `messagesStore.ts`, and `fixtures/` — the genuine contract-test scaffolding.

- **Tests to add/keep-green:** the two composer tests import from the new path and
  must still pass unchanged. No new test — this is a move.

- **Acceptance criteria:**
  - [ ] `git mv src/api/mock/sourceStore.ts src/api/sourceConfigStore.ts` done; file content otherwise unchanged except the header.
  - [ ] `grep -rn "mock/sourceStore" frontend/src` returns **zero** hits.
  - [ ] `npm run typecheck` green; both composer tests green.
  - [ ] `mock/` no longer contains any module imported by a non-`mock/` non-test production file (verify with the FE-DEADCODE grep below).

---

### FE-CHATCONTEXT-GOD — 985-line provider owning 5 concerns  [HIGH]

- **Files:** `src/app/ChatContext.tsx` (entire file). House rules: <800 lines/file,
  <50 lines/function. New files: `src/api/projectTranscript.ts`,
  `src/app/useTurnEngine.ts`, `src/api/streamReconcile.ts`.

- **Problem:** One provider owns five independent concerns in 985 lines:
  (1) transcript projection helpers (`messagesFromTranscript`, `assistantMessage`,
  `userMessage`, the `ChatMessage` type — ~lines 56-267); (2) the stream loop
  (`consumeStream`, ~lines 367-491, itself 125 lines); (3) send/edit/regenerate/
  retry orchestration (`startSend`, `runTurn`, `submitMessage`, `ask`,
  `regenerate`, `retryLastSend`, `attachTurn`); (4) cancel/send-mid-stream
  concurrency (`cancelAndAwaitClear`, `stopGenerating`, 5 refs:
  `cancelledRef`, `cancelInFlightRef`, `isMountedRef`, `freshSessionsRef`,
  plus `turnRef`/`persistedRef`/`conversationIdRef`); (5) transcript-load error
  handling (`loadTranscript`, `transcriptError`, `retryTranscript`). The exported
  value has 20 fields; every consumer re-renders on any of them.

- **Fix — EXACT module boundaries.** This is **extraction only**. Move code; do not
  rewrite logic. Three new modules + a thinner provider.

  **(A) `src/api/projectTranscript.ts` — pure, no React.**
  Move out of ChatContext, verbatim:
  - the `ChatMessage` type (export it from here; `ChatContext` re-exports it so the
    30 vendor importers of `@/app/ChatContext`'s `ChatMessage` are untouched — keep
    `export type { ChatMessage } from '@/api/projectTranscript';` in ChatContext, OR
    keep the type in ChatContext and import it into projectTranscript. **Prefer:
    define `ChatMessage` in `projectTranscript.ts`, re-export from ChatContext** so
    the public symbol path `@/app/ChatContext` → `ChatMessage` is preserved exactly).
  - `messagesFromTranscript(conversationId, entries)` → ChatMessage[]
  - `assistantMessage(conversationId, messageId, parentMessageId, state, ts)` → ChatMessage
  - `userMessage(conversationId, messageId, parentMessageId, text, ts)` → ChatMessage
  - the `THINKING_LABEL` constant.
  These import only from `@/api/turn-reducer` and `@/api/protocol` — already
  React-free. Exports: `ChatMessage`, `messagesFromTranscript`, `assistantMessage`,
  `userMessage`. (FE-TYPE-DERIVED-STORED, a LOW below, also touches
  `assistantMessage` — apply that fix here in the same move.)

  **(B) `src/api/streamReconcile.ts` — pure `consumeStream` helpers.**
  Extract three pure functions taking explicit state (this is FE-CONSUMESTREAM-SIZE):
  - `reconcileMetaIds(prev: ChatMessage[], prevUserId: string, backendUserId: string): { next: ChatMessage[]; matched: boolean }`
    — the `prev.map` swap currently inlined at ChatContext.tsx:403-421. Returns the
    new array + whether the temp id was found (the caller logs the warn — keep the
    honesty warn, routed through the logger seam per FE-CONSOLE-WARN).
  - `persistTerminalTurn(convoId, assistantMessageId, userMessageId, hasBackendId, state): ChatMessage`
    — wraps the `assistantMessage(...)` + `done.hasBackendId = hasBackendId`
    construction at ChatContext.tsx:449-456.
  - `persistErroredTurn(convoId, assistantMessageId, userMessageId, hasBackendId, state, message): ChatMessage`
    — wraps the errored-state construction at ChatContext.tsx:467-479 (build the
    `{ ...state, status: 'error', error: ... }` and the card).
  All three import `assistantMessage` from `projectTranscript.ts` and types from
  `turn-reducer`/`protocol`. No React, no setState — they return values; the hook
  calls `setPersisted` with the result.

  **(C) `src/app/useTurnEngine.ts` — the stream loop + turn lifecycle hook.**
  This is the heart of the extraction. Move into a hook
  `useTurnEngine(deps)` everything that drives a turn:
  - state: `turn` (LiveTurn|null), `turnError`, `pendingText`
  - refs: `turnRef`, `cancelledRef`, `cancelInFlightRef`, `isMountedRef`
  - the `LiveTurn` type
  - `consumeStream` (now thin — uses the (B) helpers; target < 60 lines, ideally
    the loop body itself < 50)
  - `runTurn`, `attachTurn`, `cancelAndAwaitClear`, `submitMessage`, `startSend`,
    `retryLastSend`, `ask`, `regenerate`, `stopGenerating`
  - the `turnErrorOf` error mapper (move with it; or keep in a shared
    `api/errorMessages.ts` — either is fine, but keep it out of the provider body).

  The hook needs collaborators it does NOT own (they stay in the provider and are
  passed in): `persisted`/`setPersisted`, `persistedRef`, `conversationId`/
  `setConversationId`, `conversationIdRef`, `freshSessionsRef`, `loadTranscript`,
  `navigate`, `queryClient`, and (post FE-SOURCECFG-DUAL) the source-config getter.
  Define a typed `UseTurnEngineDeps` interface for these. The hook returns:
  `{ turn, isSubmitting, turnError, submitMessage, ask, regenerate, stopGenerating,
  retryLastSend, attachTurn, runTurn }`.

  **DO NOT change any logic during the move:** the honesty guard (the
  ended-without-terminal-done throw, ChatContext.tsx:440-445), the meta-seen vs
  pre-meta catch split, the `cancelAndAwaitClear` 5s poll + 50ms tick, the
  `setTurn(null)` in `finally`, the 409 cancel-then-retry-once, the temp-echo
  drop in `retryLastSend` — all move byte-for-byte. The refs move with the hook;
  `isMountedRef`'s mount/unmount effect moves into the hook.

  **(D) `ChatContext.tsx` (the slimmed provider) keeps:**
  - the `activeConversationIdAtom` binding, `persisted`/`setPersisted`,
    `persistedRef`, `conversationIdRef`, `freshSessionsRef`, `transcriptError`.
  - `loadTranscript`, `retryTranscript`, `newConversation`, `abortScroll`/
    `setAbortScroll`.
  - the conversation-change effect (transcript-then-attach) — it calls
    `engine.attachTurn`.
  - the `messages` projection memo (persisted + live, the dedupe at line 885) and
    `awaitingClarify` — these read `engine.turn`.
  - it calls `const engine = useTurnEngine({...})` and assembles the context value.
  Target: ChatContext.tsx well under 800 lines (it should land ~250-350).

  **(E) Split the context value into stable-callbacks vs changing-data.**
  Currently one 20-field value re-evaluates on every data change. Create two
  contexts in `ChatContext.tsx`:
  - `ChatActionsContext` — the stable callbacks:
    `submitMessage, ask, regenerate, stopGenerating, newConversation,
    retryLastSend, retryTranscript, setAbortScroll`. Its memo deps are only the
    callback identities (all already `useCallback`-stable), so it changes ~never.
  - `ChatDataContext` — the changing data:
    `conversationId, isSubmitting, messages, latestMessage, latestMessageId,
    turnError, transcriptError, awaitingClarify, abortScroll`.
  Keep the **public hook `useChatContext()` returning the merged 20-field shape**
  by reading both contexts and spreading — so **no consumer changes** (the 15 call
  sites and 30 vendor importers are untouched). The re-render win comes from
  internally consuming the narrow context where it matters later; for THIS phase
  the only requirement is that the two providers exist and `useChatContext`
  composes them. (Splitting individual consumers onto the narrow hooks is a
  follow-up; do not chase it here — that would touch vendored files and risks
  ballooning. Keeping `useChatContext` identical is the behavior-preserving move.)

  > **If the two-context split adds risk under time pressure:** the
  > minimum-acceptable version of (E) is to keep one context but ensure the value
  > memo is correct (FE-PROVIDER-VALUE-MEMO-DEP). The module extraction (A/B/C/D)
  > is the non-negotiable core of this finding; (E) is the re-render improvement.
  > A reviewer must see (A)-(D) fully done; (E) may be the merged-hook form above.

- **Tests to add/keep-green:**
  - All existing ChatContext / streaming / identity tests must pass **unchanged**
    (they are the behavior-diff proof). If any test imports `assistantMessage` /
    `messagesFromTranscript` from `@/app/ChatContext`, re-export those from
    ChatContext so the test import path still resolves — OR update the test import
    to `@/api/projectTranscript` (prefer the re-export to minimise diff).
  - Add a focused unit test `src/api/__tests__/streamReconcile.test.ts` for the
    three pure helpers (matched/unmatched id swap; terminal card fields;
    errored card status+error). These are now trivially testable in isolation —
    that testability is the point of the finding.
  - Add `src/api/__tests__/projectTranscript.test.ts` if no equivalent coverage
    exists for `messagesFromTranscript` (user/assistant/synthesized/feedback/
    clarifyAnswer mapping).

- **Acceptance criteria:**
  - [ ] `projectTranscript.ts`, `streamReconcile.ts`, `useTurnEngine.ts` exist with the exported symbols above.
  - [ ] `ChatContext.tsx` is < 800 lines; `consumeStream`'s loop body is < 50 lines.
  - [ ] `ChatMessage` is still importable from `@/app/ChatContext` (re-export preserved).
  - [ ] `useChatContext()` returns the identical 20-field shape (no consumer edited).
  - [ ] (E) is satisfied by EITHER path: the two-context split exists, OR the
        merged-hook fallback with a correct value memo (FE-PROVIDER-VALUE-MEMO-DEP)
        is in place. The commit body MUST state which path was taken (two-context
        split vs merged-hook fallback) so reviewers apply the correct criterion.
  - [ ] Every pre-existing FE test green; new streamReconcile/projectTranscript tests green.
  - [ ] Behavior diff: send, edit (replace), regenerate, cancel-mid-stream, attach-on-reload, transcript-load-error, and the connection-lost honesty guard all behave identically (reviewer walks each path against the live app or the existing tests).

---

### FE-CONSUMESTREAM-SIZE — 125-line `consumeStream`  [MEDIUM]

- **Files:** `src/app/ChatContext.tsx:367-491` (moves to `useTurnEngine.ts`); helpers
  to `src/api/streamReconcile.ts`.
- **Problem:** one `useCallback` body does temp-id minting, the `for await` loop,
  inline meta-id reconciliation (`setPersisted` map), per-event `setTurn`, the
  truncated-stream honesty guard, terminal persistence + query invalidation, and a
  two-branch catch (pre-meta vs post-meta). 125 lines, many `let` reassignments.
- **Fix:** this is the same extraction as FE-CHATCONTEXT-GOD step (B)+(C). After
  extracting `reconcileMetaIds` / `persistTerminalTurn` / `persistErroredTurn`,
  `consumeStream` becomes: mint temp id → set initial turn → `for await` loop that
  on `meta` calls `setPersisted(prev => { const {next, matched} = reconcileMetaIds(...); if (!matched) logger.warn(...); return next; })` and `reduce`+`setTurn`; on
  clean exit either throw the honesty error or `setPersisted(prev => [...prev, persistTerminalTurn(...)])` + invalidate; catch routes via `persistErroredTurn`
  (meta-seen) or re-throw (pre-meta); `finally setTurn(null)`. The loop is thin;
  the branchy logic lives in tested pure helpers.
- **Tests to add/keep-green:** the `streamReconcile.test.ts` from the prior finding
  covers the helpers; the existing streaming tests cover the thin loop end-to-end.
- **Acceptance criteria:**
  - [ ] `reconcileMetaIds`, `persistTerminalTurn`, `persistErroredTurn` exist as pure functions in `streamReconcile.ts`, each < 50 lines, each unit-tested.
  - [ ] `consumeStream`'s body is < 50 lines and contains no inline id-swap map or inline card construction.
  - [ ] The honesty guard and the pre-meta/post-meta catch split are byte-equivalent in behavior.

---

### FE-SOURCECFG-DUAL — source config duplicated across server + localStorage + component state  [MEDIUM]

- **Files:** `src/api/sourceConfigStore.ts` (post-move), `src/app/ChatContext.tsx:336-340`
  (the `updateSourceConfig` re-seed on transcript load), `src/components/composer/ChatComposer.tsx:103-122`
  (local `useState` copy + two re-read effects: `useEffect` on `conversationId` and
  `handleSourcesReread`), `runTurn`'s `getSourceConfig(convoId)` at ChatContext.tsx:506.
- **Problem:** the same truth lives in three places kept in sync by imperative
  effects. The backend persists source config per session (`transcript()` returns
  `source_config`; every `sendMessage` re-sends `toWire(getSourceConfig(...))`). The
  FE also stores it in localStorage **and** mirrors it into a `ChatComposer`
  `useState`, re-read on conversation change and "when the dropdown opens"
  (`handleSourcesReread`). ChatContext's transcript-load effect overwrites
  localStorage from server truth (the comment admits "server truth wins over
  localStorage" — i.e. localStorage is a stale shadow corrected on each load). The
  popover-open re-read is a workaround for not having a single reactive source.
- **Fix — server (React Query) is the single source of truth for per-session config;
  localStorage is demoted to *default-for-new-chats only*.** Keep the scope tight:
  1. **Stop re-reading via effects.** The per-conversation source config the
     composer renders comes from the **transcript query** (the same data
     `loadTranscript` already fetches — `source_config`). Expose it reactively:
     - Add a React Query query keyed by session that returns the session's
       `source_config` (or surface it from the existing transcript fetch). The
       cleanest minimal move: have `loadTranscript` write the fetched `sourceConfig`
       into the query cache under a new key `['sourceConfig', sessionId]`, and have
       `ChatComposer` read it with `useQuery(['sourceConfig', conversationId], ...)`
       seeded from cache (no network of its own — `enabled:false`/cache-only, or a
       `queryFn` that returns the cached value). The composer's local `useState` +
       both re-read effects are **deleted**; `config` becomes the query data
       (falling back to `getDefaultSourceConfig()` when null/new chat).
     - The toggle handler (`handleSourcesChange`) becomes a mutation that
       `setQueryData(['sourceConfig', convoId], next)` optimistically **and** the
       value is sent on the next `sendMessage` (the backend upserts per send — that
       is the existing persistence path; no new POST endpoint is required, matching
       the current behavior). Drop `handleSourcesReread` (defined in
       `ChatComposer.tsx:120`) and the `onSourcesReread` prop entirely (its plumbing
       lives in `ChatComposer.tsx` → `CounselleComposer.tsx` only — `CounselleComposer`
       declares the prop at line 49 and fires it on popover open at line 248; grep
       `onSourcesReread` to confirm those two files are the *only* sites and remove
       the now-dead prop from both). **Note:** `SourceDropdown.tsx` does NOT have an
       `onSourcesReread` prop — it owns its own internal `useState`+`useEffect`
       popover-open re-read, and it is not on this composer's read path. Do not look
       for `onSourcesReread` in `SourceDropdown.tsx`; see its separate disposition
       under FE-DEAD-CHATFORM (it becomes dead once `ChatForm.tsx` is deleted).
  2. **localStorage stays only for the new-chat default** (`getDefaultSourceConfig`/
     `setDefaultSourceConfig` + the per-conversation keys become unnecessary for the
     reactive read path). Keep the *default* (Settings → General) localStorage path
     exactly as-is (it is a legitimate client pref, and `settingsSync.ts` already
     persists it to the server). Remove `getSourceConfig(convoId)`/
     `updateSourceConfig(convoId,...)` *per-conversation localStorage* usage from
     the composer/ChatContext read path; `runTurn` reads the config from the query
     cache (the reactive source) instead of `getSourceConfig(convoId)`.
  3. Remove the `updateSourceConfig(convoId, fromWire(sourceConfig))` localStorage
     write in `loadTranscript` (ChatContext.tsx:337-339) — replace it with the
     `setQueryData(['sourceConfig', convoId], fromWire(sourceConfig))` write.
  4. **Behavior must not change for the student:** toggling a source still affects
     the next send; the dropdown still reflects the session's config; opening a chat
     still shows server truth. Only the *mechanism* (reactive query vs imperative
     re-read) changes.

  > **Scope guard:** if wiring a dedicated `['sourceConfig', sessionId]` query is
  > more churn than the time allows, the acceptable minimum is: (a) delete the
  > composer's `handleSourcesReread` + the popover-open re-read (the workaround),
  > and (b) make the composer read from a single reactive source on conversation
  > change. Do NOT add a brand-new POST/source-config endpoint — the per-send
  > upsert is the existing, correct persistence path. Keep it.

- **⚠️ SHARED-FILE cross-phase note (Phase 5 ↔ Phase 4 — `CounselleComposer.tsx`):**
  `CounselleComposer.tsx` is touched by **both** phases — Phase 4 (FE-M3: hide the
  dead upload/voice affordances behind `IMAGE_UPLOAD_ENABLED`/`VOICE_ENABLED`; FE-L8:
  single-file-preview cleanup) and Phase 5 here (FE-SOURCECFG-DUAL: remove the
  `handleSourcesReread`/`onSourcesReread` plumbing). The `onSourcesReread` plumbing
  spans only `ChatComposer.tsx` (defines `handleSourcesReread`, passes the prop) and
  `CounselleComposer.tsx` (declares + fires the prop). `SourceDropdown.tsx` is **not**
  part of this plumbing — it has no `onSourcesReread` prop (it owns its own internal
  re-read) and is dead-after-FE-DEAD-CHATFORM (see its disposition there). **Phase 4
  lands first** (its FE-correctness tests are this phase's safety net), so the
  FE-M3/FE-L8 gating is the baseline you inherit. **This phase MUST read the current,
  post-Phase-4 state of `CounselleComposer.tsx` before editing and merge cleanly —
  remove ONLY the `handleSourcesReread`/`onSourcesReread` source-reread plumbing; do
  NOT revert FE-M3's upload/voice gating or FE-L8's preview cleanup.** This file
  appears in the "shared files" check in the phase completion checklist below.

- **Tests to add/keep-green:** the `source-bridge.test.ts` / `keyboard.test.ts`
  composer tests must stay green (adjust their setup to seed the query cache instead
  of localStorage if they relied on `getSourceConfig`). Add a test that a toggle is
  reflected on the next `sendMessage` body's `source_config` and that opening a
  conversation shows the server config without a manual re-read.
- **Acceptance criteria:**
  - [ ] `ChatComposer` has no `useState<SourceConfig>` mirror and no `useEffect` that re-reads source config; `handleSourcesReread` (ChatComposer) and the `onSourcesReread` prop (ChatComposer → CounselleComposer) are deleted from **those two files only** — `grep -rn "onSourcesReread\|handleSourcesReread" frontend/src` returns nothing. (SourceDropdown.tsx never had the prop; it is handled by FE-DEAD-CHATFORM.)
  - [ ] The per-conversation source config the composer renders comes from a single reactive source (React Query cache keyed by session), seeded from the transcript fetch — OR the scope-guard minimum was taken (`handleSourcesReread` + popover-open re-read deleted, composer reads from a single reactive source on conversation change) and the commit body states so.
  - [ ] localStorage is used only for the new-chat **default** (Settings → General), not as the per-conversation read path.
  - [ ] Toggling a source still changes the next send; opening a chat still shows server truth — verified by test + behavior diff.
  - [ ] No new source-config write endpoint added (per-send upsert retained).

---

### FE-COUPLING — the "vendored" LibreChat tree is a hard fork (30 files import `@/…`)  [HIGH]

- **Files:** `src/vendor/` — **30** files import `@/…` Counselle code (verified
  2026-06-16). The `@/` symbols, by frequency: `@/app/ChatContext` (15),
  `@/app/state` (8), `@/api/hooks` (7), `@/app/auth` (6), `@/api/http/auth` (6),
  then single-import wires to citation/timeline/clarify/composer components.
  `UPSTREAM.md` and the per-file "pinned 197a1dc4" headers imply a cheap upgrade
  path that does not exist.

- **Problem:** the mental model "vendored = pristine upstream we can resync" is
  **false** — re-pulling upstream would require re-applying ~30 hand edits. This is
  a documentation/ownership lie, not a runtime bug. The master plan (§5) forbids a
  re-vendor; the fix is a **DECISION + documentation**, with a tightly-scoped
  targeted decouple of the few worst offenders. **This must NOT balloon into a
  re-vendor or a tree-wide refactor.**

- **Fix — RECOMMENDED: (a) document-the-fork for the whole tree + (b) targeted
  decouple of the worst offenders.**

  **(a) Ownership documentation (the whole tree).** Edit
  `src/vendor/librechat/UPSTREAM.md`. Replace the "Re-syncs are deliberate tasks
  against this commit" framing with the honest ownership statement below, and add a
  new section listing the `@/`-coupled files so the cost is acknowledged, not
  hidden. **Exact text to insert** (adapt surrounding prose to fit the existing
  document, but the substance is required):

  ```markdown
  ## Ownership status (FORK, not a re-pullable mirror)

  This tree began as a verbatim vendoring of danny-avila/LibreChat at
  `197a1dc4` (MIT). It is **no longer a clean mirror** — it is an **adapted,
  owned fork**. 30 files under `vendor/` import Counselle code (`@/...`) and
  carry hand-written `Subtractions / rewires` headers. A wholesale upstream
  re-pull is therefore NOT a cheap operation and is explicitly out of scope:
  re-syncing would require re-applying every rewire below by hand.

  Treat these files as **Counselle-owned code that happens to descend from
  LibreChat**: review them, test them, and refactor them like our own. The
  `197a1dc4` pin records provenance and the MIT license obligation — it is not a
  promise of upgradeability. If a future upstream feature is wanted, cherry-pick
  that file deliberately; do not attempt a tree-wide resync.

  ### Files coupled to Counselle code (`@/...` imports)

  <the 30-file list, generated by:
   grep -rln "from '@/" src/vendor --include=*.ts --include=*.tsx >
  ```

  Paste the actual 30-file list (run the grep at implementation time; it is the
  authoritative source). Group by the `@/` symbol they depend on
  (ChatContext / state / hooks / auth / citations) so the coupling surface is legible.

  **(b) Targeted decouple — ONLY the worst structural offender.** The single edit
  that most reduces the "bespoke logic inside a third-party tree" smell is
  `src/vendor/librechat/app/common/index.ts`, which `import type { ChatMessage,
  AskProps } from '@/app/ChatContext'` and redefines `TMessageProps` etc. around
  Counselle's types. Leave the runtime component wiring (Message/MessagesView/
  MessageRender/useMessageActions consuming `useChatContext`) **as-is** — inverting
  those is real work and risks regressions in the render path Phase 4 just
  stabilised. For `common/index.ts`, the *type* coupling is the cheap, safe win:
  - Since `ChatMessage` moves to `@/api/projectTranscript` in this phase anyway,
    point `common/index.ts`'s type import at the pure module
    (`@/api/projectTranscript`) rather than the provider (`@/app/ChatContext`).
    This is a one-line import-path change that removes a *provider* dependency from
    a vendored types file, leaving it depending only on a pure type module.
  - **Do nothing else** to the vendored tree's runtime wiring in this phase.

  > **Why not full (b) inversion?** Inverting all 30 files to prop-driven leaves
  > is the "more defensible boundary but real work" option from the audit. The
  > risk register (master §4) flags exactly this as the balloon risk. We
  > deliberately choose (a) for the tree + the one type-only decouple in (b).
  > Reviewers should reject any attempt to prop-drive Message/MessageRender/etc.
  > in this phase.

- **Tests to add/keep-green:** none new (doc + one import-path change). Typecheck
  must stay green after the `common/index.ts` import repoint.
- **Acceptance criteria:**
  - [ ] `UPSTREAM.md` contains the "Ownership status (FORK …)" section and the actual 30-file coupled list (generated from the grep at implement time).
  - [ ] `common/index.ts` imports `ChatMessage`/`AskProps` types from `@/api/projectTranscript` (the pure module), not from `@/app/ChatContext`.
  - [ ] No vendored runtime component was prop-rewired in this phase (scope held).
  - [ ] Typecheck green.

---

### FE-DEADCODE-MOCK — dead `mock/` modules and exports  [MEDIUM]

- **Files:** `src/api/mock/feedbackStore.ts` (whole, dead); `src/api/mock/authStore.ts`
  (whole, dead); unused exports in `src/api/mock/store.ts` and
  `src/api/mock/messagesStore.ts`.
- **Problem:** `feedbackStore.ts` has **0 code references** (only a doc mention in
  `UPSTREAM.md:220`). `authStore.ts` also has **0 production importers** — the real
  auth path is `src/app/auth.ts` (which mentions `authStore.ts` only in a docstring as
  the superseded FE-5A mock); the remaining `authStore` hits are doc prose in
  `UPSTREAM.md` and historical "Rewire" comments in vendored `Account.tsx`/`Login.tsx`.
  In `store.ts`, only `createChat` is used (by `mock/transport.ts`);
  `listChats`, `getChat`, `renameChat`, `deleteChat`, `clearAllChats` have 0
  callers. In `messagesStore.ts`, only `getTranscript` is used (by `mock/transport.ts`);
  `appendEntry`, `truncateFrom`, `updateEntryText`, `deleteTranscript`,
  `clearAllTranscripts` have 0 callers.
- **Fix — delete after grep-confirming zero references.** We KEEP `MockTransport`
  and the minimal store it needs (the contract harness selected by
  `VITE_TRANSPORT=mock` is wanted — state this in the deletion commit).
  1. **`feedbackStore.ts`** — confirm dead, then delete the file:
     ```bash
     grep -rn "feedbackStore" frontend/src --include=*.ts --include=*.tsx
     # expect: zero hits in src/*.ts(x) (the only legit hit is UPSTREAM.md prose)
     ```
     Delete the file and remove its row from `UPSTREAM.md:220`.
  1b. **`authStore.ts`** — confirm dead, then delete the file:
     ```bash
     grep -rn "authStore" frontend/src --include=*.ts --include=*.tsx
     # expect: zero *importers* — only doc prose (UPSTREAM.md), the auth.ts docstring
     # mention, and the "Rewire" comments in vendored Account.tsx/Login.tsx.
     ```
     If the grep finds a live `import` of `authStore`, do NOT delete it — report the
     importer instead. Otherwise delete the file and remove its rows from
     `UPSTREAM.md` (the `src/api/mock/authStore.ts` lines). The stale `auth.ts`
     docstring + the vendored `Account.tsx`/`Login.tsx` comments are prose only — leave
     them or tidy them, but they are not blockers.
  2. **`store.ts`** — confirm each export's callers, then delete the unused five
     (`listChats`, `getChat`, `renameChat`, `deleteChat`, `clearAllChats`), keeping
     `createChat` + its internal helpers (`loadFromStorage`, `saveToStorage`,
     `persist`, the `chats` module state, the version gate). Verify:
     ```bash
     grep -rn "listChats\|getChat\|renameChat\b\|deleteChat\b\|clearAllChats" frontend/src --include=*.ts --include=*.tsx
     # expect: zero hits outside store.ts itself
     ```
  3. **`messagesStore.ts`** — delete `appendEntry`, `truncateFrom`,
     `updateEntryText`, `deleteTranscript`, `clearAllTranscripts`, the `save`
     helper if it becomes unused, keeping `getTranscript` + `checkVersion`. Verify:
     ```bash
     grep -rn "appendEntry\|truncateFrom\|updateEntryText\|deleteTranscript\|clearAllTranscripts" frontend/src --include=*.ts --include=*.tsx
     # expect: zero hits outside messagesStore.ts itself
     ```
  If any of the above greps returns an unexpected hit (e.g. a test), do NOT delete
  that symbol — report it. (Run each grep; the deletion is gated on a clean result.)
- **Tests to keep-green:** mock-transport tests (if any) must still pass —
  `createChat`/`getTranscript` are retained.
- **Acceptance criteria:**
  - [ ] `feedbackStore.ts` deleted; `UPSTREAM.md` row removed; grep clean.
  - [ ] `authStore.ts` deleted (grep confirmed zero production importers); `UPSTREAM.md` rows removed — OR, if a live importer was found, the file is retained and the importer reported in the commit body.
  - [ ] `store.ts` keeps only `createChat` (+ helpers); the five unused exports gone; grep clean.
  - [ ] `messagesStore.ts` keeps only `getTranscript` (+ `checkVersion`); the five unused exports gone; grep clean.
  - [ ] `MockTransport` still compiles and `VITE_TRANSPORT=mock` still works.

---

### FE-DEAD-CHATFORM — vendored `ChatForm.tsx` superseded by `ChatComposer`  [MEDIUM]

- **Files:** `src/vendor/librechat/app/components/Chat/Input/ChatForm.tsx`.
- **Problem:** `ChatComposer` is "mounted by ChatView in place of `<ChatForm>`."
  `ChatForm.tsx` is never imported (the only `ChatForm` hits are `ChatFormValues`
  in `~/common`, `ChatFormProvider`/`ChatFormContext`, the new `ChatComposer`, and
  a comment in `SourceDropdown.tsx`). It is a dead parallel copy that still
  `import { useChatContext }`, so it *looks* alive and a maintainer could edit it.
- **Fix:** confirm dead, then delete the file:
  ```bash
  grep -rn "ChatForm\b" frontend/src --include=*.ts --include=*.tsx | grep -iv "ChatFormProvider\|ChatFormContext\|ChatFormValues\|ChatComposer"
  # expect: only the file itself + the SourceDropdown.tsx comment
  ```
  Delete `ChatForm.tsx`.
- **Cascade — `SourceDropdown.tsx` becomes dead once `ChatForm.tsx` is gone.**
  `ChatForm.tsx` is the **only** importer of `SourceDropdown.tsx` (verified
  2026-06-16 — the active composer renders `CounselleComposer`, which has its own
  source-control UI; `SourceDropdown` is never imported by it):
  ```bash
  grep -rn "import SourceDropdown\|from '@/components/source-control/SourceDropdown'" frontend/src
  # before delete: only ChatForm.tsx:51 — after delete: nothing
  ```
  After deleting `ChatForm.tsx`, re-run the grep to confirm zero importers, then
  **delete `src/components/source-control/SourceDropdown.tsx`** (it is unreferenced
  dead code: an internal-`useState`/`useEffect` re-read variant that the live
  composer never used). Because `SourceDropdown.tsx` is deleted, there is no comment
  in it left to update — drop the earlier "update `SourceDropdown.tsx:7` comment"
  step. If the grep unexpectedly shows another live importer, do NOT delete it:
  fall back to retargeting that importer or leaving the file and noting it in the
  commit body.
- Remove the `ChatForm` (and any now-stale `SourceDropdown`) row(s) from `UPSTREAM.md`.
- **Tests to keep-green:** ChatView/composer tests unaffected (they mount `ChatComposer`).
- **Acceptance criteria:**
  - [ ] `ChatForm.tsx` deleted; the grep above shows no remaining importer.
  - [ ] `SourceDropdown.tsx` deleted (grep confirms `ChatForm.tsx` was its only importer and zero importers remain after the delete) — OR, if a live importer was found, the file is retained and the reason is in the commit body.
  - [ ] `ChatFormProvider`/`ChatFormContext`/`ChatFormValues` are untouched (still used by ChatView).
  - [ ] Typecheck + build green.

---

### FE-DEAD-APPSHELL — `AppShell.tsx` unreferenced FE-0 substrate  [MEDIUM]

- **Files:** `src/app/AppShell.tsx`.
- **Problem:** 0 references — the router uses the vendored `Root`, not `AppShell`.
  Its own header says "FE-1 replaces this with the vendored Root layout." It is a
  misleading "app shell" that isn't the app shell.
- **Fix:** confirm dead, then delete:
  ```bash
  grep -rn "AppShell" frontend/src --include=*.ts --include=*.tsx
  # expect: only the file's own definition line
  ```
  Delete `src/app/AppShell.tsx`.
- **Acceptance criteria:**
  - [ ] `AppShell.tsx` deleted; grep shows no importer; build green.

---

### FE-CITATIONS-CONTEXT-SPRAWL — collapse RevealDbContext into RevealStateContext  [MEDIUM]

- **Files:** `src/components/citations/RevealStateContext.tsx`,
  `src/components/citations/RevealDbContext.tsx` (to be removed),
  `src/components/citations/DbClaim.tsx`,
  `src/vendor/.../Content/MessageContent.tsx:35,107,162`,
  `src/components/citations/__tests__/dbClaim.test.tsx`,
  `src/app/MessagePreview.tsx` (DEV-only — see note).
- **Problem:** two contexts carry a `revealed` boolean for the same message.
  `MessageRender` provides `RevealStateProvider({revealed,setRevealed})`;
  `MessageContent` re-provides `RevealDbProvider({revealed, style})` with the same
  `revealed` threaded through (`useRevealState()` → re-emit). `RevealDbContext`'s
  only extra is `style`, and **the production path always passes `style: 'wash'`**
  (verified: `MessageContent.tsx:107` and the dbClaim test both hardcode `'wash'`).
  `style` is only varied by `MessagePreview.tsx` (the DEV-only `/message-preview`
  harness, per the comment "production will lock one and drop the switch").
- **Fix — drop `style`, lock `'wash'`, collapse the two contexts into one
  (per the context's own TODO):**
  1. **Add `revealed` consumption to `RevealStateContext`'s read surface for
     DbClaim.** `RevealStateContext` already carries `{revealed, setRevealed}`.
     `DbClaim` only needs `revealed` (it never sets). Change `DbClaim.tsx` to read
     `const { revealed } = useRevealState()` instead of `useRevealDb()`, and
     **hardcode the wash treatment** — delete `highlightClass(style)` and the
     `HighlightStyle` import; inline the `wash` class string (the
     `style === 'wash'` branch is the only production value):
     ```ts
     // DbClaim.tsx — replace useRevealDb()/highlightClass(style) with:
     const { revealed } = useRevealState();
     // ...
     const WASH_CLASS =
       'rounded-[0.3em] bg-[color-mix(in_oklab,var(--brand-purple)_14%,transparent)] ' +
       '[box-decoration-break:clone] [-webkit-box-decoration-break:clone] ' +
       'px-[0.18em] py-[0.04em] -mx-[0.04em]';
     // use WASH_CLASS where highlightClass(style) was.
     ```
  2. **`MessageContent.tsx`** — delete the `RevealDbProvider` wrapper at line 107;
     it now just renders `{children}` (it already provides `RevealStateProvider`
     upstream via `MessageRender`, and `useRevealState()` is already read at line
     162 for the body wash). Remove the `import { RevealDbProvider }` at line 35.
     The `AnswerContexts` helper drops the `RevealDbProvider` layer (keep
     `DejargonProvider` + `CitationActivateProvider`). Confirm `revealed` still
     flows: `MessageRender` → `RevealStateProvider` → `MessageContent` reads
     `useRevealState()` and `DbClaim` (deep child) reads `useRevealState()`. ✔
  3. **Delete `RevealDbContext.tsx`** once DbClaim + MessageContent no longer import it.
  4. **`MessagePreview.tsx` (DEV-only):** it imports `RevealDbProvider`/`useRevealDb`/
     `HighlightStyle` and has a `StylePicker` for comparing treatments. Since the
     preview's whole purpose is the style A/B, the simplest honest move is to
     **delete the StylePicker + style state** from MessagePreview and have it use
     `RevealStateProvider` like production (it then previews exactly what ships).
     If the team wants to keep the style sandbox, MessagePreview may keep a
     **local** `style` state and inline the three class strings *inside
     MessagePreview only* (it already has `previewHighlightClass(style)` at line
     226) — but it must NOT re-introduce a shared `RevealDbContext`. Prefer the
     deletion: production locked `wash`, so the sandbox no longer earns its keep.
  5. **dbClaim test** — update `RevealDbProvider value={{revealed, style:'wash'}}`
     to `RevealStateProvider value={{revealed, setRevealed: () => {}}}` and assert
     the same wash/inert behavior.
  6. **Evaluate (do NOT force) merging `CitationActivateContext` + `SourcesContext`.**
     They are distinct concerns: `SourcesContext` carries the turn's
     `SourceEntry[]` (data, default `[]`); `CitationActivateContext` carries a
     handler (`(entry) => void`, default no-op). Merging them into one
     `{ sources, activate }` context is *possible* but they have different
     defaults and one (`activate`) is provided higher than the other in some
     paths. **Recommendation: leave them separate** — collapsing them risks the
     "chips render bare before sources stream" behavior (SourcesContext's whole
     point) and the streaming-preview no-op activate. Record in the commit body
     that this merge was evaluated and declined as not worth the risk (so reviewers
     don't flag it as a miss). `dejargon.ts` stays as its own switch (it is a
     boolean policy context, orthogonal to reveal).
- **Tests to add/keep-green:** `revealState.test.tsx` unchanged; `dbClaim.test.tsx`
  updated to `RevealStateProvider`. Add an assertion that a DB claim lights with the
  wash when `revealed` and stays inert otherwise (preserving the FE-C1 honesty gate
  — note: FE-C1's *clause-bounding* fix is **Phase 2's** job; here we only ensure
  the context collapse doesn't change DbClaim's resolve-and-gate logic).
- **Acceptance criteria:**
  - [ ] `RevealDbContext.tsx` deleted; no production import of `useRevealDb`/`RevealDbProvider`/`HighlightStyle` remains (MessagePreview either uses production `RevealStateProvider` or keeps a purely-local style sandbox with no shared context).
  - [ ] `DbClaim` reads `revealed` from `RevealStateContext` and applies the locked `wash` treatment.
  - [ ] `MessageContent.tsx` no longer wraps children in `RevealDbProvider`; `revealed` still flows to DbClaim (verified by test + behavior).
  - [ ] CitationActivate/Sources merge evaluated and declined-with-reason in the commit body (not silently skipped).
  - [ ] All citation tests green.

---

### FE-TYPE-DERIVED-STORED — derived view fields stored on `ChatMessage`  [LOW]

- **Files:** `src/api/projectTranscript.ts` (post-move; was `ChatContext.tsx:197-247`,
  `assistantMessage`).
- **Problem:** `assistantMessage` precomputes `activities`, `receipt`, `durationMs`,
  `isThinking`, `text` onto every `ChatMessage`. `activities` is recomputed fresh
  every call, defeating the `areMessageRenderPropsEqual` memo, which then has to
  `join('\x00')` to compare arrays.
- **Fix — make `activities` reference-stable (the cheaper of the two audit
  options; deriving in render would touch the vendored render tree, which we are
  holding off).** Memoize `activities` on the `timeline` identity. Since
  `assistantMessage` is a pure function (not a hook), the reference-stability has to
  come from the input: `state.timeline` blocks keep object identity across events
  (the reducer is immutable and only replaces changed entries), so derive
  `activities` deterministically AND, where the timeline is unchanged between two
  `assistantMessage` calls for the same turn, return the same array. The pragmatic
  implementation: keep a small `WeakMap<TimelineEntry[], string[]>` memo inside
  `projectTranscript.ts` keyed by `state.timeline` so identical timelines yield the
  same `activities` array reference. This lets the `MessageRender` comparator use
  `===` on `activities` instead of `join`. (If a WeakMap memo feels heavyweight for
  the value, the acceptable alternative is to leave `activities` as-is and simply
  document that the `join('\x00')` comparator is intentional — but the WeakMap is
  the clean fix and is cheap.)
- **Tests to keep-green:** existing projection/render tests. Add a test that two
  `assistantMessage` calls with the same `state.timeline` reference return the same
  `activities` array reference.
- **Acceptance criteria:**
  - [ ] `activities` is reference-stable for an unchanged `state.timeline` (WeakMap memo or equivalent), OR the `join` comparator is explicitly documented as intentional with a code comment.
  - [ ] No behavior change to what labels render.

---

### FE-EFFECT-DEP-THROTTLE — `useCallback(throttle(...))` anti-pattern  [LOW]

> **Note:** this finding also subsumes the former Phase-4 FE-L2 (same file, same
> fix). Phase 4 removed FE-L2 from its scope and points here; this is the sole
> owner of the throttle→useMemo change in `useQuestionAnchoredScroll.ts`.

- **Files:** `src/app/useQuestionAnchoredScroll.ts:48-52`.
- **Problem:** `const debouncedHandleScroll = useCallback(throttle(() => updateScrollButton(), MS), [updateScrollButton])` wraps `throttle()` in `useCallback` (the throttled fn is recreated each render before the memo keeps only the memoized one) and suppresses `react-hooks/exhaustive-deps`.
- **Fix:** use `useMemo`:
  ```ts
  const debouncedHandleScroll = useMemo(
    () => throttle(() => updateScrollButton(), SCROLL_HANDLER_THROTTLE_MS),
    [updateScrollButton],
  );
  ```
  Remove the `// eslint-disable-next-line react-hooks/exhaustive-deps`. Add
  `useMemo` to the React import. The cleanup effect
  `useEffect(() => () => debouncedHandleScroll.cancel(), [debouncedHandleScroll])`
  stays (now correctly re-subscribing only when the throttled fn identity changes,
  which is when `updateScrollButton` changes — it is stable, so effectively never).
- **Tests to keep-green:** scroll-behavior tests (if any) unchanged.
- **Acceptance criteria:**
  - [ ] `throttle` is wrapped in `useMemo`, not `useCallback`; the lint suppression is removed; `eslint --max-warnings 0` passes for the file.

---

### FE-PROVIDER-VALUE-MEMO-DEP — `setAbortScroll` missing from value memo deps  [LOW]

- **Files:** `src/app/ChatContext.tsx:900-937` (the value memo; moves with the
  slimmed provider).
- **Problem:** the `value` object includes `setAbortScroll` but the dep array omits
  it (lists `abortScroll`, not `setAbortScroll`). Harmless (setters are stable) but
  inconsistent and a lint/reviewer trip.
- **Fix:** add `setAbortScroll` to the dep array of whichever memo carries it after
  the FE-CHATCONTEXT-GOD split. If the two-context split (E) lands, the
  `ChatActionsContext` value memo includes `setAbortScroll` and lists it in deps.
  Either way: the dep array must list every value-object member that isn't a
  module-level constant.
- **Acceptance criteria:**
  - [ ] Every memoized context value lists all its non-constant members in deps (`setAbortScroll` included); `eslint --max-warnings 0` clean.

---

### FE-CONSOLE-WARN — `console.warn`/`console.error` in production paths  [LOW]

- **Files:** `src/api/http/sse.ts:77,82,86`; `src/app/ChatContext.tsx:415` (the
  identity-not-reconciled warn — moves into `streamReconcile.ts`/`useTurnEngine.ts`).
- **Problem:** house rule bans `console.*` in production paths. These are
  intentional diagnostics for genuinely-bad states but are unstructured and spam
  the console.
- **Fix:** add a tiny logger seam `src/lib/logger.ts`:
  ```ts
  /** Minimal logging seam — routes diagnostics so they can be silenced/collected.
   *  In DEV it forwards to console; in prod it is a no-op (swap for a real sink later). */
  const isDev = import.meta.env.DEV;
  export const logger = {
    warn: (msg: string, ...rest: unknown[]): void => {
      if (isDev) console.warn(msg, ...rest);
    },
    error: (msg: string, ...rest: unknown[]): void => {
      if (isDev) console.error(msg, ...rest);
    },
  };
  ```
  Replace the three `console.warn` calls in `sse.ts` and the
  identity-not-reconciled `console.warn` (now in `streamReconcile`/`useTurnEngine`)
  with `logger.warn(...)`. Keep the messages identical. Do not route any *other*
  console usage in this phase (scope: only the four flagged sites).
- **Tests to keep-green:** SSE parser tests unchanged (they assert dropped-frame
  behavior, not the console call — if a test spies on `console.warn`, repoint it to
  spy the logger or assert the frame was dropped).
- **Acceptance criteria:**
  - [ ] `src/lib/logger.ts` exists; the four flagged `console.*` sites route through it; the messages are unchanged.
  - [ ] `grep -rn "console\.\(warn\|error\)" frontend/src/api/http/sse.ts frontend/src/app/useTurnEngine.ts frontend/src/api/streamReconcile.ts` returns zero hits.

---

## Cross-phase notes

- **Phase 4 FE-correctness tests MUST land first.** This phase's headline change —
  the ChatContext split (FE-CHATCONTEXT-GOD / FE-CONSUMESTREAM-SIZE) — is pure
  extraction, and the proof that it preserved behavior is Phase 4's
  streaming/identity/cancel/attach/feedback/error tests passing **unchanged**. Do
  not start the split until those tests exist and are green on the branch (master
  §4 risk-register mitigation). FE-FEEDBACK-STALE and FE-ATTACH-CURSOR are Phase 4
  fixes; do not touch them here (this phase moves `attachTurn` but must not change
  its cursor semantics — that is Phase 4's contract). **`CounselleComposer.tsx`
  (and `SourceDropdown.tsx`) are shared with Phase 4** (Phase 4: FE-M3 upload/voice
  gating + FE-L8 preview cleanup; this phase: FE-SOURCECFG-DUAL reread-plumbing
  removal) — read the post-Phase-4 state and merge cleanly; do not revert FE-M3/FE-L8.
  See the SHARED-FILE note under FE-SOURCECFG-DUAL.
- **FE-SSE-NOSCHEMA is Phase 4.** The trust-boundary cast in `sse.ts:92` and
  per-type guards are Phase 4's. Here we only touch `sse.ts` for the logger seam
  (FE-CONSOLE-WARN) — do not add schema validation.
- **FE-C1 (the reveal-clause-bounding honesty CRITICAL) is Phase 2.** This phase
  collapses the reveal *context* but must not change DbClaim's resolve-and-gate
  logic or the clause-bounding in `remarkDbSpans`. Coordinate: if Phase 2 already
  landed, keep its DbClaim changes; the context collapse here is additive to them.
- **Phase 6 owns config knobs.** Do not externalise `SUBREDDITS`, the scroll
  throttle constant, timeouts, or the favicon here. Leave the constants in place;
  Phase 6 decides which become config (CFG-*). The leave-alone list in master §3
  is binding.
- **`ChatMessage` is now a shared public type from `@/api/projectTranscript`,
  re-exported by `@/app/ChatContext`.** Phase 6/7 docs (`docs/ARCHITECTURE.md`
  §31) should note the new module boundary; flag it for the Phase 7 docs sync (do
  not edit `docs/` here).

---

## Phase completion checklist

- [ ] **FE-MOCK-MISLABEL:** `sourceStore.ts` moved to `api/sourceConfigStore.ts`; all importers repointed; `grep "mock/sourceStore"` clean.
- [ ] **FE-CHATCONTEXT-GOD:** `projectTranscript.ts` + `streamReconcile.ts` + `useTurnEngine.ts` extracted; `ChatContext.tsx` < 800 lines; `useChatContext()` shape unchanged; context split (E) or documented merged-hook fallback.
- [ ] **FE-CONSUMESTREAM-SIZE:** `consumeStream` loop < 50 lines; three pure helpers unit-tested.
- [ ] **FE-SOURCECFG-DUAL:** server (React Query) is the single per-session source of truth; composer's `useState` mirror + re-read effects + `onSourcesReread` deleted; localStorage demoted to new-chat default; no new endpoint.
- [ ] **FE-COUPLING:** `UPSTREAM.md` ownership-fork section + 30-file list added; `common/index.ts` type import repointed to `@/api/projectTranscript`; no vendored runtime rewire.
- [ ] **FE-DEADCODE-MOCK:** `feedbackStore.ts` + `authStore.ts` deleted (zero production importers confirmed); unused `store.ts`/`messagesStore.ts` exports deleted; greps clean; MockTransport intact.
- [ ] **FE-DEAD-CHATFORM:** `ChatForm.tsx` deleted; `SourceDropdown.tsx` deleted as a cascade (ChatForm was its only importer); `ChatFormProvider`/`Values` retained.
- [ ] **FE-DEAD-APPSHELL:** `AppShell.tsx` deleted.
- [ ] **FE-CITATIONS-CONTEXT-SPRAWL:** `RevealDbContext.tsx` deleted; `style` locked to `wash`; `DbClaim`/`MessageContent` use `RevealStateContext`; MessagePreview de-coupled; CitationActivate/Sources merge declined-with-reason.
- [ ] **FE-TYPE-DERIVED-STORED:** `activities` reference-stable (or comparator documented).
- [ ] **FE-EFFECT-DEP-THROTTLE:** throttle wrapped in `useMemo`; lint suppression removed.
- [ ] **FE-PROVIDER-VALUE-MEMO-DEP:** all value-memo deps complete.
- [ ] **FE-CONSOLE-WARN:** `lib/logger.ts` added; four flagged sites routed through it.
- [ ] **Shared files (Phase 5 ↔ Phase 4):** `CounselleComposer.tsx` (FE-SOURCECFG-DUAL here; FE-M3 + FE-L8 in Phase 4) read post-Phase-4 state and merged cleanly; FE-M3/FE-L8 changes NOT reverted while removing the `onSourcesReread` plumbing. (`SourceDropdown.tsx` is not a shared composer file — it has no `onSourcesReread` prop and is deleted by FE-DEAD-CHATFORM as dead code.)
- [ ] **Gate:** `cd frontend && npm run typecheck && npm test && npm run build` all green; every pre-existing FE test passes unchanged (the behavior-preservation proof); new `streamReconcile`/`projectTranscript` tests added and green.
- [ ] **Behavior diff (reviewer):** send / edit-replace / regenerate / cancel-mid-stream / attach-on-reload / transcript-load-error / connection-lost-honesty-guard / source-toggle-on-next-send / reveal-toggle-wash all behave identically to pre-phase.
