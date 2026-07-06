# MVP3 AI Composer Home Plan

## Goal

Add the AI composer home page to the new MVP3 frontend: an authenticated
`/app/ai` surface with only two primary elements:

- a polished welcome line
- a centered AI composer adapted from `@kokonutui/ai-input-search`

The old frontend is the behavioral north star for first-message submission, but
the implementation must use the new frontend design system, tokens, routes, and
module ownership. Do not import old LibreChat code, tokens, route structure, or
names.

## References Read

- Old behavior reference:
  - `frontend.backup-20260705-070513/src/app/ChatView.tsx`
  - `frontend.backup-20260705-070513/src/app/ChatContext.tsx`
  - `frontend.backup-20260705-070513/src/app/useTurnEngine.ts`
  - `frontend.backup-20260705-070513/src/components/composer/ChatComposer.tsx`
  - `frontend.backup-20260705-070513/src/vendor/librechat/app/components/Chat/Landing.tsx`
  - `frontend.backup-20260705-070513/src/components/composer/SuggestionPills.tsx`
  - `frontend.backup-20260705-070513/src/api/transport.ts`
  - `frontend.backup-20260705-070513/src/api/http/sessions.ts`
  - `frontend.backup-20260705-070513/src/api/source-config.ts`
  - `frontend.backup-20260705-070513/src/api/sourceConfigStore.ts`
- Backend contract:
  - `api/routes/config.py`
  - `api/routes/sessions.py`
- New frontend shell and design system:
  - `frontend/src/app/router.tsx`
  - `frontend/src/app/shell/WorkspaceShell.tsx`
  - `frontend/src/features/shell/AppSidebar.tsx`
  - `frontend/src/app/shell/navigation.tsx`
  - `frontend/src/index.css`
  - `frontend/src/api/http/client.ts`
- ADRs:
  - ADR 0013, source control
  - ADR 0016, API-first SSE protocol
  - ADR 0022, resume/cancel protocol
  - ADR 0026, MVP3 frontend reset
- Registry source:
  - `bunx --bun shadcn@latest view @kokonutui/ai-input-search`

## Reviewer Feedback Folded In

Two reviewers checked the draft plan.

Key corrections adopted:

- Keep Kokonut as raw implementation input. The real Counselle composer belongs
  in the AI composer feature module, not as a generic shared primitive.
- Add one typed chat transport module instead of scattering shallow endpoint
  wrappers.
- Put first-turn orchestration in a feature hook module, not in the route.
- Add explicit cancel support if the UI exposes stop.
- The streaming fetch must use a caller-owned `AbortController`, not the short
  auth request timeout from `safeFetch`.
- Add concrete browser QA for desktop and mobile.

## Scope

### In Scope

- Authenticated `/app/ai` route.
- Sidebar nav item for AI.
- `/app` index redirect to `/app/ai`.
- Welcome text from `GET /v1/config.greeting`.
- Fallback welcome text: `Where should we begin?`
- Composer adapted from `@kokonutui/ai-input-search`.
- Source toggles inside the composer for:
  - Web
  - .edu
  - Reddit
- First-message flow:
  - create session
  - send message as SSE
  - carry source config on both requests
  - support cancel/stop once stream starts
- Tests for mapping, transport, hook behavior, and route rendering.
- Browser verification at desktop and mobile sizes.

### Out of Scope

- Full chat transcript page.
- Transcript loading and projection.
- Last-Event-ID reattach.
- Turn reducer rendering.
- Chat history list, rename, delete.
- Feedback.
- Edit/regenerate.
- Clarify widget and awaiting-clarify rendering.
- Starter chips.
- Attachments.

## Behavioral Requirements

Match the old frontend where it matters for composer-home behavior:

- Fetch `/v1/config` on the AI home page.
- Use `config.greeting` as the main welcome copy.
- Do not flash fallback greeting while config is still loading.
- If config fails, show `Where should we begin?`.
- Seed source defaults from `config.default_source_config`.
- Keep DB implicitly always on; only web, .edu, and Reddit are controllable.
- Trim submitted text.
- Empty text does not submit.
- `Enter` submits.
- `Shift+Enter` inserts a newline.
- Clear composer text before awaiting the network result.
- Restore the exact trimmed text if session creation or pre-stream send fails.
- Disable duplicate sends while submitting.
- Expose stop only after there is an active session/stream to cancel.
- Send `source_config` to:
  - `POST /v1/sessions`
  - `POST /v1/sessions/{session_id}/messages`

