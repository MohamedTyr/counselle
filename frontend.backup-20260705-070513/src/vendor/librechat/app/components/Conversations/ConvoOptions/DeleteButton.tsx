// Vendored from upstream client/src/components/Conversations/ConvoOptions/DeleteButton.tsx @ 197a1dc4
// Subtractions: Trans (react-i18next), useDeleteConversationMutation, useQueryClient,
//   navigation + useNewConvo (handled in parent ConvoOptions).
// Rewire: deletion handled by parent via onConfirmDelete prop.
import React, { useCallback } from 'react';
import {
  Button,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
} from '@librechat/client';
import { useLocalize } from '~/hooks';

type DeleteButtonProps = {
  conversationId: string;
  retainView: () => void;
  title: string;
  showDeleteDialog?: boolean;
  setShowDeleteDialog?: (value: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
  setMenuOpen?: (open: boolean) => void;
  /** Called when user confirms delete — parent handles the mutation. */
  onConfirmDelete?: () => void;
  isDeleting?: boolean;
};

export function DeleteConversationDialog({
  setShowDeleteDialog,
  title,
  onConfirmDelete,
  isDeleting = false,
}: {
  setMenuOpen?: (open: boolean) => void;
  setShowDeleteDialog: (value: boolean) => void;
  conversationId: string;
  retainView: () => void;
  title: string;
  onConfirmDelete?: () => void;
  isDeleting?: boolean;
}) {
  const localize = useLocalize();

  const confirmDelete = useCallback(() => {
    onConfirmDelete?.();
  }, [onConfirmDelete]);

  return (
    <OGDialogContent
      className="w-11/12 max-w-md"
      showCloseButton={false}
      aria-describedby="delete-conversation-description"
    >
      <OGDialogHeader>
        <OGDialogTitle>{localize('com_ui_delete_conversation')}</OGDialogTitle>
      </OGDialogHeader>
      <div id="delete-conversation-description" className="w-full truncate">
        {localize('com_ui_delete_conversation')}:{' '}
        <strong>{title}</strong>
      </div>
      <div className="flex justify-end gap-4 pt-4">
        <OGDialogClose asChild>
          <Button aria-label="cancel" variant="outline" onClick={() => setShowDeleteDialog(false)}>
            {localize('com_ui_cancel')}
          </Button>
        </OGDialogClose>
        <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
          {isDeleting ? <Spinner /> : localize('com_ui_delete')}
        </Button>
      </div>
    </OGDialogContent>
  );
}

export default function DeleteButton({
  conversationId,
  retainView,
  title,
  setMenuOpen,
  showDeleteDialog,
  setShowDeleteDialog,
  triggerRef,
  onConfirmDelete,
  isDeleting,
}: DeleteButtonProps) {
  if (showDeleteDialog === undefined || setShowDeleteDialog === undefined) {
    return null;
  }

  if (!conversationId) {
    return null;
  }

  return (
    <OGDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog} triggerRef={triggerRef}>
      <DeleteConversationDialog
        setShowDeleteDialog={setShowDeleteDialog}
        conversationId={conversationId}
        setMenuOpen={setMenuOpen}
        retainView={retainView}
        title={title}
        onConfirmDelete={onConfirmDelete}
        isDeleting={isDeleting}
      />
    </OGDialog>
  );
}
