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
| `components/SplitText.tsx` | **FE-6 patch**: `prefers-reduced-motion` honored — spring runs `immediate` with zero stagger when reduced (letters land at final state) | PRD story 44; upstream has no gate |

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
| `components/Chat/Input/ConversationStarters.tsx` | `client/src/components/Chat/Input/ConversationStarters.tsx` | adapted (see below); B5c: starters from `GET /v1/config` (async) |
| `components/Chat/Input/ChatForm.tsx` | `client/src/components/Chat/Input/ChatForm.tsx` | stripped + rewired (see below) |
| `components/Chat/Landing.tsx` | `client/src/components/Chat/Landing.tsx` | stripped + rewired (see below); B5c: greeting/season_note from `GET /v1/config` (async + loading fade) |
| `components/Chat/Header.tsx` | `client/src/components/Chat/Header.tsx` | stripped (see below) |
| `components/Chat/Footer.tsx` | `client/src/components/Chat/Footer.tsx` | stripped: GTM/markdown/config links out; static `APP_FOOTER` constant (B5c: not served by `/v1/config`); container classes + separator byte-identical |
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
| `components/Chat/Messages/Feedback.tsx` | B5c rewrite: reason-chip popovers (Ariakit + `getTagsForRating`) and the "other" free-text `OGDialog` **subtracted** — the backend stores only `{rating}` (reason chips are MVP3); collecting-and-discarding tags is a dishonest affordance. Now a plain two-button thumbs toggle; `buttonClasses`/`ThumbUpIcon`/`ThumbDownIcon`/`isLast` grammar byte-identical |
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
| `components/Chat/Messages/Content/EditMessage.tsx` | user-message-only editing (PRD decision 4); Save & Submit → `ask({text, messageId})`. **B5d (G3):** the plain "Save" (text-mutation-without-re-ask) + its Ctrl/⌘+S shortcut **removed** — PRD decision 4 gives it no meaning and post-seam it's a client-side lie; Save & Submit is now a real `replace_message_id` rewrite. Save&Submit/Cancel classes + shortcuts byte-identical |
| `components/Chat/Messages/Content/Container.tsx` | Files/SkillPills rows dropped; container classes byte-identical |
| `components/Chat/Messages/HoverButtons.tsx` | audio/Fork/Continue dropped; `useGenerationsByLatest` → flat-list derivations (regenerate: latest assistant msg, not submitting; edit: user msgs only). **B5d (G3):** Edit gate tightened — also requires `message.hasBackendId === true` (no `replace_message_id` for id-less / pre-MVP2 / not-yet-reconciled entries) and `synthesized !== true` (clarify-answer bubbles return 422). HoverButton + classes byte-identical |
| `components/Chat/Messages/MessageIcon.tsx` | endpoint/assistant resolution collapsed; user chip = upstream UserAvatar fallback byte-for-byte; assistant = Counselle "C" roundel |
| `components/Messages/Content/CodeBlock.tsx` | run-code tool calls/FloatingCodeBar/plugin branch dropped; container + CodeBar + code classes byte-identical |
| `components/Messages/Content/CodeBar.tsx` | RunCode + plugin InfoIcon dropped; bar classes byte-identical |
| `components/Messages/Content/Error.tsx` | their backend error-code parser reduced to text passthrough (protocol `error.message` is already human) |
| `components/Messages/ScrollToBottom.tsx` | `maximizeChatSpace` frozen false; classes byte-identical |
| `hooks/Messages/useMessageActions.tsx` | endpoints/agents dropped; chatContext getter-object dropped (reducer blocks are reference-stable); copy = `copy-to-clipboard` over message prose; B5c: tag hydration (`getTagByKey`/`toMinimalFeedback`) **removed** (`message.feedback` is just `{rating}`); feedback via `@/api/hooks` mutation over the real `POST .../feedback` with optimistic-thumb rollback on failure |

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
| `components/Chat/Messages/Content/MessageContent.tsx` | ReasoningTrace above the prose; SourcesContext.Provider around the assistant body (inline `[n]` chips resolve); VizPlaceholder → VizCard; ClarifyWidget (frozen unless the live awaiting turn). **B5d:** ClarifyWidget gains `answer={message.clarifyAnswer}` (frozen widget seeds from the persisted answer). **feat/message-ui-polish:** the collapsed sources affordance moved OUT of the prose body into the action row (now `MessageSources` in `MessageRender`) — `SourcesFooter` removed; the dead-air cover folded into ReasoningTrace's header (`ThinkingShimmer` removed). The assistant answer region is wrapped in `AnswerContexts` (`DejargonProvider` + `CitationActivateProvider` + `RevealDbProvider` locked to the `'wash'` style); user bubbles pass through with none. `revealed` flows in from `MessageRender`'s `RevealStateContext`; an inline pill's `activate` opens the sources panel jumped to that source (`cited`/`dbSchools` shared with `MessageSources`) |
| `components/Chat/Messages/ui/MessageRender.tsx` | **feat/message-ui-polish:** owns per-message reveal state (`useState` → `RevealStateProvider` around both user and assistant turns, since the shared MessageContent path calls `useRevealState()` unconditionally). The action row (assistant only) renders `RevealDbToggle` — gated on `dbIndicesForMessage(msg).size > 0` (no DB-cited clauses → no toggle) — beside `MessageSources` in the `SubRow` |
| `components/Chat/Messages/Content/markdownConfig.ts` | + `remarkCitations` remark plugin → `'citation-ref': InlineCitationMarkdown` (a DB-sourced figure renders nothing inline; an external claim renders a named `SourcePill` — the old numbered `CitationRefMarkdown`/`TierChip` chip is gone); + `remarkDbSpans` (runs AFTER `remarkCitations`, keying off its `citationRef` nodes to wrap DB-cited clauses) → `'db-claim': DbClaim` (the truthful reveal) |
| `hooks/Input/useTextarea.ts` | placeholder swaps to "Pick one, or just type…" while a clarify is open (`awaitingClarify` from ChatContext) |

