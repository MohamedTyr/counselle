import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { type Ref, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { SatSessionRow } from "@/api/sat/types";
import { TOOL_WINDOW_FULLSCREEN_BREAKPOINT } from "@/features/sat/use-tool-window";
import type { SatHistoryEntry, SatReveal } from "@/features/sat/sat-session-reducer";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import { useIsViewportAtMost } from "@/features/sat/use-viewport-width";

export interface SatNavigatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly SatSessionRow[];
  currentIndex: number;
  getReveal: (questionId: string) => SatReveal | undefined;
  getHistory: (questionId: string) => SatHistoryEntry;
  onSelect: (index: number) => void;
  anchor: React.ReactNode;
}

/** A page is a tile grid small enough to scan at a glance; a 1,700-question
 * session is thirty-odd pages with a jump field, not one tall sheet. */
const PAGE_SIZE = 50;

type Tier = "easy" | "medium" | "hard";
const TIER_DOTS: Record<Tier, number> = { easy: 1, medium: 2, hard: 3 };

function difficultyTier(scoreBand: number): Tier {
  if (scoreBand <= 3) return "easy";
  if (scoreBand <= 5) return "medium";
  return "hard";
}

function pageOf(index: number): number {
  return Math.floor(index / PAGE_SIZE);
}

function DifficultyDots({ tier }: { tier: Tier }): React.ReactElement {
  return (
    <span aria-hidden="true" className="flex gap-[2px]">
      {Array.from({ length: TIER_DOTS[tier] }, (_, i) => (
        <span className="size-1 rounded-full bg-current opacity-60" key={i} />
      ))}
    </span>
  );
}

interface TileProps {
  number: number;
  tier: Tier;
  current: boolean;
  correct: boolean;
  incorrect: boolean;
  upsolved: boolean;
  bookmarked: boolean;
  onClick: () => void;
  /** Set on the current question's tile, so opening lands there. */
  tileRef?: Ref<HTMLButtonElement>;
}

function tileLabel(p: TileProps): string {
  return `Question ${p.number}, ${p.tier}${
    p.incorrect ? ", incorrect" : p.correct ? ", correct" : ""
  }${p.upsolved ? ", missed then got right" : ""}${p.bookmarked ? ", marked for review" : ""}`;
}

/** The state of a tile is carried by fill and rim, never by a glyph alone:
 * correct is the success tint, incorrect the danger tint, the current
 * question an ink ring, a flagged question a corner fold. */
function Tile(props: TileProps): React.ReactElement {
  const { number, tier, current, correct, incorrect, upsolved, bookmarked, onClick, tileRef } = props;
  return (
    <button
      aria-current={current || undefined}
      aria-label={tileLabel(props)}
      ref={tileRef}
      className={cn(
        "relative flex aspect-square min-h-9 flex-col items-center justify-center gap-[3px] overflow-hidden rounded-lg border text-[13px] tabular-nums outline-none",
        "transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1",
        incorrect
          ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger-fg)]"
          : correct
            ? "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success-fg)]"
            : "border-[var(--hairline)] bg-[var(--surface-raised)] text-[var(--ink-secondary)] hover:bg-[var(--canvas-hover)] hover:text-[var(--ink)]",
        current && "border-[var(--ink)] font-semibold text-[var(--ink)] shadow-[0_0_0_1px_var(--ink)]",
      )}
      onClick={onClick}
      type="button"
    >
      {bookmarked && (
        <span
          aria-hidden="true"
          className="absolute top-0 right-0 size-2.5 bg-[var(--warning-solid)] [clip-path:polygon(0_0,100%_0,100%_100%)]"
        />
      )}
      {upsolved && (
        <span
          aria-hidden="true"
          className="absolute top-[3px] left-[3px] size-[5px] rounded-full bg-[var(--accent-solid)]"
        />
      )}
      <span className="leading-none">{number}</span>
      <DifficultyDots tier={tier} />
    </button>
  );
}

