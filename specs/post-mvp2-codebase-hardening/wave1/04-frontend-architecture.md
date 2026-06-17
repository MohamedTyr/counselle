# Wave 1 Audit — Frontend Architecture & State Management

Scope: `frontend/src/app/ChatContext.tsx`, `frontend/src/api/**`, the SSE/streaming
client, the vendored LibreChat ↔ Counselle boundary, component composition, data flow,
and modularity. Read-only analysis; no code changed.

Reviewer's overall read: the **honesty-critical core is genuinely well-built** — the
turn reducer is a clean pure module, the SSE parser is careful, and the "never project an
incomplete stream as a finished answer" discipline is real and tested. The weaknesses are
concentrated in three places: (1) `ChatContext` is a 985-line god-provider doing five jobs
at once; (2) the "mock" layer has rotted into a mix of dead code and mislabeled *real*
production state; (3) the vendored tree is no longer vendored — 30 files import Counselle
code, so the "we can re-pull upstream" premise is already false. There is also one concrete
state bug (feedback) and one latent reload bug (attach cursor).

## Severity summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 7 |
| LOW | 5 |
| **Total** | **17** |

Distinction used throughout: **[Counselle]** = code this team authored/owns and should fix;
**[Vendored]** = code under `src/vendor/` (LibreChat fork) — flag, but fixing is a separate
decision. Note FE has heavily edited the "vendored" tree, so that line is blurry (see FE-COUPLING).

---

## HIGH

### FE-FEEDBACK-STALE — Feedback thumb is derived server state copied into local state and never re-synced
- **Severity:** HIGH
- **Category:** State architecture (derived-server-state-stored / sync bug)
- **Location:** `src/vendor/librechat/app/hooks/Messages/useMessageActions.tsx:49-51` (the `useState` initializer), no syncing `useEffect` anywhere in the file.
- **Evidence:**
  ```ts
  const [feedback, setFeedback] = useState<TFeedback | undefined>(() =>
    message?.feedback ? { rating: message.feedback.rating } : undefined,
  );
  ```
  `useState(initializer)` runs the initializer **once at mount**. `message.feedback` comes
  from `ChatContext`'s transcript projection (`messagesFromTranscript` → `message.feedback`).
  There is no `useEffect(() => setFeedback(...), [message.feedback])`.
- **Why it matters:** Any time `message.feedback` changes after the component mounts but the
  component instance survives (React reuses the instance because `key={message.messageId}`
  is stable), the displayed thumb diverges from server truth. Concrete triggers:
  (a) the live turn completes and `consumeStream` appends the persisted assistant message,
  then a `retryTranscript()` or `invalidateQueries([chats])`-driven re-read replaces the
  entry carrying a server-joined rating — the local state ignores it;
  (b) opening the same conversation, navigating away and back without unmounting the row.
  This is exactly the "never claim a feedback state the backend didn't persist" honesty rule
  the code comments are trying to protect — but the staleness can show a rating that *was*
  cleared/changed server-side. The optimistic write path is correct; the **read/refresh path
  is missing**.
- **Fix direction:** Add a sync effect: `useEffect(() => { setFeedback(message?.feedback ? { rating: message.feedback.rating } : undefined); }, [message?.feedback?.rating]);`
  Or lift feedback fully into the projection and render it as a pure prop (no local copy),
  driving the optimistic update through React Query's mutation cache instead of `useState`.

### FE-ATTACH-CURSOR — Reattach on a fresh page load cannot resume mid-turn (cursor lives only in memory, and `attach` is never passed a Last-Event-ID)
- **Severity:** HIGH
- **Category:** SSE/streaming correctness (resume semantics)
- **Location:** `src/api/http/transport.ts:40-41,83-103` (in-memory `cursors` map, `attach` uses `lastEventId ?? this.cursors.get(sessionId)`); `src/app/ChatContext.tsx:543` (`transport.attach(convoId)` — second arg never supplied).
- **Evidence:**
  - `HttpTransport.cursors` is `new Map<string, string>()` on the instance. `httpTransport` is a
    module singleton, so the map is wiped on every full page load / hard refresh.
  - `attach()` resolves its cursor from `lastEventId ?? this.cursors.get(sessionId)`. The only
    caller is `attachTurn` (ChatContext.tsx:543), which calls `transport.attach(convoId)` with
    **no** `lastEventId`.
