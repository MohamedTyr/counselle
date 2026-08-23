import {
  AlertCircleIcon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  FilePenLineIcon,
  ListPlusIcon,
  SchoolIcon,
  SparklesIcon,
  TrophyIcon,
  UserRoundPenIcon,
} from "lucide-react";
import { useState } from "react";

import type { StepData, WorkspaceMutationReceipt } from "@/api/chat/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { ToolBeatIcon, ToolBeatLabel } from "../ToolBeat";
import { toolBeatEnter } from "../tool-beat-style";
import { ActivityMutationBody } from "./ActivityMutationWidget";
import { EssayContentMutationBody } from "./EssayContentMutationWidget";
import { EssayMutationBody } from "./EssayMutationWidget";
import { HonorMutationBody } from "./HonorMutationWidget";
import { MemoryMutationBody } from "./MemoryMutationWidget";
import { MutationReceiptBody } from "./MutationReceiptBody";
import { mutationGlanceText } from "./mutation-format";
import { ProfileMutationBody } from "./ProfileMutationWidget";
import { SchoolMutationBody } from "./SchoolMutationWidget";
import { TaskMutationBody } from "./TaskMutationWidget";

/**
 * The one shared shell for every mutation receipt family (plan §4.1, §4.3).
 * Owns lifecycle (running/settled/error), outcome tone, disclosure state,
 * and rail geometry. Every receipt starts collapsed, including partial/
 * failed/unknown ones — those still show their first actionable fact outside
 * the collapsed region (never hidden behind a click).
 */

type Props = Readonly<{
  isLiveSegment?: boolean;
  step: StepData;
  receipt: WorkspaceMutationReceipt;
}>;

function FamilyIcon({
  family,
  className,
}: {
  family: WorkspaceMutationReceipt["family"];
  className?: string;
}) {
  const props = { "aria-hidden": true, className } as const;
  if (family === "task") return <ClipboardCheckIcon {...props} />;
  if (family === "school") return <SchoolIcon {...props} />;
  if (family === "essay" || family === "essay_content")
    return <FilePenLineIcon {...props} />;
  if (family === "activity") return <SparklesIcon {...props} />;
  if (family === "honor") return <TrophyIcon {...props} />;
  if (family === "profile") return <UserRoundPenIcon {...props} />;
  return <ListPlusIcon {...props} />;
}

function isExpandable(receipt: WorkspaceMutationReceipt): boolean {
  const { body } = receipt;
  switch (body.kind) {
    case "batch":
      return body.items.length > 0;
    case "update":
      return body.changes.length > 0;
    case "state_transition":
      return body.cascade !== null && body.cascade !== undefined;
    case "duplicate":
      return true;
    case "reorder":
      return body.new_order.length > 1;
    case "essay_edit":
    case "essay_write":
      return true;
    case "profile":
      return body.sections.length > 0;
    case "memory":
      // Every operation is expandable, including forget — its reassurance
      // copy ("You can ask Counselle to remember this again") is inspect
      // content per plan §9.8's forget mockup (indented, behind disclosure),
      // not part of the always-visible glance line.
      return true;
    case "unresolved":
      return false;
    default:
      return false;
  }
}

function disclosureLabel(receipt: WorkspaceMutationReceipt, open: boolean): string {
  const verb = open ? "Hide" : "View";
  const { body } = receipt;
  if (body.kind === "batch") {
    const problems = body.items.filter((item) => item.disposition !== "changed").length;
    return problems > 0 && receipt.outcome !== "success"
      ? `${verb === "View" ? "Review" : "Hide"} ${problems} skipped`
      : `${verb} ${body.items.length} changes`;
  }
  if (body.kind === "update") return `${verb} ${body.changes.length} changes`;
  if (body.kind === "reorder") return `${verb} new order`;
  if (body.kind === "memory") return `${verb} memory notes`;
  if (body.kind === "duplicate") return `${verb} copy`;
  if (body.kind === "essay_edit") return `${verb} edits`;
  return `${verb} details`;
}

function immediateIssueText(receipt: WorkspaceMutationReceipt): string | null {
  if (receipt.outcome === "success" || receipt.outcome === "no_change") return null;
  if (receipt.body.kind === "batch") {
    const firstProblem = receipt.body.items.find((item) => item.disposition !== "changed");
    return firstProblem?.reason?.text ?? null;
  }
  return null;
}

/** Family dispatch for the expanded body (plan §9): a family with a bespoke
 * anatomy widget renders it; everything else falls back to the shared
 * generic typed-field renderer. */
function MutationReceiptFamilyBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
  switch (receipt.family) {
    case "task":
      return <TaskMutationBody receipt={receipt} />;
    case "school":
      return <SchoolMutationBody receipt={receipt} />;
    case "essay":
      return <EssayMutationBody receipt={receipt} />;
    case "essay_content":
      return <EssayContentMutationBody receipt={receipt} />;
    case "activity":
      return <ActivityMutationBody receipt={receipt} />;
    case "honor":
      return <HonorMutationBody receipt={receipt} />;
    case "profile":
      return <ProfileMutationBody receipt={receipt} />;
    case "memory":
      return <MemoryMutationBody receipt={receipt} />;
    default:
      return <MutationReceiptBody receipt={receipt} />;
  }
}

export function MutationReceiptShell({
  isLiveSegment = false,
  step,
  receipt,
}: Props) {
  const [open, setOpen] = useState(false);
  const running = isLiveSegment && step.status === "start";
  const failed = receipt.outcome === "failed" || receipt.outcome === "unknown";
  const glance = mutationGlanceText(receipt);
  const issue = immediateIssueText(receipt);
  const expandable = !running && isExpandable(receipt);

  return (
    <Collapsible
      className={cn(
        "not-prose grid grid-cols-[16px_minmax(0,1fr)] gap-3 py-2",
        toolBeatEnter,
      )}
      onOpenChange={setOpen}
      open={open}
    >
      <ToolBeatIcon tone={failed ? "error" : "muted"}>
        {running ? (
          <Spinner className="size-3.5" />
        ) : failed ? (
          <AlertCircleIcon className="size-3.5" />
        ) : (
          <FamilyIcon className="size-3.5" family={receipt.family} />
        )}
      </ToolBeatIcon>

      <div className="min-w-0">
        <ToolBeatLabel state={running ? "running" : failed ? "error" : "settled"}>
          {running ? step.label : glance}
        </ToolBeatLabel>

        {!running && issue !== null && (
          <p className="mt-0.5 text-xs text-[var(--danger-fg)]" role="alert">
            {issue}
          </p>
        )}

        {!running && expandable && (
          <CollapsibleTrigger
            aria-expanded={open}
            className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-1 px-0 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {disclosureLabel(receipt, open)}
            <ChevronDownIcon
              aria-hidden="true"
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </CollapsibleTrigger>
        )}

        {!running && expandable && (
          <CollapsibleContent className="mt-2 overflow-hidden rounded-md bg-[var(--control-track)] p-2.5 text-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none">
            <MutationReceiptFamilyBody receipt={receipt} />
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}