Do not port starter pills. The old pills only populated the composer and did not
submit, but this page is intentionally just welcome text plus composer.

## Module Plan

### 1. Registry Import

Run from the worktree frontend:

```bash
cd frontend
bunx --bun shadcn@latest add @kokonutui/ai-input-search
```

Then refactor the generated code into Counselle-owned feature code. Keep the
auto-resize hook if it fits. Remove:

- file input
- paperclip action
- raw sky-blue styling
- uncontrolled local input state
- `role="textbox"` wrapper around a real textarea

### 2. Route and Navigation

Update:

- `frontend/src/app/router.tsx`
- `frontend/src/app/shell/navigation.tsx`

Add:

- `frontend/src/pages/ai-page.tsx`
- `frontend/src/features/ai-composer/AiComposerRoute.tsx`

Route behavior:

- `/app` redirects to `/app/ai`.
- `/app/ai` renders the composer home.
- Existing wildcard fallback remains unchanged.

### 3. Chat Transport Module

Add a typed chat transport module under `frontend/src/api/chat/`.

Suggested files:

- `frontend/src/api/chat/transport.ts`
- `frontend/src/api/chat/source-config.ts`
- `frontend/src/api/chat/types.ts`

Transport interface:

```ts
type ChatTransport = {
  getChatConfig: () => Promise<ChatConfig>
  createSession: (input: { sourceConfig: SourceConfig }) => Promise<CreatedSession>
  streamFirstMessage: (input: {
    sessionId: string
    text: string
    sourceConfig: SourceConfig
    signal: AbortSignal
    onEvent?: (event: ProtocolEvent) => void
  }) => Promise<StreamResult>
  cancelActiveTurn: (sessionId: string) => Promise<void>
}
```

Rules:

- Existing `requestJson` is fine for normal JSON requests.
- Streaming must use a custom fetch path with a caller-owned signal.
- Nothing above this seam sees backend snake_case.
- Nothing above this seam sees raw `Record<string, unknown>` event payloads
  unless parsing is intentionally deferred for this phase.

### 4. Source Config Adapter

Add one pure adapter module for FE shape to wire shape.

FE shape:

```ts
type SourceConfig = {
  webSearch: boolean
  eduSources: boolean
  reddit: boolean
  selectedSubreddits: Subreddit[]
}
```

Wire shape:

```ts
type SourceConfigWire = {
  web: boolean
  edu: boolean
  reddit: boolean
  reddit_subreddits: string[] | null
}
```

Rules:

- `null` subreddit list means the full menu.
- Unknown subreddit keys are dropped when reading wire data.
- Fallback defaults are defensive and never throw.
- DB is not represented as a toggle because it is always on.

### 5. Config Defaults Resolver

Add a small pure module that resolves initial page config:

- server config success uses `greeting` and `default_source_config`
- server config failure uses fallback greeting and built-in source defaults
- `season_note` is not rendered for this page

Keep this out of the route implementation so the same behavior can be reused by
the future chat page.

### 6. First Turn Hook

Add `useComposerStartTurn` under `frontend/src/features/ai-composer/`.

Hook interface should stay narrow:

```ts
type UseComposerStartTurnResult = {
  submit: (text: string, sourceConfig: SourceConfig) => Promise<boolean>
  cancel: () => Promise<void>
  isSubmitting: boolean
  canCancel: boolean
  error: string | null
}
```

The hook owns:

- trim
- clear/restore coordination with caller
- create session
- stream first message
- cancel active turn
- transport errors mapped to user-safe strings
- invalidating chat/session queries later, if such queries exist by then

The route owns layout and passes callbacks into the composer. It does not own
network sequencing.

### 7. Composer UI

Create the real Counselle composer in the feature module.

Requirements:

- Controlled `value`.
- Controlled `onValueChange`.
- `textarea` auto-resizes within a stable max height.
- `Enter` submits, `Shift+Enter` newline.
- Submit button has an accessible label.
- Stop button has an accessible label.
- Source toggles are accessible buttons or toggle controls.
- Placeholder: `Message Counselle`.
- Loading/submitting state is visible and disables duplicate submit.
- No attachment/file control.
- No raw registry blue styling.
- No decorative gradient/glass styling.
- Uses existing workspace tokens.

