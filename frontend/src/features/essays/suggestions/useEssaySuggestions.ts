import type { Editor } from "@tiptap/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  acceptAllSuggestions,
  acceptSuggestion,
  rejectAllSuggestions,
  rejectSuggestion,
  type SuggestionBatchResult,
} from "@/api/workspace/essays";
import { adoptServerEssay } from "@/api/workspace/hooks/essays";
import { workspaceKeys } from "@/api/workspace/keys";
import type { Essay } from "@/api/workspace/types";
import { essaySuggestionsFromApi } from "@/domain/essay-suggestion";
import { SuggestionPluginKey } from "@/features/essays/suggestions/suggestionExtension";
import { isLaterVersion } from "@/features/essays/useEssayAutosave";

/*
 * Resolving a tracked change: flush, POST, apply what the server returns.
 *
 * FOUR RULES, EACH ONE A BUG THIS FLOW USED TO HAVE.
 *
 * 1. NO OPTIMISTIC EDIT. Applying the accepted text locally would fire the
 *    editor's `onUpdate`, queue an autosave of the markdown-stripped plain
 *    text, and let that save land on top of the server's correctly formatted
 *    result — silently deleting the formatting inside an accepted edit. The
 *    server's returned content is the only content this ever writes.
 *
 * 2. ONE RESOLVE IN FLIGHT, PANEL-WIDE. Not one per suggestion. Every accept
 *    replaces the whole document with the server's copy, and that copy was
 *    computed before any concurrent accept committed — so two accepts
 *    finishing out of order leave the screen missing an edit the server
 *    actually saved. Serialising removes the ordering hazard outright rather
 *    than guarding against it: there is never a second in-flight request whose
 *    response could land in the wrong order. The lock is a REF, not state, so
 *    two key presses in the same tick cannot both read it as free.
 *
 * 3. CONTENT AND SUGGESTIONS LAND IN ONE TRANSACTION. See `applyToEditor`.
 *
 * 4. THE RESPONSE IS RE-QUALIFIED WHEN IT LANDS, NOT ONLY BEFORE IT IS SENT.
 *    A whole document computed a second ago is not automatically newer than
 *    the one on screen. See `resolve`.
 */

/* This one message has to outlive the app-wide toast default: it is the only
 * account the student gets of two versions of their essay diverging, and four
 * seconds is not long enough to read it, let alone decide. */
const DIVERGED_TOAST_MS = 12_000;

/** Which resolve is in flight. `"all"` is a batch; otherwise a suggestion id. */
type ResolvingTarget = {
  action: "accept" | "reject";
  id: string | "all";
};

export type EssaySuggestionsController = {
  acceptAll: () => void;
  acceptOne: (suggestionId: string) => void;
  /** True while any resolve is in flight — every control gates on this. */
  isResolving: boolean;
  rejectAll: () => void;
  rejectOne: (suggestionId: string) => void;
  /** The one resolve in flight, for the pressed control's own busy state. */
  resolving: ResolvingTarget | null;
};

type UseEssaySuggestionsOptions = {
  editor: Editor | null;
  essayId: string;
  /** `useEssayAutosave`'s own flush. Awaited, never re-implemented here. */
  flush: () => Promise<void>;
  /**
   * Read twice per resolve, and it has to be live both times — a value
   * captured when the resolve started answers neither question.
   *
   * Straight after the flush: `flush()` resolves on failure too — it answers
   * "the save finished", not "the save worked" — so this is how the resolve
   * learns the student's typing never reached the server. Resolving anyway
   * would apply the edit to text the server has never seen and hand back a
   * document with their typing gone.
   *
   * Again once the response lands: the document stays editable throughout, so
   * the student may have typed during the round trip. See `resolve`.
   */
  hasUnsavedChanges: () => boolean;
};

function skippedMessage(result: SuggestionBatchResult, verb: string): string {
  const total = result.applied + result.skipped.length;
  return `${result.applied} of ${total} ${verb} — ${result.skipped.length} could not be applied.`;
}

