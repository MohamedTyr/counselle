// Vendored from upstream client/src/components/Nav/SettingsTabs/Account/Account.tsx @ 197a1dc4
// Subtractions: DisplayUsernameMessages toggle, Avatar upload (avatar-upload dropped),
//   EnableTwoFactorItem + BackupCodesItem (2FA dropped, PRD decision 6),
//   useGetStartupConfig allowAccountDeletion gate, DeleteAccount row (moved to the
//   Data tab per the FE-5 plan).
// Rewire (B5b): mock authStore → real /v1/me. Name edits PATCH /v1/me; email is
//   read-only; the password row is a real in-app change dialog (story 49, PATCH
//   /v1/auth/users/me) — an OAuth-only user (has_password === false) sees a
//   "Set a password" framing; a connected-Google row surfaces google_connected.
// Row grammar matches upstream (flex justify-between + Label, pb-3 spacing).
import React, { useState } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  OGDialogTrigger,
  Spinner,
} from '@librechat/client';
import { authErrorMessage, changePassword } from '@/api/http/auth';
import { useAuthUser, usePatchMe } from '@/app/auth';
import { useLocalize } from '~/hooks';

const MIN_PASSWORD_LENGTH = 8;

function PasswordRow({ hasPassword }: { hasPassword: boolean }) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setNewPassword('');
    setConfirm('');
    setError(null);
    setIsSaving(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
    }
  };

  const handleSave = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError(localize('com_auth_password_not_match'));
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await changePassword(newPassword);
      handleOpenChange(false);
    } catch (err: unknown) {
      setError(authErrorMessage(err));
      setIsSaving(false);
    }
  };

  // OAuth-only accounts have no password yet — frame the action as setting one.
  const triggerLabel = hasPassword
    ? localize('com_auth_reset_password')
    : 'Set a password';

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <div className="flex items-center justify-between">
        <Label id="account-password-label">{localize('com_auth_password')}</Label>
        <OGDialogTrigger asChild>
          <Button aria-labelledby="account-password-label" variant="outline">
            {triggerLabel}
          </Button>
        </OGDialogTrigger>
      </div>
      <OGDialogContent className="w-11/12 max-w-md">
        <OGDialogHeader>
          <OGDialogTitle className="text-lg font-medium leading-6">{triggerLabel}</OGDialogTitle>
        </OGDialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-new-password">{localize('com_auth_password')}</Label>
            <Input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-confirm-password">
              {localize('com_auth_password_confirm')}
            </Label>
            <Input
              id="account-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error != null && (
            <div role="alert" className="text-sm text-red-600 dark:text-red-500">
              {error}
            </div>
          )}
          <Button variant="submit" disabled={isSaving} onClick={handleSave}>
            {isSaving ? <Spinner /> : localize('com_ui_save')}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

function Account() {
  const localize = useLocalize();
  const user = useAuthUser();
  const patchMeMutation = usePatchMe();
  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);

  // FIX 7 (honesty): a failed name save used to silently revert the input with
  // no feedback. Surface it inline; clear it on the next successful save.
  const commitName = () => {
    const trimmed = name.trim();
    if (!user || trimmed === '' || trimmed === user.name) {
      setName(user?.name ?? '');
      return;
    }
    patchMeMutation.mutate(
      { name: trimmed },
      {
        onSuccess: () => setNameError(null),
        onError: () => setNameError('Couldn’t save — try again.'),
      },
    );
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
        {nameError != null && (
          <div role="alert" className="mt-1 text-right text-sm text-red-600 dark:text-red-500">
            {nameError}
          </div>
        )}
      </div>
      <div className="pb-3">
        <div className="flex items-center justify-between">
          <Label id="account-email-label">{localize('com_auth_email')}</Label>
          <div aria-labelledby="account-email-label" className="text-text-secondary">
            {user?.email}
          </div>
        </div>
      </div>
      <div className="pb-3">
        <PasswordRow hasPassword={user?.has_password ?? false} />
      </div>
      {user?.google_connected === true && (
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