function NavigatorGrid({
  rows,
  page,
  currentIndex,
  getReveal,
  getHistory,
  onSelect,
  columns,
  currentTileRef,
}: Pick<
  SatNavigatorProps,
  "rows" | "currentIndex" | "getReveal" | "getHistory" | "onSelect"
> & {
  page: number;
  columns: string;
  currentTileRef: Ref<HTMLButtonElement>;
}): React.ReactElement {
  const start = page * PAGE_SIZE;
  return (
    <div className={cn("grid gap-1.5", columns)}>
      {rows.slice(start, start + PAGE_SIZE).map((row, offset) => {
        const index = start + offset;
        const reveal = getReveal(row.id);
        const history = getHistory(row.id);
        return (
          <Tile
            bookmarked={row.bookmarked}
            correct={reveal?.isCorrect === true}
            current={index === currentIndex}
            incorrect={reveal?.isCorrect === false}
            key={row.id}
            number={index + 1}
            onClick={() => onSelect(index)}
            tileRef={index === currentIndex ? currentTileRef : undefined}
            tier={difficultyTier(row.score_band)}
            upsolved={history.everCorrect && history.everIncorrect}
          />
        );
      })}
    </div>
  );
}

function Swatch({ className, children }: { className: string; children?: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-flex size-4 shrink-0 overflow-hidden rounded-[5px] border", className)}
    >
      {children}
    </span>
  );
}

function NavigatorLegend(): React.ReactElement {
  const legend = SAT_PRACTICE_COPY.navigator.legend;
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-[var(--ink-secondary)]">
        <li className={item}>
          <Swatch className="border-[var(--success-border)] bg-[var(--success-surface)]" />
          {legend.correct}
        </li>
        <li className={item}>
          <Swatch className="border-[var(--danger-border)] bg-[var(--danger-surface)]" />
          {legend.incorrect}
        </li>
        <li className={item}>
          <Swatch className="border-[var(--hairline)] bg-[var(--surface-raised)]">
            <span className="absolute top-0 right-0 size-2 bg-[var(--warning-solid)] [clip-path:polygon(0_0,100%_0,100%_100%)]" />
          </Swatch>
          {legend.forReview}
        </li>
        <li className={item}>
          <Swatch className="border-[var(--hairline)] bg-[var(--surface-raised)]">
            <span className="absolute top-[2px] left-[2px] size-[5px] rounded-full bg-[var(--accent-solid)]" />
          </Swatch>
          {legend.upsolved}
        </li>
        <li className={item}>
          <Swatch className="border-[var(--ink)] bg-[var(--surface-raised)] shadow-[0_0_0_1px_var(--ink)]" />
          {legend.current}
        </li>
        <li className={item} title={legend.difficultyHint}>
          <Swatch className="items-center justify-center border-[var(--hairline)] bg-[var(--surface-raised)] text-[var(--ink-secondary)]">
            <DifficultyDots tier="hard" />
          </Swatch>
          {legend.difficulty}
        </li>
      </ul>
    </div>
  );
}

function JumpField({
  total,
  onJump,
}: {
  total: number;
  onJump: (index: number) => void;
}): React.ReactElement {
  const copy = SAT_PRACTICE_COPY.navigator;
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const number = Number.parseInt(value, 10);
    if (!Number.isInteger(number) || number < 1 || number > total) {
      setInvalid(true);
      return;
    }
    onJump(number - 1);
  }

  return (
    <form className="flex items-center gap-2" onSubmit={submit}>
      <label className="text-xs font-medium text-[var(--ink-secondary)]" htmlFor="sat-navigator-jump">
        {copy.jumpLabel}
      </label>
      <Input
        aria-describedby={invalid ? "sat-navigator-jump-error" : undefined}
        aria-invalid={invalid || undefined}
        className="w-24 tabular-nums"
        id="sat-navigator-jump"
        inputMode="numeric"
        onChange={(event) => {
          setValue(event.target.value.replace(/\D/g, ""));
          setInvalid(false);
        }}
        placeholder={copy.jumpPlaceholder}
        size="sm"
        value={value}
      />
      {invalid && (
        <span className="text-xs text-[var(--danger-fg)]" id="sat-navigator-jump-error" role="alert">
          {copy.jumpInvalid(total)}
        </span>
      )}
    </form>
  );
}

