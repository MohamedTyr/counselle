"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Check,
  Clock3,
  Copy,
  FileText,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
} from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardPanel } from "@/components/ui/card"
import type { EssayLibraryCardData } from "@/domain/essay"
import { essayStatusVariant, getEssayActivityLabel } from "@/lib/essay-display"
import { cn } from "@/lib/utils"

type EssayLibraryCardProps = {
  essay: EssayLibraryCardData
  onOpenEssay?: (essay: EssayLibraryCardData) => void
}

type ActivePopover = "more" | null

const popoverAnim = {
  initial: { opacity: 0, y: 8, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.96 },
  transition: { type: "spring" as const, damping: 22, stiffness: 300 },
} as const

function EssaySchoolLogo({ essay }: { essay: EssayLibraryCardData }) {
  return (
    <Avatar className="size-10 rounded-xl after:rounded-xl">
      <AvatarImage
        alt={`${essay.school} logo`}
        className="rounded-xl"
        src={essay.logoUrl}
      />
      <AvatarFallback className="rounded-xl text-xs">
        {essay.school.slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  )
}

function DocumentPreview({
  essay,
  layoutId,
}: {
  essay: EssayLibraryCardData
  layoutId?: string
}) {
  const hasContent = essay.previewLines.length > 0

  return (
    <motion.div
      className="h-52 overflow-hidden font-document text-document-foreground"
      layoutId={layoutId}
      transition={{ layout: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
    >
      {hasContent ? (
        <div className="mx-auto flex h-full max-w-[30rem] flex-col overflow-hidden">
          <h3 className="mb-5 truncate text-center text-[8px] leading-tight font-semibold">
            {essay.previewTitle}
          </h3>
          <div className="flex flex-col gap-2.5 overflow-hidden">
            {essay.previewLines.map((line) => (
              <p
                className="text-[7.5px] leading-[1.78] text-document-muted"
                key={line}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-3 text-document-muted">
          <FileText className="size-7" />
          <span className="text-xs">Blank essay</span>
        </div>
      )}
    </motion.div>
  )
}

const menuItems = [
  { label: "Open essay", icon: PencilLine, action: "open" },
  { label: "Duplicate", icon: Copy, action: "duplicate" },
  { label: "Mark ready", icon: Check, action: "ready" },
] as const

export function EssayLibraryCard({
  essay,
  onOpenEssay,
}: EssayLibraryCardProps) {
  const [activePopover, setActivePopover] = useState<ActivePopover>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const isInteractive = !!onOpenEssay
  const wordLabel =
    essay.wordLimit > 0 ? `${essay.wordCount}/${essay.wordLimit}` : "No limit"

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setActivePopover(null)
      }
    }

    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const togglePopover = (name: ActivePopover) => {
    setActivePopover((current) => (current === name ? null : name))
  }

  const handleOpenEssay = () => {
    onOpenEssay?.(essay)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isInteractive) {
      return
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      handleOpenEssay()
    }
  }

  return (
    <motion.article
      aria-label={isInteractive ? `Open ${essay.title}` : undefined}
      className={cn(
        "group/essay-card w-full max-w-xs justify-self-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        isInteractive && "cursor-pointer"
      )}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
      onClick={isInteractive ? handleOpenEssay : undefined}
      onKeyDown={handleKeyDown}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      transition={{ type: "spring", stiffness: 420, damping: 36, mass: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      whileHover={shouldReduceMotion ? undefined : { y: -3 }}
      whileInView={
        shouldReduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }
      }
      whileTap={
        shouldReduceMotion || !isInteractive ? undefined : { scale: 0.985 }
      }
    >
      <div
        className={cn(
          "relative flex flex-col rounded-2xl bg-muted/72 p-1",
          "w-full max-w-xs rounded-2xl p-2"
        )}
        data-slot="essay-card-frame"
      >
        <Card className="rounded-2xl bg-document text-document-foreground">
          <CardPanel>
            <DocumentPreview
              essay={essay}
              layoutId={`essay-document-${essay.id}`}
            />
          </CardPanel>
        </Card>

        <footer
          className={cn("px-5 py-4", "px-3 pt-4 pb-3")}
          data-slot="essay-card-footer"
        >
          <div className="relative flex min-w-0 flex-col gap-4">
            <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-3 pr-8">
              <EssaySchoolLogo essay={essay} />

              <div className="flex min-w-0 flex-col gap-1.5">
                <h2 className="truncate text-sm leading-5 font-semibold">
                  {essay.title}
                </h2>
                <div className="flex min-w-0 items-center">
                  <Badge variant={essayStatusVariant[essay.status]}>
                    {essay.status}
                  </Badge>
                </div>
              </div>
            </div>

            <div ref={popoverRef} className="absolute top-1 right-0 flex">
              <Button
                aria-label={`Open ${essay.title} actions`}
                className="opacity-70 transition-opacity group-hover/essay-card:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  togglePopover("more")
                }}
                size="icon-sm"
                variant="ghost"
              >
                <MoreHorizontal />
              </Button>

              <AnimatePresence>
                {activePopover === "more" && (
                  <motion.div
                    {...popoverAnim}
                    className="absolute top-full right-0 z-20 mt-2 w-44 overflow-hidden rounded-2xl border border-border bg-popover py-1.5 shadow-lg"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {menuItems.map((item) => (
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-popover-foreground transition-colors hover:bg-accent"
                        key={item.label}
                        onClick={(event) => {
                          event.stopPropagation()
                          setActivePopover(null)

                          if (item.action === "open") {
                            handleOpenEssay()
                          }
                        }}
                      >
                        <item.icon className="size-3.5 text-muted-foreground" />
                        {item.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-1 flex w-full items-center gap-2 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1">
                <Clock3 className="size-3.5" />
                <span className="truncate">{getEssayActivityLabel(essay)}</span>
              </span>
              <span className="ml-auto flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <MessageSquareText className="size-3.5" />
                  {essay.comments}
                </span>
                <span className="flex items-center gap-1 text-foreground/75 tabular-nums">
                  {wordLabel}
                </span>
              </span>
            </div>
          </div>
        </footer>
      </div>
    </motion.article>
  )
}

export default EssayLibraryCard
