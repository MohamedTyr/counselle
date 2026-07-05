// Vendored from upstream client/src/components/Nav/SettingsTabs/Data/ClearChats.tsx @ 197a1dc4
// Rewire (B5b): the mock-store clears → real DELETE /v1/me/chats (keeps the
//   account, drops the chats), then invalidate [QueryKeys.chats]; navigate('/')
//   + activeConversationIdAtom reset retained. Dialog JSX + classes byte-identical.
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { OGDialogTemplate, Label, Button, OGDialog, OGDialogTrigger } from '@librechat/client';
import { deleteMyChats, authErrorMessage } from '@/api/http/auth';
import { QueryKeys } from '@/api/hooks';
import { activeConversationIdAtom } from '@/app/state';
import { useLocalize } from '~/hooks';

export const ClearChats = () => {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveConversationId = useSetAtom(activeConversationIdAtom);

  // FIX 3 (honesty): the success side-effects (cache wipe, reset, navigate,
  // close) run ONLY after the delete resolves — never in a `finally`. On failure
  // we surface the error and keep the dialog open; the chats are still there.
  const clearConvos = async () => {
    setError(null);
    try {
      await deleteMyChats();
      await queryClient.invalidateQueries([QueryKeys.chats]);
      setActiveConversationId(null);
      navigate('/');
      setOpen(false);
    } catch (err: unknown) {
      setError(authErrorMessage(err));
    }
  };

  return (
    <div className="flex items-center justify-between">
      <Label id="clear-all-chats-label">{localize('com_nav_clear_all_chats')}</Label>
      <OGDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setError(null);
          }
        }}
      >
        <OGDialogTrigger asChild>
          <Button
            aria-labelledby="clear-all-chats-label"
            variant="destructive"
            onClick={() => setOpen(true)}
          >
            {localize('com_ui_delete')}
          </Button>
        </OGDialogTrigger>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_nav_confirm_clear')}
          className="max-w-[450px]"
          main={
            <div className="flex flex-col gap-2">
              <Label className="break-words">
                {localize('com_nav_clear_conversation_confirm_message')}
              </Label>
              {error != null && (
                <div role="alert" className="text-sm text-red-600 dark:text-red-500">
                  {error}
                </div>
              )}
            </div>
          }
          selection={{
            selectHandler: clearConvos,
            selectClasses:
              'bg-destructive text-white transition-all duration-200 hover:bg-destructive/80',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>
    </div>
  );
};
