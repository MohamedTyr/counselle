import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Button,
} from "mvp3-frontend"

export function Open() {
  return (
    <TooltipProvider>
      <div className="flex justify-center py-10">
        <Tooltip defaultOpen>
          <TooltipTrigger
            render={<Button variant="outline" size="sm">Word count</Button>}
          />
          <TooltipContent sideOffset={6}>648 / 650 words</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
