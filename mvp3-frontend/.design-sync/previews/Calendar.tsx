import { Calendar } from "mvp3-frontend"

export function Single() {
  return (
    <Calendar
      mode="single"
      defaultMonth={new Date(2026, 10, 1)}
      selected={new Date(2026, 10, 1)}
      className="rounded-lg border p-3"
    />
  )
}
