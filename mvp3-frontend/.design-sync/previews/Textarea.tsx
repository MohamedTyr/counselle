import { Textarea } from "mvp3-frontend"

export function Sizes() {
  return (
    <div className="flex w-96 flex-col gap-3">
      <Textarea size="sm" placeholder="Short answer (150 words)…" />
      <Textarea
        size="default"
        defaultValue="Growing up between two languages taught me that translation is never neutral — every word choice is a small act of interpretation."
        rows={4}
      />
    </div>
  )
}
