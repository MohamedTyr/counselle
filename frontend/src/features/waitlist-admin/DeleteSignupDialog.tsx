import { useRef, useState, type RefObject } from "react";
import type React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SessionEndedError, useDeleteSignup } from "./api";
import { posthogPersonUrl } from "./links";

/**
 * Pessimistic and without undo, an exception to DESIGN.md §17.4: a privacy
 * deletion must be true when the page says it is, and an undo would mean
 * keeping the data.
 */
export function DeleteSignupDialog({
  email,
  onClose,
  onSessionEnded,
  returnFocusRef,
}: {
  email: string | null;
  onClose: () => void;
  onSessionEnded: () => void;
  /** Where focus goes on close: the row menu that opened this is gone. */
  returnFocusRef: RefObject<HTMLElement | null>;
}): React.ReactElement {
  const remove = useDeleteSignup();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The last email stays on screen while the dialog fades out.
  const [shown, setShown] = useState(email);
  if (email !== null && email !== shown) setShown(email);
  const failed = remove.isError && !(remove.error instanceof SessionEndedError);

  function confirm() {
    if (!email || remove.isPending) return;
    remove.mutate(email, {
      onSuccess: () => {
        toast.success(`Deleted ${email}`);
        onClose();
      },
      onError: (error) => {
        if (error instanceof SessionEndedError) {
          onClose();
          onSessionEnded();
        }
      },
    });
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        // Closing mid-request would hide whether the delete happened.
        if (!open && !remove.isPending) onClose();
      }}
      open={email !== null}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          remove.reset();
          cancelRef.current?.focus();
        }}
        role="alertdialog"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="leading-snug [overflow-wrap:anywhere]">
            Delete {shown}?
          </DialogTitle>
          <DialogDescription>
            This removes their signup from the waitlist and can't be undone.
            Also delete them in PostHog and from any export you've saved.
          </DialogDescription>
        </DialogHeader>
        {shown ? (
          <a
            className="w-fit text-sm underline underline-offset-3 hover:text-foreground"
            href={posthogPersonUrl(shown)}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open in PostHog
          </a>
        ) : null}
        {failed ? (
          <p className="text-sm text-destructive-foreground" role="alert">
            Could not delete {shown}. Nothing was changed.
          </p>
        ) : null}
        <DialogFooter>
          <Button
            onClick={() => {
              if (!remove.isPending) onClose();
            }}
            ref={cancelRef}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            loading={remove.isPending}
            onClick={confirm}
            variant="destructive"
          >
            {failed ? "Try again" : "Delete signup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