- **Why it matters:** The whole point of `attach` (per the file headers and §27.3) is "pick up an
  in-flight turn another tab/a previous page-load started, replaying events after a cursor." But on a
  fresh load the in-memory cursor is empty and no Last-Event-ID is threaded from any persisted source,
  so the backend either replays the **entire** turn from seq 0 (duplicate events — the dedup at
  ChatContext.tsx:885 papers over *one* class of this) or, if the backend treats a missing
  Last-Event-ID as "start fresh," loses the already-streamed prefix. The "reattach across a refresh"
  feature is effectively non-functional in the most important case (the user reloads while a turn runs).
- **Fix direction:** Persist the per-session cursor durably (sessionStorage keyed by session id), or
  have the transcript read return the last event seq so `attachTurn` can pass it as `lastEventId`.
  Decide and document the backend contract for "attach with no Last-Event-ID" — full replay vs. tail-only.

### FE-CHATCONTEXT-GOD — `ChatContext` is a 985-line provider owning five independent concerns
- **Severity:** HIGH
- **Category:** God component / separation of concerns / modularity
- **Location:** `src/app/ChatContext.tsx` (entire file, 985 lines; house rule is <800 lines, functions <50).
- **Evidence:** One provider owns, in a single file:
  1. transcript projection helpers (`messagesFromTranscript`, `assistantMessage`, `userMessage`, 100+ lines);
  2. the live-turn stream loop (`consumeStream` ~125 lines — itself well over the 50-line function rule);
  3. send/edit/regenerate/retry orchestration (`startSend`, `runTurn`, `submitMessage`, `ask`, `regenerate`, `retryLastSend`);
  4. cancel + send-mid-stream concurrency control (`cancelAndAwaitClear`, `stopGenerating`, plus 4 refs: `cancelledRef`, `cancelInFlightRef`, `isMountedRef`, `freshSessionsRef`);
  5. transcript-load error handling (`loadTranscript`, `transcriptError`, `retryTranscript`);
  plus error-mapping helpers and the `ChatMessage` type definition.
  The exported context value has **20 fields** (ChatContext.tsx:122-153) consumed by 15 call sites.
- **Why it matters:** This violates the project's own house rules (`<800` lines, `<50`-line functions,
  "many small modules"). It concentrates the trickiest logic in the app — streaming, identity
  reconciliation, concurrency, optimistic echoes — into one mutable-ref-heavy unit that is very hard to
  test in isolation, reason about, or modify safely. Every consumer subscribes to the whole 20-field
  value, so a change to (say) `abortScroll` re-evaluates the memo for components that only need
  `submitMessage`. It is the single highest-risk file for future regressions.
- **Fix direction:** Extract the pure projection helpers to `api/projectTranscript.ts` (they import no
  React). Extract the stream loop + turn lifecycle into a `useTurnEngine` hook (or a small state machine /
  XState-style reducer) that ChatContext composes. Split the context value into a stable-callbacks
  context and a frequently-changing-data context so consumers don't all re-render together. This is
  refactoring, not rewrite — the pieces are already loosely separated by comment banners.

### FE-MOCK-MISLABEL — Production client-state ("sourceStore") lives under `api/mock/` and is imported by real HTTP-path code
- **Severity:** HIGH
- **Category:** Separation of concerns / misleading module organization
- **Location:** `src/api/mock/sourceStore.ts` (real localStorage source-config store); imported by `src/app/ChatContext.tsx:34`, `src/api/source-config.ts:12`, `src/api/hooks.ts:18` (the **real** HTTP query layer), `src/components/composer/ChatComposer.tsx:23-27`, `src/components/source-control/SourceDropdown.tsx`, `src/components/composer/SourcesControl.tsx`, `src/app/settingsSync.ts`.
- **Evidence:** `selectTransport.ts` defaults to `http` and `.env` sets `VITE_TRANSPORT=http`, so the
  mock transport is **not** the production path. Yet `api/hooks.ts` (real backend queries) does
  `import { setDefaultSourceConfig } from './mock/sourceStore'`, and the source-config wire boundary
  (`source-config.ts`) derives `FE_DEFAULTS` and `SUBREDDITS` from `mock/sourceStore`. The "mock"
  folder therefore contains both genuinely-dead fixtures *and* live production state, with no way to
  tell which is which from the path.
- **Why it matters:** "Everything under `mock/` is fake / removable when the backend lands" is the
  natural assumption (and the file headers literally say "FE-7 replaces this"). It's false. A cleanup
  pass that deletes `mock/` would break the live app. It also means source-config is **client-only
  localStorage state** despite the backend persisting source config per session — see FE-SOURCECFG-DUAL.
