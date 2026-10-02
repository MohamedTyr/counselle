import { ChevronRight, CircleDashed, ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { ApplicationSupplements, SupplementPrompt } from "@/api/workspace/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { extraPrompts, shortSource } from "@/features/dev-supplement-variants/extras-model";
import { useSupplementActions } from "@/features/essays/supplement-actions";
import { supplementSourceLine } from "@/features/essays/supplements-model";
import { cn } from "@/lib/utils";

export function ExtraRow({ applicationId, prompt }: { applicationId: string; prompt: SupplementPrompt }) {
  const actions = useSupplementActions();
  return (
    <li className="flex flex-col gap-1 py-2">
      <span className="text-xs font-medium text-(--ink-muted)">{prompt.applies_to ?? "Optional"}</span>
      <span className="text-[13px] leading-5 text-(--ink-secondary)">{prompt.prompt}</span>
      <button
        className="w-fit rounded-sm text-xs font-medium text-(--ink) underline decoration-(--hairline) underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
        onClick={() => actions.start(applicationId, prompt.key)}
        type="button"
      >
        Add this essay
      </button>
    </li>
  );
}

export function FooterSummary({ supplements }: { supplements: ApplicationSupplements }) {
  const [open, setOpen] = useState(false);
  const extras = extraPrompts(supplements);
  const verified = supplements.checked !== "unchecked";
  const SourceIcon = verified ? ShieldCheck : CircleDashed;
  return (
    <Collapsible className="border-t border-(--hairline)" onOpenChange={setOpen} open={open}>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        {extras.length > 0 ? (
          <CollapsibleTrigger className="flex items-center gap-1 rounded-sm text-xs font-medium text-(--ink) outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)">
            <ChevronRight
              aria-hidden="true"
              className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")}
            />
            {extras.length} more {extras.length === 1 ? "prompt" : "prompts"}
          </CollapsibleTrigger>
        ) : (
          <span />
        )}
        <span
          className="flex items-center gap-1 text-xs text-(--ink-muted)"
          title={supplementSourceLine(supplements) ?? undefined}
        >
          <SourceIcon aria-hidden="true" className="size-3.5" />
          {shortSource(supplements)}
        </span>
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <ul className="divide-y divide-(--hairline) px-3 pb-2">
          {extras.map((p) => (
            <ExtraRow applicationId={supplements.application_id} key={p.key} prompt={p} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
