import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, PanelRight, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/PageHeader";
import { EssayDocumentSurface } from "@/features/essays/EssayDocumentSurface";
import {
  EssayContextTrail,
  EssayStatusIndicator,
  HeaderDivider,
  PromptMenu,
} from "@/features/essays/EssayEditorHeader";
import { EssayEditorToolbar } from "@/features/essays/EssayEditorToolbar";
import { EssayTasksSection } from "@/features/essays/EssayTasksSection";
import {
  emptyToolbarState,
  type ToolbarState,
} from "@/features/essays/essay-toolbar-config";
import {
  getEssayPrompt,
  getSchoolFallback,
  getSchoolFaviconUrl,
} from "@/features/essays/essay-content";
import type { EssayEditorUpdate } from "@/features/essays/useEssayEditor";
import type { EssayEditorPageProps } from "@/features/essays/essays-types";
import { useEssayAutosave } from "@/features/essays/useEssayAutosave";
import { EssayChatPanel } from "@/features/essays/EssayChatPanel";
import { SuggestionPopover } from "@/features/essays/suggestions/SuggestionPopover";
import { countPendingChanges } from "@/features/essays/suggestions/suggestion-counts";
import { SuggestionsBar } from "@/features/essays/suggestions/SuggestionsBar";
import { useSuggestionReview } from "@/features/essays/suggestions/useSuggestionReview";
import { useEssaySuggestions } from "@/features/essays/suggestions/useEssaySuggestions";
import { useAcceptAllWordCount } from "@/features/essays/suggestions/word-projection";
import { useDebounce } from "@/hooks/useDebounce";
import { workspaceKeys } from "@/api/workspace/keys";
import { getEssayActivityLabel } from "@/lib/essay-display";
import { cn } from "@/lib/utils";

/*
 * Where the essay and the 380px chat panel both fit (Tailwind's `xl`).
 *
 * Measured, not guessed. Below it the panel's 380px comes out of a column that
 * is already carrying the sidebar: docking at 1024px leaves the paper 276px
 * wide and the prose eighteen characters a line, which is not a document a
 * student can read their own sentences in. So below this the panel covers the
 * document instead of splitting it.
 *
 * What holds above it is the *paper*, not this number. The original measure
 * here (56 characters at 1280, 74 at 1440) was taken on a branch with no task
 * rail; merged, the rail took another 288px and the same cells measured 130px
 * (18 characters) at 1280 and 274px (43) at 1440, sidebar expanded. The rail
 * is keyed to the column that actually shrinks now (see the `aside` below), so
 * those two cells re-measure at 450px/67ch and 594px/95ch, and no cell in the
 * grid falls below 392px/61ch.
 *
 * This threshold is still viewport-keyed, and still wrong by a whole sidebar
 * in one of its two states — it costs an avoidable overlay between roughly
 * 1141 and 1280px with the sidebar collapsed, and it is the open item in
 * TODOS.md. It is not what starved the paper.
 */
const PANEL_DOCK_BREAKPOINT_PX = 1280;

/* Long enough that dragging a selection does not restream a chip on every
 * pointer move, short enough that letting go feels immediate. */
const SELECTION_SETTLE_MS = 150;

