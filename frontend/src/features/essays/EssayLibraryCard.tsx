import {
  Archive,
  Copy,
  GraduationCap,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
} from "lucide-react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Essay } from "@/domain/essay";
import { EssayDocumentPreview } from "@/features/essays/EssayDocumentPreview";
import {
  getSchoolFallback,
  getSchoolFaviconUrl,
} from "@/features/essays/essay-content";
import {
  essayStatusVariant,
  formatEssayCycle,
  formatEssayDeadlineOrNull,
  getEssayActivityShortLabel,
} from "@/lib/essay-display";
import { cn } from "@/lib/utils";

type EssayLibraryCardProps = {
  essay: Essay;
  onArchiveEssay?: (essay: Essay) => void;
  onDuplicateEssay?: (essay: Essay) => void;
  onMarkReady?: (essay: Essay) => void;
  onOpenEssay?: (essay: Essay) => void;
};

/* 16px, not the 40px avatar tile this used to carry: the school is context for
 * the title, not the subject of the card. Unlinked essays (a personal
 * statement) have no school to mark, so they get the glyph rather than
 * initials scraped off the placeholder school name. */
function EssaySchoolMark({ essay }: { essay: Essay }) {
  const faviconUrl = getSchoolFaviconUrl(essay.schoolWebsiteUrl);

  if (!faviconUrl) {
    return (
      <GraduationCap
        aria-hidden="true"
        className="size-3.5 shrink-0 text-(--ink-muted)"
      />
    );
  }

  return (
    <Avatar className="size-4 shrink-0 rounded-[3px] after:rounded-[3px]">
      <AvatarImage alt="" className="rounded-[3px]" src={faviconUrl} />
      <AvatarFallback className="rounded-[3px] text-[9px] leading-none">
        {getSchoolFallback(essay.schoolName)}
      </AvatarFallback>
    </Avatar>
  );
}

/* Word count against the limit is the one number a student checks repeatedly,
 * so it gets a track when there is a limit to measure against and stays plain
 * text when there is not. */
function EssayWordProgress({ essay }: { essay: Essay }) {
  if (!essay.wordLimit || essay.wordLimit <= 0) {
    return (
      <span className="shrink-0 text-(--ink-secondary) tabular-nums">
        {essay.wordCount} {essay.wordCount === 1 ? "word" : "words"}
      </span>
    );
  }

  const isOverLimit = essay.wordCount > essay.wordLimit;
  const filledRatio = Math.min(essay.wordCount / essay.wordLimit, 1);

  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1 w-10 overflow-hidden rounded-full bg-(--essay-library-progress-track)"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-300 ease-out",
            isOverLimit
              ? "bg-(--danger-solid)"
              : "bg-(--essay-library-progress-fill)",
          )}
          style={{ width: `${filledRatio * 100}%` }}
        />
      </span>
      <span
        className={cn(
          "text-(--ink-secondary) tabular-nums",
          isOverLimit && "font-medium text-(--danger-fg)",
        )}
      >
        {essay.wordCount}/{essay.wordLimit}
      </span>
    </span>
  );
}

export function EssayLibraryCard({
  essay,
  onArchiveEssay,
  onDuplicateEssay,
  onMarkReady,
  onOpenEssay,
}: EssayLibraryCardProps) {
  const canMarkReady = essay.status !== "Ready" && essay.status !== "Submitted";
  const cycleLabel = formatEssayCycle(essay.cycleYear);
  const deadlineLabel = formatEssayDeadlineOrNull(essay.deadline);
  const activityLabel = getEssayActivityShortLabel(essay);
  const schoolLabel = cycleLabel
    ? `${essay.schoolName} · ${cycleLabel}`
    : essay.schoolName;

  function handleOpenEssay() {
    onOpenEssay?.(essay);
  }

  return (
    <article className="group/essay-card">
      <div
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-xl border",
          "border-(--essay-library-card-border) bg-(--essay-library-card-frame)",
          /* Resting elevation-1 only, and it does NOT step on hover: hover is
           * carried by the border alone. A shadow that grows under a bordered
           * card is the "floating" tell, and elevation.css reserves
           * border+shadow pairing for elevation-1 anyway. */
          "shadow-(--workspace-task-card-shadow) transition-colors duration-200",
          "group-hover/essay-card:border-(--essay-library-card-hover-border)",
          "group-focus-within/essay-card:border-(--essay-library-card-hover-border)",
        )}
      >
        <EssayDocumentPreview
          essay={essay}
          layoutId={`essay-document-${essay.id}`}
        />

        {/* Deliberately NOT position:relative — the title's stretched ::after
         * is anchored to the card root so the hit area covers the paper band
         * too. Making this a containing block silently shrinks the click
         * target to the metadata strip. */}
        <div className="flex flex-1 flex-col gap-1.5 bg-(--essay-library-card-plinth) px-3.5 pt-3 pb-3">
          <h2 className="line-clamp-2 text-sm leading-snug font-semibold text-(--ink)">
            {/* Stretched hit area: the whole card opens the essay. The label
             * keeps the visible title inside it (WCAG 2.5.3) while naming the
             * action, so it stays distinguishable from the actions trigger. */}
            <button
              aria-label={`Open ${essay.title}`}
              className="text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-(--focus-ring) focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-(--canvas)"
              onClick={handleOpenEssay}
              type="button"
            >
              {essay.title}
            </button>
          </h2>

          <div className="flex min-w-0 items-center gap-1.5 text-xs text-(--ink-muted)">
            <EssaySchoolMark essay={essay} />
            {essay.applicationId ? (
              <Link
                className="relative z-10 truncate rounded-sm outline-none hover:text-(--ink) hover:underline focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
                onClick={(event) => event.stopPropagation()}
                to={`/app/schools/${essay.applicationId}`}
              >
                {schoolLabel}
              </Link>
            ) : (
              <span className="truncate">{schoolLabel}</span>
            )}
            {deadlineLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={cn(
                    "shrink-0",
                    essay.dueSoon && "font-medium text-(--warning-fg)",
                  )}
                >
                  {deadlineLabel}
                </span>
              </>
            ) : null}
          </div>

          <div className="mt-auto flex items-center gap-2 border-t border-(--hairline) pt-2.5">
            <Badge variant={essayStatusVariant[essay.status]}>
              {essay.status}
            </Badge>
            {activityLabel ? (
              <span className="min-w-0 truncate text-xs text-(--ink-muted)">
                {activityLabel}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-2.5 text-xs">
              {essay.comments > 0 ? (
                <span className="flex items-center gap-1 text-(--ink-muted)">
                  <MessageSquareText aria-hidden="true" className="size-3.5" />
                  <span className="tabular-nums">{essay.comments}</span>
                </span>
              ) : null}
              <EssayWordProgress essay={essay} />
            </span>
          </div>
        </div>

        {/* Hidden until the card is hovered or something inside it takes
         * focus, and always visible where there is no hover to reveal it. It
         * carries the paper's own fill rather than a ghost transparent so it
         * occludes the excerpt underneath instead of sitting on top of it. */}
        <div className="absolute top-1.5 right-1.5 z-20">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`Open ${essay.title} actions`}
                className="bg-(--essay-document-surface) opacity-0 transition-opacity duration-200 group-hover/essay-card:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
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
                <DropdownMenuItem onSelect={() => onDuplicateEssay?.(essay)}>
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
      </div>
    </article>
  );
}
