// Vendored from upstream client/src/components/Nav/SettingsTabs/Account/Account.tsx @ 197a1dc4
// Subtractions: DisplayUsernameMessages toggle, Avatar upload (avatar-upload dropped),
//   EnableTwoFactorItem + BackupCodesItem (2FA dropped, PRD decision 6),
//   useGetStartupConfig allowAccountDeletion gate, DeleteAccount row (moved to the
//   Data tab per the FE-5 plan).
// Rewire: useAuthContext → @/app/auth (mock session).
// Additions (Counselle-native rows, upstream row grammar — flex justify-between +
//   Label, pb-3 spacing): name (inline edit, commit on blur/Enter → mock updateUser),
//   email (read-only), password ("Reset password" disabled — upstream has no in-app
//   password-change dialog at the pinned commit, only the logged-out reset flow;
//   shown for password-provider users only, mirroring upstream's provider gate),
//   connected-Google (shown when user.provider === 'google').
import React, { useState } from 'react';
import { useSetAtom } from 'jotai';
import { Button, Input, Label } from '@librechat/client';
import { updateUser } from '@/api/mock/authStore';
import { useAuthUser, sessionUserAtom } from '@/app/auth';
import { useLocalize } from '~/hooks';

function Account() {
  const localize = useLocalize();
  const user = useAuthUser();
  const setSessionUser = useSetAtom(sessionUserAtom);
  const [name, setName] = useState(user?.name ?? '');

  const commitName = () => {
    const trimmed = name.trim();
    if (!user || trimmed === '' || trimmed === user.name) {
      setName(user?.name ?? '');
      return;
    }
    setSessionUser(updateUser({ name: trimmed }));
  };

  return (
    <div className="flex flex-col gap-3 p-1 text-sm text-text-primary">
      <div className="pb-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="account-name-input">{localize('com_ui_name')}</Label>
          <Input
            id="account-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="w-[180px]"
          />
        </div>
      </div>
      <div className="pb-3">
        <div className="flex items-center justify-between">
          <Label id="account-email-label">{localize('com_auth_email')}</Label>
          <div aria-labelledby="account-email-label" className="text-text-secondary">
            {user?.email}
          </div>
        </div>
      </div>
      {user?.provider === 'password' && (
        <div className="pb-3">
          <div className="flex items-center justify-between">
            <Label id="account-password-label">{localize('com_auth_password')}</Label>
            <Button aria-labelledby="account-password-label" variant="outline" disabled>
              {localize('com_auth_reset_password')}
            </Button>
          </div>
        </div>
      )}
      {user?.provider === 'google' && (
        <div className="pb-3">
          <div className="flex items-center justify-between">
            <Label id="account-google-label">Google</Label>
            <div aria-labelledby="account-google-label" className="text-text-secondary">
              Connected
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(Account);
