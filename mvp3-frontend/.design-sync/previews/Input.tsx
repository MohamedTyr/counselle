import { Input } from "mvp3-frontend"

export function Sizes() {
  return (
    <div className="flex w-72 flex-col gap-3">
      <Input size="sm" placeholder="Small — search schools" />
      <Input size="default" placeholder="Default — full name" />
      <Input size="lg" placeholder="Large — essay title" />
    </div>
  )
}

export function Types() {
  return (
    <div className="flex w-72 flex-col gap-3">
      <Input type="email" defaultValue="student@example.edu" />
      <Input type="date" defaultValue="2026-11-01" />
      <Input placeholder="Disabled" disabled />
    </div>
  )
}
