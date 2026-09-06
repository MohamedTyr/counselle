import type { Editor } from "@tiptap/core";
import { SquareArrowOutUpRightIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";

import { useEssay } from "@/api/workspace/hooks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { essayFromApi } from "@/domain/essay";
import type { EssayDetail } from "@/domain/essay";
import { EssayDocumentSurface } from "@/features/essays/EssayDocumentSurface";
import { SuggestionPopover } from "@/features/essays/suggestions/SuggestionPopover";
import { SuggestionsBar } from "@/features/essays/suggestions/SuggestionsBar";
import { useEssaySuggestions } from "@/features/essays/suggestions/useEssaySuggestions";
import { useSuggestionReview } from "@/features/essays/suggestions/useSuggestionReview";
import { useEssayAutosave } from "@/features/essays/useEssayAutosave";
import type { EssayEditorUpdate } from "@/features/essays/useEssayEditor";
import { cn } from "@/lib/utils";

/*
 * What the panel needs out of the row it docks into.
 *
 * 576px of panel is enough for the essay's own inset scale to give roughly 69
 * characters a line (measured: 475px of prose) — a measure a student can read
 * their own sentences in. The chat column left beside it has to stay wider than
 * the composer inside it, which floors at 424px. So docking needs 1000px of ROW.
 */
const PANEL_WIDTH_PX = 576;
const MIN_CHAT_COLUMN_PX = 424;
const MIN_DOCK_ROW_PX = PANEL_WIDTH_PX + MIN_CHAT_COLUMN_PX;

/*
 * Docked on the MEASURED width of the row, never on the viewport.
 *
 * The viewport is the wrong question: the workspace sidebar takes a measured
 * 340px out of it expanded and 48px collapsed, so any viewport breakpoint is
 * wrong by a whole sidebar in one of those two states — at 1280 the row is 940
 * expanded and 1232 collapsed, and only one of those fits a panel. Keyed to
 * `window.innerWidth >= 1024` this aside was pushed past the right edge between
 * 1024 and 1141px and clipped every line of the essay, with no horizontal
 * scrollbar to recover it —
 * the student's own writing, silently truncated. `essay-paper-inset.ts`
 * records the same lesson one level down: the container knows how much room
 * there is, the viewport does not.
 *
 * The anchor is the aside itself, which is why it stays mounted even when the
 * document is a Sheet: it is what measures the row it would dock into.
 */
function useRowFitsPanel(anchor: React.RefObject<HTMLElement | null>): boolean {
  const [docked, setDocked] = useState(false);

  /* Layout, not passive: the flip lands before paint, so the Sheet never
   * flashes on the way to a docked panel. */
  useLayoutEffect(() => {
    const row = anchor.current?.parentElement;
    if (row === null || row === undefined) {
      return;
    }
    const measure = () => {
      /* A row that has not been laid out measures 0 — there is nothing to
       * decide from, so fall back to the viewport rather than guess "too
       * narrow". Only ever true before first layout, and under jsdom. */
      const width = row.getBoundingClientRect().width || window.innerWidth;
      setDocked(width >= MIN_DOCK_ROW_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [anchor]);

  return docked;
}

function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-(--essay-editor-chrome-surface)">
      {children}
    </div>
  );
}

function PanelHeader({
  essayId,
  onClose,
  title,
}: {
  essayId: string | null;
  onClose: () => void;
  title: string;
}) {
  const navigate = useNavigate();
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-b-sidebar-border ps-4 pe-2">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {title}
      </h2>
      {essayId !== null && (
        <Button
          onClick={() => void navigate(`/app/essays/${essayId}`)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <SquareArrowOutUpRightIcon data-icon="inline-start" />
          Open in editor
        </Button>
      )}
      <Button
        aria-label="Close essay"
        onClick={onClose}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <XIcon data-icon="inline-start" />
      </Button>
    </header>
  );
}

/*
 * The scroll column the paper measures itself against.
 *
 * `@container/essay-canvas` is the same mechanism the full editor uses, and the
 * paper reads its inset from the one scale in `essay-paper-inset.ts` — so this
 * panel never carries a second, hand-tuned padding ladder that could drift from
 * the editor's. The column's own gutter keeps the container comfortably inside
 * the base step at 576px rather than sitting on its boundary.
 */
function PanelScrollColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container/essay-canvas min-h-0 flex-1 overflow-y-auto px-4 py-6">
      {/*
       * The paper's ceiling in this panel, tighter than the editor page's
       * 820px. Docked, the column is 544px and never reaches either. As a
       * Sheet it would: at 900px wide the editor's ceiling gave 724px of
       * prose — 106 characters a line, a worse measure than the narrow docked
       * panel it replaces, which is backwards. 640px holds it to ~544px of
       * prose in the Sheet too, the same rhythm the docked column reads at.
       */}
      <div className="mx-auto w-full max-w-[40rem]">{children}</div>
    </div>
  );
}

