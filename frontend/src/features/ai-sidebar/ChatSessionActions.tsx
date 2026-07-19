import { useState, type FormEvent, type MouseEvent } from "react";
import { MoreHorizontal, PencilLine, Trash2 } from "lucide-react";

import { UNTITLED_CHAT_TITLE } from "@/api/chat/transport";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarMenuAction } from "@/components/ui/sidebar";

type ChatSessionActionsProps = {
  isBusy: boolean;
  onDelete: () => void;
  onRename: (title: string) => Promise<boolean>;
  title: string;
};

function stopPropagation(event: MouseEvent) {
  event.stopPropagation();
}

export function ChatSessionActions({
  isBusy,
  onDelete,
  onRename,
  title,
}: ChatSessionActionsProps) {
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [error, setError] = useState<string | null>(null);

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const renamed = await onRename(draftTitle.trim() || UNTITLED_CHAT_TITLE);
    if (renamed) {
      setIsRenameOpen(false);
    } else {
      setError("Could not rename this chat. Try again.");
    }
  }

  function openRenameDialog() {
    setDraftTitle(title);
    setError(null);
    setIsRenameOpen(true);
  }

  function setRenameOpen(open: boolean) {
    setIsRenameOpen(open);
    if (!open) {
      setError(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            aria-label={`Actions for ${title}`}
            className="sidebar-chat-action pointer-events-none !top-3 z-10 transition-[color,opacity] group-focus-within/menu-item:pointer-events-auto group-hover/menu-item:pointer-events-auto aria-expanded:pointer-events-auto pointer-coarse:pointer-events-auto pointer-coarse:!opacity-100 pointer-coarse:after:!-top-3 pointer-coarse:after:!-right-2 pointer-coarse:after:!-bottom-3 pointer-coarse:after:!-left-4 pointer-coarse:after:!block md:pointer-fine:!top-1.5"
            disabled={isBusy}
            onClick={stopPropagation}
            showOnHover
          >
            <MoreHorizontal aria-hidden="true" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-36"
          onClick={stopPropagation}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={openRenameDialog}>
              <PencilLine aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} variant="destructive">
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isRenameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form className="flex flex-col gap-4" onSubmit={submitRename}>
            <DialogHeader>
              <DialogTitle>Rename chat</DialogTitle>
              <DialogDescription>
                Update the name shown in your recent chats.
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Chat title"
              aria-invalid={error !== null}
              autoFocus
              onChange={(event) => setDraftTitle(event.target.value)}
              value={draftTitle}
            />
            {error !== null && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                onClick={() => setRenameOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button loading={isBusy} type="submit">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
