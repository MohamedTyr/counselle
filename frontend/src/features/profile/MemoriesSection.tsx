import { TrashIcon } from "lucide-react";
import { useState } from "react";

import { useArchiveMemory, useMemories } from "@/api/workspace/hooks";
import type { Memory } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
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
import { ProfileTabFrame } from "@/features/profile/ProfileTabFrame";
import {
  profileEmptySheetClass,
  profileRowActionClass,
  profileSheetClass,
} from "@/features/profile/profile-control-styles";
import { cn } from "@/lib/utils";

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
    <li className="group flex items-start gap-4 px-4 py-3.5">
      <p className="min-w-0 flex-1 text-sm leading-6 text-pretty text-[var(--ink)]">
        {memory.content}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-xs leading-6 text-[var(--ink-faint)] tabular-nums">
          {formatMemoryDate(memory.created_at)}
        </span>
        <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
          <DialogTrigger asChild>
            <Button
              aria-label="Forget this"
              className={profileRowActionClass}
              size="icon-sm"
              variant="ghost"
            >
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
      </div>
    </li>
  );
}

function MemoriesBody() {
  const memoriesQuery = useMemories();
  const memories = memoriesQuery.data ?? [];

  if (memoriesQuery.isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (memoriesQuery.isError) {
    return (
      <Empty className={profileEmptySheetClass}>
        <EmptyHeader>
          <EmptyTitle>We couldn’t load memories</EmptyTitle>
          <EmptyDescription>
            Your saved conversation context is still safe. Try again to see it.
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
    );
  }

  if (memories.length === 0) {
    return (
      <Empty className={profileEmptySheetClass}>
        <EmptyHeader>
          <EmptyTitle>Nothing remembered yet</EmptyTitle>
          <EmptyDescription>
            As you chat with Counselle, anything worth remembering shows up
            here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul
      className={cn(
        "divide-y divide-[var(--profile-section-divider)]",
        profileSheetClass,
      )}
    >
      {memories.map((memory) => (
        <MemoryRow key={memory.id} memory={memory} />
      ))}
    </ul>
  );
}

/** Read-only besides delete: memories come from the agent's `remember` /
 * `update_memory` tools mid-chat, not from student edits here — matching
 * `api/routes/memories.py`'s GET + DELETE-only route set. */
export function MemoriesSection() {
  return (
    <ProfileTabFrame
      description="Notes Counselle picked up while chatting with you. Delete anything that’s wrong or no longer true."
      title="What Counselle remembers"
    >
      <MemoriesBody />
    </ProfileTabFrame>
  );
}
