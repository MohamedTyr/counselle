import type React from "react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { authQueryKey, useLogin } from "@/app/auth";
import {
  noticeFromLocationState,
  safeAuthDestination,
} from "@/app/auth/redirects";
import { authErrorMessage, fetchMe } from "@/api/http/auth";
import { Button } from "@/components/ui/button";
import { CardFooter, CardPanel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { AuthField } from "@/features/auth/AuthField";
import { describedBy } from "@/features/auth/auth-field-ids";
import {
  hasErrors,
  validateLogin,
  type LoginFormState,
} from "@/features/auth/auth-validation";

type LoginTouched = Partial<Record<keyof LoginFormState, boolean>>;

const initialValues: LoginFormState = { email: "", password: "" };

export function LoginRoute() {
  const [values, setValues] = useState<LoginFormState>(initialValues);
  const [touched, setTouched] = useState<LoginTouched>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const notice = noticeFromLocationState(location.state);
  const errors = validateLogin(values);

  const visibleError = (field: keyof LoginFormState) =>
    submitted || touched[field] ? errors[field] : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setFormError(undefined);
    if (hasErrors(errors)) {
      return;
    }

    try {
      await loginMutation.mutateAsync({
        email: values.email.trim(),
        password: values.password,
      });
      setValues((current) => ({ ...current, password: "" }));
      const user = await queryClient.fetchQuery({
        queryKey: authQueryKey,
        queryFn: fetchMe,
        staleTime: 0,
      });
      if (!user) {
        setFormError("We could not confirm your session. Please try again.");
        return;
      }
      navigate(safeAuthDestination(location.state), { replace: true });
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  return (
    <AuthLayout
      description="Use your Counselle account to continue."
      title="Log in"
    >
      <CardPanel>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {notice && (
            <p className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          {formError && (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}
          <AuthField
            id="login-email"
            label="Email"
            error={visibleError("email")}
          >
            <Input
              aria-describedby={describedBy(
                "login-email",
                undefined,
                visibleError("email"),
              )}
              aria-invalid={Boolean(visibleError("email"))}
              autoComplete="email"
              id="login-email"
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
            id="login-password"
            label="Password"
            error={visibleError("password")}
          >
            <Input
              aria-describedby={describedBy(
                "login-password",
                undefined,
                visibleError("password"),
              )}
              aria-invalid={Boolean(visibleError("password"))}
              autoComplete="current-password"
              id="login-password"
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
          <Button loading={loginMutation.isPending} type="submit">
            Log in
          </Button>
        </form>
      </CardPanel>
      <Separator />
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <span>New here?</span>
        <Link
          className="ml-1 font-medium text-foreground"
          state={location.state}
          to="/register"
        >
          Create account
        </Link>
      </CardFooter>
    </AuthLayout>
  );
}