- **Fix direction:** Move `sourceStore.ts` to `src/api/sourceConfigStore.ts` (or `src/app/`), out of
  `mock/`. Keep `mock/` for fixtures + `MockTransport` only.

### FE-COUPLING — The "vendored" LibreChat tree is a hard fork: 30 files import Counselle code, so it can't be re-pulled
- **Severity:** HIGH
- **Category:** Tight coupling to vendored code / maintainability
- **Location:** `src/vendor/` — 30 files contain `from '@/...'` imports into Counselle code (full list captured in analysis; key ones: `Messages/Message.tsx`, `Messages/MessagesView.tsx`, `Messages/ui/MessageRender.tsx`, `hooks/Messages/useMessageActions.tsx`, `common/index.ts`, `routes/Root.tsx`, all SettingsTabs, UnifiedSidebar). 272 vendored files / ~19.5k LOC total.
- **Evidence:** `src/vendor/librechat/app/common/index.ts:4` does `import type { ChatMessage, AskProps } from '@/app/ChatContext'` and redefines `TMessageProps`/`TMessageContentProps`/etc. around Counselle's `ChatMessage`. Vendored `Message.tsx`, `MessagesView.tsx`, `MessageRender.tsx`, `useMessageActions.tsx` all `import { useChatContext } from '@/app/ChatContext'`. So the vendored render tree is wired directly to Counselle's context and types.
- **Why it matters:** The mental model "vendored = pristine upstream we can resync" is no longer true.
  Each vendored file carries a hand-written `Subtractions / rewires` header — these are real fork edits.
  Re-pulling upstream would require re-applying ~30 edits by hand. The cost is fine *if acknowledged*,
  but the directory name and the "pinned 197a1dc4" headers imply an upgrade path that doesn't exist
  cheaply. This is the inverse of the registry-first house rule: a lot of bespoke logic now lives inside
  a tree labeled "third-party."
- **Fix direction:** Either (a) accept the fork and rename/document it as "adapted from LibreChat,
  owned by us" (drop the upgrade pretense), or (b) invert the dependency — keep vendored components
  prop-driven (no `@/` imports) and pass Counselle data in from thin Counselle-owned wrappers, so the
  vendored leaf nodes stay upstream-clean. (b) is the more defensible boundary but is real work.

---

## MEDIUM

### FE-DEADCODE-MOCK — Several `mock/` modules are entirely dead under the HTTP transport
- **Severity:** MEDIUM
- **Category:** Dead code
- **Locations / evidence:**
  - `src/api/mock/feedbackStore.ts` — **0 references** anywhere (grep clean). Fully dead.
  - `src/api/mock/store.ts` — only `createChat` is used, and only by `mock/transport.ts`. `listChats`, `getChat`, `renameChat`, `deleteChat`, `clearAllChats` have **0 external callers**.
  - `src/api/mock/messagesStore.ts` — only `getTranscript` is used (by `mock/transport.ts`). `appendEntry`, `truncateFrom`, `updateEntrytext`, `deleteTranscript`, `clearAllTranscripts` have **0 callers**.
  - The entire `mock/` chain (store, messagesStore, fixtures) is reachable **only** through `MockTransport`, which is selected only when `VITE_TRANSPORT=mock`. In the shipped config (`http`) it is contract-test scaffolding, not product code.
- **Why it matters:** ~1,600 LOC of mock code, much of it dead even in mock mode, sits next to live
  production state (see FE-MOCK-MISLABEL), making the live/dead line invisible. Carrying it inflates the
  surface a reader must understand.
- **Fix direction:** Delete the dead exports (`feedbackStore.ts` whole; the unused `store.ts`/
  `messagesStore.ts` functions). Keep `MockTransport` + the minimal store it needs if the contract
  harness is still wanted; otherwise gate it to test files only.

### FE-DEAD-CHATFORM — Vendored `ChatForm.tsx` is fully dead (replaced by `ChatComposer`) but still maintained
- **Severity:** MEDIUM
- **Category:** Dead code (vendored)
- **Location:** `src/vendor/librechat/app/components/Chat/Input/ChatForm.tsx` — never imported anywhere (grep: the only hits for "ChatForm" are `ChatFormProvider`/`ChatFormContext`, the new `ChatComposer`, and a test).
- **Evidence:** `ChatComposer.tsx`'s header says it is "Mounted by ChatView in place of `<ChatForm>`."
  ChatView mounts `<ChatComposer>`, not `<ChatForm>`. Yet ChatForm.tsx still `import { useChatContext }`
  and carries submit logic — a parallel, unused copy of the composer wiring.
