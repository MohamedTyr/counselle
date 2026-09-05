import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useEffectEvent, useMemo, useState } from "react";

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

export function useEssayEditor({
  content,
  onBlur,
  onUpdate,
  suggestions,
  syncContent,
}: UseEssayEditorOptions) {
  const contentKey = useMemo(() => JSON.stringify(content), [content]);
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
            SuggestionExtension.configure({
              getSuggestions: () => initialSuggestions,
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

  useEffect(() => {
    if (!editor || !syncContent) {
      return;
    }

    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, contentKey, editor, syncContent]);

  /* Re-anchor whenever the suggestion list itself changes. The meta is what
   * tells the plugin to recompute rather than map — a plain content resync
   * above deliberately carries none, which is the only thing separating the
   * two cases.
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
