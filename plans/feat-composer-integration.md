# Plan — Composer Integration

**Branch:** `feat/composer-integration`
**Tier:** Large (new module + cross-cutting frontend change)
**Status:** REVISED post-review (architect + adversarial-exactness audit folded in). Awaiting user approval. No app code written yet.

> **Revision note:** This v2 changes the core architecture decision from the first
> draft — we **keep** react-hook-form (`ChatFormProvider`) and bridge it, rather than
> removing it. See §2.8 and the **Review Resolutions** appendix (§8) for why and for
> every CRITICAL/HIGH/MEDIUM finding and its disposition.

---

## 1. Problem statement

We have a polished chat composer prototyped on a standalone lab page
(`counselle-composer-polish` worktree, `src/lab/CounselleComposer.tsx` +
`SourcesControl.tsx`). It is "exactly what we want": rounded surface, sources
dropdown, decorative mic/upload/think pills, light + dark themes, framer-motion
micro-interactions. The current production composer is the vendored LibreChat
`ChatForm.tsx` plus the Counselle-authored `SourceDropdown.tsx`.

**Goal:** Replace the production composer with the lab composer, **pixel-identical
to the lab**, wired to the real backend (turn submission, cancel, source config),
and **refactored to clean, house-style code** in the process. Bring over **only the
composer** — none of the lab chrome (theme toggle, readout box, heading).

**Non-goals (explicit):**
- Do **not** redesign or re-style anything. The rendered output must match the lab
  composer exactly (verified in-browser, light + dark).
- Do **not** edit the existing `ChatForm.tsx` to *look like* the new composer. We
  **replace** it (stop importing it) — `ChatForm.tsx` lives in `vendor/` and is
  never edited per house rule.
- Do **not** wire the **Think** pill, **mic**, or **upload** to the backend — they
  stay decorative ("for the looks"), consistent with the lab. The backend has no
  field for thinking and no file channel on the turn endpoint.
- Do **not** build deep-research, file upload, or voice transcription. Out of scope.
- Draft-autosave (an existing `ChatForm` nicety) is **not** in the lab composer;
  re-adding it is OPTIONAL and flagged as a possible regression (§6, Risk R5).

---

## 2. Architecture & data flow

### 2.1 Where it lives
New Counselle-authored feature module: **`frontend/src/components/composer/`**
(mirrors the `components/<feature>/` convention; `@/` alias; JSDoc file headers).
The old composer (`vendor/librechat/.../ChatForm.tsx`) is left in place but no longer
imported. The Counselle-authored `components/source-control/SourceDropdown.tsx` is
**replaced** (its store-bridge logic is *ported*, not discarded — see §2.4).

### 2.2 File split (the refactor)
The lab's 716-line single file becomes small, cohesive modules (<800 lines, fns <50):

| New file | Contents | Source in lab |
|---|---|---|
| `composer/CounselleComposer.tsx` | Main export only: state, extracted handlers, JSX (~150 lines) | lab lines 435–716 |
| `composer/PromptInput.tsx` | `PromptInput` + context + `PromptInputTextarea`/`Actions`/`Action` | lab compound primitives |
| `composer/VoiceRecorder.tsx` | Recorder (with the `useEffect` bug fixed) | lab `VoiceRecorder` |
| `composer/SourcesControl.tsx` | Sources dropdown (presentational, controlled) | lab `SourcesControl.tsx` |
| `composer/primitives.tsx` | `Button`, `Textarea`, minimal Tooltip/Dialog wrappers | lab `Button`/`Textarea`/Tooltip*/Dialog* |
| `composer/ImageViewDialog.tsx` | Full-screen image preview | lab `ImageViewDialog` |
| `composer/composer.css` | The scrollbar + focus-visible rules currently injected at module scope | lab module-scope `<style>` |
| `composer/index.ts` | Barrel export of `CounselleComposer`, types | — |

### 2.3 The integration container (the wiring)
A thin **container** bridges the (self-contained, **controlled**) composer to the app's
`ChatContext`, the **RHF form** (`useChatFormContext`), and the source store. It is the
new owner of the `onSubmit` + `useAutoSave` + autofocus logic that lived in `ChatForm`.
Mounted by `ChatView` in place of `<ChatForm>`, **inside the kept `ChatFormProvider`**:

