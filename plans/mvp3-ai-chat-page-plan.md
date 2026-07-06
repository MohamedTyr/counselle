# MVP3 AI Chat Page Plan

## Goal

Build the real chat page at `/app/ai/:sessionId` in the new frontend by cloning the old chat page behavior exactly, while replacing the visual layer with the new app design system and AI Elements where they fit.

The behavior source of truth is the old frontend backup at:

- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513`

The new implementation must keep the existing MVP3 composer/home route:

- `/app/ai` remains the centered AI composer start page.
- `/app/ai/:sessionId` becomes the full chat page.
- The route stays inside `WorkspaceShell`; no parallel shell or LibreChat shell copy.

## Non-Negotiables

1. Clone old chat behavior, not just visual shape.
2. Preserve the backend protocol exactly: sessions, transcript hydrate, SSE send, SSE reattach, cancel, feedback, title rename, delete.
3. Use AI Elements for commodity chat UI pieces where they fit: conversation, message, prompt input, sources, reasoning/tool/activity display.
4. Use the new frontend theme and workspace tokens; do not bring old LibreChat styling forward.
5. Preserve Counselle honesty surfaces: citations, DB/source distinction, partial stream error handling, cancelled-turn messaging, clarify behavior, and activity visibility.
6. Keep the transport/state layer custom. Do not force Counselle's SSE protocol into Vercel `useChat`; AI Elements are presentational components here.
7. Keep generated registry code and Counselle-specific code separate:
   - AI Elements generated files live under `frontend/src/components/ai-elements/*`.
   - Counselle adapters, state, reducers, and product behavior live under feature/API modules.

## Inputs From Exploration

### Old Chat Behavior Source

Key old frontend files:

- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/app/ChatView.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/app/ChatContext.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/app/useTurnEngine.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/api/turn-reducer.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/api/projectTranscript.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/api/http/transport.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/citations/remarkCitations.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/citations/InlineCitation.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/citations/MessageSources.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/citations/SourcesPanel.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/timeline/ReasoningTrace.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/clarify/ClarifyWidget.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/composer/ChatComposer.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/app/useQuestionAnchoredScroll.ts`

Old behavior tests to use as clone reference:

- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/app/ChatView.test.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/app/__tests__/useTurnEngine-dedupe.test.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/app/__tests__/useTurnEngine-scroll.test.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/api/http/transport-cursor.test.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/clarify/__tests__/clarify.test.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/citations/__tests__/sourcesPanelForward.test.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/citations/__tests__/sourcesStrip.test.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/api/__tests__/turn-reducer-sources.test.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/api/__tests__/turn-reducer-viz.test.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/api/turn-reducer-thinking.test.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/timeline/ReasoningTrace.test.tsx`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/composer/__tests__/source-bridge.test.ts`
- `/home/saifuddin/Projects/counselle/frontend.backup-20260705-070513/src/components/composer/__tests__/source-reactive.test.tsx`

### New Frontend Integration Points

Current worktree files:

- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/app/router.tsx`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/app/shell/WorkspaceShell.tsx`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/app/shell/WorkspaceOutlet.tsx`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/app/shell/navigation.tsx`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/index.css`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/components.json`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/api/chat/types.ts`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/api/chat/transport.ts`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/api/chat/sse.ts`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/features/ai-composer/AiComposerRoute.tsx`
- `/home/saifuddin/Projects/counselle/.worktrees/ai-chat-interface/frontend/src/features/ai-composer/AiConversationPendingRoute.tsx`

Current constraints:

- `/app/ai/:sessionId` already exists and renders a placeholder.
- `WorkspaceOutlet` keys routes by pathname, so changing session ids remounts the chat route.
- Current `api/chat` only supports config, create session, first-message stream, and cancel.
- Full chat needs session list, transcript fetch, stream attach, regular send, feedback, rename, delete, cursor persistence, and reducer/model projection.
- `render-app.tsx` will need chat endpoint handlers and SSE helpers for route tests.
- Session/sidebar remote data should use TanStack Query hooks. The live stream reducer is ephemeral local state; it should not become a second cache for session lists, transcript fetches, rename/delete, or feedback.

### Backend Contract

Endpoints:

- `POST /v1/sessions`
- `GET /v1/sessions?limit=50&q=&cursor=`
- `GET /v1/sessions/{session_id}`
- `PATCH /v1/sessions/{session_id}`
- `DELETE /v1/sessions/{session_id}`
- `POST /v1/sessions/{session_id}/messages`
- `GET /v1/sessions/{session_id}/stream`
- `POST /v1/sessions/{session_id}/cancel`
- `POST /v1/sessions/{session_id}/messages/{message_id}/feedback`
- `GET /v1/config`

SSE events:

- `meta`: canonical `trace_id`, `session_id`, `model`, `message_id`, `user_message_id`
- `delta`: final assistant prose
- `thinking`: non-final reasoning/work narration
- `step`: activity lifecycle row keyed by `step_id`
- `viz`: render spec block
- `clarify`: inline clarify spec
- `sources`: cumulative source registry
- `usage`: token/cost/tool summary
- `done`: terminal `complete | awaiting_input | cancelled`
- `error`: terminal user-safe error plus trace id

Transcript entries:

- user: `{ role: "user", text, ts, message_id?, synthesized? }`
- assistant: `{ role: "assistant", text, ts, message_id, parts, step_record, sources, status, usage?, error?, clarify?, feedback? }`

### AI Elements And Registry Direction

Use these AI Elements:

- `@ai-elements/conversation`: scroll container, bottom follow, scroll button.
- `@ai-elements/message`: user and assistant message shells, markdown response, message actions.
- `@ai-elements/prompt-input`: full chat composer, textarea, submit/stop adaptation.
- `@ai-elements/sources`: citation/source list trigger and content.
- `@ai-elements/inline-citation`: only if it can preserve Counselle citation grammar cleanly.
- `@ai-elements/reasoning`: collapsible thinking/progress shell if it maps cleanly.
- `@ai-elements/chain-of-thought`: evaluate for the expanded activity timeline because it is designed for step-by-step reasoning displays.
- `@ai-elements/tool`: evaluate for individual backend `step` rows and tool/search receipts.
- `@ai-elements/task`: evaluate for grouped activity/workflow progress if it maps better than `tool`.
- `@ai-elements/shimmer`: live waiting/activity shimmer.
- `@ai-elements/artifact`: evaluate for the old shared right rail/artifact slot.
- `@ai-elements/code-block`: use for markdown code blocks or viz/artifact code output when `MessageResponse` is not enough.
- `@ai-elements/attachments`: keep available only if `PromptInput` or future message parts need attachment/source-document display; do not expose upload UI unless backend behavior supports it.
- `@ai-elements/suggestion`: evaluate for empty active-session prompts or any preserved conversation-starter/suggestion surface.

Do not use these in MVP3 chat unless a concrete old behavior or backend payload requires them:

- `@ai-elements/model-selector`: backend does not expose user model switching.
- voice components (`speech-input`, `transcription`, `audio-player`, `mic-selector`, `voice-selector`, `persona`): old chat behavior did not include voice.
- workflow canvas components (`canvas`, `node`, `edge`, `controls`, `panel`, `toolbar`, `connection`): no current Counselle workflow graph UI.
- coding sandbox components (`web-preview`, `jsx-preview`, `sandbox`, `terminal`, `file-tree`, `stack-trace`, `test-results`, `package-info`, `commit`, `environment-variables`, `schema-display`, `snippet`): only use later if a real `viz` or artifact payload needs that specific display.
- `@ai-elements/agent`, `@ai-elements/context`, `@ai-elements/checkpoint`, `@ai-elements/confirmation`, `@ai-elements/open-in-chat`, `@ai-elements/plan`, `@ai-elements/queue`: evaluate only if implementation discovers a matching old behavior; do not add speculative UI.

Registry inventory source:

- Official registry: `https://elements.ai-sdk.dev/api/registry/registry.json`
- Relevant docs additionally checked: prompt input, tool, artifact, attachments, suggestion.

Use COSS only as support polish, not as the core chat system:

- COSS may help with spinner, tooltip, toast, input-group, scroll-area, or command-like sidebar UI.
- Do not replace AI Elements `conversation/message/prompt-input/sources` with COSS blocks.

Official docs consulted:

- https://elements.ai-sdk.dev/components/conversation
- https://elements.ai-sdk.dev/components/message
- https://elements.ai-sdk.dev/components/prompt-input
- https://elements.ai-sdk.dev/components/reasoning
- https://elements.ai-sdk.dev/components/sources
- https://elements.ai-sdk.dev/components/inline-citation
- https://elements.ai-sdk.dev/components/chain-of-thought
- https://elements.ai-sdk.dev/components/task
- https://github.com/vercel/ai-elements

## Behavior Clone Checklist

### Route And Page Composition

- `/app/ai` stays composer-only.
- `/app/ai/:sessionId` hydrates a session transcript, attaches to any active turn, and renders chat.
- Empty active session renders a clean empty state plus composer.
- Active chat renders a flat message list, no branch tree unless old behavior already had one.
- Desktop supports a right rail for sources/artifacts; mobile uses a sheet/drawer.
- Opening sources clears artifacts and vice versa.
- Transcript load failures show a recoverable banner with retry, not a destructive full-page crash.

### Session And Sidebar Behavior

- Fetch chat list with `GET /v1/sessions?limit=50`.
- Filter client-side by search query if we build search in this phase.
- Show `is_generating` on session rows.
- Click session navigates to `/app/ai/:sessionId`.
- Ctrl/Cmd-click opens a new tab unless the row is generating.
- Rename uses `PATCH /v1/sessions/{id}`.
- Empty rename becomes untitled fallback text.
- Delete uses `DELETE /v1/sessions/{id}`.
- Deleting the active session routes back to `/app/ai`.
- Keep document title in sync with active chat title.

### Transport And Streaming

- Maintain same-origin cookie behavior.
- Store `Last-Event-ID` in memory and `sessionStorage` by session id.
- `GET /stream` sends `Last-Event-ID` when present.
- Terminal `done` and `error` clear the stored cursor.
- `GET /stream` returning `204` falls back to transcript fetch.
- The SSE parser must expose frame metadata before reducer work starts:
  - `id`
  - `event`
  - parsed JSON payload
- Protocol events should be a discriminated union, not `Record<string, unknown>` bags. Cursor handling depends on the frame `id`, while reducer handling depends on the parsed protocol `type`.
- Sending while a turn is active cancels the active turn, waits for it to settle, then sends the new turn.
- `409` from send triggers cancel-and-retry-once.
- Stream ending without `done` or `error` is treated as a network failure.
- If `meta` was seen before a stream failure, persist/render a partial errored assistant card.
- If send fails before accepted stream/meta, keep composer text.

### Message State Model

- Port the legacy message identity contract first, then add typed adapters around it. Do not reshape the core clone model in a way that breaks old behavior.
- Preserve legacy identity fields used by scroll anchoring and actions:
  - `messageId`
  - `conversationId`
  - `parentMessageId`
  - `isCreatedByUser`
  - `content`
  - `stepRecord`
  - `durationMs`
  - `isThinking`
  - `ts`
  - `hasBackendId`
  - `synthesized`
- Expose a typed render model as a discriminated union after projection:
  - `UserMessage`
  - `AssistantMessage`
- Assistant-only fields must be unavailable on user messages at the type level:
  - blocks
  - timeline
  - sources
  - clarify
  - usage
  - feedback
  - turnStatus
  - streamError
- Transcript projection and live stream reduction must share the same reducer.
- Dedupe persisted plus live assistant turns by backend assistant `message_id`.
- `meta.message_id` and `meta.user_message_id` become canonical ids immediately.
- `delta` appends only to final assistant prose.
- `thinking` never enters final answer prose.
- `step` events merge by `step_id`.
- `done.status` maps to visible `complete`, `awaiting_input`, or `cancelled`.

### Message Rendering

- User messages are right-aligned bubbles.
- Assistant messages are full-width, readable, and aligned with AI Elements `Message`.
- Assistant content order follows `parts`/blocks order: markdown and viz interleaved correctly.
- Markdown uses AI Elements `MessageResponse`/Streamdown, with incomplete markdown support during streaming.
- Message actions include at least copy, feedback, retry/regenerate where old behavior supported them.
- Cancelled turns render `You stopped this response.`
- Partial stream errors render after partial prose, not as a separate unrelated toast only.
- Assistant feedback hydrates from transcript and persists through the feedback endpoint.

### Citations And Sources

- Preserve citation marker grammar: parse `[n]` markers in markdown text nodes only.
- Do not treat code block markers as citations.
- External sources become inline citation chips.
- DB citations do not become inline citation pills.
- Sources strip appears only after `complete` or `cancelled`, never mid-stream.
- Sources strip includes cited external sources.
- Sources strip includes one `Counselle data` card when DB-backed prose or viz cells were used.
- Source panel/sheet supports:
  - heading count
  - focus on open
  - close button
  - Esc close
  - active row jump/flash
  - shared right rail behavior

### Activity, Thinking, Steps

- Activity trace is collapsed by default.
- Live turns show activity state, timer, and cycling activity label.
- Settled states stop live animation.
- Expanded view shows thinking lines and step rows in stream order.
- Step rows merge `start` and `end/error` by `step_id`.
- Search steps may show query/result receipts.
- DB/sql/viz internals stay hidden unless old behavior revealed them.
- Source chips on steps are capped/deduped like old behavior.

### Clarify

- Clarify widget is inline, not modal.
- Single-select answers submit immediately.
- Multi-select toggles chips, then sends joined labels.
- `Other` opens free text; Enter/Send submits it.
- Persisted/frozen clarify answers render inert.
- Composer placeholder changes to `Pick one, or just type...` while awaiting clarify.
- The normal composer remains editable while awaiting clarify.
- Any arbitrary typed composer submission while awaiting clarify is a valid clarify answer.
- Clarify answer resume must not create an editable user bubble if backend marks it synthesized.

### Composer

- Use AI Elements `PromptInput` for the full chat composer if it can preserve behavior cleanly.
- Keep current source toggles: Web, `.edu`, Reddit.
- Preserve legacy subreddit subset selection, not just the top-level Reddit toggle.
- Preserve per-session `selectedSubreddits` state.
- Preserve the exact legacy subreddit menu and order:
  - `r/ApplyingToCollege`
  - `r/chanceme`
  - `r/financialaid`
  - `r/premed`
  - `r/csMajors`
- Before frontend implementation relies on the menu, align the existing backend asset/test contract with the legacy five-item menu:
  - `config/assets/subreddit_menu.yaml` must not expose a sixth `{school}` entry for this clone.
  - `tests/test_settings.py` must assert exactly these five items in this order, not loose membership plus `len(menu) == 6`.
- Preserve exact wire mapping for `reddit_subreddits`:
  - `null` means full subreddit menu.
  - an array means the selected subset.
  - disabled Reddit sends the disabled wire shape used by the existing source-config adapter.
- Preserve selected source config per session.
- Use sticky session source config from backend when hydrating transcript/session.
- Preserve keyboard behavior:
  - `Enter` sends when enter-to-send is on.
  - `Shift+Enter` inserts newline.
  - If enter-to-send is off later, plain Enter inserts newline and Ctrl/Cmd+Enter sends.
  - IME composition is guarded.
- Stop button cancels active turn.
- New send during active generation follows cancel-then-send behavior.

### Scroll

- Opening an existing conversation jumps to bottom.
- Sending a question anchors the new user question near the top and streams answer below.
- User wheel/touch while streaming disables forced follow.
- Bottom scroll button appears when more than 100px from bottom.
- Reattach/replay should not create jumpy duplicate scroll behavior.

## Proposed File Structure

Keep the chat page isolated under a new feature folder:

- `frontend/src/features/ai-chat/AiChatRoute.tsx`
- `frontend/src/features/ai-chat/AiChatPage.tsx`
- `frontend/src/features/ai-chat/useChatSession.ts`
- `frontend/src/features/ai-chat/useTurnEngine.ts`
- `frontend/src/features/ai-chat/useQuestionAnchoredScroll.ts`
- `frontend/src/features/ai-chat/model.ts`
- `frontend/src/features/ai-chat/turn-reducer.ts`
- `frontend/src/features/ai-chat/project-transcript.ts`
- `frontend/src/features/ai-chat/components/ChatMessages.tsx`
- `frontend/src/features/ai-chat/components/ChatMessage.tsx`
- `frontend/src/features/ai-chat/components/ChatComposer.tsx`
- `frontend/src/features/ai-chat/components/ActivityTrace.tsx`
- `frontend/src/features/ai-chat/components/ClarifyWidget.tsx`
- `frontend/src/features/ai-chat/components/CitationRenderer.tsx`
- `frontend/src/features/ai-chat/components/MessageSources.tsx`
- `frontend/src/features/ai-chat/components/SourcesRail.tsx`
- `frontend/src/features/ai-chat/components/VizBlock.tsx`
- `frontend/src/features/ai-sidebar/ChatSessionList.tsx`
- `frontend/src/features/ai-sidebar/ChatSessionRow.tsx`
- `frontend/src/features/ai-sidebar/ChatSessionActions.tsx`

State ownership:

- `api/chat` query hooks own session list, session detail, transcript hydrate, rename, delete, and feedback.
- `features/ai-chat` owns only ephemeral live-turn state and render adapters.
- `features/ai-sidebar` owns persistent sidebar rendering for chat sessions because route components remount on pathname changes.

Extend `api/chat`:

- `frontend/src/api/chat/types.ts`
- `frontend/src/api/chat/transport.ts`
- `frontend/src/api/chat/cursor.ts`
- `frontend/src/api/chat/transcript.ts`
- `frontend/src/api/chat/sessions.ts` if separate transport grouping is cleaner.
- `frontend/src/api/chat/hooks.ts`

Replace:

- `frontend/src/features/ai-composer/AiConversationPendingRoute.tsx`

Router remains:

- `frontend/src/app/router.tsx`

Shared test harness additions:

- `frontend/src/test/render-app.tsx`

## Implementation Phases

### Phase 1: Install And Inspect AI Elements

Add the likely required components from `frontend/`:

```bash
npx shadcn@latest add \
  @ai-elements/conversation \
  @ai-elements/message \
  @ai-elements/prompt-input \
  @ai-elements/reasoning \
  @ai-elements/chain-of-thought \
  @ai-elements/sources \
  @ai-elements/inline-citation \
  @ai-elements/tool \
  @ai-elements/task \
  @ai-elements/artifact \
  @ai-elements/code-block \
  @ai-elements/suggestion \
  @ai-elements/shimmer
```

If `npx shadcn` is broken in the local Node cache, use the project-compatible alternative already proven for this branch:

```bash
bunx --bun shadcn@latest add @ai-elements/message
```

Then inspect generated files before using them. Confirm:

- imports match project aliases
- dependencies were added correctly
- `MessageResponse`/Streamdown global CSS requirement is handled
- AI Elements styles use project theme variables
- no generated component violates local shadcn/base-ui composition patterns
- generated registry files stay in `src/components/ai-elements/*`
- no Counselle-specific behavior is added directly to generated AI Elements files unless there is no cleaner adapter path
- every installed AI Element has a concrete mapping to old behavior before it is surfaced in the UI
- components that are not behavior-backed remain unrendered even if installed as dependencies

### Phase 2: Complete Chat Transport

Add methods:

- `listSessions`
- `getSession`
- `renameSession`
- `deleteSession`
- `sendMessage`
- `attachStream`
- `cancelActiveTurn`
- `setMessageFeedback`

Add cursor persistence:

- session-scoped `Last-Event-ID`
- in-memory cache plus `sessionStorage`
- clear on terminal events
- read before attach

Add typed SSE parsing:

- `SseFrame<T>` with `id`, `event`, and parsed `data`.
- `ProtocolEvent` as a discriminated union keyed by `type`.
- A conversion layer from raw frame to typed protocol event.
- Cursor updates use frame ids, never protocol payload guesses.

Transport tests:

- sends JSON/wire config correctly
- includes `Last-Event-ID` on attach
- clears cursor on terminal event
- treats protocol `error` as rejected/terminal
- handles `204` attach as inactive stream
- handles non-JSON/API errors through existing `TransportError`

Query hooks:

- `useChatSessions`
- `useChatSession`
- `useRenameChatSession`
- `useDeleteChatSession`
- `useMessageFeedback`
- mutations invalidate or update the exact TanStack Query keys they own.

### Phase 3: Port Reducer And Projection

Port behavior, not old styling:

- `turn-reducer`
- transcript projection
- source/citation helpers
- viz block normalization
- usage/error/feedback/status normalization

Tests:

- transcript entries project into `ChatMessage`
- live `delta` builds markdown blocks
- `viz` interleaves with markdown blocks
- `thinking` and `step` build timeline without entering final text
- `step` start/end/error merge by `step_id`
- sources and DB-backed flags are preserved
- missing terminal becomes stream failure
- live/persisted dedupe by `message_id`

### Phase 4: Build Turn Engine

Implement a hook equivalent to old `useTurnEngine`, adapted to new route shape. Keep remote data in TanStack Query and live stream state in this hook:

- hydrate transcript on route mount
- attach active stream after hydrate
- compose `messages = persisted + live`
- create optimistic user message
- reconcile ids from `meta`
- submit new message
- regenerate / retry
- cancel
- clarify answer submit
- normal composer submit as clarify answer while awaiting clarify
- active send cancel-then-send
- 409 cancel-and-retry-once
- pre-stream failure restores composer text
- accepted stream failure keeps partial errored card

Tests:

- open route hydrates transcript and attaches stream
- `204` attach falls back to transcript-only
- first send/new route behavior stays compatible with current composer
- follow-up send appends optimistic user and streams assistant
- active send cancels first then sends second
- 409 retries once after cancel
- missing terminal renders partial errored assistant
- cancel renders cancelled state
- clarify answer resumes correctly

### Phase 5: Build AI Elements Chat UI

Use:

- `Conversation`, `ConversationContent`, `ConversationScrollButton`
- `Message`, `MessageContent`, `MessageResponse`, `MessageActions`, `MessageAction`
- `PromptInput`, `PromptInputTextarea`, `PromptInputSubmit`
- `Sources`, `SourcesTrigger`, `SourcesContent`, `Source`
- `Reasoning` or `Tool`/`Task` for activity trace depending on actual generated API fit

Build custom adapters where needed:

- `ActivityTrace` maps Counselle `thinking`/`step` protocol to AI Elements-like visual language.
- `CitationRenderer` preserves old citation parsing and only uses AI Elements inline citation if it can match old semantics.
- `MessageSources` preserves old DB/external strip logic.
- `ClarifyWidget` preserves exact old interaction.
- `VizBlock` renders known render specs. Unknown specs degrade visibly but safely.

Design requirements:

- Match current dark workspace language and tokens.
- Avoid nested cards.
- Keep chat dense and operational, not a marketing layout.
- Message column should be readable on desktop and mobile.
- Keep composer geometry behavior equivalent to the old page. Do not make the composer fixed/sticky unless anchor placement, bottom-jump, replay, and resize behavior are proven equivalent in tests and browser QA.
- Right rail should not overlap content; mobile source rail becomes a sheet.

### Phase 6: Sidebar Chat List Integration

Add chat sessions to the current sidebar or an AI-specific subpanel without disrupting existing workspace nav. This is required clone scope, not optional.

Required behavior:

- show recent sessions
- active session highlight
- generating indicator
- client-side search
- rename
- delete
- Ctrl/Cmd-click opens a new tab unless the row is generating
- route to `/app/ai/:sessionId`
- deleting active route sends user to `/app/ai`
- blank/whitespace rename becomes the old untitled fallback text before `PATCH`. Do not send blank title to the backend because backend returns `422`, and do not treat blank rename as cancel/no-op because that changes old behavior.
- pagination/load more is required only if the old UI exposed it in the visible session list behavior for this scope; otherwise fetch `limit=50` like the old implementation.

### Phase 7: Tests And QA

Unit tests:

- reducer/projection/citations/cursor/transport

Required test scenarios:

- Reducer: transcript assistant with markdown, viz, steps, thinking, sources, usage, feedback projects to the same visible contract as old UI.
- Reducer: live `delta`, `viz`, `thinking`, and `step` events preserve ordering and do not put thinking into final prose.
- Reducer: `step` start/end/error merge by `step_id`.
- Reducer: missing terminal after `meta` yields partial errored assistant; missing terminal before `meta` restores composer text.
- Cursor: stream frame ids are stored, sent as `Last-Event-ID`, and cleared on `done`/`error`.
- Transport: `GET /stream` `204` becomes inactive stream state and triggers transcript-only render.
- Transport: `POST /messages` `409` path supports cancel-and-retry-once.
- Source config: top-level toggles and selected subreddit subsets map to the exact `reddit_subreddits` wire shape.
- Source config: subreddit menu is exactly the legacy five items in the legacy order.
- Source config: backend asset/test contract is updated to exactly the same five-item order before frontend uses it.
- Citations: `[n]` markers inside markdown text become external inline citations; markers inside code blocks do not; DB sources do not become inline pills.
- Clarify: widget single-select, multi-select, Other free text, frozen answer, and normal composer answer all work.
- Sidebar: list/search/active/generating/rename/delete/Ctrl-Cmd open behavior matches old UI.

Route/component tests:

- transcript hydrate
- stream append
- attach replay
- missing terminal
- cancel
- clarify
- feedback
- sources rail
- composer keyboard
- active send cancel-then-send
- selected subreddit subset persistence by session
- blank rename normalizes to the untitled fallback before backend call

Browser QA:

- desktop `/app/ai/:sessionId`
- mobile `/app/ai/:sessionId`
- long transcript
- active stream
- user scroll interruption
- sources rail/sheet
- clarify inline answer
- cancelled stream
- partial stream error

Browser QA scenarios and expected outcomes:

- Desktop hydrate: open `/app/ai/:sessionId` with a transcript. Expected: messages render, active nav highlights AI, document title matches session, scroll starts at bottom.
- Desktop active stream: mock/real stream emits `meta`, `thinking`, `step`, `delta`, `sources`, `usage`, `done`. Expected: user bubble appears, activity trace animates then settles, assistant prose streams, source strip appears only after terminal.
- Desktop reattach: refresh while stream is active with stored cursor. Expected: `Last-Event-ID` is sent, replayed events do not duplicate the assistant card, stream continues.
- Desktop scroll interruption: scroll upward during streaming. Expected: automatic bottom follow stops and scroll button appears after threshold.
- Desktop source rail: click source strip. Expected: right rail opens, focus lands in rail, Esc closes, active row can jump/flash.
- Mobile source sheet: click source strip. Expected: sheet opens without horizontal overflow or content overlap.
- Clarify: receive clarify event and `done.awaiting_input`. Expected: inline widget appears, composer placeholder changes, typing in normal composer sends an answer.
- Cancel: stop during active stream. Expected: cancel endpoint called, terminal cancelled state shows `You stopped this response.`
- Partial error: stream ends after `meta` and some `delta` without terminal. Expected: partial prose remains with inline stream error.
- Sidebar: search, rename, delete, active highlight, generating spinner, and Ctrl/Cmd-click behavior all match old UI.

Required checks before commit:

```bash
cd frontend
npm run typecheck
npm run lint
npm test
```

## Risks And Decisions

### AI Elements vs Custom State

Decision: use AI Elements as UI primitives only.

Reason: Counselle has a custom backend SSE protocol with `step`, `thinking`, `viz`, `clarify`, source registry events, Last-Event-ID replay, and persisted transcript semantics. Forcing it into AI SDK `useChat` risks losing behavior. AI Elements remain valuable because they are source components built on shadcn and compose cleanly around custom state.

### Inline Citation

Decision: preserve the old citation parser first. Use AI Elements `inline-citation` only if it can be adapted without changing semantics.

Reason: Old behavior deliberately parses `[n]` only in markdown text nodes and excludes code blocks. DB citations are intentionally not inline pills. This is product honesty behavior, not decoration.

### Activity Trace

Decision: start from old `ReasoningTrace` behavior and redesign it with AI Elements `reasoning`, `tool`, or `task` only where the mapping is exact.

Reason: The old activity timeline hides DB/sql/viz internals while surfacing search/tool steps. That is a product behavior choice and must survive the redesign.

### Chat List Scope

Decision: include chat list/search/title/rename/delete/new-tab behavior in the clone scope.

Reason: Old chat page includes these behaviors. A claim of exact clone includes them.

## Review Gates

After writing implementation code, launch at least:

- `code-reviewer`: general correctness, maintainability, clone fidelity risks.
- `typescript-reviewer`: type safety, async/state bugs, React hooks correctness.
- `security-reviewer`: auth/session ownership assumptions, unsafe rendering, external links, markdown/citation XSS risk.
- `e2e-runner` or manual browser QA: desktop/mobile chat flow, source rail, clarify, scroll behavior.

Before implementation, review this plan for:

- missing old behavior
- incorrect backend contract
- inappropriate AI Elements mapping
- file architecture risks
- test gaps

## Acceptance Criteria

The chat page is done only when:

- `/app/ai/:sessionId` hydrates real transcript and attaches active streams.
- Sending follow-up messages uses the real backend and streams into the UI.
- Reattach with `Last-Event-ID` works across refresh.
- Missing terminal stream is treated as failure, not success.
- Cancel, retry/regenerate, clarify, feedback, sources, activity trace, and citations behave like the old UI.
- The UI is fully redesigned into the new app language using AI Elements where appropriate.
- The old LibreChat/vendor visual structure is not copied.
- Tests cover the behavior contracts above.
- Reviewers do not find unresolved high-confidence clone fidelity or correctness issues.
