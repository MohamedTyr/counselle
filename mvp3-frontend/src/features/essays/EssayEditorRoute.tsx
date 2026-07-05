import { EditorContent } from "@tiptap/react"
import { ArrowLeft, Clock3, MessageSquareText, Save } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { EssayLibraryCardData } from "@/domain/essay"
import {
  EssayContextTrail,
  EssayStatusIndicator,
  HeaderDivider,
  PromptMenu,
} from "@/features/essays/EssayEditorHeader"
import { EssayEditorToolbar } from "@/features/essays/EssayEditorToolbar"
import {
  countWords,
  estimateInitialWordCount,
  fallbackEssay,
  getEssayPrompt,
  getInitialEssayContent,
  getSchoolFallback,
} from "@/features/essays/essay-content"
import { useEssayEditor } from "@/features/essays/useEssayEditor"
import { getEssayActivityLabel } from "@/lib/essay-display"
import { cn } from "@/lib/utils"

type EssayEditorPageProps = {
  essay?: EssayLibraryCardData
  onBack?: () => void
}

export function EssayEditorPage({
  essay = fallbackEssay,
  onBack,
}: EssayEditorPageProps) {
  const initialContent = getInitialEssayContent(essay)
  const [wordCount, setWordCount] = useState(() =>
    estimateInitialWordCount(initialContent)
  )
  const [saveState, setSaveState] = useState<"saved" | "unsaved">("saved")
  const [modifiedLabel, setModifiedLabel] = useState(() =>
    getEssayActivityLabel(essay)
  )

  const { editor, toolbarState } = useEssayEditor({
    initialContent,
    onUpdate: (text) => {
      setWordCount(countWords(text))
      setSaveState("unsaved")
      setModifiedLabel("Unsaved changes")
    },
  })

  const hasWordLimit = essay.wordLimit > 0
  const isOverLimit = hasWordLimit && wordCount > essay.wordLimit
  const schoolFallback = getSchoolFallback(essay.school)
  const shouldReduceMotion = useReducedMotion()
  const prompt = getEssayPrompt(essay)

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[oklch(0.94_0.004_250)] dark:bg-background">
      <div className="shrink-0 bg-[oklch(0.94_0.004_250)] px-3 pt-3 pb-2 sm:px-4 sm:pt-4 lg:px-5 dark:bg-[oklch(0.17_0_0)]">
        <motion.header
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-xs/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] sm:px-5 sm:py-4 dark:before:shadow-[0_-1px_--theme(--color-white/8%)]"
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3.5 lg:flex-1">
              {onBack && (
                <Button
                  aria-label="Back to essays"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={onBack}
                  size="icon-sm"
                  title="Back to essays"
                  variant="ghost"
                >
                  <ArrowLeft />
                </Button>
              )}
              <Avatar
                className="size-11 rounded-2xl ring-1 ring-border/80"
                size="lg"
              >
                <AvatarImage alt="" src={essay.logoUrl} />
                <AvatarFallback className="rounded-2xl text-xs font-semibold">
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
                    isOverLimit && "text-destructive"
                  )}
                >
                  <span className="font-semibold text-foreground">
                    {wordCount}
                  </span>
                  <span>
                    {hasWordLimit ? `/${essay.wordLimit} words` : " words"}
                  </span>
                </span>
                <HeaderDivider />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <MessageSquareText className="size-3.5" />
                  {essay.comments} comments
                </span>
                <HeaderDivider />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Clock3 className="size-3.5" />
                  {modifiedLabel}
                </span>
              </div>
              <HeaderDivider />
              <div className="flex items-center gap-1">
                <PromptMenu prompt={prompt} />
                <Button
                  className={cn(
                    "h-8",
                    saveState === "saved" &&
                      "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => {
                    setSaveState("saved")
                    setModifiedLabel("Modified just now")
                  }}
                  variant={saveState === "saved" ? "ghost" : "default"}
                >
                  <Save data-icon="inline-start" />
                  {saveState === "saved" ? "Saved" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </motion.header>
      </div>

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto bg-[oklch(0.94_0.004_250)] dark:bg-[oklch(0.17_0_0)]">
        <div className="mx-auto flex w-full max-w-[1440px] px-4 pt-6 pb-28 lg:px-7 lg:pt-8 lg:pb-32">
          <main className="min-w-0 flex-1">
            <motion.div
              className="essay-editor-shell mx-auto min-h-[860px] w-full max-w-[820px] rounded-[18px] border border-document-border bg-document px-7 py-8 text-document-foreground shadow-sm sm:px-12 sm:py-11 lg:px-16 lg:py-14"
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
          className="workspace-scrollbar pointer-events-auto mx-auto max-w-[min(820px,calc(100vw-2rem))] overflow-x-auto sm:flex sm:justify-center"
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <EssayEditorToolbar editor={editor} state={toolbarState} />
        </motion.div>
      </div>
    </section>
  )
}
