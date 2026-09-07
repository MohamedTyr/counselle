import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TiptapContent } from "@/api/workspace/types";
import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { countWords } from "@/features/essays/essay-content";
import {
  emptyToolbarState,
  type ToolbarState,
} from "@/features/essays/essay-toolbar-config";
import {
  SuggestionExtension,
  SuggestionPluginKey,
} from "@/features/essays/suggestions/suggestionExtension";

export type EssayEditorUpdate = {
  content: TiptapContent;
  text: string;
  wordCount: number;
};

type UseEssayEditorOptions = {
  content: TiptapContent;
  onBlur: (update: EssayEditorUpdate) => void;
  /** `Mod+Enter` on a pending change. Omit and the shortcut stays unbound. */
  onAcceptSuggestion?: (suggestion: EssaySuggestion) => void;
  /** `Mod+Backspace` on a pending change. Omit and it stays unbound. */
  onRejectSuggestion?: (suggestion: EssaySuggestion) => void;
  onUpdate: (update: EssayEditorUpdate) => void;
  /**
   * Pending tracked changes to paint. Omit entirely and the decoration layer
   * is never mounted, so a caller that has no use for suggestions carries none
   * of their cost.
   */
  suggestions?: EssaySuggestion[];
  syncContent: boolean;
};

function editorUpdate(editor: Editor): EssayEditorUpdate {
  const text = editor.getText();

  return {
    content: editor.getJSON() as TiptapContent,
    text,
    wordCount: countWords(text),
  };
}

