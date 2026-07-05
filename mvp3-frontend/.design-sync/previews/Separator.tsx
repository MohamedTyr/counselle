import { Separator } from "mvp3-frontend"

export function Horizontal() {
  return (
    <div className="w-72">
      <div className="text-sm font-medium">Application checklist</div>
      <Separator className="my-3" />
      <div className="text-sm text-muted-foreground">Essays · Recommendations · Transcript</div>
    </div>
  )
}

export function Vertical() {
  return (
    <div className="flex h-8 items-center gap-3 text-sm">
      <span>Reach</span>
      <Separator orientation="vertical" />
      <span>Target</span>
      <Separator orientation="vertical" />
      <span>Likely</span>
    </div>
  )
}
