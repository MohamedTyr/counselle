import type React from "react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  authQueryKey,
  isAccountCreatedLoginError,
  useRegisterAndLogin,
} from "@/app/auth";
import { safeAuthDestination } from "@/app/auth/redirects";
import { authErrorMessage, fetchMe } from "@/api/http/auth";
import { Button } from "@/components/ui/button";
import { CardFooter, CardPanel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { FieldGroup } from "@/components/ui/field";
import { PasswordInput } from "@/features/auth/PasswordInput";
import { GoogleButton } from "@/features/auth/GoogleButton";
import { authDestinationPath } from "@/app/auth/redirects";
import { AuthField } from "@/features/auth/AuthField";
import { AuthNotice } from "./AuthNotice";
import { useAuthConfig } from "./use-auth-config";
import { describedBy } from "@/features/auth/auth-field-ids";
import {
  hasErrors,
  validateRegister,
  type RegisterFormState,
} from "@/features/auth/auth-validation";

type RegisterTouched = Partial<Record<keyof RegisterFormState, boolean>>;

const initialValues: RegisterFormState = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export function RegisterRoute() {
  const [values, setValues] = useState<RegisterFormState>(initialValues);
  const [touched, setTouched] = useState<RegisterTouched>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const registerMutation = useRegisterAndLogin();
  const config = useAuthConfig();
  const minimumLength = config.data?.auth?.password_min_length ?? 8;
  const errors = validateRegister(values, minimumLength);

  const visibleError = (field: keyof RegisterFormState) =>
    submitted || touched[field] ? errors[field] : undefined;

  function clearPasswords() {
    setValues((current) => ({
      ...current,
      password: "",
      confirmPassword: "",
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    /* `Button`'s busy state is `aria-disabled`, not the native attribute, so
     * it no longer suppresses implicit submission — Enter in a field can still
     * reach here while the first request is in flight. */
    if (registerMutation.isPending) {
      return;
    }
    setSubmitted(true);
    setFormError(undefined);
    if (hasErrors(errors)) {
      return;
    }

    try {
      await registerMutation.mutateAsync({
        email: values.email.trim(),
        name: values.name.trim(),
        password: values.password,
      });
      clearPasswords();
      const user = await queryClient.fetchQuery({
        queryKey: authQueryKey,
        queryFn: fetchMe,
        staleTime: 0,
      });
      if (!user) {
        navigate("/login", {
          replace: true,
          state: { notice: "Your account was created. Please log in." },
        });
        return;
      }
      navigate(
        user.is_verified
          ? safeAuthDestination(location.state)
          : "/verify-email",
        { replace: true, state: location.state },
      );
    } catch (error) {
      if (isAccountCreatedLoginError(error)) {
        clearPasswords();
        navigate("/login", {
          replace: true,
          state: { notice: "Your account was created. Please log in." },
        });
        return;
      }
      setFormError(authErrorMessage(error));
    }
  }

  if (config.data?.auth?.signup_enabled === false)
    return (
      <AuthLayout
        title="Create account"
        description="New accounts are currently unavailable."
      >
        <CardPanel>
          <AuthNotice>
            Contact support for help, or{" "}
            <Link to="/login">log in to your existing account</Link>.
          </AuthNotice>
        </CardPanel>
      </AuthLayout>
    );

  return (
    <AuthLayout
      description="Create the student account for this workspace."
      title="Create account"
    >
      <CardPanel className="flex flex-col gap-4">
        <GoogleButton next={authDestinationPath(location.state)} />
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {formError && (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            <AuthField
              id="register-name"
              label="Name"
              error={visibleError("name")}
            >
              <Input
                aria-describedby={describedBy(
                  "register-name",
                  undefined,
                  visibleError("name"),
                )}
                aria-invalid={Boolean(visibleError("name"))}
                autoComplete="name"
                id="register-name"
                onBlur={() =>
                  setTouched((current) => ({ ...current, name: true }))
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                type="text"
                value={values.name}
              />
            </AuthField>
            <AuthField
              id="register-email"
              label="Email"
              error={visibleError("email")}
            >
              <Input
                aria-describedby={describedBy(
                  "register-email",
                  undefined,
                  visibleError("email"),
                )}
                aria-invalid={Boolean(visibleError("email"))}
                autoComplete="email"
                id="register-email"
                onBlur={() =>
                  setTouched((current) => ({ ...current, email: true }))
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                type="email"
                value={values.email}
              />
            </AuthField>
            <AuthField
              id="register-password"
              label="Password"
              description={`Use ${minimumLength}–128 characters. A longer passphrase is easier to remember.`}
              error={visibleError("password")}
            >
              <PasswordInput
                aria-describedby={describedBy(
                  "register-password",
                  undefined,
                  visibleError("password"),
                )}
                aria-invalid={Boolean(visibleError("password"))}
                autoComplete="new-password"
                id="register-password"
                onBlur={() =>
                  setTouched((current) => ({ ...current, password: true }))
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                type="password"
                value={values.password}
              />
            </AuthField>
            <AuthField
              id="register-confirm-password"
              label="Confirm password"
              error={visibleError("confirmPassword")}
            >
              <PasswordInput
                aria-describedby={describedBy(
                  "register-confirm-password",
                  undefined,
                  visibleError("confirmPassword"),
                )}
                aria-invalid={Boolean(visibleError("confirmPassword"))}
                autoComplete="new-password"
                id="register-confirm-password"
                onBlur={() =>
                  setTouched((current) => ({
                    ...current,
                    confirmPassword: true,
                  }))
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    confirmPassword: event.target.value,
                  }))
                }
                type="password"
                value={values.confirmPassword}
              />
            </AuthField>
            <Button loading={registerMutation.isPending} type="submit">
              Create account
            </Button>
          </FieldGroup>
        </form>
      </CardPanel>
      <Separator />
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <span>Already have an account?</span>
        <Link
          className="ml-1 font-medium text-foreground"
          state={location.state}
          to="/login"
        >
          Log in
        </Link>
      </CardFooter>
    </AuthLayout>
  );
}