function EssayDocumentPanelBody({
  essay,
  onClose,
}: {
  essay: EssayDetail;
  onClose: () => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const autosave = useEssayAutosave(essay.id, {
    content: essay.content,
    updatedAt: essay.updatedAt,
    wordCount: essay.wordCount,
  });

  /* Read through a ref so a resolve sees the CURRENT save state after awaiting
   * the flush, not the value captured when it started — same contract the
   * editor route relies on. */
  const isDirtyRef = useRef(autosave.isDirty);
  useEffect(() => {
    isDirtyRef.current = autosave.isDirty;
  }, [autosave.isDirty]);
  const hasUnsavedChanges = useCallback(() => isDirtyRef.current, []);

  const suggestions = useEssaySuggestions({
    editor,
    essayId: essay.id,
    flush: autosave.flush,
    hasUnsavedChanges,
  });
  const { resolutions, revealSuggestion } = useSuggestionReview(editor);

  const handleUpdate = (update: EssayEditorUpdate) => {
    autosave.queueSave(update.content, update.wordCount);
  };

  return (
    <PanelFrame>
      <PanelHeader essayId={essay.id} onClose={onClose} title={essay.title} />
      <PanelScrollColumn>
        {/*
         * The same bar the editor page carries, in the panel built to show
         * proposed edits. Without it the panel has no change count, no
         * accept-all, no findable list for a change that is one comma wide,
         * and — because a decoration is silent until a screen reader lands on
         * it — no announcement that anything was proposed at all. It shares
         * this column and the paper's own inset scale, so a row's label starts
         * exactly where the sentence it describes starts.
         */}
        <SuggestionsBar
          controller={suggestions}
          onRevealSuggestion={revealSuggestion}
          resolutions={resolutions}
          suggestions={essay.pendingSuggestions}
        />
        <EssayDocumentSurface
          content={essay.content}
          density="panel"
          layoutId={`essay-document-${essay.id}`}
          onAcceptSuggestion={(suggestion) => suggestions.acceptOne(suggestion.id)}
          onBlur={() => autosave.flush()}
          onEditorReady={setEditor}
          onRejectSuggestion={(suggestion) => suggestions.rejectOne(suggestion.id)}
          onUpdate={handleUpdate}
          suggestions={essay.pendingSuggestions}
          syncContent={!autosave.isDirty}
        />
      </PanelScrollColumn>
      <SuggestionPopover
        controller={suggestions}
        editor={editor}
        suggestions={essay.pendingSuggestions}
      />
    </PanelFrame>
  );
}

function EssayDocumentPanelContent({
  essayId,
  onClose,
}: {
  essayId: string;
  onClose: () => void;
}) {
  const essayQuery = useEssay(essayId);

  if (essayQuery.isLoading) {
    return (
      <PanelFrame>
        <PanelHeader essayId={null} onClose={onClose} title="Loading essay" />
        <PanelScrollColumn>
          <Skeleton className="h-[28rem] w-full rounded-lg" />
        </PanelScrollColumn>
      </PanelFrame>
    );
  }

  if (essayQuery.isError || !essayQuery.data) {
    return (
      <PanelFrame>
        <PanelHeader essayId={null} onClose={onClose} title="Essay" />
        <PanelScrollColumn>
          <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              The workspace could not reach this essay.
            </p>
            <Button
              onClick={() => void essayQuery.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </PanelScrollColumn>
      </PanelFrame>
    );
  }

  /*
   * Keyed on the essay id: the editor mounts its tracked-changes extension from
   * whether suggestions exist at its FIRST render, so a panel that swapped one
   * essay for another in place would keep the first essay's decision. A remount
   * is also what resets autosave's per-essay draft state.
   */
  return (
    <EssayDocumentPanelBody
      essay={essayFromApi(essayQuery.data)}
      key={essayQuery.data.id}
      onClose={onClose}
    />
  );
}

/**
 * The essay a chat receipt opened, docked beside the conversation.
 *
 * Non-modal when docked: the student keeps reading the answer that produced the
 * edit while the draft sits next to it. Below the dock breakpoint it becomes a
 * `Sheet`, which is modal by nature — but there the conversation is behind the
 * panel anyway, so there is nothing to keep readable.
 */
export function EssayDocumentPanel({
  essayId,
  onClose,
}: {
  essayId: string;
  onClose: () => void;
}) {
  const asideRef = useRef<HTMLElement>(null);
  const docked = useRowFitsPanel(asideRef);

  useEffect(() => {
    if (!docked) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      /* Anything nearer the Escape — a menu, a popover, the composer's own
       * handling — closes itself first and says so by defaulting the event.
       * The panel is the outermost thing on this key, so it goes last. */
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [docked, onClose]);

  return (
    <>
      <aside
        aria-label={docked ? "Essay panel" : undefined}
        className={cn(
          "h-full w-[36rem] shrink-0 border-s border-s-sidebar-border",
          docked
            ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 flex flex-col duration-200 ease-out"
            : "hidden",
        )}
        ref={asideRef}
      >
        {docked && (
          <EssayDocumentPanelContent essayId={essayId} onClose={onClose} />
        )}
      </aside>
      {!docked && (
        <Sheet onOpenChange={(open) => !open && onClose()} open>
          <SheetContent
            aria-label="Essay"
            className="w-full max-w-full rounded-none border-s-0 bg-(--essay-editor-chrome-surface) p-0"
            showCloseButton={false}
            side="right"
          >
            <SheetTitle className="sr-only">Essay</SheetTitle>
            <EssayDocumentPanelContent essayId={essayId} onClose={onClose} />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
