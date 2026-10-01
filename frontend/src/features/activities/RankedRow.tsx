// The row both lists share: a rank disc that doubles as the drag handle,
// the content, and a hover-revealed actions menu. Activities and honors
// differ only in what goes in the middle column.
import { type DragEvent, type ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";

/** A row's trailing detail (the activity type, an honor's level and
 * grades). It slides left to make room for the actions menu on hover, so
 * the menu needs no column of its own and the content runs to the sheet's
 * edge at rest. The gap before it (--activity-trailing-gap) is wider than
 * the slide, so it never lands on a long title. */
export const rankedRowTrailingClass =
  "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none pointer-fine:group-hover/row:-translate-x-9 pointer-fine:group-has-[[data-state=open]]/row:-translate-x-9";

/** The hairline between rows, inset to the rank column so the discs read
 * as one column, and hidden around a hovered row so its fill stands clear. */
export const rankedRowRuleClass =
  "relative before:pointer-events-none before:absolute before:right-3 before:bottom-0 before:left-[var(--activity-rank-column)] before:h-px before:bg-[var(--activity-row-rule)] last:before:hidden hover:before:opacity-0 has-[+li:hover]:before:opacity-0";

// The disc and grip trade places on row hover: opacity, scale and blur on
// one curve, so the swap reads as one object changing rather than two.
const swapClass =
  "col-start-1 row-start-1 transition-[opacity,scale,filter] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";

function RankHandle({
  name,
  onArmDrag,
  order,
  ready,
}: {
  name: string;
  onArmDrag: () => void;
  order: number;
  ready: boolean;
}) {
  return (
    <button
      aria-label={`Reorder ${name}`}
      className="group/handle relative z-10 grid size-[var(--activity-rank-size)] cursor-grab place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:cursor-grabbing"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={onArmDrag}
      type="button"
    >
      <span
        className={cn(
          swapClass,
          "grid size-full place-items-center rounded-full text-xs font-semibold tabular-nums",
          ready
            ? "bg-[var(--activity-ready-surface)] text-[var(--activity-ready-ink)]"
            : "border border-dashed border-[var(--edge-control-strong)] text-[var(--ink-secondary)]",
          "pointer-fine:group-hover/row:scale-25 pointer-fine:group-hover/row:opacity-0 pointer-fine:group-hover/row:blur-[4px] group-focus-visible/handle:scale-25 group-focus-visible/handle:opacity-0",
        )}
      >
        {order}
      </span>
      <GripVertical
        aria-hidden="true"
        className={cn(
          swapClass,
          "size-4 scale-25 text-[var(--ink-secondary)] opacity-0 blur-[4px]",
          "pointer-fine:group-hover/row:scale-100 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-hover/row:blur-none group-focus-visible/handle:scale-100 group-focus-visible/handle:opacity-100 group-focus-visible/handle:blur-none",
        )}
      />
    </button>
  );
}

function RowMenu({
  id,
  index,
  name,
  onDelete,
  onMove,
  total,
}: {
  id: string;
  index: number;
  name: string;
  onDelete: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  total: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${name}`}
        className={cn(
          buttonVariants({ size: "icon-sm", variant: "ghost" }),
          "absolute top-3 right-3 z-10 size-7 text-[var(--ink-faint)] transition-[opacity,color,background-color] hover:text-[var(--ink)] data-[state=open]:text-[var(--ink)]",
          "pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:data-[state=open]:opacity-100",
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
        <DropdownMenuItem onClick={() => onDelete(id)} variant="destructive">
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type RankedRowHandlers = {
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

export function RankedRow({
  children,
  id,
  idAttribute,
  index,
  isDragging,
  layout,
  name,
  onArmDrag,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onMove,
  onOpen,
  openLabel,
  order,
  ready,
  total,
}: RankedRowHandlers & {
  children: ReactNode;
  id: string;
  idAttribute: "data-activity-id" | "data-honor-id";
  /** What the row is called in its handle and menu labels. */
  name: string;
  openLabel: string;
  order: number;
  ready: boolean;
}) {
  return (
    <motion.li
      className={rankedRowRuleClass}
      exit={layout ? { opacity: 0, scale: 0.98 } : undefined}
      layout={layout}
      transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.7 }}
    >
      <article
        className={cn(
          "group/row relative grid cursor-pointer grid-cols-[var(--activity-rank-size)_minmax(0,1fr)] items-start gap-x-3 rounded-lg px-3 py-3 transition-[background-color,opacity] duration-150 ease-out hover:bg-[var(--activity-row-hover)]",
          isDragging && "opacity-55",
        )}
        {...{ [idAttribute]: id }}
        draggable
        onClick={() => onOpen(id)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(event, id)}
        onDragStart={(event) => onDragStart(event, id)}
        onDrop={onDrop}
      >
        <button
          aria-label={openLabel}
          className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(id);
          }}
          type="button"
        />
        <RankHandle
          name={name}
          onArmDrag={onArmDrag}
          order={order}
          ready={ready}
        />
        {/* On touch the menu is always shown, so the content clears it. */}
        <div className="min-w-0 pointer-coarse:pr-9">{children}</div>
        <RowMenu
          id={id}
          index={index}
          name={name}
          onDelete={onDelete}
          onMove={onMove}
          total={total}
        />
      </article>
    </motion.li>
  );
}

/** The row after the last entry: a dashed disc in the rank column, so the
 * open slots read as the next places in the same ranked list. */
export function AddSlotRow({
  disabled,
  label,
  onAdd,
  open,
}: {
  disabled?: boolean;
  label: string;
  onAdd: () => void;
  open: number;
}) {
  return (
    <li>
      <button
        className="group/add grid w-full grid-cols-[var(--activity-rank-size)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--ink-secondary)] transition-[background-color,color] duration-150 ease-out outline-none hover:bg-[var(--activity-row-hover)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-60"
        disabled={disabled}
        onClick={onAdd}
        type="button"
      >
        <span className="grid size-[var(--activity-rank-size)] place-items-center rounded-full border border-dashed border-[var(--edge-control)] transition-colors group-hover/add:border-[var(--edge-control-strong)]">
          <Plus aria-hidden="true" className="size-3.5" />
        </span>
        <span>{label}</span>
        <span className="text-xs text-[var(--ink-faint)] tabular-nums">
          {open} {open === 1 ? "slot" : "slots"} open
        </span>
      </button>
    </li>
  );
}