## Visual Direction

Physical scene:

A student opens Counselle in the evening to make one high-stakes admissions
decision; the page should feel calm, focused, and credible, not like a marketing
hero or a generic chatbot clone.

Layout:

- Content sits inside `WorkspaceShell`.
- One centered column.
- Vertical position: centered with slight optical lift, not pinned to top.
- Max width: around `720px` to `780px`.
- Mobile width: full available width with safe side padding.

Typography:

- Use existing Geist font.
- Welcome line:
  - desktop: about `40px` to `52px`
  - mobile: about `30px` to `36px`
  - `font-semibold`
  - `tracking-tight`, no tighter than `-0.03em`
  - `text-wrap: balance`
  - solid foreground color, no gradient text

Composer:

- Rounded but not over-rounded: `rounded-xl` or `rounded-2xl`.
- Stable dimensions to prevent layout jump.
- Use restrained border or inset highlight.
- Avoid pairing a 1px border with a large soft shadow.
- Source controls live in the lower action row.

Do not add:

- cards around the whole page
- starter grids
- decorative orbs
- gradient text
- beige/cream theme changes
- heavy page-load choreography

## Test Plan

### Unit Tests

Add focused tests for:

- `toWire` and `fromWire` source config mapping.
- `null` subreddit list means full menu.
- malformed wire config falls back safely.
- config resolver returns server greeting/defaults on success.
- config resolver returns fallback greeting/defaults on failure.

### Hook Tests

Test `useComposerStartTurn`:

- empty/whitespace submit is ignored.
- successful submit calls create session before stream.
- message request includes trimmed text.
- both create and message carry source config.
- create failure returns `false`.
- pre-stream failure returns `false`.
- caller can restore typed text when `false` is returned.
- cancel calls `cancelActiveTurn` only when a session/stream exists.

### Route Tests

Update or add route tests:

- `/app` redirects to `/app/ai`.
- `/app/ai` renders the welcome heading.
- AI nav item is visible and active.
- composer textarea is focused or focusable.
- Enter submits.
- Shift+Enter inserts newline.

### Transport Tests

Test request shape:

- `GET /v1/config`
- `POST /v1/sessions` with `{ source_config }`
- `POST /v1/sessions/{id}/messages` with `{ text, source_config }`
- `POST /v1/sessions/{id}/cancel`
- stream fetch uses caller-owned signal and does not inherit the short auth
  request timeout.

## Verification Plan

Run:

```bash
cd frontend
npm run typecheck
npm test
```

Then run the app:

```bash
cd frontend
npm run dev
```

Use Playwright against `/app/ai`.

Desktop QA:

- viewport: `1440x1000`
- confirm sidebar and composer page render correctly
- heading is centered, balanced, and not overflowing
- composer max width feels intentional
- source controls fit without wrapping awkwardly
- focus ring is visible
- Enter submits
- Shift+Enter adds a newline
- submit disabled/loading state is clear
- stop state is clear when stream starts

Mobile QA:

- viewport: `390x844`
- mobile sidebar header remains usable
- composer fits with side padding
- heading does not overflow
- action row wraps cleanly or remains readable
- no text overlaps controls
- keyboard-focused states are reachable

Reduced motion QA:

- enable reduced motion
- no required content is hidden behind animation
- motion degrades to instant or simple transition

Capture screenshots into `artifacts/` only.

## Implementation Order

1. Add Kokonut registry item.
2. Create source-config adapter and tests.
3. Create chat transport and tests.
4. Create config resolver and tests.
5. Create `useComposerStartTurn` and tests.
6. Build Counselle composer UI from the Kokonut implementation.
7. Add `/app/ai` page and nav route.
8. Wire submit/cancel behavior.
9. Run typecheck and tests.
10. Run browser QA and polish visual issues.

## Done Criteria

- `/app/ai` is the authenticated AI composer home.
- The page contains only welcome text and composer.
- Composer uses the Kokonut pattern but is fully adapted to Counselle.
- Old first-message behavior is preserved where applicable.
- No old LibreChat code/tokens/naming are imported.
- Source config is correctly carried to backend requests.
- Stop/cancel is either working or not rendered.
- Typecheck passes.
- Tests pass.
- Desktop and mobile screenshots show no overflow, overlap, or off-brand styling.
