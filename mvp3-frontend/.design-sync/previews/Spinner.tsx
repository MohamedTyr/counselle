import { Spinner, Button } from "mvp3-frontend"

export function Sizes() {
  return (
    <div className="flex items-center gap-5">
      <Spinner className="size-4" />
      <Spinner className="size-6" />
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  )
}

export function InButton() {
  return (
    <div className="flex items-center gap-3">
      <Button loading>Submitting</Button>
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Saving draft…
      </span>
    </div>
  )
}
