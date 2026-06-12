// Vendored from upstream client/src/components/Nav/SettingsTabs/Data/ClearChats.tsx @ 197a1dc4
// Rewire (data source): useClearConversationsMutation → the mock stores
//   (clearAllChats + clearAllTranscripts) + react-query invalidation;
//   clearAllConversationStorage / useNewConvo → navigate('/') +
//   activeConversationIdAtom reset (the established Convo.tsx rewire).
//   Spinner select-text branch dropped (the mock clear is synchronous).
//   Dialog JSX + classes byte-identical.
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { OGDialogTemplate, Label, Button, OGDialog, OGDialogTrigger } from '@librechat/client';
import { clearAllChats } from '@/api/mock/store';
import { clearAllTranscripts } from '@/api/mock/messagesStore';
import { QueryKeys } from '@/api/hooks';
import { activeConversationIdAtom } from '@/app/state';
import { useLocalize } from '~/hooks';

export const ClearChats = () => {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveConversationId = useSetAtom(activeConversationIdAtom);

  const clearConvos = () => {
    clearAllChats();
    clearAllTranscripts();
    queryClient.invalidateQueries([QueryKeys.chats]);
    setActiveConversationId(null);
    navigate('/');
    setOpen(false);
  };

  return (
    <div className="flex items-center justify-between">
      <Label id="clear-all-chats-label">{localize('com_nav_clear_all_chats')}</Label>
      <OGDialog open={open} onOpenChange={setOpen}>
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
            <Label className="break-words">
              {localize('com_nav_clear_conversation_confirm_message')}
            </Label>
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