function PageControls({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}): React.ReactElement {
  const copy = SAT_PRACTICE_COPY.navigator;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label={copy.previousPage}
        className="active:scale-[0.97]"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        size="icon-sm"
        variant="ghost"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <span className="min-w-[8ch] text-center text-xs tabular-nums text-[var(--ink-secondary)]">
        {copy.range(from, to, total)}
      </span>
      <Button
        aria-label={copy.nextPage}
        className="active:scale-[0.97]"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
        size="icon-sm"
        variant="ghost"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}

type NavigatorBodyProps = Pick<
  SatNavigatorProps,
  "rows" | "currentIndex" | "getReveal" | "getHistory" | "onSelect"
> & {
  columns: string;
  currentTileRef: Ref<HTMLButtonElement>;
  /** The title row: the popover has its own, the sheet renders it in the
   * sheet header, so the body only renders the pager beside it. */
  title?: React.ReactNode;
  titleClassName?: string;
};

/** Mounted only while open, so each open starts on the page holding the
 * current question. */
function NavigatorBody({
  title,
  titleClassName,
  columns,
  ...grid
}: NavigatorBodyProps): React.ReactElement {
  const total = grid.rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [page, setPage] = useState(() => pageOf(grid.currentIndex));
  return (
    <div className="flex flex-col gap-3">
      <div className={cn("flex min-h-8 items-center justify-between gap-2", titleClassName)}>
        {title ?? <span />}
        <PageControls onPage={setPage} page={page} pages={pages} total={total} />
      </div>
      <NavigatorLegend />
      <NavigatorGrid {...grid} columns={columns} page={page} />
      <div className="border-t border-[var(--hairline)] pt-3">
        <JumpField onJump={grid.onSelect} total={total} />
      </div>
    </div>
  );
}

/** The question bank navigator (ui-spec §4, Q29–Q31): a popover above the
 * bottom bar on desktop, a bottom sheet at ≤860px. */
export function SatNavigator({
  open,
  onOpenChange,
  rows,
  currentIndex,
  getReveal,
  getHistory,
  onSelect,
  anchor,
}: SatNavigatorProps): React.ReactElement {
  const isSheet = useIsViewportAtMost(TOOL_WINDOW_FULLSCREEN_BREAKPOINT);
  const select = (index: number) => {
    onSelect(index);
    onOpenChange(false);
  };
  // Opening lands on the current question's tile — not the pager's next
  // button, which would otherwise be the first thing in focus order.
  const currentTileRef = useRef<HTMLButtonElement>(null);
  const body = {
    rows,
    currentIndex,
    getReveal,
    getHistory,
    onSelect: select,
    currentTileRef,
  };

  if (isSheet) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetTrigger render={anchor as React.ReactElement} />
        <SheetContent
          className="max-h-[85dvh] rounded-t-2xl"
          initialFocus={currentTileRef}
          side="bottom"
        >
          <div className="overflow-y-auto px-4 pt-4 pb-6">
            <NavigatorBody
              {...body}
              columns="grid-cols-7"
              title={
                <SheetTitle className="text-[15px] leading-5 tracking-[-0.015em]">
                  {SAT_PRACTICE_COPY.navigator.title}
                </SheetTitle>
              }
              titleClassName="pr-10"
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger render={anchor as React.ReactElement} />
      <PopoverContent
        align="start"
        className="max-h-[min(640px,calc(100dvh-7rem))] w-[460px] max-w-[calc(100vw-3rem)] [&_[data-slot=popover-viewport]]:p-0"
        initialFocus={currentTileRef}
        side="top"
        sideOffset={12}
      >
        <div className="w-full overflow-y-auto p-4">
          <NavigatorBody
            {...body}
            columns="grid-cols-10"
            title={
              <h3 className="text-[15px] leading-5 font-semibold tracking-[-0.015em]">
                {SAT_PRACTICE_COPY.navigator.title}
              </h3>
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
