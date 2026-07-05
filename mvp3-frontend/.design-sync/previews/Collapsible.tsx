import { Collapsible, CollapsibleTrigger, CollapsibleContent, Button } from "mvp3-frontend"
import { ChevronsUpDown } from "lucide-react"

export function Open() {
  return (
    <Collapsible defaultOpen className="w-80 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Supplemental essays (3)</span>
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Toggle">
              <ChevronsUpDown />
            </Button>
          }
        />
      </div>
      <CollapsibleContent className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
        <div>Why this college? · 250 words</div>
        <div>Roommate letter · 650 words</div>
        <div>Intellectual vitality · 250 words</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
