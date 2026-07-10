import { TrashIcon } from "lucide-react"

import { useArchiveMemory, useMemories } from "@/api/workspace/hooks"
import type { Memory } from "@/api/workspace/types"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"

function formatMemoryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function MemoryRow({ memory }: { memory: Memory }) {
  const archiveMemory = useArchiveMemory()

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm">{memory.content}</p>
        <span className="text-xs text-muted-foreground">
          {formatMemoryDate(memory.created_at)}
        </span>
      </div>
      <Button
        aria-label="Forget this"
        disabled={archiveMemory.isPending}
        onClick={() => archiveMemory.mutate(memory.id)}
        size="icon-sm"
        variant="ghost"
      >
        <TrashIcon />
      </Button>
    </li>
  )
}

/** Read-only besides delete: memories come from the agent's `remember` /
 * `update_memory` tools mid-chat, not from student edits here — matching
 * `api/routes/memories.py`'s GET + DELETE-only route set. */
export function MemoriesSection() {
  const memoriesQuery = useMemories()
  const memories = memoriesQuery.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle render={<h2 />}>What Counselle remembers</CardTitle>
        <CardDescription>
          Notes Counselle picked up while chatting with you. Delete anything
          that's wrong or no longer relevant.
        </CardDescription>
      </CardHeader>
      <CardPanel>
        {memories.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing remembered yet</EmptyTitle>
              <EmptyDescription>
                As you chat with Counselle, anything worth remembering shows
                up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {memories.map((memory) => (
              <MemoryRow key={memory.id} memory={memory} />
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  )
}
