// Vendored from upstream client/src/components/Nav/SettingsTabs/Account/DeleteAccount.tsx @ 197a1dc4
// Subtractions: the whole 2FA/OTP path (needs2FA, InputOTP/* — 2FA dropped, PRD
//   decision 6), useDeleteUserMutation + isDeleting spinner branch (mock delete is
//   synchronous), TDeleteUserRequest.
// Rewire (B5b): useAuthUser() over /v1/me; delete → real DELETE /v1/me (the
//   account) via useDeleteAccount(), then a hard navigate to /login (full reset
//   — clears every cached query). Email-confirm lock + dialog JSX/classes
//   byte-identical.
import React, { useState, useCallback } from 'react';
import { LockIcon, Trash } from 'lucide-react';
import {
  OGDialogContent,
  OGDialogTrigger,
  OGDialogHeader,
  OGDialogTitle,
  OGDialog,
  Button,
  Label,
  Input,
} from '@librechat/client';
import { authErrorMessage } from '@/api/http/auth';
import { useAuthUser, useDeleteAccount } from '@/app/auth';
import { LocalizeFunction } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const DeleteAccount = ({ disabled = false }: { title?: string; disabled?: boolean }) => {
  const localize = useLocalize();
  const user = useAuthUser();
  const deleteAccountMutation = useDeleteAccount();

  const [isDialogOpen, setDialogOpen] = useState<boolean>(false);
  const [isLocked, setIsLocked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // FIX 4 (honesty): navigate to /login ONLY after the DELETE resolves. The
  // "even if it fails, route to /login" reasoning is correct for *logout* but
  // wrong for *delete* — on failure the account survives and the still-valid
  // cookie would bounce the student right back in, so we stay and show the error.
  const handleDeleteUser = async () => {
    if (isLocked) {
      return;
    }
    setError(null);
    try {
      await deleteAccountMutation.mutateAsync();
    } catch (err: unknown) {
      setError(authErrorMessage(err));
      return;
    }
    // Hard navigate so every cached query is dropped along with the session.
    window.location.href = '/login';
  };

  const handleInputChange = useCallback(
    (newEmailInput: string) => {
      const isEmailCorrect =
        newEmailInput.trim().toLowerCase() === user?.email.trim().toLowerCase();
      setIsLocked(!isEmailCorrect);
    },
    [user?.email],
  );

  return (
    <>
      <OGDialog
        open={isDialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) {
            setError(null);
          }
        }}
      >
        <div className="flex items-center justify-between">
          <Label id="delete-account-label">{localize('com_nav_delete_account')}</Label>
          <OGDialogTrigger asChild>
            <Button
              aria-labelledby="delete-account-label"
              variant="destructive"
              onClick={() => setDialogOpen(true)}
              disabled={disabled}
            >
              {localize('com_ui_delete')}
            </Button>
          </OGDialogTrigger>
        </div>
        <OGDialogContent className="w-11/12 max-w-md">
          <OGDialogHeader>
            <OGDialogTitle className="text-lg font-medium leading-6">
              {localize('com_nav_delete_account_confirm')}
            </OGDialogTitle>
          </OGDialogHeader>
          <div className="mb-8 text-sm text-black dark:text-white">
            <ul className="font-semibold text-amber-600">
              <li>{localize('com_nav_delete_warning')}</li>
              <li>{localize('com_nav_delete_data_info')}</li>
            </ul>
          </div>
          <div className="flex-col items-center justify-center">
            <div className="mb-4">
              {renderInput(
                localize('com_nav_delete_account_email_placeholder'),
                'email-confirm-input',
                user?.email ?? '',
                (e) => handleInputChange(e.target.value),
              )}
            </div>
            {renderDeleteButton(handleDeleteUser, isLocked, localize)}
            {error != null && (
              <div role="alert" className="mt-3 text-sm text-red-600 dark:text-red-500">
                {error}
              </div>
            )}
          </div>
        </OGDialogContent>
      </OGDialog>
    </>
  );
};

const renderInput = (
  label: string,
  id: string,
  value: string,
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
) => (
  <div className="mb-4">
    <label className="mb-1 block text-sm font-medium text-black dark:text-white" htmlFor={id}>
      {label}
    </label>
    <Input id={id} onChange={onChange} placeholder={value} />
  </div>
);

const renderDeleteButton = (
  handleDeleteUser: () => void,
  isLocked: boolean,
  localize: LocalizeFunction,
) => (
  <button
    className={cn(
      'mt-4 flex w-full items-center justify-center rounded-lg bg-surface-tertiary px-4 py-2 transition-all duration-200',
      isLocked ? 'cursor-not-allowed opacity-30' : 'bg-destructive text-destructive-foreground',
    )}
    onClick={handleDeleteUser}
    disabled={isLocked}
  >
    {isLocked ? (
      <>
        <LockIcon className="size-5" aria-hidden="true" />
        <span className="ml-2">{localize('com_ui_locked')}</span>
      </>
    ) : (
      <>
        <Trash className="size-5" aria-hidden="true" />
        <span className="ml-2">{localize('com_nav_delete_account_button')}</span>
      </>
    )}
  </button>
);

export default DeleteAccount;
