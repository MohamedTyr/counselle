import { type DragEvent } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatGrades,
  formatLevels,
  isHonorReady,
  type Honor,
} from "@/domain/activity";
import { cn } from "@/lib/utils";
import { RankBadge } from "@/features/activities/activity-indicators";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";

function HonorRowMenu({
  honor,
  index,
  onDelete,
  onMove,
  total,
}: {
  honor: Honor;
  index: number;
  onDelete: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  total: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${honor.title || "honor"}`}
        className={cn(
          buttonVariants({ size: "icon-sm", variant: "ghost" }),
          "size-7 shrink-0 text-muted-foreground opacity-0 transition-[opacity,background-color] group-hover/honor:bg-[color:var(--activity-control-surface)] group-hover/honor:opacity-100 focus-visible:bg-[color:var(--activity-control-surface)] focus-visible:opacity-100 data-[state=open]:bg-[color:var(--activity-control-surface)] data-[state=open]:opacity-100 pointer-coarse:opacity-100",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-40"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp aria-hidden="true" />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown aria-hidden="true" />
          Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(honor.id)}
          variant="destructive"
        >
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type HonorRowProps = {
  honor: Honor;
  index: number;
  isDragging: boolean;
  layout: false | "position";
  onArmDrag: () => void;
  onDelete: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, targetId: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onOpen: (id: string) => void;
  total: number;
};

export function HonorRow({
  honor,
  index,
  isDragging,
  layout,
  onArmDrag,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onMove,
  onOpen,
  total,
}: HonorRowProps) {
  const ready = isHonorReady(honor);

  return (
    <motion.div
      className="border-b border-border/50 p-1 last:border-b-0"
      exit={layout ? { opacity: 0, scale: 0.98 } : undefined}
      layout={layout}
      transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.7 }}
    >
      <article
        className={cn(
          "group/honor relative flex cursor-pointer items-center gap-3 rounded-xl border border-transparent bg-[color:var(--activity-row-surface)] px-3 py-2.5 shadow-[var(--activity-row-shadow)] transition-[background-color,border-color,box-shadow] outline-none hover:border-[color:var(--activity-row-border)] hover:bg-[color:var(--activity-row-hover)] focus-visible:ring-3 focus-visible:ring-ring/45",
          isDragging && "opacity-55",
        )}
        data-honor-id={honor.id}
        draggable
        onClick={() => onOpen(honor.id)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(event, honor.id)}
        onDragStart={(event) => onDragStart(event, honor.id)}
        onDrop={onDrop}
      >
        <button
          aria-label={`Honor ${honor.order}: ${honor.title || "Untitled"}`}
          className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/45"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(honor.id);
          }}
          type="button"
        />
        <RankBadge isReady={ready} order={honor.order} />
        <button
          aria-label={`Reorder ${honor.title || "honor"}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-[color,opacity,background-color] group-hover/honor:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:outline-none active:cursor-grabbing pointer-coarse:opacity-100"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={onArmDrag}
          type="button"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <h3 className="min-w-0 text-sm leading-5 font-medium text-wrap">
            {honor.title || (
              <span className="text-muted-foreground italic">
                Untitled honor
              </span>
            )}
          </h3>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground sm:shrink-0 sm:justify-end">
            <span className="text-wrap">{formatLevels(honor.levels)}</span>
            <span aria-hidden="true" className="text-muted-foreground/40">
              ·
            </span>
            <span className="whitespace-nowrap tabular-nums">
              {formatGrades(honor.grades)}
            </span>
          </div>
        </div>

        <HonorRowMenu
          honor={honor}
          index={index}
          onDelete={onDelete}
          onMove={onMove}
          total={total}
        />
      </article>
    </motion.div>
  );
}
