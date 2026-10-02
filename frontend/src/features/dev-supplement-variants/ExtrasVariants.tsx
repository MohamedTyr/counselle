import { FileQuestion, Info, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import type { ApplicationSupplements } from "@/api/workspace/types";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ExtraRow, FooterSummary } from "@/features/dev-supplement-variants/ExtrasRows";
import { extraPrompts, shortSource } from "@/features/dev-supplement-variants/extras-model";
import { supplementSourceLine } from "@/features/essays/supplements-model";

/* Variant 2 alternatives for everything in a column besides the essays and
 * the choices: the extra prompts, the none/unlisted states, the source. */
export type ExtrasParts = {
  /* Appended to the column header's second line. */
  headerNote?: string;
  rows?: ReactNode;
  footnote?: ReactNode;
};


/* A: status in the header. The column says its state where the eye already
 * is; extra prompts open in a popover instead of growing the column. */
export function extrasVariantA(supplements: ApplicationSupplements): ExtrasParts {
  if (supplements.status === "none") return { headerNote: "No supplements this year" };
  if (supplements.status === "unlisted") return { headerNote: "Prompts not listed yet" };
  const extras = extraPrompts(supplements);
  return {
    headerNote: shortSource(supplements),
    rows:
      extras.length > 0 ? (
        <Popover>
          <PopoverTrigger className="flex w-full items-center gap-1.5 border-t border-(--hairline) px-3 py-2.5 text-start text-xs font-medium text-(--ink) outline-none transition-colors duration-150 hover:bg-(--surface-hover) focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset">
            <span className="flex size-4 items-center justify-center rounded-full bg-(--control-quiet-surface) text-[10px] font-semibold tabular-nums">
              {extras.length}
            </span>
            more {extras.length === 1 ? "prompt" : "prompts"} you may add
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))]">
            <PopoverTitle className="text-sm font-semibold">More prompts</PopoverTitle>
            <ul className="mt-1 divide-y divide-(--hairline)">
              {extras.map((p) => (
                <ExtraRow applicationId={supplements.application_id} key={p.key} prompt={p} />
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null,
  };
}

/* B: footer summary. One footer row carries the extras (left) and a short
 * source label with an icon (right); none/unlisted read as a small notice. */
export function extrasVariantB(supplements: ApplicationSupplements): ExtrasParts {
  if (supplements.status !== "prompts") {
    const none = supplements.status === "none";
    const Icon = none ? ShieldCheck : FileQuestion;
    return {
      rows: (
        <div className="flex flex-col items-center gap-1.5 border-t border-(--hairline) px-4 py-5 text-center">
          <Icon aria-hidden="true" className="size-5 text-(--ink-faint)" />
          <p className="text-[13px] font-medium text-(--ink)">
            {none ? "No supplemental essays" : "Prompts not listed yet"}
          </p>
          <p className="text-xs text-(--ink-muted)">
            {none ? "This school asks for none this year." : "Add any you find in the application."}
          </p>
        </div>
      ),
    };
  }
  return { footnote: <FooterSummary supplements={supplements} /> };
}


/* C: open and plain. Nothing folded and no rules: the extra prompts sit
 * under an "Also asked" heading, the source is one sentence at the end. */
export function extrasVariantC(supplements: ApplicationSupplements): ExtrasParts {
  if (supplements.status === "none") {
    return { rows: <p className="px-3 pt-1 pb-3 text-xs text-(--ink-muted)">No supplemental essays this year.</p> };
  }
  if (supplements.status === "unlisted") {
    return { rows: <p className="px-3 pt-1 pb-3 text-xs text-(--ink-muted)">We don’t have this school’s prompts yet.</p> };
  }
  const extras = extraPrompts(supplements);
  return {
    rows:
      extras.length > 0 ? (
        <section className="px-3 pt-3">
          <h3 className="text-xs font-semibold text-(--ink)">Also asked</h3>
          <ul>
            {extras.map((p) => (
              <ExtraRow applicationId={supplements.application_id} key={p.key} prompt={p} />
            ))}
          </ul>
        </section>
      ) : null,
    footnote: (
      <p className="flex items-start gap-1.5 px-3 pt-1 pb-3 text-xs text-(--ink-muted)">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {supplementSourceLine(supplements)}
      </p>
    ),
  };
}