**`frontend/src/components/composer/ChatComposer.tsx`** (container)
```
const { conversationId, isSubmitting, submitMessage, stopGenerating, awaitingClarify }
  = useChatContext();
const methods = useChatFormContext();          // KEEP RHF — text lives here
const text = methods.watch('text');
const textAreaRef = useRef<HTMLTextAreaElement>(null);

useAutoSave({ conversationId, textAreaRef, ... });   // PORTED from ChatForm (draft restore)
useEffect(() => { textAreaRef.current?.focus(); },    // autofocus parity (ChatForm L125)
          [conversationId]);

// Exact restore-on-fail pattern, copied from ChatForm.onSubmit (clear BEFORE await):
const onSend = async () => {
  const trimmed = (text ?? '').trim();
  if (!trimmed || isSubmitting) return;        // guard: no double-send while streaming
  methods.reset({ text: '' });                 // clear synchronously, BEFORE the await
  const accepted = await submitMessage(trimmed);
  if (!accepted) methods.reset({ text: trimmed });   // restore only on false
};

// source state: read from store, bridge FE-store shape <-> composer shape.
// PORTED VERBATIM from SourceDropdown.tsx — BOTH effects required:
const [config, setConfig] = useState(() => getSourceConfig(conversationId));
useEffect(() => setConfig(getSourceConfig(conversationId)), [conversationId]);   // (1)
//   (2) re-read on popover open lives in SourcesControl's onOpenChange.

<CounselleComposer
  ref={textAreaRef}                          // expose textarea for autofocus + autosave
  value={text} onValueChange={(v) => methods.setValue('text', v)}   // CONTROLLED
  isLoading={isSubmitting}
  placeholder={awaitingClarify ? CLARIFY_PLACEHOLDER : DEFAULT_PLACEHOLDER}
  // sources (controlled, bridged to the store):
  active={toActiveSet(config)} subs={config.selectedSubreddits}
  onSourcesChange={(patch) => setConfig(updateSourceConfig(conversationId, patch))}
  onSourcesReread={() => setConfig(getSourceConfig(conversationId))}  // popover-open re-read
  // submit / cancel:
  onSend={onSend}
  onStop={stopGenerating}
/>
```
**Positioning** (`centerFormOnLanding`) stays where it already is — on the wrapping
`<div>` in `ChatView` (it was never internal to `ChatForm`'s layout in a way the composer
needs). The composer takes **no** `centerFormOnLanding` prop. (Resolves M5.)

### 2.4 Source state bridge
The composer is a **controlled** component for sources (it already takes
`active`/`setActive`/`subs`/`setSubs`). We lift source state OUT of `CounselleComposer`
into `ChatComposer`, backed by the existing store — this is the SourceDropdown logic,
ported:

| App store (`SourceConfig`) | Composer prop | Wire (`toWire`, unchanged) |
|---|---|---|
| `webSearch: boolean` | `active.has('web')` | `web` |
| `eduSources: boolean` | `active.has('edu')` | `edu` |
| `reddit: boolean` | `active.has('reddit')` | `reddit` |
| `selectedSubreddits: Subreddit[]` (`r/`-prefixed) | `subs: string[]` (`r/`-prefixed) | `reddit_subreddits` (bare) |

- **Database** is always-on, never stored, never in the wire — the dropdown shows it
  as the "Verified data / Always on" anchor (lab already does this). ✔
- **`SUBREDDITS` MUST come from `@/api/mock/sourceStore`** (the canonical 5:
  `ApplyingToCollege, chanceme, financialaid, premed, csMajors`). The lab's hardcoded
  list (`collegeresults, CollegeAdmissions, IntltoUSA`) is **deleted** — it would send
  subreddits the backend menu doesn't recognise.
- **Initial checked state = the store default, which is ALL 5 subreddits checked**
  (`DEFAULT_CONFIG.selectedSubreddits = [...SUBREDDITS]`, confirmed in `sourceStore.ts`).
  This differs from the lab's cosmetic `slice(0,3)` (3 checked) — the store value is the
  correct app behaviour and matches today's `SourceDropdown`. Intended, not a regression.
  (Resolves audit F7.)
- We do **not** call `toWire` in the composer — `ChatContext.runTurn` already does it at
  the transport boundary. The container only reads/writes the FE-store shape via
  `getSourceConfig` / `updateSourceConfig`. Send path is otherwise untouched. ✔

