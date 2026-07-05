import { ChevronDown, GraduationCap } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { EssayLibraryCardData } from "@/domain/essay"
import { cn } from "@/lib/utils"

export function PromptMenu({ prompt }: { prompt: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-8 text-muted-foreground hover:text-foreground"
          type="button"
          variant="ghost"
        >
          <GraduationCap data-icon="inline-start" />
          Prompt
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 p-0 sm:w-96"
        sideOffset={8}
      >
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <GraduationCap className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Prompt</p>
              <p className="text-xs text-muted-foreground">Essay reference</p>
            </div>
          </div>
          <p className="text-sm leading-6 text-popover-foreground">{prompt}</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function HeaderDivider() {
  return (
    <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
  )
}

export function EssayStatusIndicator({
  status,
}: {
  status: EssayLibraryCardData["status"]
}) {
  const dotClassName = {
    "Not started": "bg-muted-foreground/50",
    Drafting: "bg-primary/60",
    "Needs review": "bg-destructive",
    Ready: "bg-success",
    Submitted: "bg-success",
  }[status]

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", dotClassName)}
      />
      {status}
    </span>
  )
}

export function EssayContextTrail({ essay }: { essay: EssayLibraryCardData }) {
  const trail = [essay.school, essay.type, `Due ${essay.deadline}`]

  return (
    <nav aria-label="Essay context" className="mt-1.5">
      <ol className="hidden min-w-0 items-center gap-x-2 overflow-hidden text-sm leading-5 text-muted-foreground sm:flex sm:flex-nowrap">
        {trail.map((item, index) => (
          <li
            className={cn(
              "flex min-w-0 items-center gap-2",
              index === trail.length - 1 && "shrink-0"
            )}
            key={item}
          >
            {index > 0 && (
              <span aria-hidden="true" className="text-border">
                /
              </span>
            )}
            <span
              className={cn(
                "truncate",
                index === 0 && "font-medium text-foreground/75"
              )}
            >
              {item}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-0.5 text-sm leading-5 text-muted-foreground sm:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-foreground/75">
            {essay.school}
          </span>
          <span aria-hidden="true" className="shrink-0 text-border">
            /
          </span>
          <span className="truncate">{essay.type}</span>
        </div>
        <span className="whitespace-nowrap">Due {essay.deadline}</span>
      </div>
    </nav>
  )
}