/*
 * "Is this the same document?", with KEY ORDER LEFT OUT OF THE ANSWER.
 *
 * The `content` prop round-trips through a Postgres `jsonb` column, which
 * normalises object key order: the server returns `{"text": …, "type": "text"}`
 * where Tiptap emits `{"type": "text", "text": …}`. A plain `JSON.stringify`
 * comparison of the two therefore never matches on any document containing
 * text — so the resync's "skip a genuine no-op" guard below never skipped
 * anything, and every settled autosave replaced the whole document with a copy
 * of itself. Sorting keys is what makes that guard mean what it says.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) =>
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : raw,
  );
}

export function useEssayEditor({
  content,
  onBlur,
  onAcceptSuggestion,
  onRejectSuggestion,
  onUpdate,
  suggestions,
  syncContent,
}: UseEssayEditorOptions) {
  const contentKey = useMemo(() => canonicalJson(content), [content]);
  /* The extension is configured once, when the editor is built, so its
   * keyboard shortcuts close over whatever was passed at that moment. These
   * two are stable but read the handler through a ref at call time, so
   * `Mod+Enter` always reaches the CURRENT accept — the one that knows about
   * the panel-wide resolving lock — rather than the first this hook ever saw.
   * An effect event would be the natural fit and cannot be used: it may not be
   * passed out of the component that created it. */
  const resolveHandlersRef = useRef({ onAcceptSuggestion, onRejectSuggestion });
  useEffect(() => {
    resolveHandlersRef.current = { onAcceptSuggestion, onRejectSuggestion };
  }, [onAcceptSuggestion, onRejectSuggestion]);

  const acceptSuggestion = useCallback((suggestion: EssaySuggestion) => {
    resolveHandlersRef.current.onAcceptSuggestion?.(suggestion);
  }, []);
  const rejectSuggestion = useCallback((suggestion: EssaySuggestion) => {
    resolveHandlersRef.current.onRejectSuggestion?.(suggestion);
  }, []);
  // The list is re-derived on every render upstream, so identity churns while
  // its contents don't. Key on the value, exactly as `contentKey` already
  // does, or the sync effect below would dispatch on every render forever.
  const suggestionsKey = useMemo(
    () => (suggestions ? JSON.stringify(suggestions) : null),
    [suggestions],
  );
  /* Captured once, at mount: the editor is built once, and after that the
   * suggestions-changed meta below is what keeps the plugin current. */
  const [initialSuggestions] = useState(() => suggestions ?? null);
  const editor = useEditor({
    content,
    editorProps: {
      attributes: {
        "aria-label": "Essay body",
        class: "essay-editor-content",
      },
    },
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2],
        },
      }),
      TextStyle,
      FontFamily,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Placeholder.configure({
        placeholder: "Start drafting here...",
      }),
      ...(initialSuggestions
        ? [
            /* The rule sees two callbacks that close over a ref being handed
             * to a call made during render, and cannot see that neither one
             * READS the ref until a key is pressed. The alternative it wants —
             * passing the handlers straight through — is the stale-closure bug
             * the ref exists to prevent, because the extension is configured
             * once and these handlers change identity as the editor mounts. */
            // eslint-disable-next-line react-hooks/refs
            SuggestionExtension.configure({
              getSuggestions: () => initialSuggestions,
              onAccept: acceptSuggestion,
              onReject: rejectSuggestion,
            }),
          ]
        : []),
    ],
    immediatelyRender: false,
    onBlur: ({ editor }) => {
      onBlur(editorUpdate(editor));
    },
    onUpdate: ({ editor }) => {
      onUpdate(editorUpdate(editor));
    },
  });

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor }): ToolbarState => {
      if (!editor) {
        return emptyToolbarState;
      }

      return {
        fontFamily: editor.getAttributes("textStyle").fontFamily ?? "default",
        isAlignCenter: editor.isActive({ textAlign: "center" }),
        isAlignRight: editor.isActive({ textAlign: "right" }),
        isBlockquote: editor.isActive("blockquote"),
        isBold: editor.isActive("bold"),
        isBulletList: editor.isActive("bulletList"),
        isHeading: editor.isActive("heading", { level: 2 }),
        isItalic: editor.isActive("italic"),
        isOrderedList: editor.isActive("orderedList"),
      };
    },
  });

  /*
   * A resync REPLACES THE WHOLE DOCUMENT, so it must re-anchor, never map.
   *
   * Every position inside a replaced range maps onto that range's boundary, so
   * the plugin's mapping branch turns each pending change into a zero-width
   * range: `buildDecorations` paints nothing for it and the bar calls it
   * outdated, while the server still holds a row that anchors perfectly. The
   * recompute branch searches the new document for each anchor instead, which
   * is the only answer a replacement survives — so this carries the same meta,
   * in the same transaction, and for the same reason as the accept flow
   * (`useEssaySuggestions.applyToEditor`).
   *
   * An effect event so the current list is read without its churning identity
   * becoming a dependency, exactly as `reanchorSuggestions` below does.
   */
  const resyncContent = useEffectEvent((target: Editor, next: TiptapContent) => {
    target
      .chain()
      .setContent(next, { emitUpdate: false })
      .command(({ tr }) => {
        tr.setMeta(SuggestionPluginKey, { suggestions: suggestions ?? [] });
        return true;
      })
      .run();
  });

  useEffect(() => {
    if (!editor || !syncContent) {
      return;
    }

    /* A resync that would replace the document with what it already contains
     * is not free: `setContent` rebuilds the doc and moves the caret out of
     * the student's sentence. It fires after an accepted suggestion, whose
     * content the accept flow has already applied itself. The comparison
     * ignores key order (`canonicalJson`), because the server's copy comes
     * back from `jsonb` reordered and a byte-exact one could never match. */
    if (canonicalJson(editor.getJSON()) === contentKey) {
      return;
    }

    resyncContent(editor, content);
  }, [content, contentKey, editor, syncContent]);

  /* Re-anchor whenever the suggestion list itself changes — the list moved
   * under a document that did not. The meta is what tells the plugin to
   * recompute rather than map; mapping is only ever right for an ordinary
   * edit, which is the one case that dispatches no meta at all.
   *
   * An effect event, so the dispatch reads the current list without the list's
   * churning identity being a dependency: keyed on the value, it would
   * otherwise re-dispatch on every render forever. */
  const reanchorSuggestions = useEffectEvent((target: Editor) => {
    target.view.dispatch(
      target.state.tr.setMeta(SuggestionPluginKey, {
        suggestions: suggestions ?? [],
      }),
    );
  });

  useEffect(() => {
    if (!editor || suggestionsKey === null) {
      return;
    }

    reanchorSuggestions(editor);
  }, [editor, suggestionsKey]);

  return { editor, toolbarState };
}