### 2.5 Submit / cancel flow (the only behavioural wiring)
- **Send:** the **container** owns submit (see §2.3 `onSend`). The composer's internal
  `handleSubmit` is reduced to "call the `onSend` prop" — it no longer clears its own state
  (text is controlled by the container's RHF field). The container clears via
  `methods.reset({text:''})` **synchronously before the `await`**, awaits
  `submitMessage(trimmed)`, and **restores on `false` only**. This is `ChatForm.onSubmit`
  copied verbatim. (Resolves C1 — ordering is explicit and uses the proven pattern.)
- **Trim** happens in the container before `submitMessage` (fixes the lab's untrimmed send).
- **Stop / button state matrix** (resolves C2, F12). The single right-hand button:
  | `isLoading` | `hasContent` | icon | enabled? | onClick |
  |---|---|---|---|---|
  | **true** | any | `Square` (pulse) | **yes** | `onStop()` → `stopGenerating()` |
  | false | true | `ArrowUp` | yes | `onSend()` |
  | false | false | `Mic` | yes | start recording (decorative) |

  Both the lab's `disabled={isLoading && !hasContent}` **and** the click handler are
  rewritten to this table. When `isLoading`, the button is the Stop button regardless of
  typed text; typed text is preserved in the RHF field (never dropped).
- **Enter key** (full rewrite, resolves M3/F10): the composer's `PromptInputTextarea`
  `onKeyDown` is replaced with `useTextarea`'s logic tree:
  - `isComposing` (IME) → never submit.
  - `isSubmitting` → never submit (no double-send).
  - `enterToSend=true`: Enter → submit, Shift+Enter → newline.
  - `enterToSend=false`: Enter → newline, **Ctrl/Cmd+Enter → submit**.
  `enterToSend` is read from the app's `enterToSendAtom` (jotai) in the container and passed
  down as a prop (the composer stays store-agnostic).
- **isLoading ← `isSubmitting`** drives the red border + stop icon.
- **Textarea stays editable while streaming** (resolves M1): the container does **not** pass
  `disabled={isLoading}`. Today's `ChatForm` lets you type your next message while the answer
  streams; we preserve that. `disabled` is only ever true during the (decorative) recording
  state.
- **awaitingClarify** swaps the placeholder (as `ChatForm` does today).
- **Edit / regenerate is out of the composer's path** (resolves H4): `ask`/`regenerate` in
  `ChatContext` call `submitMessage(text, replaceMessageId)` directly from the message-list
  hover buttons. The composer never supplies `replace_message_id`. Documented so tests don't
  expect it.

### 2.6 Decorative controls (kept for the looks, made genuinely inert)
- **Think pill:** local `thinking` toggle, flips placeholder to "Think deeply…"; **not**
  sent anywhere (no backend field). `ComposerState.thinking` is simply not consumed.
- **Mic / VoiceRecorder:** visual only. **The fake `onSend("[Voice message - N seconds]")`
  call in `handleStopRecording` is deleted** (resolves H3/F11 — the single most likely
  first-day bug). Stopping recording just exits the recording UI; **nothing is submitted.**
  The mic icon and recorder animation stay for the looks.
- **Upload / Paperclip:** attaches a local image preview (visual), but the turn endpoint has
  no file channel, so files are **never transmitted** (the container's `onSend` takes no
  files). Kept for the looks.
- **Image paste is scoped, not global** (resolves L2/F6): the lab attaches a `document`-level
  `paste` listener that hijacks image pastes app-wide (e.g. pasting into Settings would dump
  an image into the composer). We move the handler **onto the composer container element**
  (`onPaste` on the `PromptInput` root), so it only fires when pasting into the composer.

### 2.7 Styling fidelity (how we keep it pixel-identical)
- **Keep the lab's exact Tailwind classes and hex values verbatim** (`#1F2023`, `#444444`,
  `#8B5CF6`, `gray-*`, the shadow strings). We do **NOT** remap to the app's semantic
  tokens — that would risk changing pixels. The new design intentionally differs from the
  app's older surfaces; the lab is the source of truth.
- Dark mode already uses `dark:` variants → works as-is with the app's `.dark`-on-`<html>`
  strategy (`darkMode: ['class']`). No change.
- **`cn` helper:** delete both inline copies; import the app's `cn` (`~/utils`, the
  `clsx`+`tailwind-merge` impl used across `src/components/`). Pure refactor, no visual
  change.