- **Why it matters:** Two composer implementations exist; one is live, one is dead but still references
  the live context (so it looks alive). A maintainer could edit the wrong one.
- **Fix direction:** Delete `ChatForm.tsx` (and any now-orphaned imports), or if kept for reference, move
  it out of the build path and note it's superseded.

### FE-DEAD-APPSHELL — `AppShell.tsx` is a leftover FE-0 substrate, unreferenced
- **Severity:** MEDIUM
- **Category:** Dead code [Counselle]
- **Location:** `src/app/AppShell.tsx` — 0 references (the router uses vendored `Root`, not AppShell).
- **Evidence:** File header: "FE-0 bare shell … FE-1 replaces this with the vendored Root layout."
  `routes.tsx` imports `Root` from `~/routes/Root`; `AppShell` is never imported.
- **Why it matters:** Minor, but it's a misleading "app shell" that isn't the app shell.
- **Fix direction:** Delete.

### FE-SOURCECFG-DUAL — Source config is duplicated server state held in client localStorage, with a fragile re-read dance
- **Severity:** MEDIUM
- **Category:** Duplicated server state in client state
- **Location:** `src/api/mock/sourceStore.ts` (localStorage per conversation), `src/app/ChatContext.tsx:336-340` (on transcript load, `updateSourceConfig` overwrites localStorage from server truth), `src/components/composer/ChatComposer.tsx:107-122` (local `useState` copy + two re-read effects).
- **Evidence:** The backend persists source config per session (`transcript()` returns
  `source_config`, and every `sendMessage` body re-sends `toWire(getSourceConfig(...))`). The FE also
  keeps it in localStorage *and* mirrors it into a `ChatComposer` `useState`, re-reading it on
  conversation change and "when the dropdown opens" (`handleSourcesReread`). Three copies of the same
  truth (server, localStorage, component state) kept in sync by imperative effects.
- **Why it matters:** Classic duplicated-server-state smell. The localStorage copy can disagree with the
  server (e.g. another tab/device); the comment at ChatContext.tsx:336 admits "server truth wins over
  localStorage" — i.e. localStorage is a stale shadow that must be corrected on each load. The
  re-read-on-popover-open is a workaround for not having a single reactive source.
- **Fix direction:** Make the server (via React Query, keyed by session) the single source of truth for
  source config; drop localStorage to a *default-for-new-chats* only (which is legitimately client-pref).
  Read the per-conversation config from the query cache, mutate via a mutation that POSTs — no manual
  re-read effects.

### FE-CITATIONS-CONTEXT-SPRAWL — Four overlapping per-message citation/reveal contexts where one would do
- **Severity:** MEDIUM
- **Category:** Over-fragmentation / non-DRY state
- **Location:** `src/components/citations/RevealStateContext.tsx`, `RevealDbContext.tsx`, `CitationActivateContext.tsx`, `SourcesContext.tsx` (+ `dejargon.ts` is a 5th context).
- **Evidence:** `RevealStateContext` (`{revealed,setRevealed}`) and `RevealDbContext`
  (`{revealed,style}`) both carry a `revealed` boolean for the same message; `MessageRender` provides
  `RevealStateProvider`, and `MessageContent` re-provides `RevealDbProvider` with the same `revealed`
  threaded through. That's two contexts expressing one piece of per-message state, plus a `style` knob
  whose own comment says it's "preview-only … production will lock one and drop the switch."
- **Why it matters:** Five context providers for one message's citation behavior is a lot of indirection
  to follow; `revealed` is plumbed through two contexts, which is the kind of duplication that drifts.
- **Fix direction:** Collapse `RevealDbContext` into `RevealStateContext` (carry `style` there or drop it
  per its own TODO). Audit whether `CitationActivateContext` + `SourcesContext` can merge given they're
  both per-message citation concerns.

