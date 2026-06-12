# Vendored LibreChat source

Cloned from **danny-avila/LibreChat** (MIT — see `LICENSE` in this directory).

- **Pinned commit:** `197a1dc4e263a7925f8e86a2a691ac4d7aa31829`
- **Vendored:** 2026-06-11
- Re-syncs are deliberate tasks against this commit. Never restyle a file in
  `vendor/` — every change here is a *subtraction* (feature MVP2 doesn't have)
  or a *props rewire*, recorded below. Tailwind classes and JSX structure stay
  byte-identical.

## Directory map

| Directory | Upstream path |
|---|---|
| `client/` | `packages/client/src` (the `@librechat/client` workspace package) |
| `app/` | `client/src` subset (same relative paths; vendored per-surface in FE-1…FE-5) |

Sibling files copied verbatim from upstream `client/`:

| Our path | Upstream path |
|---|---|
| `frontend/tailwind.config.cjs` | `client/tailwind.config.cjs` (content globs adapted to this repo; tokens untouched) |
| `frontend/postcss.config.cjs` | `client/postcss.config.cjs` |
| `frontend/src/styles/style.css` | `client/src/style.css` |
| `frontend/src/styles/mobile.css` | `client/src/mobile.css` |
| `frontend/public/fonts/` | `client/public/fonts/` (9 .woff2: Inter + Roboto Mono) |
| `app/locales/en/translation.json` | `client/src/locales/en/translation.json` |

## Mechanical transform (whole `client/` tree)

- All internal `'~/...'` module specifiers rewritten to `'@librechat/client/...'`
  (sed pass at vendor time) so the package's self-alias can't collide with the
  app-files alias (`~` → `vendor/librechat/app`). No other content changed.

## Subtractions & patches (`client/`)

| File(s) | Change | Why |
|---|---|---|
| `components/DataTable.tsx`, `components/DataTable/` | deleted (+ exports removed from `components/index.ts`) | needs `@tanstack/react-table`/`react-virtual`; no data-table surface in MVP2 |
| `components/InputOTP.tsx` | deleted (+ export) | 2FA dropped (PRD decision 6); needs `input-otp` |
| `components/InputNumber.tsx` | deleted (+ export) | needs `rc-input-number`; unused by our surfaces |
| `hooks/useAvatar.ts` | deleted (+ export) | dicebear-generated avatars dropped |
| `components/Avatar.tsx` | patch: `useAvatar` call removed; renders `user.avatar` URL or their default icon | same |
| `utils/cloudfront.ts` | deleted (+ export) | their file-upload CDN helper; file uploads dropped |
| `locales/i18n.ts` | deleted | i18next replaced (below) |
| `locales/*` (non-en) | deleted | English-only (PRD) |
| `hooks/useLocalize.ts` | **reimplemented**: flat English lookup over the vendored en translation JSONs, `{{var}}` interpolation, dev-mode missing-key warn | drops i18next/react-i18next; strings stay byte-identical |
| `*.spec.*` (9 files) | deleted | their test files; we don't run their suite |
| `librechat-data-provider` imports | package never installed; typed stub at `src/types/librechat-data-provider.d.ts` | type-only imports remain (TUser, TFile) |

## app/ — FE-2 (composer + landing)

### Vendored files

| Our path (under `app/`) | Upstream path | Status |
|---|---|---|
| `utils/textarea.ts` | `client/src/utils/textarea.ts` | verbatim |
| `utils/drafts.ts` | `client/src/utils/drafts.ts` | adapted (see below) |
| `hooks/Chat/useFocusChatEffect.ts` | `client/src/hooks/Chat/useFocusChatEffect.ts` | verbatim |
| `hooks/Input/useTextarea.ts` | `client/src/hooks/Input/useTextarea.ts` | stripped + rewired |
| `hooks/Input/useHandleKeyUp.ts` | `client/src/hooks/Input/useHandleKeyUp.ts` | no-op stub (all command triggers removed) |
| `hooks/Input/useAutoSave.ts` | `client/src/hooks/Input/useAutoSave.ts` | stripped + rewired |
| `components/Chat/Input/SendButton.tsx` | `client/src/components/Chat/Input/SendButton.tsx` | verbatim |
| `components/Chat/Input/StopButton.tsx` | `client/src/components/Chat/Input/StopButton.tsx` | verbatim |
| `components/Chat/Input/CollapseChat.tsx` | `client/src/components/Chat/Input/CollapseChat.tsx` | verbatim |
| `components/Chat/Input/ConversationStarters.tsx` | `client/src/components/Chat/Input/ConversationStarters.tsx` | adapted (see below) |
| `components/Chat/Input/ChatForm.tsx` | `client/src/components/Chat/Input/ChatForm.tsx` | stripped + rewired (see below) |
| `components/Chat/Landing.tsx` | `client/src/components/Chat/Landing.tsx` | stripped + rewired (see below) |
| `components/Chat/Header.tsx` | `client/src/components/Chat/Header.tsx` | stripped (see below) |
| `components/Chat/Footer.tsx` | `client/src/components/Chat/Footer.tsx` | stripped: GTM/markdown/config links out; fixture text; container classes + separator byte-identical |
| `Providers/CustomFormContext.tsx` | `client/src/Providers/CustomFormContext.tsx` | verbatim |
| `Providers/ChatFormContext.tsx` | `client/src/Providers/ChatFormContext.tsx` | verbatim |

### Post-review corrections (orchestrator, after the FE-2 gate failed visual review)

- **ChatView (`@/app/ChatView.tsx`)**: rebuilt as a structural clone of upstream
  `ChatView.tsx` — ChatFormProvider owns the form; Landing + ChatForm +
  ConversationStarters live in one centered column (Landing's `sm:max-h-0`
  collapse trick requires this exact parent); Footer in both positions.
  The agent's first version wrapped Landing in `overflow-hidden`, hiding the
  greeting entirely, and parked the chips at the top of the page.
- **`ConversationStarters.tsx`**: re-vendored as the faithful clone — render
  block byte-identical, no props, starters from the config fixture, click
  SUBMITS via ChatContext (upstream behavior), `MAX_CONVO_STARTERS = 4`.
- **`Landing.tsx`**: chips removed from inside Landing (upstream renders them
  in ChatView below the composer).
- **`ChatForm.tsx`**: form methods now come from `useChatFormContext()`
  (upstream pattern) — removed the agent's `window.__counselle*` global hack
  and the dead `showStopButton` state.
- **`hooks/Input/useTextarea.ts`**: placeholder effect restored (upstream's
  debounced setter; sender fixed to "Counselle" → "Message Counselle").
- **`@/components/source-control/SourceDropdown.tsx`** (Counselle-native):
  trigger re-styled with upstream AttachFileMenu's trigger classes (it had
  copied the Send button's filled circle); removed the Ariakit-only
  `.popover-ui` class that kept the Radix popover at `display:none`.

### Subtractions per file

**`utils/drafts.ts`**
- `LocalStorageKeys` / upstream constants removed; inline strings used (`librechat.textDraft.`, `librechat.filesDraft.`)
- File-draft functions removed (`getFileDraft`, `setFileDraft`, `clearFileDraft`)

**`hooks/Input/useTextarea.ts`**
- File handling, agentsMap, assistantMap, placeholder logic, `checkHealth` removed
- `isNotAppendable` frozen `false`
- All Mention / Prompts / Skills popover triggers stripped
- `enterToSend` → `useAtomValue(enterToSendAtom)` (jotai)
- `isSubmitting` → `useChatContext()`

**`hooks/Input/useAutoSave.ts`**
- File draft logic entirely removed
- `useChatFormContext()` → `setValue` passed as prop
- `saveDrafts` atom → always-on (no toggle)
- `LocalStorageKeys` / `Constants` → inline from our `drafts.ts`

**`components/Chat/Input/ConversationStarters.tsx`**
- Endpoint / entity / agentsMap / assistantMap resolution removed
- Receives `starters: string[]` and `onSelect: (text: string) => void` props directly
- `MAX_STARTERS = 4` (same as upstream)

**`components/Chat/Input/ChatForm.tsx`**
- Files / AttachFileChat / FileFormChat removed
- TextareaHeader (multi-convo add-convo) removed
- PendingManualSkillsChips / BadgeRow / EditBadges removed
- AudioRecorder / StreamAudio / SpeechToText / TextToSpeech removed
- Mention / PromptsCommand / SkillsCommand command popovers removed
- Endpoint guard, requiresKey, invalidAssistant, disableInputs removed
- modelSpec / hideBadgeRow / conversation spec / isAgentsEndpoint checks removed
- `maximizeChatSpace` frozen `false`; `isTemporary` frozen `false`; `isRTL` frozen `false`
- `chatDirection`, `automaticPlayback`, `chatBadges`, `isEditingBadges` removed
- `useQueryParams`, `useAddedChatContext`, `useAssistantsMapContext`, `useAgentsMapContext` removed
- `useGetStartupConfig` removed
- `showStopButton` → eliminated; render condition is `isSubmitting ? <StopButton/> : <SendButton/>` directly
- `useChatContext` → our `ChatContext` (conversationId, isSubmitting, submitMessage, stopGenerating)
- `enterToSend` → jotai atom

**`components/Chat/Landing.tsx`**
- ConvoIcon / endpoint resolution / agentsMap / assistantMap removed
- `useGetEndpointsQuery` / `useGetStartupConfig` / `useAuthContext` removed
- BirthdayIcon / TooltipAnchor icon row removed
- entity / modelSpec / brandedSpec logic removed
- Time-based greeting replaced with `APP_CONFIG.greeting` fixture
- description / HTML sanitizer removed
- season note added from `APP_CONFIG.season_note`

**`components/Chat/Header.tsx`**
- ModelSelector, PresetsMenu, BookmarkMenu, AddMultiConvo, ExportAndShareMenu, TemporaryChat removed
- Retained: outer gradient div (byte-identical classes), OpenSidebar on small screens only

### Counselle-native additions (not in upstream)

| File | Description |
|---|---|
| `src/components/source-control/SourceDropdown.tsx` | Radix Popover — Database (fixed on), Web/edu/Reddit toggles, Reddit subreddit checkboxes; per-conversation persistence in `localStorage` at `counselle:sourceConfig:<conversationId>` |
| `src/api/mock/fixtures/config.ts` | `APP_CONFIG`: greeting, season_note, 4 conversation_starters |
| `src/api/mock/sourceStore.ts` | `getSourceConfig` / `updateSourceConfig` — typed source config store with defaults |

## app/ — FE-3 (messages & streaming)

### Vendored verbatim (alias-normalized diff = empty)

| Our path (under `app/`) | Upstream path |
|---|---|
| `components/Chat/Messages/Content/MarkdownBlocks.tsx` | same (the per-block memoization core — **byte-identical**) |
| `components/Chat/Messages/Content/splitMarkdown.ts` | same — **byte-identical** |
| `components/Chat/Messages/Feedback.tsx` | same — **byte-identical** (works as-is over the data-provider shim) |
| `components/Chat/Messages/SubRow.tsx` | same — **byte-identical** |
| `components/Chat/Messages/ui/PlaceholderRow.tsx` | same — **byte-identical** |
| `components/Messages/Content/CopyButton.tsx` | same — **byte-identical** |
| `components/Messages/Content/useCopyCode.ts` | same — **byte-identical** |
| `components/Messages/Content/LangIcon.tsx` / `langIconPaths.ts` | same — **byte-identical** |
| `utils/languages.ts` (`langSubset`) | `client/src/utils/languages.ts` — **byte-identical** |
| `hooks/Messages/messageLayout.ts` | same — **byte-identical** |
| `Providers/MessageContext.tsx`, `Providers/CodeBlockContext.tsx`, `Providers/ArtifactContext.tsx` | same — **byte-identical** |

### Stripped / rewired (subtractions per file header comment)

| Our path (under `app/`) | Key changes |
|---|---|
| `components/Chat/Messages/MessagesView.tsx` | MultiMessage tree recursion → flat map over ChatContext messages; MessageNav dropped; `useMessageScrolling` → `@/app/useQuestionAnchoredScroll` (PRD-mvp2 decision 8); screenshot/provider dropped. Scroll container structure + classes byte-identical |
| `components/Chat/Messages/Message.tsx` | + `useMessageProcess` collapsed in: children recursion dropped; `effectiveIsSubmitting` computed for the latest message; throttled abort-scroll kept |
| `components/Chat/Messages/ui/MessageRender.tsx` | siblings/parallel-content/endpoint icons dropped; fontSize frozen `text-base` (FE-5 wires); memo comparator keeps upstream shape with reducer fields (`content` reference, `activity`, `streamError`) |
| `components/Chat/Messages/Content/MessageContent.tsx` | `:::thinking` parse dropped (protocol events instead); `enableUserMsgMarkdown` frozen true; assistant messages render reducer `content` blocks (markdown → `<Markdown>`, viz → `@/components/viz/VizPlaceholder`); mid-stream `streamError` appended after partial prose; UnfinishedMessage text = "You stopped this response." (cancelled turns) |
| `components/Chat/Messages/Content/Markdown.tsx` | LaTeX (recoil `LaTeXParsing` + `preprocessLaTeX`) dropped; `result-thinking` init placeholder kept |
| `components/Chat/Messages/Content/MarkdownLite.tsx` | math/katex + ArtifactProvider dropped |
| `components/Chat/Messages/Content/markdownConfig.ts` | remark: `[supersub, remarkGfm]` (math/directive/artifact/citation/MCP-UI dropped); rehype: highlight only; lazy-cached getter pattern kept verbatim |
| `components/Chat/Messages/Content/MarkdownComponents.tsx` | math/mermaid branches dropped; `canRunCode` frozen false; `a` → plain `target="_blank" rel="noopener noreferrer"` anchor (file-download branch dropped); `img` src passthrough |
| `components/Chat/Messages/Content/MarkdownErrorBoundary.tsx` | math/artifact dropped; **type-level patch**: rehype plugin array cast `as PluggableList` (rehype-highlight@6 nests its own vfile → Plugin type mismatch under TS 5.9) — same cast in MarkdownLite/markdownConfig |
| `components/Chat/Messages/Content/EditMessage.tsx` | user-message-only editing (PRD decision 4); Save & Submit → `ask({text, messageId})` (truncate-and-re-ask); Save → `updateMessageText`; siblings/RTL/file overrides dropped; classes + shortcuts byte-identical |
| `components/Chat/Messages/Content/Container.tsx` | Files/SkillPills rows dropped; container classes byte-identical |
| `components/Chat/Messages/HoverButtons.tsx` | audio/Fork/Continue dropped; `useGenerationsByLatest` → flat-list derivations (regenerate: latest assistant msg, not submitting; edit: user msgs only); HoverButton + classes byte-identical |
| `components/Chat/Messages/MessageIcon.tsx` | endpoint/assistant resolution collapsed; user chip = upstream UserAvatar fallback byte-for-byte; assistant = Counselle "C" roundel |
| `components/Messages/Content/CodeBlock.tsx` | run-code tool calls/FloatingCodeBar/plugin branch dropped; container + CodeBar + code classes byte-identical |
| `components/Messages/Content/CodeBar.tsx` | RunCode + plugin InfoIcon dropped; bar classes byte-identical |
| `components/Messages/Content/Error.tsx` | their backend error-code parser reduced to text passthrough (protocol `error.message` is already human) |
| `components/Messages/ScrollToBottom.tsx` | `maximizeChatSpace` frozen false; classes byte-identical |
| `hooks/Messages/useMessageActions.tsx` | endpoints/agents dropped; chatContext getter-object dropped (reducer blocks are reference-stable); copy = `copy-to-clipboard` over message prose; feedback via `@/api/hooks` mutation over the mock store |

### Support changes

- `Providers/index.ts`: + MessageContext / CodeBlockContext / ArtifactContext exports
- `common/index.ts`: + FE-3 message prop types (`TMessageProps`, `TMessageContentProps`, `TDisplayProps`, `TEditProps`, `CodeBarProps`, `TMessageIcon`) — upstream shapes trimmed to the flat list, `TMessage` → our `ChatMessage`
- `utils/index.ts`: + `langSubset`, `handleDoubleClick` (verbatim), `getMessageAriaLabel`/`getHeaderPrefixForScreenReader` (depth numbering dropped — flat list)
- `utils/cn.ts`: default-export alias for upstream `import cn from '~/utils/cn'` consumers
- `src/vendor/librechat-data-provider/index.ts`: + feedback types/tags/helpers (from upstream `packages/data-provider/src/feedback.ts`, zod dropped) + `TUser`/`TFile`/`TStartupConfig`; the ambient `src/types/librechat-data-provider.d.ts` stub **deleted** (it shadowed the runtime shim for tsc)
- Known upstream wart kept byte-identical: Feedback.tsx passes `bold` to lucide icons → dev-only React non-boolean-attribute warning (exists upstream too)

### Counselle-native additions (FE-3)

| File | Description |
|---|---|
| `src/api/protocol.ts` | TS mirror of the v1 protocol (architecture.md §27) incl. step/thinking, done.cancelled, the §27.5 transcript contract |
| `src/api/turn-reducer.ts` | Pure reducer: events → TurnState (ordered content blocks, merged steps, thinking, sources, usage, status); `reduceTranscriptEntry` replays persisted entries through the SAME reducer; completed blocks keep object identity (feeds the MarkdownBlocks memoization) |
| `src/api/transport.ts` | The Transport seam (sendMessage/attach/cancel/transcript) — FE-7 swaps MockTransport for HTTP without touching anything above |
| `src/api/mock/transport.ts` | MockTransport: fixture replay with latency theater, cancel → done(cancelled), attach replays the in-memory ring |
| `src/api/mock/fixtures/turns/` | dossier / simple / error / cancelled event fixtures (§27 schemas verbatim) + `deltas()` chunker |
| `src/api/mock/messagesStore.ts` | Per-chat persisted transcripts (localStorage, version-gated); truncateFrom (PRD decision 4), updateEntryText |
| `src/api/mock/feedbackStore.ts` | Thumbs feedback persistence (PRD decision 10) |
| `src/app/useQuestionAnchoredScroll.ts` | Question-anchored scrolling (PRD decision 8): sent question pins to top (spacer grows so short chats can anchor), no bottom-chasing, ↓ pill via their ScrollToBottom |
| `src/components/viz/VizPlaceholder.tsx` | FE-3 labeled card for in-stream viz blocks (FE-4 renders them properly) |

## app/ — FE-4 (the Counselle honesty surfaces)

All FE-4 components are Counselle-native (`@/components/{citations,cards,timeline,clarify}`),
built from vendored primitives + LibreChat tokens + the two `counselle.css`
semantic pairs. Vendor-file deltas (each marked `FE-4:` inline):

| File | Change |
|---|---|
| `components/Chat/Messages/Content/MessageContent.tsx` | ActivityTimeline above the prose; SourcesContext.Provider around the assistant body (inline `[n]` chips resolve); VizPlaceholder → VizCard; ClarifyWidget (frozen unless the live awaiting turn); SourcesFooter on completed answers |
| `components/Chat/Messages/Content/markdownConfig.ts` | + `remarkCitations` remark plugin; + `'citation-ref': CitationRefMarkdown` component mapping |
| `hooks/Input/useTextarea.ts` | placeholder swaps to "Pick one, or just type…" while a clarify is open (`awaitingClarify` from ChatContext) |
