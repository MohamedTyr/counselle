import { EditorContent } from "@tiptap/react";
import { ArrowLeft, Save } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/PageHeader";
import {
  EssayContextTrail,
  EssayStatusIndicator,
  HeaderDivider,
  PromptMenu,
} from "@/features/essays/EssayEditorHeader";
import { EssayEditorToolbar } from "@/features/essays/EssayEditorToolbar";
import { emptyToolbarState } from "@/features/essays/essay-toolbar-config";
import {
  getEssayPrompt,
  getSchoolFallback,
  getSchoolFaviconUrl,
} from "@/features/essays/essay-content";
import type { EssayEditorUpdate } from "@/features/essays/useEssayEditor";
import type { EssayEditorPageProps } from "@/features/essays/essays-types";
import { useEssayAutosave } from "@/features/essays/useEssayAutosave";
import { useEssayEditor } from "@/features/essays/useEssayEditor";
import { getEssayActivityLabel } from "@/lib/essay-display";
import { cn } from "@/lib/utils";

export function EssayEditorPage({ essay, onBack }: EssayEditorPageProps) {
  const [wordCount, setWordCount] = useState(essay.wordCount);
  const autosave = useEssayAutosave(essay.id, {
    content: essay.content,
    wordCount: essay.wordCount,
  });
  const prompt = getEssayPrompt(essay);
  const schoolFallback = getSchoolFallback(essay.schoolName);
  const hasWordLimit = essay.wordLimit !== null && essay.wordLimit > 0;
  const displayedWordCount = autosave.isDirty ? wordCount : essay.wordCount;
  const isOverLimit =
    hasWordLimit && displayedWordCount > (essay.wordLimit ?? 0);
  const modifiedLabel = autosave.isDirty
    ? "Unsaved changes"
    : getEssayActivityLabel(essay);

  function handleUpdate(update: EssayEditorUpdate) {
    setWordCount(update.wordCount);
    autosave.queueSave(update.content, update.wordCount);
  }

  function handleBlur(update: EssayEditorUpdate) {
    setWordCount(update.wordCount);
    autosave.flush();
  }

  const { editor, toolbarState } = useEssayEditor({
    content: essay.content,
    onBlur: handleBlur,
    onUpdate: handleUpdate,
    syncContent: !autosave.isDirty,
  });

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
         */}
        <div className="overflow-x-auto px-6 py-1.5 md:px-10">
          <EssayEditorToolbar
            editor={editor}
            state={toolbarState ?? emptyToolbarState}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-(--essay-editor-chrome-surface)">
        <div className="mx-auto flex w-full max-w-[1440px] px-4 pt-6 pb-12 lg:px-7 lg:pt-8 lg:pb-16">
          <main className="min-w-0 flex-1">
            <motion.div
              className="essay-editor-shell mx-auto min-h-[860px] w-full max-w-[820px] rounded-lg border border-(--essay-document-border) bg-(--essay-document-surface) px-7 py-8 text-(--essay-document-foreground) shadow-[var(--elevation-1)] sm:px-12 sm:py-11 lg:px-16 lg:py-14"
              layoutId={`essay-document-${essay.id}`}
              transition={{
                layout: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
              }}
            >
              <EditorContent editor={editor} />
            </motion.div>
          </main>
        </div>
      </div>
    </section>
  );
}
