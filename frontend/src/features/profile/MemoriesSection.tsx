import { TrashIcon } from "lucide-react";
import { useState } from "react";

import { useArchiveMemory, useMemories } from "@/api/workspace/hooks";
import type { Memory } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { profileGroupBoxClass } from "@/features/profile/profile-control-styles";

function formatMemoryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function MemoryRow({ memory }: { memory: Memory }) {
  const archiveMemory = useArchiveMemory();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <li
      className={`flex items-start justify-between gap-4 ${profileGroupBoxClass}`}
    >
      <div className="flex min-w-0 max-w-2xl flex-col gap-1.5">
        <p className="text-sm leading-6">{memory.content}</p>
        <span className="text-xs text-[var(--profile-field-helper)]">
          {formatMemoryDate(memory.created_at)}
        </span>
      </div>
      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <DialogTrigger asChild>
          <Button aria-label="Forget this" size="icon-sm" variant="ghost">
            <TrashIcon />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forget this note?</DialogTitle>
            <DialogDescription>
              Counselle will stop using this memory in future conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              disabled={archiveMemory.isPending}
              onClick={() =>
                archiveMemory.mutate(memory.id, {
                  onSuccess: () => setConfirmOpen(false),
                })
              }
              variant="destructive"
            >
              Forget note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** Read-only besides delete: memories come from the agent's `remember` /
 * `update_memory` tools mid-chat, not from student edits here — matching
 * `api/routes/memories.py`'s GET + DELETE-only route set. */
export function MemoriesSection() {
  const memoriesQuery = useMemories();
  const memories = memoriesQuery.data ?? [];

  return (
    <Card className="border-[var(--profile-section-border)] bg-[var(--profile-section-surface)]">
      <CardHeader className="p-5">
        <CardTitle render={<h2 />}>What Counselle remembers</CardTitle>
        <CardDescription>
          Notes Counselle picked up while chatting with you. Delete anything
          that's wrong or no longer relevant.
        </CardDescription>
      </CardHeader>
      <CardPanel className="p-5 pt-0">
        {memoriesQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : memoriesQuery.isError ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>We couldn’t load memories</EmptyTitle>
              <EmptyDescription>
                Your saved conversation context is still safe. Try again to see
                it.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              onClick={() => void memoriesQuery.refetch()}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          </Empty>
        ) : memories.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing remembered yet</EmptyTitle>
              <EmptyDescription>
                As you chat with Counselle, anything worth remembering shows up
                here.
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
  );
}