- **Module-scope `<style>` injection → scoped `composer.css`** (resolves HIGH F2 — the
  worst silent a11y risk). The injected block is exactly:
  ```css
  *:focus-visible { outline-offset: 0 !important; --ring-offset: 0 !important; }
  textarea::-webkit-scrollbar { width: 6px; }
  textarea::-webkit-scrollbar-track { background: transparent; }
  textarea::-webkit-scrollbar-thumb { background-color: #444444; border-radius: 3px; }
  textarea::-webkit-scrollbar-thumb:hover { background-color: #555555; }
  ```
  **Concrete scoping mechanism:** wrap the composer in a root element with a stable class
  `counselle-composer`, and prefix every moved rule with it:
  ```css
  .counselle-composer *:focus-visible { outline-offset: 0; --ring-offset: 0; }
  .counselle-composer textarea::-webkit-scrollbar { width: 6px; }
  /* …track/thumb/hover likewise prefixed… */
  ```
  Dropping the global `!important *:focus-visible` reset is the whole point — it must never
  ship app-wide. The scrollbar `textarea::` rules are **redundant** with the Tailwind
  scrollbar utilities already on the `<Textarea>` (`scrollbar-thin scrollbar-thumb-[#444444]
  …`); **verify in-browser** whether the utilities alone reproduce the lab scrollbar, and if
  so drop the CSS rules entirely (keep only the focus-visible scope). `composer.css` is
  imported once by `index.ts`.
- **framer-motion stays** for the composer (rotating icons, width/height expand). It's an
  installed dep; the motion *is* the designed feel. Documented as a deliberate exception to
  the "CSS-animation default" convention.

### 2.8 Mount point change — RHF is KEPT (revised from v1)
`frontend/src/app/ChatView.tsx`: replace `<ChatForm />` with `<ChatComposer />`, **leaving
`ChatFormProvider` / `useForm<{text}>` in place**. Rationale (confirmed by review):
- `useAutoSave` (draft restore on conversation switch) watches the RHF `text` field. Keeping
  the provider means autosave keeps working with zero re-implementation. (Resolves HIGH H1 —
  draft-autosave was a real regression, not optional.)
- `ConversationStarters` does **not** use the form — it calls `useChatContext().submitMessage`
  directly (confirmed). So it is unaffected either way. (Resolves F13 — no breakage.)
- `UnifiedSidebar`'s `useChatFormContext` reference is a **comment** ("Subtractions"), not a
  runtime call — no higher provider needed. (Confirmed.)
- The new composer is a **controlled** component (`value`/`onValueChange`), so the RHF field
  remains the single source of truth for text; the container bridges them. The composer
  itself stays app-agnostic and self-contained.

The RHF-coupled vendor widgets `SendButton`/`StopButton`/`CollapseChat` simply go unused
(the composer renders its own send/stop button and its own collapse behaviour). They are
vendor files — left in place, not edited, not deleted.

---

## 3. Behavior list (numbered, testable)

1. Typing text and pressing Enter (with `enterToSend=true`) submits via `submitMessage`;
   the field clears.
2. With `enterToSend=false`, Enter inserts a newline; Ctrl/Cmd+Enter (or Send click) submits.
3. IME composition Enter does **not** submit (composing guard).
4. Pressing Enter while `isSubmitting` does **not** submit (no double-send).
5. Clicking Send with non-empty trimmed text calls `submitMessage(trimmedText)`.
6. Submitting empty/whitespace-only text is a no-op.
7. When `submitMessage` resolves `false`, the field text is restored (clear happened before
   the await; restore is the error branch only).
8. While `isSubmitting`, the button shows the `Square` stop icon, is **enabled regardless of
   typed text**, and clicking it calls `stopGenerating()`; typed text is preserved.
9. While `isSubmitting`, the textarea remains **editable** (type-ahead for the next message).
10. While `isSubmitting`, the composer border is red (`border-red-500/70`).
11. The textarea **auto-focuses** on mount and on conversation switch (parity with `ChatForm`).
12. A draft typed in conversation A is restored when returning to A after switching away
    (`useAutoSave` parity).
