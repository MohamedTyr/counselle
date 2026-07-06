import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo } from "react";

import type { TiptapContent } from "@/api/workspace/types";
import { countWords } from "@/features/essays/essay-content";
import {
  emptyToolbarState,
  type ToolbarState,
} from "@/features/essays/essay-toolbar-config";

export type EssayEditorUpdate = {
  content: TiptapContent;
  text: string;
  wordCount: number;
};

type UseEssayEditorOptions = {
  content: TiptapContent;
  onBlur: (update: EssayEditorUpdate) => void;
  onUpdate: (update: EssayEditorUpdate) => void;
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
  syncContent,
}: UseEssayEditorOptions) {
  const contentKey = useMemo(() => JSON.stringify(content), [content]);
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

  return { editor, toolbarState };
}
