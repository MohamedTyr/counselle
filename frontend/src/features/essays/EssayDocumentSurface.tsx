import { EditorContent, type Editor } from "@tiptap/react";
import { motion } from "motion/react";
import { useEffectEvent, useLayoutEffect } from "react";

import type { TiptapContent } from "@/api/workspace/types";
import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { essayPaperInsetClass } from "@/features/essays/essay-paper-inset";
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
 * floor and the vertical steps that column never reaches.
 *
 * Both densities read their horizontal inset from the SAME scale, stepped by
 * the scroll column's own width rather than the viewport. A hand-tuned second
 * ladder for the panel would be a value that drifts from the editor's the first
 * time either is retuned — and the panel's column is exactly the case the
 * container-query scale was written for.
 */
const densityClass: Record<EssayDocumentDensity, string> = {
  editor: cn(
    "min-h-[860px] max-w-[820px]",
    essayPaperInsetClass,
    "py-8 @xl/essay-canvas:py-10 @2xl/essay-canvas:py-11 @4xl/essay-canvas:py-14",
  ),
  panel: cn("max-w-[820px]", essayPaperInsetClass, "py-8"),
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
  /** `Mod+Enter` on a pending change. Omit and the shortcut stays unbound. */
  onAcceptSuggestion?: (suggestion: EssaySuggestion) => void;
  /** `Mod+Backspace` on a pending change. Omit and it stays unbound. */
  onRejectSuggestion?: (suggestion: EssaySuggestion) => void;
  /**
   * Hands the editor instance and its derived toolbar state up to the caller,
   * which owns whatever chrome drives them (the editor page's toolbar). Content
   * and persistence stay at the caller too: this component renders the
   * document, it does not know how essays are saved.
   */
  onEditorReady?: (editor: Editor, toolbarState: ToolbarState) => void;
  onUpdate: (update: EssayEditorUpdate) => void;
  /** Pending tracked changes to paint. Omit to render the paper alone. */
  suggestions?: EssaySuggestion[];
  syncContent: boolean;
};

export function EssayDocumentSurface({
  content,
  density = "editor",
  layoutId,
  onAcceptSuggestion,
  onBlur,
  onEditorReady,
  onRejectSuggestion,
  onUpdate,
  suggestions,
  syncContent,
}: EssayDocumentSurfaceProps) {
  const { editor, toolbarState } = useEssayEditor({
    content,
    onAcceptSuggestion,
    onBlur,
    onRejectSuggestion,
    onUpdate,
    suggestions,
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
      /*
       * Measure only when the paper changes SURFACE.
       *
       * Without a dependency at all, every re-render that happens to change
       * the paper's width runs the 420ms shared-element curve, so toggling the
       * editor's chat panel fired a route transition's animation on a panel
       * toggle: the pending-changes bar resized in one frame while the paper
       * eased for a third of a second, and mid-flight the paper's edge sat
       * under the panel. Density is constant within a surface, so that stays
       * fixed — the width still simply follows the panel's own 200ms
       * transition.
       *
       * It was `layoutId`, which is identical on both sides of the chat
       * panel → editor handoff. Pinned to a value that never changes across
       * the handoff, motion never re-measured across it either, and the one
       * transition this `layoutId` exists for degraded into a jump. Density is
       * the value that actually differs between the two papers.
       */
      layoutDependency={density}
      transition={{ layout: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
    >
      <EditorContent editor={editor} />
    </motion.div>
  );
}