export function useEssaySuggestions({
  editor,
  essayId,
  flush,
  hasUnsavedChanges,
}: UseEssaySuggestionsOptions): EssaySuggestionsController {
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState<ResolvingTarget | null>(null);
  /* The lock itself. State drives the UI; this ref is what actually holds the
   * door shut, because a second key press in the same tick would read stale
   * state and fire a second request against a document about to be replaced. */
  const resolvingRef = useRef<ResolvingTarget | null>(null);

  /*
   * The accepted content and the new suggestion list, in ONE transaction.
   *
   * A bare `setContent` produces a `docChanged` transaction with no meta,
   * which the decoration plugin answers by MAPPING every other anchor through
   * a whole-document replacement — and mapping collapses each one onto the
   * replaced range's boundary, so every sibling suggestion goes zero-width and
   * stale the instant one is accepted, painting nothing. The plugin checks its
   * meta strictly before `docChanged`, so a transaction carrying both
   * recomputes every remaining anchor from scratch instead. Tiptap's chained
   * commands accumulate into a single shared transaction, which is what makes
   * "both, atomically" expressible at all. `useEssayEditor`'s content resync
   * replaces the document too, and carries the meta for the same reason.
   *
   * `emitUpdate: false` keeps this off the autosave path: the server already
   * has this content, and re-saving it is what rule 1 above exists to prevent.
   */
  const applyToEditor = useCallback(
    (essay: Essay) => {
      const target = editor;
      if (!target) {
        return;
      }

      /* `setContent` rebuilds the document, which drops the selection to the
       * start. On the keyboard path the caret is inside the essay and the
       * student is mid-review, so it is put back — clamped, because the
       * accepted edit may have made the document shorter. `focus()` only when
       * the editor held focus already: accept must never PULL focus out of the
       * popover or the pending-changes list, which keep their own. */
      const wasFocused = target.isFocused;
      const caret = target.state.selection.from;
      const suggestions = essaySuggestionsFromApi(essay.suggestions);

      target
        .chain()
        .setContent(essay.content, { emitUpdate: false })
        .command(({ tr }) => {
          tr.setMeta(SuggestionPluginKey, { suggestions });
          return true;
        })
        .run();

      if (wasFocused) {
        target.commands.focus(Math.min(caret, target.state.doc.content.size), {
          scrollIntoView: false,
        });
      }
    },
    [editor],
  );

  const resolve = useCallback(
    (
      target: ResolvingTarget,
      request: () => Promise<Essay | SuggestionBatchResult>,
      failureMessage: string,
    ) => {
      if (resolvingRef.current !== null) {
        return;
      }
      resolvingRef.current = target;
      setResolving(target);

      void (async () => {
        try {
          /* The student's unsaved typing has to reach the server first, or the
           * edit is applied to text the server has never seen. */
          await flush();
          if (hasUnsavedChanges()) {
            toast.error(
              "Your latest edits haven't saved yet. Save them, then try again.",
            );
            return;
          }

          const result = await request();
          const essay = "essay" in result ? result.essay : result;

          /* `essay.content` is a whole document the server built BEFORE it
           * answered, and the document stayed editable the whole time it was
           * in flight (plan Part 2 §7). Two things can have moved underneath
           * it during that second, and `emitUpdate: false` hides both — the
           * editor is replaced and autosave is never told, so their words go
           * with no error, no undo and nothing downstream noticing.
           *
           * THE SERVER MOVED ON. The student's own debounced autosave lands
           * mid-flight, so the essay now stored is newer than this response
           * and already contains the accepted text. The response is simply
           * out of date; the screen is right. Drop it, silently and without
           * walking the cache backwards — there is nothing to report.
           * Ordered as instants, never as strings (`isLaterVersion`) — the
           * comparison `useEssayAutosave` already makes on this field.
           *
           * THE EDITOR IS AHEAD. The student typed and it has not been sent
           * yet, so this response predates words that exist nowhere else.
           * Keep them on screen, record the accepted edit as server truth,
           * and say so — the next autosave carries the pre-accept version, so
           * the backend rejects it and the save state visibly becomes
           * "Retry". Their text only overwrites the accepted edit if they ask
           * for it. */
          const known = queryClient.getQueryData<Essay>(
            workspaceKeys.essays.detail(essayId),
          );
          const serverMovedOn =
            known !== undefined &&
            isLaterVersion(known.updated_at, essay.updated_at);
          const editorIsAhead = hasUnsavedChanges();

          /* Reject changes no content, so it needs no transaction at all —
           * the new suggestion list reaches the plugin through the essay prop
           * the cache update below pushes down. */
          if (target.action === "accept" && !serverMovedOn && !editorIsAhead) {
            applyToEditor(essay);
          }
          if (!serverMovedOn) {
            adoptServerEssay(queryClient, essayId, essay);
          }
          if (target.action === "accept" && !serverMovedOn && editorIsAhead) {
            toast.warning("Saved, but not shown here", {
              description:
                "You kept typing while this change was being applied, so your text and the accepted change are now two different versions. Your text is still here and still unsaved — save it to keep it, or reload to take the accepted change instead.",
              duration: DIVERGED_TOAST_MS,
            });
          }
          if ("skipped" in result && result.skipped.length > 0) {
            toast.warning(
              skippedMessage(
                result,
                target.action === "accept" ? "accepted" : "rejected",
              ),
            );
          }
        } catch {
          /* Nothing to roll back: no local edit was ever applied, so the
           * document and the suggestion list are exactly as they were. */
          toast.error(failureMessage);
        } finally {
          resolvingRef.current = null;
          setResolving(null);
        }
      })();
    },
    [applyToEditor, essayId, flush, hasUnsavedChanges, queryClient],
  );

  const acceptOne = useCallback(
    (suggestionId: string) =>
      resolve(
        { action: "accept", id: suggestionId },
        () => acceptSuggestion(essayId, suggestionId),
        "Could not accept that change — try again.",
      ),
    [essayId, resolve],
  );

  const rejectOne = useCallback(
    (suggestionId: string) =>
      resolve(
        { action: "reject", id: suggestionId },
        () => rejectSuggestion(essayId, suggestionId),
        "Could not reject that change — try again.",
      ),
    [essayId, resolve],
  );

  const acceptAll = useCallback(
    () =>
      resolve(
        { action: "accept", id: "all" },
        () => acceptAllSuggestions(essayId),
        "Could not accept those changes — try again.",
      ),
    [essayId, resolve],
  );

  const rejectAll = useCallback(
    () =>
      resolve(
        { action: "reject", id: "all" },
        () => rejectAllSuggestions(essayId),
        "Could not reject those changes — try again.",
      ),
    [essayId, resolve],
  );

  return {
    acceptAll,
    acceptOne,
    isResolving: resolving !== null,
    rejectAll,
    rejectOne,
    resolving,
  };
}
