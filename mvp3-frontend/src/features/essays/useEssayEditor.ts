import { useEditor, useEditorState } from "@tiptap/react"
import Placeholder from "@tiptap/extension-placeholder"
import TextAlign from "@tiptap/extension-text-align"
import { FontFamily, TextStyle } from "@tiptap/extension-text-style"
import StarterKit from "@tiptap/starter-kit"

import {
  emptyToolbarState,
  type ToolbarState,
} from "@/features/essays/essay-toolbar-config"

type UseEssayEditorOptions = {
  initialContent: string
  onUpdate: (text: string) => void
}

export function useEssayEditor({
  initialContent,
  onUpdate,
}: UseEssayEditorOptions) {
  const editor = useEditor({
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
    content: initialContent,
    editorProps: {
      attributes: {
        class: "essay-editor-content",
      },
    },
    immediatelyRender: true,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getText())
    },
  })

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor }): ToolbarState => {
      if (!editor) {
        return emptyToolbarState
      }

      return {
        fontFamily: editor.getAttributes("textStyle").fontFamily ?? "default",
        isBold: editor.isActive("bold"),
        isItalic: editor.isActive("italic"),
        isHeading: editor.isActive("heading", { level: 2 }),
        isBulletList: editor.isActive("bulletList"),
        isOrderedList: editor.isActive("orderedList"),
        isBlockquote: editor.isActive("blockquote"),
        isAlignCenter: editor.isActive({ textAlign: "center" }),
        isAlignRight: editor.isActive({ textAlign: "right" }),
      }
    },
  })

  return { editor, toolbarState }
}
