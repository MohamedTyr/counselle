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