### FE-SSE-NOSCHEMA — SSE frames are cast to `ProtocolEvent` with only a `type`-membership check; payload shape is trusted untyped
- **Severity:** MEDIUM
- **Category:** Type-safety hole at the trust boundary
- **Location:** `src/api/http/sse.ts:84-92`, `parseFrame`.
- **Evidence:**
  ```ts
  const obj = parsed as Record<string, unknown>;
  if (!isKnownType(obj.type)) { ... return null; }
  // Trust boundary: ... we validate the `type` ... but trust the rest of the frame's shape
  return { event: obj as unknown as ProtocolEvent, id };
  ```
  Only `obj.type` is validated; `obj.data` is `as unknown as ProtocolEvent` — no per-type payload
  validation. The reducer then reads `event.data.text`, `event.data.message_id`, etc. as if typed.
- **Why it matters:** The project's stated honesty principle treats wire data as untrusted (`fromWire`
  in source-config.ts is carefully defensive). The SSE path — the *primary* data path — is not. A
  backend bug or version skew that sends a `meta` without `message_id`, or a `step` without `step_id`,
  flows straight into the reducer/projection as `undefined`, corrupting identity reconciliation (e.g.
  `assistantMessageId = event.data.message_id` becomes `undefined`) with no guard. The 5MB buffer cap
  and malformed-JSON handling are good; payload validation is the gap.
- **Fix direction:** Define lightweight per-type guards (or Zod schemas) for at least the
  identity-bearing events (`meta`, `step`, `done`, `error`) and drop/route-to-error frames that fail.
  This matches the discipline already applied to `fromWire`.

### FE-CONSUMESTREAM-SIZE — `consumeStream` is a 125-line function doing stream consumption, identity reconciliation, persistence, and error routing
- **Severity:** MEDIUM
- **Category:** Function size / mixed responsibilities
- **Location:** `src/app/ChatContext.tsx:367-491`.
- **Evidence:** One `useCallback` body handles: temp-id minting, the `for await` loop, meta-id
  reconciliation with an inline `setPersisted` map, per-event `setTurn`, the honesty guard for a
  truncated stream, terminal persistence + query invalidation, and a two-branch catch that distinguishes
  pre-meta vs post-meta failure. ~125 lines, well over the 50-line house rule.
- **Why it matters:** The most correctness-sensitive code in the app (streaming + identity + error
  honesty) is one long function with several `let` reassignments (`state`, `assistantMessageId`,
  `userMessageId`, `hasBackendId`, `metaSeen`) — high cognitive load, hard to unit-test the branches
  independently.
- **Fix direction:** Extract `reconcileMetaIds`, `persistTerminalTurn`, and `persistErroredTurn` as pure
  helpers taking explicit state; keep the loop thin. Pairs with FE-CHATCONTEXT-GOD.

---

## LOW

### FE-EFFECT-DEP-THROTTLE — `useCallback(throttle(...))` with a disabled exhaustive-deps lint
- **Severity:** LOW
- **Category:** Effect/memo correctness (minor)
- **Location:** `src/app/useQuestionAnchoredScroll.ts:48-52`.
- **Evidence:** `// eslint-disable-next-line react-hooks/exhaustive-deps` over
  `const debouncedHandleScroll = useCallback(throttle(() => updateScrollButton(), ...), [updateScrollButton])`.
  Wrapping `throttle()` in `useCallback` is an anti-pattern (the throttled fn is recreated each render
  before memo, but only the memoized one is kept) and the suppressed lint hides the intent.
- **Why it matters:** Works today because `updateScrollButton` is stable, but it's fragile and the
  silenced lint is a smell. The cleanup effect (`debouncedHandleScroll.cancel()`) is correctly present.
- **Fix direction:** `useMemo(() => throttle(...), [updateScrollButton])` is the idiomatic form; or
  `useRef` the throttled fn. Remove the lint suppression.

### FE-PROVIDER-VALUE-MEMO-DEP — `ChatContext` provider value memo omits `setAbortScroll` from deps
- **Severity:** LOW
- **Category:** Memo dependency hygiene
- **Location:** `src/app/ChatContext.tsx:900-937` — `value` includes `setAbortScroll` (a stable
  `useState` setter) but the dep array (lines 920-936) lists `abortScroll` and not `setAbortScroll`.
- **Why it matters:** Harmless in practice (setters are stable), but it's an inconsistency the linter
  would normally flag and a reviewer will trip on.
- **Fix direction:** Add `setAbortScroll` to deps for consistency (or rely on the known-stable setter and
  document it).

### FE-CONSOLE-WARN — `console.warn`/`console.error` in production data paths
- **Severity:** LOW
- **Category:** Logging in production code (house rule: no debug statements)
- **Location:** `src/api/http/sse.ts:77,82,86` (dropped-frame warns); `src/app/ChatContext.tsx:415` (identity-not-reconciled warn).
- **Why it matters:** The coding-style rule bans `console.*` in production paths. These are
  *intentional* diagnostics for genuinely-bad states, so they're defensible — but they're unstructured
  and will spam the user's console.
