import { EditorContent } from "@tiptap/react";
import { ArrowLeft, Clock3, MessageSquareText, Save } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  const shouldReduceMotion = useReducedMotion();
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
      <div className="shrink-0 px-3 pt-3 pb-2 sm:px-4 sm:pt-4 lg:px-5">
        <motion.header
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-lg border border-(--essay-editor-header-border) bg-(--essay-editor-header-surface) px-4 py-3 text-card-foreground shadow-(--essay-editor-header-shadow) sm:px-5 sm:py-4"
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3.5 lg:flex-1">
              <Button
                aria-label="Back to essays"
                className="text-muted-foreground hover:text-foreground"
                onClick={onBack}
                size="icon-sm"
                title="Back to essays"
                type="button"
                variant="ghost"
              >
                <ArrowLeft />
              </Button>
              <Avatar className="size-11 rounded-lg ring-1 ring-border/80">
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
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 sm:flex-nowrap">
                  <h1 className="min-w-0 truncate text-xl leading-6 font-semibold tracking-tight sm:text-[1.35rem]">
                    {essay.title}
                  </h1>
                  <EssayStatusIndicator status={essay.status} />
                </div>
                <EssayContextTrail essay={essay} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-end xl:flex-nowrap">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground sm:justify-end xl:flex-nowrap">
                <span
                  className={cn(
                    "inline-flex items-baseline whitespace-nowrap tabular-nums",
                    isOverLimit && "text-destructive",
                  )}
                >
                  <span className="font-semibold text-foreground">
                    {displayedWordCount}
                  </span>
                  <span>
                    {hasWordLimit ? `/${essay.wordLimit} words` : " words"}
                  </span>
                </span>
                <HeaderDivider />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <MessageSquareText aria-hidden="true" />
                  {essay.comments} comments
                </span>
                <HeaderDivider />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Clock3 aria-hidden="true" />
                  {modifiedLabel}
                </span>
              </div>
              <HeaderDivider />
              <div className="flex items-center gap-1">
                <PromptMenu prompt={prompt} />
                <Button
                  className={cn(
                    "h-8",
                    autosave.saveState === "saved" &&
                      "text-muted-foreground hover:text-foreground",
                  )}
                  disabled={autosave.saveState === "saving"}
                  onClick={
                    autosave.saveState === "error" ? autosave.retry : undefined
                  }
                  type="button"
                  variant={autosave.saveState === "error" ? "default" : "ghost"}
                >
                  <Save aria-hidden="true" data-icon="inline-start" />
                  {saveLabel}
                </Button>
              </div>
            </div>
          </div>
        </motion.header>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-(--essay-editor-chrome-surface)">
        <div className="mx-auto flex w-full max-w-[1440px] px-4 pt-6 pb-28 lg:px-7 lg:pt-8 lg:pb-32">
          <main className="min-w-0 flex-1">
            <motion.div
              className="essay-editor-shell mx-auto min-h-[860px] w-full max-w-[820px] rounded-lg border border-(--essay-document-border) bg-(--essay-document-surface) px-7 py-8 text-(--essay-document-foreground) shadow-sm sm:px-12 sm:py-11 lg:px-16 lg:py-14"
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

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 px-4 pb-[env(safe-area-inset-bottom)] sm:bottom-5">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-auto mx-auto max-w-[min(820px,calc(100vw-2rem))] overflow-x-auto sm:flex sm:justify-center"
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <EssayEditorToolbar
            editor={editor}
            state={toolbarState ?? emptyToolbarState}
          />
        </motion.div>
      </div>
    </section>
  );
}