13. Toggling Web/.edu/Reddit writes the boolean via `updateSourceConfig(conversationId, …)`.
14. Enabling Reddit reveals the subreddit chips — the canonical 5 from the store, **all
    checked by default** (store default), none of `collegeresults`/`CollegeAdmissions`/`IntltoUSA`.
15. Selecting/deselecting a chip updates `selectedSubreddits` in the store.
16. Database row renders always-on ("Verified data / Always on"), is not a live toggle, and
    never appears in the wire payload.
17. Opening the dropdown re-reads the store (picks up server-seeded config written late on
    chat open); switching conversations re-reads that conversation's config.
18. The Think pill toggles local state + placeholder ("Think deeply…"); it does not alter the
    request payload.
19. `awaitingClarify` swaps the textarea placeholder to the clarify prompt.
20. The mic renders/animates but submits **nothing** when stopped; upload attaches a local
    preview but transmits no file; image paste only fires when pasting into the composer.
21. Light and dark themes render pixel-identical to the lab (visual regression, 4 breakpoints).
22. The send body equals the pre-refactor body for the same source selections (golden:
    `{ text, source_config: { web, edu, reddit, reddit_subreddits } }`).
23. No global `*:focus-visible` reset is shipped — focus rings on the rest of the app are
    unchanged (a11y guard).

---

## 4. Ordered task list (dependencies marked)

**T3 is the critical-path bottleneck** (T4–T8 all depend on it) — do it first.

- **T1.** Scaffold `components/composer/`; copy lab files in unmodified; add JSDoc headers
  (house-style: purpose + which surface it serves). *(no dep)*
- **T2.** Replace both inline `cn` with the app's `cn` (`~/utils`). *(dep: T1)*
- **T3.** Split the 716-line file into the §2.2 modules; extract the inline handlers
  (`processFile`, `handleDrop`, `handleSubmit`, etc.) to named <50-line fns; make
  `processFile` surface errors instead of `console.log`-swallowing; collapse the
  single-item `filePreviews` map to `string | null`. *(no dep — first task)*
- **T4.** Move module-scope `<style>` → scoped `composer.css` (`.counselle-composer`-prefixed,
  drop the global focus reset); verify scrollbar utilities suffice (§2.7). *(dep: T3)*
- **T5.** Fix `VoiceRecorder` `useEffect` bug (drop `time`/`onStopRecording` deps; ref for the
  tick value); **delete the fake `onSend` voice submit** in `handleStopRecording`. *(dep: T3)*
- **T6.** Make sources fully controlled (lift `active`/`subs` to props: `active`, `subs`,
  `onSourcesChange`, `onSourcesReread`); source `SUBREDDITS`/`Subreddit` from
  `@/api/mock/sourceStore`; delete the lab's wrong list. *(dep: T3)*
- **T7.** Implement the §2.5 button-state matrix: add `onStop` prop, rewrite the `disabled`
  condition + click handler (Stop when `isLoading`; never drop typed text). *(dep: T3)*
- **T8.** Rewrite `PromptInputTextarea` key handler to `useTextarea`'s tree: IME guard,
  `isSubmitting` guard, `enterToSend` (prop) Enter/Shift+Enter/Ctrl-Cmd+Enter. Make the
  composer text **controlled** (`value`/`onValueChange`) and `forwardRef` the textarea.
  Scope the image-paste listener to the composer root. *(dep: T3)*
- **T9.** Build `ChatComposer.tsx` container: bridge RHF (`useChatFormContext`) ↔ composer
  `value`/`onValueChange`; the §2.3 `onSend` (clear-before-await, restore-on-false, trim,
  submitting-guard); `onStop` → `stopGenerating`; `enterToSend` from `enterToSendAtom`;
  placeholder from `awaitingClarify`; the source bridge (both re-read effects, §2.3);
  **port `useAutoSave`** against the new textarea ref; **autofocus** on mount + convo switch.
  *(dep: T6, T7, T8)*
- **T10.** Swap the mount in `ChatView.tsx` (`<ChatForm>` → `<ChatComposer>`), **keeping**
  `ChatFormProvider`/`useForm`. Confirm by grep that nothing else newly breaks. *(dep: T9)*