- **Fix direction:** Route through a tiny logger seam (even a no-op-in-prod wrapper) so they can be
  silenced/collected; or accept and document the exception.

### FE-TYPE-DERIVED-STORED — Many derived view fields are computed in `assistantMessage` and stored on `ChatMessage` instead of computed at render
- **Severity:** LOW
- **Category:** Derived state stored
- **Location:** `src/app/ChatContext.tsx:197-247` — `assistantMessage` precomputes `activities`,
  `receipt`, `durationMs`, `isThinking`, `text` (prose) onto every `ChatMessage`.
- **Why it matters:** These are pure derivations of `TurnState` (`activities` is even recomputed fresh
  every call, defeating the memo comparator which then has to `join('\x00')` to compare). Storing
  derived values on the message object both duplicates `TurnState` and forces the custom memo comparator
  in `MessageRender` to special-case array fields. Mostly a design-cleanliness note, not a bug.
- **Fix direction:** Either derive these in the render components from `content`/`stepRecord` (selectors),
  or keep them precomputed but make `activities` reference-stable (memoize on `timeline`) so the
  comparator can use `===`.

### FE-DUP-CITED-SCAN — Citation index scanning is regex-over-rendered-text and acknowledged to over/under-count
- **Severity:** LOW
- **Category:** Fragile derivation
- **Location:** `src/components/citations/remarkCitations.ts:25-56` (`citedIndexesIn` regex `/\[(\d{1,2})\]/g` over raw markdown).
- **Evidence:** The doc comment itself notes "a `[7]` inside a code fence over-counts at worst." The
  same grammar is the single source for inline chips, the sources strip, the panel, and the reveal-toggle
  gate, so all four inherit the imprecision.
- **Why it matters:** Low, because it's single-sourced and the failure mode is benign (showing an extra
  source row), but a literal `[12]` in code or a quoted example would mis-attribute a source — a small
  honesty paper-cut on a product whose differentiator is honesty.
- **Fix direction:** Scan the mdast (skip `code`/`inlineCode` nodes — the remark plugin already does this
  for the chip transform) for the footer/panel too, instead of regexing the raw string. The plugin path
  is already correct; reuse it.

---

## What is genuinely good (so the team doesn't "fix" it)

- **`turn-reducer.ts`** — clean pure module, fully immutable, one code path for live + transcript via
  synthesized events (`reduceTranscriptEntry`). This is the right design.
- **SSE parser** (`sse.ts`) — careful CRLF/LF handling, multi-line `data:`, 5MB OOM cap, reader
  cancel-before-releaseLock in `finally`. Solid except for the payload-validation gap (FE-SSE-NOSCHEMA).
- **Stream honesty guard** — `consumeStream` refusing to project a stream that ended without a terminal
  `done`/`error` as a finished answer (ChatContext.tsx:440-445) is exactly the right call and is the kind
  of thing most teams get wrong.
- **No `any` and no unsafe casts in Counselle-authored code** (one deliberate trust-boundary cast in
  `sse.ts`, flagged above). The `fromWire`/`toWire` boundary is properly defensive.
- **Transport seam** (`transport.ts` interface + `selectTransport.ts`) is a clean abstraction; ChatContext
  correctly never imports a concrete impl.

---

## Suggested fix ordering

1. **FE-FEEDBACK-STALE** + **FE-ATTACH-CURSOR** — two real correctness bugs, both contained, both touch
   the honesty surface. Fix first.
2. **FE-SSE-NOSCHEMA** — cheap to add identity-event guards; protects the primary data path.
3. **FE-MOCK-MISLABEL** + **FE-DEADCODE-MOCK** + **FE-DEAD-CHATFORM** + **FE-DEAD-APPSHELL** — a single
   "untangle the mock folder + delete dead code" sweep; low risk, big clarity win.
4. **FE-CHATCONTEXT-GOD** + **FE-CONSUMESTREAM-SIZE** — the structural refactor; do after the above so
   the extraction targets are clear.
5. **FE-COUPLING** + **FE-SOURCECFG-DUAL** + **FE-CITATIONS-CONTEXT-SPRAWL** — larger architectural
   decisions; schedule deliberately.
6. LOW items — opportunistically.
