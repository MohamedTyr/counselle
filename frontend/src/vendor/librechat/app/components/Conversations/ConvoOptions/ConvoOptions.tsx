// Vendored from upstream client/src/components/Conversations/ConvoOptions/ConvoOptions.tsx @ 197a1dc4
// Subtractions: Share, Duplicate, Project/RemoveFromProject, Archive, shift-instant-delete.
//   Kept: Rename + Delete only (per MVP2 brief).
// Rewire: useDeleteConversationMutation → useDeleteChatMutation; useChatContext stripped.
import { useState, useId, useRef, memo, useCallback } from 'react';
import * as Ariakit from '@ariakit/react';
import { useParams, useNavigate } from 'react-router-dom';
import { DropdownPopup, useToastContext } from '@librechat/client';
import { Pen, Trash } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useLocalize } from '~/hooks';
import DeleteButton from './DeleteButton';
import { cn } from '~/utils';
import { useDeleteChatMutation } from '@/api/hooks';
import { useChatContext } from '@/app/ChatContext';

function ConvoOptions({
  conversationId,
  chatProjectId: _chatProjectId,
  title,
  retainView,
  renameHandler,
  isPopoverActive,
  setIsPopoverActive,
  isActiveConvo,
  isShiftHeld: _isShiftHeld = false,
}: {
  conversationId: string | null;
  chatProjectId?: string | null;
  title: string | null;
  retainView: () => void;
  renameHandler: (e: MouseEvent) => void;
  isPopoverActive: boolean;
  setIsPopoverActive: (open: boolean) => void;
  isActiveConvo: boolean;
  isShiftHeld?: boolean;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { newConversation } = useChatContext();
  const { conversationId: currentConvoId } = useParams();

  const menuId = useId();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteMutation = useDeleteChatMutation();

  const deleteHandler = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleDeleteConfirmed = useCallback(() => {
    const convoId = conversationId ?? '';
    if (!convoId) return;
    deleteMutation.mutate(
      { conversationId: convoId },
      {
        onSuccess: () => {
          setShowDeleteDialog(false);
          if (currentConvoId === convoId) {
            newConversation();
            navigate('/', { replace: true });
          }
          setIsPopoverActive(false);
          retainView();
          showToast({ message: localize('com_ui_convo_delete_success') });
        },
        onError: () => {
          showToast({ message: localize('com_ui_convo_delete_error') });
        },
      },
    );
  }, [conversationId, deleteMutation, currentConvoId, newConversation, navigate, setIsPopoverActive, retainView, showToast, localize]);

  const dropdownItems = [
    {
      label: localize('com_ui_rename'),
      onClick: renameHandler,
      icon: <Pen className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
    },
    {
      label: localize('com_ui_delete'),
      onClick: deleteHandler,
      icon: <Trash className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      ariaHasPopup: 'dialog' as const,
      ariaControls: 'delete-conversation-dialog',
      hideOnClick: false,
      ref: deleteButtonRef,
      render: (props: React.HTMLAttributes<HTMLElement>) => <button {...props} />,
    },
  ];

  const buttonClassName = cn(
    'inline-flex h-7 w-7 items-center justify-center rounded-md border-none p-0 text-sm font-medium ring-ring-primary transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50',
    isActiveConvo === true || isPopoverActive
      ? 'opacity-100'
      : 'opacity-0 focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[open]:opacity-100',
  );

  return (
    <>
      <DropdownPopup
        portal={true}
        menuId={menuId}
        focusLoop={true}
        className="z-[125]"
        unmountOnHide={true}
        isOpen={isPopoverActive}
        setIsOpen={setIsPopoverActive}
        trigger={
          <Ariakit.MenuButton
            id={`conversation-menu-${conversationId}`}
            aria-label={localize('com_nav_convo_menu_options')}
            aria-expanded={isPopoverActive}
            className={buttonClassName}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
              }
            }}
          >
            <span className="icon-md text-text-secondary" aria-hidden>⋯</span>
          </Ariakit.MenuButton>
        }
        items={dropdownItems}
      />
      {showDeleteDialog && (
        <DeleteButton
          title={title ?? ''}
          retainView={retainView}
          triggerRef={deleteButtonRef}
          setMenuOpen={setIsPopoverActive}
          showDeleteDialog={showDeleteDialog}
          conversationId={conversationId ?? ''}
          setShowDeleteDialog={setShowDeleteDialog}
          onConfirmDelete={handleDeleteConfirmed}
          isDeleting={deleteMutation.isLoading}
        />
      )}
    </>
  );
}

export default memo(ConvoOptions, (prevProps, nextProps) => {
  return (
    prevProps.conversationId === nextProps.conversationId &&
    prevProps.title === nextProps.title &&
    prevProps.isPopoverActive === nextProps.isPopoverActive &&
    prevProps.isActiveConvo === nextProps.isActiveConvo
  );
});