## app/ — FE-5A (auth)

Mock auth (PRD stories 1–7): no backend — `src/api/mock/authStore.ts`
(localStorage `counselle:mock:auth`) + jotai `sessionUserAtom`
(`src/app/auth.ts`). Login/register accept anything and succeed instantly.

### Vendored verbatim (byte-identical)

| Our path (under `app/`) | Upstream path |
|---|---|
| `components/Auth/ErrorMessage.tsx` | same — **byte-identical** |
| `components/Auth/BlinkAnimation.tsx` | same — **byte-identical** |
| `components/Auth/Footer.tsx` | same — **byte-identical** (fixture has no privacy/ToS URLs → renders empty contentinfo, as upstream does without config) |

### Stripped / rewired (subtractions per file header comment)

| Our path (under `app/`) | Key changes |
|---|---|
| `components/Auth/AuthLayout.tsx` | Banner dropped; logo `<img>` → "Counselle" wordmark (`text-2xl font-semibold`, container div + BlinkAnimation kept); `error` prop narrowed `string` → `TranslationKeys`; everything else byte-identical incl. the `2fa` pathname check |
| `components/Auth/Login.tsx` | OpenID auto-redirect, OAuth-error toast, `redirect_to` persistence, and the `useAuthContext` error branch dropped (mock login can't fail); LoginForm props → `{ startupConfig }` only |
| `components/Auth/LoginForm.tsx` | Turnstile, resend-verification block, LDAP username, `useGetStartupConfig` dropped; submit → `login()` + session atom + `navigate('/', {replace:true})`; classes + floating-label structure byte-identical |
| `components/Auth/Registration.tsx` | username field (PRD story 4), Turnstile, invite token, register mutation + 3-s success countdown + email-verification alert, errorMessage state dropped; submit → `register()` + session atom + `navigate('/')` |
| `components/Auth/RequestPasswordReset.tsx` | mutation dropped — submit always shows the upstream "link sent" success state (`setHeaderText` + `ResetPasswordBodyText`); the `emailEnabled` inline-link branch dropped |
| `components/Auth/ResetPassword.tsx` | mutation, hidden token/userId inputs + their error spans, invalid-token `setError` path dropped; submit → local `isSuccess` + upstream success card |
| `components/Auth/SocialLoginRender.tsx` | Google only — discord/facebook/github/apple/openid/saml branches dropped; Google button → `loginWithGoogle()` + session atom + `navigate('/')`; "Or" divider + structure byte-identical |
| `components/Auth/SocialButton.tsx` | `<a href={serverDomain}/oauth/…>` → `<button onClick>` (no OAuth server); classes byte-identical |
| `components/Auth/index.ts` | VerifyEmail / ApiErrorWatcher / TwoFactorScreen exports dropped (pages not vendored — no email verification / 2FA, PRD story 4 + decision 6) |
| `routes/Layouts/Startup.tsx` | `useGetStartupConfig` → FE-5A fixture (`isFetching` frozen false); `REDIRECT_PARAM`/`SESSION_KEY` pending-redirect check + 2FA header entry dropped; `isAuthenticated` ← session atom; authed users → `'/'` (our landing) instead of `'/c/new'` |

### Not vendored

`VerifyEmail.tsx`, `TwoFactorScreen.tsx`, `ApiErrorWatcher.tsx`, the
`__tests__` folder (email verification + 2FA dropped per PRD; no API auth).

### Support changes

- `common/index.ts`: + `TLoginLayoutContext` (upstream `common/types.ts:600`; `error`/`headerText` narrowed `string` → `TranslationKeys` — our Startup passes keys straight to `localize`)
- `utils/index.ts`: + `validateEmail` (upstream `utils/email.ts`, zod schema → upstream's own Registration email regex; zod isn't a dependency)
- `src/vendor/librechat-data-provider/index.ts`: `TStartupConfig` typed (auth fields + index signature), + `TLoginUser`/`TRegisterUser`/`TRequestPasswordReset`/`TResetPassword` (trimmed: no username/token/userId), + `loginPage()`/`registerPage()`
- `components/Nav/AccountSettings.tsx`: placeholder user → `useAuthUser()`; logout MenuItem → `logout()` + atom clear + `navigate('/login')` (Settings MenuItem untouched — FE-5B wires it)
- `src/app/routes.tsx`: + StartupLayout route (`/login`, `/register`, `/forgot-password`, `/reset-password`) outside the app shell; Root wrapped in `AuthGate` (signup wall → `/login`)

### Counselle-native additions (FE-5A)

| File | Description |
|---|---|
| `src/api/mock/authStore.ts` | `MockUser` + `getSessionUser`/`login`/`register`/`loginWithGoogle`/`logout`/`updateUser`/`deleteAccount` (clears all `counselle:mock:*` keys) |
| `src/app/auth.ts` | jotai `sessionUserAtom` (hydrated from the store) + `useAuthUser()` |
| `src/api/mock/fixtures/auth.ts` | `startupConfigFixture` — the minimal fields the vendored Auth components read |

## app/ — FE-5B (settings)

### Vendored files

| Our path (under `app/`) | Upstream path | Status |
|---|---|---|
| `components/Nav/Settings.tsx` | `client/src/components/Nav/Settings.tsx` | stripped (see below) |
| `components/Nav/SettingsTabs/index.ts` | same | stripped to 3 exports |
| `components/Nav/SettingsTabs/General/General.tsx` | same | stripped + addition (see below) |
| `components/Nav/SettingsTabs/ToggleSwitch.tsx` | same | rewired Recoil→props (see below) |
| `components/Nav/SettingsTabs/DangerButton.tsx` | same | **verbatim** |
| `components/Nav/SettingsTabs/Data/Data.tsx` | same | stripped + DeleteAccount moved in |
| `components/Nav/SettingsTabs/Data/ClearChats.tsx` | same | rewired (see below) |
| `components/Nav/SettingsTabs/Account/Account.tsx` | same | stripped + Counselle rows (see below) |
| `components/Nav/SettingsTabs/Account/DeleteAccount.tsx` | same | stripped + rewired (see below) |

### Subtractions per file

**`components/Nav/Settings.tsx`**
- Chat / Commands / Speech / Personalization / Balance / About tabs dropped (MVP2
  ships exactly General, Data, Account — upstream tab order kept)
- `usePersonalizationAccess`, `useGetStartupConfig`, the `aboutEnabled` redirect
  effect, lucide tab icons (MessageSquare/Command/DollarSign/Info) dropped with them
- Type-level patch: `tabRefs` typed `Record<string, HTMLButtonElement | null>`
  (upstream's untyped `useRef({})` fails under strict TS)
- Dialog shell (HeadlessUI Dialog/Transition + Radix Tabs), all classes, the close
  button SVG, and keyboard nav byte-identical

**`components/Nav/SettingsTabs/General/General.tsx`**
- `ThemeSelector` (the Dropdown-based export) kept byte-identical
- LangSelector dropped (English-only, PRD) + js-cookie/recoil imports
- The 4 `toggleSwitchConfigs` rows dropped (enableUserMsgMarkdown / autoScroll /
  keepScreenAwake / newChatSwitchToHistory — Recoil prefs not surfaced in MVP2)
- ArchivedChats dropped (no archive feature)
- **Addition (Counselle-native):** `<DefaultSources />` row — default source config
  for new chats (`@/components/source-control/DefaultSources`, localStorage
  `counselle:sourceDefaults`)

**`components/Nav/SettingsTabs/ToggleSwitch.tsx`**
- Recoil→props rewire: RecoilToggle/JotaiToggle/`isRecoilState` branches collapse
  into one controlled component (`checked` + `onCheckedChange` props);
  `localizationKey` → pre-localized `label` string (Counselle callers pass plain
  strings). Row JSX + classes byte-identical to the upstream toggle body

**`components/Nav/SettingsTabs/DangerButton.tsx`**
- Verbatim, no subtractions. Vendored as the shared destructive-row primitive per
  the FE-5 plan; the kept tabs' rows use upstream's Button-based confirms (upstream
  only consumed DangerButton from the dropped DeleteCache/RevokeKeys rows)

**`components/Nav/SettingsTabs/Data/Data.tsx`**
- ImportConversations, SharedLinks, AgentApiKeys (+ useHasAccess/Permissions gate),
  RevokeKeys, DeleteCache dropped; the unused `confirmClearConvos` state +
  `useOnClickOutside` went with them
- DeleteAccount row added (upstream renders it in Account; the FE-5 plan moves
  account deletion into Data controls)

**`components/Nav/SettingsTabs/Data/ClearChats.tsx`**
- `useClearConversationsMutation` → mock stores: `clearAllChats()` (`@/api/mock/store`)
  + `clearAllTranscripts()` (`@/api/mock/messagesStore`, new helper that wipes
  `counselle:mock:messages:*` keys) + react-query `[QueryKeys.chats]` invalidation
- `clearAllConversationStorage` / `useNewConvo` → `navigate('/')` +
  `activeConversationIdAtom` reset (the established Convo.tsx rewire)
- Spinner select-text branch dropped (mock clear is synchronous)
- Row + OGDialogTemplate confirm JSX/classes byte-identical

**`components/Nav/SettingsTabs/Account/Account.tsx`**
- DisplayUsernameMessages toggle, Avatar upload, EnableTwoFactorItem +
  BackupCodesItem (2FA dropped, PRD decision 6), `allowAccountDeletion` startup gate
  dropped; DeleteAccount moved to the Data tab
- `useAuthContext` → `@/app/auth` `useAuthUser()` (mock session)
- **Additions (Counselle-native rows, upstream row grammar — `flex items-center
  justify-between` + Label, `pb-3` spacing):** name (inline edit, commit on
  blur/Enter → mock `updateUser` + `sessionUserAtom`), email (read-only),
  password (disabled "Reset password" button — upstream has **no in-app
  password-change dialog** at the pinned commit, only the logged-out reset flow;
  row shown for `provider === 'password'` only, mirroring upstream's `provider ===
  'local'` 2FA gate), connected-Google ("Connected", shown when `provider ===
  'google'`, hidden otherwise)

**`components/Nav/SettingsTabs/Account/DeleteAccount.tsx`**
- Whole 2FA/OTP path dropped (`needs2FA`, InputOTP usage — the client package's
  InputOTP was already deleted in FE-0)
- `useDeleteUserMutation` + `isDeleting` Spinner branch dropped (mock delete is
  synchronous); `useAuthContext` → `useAuthUser()`; delete → `@/api/mock/authStore`
  `deleteAccount()` then hard navigate `window.location.href = '/login'`
- Email-confirm lock (`isLocked`) + dialog JSX/classes byte-identical

### Other FE-5B changes

| File | Change |
|---|---|
| `components/Nav/AccountSettings.tsx` | settings wiring restored to upstream pattern: `showSettings` state + `<Settings open onOpenChange/>` rendered inside MenuProvider; Settings MenuItem `onClick={() => setShowSettings(true)}` (was the FE-1 no-op) |
| `app/common/index.ts` | + `TDangerButtonProps`, `TDialogProps` (upstream common/types.ts:452,468; `UseMutationResult<unknown>` widened to 4 type args for strict TS), `LocalizeFunction` (types.ts:89) |
| `src/vendor/librechat-data-provider/index.ts` | + `SettingsTabValues` enum (upstream packages/data-provider/src/config.ts:2366, trimmed to GENERAL/DATA/ACCOUNT) |
| `src/vendor/librechat-data-provider/index.ts` (B5c) | `TFeedback.tag` made optional — the reason-chip/free-text UI was subtracted (backend stores only `{rating}`; reason chips are MVP3) |

### Counselle-native additions (FE-5B)

| File | Description |
|---|---|
| `src/components/source-control/DefaultSources.tsx` | "Default sources" settings rows — Database fixed on, Web/.edu/Reddit toggles via the vendored ToggleSwitch; writes `counselle:sourceDefaults` |
| `src/api/mock/sourceStore.ts` | + `getDefaultSourceConfig()` / `setDefaultSourceConfig()`; `getSourceConfig` for a chat with no stored config now falls back to the user defaults instead of the hardcoded constant |
| `src/api/mock/messagesStore.ts` | + `clearAllTranscripts()` |

## app/ — B5b (real auth + account surface)

Swaps the FE-5A mock localStorage auth for the real cookie-JWT backend. The
session is now the httpOnly cookie, resolved by a TanStack Query over `GET
/v1/me`; the jotai `sessionUserAtom` is retired from the live path. Mock auth
fixtures (`src/api/mock/authStore.ts`) stay on disk (Sampler/tests) but no live
file imports them.

### Vendored import-site swaps (behavior rewired, layout/markup unchanged)

| File | Change |
|---|---|
| `components/Auth/LoginForm.tsx` | mock `login()`/jotai/`navigate` → `useLogin()` (real form-encoded `POST /v1/auth/login`); `onSubmit` is async with a loading state (`isSubmitting \|\| loginMutation.isLoading`); a 400/429/network failure renders inline via `authErrorMessage` ("Incorrect email or password.") and keeps the form; success invalidates `me` so the AuthGate + Startup land the user in the app. Floating-label form JSX byte-identical |
| `components/Auth/SocialLoginRender.tsx` | mock `loginWithGoogle()`/jotai/`navigate` → `handleGoogleLogin` fetches `GET /v1/auth/google/authorize` then `window.location.href = authorization_url` (backend callback sets the cookie, 302s to `/`); an authorize failure renders inline. "Or" divider + button structure byte-identical |
| `components/Auth/Registration.tsx` | mock `register()`/jotai/`navigate` → `useRegister()` then auto-`useLogin()` with the same creds (register does not establish a session); inline existing-email / weak-password / rate-limit errors via `authErrorMessage`; `useNavigate` dropped (the `me` invalidation drives the redirect). Form JSX byte-identical |
| `components/Nav/AccountSettings.tsx` | `useAuthUser()` now reads `/v1/me`; logout → `useLogout()` (real `POST /v1/auth/logout` + invalidate `me`/`chats`) then `navigate('/login')` in a `finally`. Avatar/menu markup unchanged |
| `components/Nav/SettingsTabs/Account/Account.tsx` | mock `updateUser` → `usePatchMe()` (`PATCH /v1/me` name); **+ story 49 password row**: a real in-app change dialog (`changePassword` → `PATCH /v1/auth/users/me`) with new+confirm fields and min-length/match validation; OAuth-only users (`has_password === false`) see a "Set a password" framing; the connected-Google row gates on `google_connected`. Upstream row grammar (`flex justify-between` + Label, `pb-3`) preserved |
| `components/Nav/SettingsTabs/Account/DeleteAccount.tsx` | mock `deleteAccount()` → `useDeleteAccount()` (real `DELETE /v1/me`) then a hard `window.location.href = '/login'` in a `finally` (drops every cached query). Email-confirm lock + dialog JSX byte-identical |

### Other B5b vendor touches (named in the deliverable, ledgered)

| File | Change |
|---|---|
| `routes/Layouts/Startup.tsx` | `useAuthUser()` → `useMe().data != null` — authed-user redirect to `/` fires only once `me` resolves (no flash between the auth pages and the shell) |
| `components/Nav/SettingsTabs/Data/ClearChats.tsx` | mock-store clears → real `DELETE /v1/me/chats` (keeps the account) then invalidate `[QueryKeys.chats]`; `navigate('/')` + `activeConversationIdAtom` reset retained. Dialog JSX byte-identical |
| `components/Nav/SettingsTabs/General/General.tsx` | theme write goes through `usePersistTheme` (local-optimistic flip + `PATCH /v1/me`, existing server settings spread so `default_source_config` is never clobbered); theme read still from `ThemeProvider`. `useCallback` import dropped |
| `routes/Root.tsx` | (via the Counselle `AuthGate` wrapper, not Root) the server-wins theme seed runs once `me` resolves — see `src/app/settingsSync.ts`. Root itself is unchanged |

### Counselle-native B5b additions / replacements

| File | Description |
|---|---|
| `src/api/http/auth.ts` (new) | The real auth client over `/v1/auth/*` + `/v1/me`: `register`/`login` (form-encoded)/`logout`/`forgotPassword`/`resetPassword`/`fetchMe` (→ `null` on 401)/`patchMe`/`deleteAccount`/`deleteMyChats`/`changePassword`/`googleAuthorizeUrl`; `MeData`/`UserSettings` types; `AuthError` (coded 400) + `authErrorMessage` friendly-message mapper. Reuses B5a's `credentials:'same-origin'` + `errorFromResponse` |
| `src/app/auth.ts` (replaced) | jotai `sessionUserAtom` → TanStack Query: `useMe()` (`[QueryKeys.me]`, 401→null), `useAuthUser()` shim, and the mutations `useLogin`/`useRegister`/`useLogout`/`usePatchMe`/`useDeleteAccount` (each invalidates `me`, plus `chats` on logout/delete) |
| `src/app/settingsSync.ts` (new) | `useServerThemeSeed()` (server-wins theme seed on me-resolve) + `usePersistTheme()` (optimistic flip → `PATCH /v1/me`, settings spread). `default_source_config` deliberately untouched (B5c) |
| `src/api/hooks.ts` | + `QueryKeys.me` |

## B5c — Source control, feedback, config, sessions list

### Vendored-component touches (ledgered)

| File | Change |
|---|---|
| `components/Chat/Messages/Feedback.tsx` | Reason-chip popovers (Ariakit `usePopoverStore` + `getTagsForRating` + `FeedbackOptionButton`) and the "other" free-text `OGDialog` **subtracted** — the backend stores only `{rating}` (reason chips are MVP3); collecting tags it discards is a dishonest affordance. Now a plain two-button thumbs toggle (click to set, click the active thumb to clear). `buttonClasses`/`ThumbUpIcon`/`ThumbDownIcon`/`isLast` grammar byte-identical |
| `hooks/Messages/useMessageActions.tsx` | Tag hydration (`getTagByKey`/`toMinimalFeedback`) removed — `message.feedback` is just `{rating}` (ChatContext's transcript projection). `handleFeedback` paints the thumb optimistically and rolls back on a rejected `POST .../feedback` (honesty: never show feedback the backend didn't persist) |
| `components/Chat/Landing.tsx` | greeting + season_note now from `useConfigQuery()` (`GET /v1/config`, async); loading fades the content block in (no fallback flash); on error falls back to a local greeting constant, season_note hidden |
| `components/Chat/Input/ConversationStarters.tsx` | starters from `useConfigQuery()` (was the import-time fixture); empty until resolved (the existing `!length` guard returns null gracefully) |
| `components/Chat/Footer.tsx` | footer text now the static `@/api/appFooter` `APP_FOOTER` constant (`/v1/config` does NOT serve the footer) |
| `components/Conversations/Conversations.tsx` | `activeJobIds` is now a prop (the set of `is_generating` session ids) instead of frozen-empty — the per-row generating indicator (upstream's spinner in the action slot) renders for live turns |
| `components/UnifiedSidebar/ConversationsSection.tsx` | `useChatsQuery` is now the real `GET /v1/sessions`; derives `activeJobIds` from each row's `isGenerating` and passes it to `Conversations` |

### Counselle-native B5c additions / replacements

| File | Description |
|---|---|
| `src/api/source-config.ts` (new) | The §4 wire boundary: `toWire`/`fromWire` (FE `SourceConfig` ↔ `SourceConfigWire`), `FULL_MENU` (bare keys, `null`=full menu), defensive `fromWire`. The ONLY place that translates store↔wire shape |
| `src/api/http/sessions.ts` (new) | `listSessions` (`GET /v1/sessions?limit=50` → `ChatSummary[]`, `is_generating`→`isGenerating`), `renameSession` (PATCH), `deleteSession` (DELETE 204; non-ok throws so a failed delete keeps the row) |
| `src/api/http/config.ts` (new) | `fetchConfig` (`GET /v1/config`) + `ConfigData` type |
| `src/api/http/feedback.ts` (new) | `setFeedback` (`POST .../messages/{id}/feedback {rating:'up'\|'down'\|null}`); non-ok throws |
| `src/api/appFooter.ts` (new) | the static `APP_FOOTER` brand copy (replaces the deleted `mock/fixtures/config.ts`) |
| `src/api/hooks.ts` | `useChatsQuery`/rename/delete now real (`http/sessions`); `useUpdateFeedbackMutation` real (`http/feedback`, `thumbsUp↔up` map); `useConfigQuery` new (seeds default source config via `setDefaultSourceConfig(fromWire(...))` on success); `useCreateChatMutation` **removed** (dead — the new-chat flow goes through `ChatContext.transport.createSession`); `+ QueryKeys.config` |
| `src/api/transport.ts` | `SendMessageBody.source_config` + `CreatedSession.source_config` + `createSession()` tightened to `SourceConfigWire`; `transcript()` now returns `SessionTranscript` (`{entries, sourceConfig}`) so chat-open seeds the dropdown |
| `src/api/mock/sourceStore.ts` | `SUBREDDITS` corrected (C3) to the concrete yaml menu (`ApplyingToCollege, chanceme, financialaid, premed, csMajors`; `{school}` excluded) |
| `src/api/types.ts` | `ChatSummary` gains `isGenerating: boolean` |
| `src/app/ChatContext.tsx` | every `sendMessage` carries `source_config: toWire(getSourceConfig(convoId))`; `createSession` passes the default config; chat-open seeds the dropdown via `updateSourceConfig(convoId, fromWire(serverConfig))` |
| `src/components/source-control/SourceDropdown.tsx` | re-reads `getSourceConfig` on popover open (picks up the server-seeded config written at chat open) |
| `src/api/mock/fixtures/config.ts` | **deleted** (config now from `/v1/config`; footer moved to `appFooter.ts`) |
