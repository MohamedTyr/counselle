import { Button } from "mvp3-frontend"
import { Plus, ArrowRight, Trash2 } from "lucide-react"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Save draft</Button>
      <Button variant="secondary">Preview</Button>
      <Button variant="outline">Add school</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="link">View rubric</Button>
      <Button variant="destructive">Delete essay</Button>
      <Button variant="destructive-outline">Withdraw</Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="xl">Extra large</Button>
    </div>
  )
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus /> New application
      </Button>
      <Button variant="outline">
        Continue <ArrowRight />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Delete">
        <Trash2 />
      </Button>
    </div>
  )
}

export function States() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button loading>Submitting</Button>
      <Button disabled>Locked</Button>
      <Button variant="secondary" disabled>
        Awaiting review
      </Button>
    </div>
  )
}
