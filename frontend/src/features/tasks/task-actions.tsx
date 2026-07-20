import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The agent cannot yet plan tasks (Decision D2, MVP3 workspace plan): the
 * button stays visible as an affordance but is disabled with a tooltip
 * instead of fabricating fake agent-authored tasks.
 */
export function PlanWithAgentButton({
  children = "Plan with agent",
  className,
  size,
  variant = "outline",
}: {
  children?: ReactNode;
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) {
  const unavailableReason = "Counselle agent — coming soon";
  const accessibleLabel = `Plan with agent unavailable: ${unavailableReason}`;

  const preventUnavailableActivation = (
    event: KeyboardEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const preventUnavailableKeyboardActivation = (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      preventUnavailableActivation(event);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-disabled="true"
          aria-label={accessibleLabel}
          className={cn(
            "aria-disabled:cursor-not-allowed aria-disabled:opacity-64",
            className,
          )}
          onClick={preventUnavailableActivation}
          onKeyDown={preventUnavailableKeyboardActivation}
          size={size}
          title={unavailableReason}
          type="button"
          variant={variant}
        >
          <Sparkles aria-hidden="true" data-icon="inline-start" />
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{unavailableReason}</TooltipContent>
    </Tooltip>
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
      className="max-w-full rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
