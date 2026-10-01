import { Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import type { Essay } from "@/domain/essay";
import {
  EssayActionsMenu,
  type EssayActions,
} from "@/features/essays/EssayActionsMenu";
import { EssayWordProgress } from "@/features/essays/EssayWordProgress";
import { isEssayDone } from "@/features/essays/essays-by-school";
import type { SchoolColour } from "@/features/schools/explore/school-colours";
import { essayStatusVariant } from "@/lib/essay-display";
import { cn } from "@/lib/utils";

/* School colour is data, set inline the way the Explore card sets it;
 * essay.css derives the wash, the ring and the progress fill from it. */
export function schoolColourStyle(colour: SchoolColour | null) {
  return colour
    ? ({
        "--school-colour": colour.fill,
        "--school-colour-ink": colour.ink,
      } as CSSProperties)
    : undefined;
}

function EssayRow({ essay, ...actions }: EssayActions & { essay: Essay }) {
  return (
    <li
      className="group/essay-row relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-3 py-[11px]"
      data-slot="essay-row"
    >
      {/* Stretched hit area: the whole row opens the essay. */}
      <button
        aria-label={`Open ${essay.title}`}
        className="min-w-0 truncate text-left text-sm font-semibold text-(--ink) outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-(--focus-ring) focus-visible:after:ring-inset"
        onClick={() => actions.onOpenEssay?.(essay)}
        type="button"
      >
        {essay.title}
      </button>
      <span className="flex items-center gap-1">
        <Badge variant={essayStatusVariant[essay.status]}>{essay.status}</Badge>
        <EssayActionsMenu
          className="-my-1 -mr-2 opacity-0 transition-opacity duration-150 group-hover/essay-row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          essay={essay}
          {...actions}
        />
      </span>
      <EssayWordProgress className="col-span-2" essay={essay} />
    </li>
  );
}

export function SchoolEssayColumn({
  actions,
  addLabel,
  colour,
  countEssays,
  deadlineLabel,
  dueSoon = false,
  essays,
  mark,
  name,
  onAdd,
}: {
  actions: EssayActions;
  addLabel?: string;
  colour: SchoolColour | null;
  /* Every essay the school needs, so "done" stays true while a filter
   * narrows the rows shown. */
  countEssays: Essay[];
  deadlineLabel: string | null;
  dueSoon?: boolean;
  essays: Essay[];
  mark: ReactNode;
  name: ReactNode;
  onAdd?: () => void;
}) {
  const headingId = useId();
  const done = countEssays.filter(isEssayDone).length;

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col overflow-hidden rounded-[18px]"
      data-slot="essay-school-column"
      style={schoolColourStyle(colour)}
    >
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        {mark}
        <div className="min-w-0">
          <h2
            className="truncate text-[15px] leading-5 font-semibold tracking-[-0.015em] text-(--ink)"
            id={headingId}
          >
            {name}
          </h2>
          {deadlineLabel ? (
            <p
              className={cn(
                "mt-0.5 truncate text-xs text-(--ink-secondary)",
                dueSoon && "font-medium text-(--warning-fg)",
              )}
            >
              {deadlineLabel}
            </p>
          ) : null}
        </div>
        {countEssays.length > 0 ? (
          <span className="ml-auto shrink-0 text-xs text-(--ink-muted) tabular-nums">
            {done} of {countEssays.length} done
          </span>
        ) : null}
      </header>

      {essays.length > 0 ? (
        <ul className="flex flex-col">
          {essays.map((essay) => (
            <EssayRow essay={essay} key={essay.id} {...actions} />
          ))}
        </ul>
      ) : null}

      {onAdd ? (
        <button
          aria-label={addLabel}
          className="flex items-center gap-1.5 px-3 py-[9px] text-left text-xs font-medium text-(--ink-muted) outline-none transition-colors duration-150 hover:text-(--ink) focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset"
          data-slot="essay-add-row"
          onClick={onAdd}
          type="button"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add an essay
        </button>
      ) : null}
    </section>
  );
}
