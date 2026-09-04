import type { MouseEvent, ReactNode } from "react";
import { MoreHorizontal, School, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router";

import type { ApplicationView } from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import {
  Button,
  buttonVariants,
  type ButtonProps,
} from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * "Plan with Counselle" (spec §8.1, decision D2): opens the composer with a
 * visible, editable draft prompt — exactly the same `<Link state=
 * {{ draftPrompt }}>` handoff `SchoolDetailRoute.tsx` and
 * `SchoolFactsPanel.tsx` already use. There is no hidden context channel.
 */
export function PlanWithCounselleButton({
  children = "Plan with Counselle",
  className,
  draftPrompt,
  size,
  variant = "outline",
}: {
  children?: ReactNode;
  className?: string;
  draftPrompt: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) {
  return (
    <Button
      className={className}
      render={<Link state={{ draftPrompt }} to="/app/ai" />}
      size={size}
      type="button"
      variant={variant}
    >
      <Sparkles aria-hidden="true" data-icon="inline-start" />
      {children}
    </Button>
  );
}

function stopPropagation(event: Pick<MouseEvent, "stopPropagation">) {
  event.stopPropagation();
}

export function TaskSchoolChip({
  applicationId,
  applicationsById,
}: {
  applicationId?: string;
  applicationsById: ReadonlyMap<string, ApplicationView>;
}) {
  const application = applicationId
    ? applicationsById.get(applicationId)
    : undefined;

  if (!application) {
    return null;
  }

  return (
    <Link
      aria-label={`Open ${application.school_name} workspace`}
      className="max-w-full rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
      to={`/app/schools/${application.id}`}
    >
      <Badge className="max-w-full gap-1" variant="outline">
        <School aria-hidden="true" className="size-3" />
        <span className="truncate">
          {application.school_name} ·{" "}
          {application.cycle_year
            ? `${application.cycle_year - 1}-${String(application.cycle_year).slice(-2)}`
            : "Cycle unconfirmed"}
        </span>
      </Badge>
    </Link>
  );
}

export function TaskDeleteMenu({
  className,
  onDeleteTask,
  taskId,
  taskTitle,
}: {
  className?: string;
  onDeleteTask: (taskId: string) => void;
  taskId: string;
  taskTitle: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${taskTitle}`}
        className={cn(
          buttonVariants({ size: "icon-xs", variant: "ghost" }),
          "shrink-0 text-muted-foreground",
          className,
        )}
        onClick={stopPropagation}
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-36"
        onClick={stopPropagation}
      >
        <DropdownMenuItem
          onClick={() => onDeleteTask(taskId)}
          variant="destructive"
        >
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