- **T11.** **Do NOT delete `SourceDropdown.tsx`** — vendor `ChatForm.tsx` still imports it
  (line 51) and would fail `tsc`. Leave both `ChatForm.tsx` and `SourceDropdown.tsx` in place
  as orphaned-but-type-valid. Confirm `DefaultSources.tsx` (Settings default-source UI) is
  untouched and still works. *(dep: T10)*
- **T12.** Tests (Vitest + RTL): container submit/restore-on-false (8 incl. clear-before-await),
  stop-button matrix (8), Enter/IME/Ctrl-Enter/submitting-guard (1–4), source-bridge mapping
  unit test (13–17), wire-body golden (22), autosave restore (12), no-global-focus-reset
  assertion (23). *(dep: T9)*
- **T13.** `npm run typecheck && npm test && npm run build`; in-browser parity vs lab
  (light+dark at 320/768/1024/1440), popover placement, focus rings intact elsewhere; compare
  the actual send payload against a pre-refactor capture. *(dep: T10–T12)*

---

## 5. File change manifest

**New:**
- `frontend/src/components/composer/CounselleComposer.tsx`
- `frontend/src/components/composer/PromptInput.tsx`
- `frontend/src/components/composer/VoiceRecorder.tsx`
- `frontend/src/components/composer/SourcesControl.tsx`
- `frontend/src/components/composer/primitives.tsx`
- `frontend/src/components/composer/ImageViewDialog.tsx`
- `frontend/src/components/composer/ChatComposer.tsx` (container)
- `frontend/src/components/composer/composer.css`
- `frontend/src/components/composer/index.ts`
- `frontend/src/components/composer/__tests__/ChatComposer.test.tsx`
- `frontend/src/components/composer/__tests__/source-bridge.test.ts`

**Modified:**
- `frontend/src/app/ChatView.tsx` (swap `<ChatForm>` → `<ChatComposer>`; **keep** the RHF
  wrapper). The `useAutoSave` call moves from `ChatForm` into `ChatComposer` (the new owner).

**Deleted:** none. *(v1 proposed deleting `SourceDropdown.tsx`; reverted — vendor
`ChatForm.tsx` imports it and would fail type-check. See T11.)*

**Untouched (left in place, no longer imported / orphaned but type-valid):**
- `frontend/src/vendor/librechat/.../ChatForm.tsx` and its RHF-coupled siblings
  (`SendButton`, `StopButton`, `CollapseChat`) — vendor code, never edited.
- `frontend/src/components/source-control/SourceDropdown.tsx` — orphaned, but still imported
  by the orphaned vendor `ChatForm.tsx`; keep to satisfy `tsc`. `DefaultSources.tsx` (Settings)
  stays in use.
- `frontend/src/api/source-config.ts`, `sourceStore.ts`, `ChatContext.tsx`,
  `transport.ts` — the send/cancel/source contract is reused as-is.
- `frontend/src/app/ChatView.tsx` keeps `ChatFormProvider`/`useForm` (only the child swaps).

---

## 6. Risk register

- **R1 — Visual drift.** Refactor/file-split could subtly change rendered output.
  *Mitigation:* keep classes/hex verbatim; in-browser parity check vs the lab at 4
  breakpoints, light+dark, before merge (behavior 18).
- **R2 — Stop never cancelled (real bug today in lab).** *Mitigation:* `onStop` + fixed
  button logic; test behavior 7 against a live/mock turn.
- **R3 — Wrong subreddits sent.** Lab's list ≠ backend menu. *Mitigation:* source
  `SUBREDDITS` from the store only; golden wire-body test (behavior 19); delete lab list.
- **R4 — Lost keyboard behaviour** (enter-to-send pref, IME, paste). *Mitigation:* port
  `useTextarea`'s atom read + IME guard into the composer; test behaviors 1–3.
- **R5 — Draft-autosave regression.** *Resolved by design:* RHF is kept and `useAutoSave`
  moves into `ChatComposer` (T9), so draft restore keeps working. Covered by behavior 12.
- **R6 — Global a11y regression from the injected `<style>`.** *Mitigation:* `.counselle-composer`
  scoping; drop the global `*:focus-visible` reset entirely (§2.7); asserted by behavior 23.
- **R7 — framer-motion as a convention exception.** App prefers CSS animation. *Mitigation:*
  documented exception (the motion is the designed feel); dep already installed.
