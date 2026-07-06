import {
  Archive,
  Clock3,
  Copy,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Essay } from "@/domain/essay";
import { EssayDocumentPreview } from "@/features/essays/EssayDocumentPreview";
import { getSchoolFallback } from "@/features/essays/essay-content";
import {
  essayStatusVariant,
  formatEssayDeadline,
  getEssayActivityLabel,
} from "@/lib/essay-display";
import { cn } from "@/lib/utils";

type EssayLibraryCardProps = {
  essay: Essay;
  onArchiveEssay?: (essay: Essay) => void;
  onDuplicateEssay?: (essay: Essay) => void;
  onMarkReady?: (essay: Essay) => void;
  onOpenEssay?: (essay: Essay) => void;
};

function EssaySchoolLogo({ essay }: { essay: Essay }) {
  return (
    <Avatar className="size-10 rounded-lg after:rounded-lg">
      <AvatarFallback className="rounded-lg text-xs">
        {getSchoolFallback(essay.schoolName)}
      </AvatarFallback>
    </Avatar>
  );
}

export function EssayLibraryCard({
  essay,
  onArchiveEssay,
  onDuplicateEssay,
  onMarkReady,
  onOpenEssay,
}: EssayLibraryCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const wordLabel =
    essay.wordLimit && essay.wordLimit > 0
      ? `${essay.wordCount}/${essay.wordLimit}`
      : `${essay.wordCount} words`;
  const canMarkReady = essay.status !== "Ready" && essay.status !== "Submitted";

  function handleOpenEssay() {
    onOpenEssay?.(essay);
  }

  return (
    <motion.article
      className="group/essay-card w-full max-w-xs justify-self-center"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 36, mass: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      whileHover={shouldReduceMotion ? undefined : { y: -3 }}
      whileInView={
        shouldReduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }
      }
    >
      <div
        className={cn(
          "relative flex w-full max-w-xs flex-col rounded-lg border p-2 shadow-(--workspace-task-card-shadow) transition-colors",
          "border-(--essay-library-card-border) bg-(--essay-library-card-frame)",
          "group-hover/essay-card:bg-(--essay-library-card-hover)",
        )}
      >
        <button
          aria-label={`Open ${essay.title}`}
          className="rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={handleOpenEssay}
          type="button"
        >
          <Card className="overflow-hidden rounded-md border-(--essay-document-border) bg-(--essay-document-surface) text-(--essay-document-foreground)">
            <CardPanel>
              <EssayDocumentPreview
                essay={essay}
                layoutId={`essay-document-${essay.id}`}
              />
            </CardPanel>
          </Card>
        </button>

        <footer className="px-3 pt-4 pb-3">
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

            <div className="absolute top-1 right-0 flex">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={`Open ${essay.title} actions`}
                    className="opacity-70 transition-opacity group-hover/essay-card:opacity-100"
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={handleOpenEssay}>
                      <PencilLine />
                      Open essay
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => onDuplicateEssay?.(essay)}
                    >
                      <Copy />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canMarkReady}
                      onSelect={() => onMarkReady?.(essay)}
                    >
                      Ready
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onArchiveEssay?.(essay)}
                    >
                      <Archive />
                      Archive
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-1 flex w-full items-center gap-2 text-xs text-muted-foreground">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-1">
                  <Clock3 aria-hidden="true" />
                  <span className="truncate">{getEssayActivityLabel(essay)}</span>
                </span>
                <span className="truncate">
                  {essay.schoolName} · {formatEssayDeadline(essay.deadline)}
                </span>
              </div>
              <span className="ml-auto flex shrink-0 items-center gap-3">
                <span className="flex items-center gap-1">
                  <MessageSquareText aria-hidden="true" />
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
  );
}
