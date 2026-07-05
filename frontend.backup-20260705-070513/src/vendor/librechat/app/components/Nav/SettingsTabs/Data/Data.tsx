// Vendored from upstream client/src/components/Nav/SettingsTabs/Data/Data.tsx @ 197a1dc4
// Subtractions: ImportConversations, SharedLinks, AgentApiKeys (+ useHasAccess /
//   Permissions gate), RevokeKeys, DeleteCache — none of those surfaces exist in
//   MVP2. The unused confirmClearConvos state + useOnClickOutside went with them.
// Addition: DeleteAccount row (upstream renders it in the Account tab; the FE-5
//   plan moves account deletion into Data controls).
import React from 'react';
import DeleteAccount from '../Account/DeleteAccount';
import { ClearChats } from './ClearChats';

function Data() {
  return (
    <div className="flex flex-col gap-3 p-1 text-sm text-text-primary">
      <div className="pb-3">
        <ClearChats />
      </div>
      <div className="pb-3">
        <DeleteAccount />
      </div>
    </div>
  );
}

export default React.memo(Data);