- **R8 — Voice mic accidental submit (was the #1 first-day-bug risk).** *Resolved:* the fake
  `onSend` in `handleStopRecording` is deleted (T5); stopping recording submits nothing.
- **R9 — Textarea-editable-while-streaming regression.** *Mitigation:* container never passes
  `disabled={isLoading}` (M1); behavior 9.
- **R10 — `tsc` break from vendor `ChatForm` → `SourceDropdown` import.** *Resolved:* nothing is
  deleted (T11).

---

## 7. Review & approval gate
This plan has been reviewed (architecture review + adversarial exactness audit) and revised
(§8). **Stop and wait for user approval** before writing any app code. Implementation
(T1–T13) begins only on the user's go-ahead.

## 8. Review resolutions (every CRITICAL/HIGH/MEDIUM finding)

| ID | Finding | Disposition in this plan |
|----|---------|--------------------------|
| **C1** | Optimistic-clear ordering ambiguous (text could flash back on success) | §2.3/§2.5: clear via `methods.reset` **before** the await; restore on `false` only — `ChatForm.onSubmit` verbatim. Behavior 7. |
| **C2** | Send-while-loading button matrix underspecified; typed text could be dropped | §2.5 button-state table; Enter guarded by `isSubmitting`. Behaviors 4, 8. |
| **H1** | `useAutoSave` draft restore is a real regression, not optional | §2.8: **keep RHF**; move `useAutoSave` into `ChatComposer` (T9). Behavior 12. |
| **H2** | Source re-read effects hand-waved as "verbatim" | §2.3 enumerates both effects (convo-change + popover-open re-read). Behavior 17. |
| **H3 / F11** | Voice stop calls `onSend` with fake text → backend answers it (top first-day bug) | §2.6/T5: **delete** the fake `onSend`; recording submits nothing. R8. |
| **H4** | Edit/regenerate path vs composer unclear | §2.5: documented — `ask`/`regenerate` bypass the composer; no `replace_message_id` from it. |
| **M1** | `disabled={isLoading}` locks textarea while streaming (type-ahead regression) | §2.5: container never disables on `isLoading`. Behavior 9. R9. |
| **M2 / R10** | Deleting `SourceDropdown` breaks vendor `ChatForm` `tsc` | T11/manifest: delete nothing; keep both orphaned-but-valid. |
| **M3 / F10** | Enter handler needs full rewrite (enterToSend=false → Ctrl/Cmd+Enter) | §2.5/T8: full `useTextarea` key tree. Behaviors 1–4. |
| **M5** | `centerFormOnLanding` landing-spot unclear | §2.3: stays on the `ChatView` wrapper div; composer takes no such prop. |
| **F2** | Global `*:focus-visible` reset would ship app-wide (silent a11y break) | §2.7: `.counselle-composer` scoping + drop the global reset. Behavior 23. R6. |
| **F6 / L2** | Global `document` paste listener hijacks app-wide pastes | §2.6/T8: scope paste to the composer root. Behavior 20. |
| **F7** | Store default subreddits (all 5) ≠ lab's 3 | §2.4: documented — all-5 is the correct store default, intended. Behavior 14. |
| **F13** | `ConversationStarters` might use the form context | Confirmed it uses `useChatContext` directly — no breakage. §2.8. |
| **F19** | No textarea autofocus → UX regression vs `ChatForm` (L125) | §2.3/T9: autofocus on mount + convo switch. Behavior 11. |
| **F12** | Stop fix needs BOTH `disabled` + handler changed | §2.5 table covers both; T7. |

**Verified-identical by the audit (shared `tailwind.config.cjs` + `style.css` — the lab is a
clone of the app):** the remapped gray palette, `bg-white`, Inter `size-adjust`, global
scrollbar base, `overflow: overlay`, reduced-motion rules, and `tailwind-merge` dedup all
render the same in lab and app — **no drift** (audit F1,3,4,5,8,14,15,16,17,18,20).

**Deferred / low (not blocking, noted for implementation):** the dual-value `PromptInput`
state (L1 — benign once controlled), VoiceRecorder test being shallow (M4 — the recorder is
decorative). framer-motion reduced-motion handling is optional.

**Open question for the user (one):** the composer keeps **upload + mic icons "for the looks"**
with no backend wiring (your earlier call). Confirm you still want both visible in production,
or whether to hide either until they do something. Default if you don't say: keep both, inert.
