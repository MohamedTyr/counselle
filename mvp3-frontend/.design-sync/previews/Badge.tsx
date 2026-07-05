import { Badge } from "mvp3-frontend"

// Mirrors the real Counselle status pills.
// Task status → variant: todo=secondary, doing=info, waiting=warning, done=success
export function TaskStatus() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">Todo</Badge>
      <Badge variant="info">Doing Now</Badge>
      <Badge variant="warning">Waiting</Badge>
      <Badge variant="success">Done</Badge>
    </div>
  )
}

// School application status (Schools table)
export function ApplicationStatus() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">Considering</Badge>
      <Badge variant="info">Applying</Badge>
      <Badge variant="success">Submitted</Badge>
      <Badge variant="warning">Waitlisted</Badge>
      <Badge variant="error">Rejected</Badge>
    </div>
  )
}

// List type (Reach/Target/Safety) + priority
export function ListTypeAndPriority() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="warning">Reach</Badge>
      <Badge variant="info">Target</Badge>
      <Badge variant="success">Safety</Badge>
      <Badge variant="outline">Optional</Badge>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge size="sm" variant="info">Small</Badge>
      <Badge size="default" variant="info">Default</Badge>
      <Badge size="lg" variant="info">Large</Badge>
    </div>
  )
}