function useIsPanelDocked(): boolean {
  const [docked, setDocked] = useState(
    () => window.innerWidth >= PANEL_DOCK_BREAKPOINT_PX,
  );

  useEffect(() => {
    const query = window.matchMedia(
      `(min-width: ${PANEL_DOCK_BREAKPOINT_PX}px)`,
    );
    const onChange = () => setDocked(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return docked;
}

/* The chip is a reminder of what is attached, not the text itself. */
const SELECTION_CHIP_MAX_CHARS = 80;

export function EssayEditorPage({ essay, onBack }: EssayEditorPageProps) {
  const [wordCount, setWordCount] = useState(essay.wordCount);
  /* The document surface owns the editor; the toolbar lives up here in its own
   * chrome band, so it needs the instance and its state handed back. */
  const [editorHandle, setEditorHandle] = useState<{
    editor: Editor;
    toolbarState: ToolbarState;
  } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  /*
   * The panel has finished arriving, so anything behind it is genuinely hidden.
   *
   * The tools band below keys off this rather than off `panelOpen`, because its
   * 50px leaves the layout the instant it unmounts: dropping it on the click
   * jumped the document up 50px (measured 183 → 133) while the panel was still
   * off the right edge and 560px of prose was still on screen — a visible jolt
   * for the ~230ms of the slide. Deferring to here puts the shift under an
   * opaque surface. The close direction needs no signal: resetting it in
   * `closePanel` restores the band while the panel is still covering, so that
   * shift is hidden too.
   */
  const [panelSettled, setPanelSettled] = useState(false);
  const panelDocked = useIsPanelDocked();
  const reduceMotion = useReducedMotion();
  const [dismissedSelection, setDismissedSelection] = useState<string | null>(
    null,
  );
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const autosave = useEssayAutosave(essay.id, {
    content: essay.content,
    updatedAt: essay.updatedAt,
    wordCount: essay.wordCount,
  });
  const editor = editorHandle?.editor ?? null;

  /* Read through a ref so the resolve flow sees the CURRENT save state after
   * awaiting the flush, not the value captured when it started. */
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

  const {
    focusDocument,
    resolutions: suggestionResolutions,
    revealSuggestion,
  } = useSuggestionReview(editor);

  const rawSelection = useEditorState({
    editor,
    selector: ({ editor: current }): string => {
      if (!current) {
        return "";
      }
      const { empty, from, to } = current.state.selection;
      return empty ? "" : current.state.doc.textBetween(from, to, " ").trim();
    },
  });
  const settledSelection = useDebounce(rawSelection ?? "", SELECTION_SETTLE_MS);
  /* Dismissing the chip must not clear the editor's own selection — the
   * student may still be looking at the words they highlighted. It only says
   * "don't attach this one", and picking anything else brings the chip back. */
  const selection =
    settledSelection === "" || settledSelection === dismissedSelection
      ? null
      : settledSelection.slice(0, SELECTION_CHIP_MAX_CHARS);

  const refetchEssay = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: workspaceKeys.essays.detail(essay.id),
    });
  }, [essay.id, queryClient]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setPanelSettled(false);
    /* The one explicit focus move this panel needs: closing a non-modal
     * surface should leave focus on the control that closed it, not on
     * `<body>` where the next Tab starts over from the top of the page. */
    panelToggleRef.current?.focus();
  }, []);

  const prompt = getEssayPrompt(essay);
  const schoolFallback = getSchoolFallback(essay.schoolName);
  const hasWordLimit = essay.wordLimit !== null && essay.wordLimit > 0;
  const displayedWordCount = autosave.isDirty ? wordCount : essay.wordCount;
  const isOverLimit =
    hasWordLimit && displayedWordCount > (essay.wordLimit ?? 0);
  const modifiedLabel = autosave.isDirty
    ? "Unsaved changes"
    : getEssayActivityLabel(essay);
  /* What the count becomes if every applicable change is accepted, or null
   * when that number is not knowable — see `word-projection.ts`. Checked
   * against the count actually on screen, so the two can never disagree. */
  const projectedWordCount = useAcceptAllWordCount(editor, displayedWordCount);

  function handleUpdate(update: EssayEditorUpdate) {
    setWordCount(update.wordCount);
    autosave.queueSave(update.content, update.wordCount);
  }

  function handleBlur(update: EssayEditorUpdate) {
    setWordCount(update.wordCount);
    autosave.flush();
  }

  const saveLabel =
    autosave.saveState === "error"
      ? "Retry"
      : autosave.saveState === "saving"
        ? "Saving"
        : "Saved";

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-(--essay-editor-chrome-surface)">
      {/*
       * Flush chrome in three bands — identity, then tools, then the canvas —
       * separated by hairlines rather than by raised surfaces. The editor should
       * have exactly one object the eye lands on, the sheet of paper; a bordered
       * shadowed header card and a floating toolbar pill made three. The title
       * band borrows PageHeader's geometry (min-h-16, px-6/md:px-10) so it sits
       * on the same baseline every other workspace route does.
       */}
      <div className="shrink-0 border-b">
        <div className="px-6 md:px-10">
          <PageHeader
            actions={
              <div className="flex items-center gap-3">
                {/*
                 * Metadata is text; icons mean "you can press this". The old row
                 * icon-prefixed every item, so the two real controls read as more
                 * inert labels in a chain of five.
                 */}
                <div className="flex items-center gap-3 text-sm whitespace-nowrap text-muted-foreground">
                  <span className="tabular-nums shrink-0">
                    <span
                      className={cn(
                        "font-semibold",
                        isOverLimit ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {displayedWordCount}
                    </span>
                    {hasWordLimit ? ` / ${essay.wordLimit} words` : " words"}
                    {/*
                     * Only ever present while there is something to project,
                     * and it is the added part of this segment rather than its
                     * content — so it is the part that drops when the bar gets
                     * tight, one step later than "Modified …" does. Below `xl`
                     * the sidebar is still at full width and the actions column
                     * is `shrink-0`: measured at 1024, showing this clause takes
                     * a realistic prompt title from 204px to 97px.
                     */}
                    {projectedWordCount !== null && (
                      <span className="hidden text-xs xl:inline">
                        {` · ${projectedWordCount} if you accept all`}
                      </span>
                    )}
                  </span>
                  {/*
                   * PageHeader's actions column is `shrink-0`, so anything left
                   * in here is width the title can never reclaim. Between `md`
                   * (where the header goes back to a single row) and `xl` the
                   * sidebar is still at full width, which leaves the bar around
                   * 410px to hold nine things — so the two most expendable drop
                   * out by priority rather than squeezing the title to an
                   * ellipsis. "Modified" is the least load-bearing; the status
                   * is next, and the essay list already carries it.
                   */}
                  <span className="hidden items-center gap-3 xl:flex">
                    <HeaderDivider />
                    {modifiedLabel}
                  </span>
                </div>
                <HeaderDivider />
                <div className="flex items-center gap-0.5">
                  <PromptMenu essayId={essay.id} prompt={prompt} />
                  <Button
                    className={cn(
                      "h-8",
                      autosave.saveState === "saved" &&
                        "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={autosave.saveState === "saving"}
                    onClick={
                      autosave.saveState === "error"
                        ? autosave.retry
                        : undefined
                    }
                    type="button"
                    variant={
                      autosave.saveState === "error" ? "default" : "ghost"
                    }
                  >
                    <Save aria-hidden="true" data-icon="inline-start" />
                    {saveLabel}
                  </Button>
                  <Button
                    aria-label={
                      panelOpen
                        ? "Close Counselle panel"
                        : "Open Counselle panel"
                    }
                    aria-pressed={panelOpen}
                    className="h-8"
                    onClick={() =>
                      panelOpen ? closePanel() : setPanelOpen(true)
                    }
                    ref={panelToggleRef}
                    size="icon-sm"
                    title={
                      panelOpen
                        ? "Close Counselle panel"
                        : "Open Counselle panel"
                    }
                    type="button"
                    variant={panelOpen ? "secondary" : "ghost"}
                  >
                    <PanelRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            }
            heading={
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  aria-label="Back to essays"
                  className="-ml-1.5 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={onBack}
                  size="icon-sm"
                  title="Back to essays"
                  type="button"
                  variant="ghost"
                >
                  <ArrowLeft />
                </Button>
                {/*
                 * The school mark is the first thing to go when the bar gets
                 * tight: the breadcrumb directly under the title already names
                 * the school, so below `xl` this is the one purely decorative
                 * item competing with the title for width.
                 */}
                <Avatar className="hidden size-9 shrink-0 rounded-lg ring-1 ring-[var(--edge-strong)] xl:flex">
                  <AvatarImage
                    alt=""
                    className="rounded-lg"
                    src={getSchoolFaviconUrl(essay.schoolWebsiteUrl)}
                  />
                  <AvatarFallback className="rounded-lg text-xs font-semibold">
                    {schoolFallback}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-x-2.5">
                    <h1 className="min-w-0 truncate text-xl leading-none font-semibold tracking-tight">
                      {essay.title}
                    </h1>
                    <EssayStatusIndicator
                      className="hidden lg:inline-flex"
                      status={essay.status}
                    />
                  </div>
                  <EssayContextTrail essay={essay} />
                </div>
              </div>
            }
            rule="full"
            title={essay.title}
          />
        </div>
        {/*
         * Its own band, ruled above (PageHeader's) and below (this block's), so
         * the tools read as a distinct register from the essay's identity rather
         * than as more header. It scrolls sideways on narrow viewports rather
         * than wrapping — a toolbar that changes height as the window resizes
         * moves the document out from under the cursor.
         *
         * Gone entirely once the panel covers the document — the same condition
         * that makes the column `inert` below, held until the panel has
         * actually arrived (see `panelSettled`). Bold on prose nobody can see
         * is merely confusing; Undo on it is worse — it can revert a change the
         * student accepted a moment ago, off-screen, silently.
         */}
        {!(panelOpen && !panelDocked && panelSettled) && (
          <div className="overflow-x-auto px-6 py-1.5 md:px-10">
            <EssayEditorToolbar
              editor={editorHandle?.editor ?? null}
              state={editorHandle?.toolbarState ?? emptyToolbarState}
            />
          </div>
        )}
      </div>

      {/*
       * The panel is a sibling of the scroll column, not a child of it, so it
       * keeps full height and its own scroll while the document scrolls
       * underneath — the same shape the chat's own sources rail already uses.
       */}
      <div className="relative flex min-h-0 flex-1">
        {/* The paper and the changes bar size themselves off THIS column, not
         * off the window: the chat panel takes 380px out of it, and a padding
         * step that keys on the viewport keeps paying wide-screen margins on a
         * sheet of paper that no longer has wide-screen room. */}
        <div
          className="@container/essay-canvas min-h-0 flex-1 overflow-y-auto bg-(--essay-editor-chrome-surface)"
          /* Fully covered by the panel here, and content nobody can see is
           * content nobody should be able to Tab into. */
          inert={panelOpen && !panelDocked}
        >
          {/* No `gap`: the rail carries its own 24px gutter inside its box, so
           * the space between the paper and the rail can collapse with the
           * rail rather than outliving it by 32px. */}
          <div className="mx-auto flex w-full max-w-[1440px] px-4 pt-6 pb-12 lg:px-7 lg:pt-8 lg:pb-16">
            {/* A plain column, not a second <main>: `SidebarInset` already
             * renders the page's one main landmark, and nesting another put two
             * of them in the tree — DESIGN.md §16.1, and axe flags it twice. */}
            <div className="min-w-0 flex-1">
              <SuggestionsBar
                controller={suggestions}
                onQueueCleared={focusDocument}
                onRevealSuggestion={revealSuggestion}
                resolutions={suggestionResolutions}
                suggestions={essay.pendingSuggestions}
              />
              <EssayDocumentSurface
                content={essay.content}
                density="editor"
                layoutId={`essay-document-${essay.id}`}
                onAcceptSuggestion={(suggestion) =>
                  suggestions.acceptOne(suggestion.id)
                }
                onBlur={handleBlur}
                onEditorReady={(editor, toolbarState) =>
                  setEditorHandle({ editor, toolbarState })
                }
                onRejectSuggestion={(suggestion) =>
                  suggestions.rejectOne(suggestion.id)
                }
                onUpdate={handleUpdate}
                suggestions={essay.pendingSuggestions}
                syncContent={!autosave.isDirty}
              />
            </div>
            {/*
             * Shown on the SCROLL COLUMN's own width, never the viewport — the
             * same question `essay-paper-inset.ts` answers one level down, on
             * the same `@container/essay-canvas` ladder.
             *
             * `xl:block` was the bug. The viewport cannot see the 380px panel,
             * so at a 1280px viewport with the sidebar expanded the rail and
             * the panel each claimed their width out of a 968px row and left
             * the paper 130px — eighteen characters a line, beside a rail
             * holding "Tasks" and an empty quick-add. Keyed to the column, the
             * rail yields before the paper does: across {1280,1440,1600,1920}
             * × {sidebar expanded, collapsed} × {panel open, closed} the worst
             * cell is 392px/61ch rather than 130px/18ch, and every
             * panel-closed cell is identical to the pixel.
             *
             * WHY 896, as arithmetic and not as the inset step it happens to
             * share: it is the narrowest column at which the rail-ON branch
             * still leaves a legal measure. 896 − 56 (`lg:px-7`) − 320 (this
             * box) − 128 (`@4xl:px-16` on the paper) = 392px, which measures
             * 61 characters — just inside the 60–65ch long-form band of
             * DESIGN.md §6.5. One ladder step down (`@3xl`, 768px) the same
             * sum is 296px/46ch, and there the rail would be costing the
             * measure more than the rail is worth (spec §6.6: on a
             * document-focused page the task rail gives up width first).
             *
             * It also reaches WIDER than `xl:block` did, deliberately. The
             * rail now appears from a ~944px viewport with the sidebar
             * collapsed and ~1208px expanded, where `xl:` hid it below 1280
             * unconditionally — so a 1024px tablet with the sidebar collapsed
             * gets a rail it never used to. That is the better half of the
             * trade: where the rail shows, the paper measures 61–74ch; where
             * it does not, the paper sits on its `max-w-[820px]` cap at
             * 108–115ch, outside rule 17 entirely. The rail arriving earlier
             * is what holds the measure legal, not what costs it.
             *
             * Known thin margin: at 1600 with the sidebar expanded and the
             * panel docked the column is 898px in a browser that paints a
             * scrollbar (908 without one) — this one cell clears 896 by 2px,
             * and 3px on `--sidebar-width`, `--scrollbar-size` or `lg:px-7`
             * flips it, moving the paper ~330px. Left on the ladder anyway:
             * the only other rung is ruled out above, and an off-ladder value
             * below 896 would make the paper *narrow* by 16px as the window
             * widens past 896, where the inset steps to `px-16` under a rail
             * that is already in.
             */}
            <aside
              className={cn(
                /* 320 = the rail's 288 plus the 24px gutter it carries below,
                 * with 8px left over for the row hover background's `-mx-2`
                 * bleed, which `overflow-hidden` would otherwise square off. */
                "invisible w-0 shrink-0 overflow-hidden",
                "@4xl/essay-canvas:visible @4xl/essay-canvas:w-80",
                /*
                 * A width, at the panel's own 200ms tier — the accordion
                 * carve-out of DESIGN.md §12.1 rule 2, the same one §15.6.1
                 * already spends on the panel beside it, and for the same
                 * reason: the paper has to follow the edge frame for frame.
                 *
                 * The panel toggle crosses this threshold, so `hidden`/`block`
                 * put a 320px step inside a 200ms reflow. rAF-sampled at
                 * 1280/expanded, resampled onto a 16.7ms frame: closing grew
                 * the paper to 722px and then took 321px back in one frame
                 * ~148ms in; opening handed back 272px the same way. Spread
                 * over 200ms the rail's own worst frame is 59px, and 0–27px in
                 * the other cells.
                 *
                 * `ease-in-out`, which the rest of the app does not use, and
                 * not the house `ease-out`: this segment does not start from
                 * rest. It picks up from a panel that is already decelerating,
                 * so a curve with its speed at the front spikes exactly where
                 * the two meet — measured 84px there against 59px here. It
                 * ends at rest, so it settles rather than stops.
                 *
                 * `visibility` rides along because a 0-width box is still
                 * tabbable and still read aloud, which `hidden` was quietly
                 * handling before. It is the one property whose interpolation
                 * does the right thing unasked: visible from the first frame
                 * on the way in, held until the last frame on the way out.
                 */
                "motion-safe:transition-[width,visibility] motion-safe:duration-200 motion-safe:ease-in-out",
              )}
            >
              <div className="ml-6 w-72">
                <EssayTasksSection essayId={essay.id} />
              </div>
            </aside>
          </div>
        </div>
        {/*
         * Covering, the panel arrives over the essay rather than instead of it
         * — so the essay dims under it on the way in and comes back up on the
         * way out. Without that the swap is a hard cut and reads as a
         * navigation: the reviewer's finding was that a student on a 1024px
         * laptop believed they had left their draft behind.
         *
         * `pointer-events-none` and no dialog semantics on purpose. This is NOT
         * a modal backdrop — the panel stays non-modal (DESIGN.md §15.6.1)
         * because accepting a tracked change with the chat open is the
         * feature's core loop, and a scrim that swallowed clicks or trapped
         * focus would break exactly that. It is a dimming pass, not a barrier,
         * and `--z-dropdown` puts it under the panel's `--z-sticky` and over
         * the document.
         *
         * Its OWN `AnimatePresence`, deliberately. Sharing the panel's turned
         * that one into a two-child presence set, and the panel's
         * `onAnimationComplete` then fired at 56ms instead of ~230ms — which
         * dropped the tools band while the panel was still 575px off the left
         * edge, jolting the visible document up 40px. Separate presence sets,
         * separate lifecycles.
         */}
        <AnimatePresence initial={false}>
          {panelOpen && !panelDocked && (
            <motion.div
              animate={{ opacity: 1 }}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[var(--z-dropdown)] bg-[var(--overlay-scrim)]"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: [0, 0, 0.2, 1] }
              }
            />
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {panelOpen && (
            <EssayChatPanel
              /* The same split the bar beside it prints, from the same
               * function — the readout counting the raw server rows put
               * "3 waiting" on screen beside "Counselle proposed 2 changes". */
              changeCounts={countPendingChanges(
                essay.pendingSuggestions,
                suggestionResolutions,
              )}
              docked={panelDocked}
              essayId={essay.id}
              essayTitle={essay.title}
              onClearSelection={() => setDismissedSelection(settledSelection)}
              onClose={closePanel}
              onEnterComplete={() => setPanelSettled(true)}
              onTurnSettled={refetchEssay}
              selection={selection}
            />
          )}
        </AnimatePresence>
      </div>
      <SuggestionPopover
        controller={suggestions}
        editor={editor}
        suggestions={essay.pendingSuggestions}
      />
    </section>
  );
}
