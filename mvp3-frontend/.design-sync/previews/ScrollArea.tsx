import { ScrollArea } from "mvp3-frontend"

const prompts = [
  "Describe a topic that engages you so much you lose track of time.",
  "Reflect on a time you questioned a belief or idea.",
  "Share an essay on any topic of your choice.",
  "Discuss an accomplishment that sparked personal growth.",
  "Describe a problem you'd like to solve.",
  "Recount a time you faced a challenge or setback.",
]

export function Vertical() {
  return (
    <ScrollArea className="h-40 w-80 rounded-lg border">
      <div className="flex flex-col gap-2 p-3">
        {prompts.map((p, i) => (
          <div key={i} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            {i + 1}. {p}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
