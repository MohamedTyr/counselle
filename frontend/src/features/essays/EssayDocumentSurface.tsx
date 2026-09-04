import { EditorContent, type Editor } from "@tiptap/react";
import { motion } from "motion/react";
import { useEffectEvent, useLayoutEffect } from "react";

import type { TiptapContent } from "@/api/workspace/types";
import {
  emptyToolbarState,
  type ToolbarState,
} from "@/features/essays/essay-toolbar-config";
import {
  useEssayEditor,
  type EssayEditorUpdate,
} from "@/features/essays/useEssayEditor";
import { cn } from "@/lib/utils";

export type EssayDocumentDensity = "editor" | "panel";

/*
 * The sheet of paper, and the one object the eye lands on wherever it renders.
 * `editor` is the full page's measure and its generous margins; `panel` keeps
 * the same paper in a narrow right-docked column, so it drops the page-height
 * floor and the wide-viewport padding steps that column never reaches.
 */
const densityClass: Record<EssayDocumentDensity, string> = {
  editor:
    "min-h-[860px] max-w-[820px] px-7 py-8 sm:px-12 sm:py-11 lg:px-16 lg:py-14",
  panel: "max-w-[820px] px-6 py-8",
};

type EssayDocumentSurfaceProps = {
  content: TiptapContent;
  density?: EssayDocumentDensity;
  /**
   * Shared-element continuity with the essay library card and the editor page.
   * Omit to render without a shared-element transition.
   */
  layoutId?: string;
  onBlur: (update: EssayEditorUpdate) => void;
  /**
   * Hands the editor instance and its derived toolbar state up to the caller,
   * which owns whatever chrome drives them (the editor page's toolbar). Content
   * and persistence stay at the caller too: this component renders the
   * document, it does not know how essays are saved.
   */
  onEditorReady?: (editor: Editor, toolbarState: ToolbarState) => void;
  onUpdate: (update: EssayEditorUpdate) => void;
  syncContent: boolean;
};

export function EssayDocumentSurface({
  content,
  density = "editor",
  layoutId,
  onBlur,
  onEditorReady,
  onUpdate,
  syncContent,
}: EssayDocumentSurfaceProps) {
  const { editor, toolbarState } = useEssayEditor({
    content,
    onBlur,
    onUpdate,
    syncContent,
  });

  // An effect event, so callers can pass an inline arrow: depending on the prop
  // itself would re-fire this on every render.
  const notifyEditorReady = useEffectEvent(
    (ready: Editor, state: ToolbarState) => {
      onEditorReady?.(ready, state);
    },
  );

  // Layout, not passive. The caller renders its toolbar from what this hands
  // back, and a passive effect would paint one frame of dead toolbar first.
  useLayoutEffect(() => {
    if (!editor) {
      return;
    }

    notifyEditorReady(editor, toolbarState ?? emptyToolbarState);
  }, [editor, toolbarState]);

  return (
    <motion.div
      className={cn(
        "essay-editor-shell mx-auto w-full rounded-lg border border-(--essay-document-border) bg-(--essay-document-surface) text-(--essay-document-foreground) shadow-[var(--elevation-1)]",
        densityClass[density],
      )}
      layoutId={layoutId}
      transition={{ layout: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
    >
      <EditorContent editor={editor} />
    </motion.div>
  );
}
