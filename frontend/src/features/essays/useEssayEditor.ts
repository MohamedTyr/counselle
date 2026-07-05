import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

import {
  emptyToolbarState,
  type ToolbarState,
} from "@/features/essays/essay-toolbar-config";

type UseEssayEditorOptions = {
  initialContent: string;
  onUpdate: (text: string) => void;
};

export function useEssayEditor({
  initialContent,
  onUpdate,
}: UseEssayEditorOptions) {
  const editor = useEditor({
    content: initialContent,
    editorProps: {
      attributes: {
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
    onUpdate: ({ editor }) => {
      onUpdate(editor.getText());
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
    if (!editor) {
      return;
    }

    editor.commands.setContent(initialContent, { emitUpdate: false });
  }, [editor, initialContent]);

  return { editor, toolbarState };
}
