// Vendored from upstream client/src/components/Auth/Registration.tsx @ 197a1dc4
// Subtractions: username field (PRD story 4: name+email+password only),
//   Turnstile captcha, invite-token query param, the 3-s success-countdown +
//   email-verification alert.
// Rewire (B5b): submit → real register() then auto-login() with the same creds
//   (register does NOT set a session), then invalidate `me` so the AuthGate
//   lands the user in the app. Existing-email / weak-password / rate-limit
//   failures render inline. Form layout/markup byte-identical.
import { useForm } from 'react-hook-form';
import React, { useState } from 'react';
import { SecretInput, Spinner, Button } from '@librechat/client';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { loginPage } from 'librechat-data-provider';
import type { TRegisterUser } from 'librechat-data-provider';
import type { TLoginLayoutContext } from '~/common';
import { useLocalize, TranslationKeys } from '~/hooks';
import { authErrorMessage } from '@/api/http/auth';
import { useLogin, useRegister } from '@/app/auth';

const Registration: React.FC = () => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const loginMutation = useLogin();
  const { startupConfig, startupConfigError, isFetching } = useOutletContext<TLoginLayoutContext>();

  const {
    watch,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TRegisterUser>({ mode: 'onChange' });
  const password = watch('password');

  // Drive the busy state off the mutations themselves so it can't stick if a
  // handler returns early (FIX 2) — no manual `isSubmitting` flag to reset.
  const isSubmitting = registerMutation.isLoading || loginMutation.isLoading;
  const [submitError, setSubmitError] = useState<string | null>(null);

  const authInputClassName =
    'webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 hover:border-border-light focus:border-green-500 focus:outline-none focus-visible:border-green-500';
  const authSecretInputClassName = `${authInputClassName} h-auto pr-12`;
  const authLabelClassName =
    'absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-1.5 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-green-500 rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4';
  const authSecretButtonClassName =
    'size-9 rounded-xl text-text-secondary-alt hover:bg-transparent hover:text-text-primary';

  const onRegister = async (data: TRegisterUser) => {
    setSubmitError(null);

    // Step 1 — create the account. On failure (existing email / weak password /
    // rate-limit) show it inline and stop. The account does NOT exist.
    try {
      await registerMutation.mutateAsync({
        name: data.name,
        email: data.email,
        password: data.password,
      });
    } catch (error: unknown) {
      setSubmitError(authErrorMessage(error));
      return;
    }

    // The account now exists. Clear the form so the plaintext password doesn't
    // linger in form state past the point it's needed.
    reset();

    // Step 2 — auto-login with the same creds (register sets no session). If
    // THIS fails, the account is already created: don't strand the student with
    // a cryptic login error — tell them it worked and send them to /login.
    // Re-registering would 409, so /login is the only correct path forward.
    try {
      await loginMutation.mutateAsync({ email: data.email, password: data.password });
      // On success the `me` invalidation flips the AuthGate; Startup → '/'.
    } catch {
      navigate('/login', {
        replace: true,
        state: { notice: 'Your account was created — please log in.' },
      });
    }
  };

  const renderInput = (id: string, label: TranslationKeys, type: string, validation: object) => {
    const fieldLabel = localize(label);
    const field = register(id as 'name' | 'email' | 'password' | 'confirm_password', validation);

    return (
      <div className="mb-4">
        <div className="relative">
          {type === 'password' ? (
            <SecretInput
              id={id}
              autoComplete={id}
              aria-label={fieldLabel}
              {...field}
              aria-invalid={!!errors[id]}
              className={authSecretInputClassName}
              placeholder=" "
              data-testid={id}
              label={fieldLabel}
              labelClassName={authLabelClassName}
              controlsClassName="right-2"
              buttonClassName={authSecretButtonClassName}
            />
          ) : (
            <>
              <input
                id={id}
                type={type}
                autoComplete={id}
                aria-label={fieldLabel}
                {...field}
                aria-invalid={!!errors[id]}
                className={authInputClassName}
                placeholder=" "
                data-testid={id}
              />
              <label htmlFor={id} className={authLabelClassName}>
                {fieldLabel}
              </label>
            </>
          )}
        </div>
        {errors[id] && (
          <span role="alert" className="mt-1 text-sm text-red-500">
            {String(errors[id]?.message) ?? ''}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      {!startupConfigError && !isFetching && (
        <>
          {submitError != null && (
            <div role="alert" className="mt-4 text-sm text-red-600 dark:text-red-500">
              {submitError}
            </div>
          )}
          <form
            className="mt-6"
            aria-label="Registration form"
            method="POST"
            onSubmit={handleSubmit((data: TRegisterUser) => onRegister(data))}
          >
            {renderInput('name', 'com_auth_full_name', 'text', {
              required: localize('com_auth_name_required'),
              minLength: {
                value: 3,
                message: localize('com_auth_name_min_length'),
              },
              maxLength: {
                value: 80,
                message: localize('com_auth_name_max_length'),
              },
            })}
            {renderInput('email', 'com_auth_email', 'email', {
              required: localize('com_auth_email_required'),
              minLength: {
                value: 1,
                message: localize('com_auth_email_min_length'),
              },
              maxLength: {
                value: 120,
                message: localize('com_auth_email_max_length'),
              },
              pattern: {
                value: /\S+@\S+\.\S+/,
                message: localize('com_auth_email_pattern'),
              },
            })}
            {renderInput('password', 'com_auth_password', 'password', {
              required: localize('com_auth_password_required'),
              minLength: {
                value: startupConfig?.minPasswordLength || 8,
                message: localize('com_auth_password_min_length'),
              },
              maxLength: {
                value: 128,
                message: localize('com_auth_password_max_length'),
              },
            })}
            {renderInput('confirm_password', 'com_auth_password_confirm', 'password', {
              validate: (value: string) =>
                value === password || localize('com_auth_password_not_match'),
            })}

            <div className="mt-6">
              <Button
                disabled={Object.keys(errors).length > 0 || isSubmitting}
                type="submit"
                aria-label="Submit registration"
                variant="submit"
                className="h-12 w-full rounded-2xl"
              >
                {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
              </Button>
            </div>
          </form>

          <p className="my-4 text-center text-sm font-light text-gray-700 dark:text-white">
            {localize('com_auth_already_have_account')}{' '}
            <a
              href={loginPage()}
              aria-label="Login"
              className="inline-flex p-1 text-sm font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            >
              {localize('com_auth_login')}
            </a>
          </p>
        </>
      )}
    </>
  );
};

export default Registration;
