// Vendored from upstream client/src/components/Auth/LoginForm.tsx @ 197a1dc4
// Subtractions: Turnstile captcha, resend-verification-email block (no email
//   verification — PRD story 4), LDAP username login, useGetStartupConfig.
// Rewire (B5b): onSubmit → real form-encoded login() then invalidate `me`
//   (the router lands the now-signed-in user in the app); a 400/429/network
//   failure renders inline ("Incorrect email or password.") and keeps the form.
//   Form layout/markup byte-identical.
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { SecretInput, Spinner, Button } from '@librechat/client';
import type { TLoginUser, TStartupConfig } from 'librechat-data-provider';
import { validateEmail } from '~/utils';
import { useLocalize } from '~/hooks';
import { authErrorMessage } from '@/api/http/auth';
import { useLogin } from '@/app/auth';

type TLoginFormProps = {
  startupConfig: TStartupConfig;
};

const LoginForm: React.FC<TLoginFormProps> = ({ startupConfig }) => {
  const localize = useLocalize();
  const loginMutation = useLogin();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TLoginUser>();

  const authInputClassName =
    'webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 hover:border-border-light focus:border-green-500 focus:outline-none focus-visible:border-green-500';
  const authSecretInputClassName = `${authInputClassName} h-auto pr-12`;
  const authLabelClassName =
    'absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-1.5 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-green-600 dark:peer-focus:text-green-500 rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4';
  const authSecretButtonClassName =
    'size-9 rounded-xl text-text-secondary-alt hover:bg-transparent hover:text-text-primary';

  if (!startupConfig) {
    return null;
  }

  const renderError = (fieldName: string) => {
    const errorMessage = errors[fieldName]?.message;
    return errorMessage ? (
      <span role="alert" className="mt-1 text-sm text-red-600 dark:text-red-500">
        {String(errorMessage)}
      </span>
    ) : null;
  };

  const onSubmit = async (data: TLoginUser) => {
    setSubmitError(null);
    try {
      await loginMutation.mutateAsync({ email: data.email, password: data.password });
      // On success the `me` query invalidates; the AuthGate re-renders into the
      // app and Startup's effect redirects away from /login.
    } catch (error: unknown) {
      setSubmitError(authErrorMessage(error));
    }
  };

  const isBusy = isSubmitting || loginMutation.isLoading;

  return (
    <>
      {submitError != null && (
        <div role="alert" className="mt-4 text-sm text-red-600 dark:text-red-500">
          {submitError}
        </div>
      )}
      <form
        className="mt-6"
        aria-label="Login form"
        method="POST"
        onSubmit={handleSubmit((data) => onSubmit(data))}
      >
        <div className="mb-4">
          <div className="relative">
            <input
              type="text"
              id="email"
              autoComplete="email"
              aria-label={localize('com_auth_email')}
              {...register('email', {
                required: localize('com_auth_email_required'),
                maxLength: { value: 120, message: localize('com_auth_email_max_length') },
                validate: (value) => validateEmail(value, localize('com_auth_email_pattern')),
              })}
              aria-invalid={!!errors.email}
              className={authInputClassName}
              placeholder=" "
            />
            <label htmlFor="email" className={authLabelClassName}>
              {localize('com_auth_email_address')}
            </label>
          </div>
          {renderError('email')}
        </div>
        <div className="mb-2">
          <div className="relative">
            <SecretInput
              id="password"
              autoComplete="current-password"
              aria-label={localize('com_auth_password')}
              {...register('password', {
                required: localize('com_auth_password_required'),
                minLength: {
                  value: startupConfig?.minPasswordLength || 8,
                  message: localize('com_auth_password_min_length'),
                },
                maxLength: { value: 128, message: localize('com_auth_password_max_length') },
              })}
              aria-invalid={!!errors.password}
              className={authSecretInputClassName}
              placeholder=" "
              label={localize('com_auth_password')}
              labelClassName={authLabelClassName}
              controlsClassName="right-2"
              buttonClassName={authSecretButtonClassName}
            />
          </div>
          {renderError('password')}
        </div>
        {startupConfig.passwordResetEnabled && (
          <a
            href="/forgot-password"
            className="inline-flex p-1 text-sm font-medium text-green-600 underline decoration-transparent transition-all duration-200 hover:text-green-700 hover:decoration-green-700 focus:text-green-700 focus:decoration-green-700 dark:text-green-500 dark:hover:text-green-400 dark:hover:decoration-green-400 dark:focus:text-green-400 dark:focus:decoration-green-400"
          >
            {localize('com_auth_password_forgot')}
          </a>
        )}

        <div className="mt-6">
          <Button
            aria-label={localize('com_auth_continue')}
            data-testid="login-button"
            type="submit"
            disabled={isBusy}
            variant="submit"
            className="h-12 w-full rounded-2xl"
          >
            {isBusy ? <Spinner /> : localize('com_auth_continue')}
          </Button>
        </div>
      </form>
    </>
  );
};

export default LoginForm;
