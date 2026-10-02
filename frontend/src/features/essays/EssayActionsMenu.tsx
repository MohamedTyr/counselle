import { Archive, Copy, MoreHorizontal, PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Essay } from "@/domain/essay";
import { cn } from "@/lib/utils";

export type EssayActions = {
  onArchiveEssay?: (essay: Essay) => void;
  onDuplicateEssay?: (essay: Essay) => void;
  onMarkReady?: (essay: Essay) => void;
  onOpenEssay?: (essay: Essay) => void;
};

export function EssayActionsMenu({
  className,
  essay,
  onArchiveEssay,
  onDuplicateEssay,
  onMarkReady,
  onOpenEssay,
}: EssayActions & { className?: string; essay: Essay }) {
  const canMarkReady = essay.status !== "Ready" && essay.status !== "Submitted";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Open ${essay.title} actions`}
          className={cn("relative z-10", className)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => onOpenEssay?.(essay)}>
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
  );
}
