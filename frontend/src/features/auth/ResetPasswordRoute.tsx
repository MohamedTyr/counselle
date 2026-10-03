import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { authErrorMessage, resetPassword } from "@/api/http/auth";
import { authQueryKey, discardPrivateQueryData } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { AuthField } from "./AuthField";
import { AuthLayout } from "./AuthLayout";
import { AuthNotice } from "./AuthNotice";
import { useAuthConfig } from "@/features/auth/use-auth-config";
import { PasswordInput } from "./PasswordInput";

export function ResetPasswordRoute() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const config = useAuthConfig();
  const minimumLength = config.data?.auth?.password_min_length ?? 8;
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => resetPassword(token!, password),
    onSuccess: async () => {
      setPassword("");
      setConfirmation("");
      await discardPrivateQueryData(client);
      client.setQueryData(authQueryKey, null);
    },
  });
  return (
    <AuthLayout
      title="Reset password"
      description="Choose a new password for your Acceptra account."
    >
      <CardPanel className="flex flex-col gap-4">
        {mutation.isSuccess ? (
          <>
            <AuthNotice>
              Your password was reset. You’ve been signed out on all devices.
            </AuthNotice>
            <Link to="/login">Log in</Link>
          </>
        ) : token ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending) return;
              if (password !== confirmation) {
                setError("Passwords do not match.");
                return;
              }
              setError(undefined);
              mutation.mutate();
            }}
          >
            <FieldGroup>
              {(error || mutation.isError) && (
                <AuthNotice error>
                  {error ?? authErrorMessage(mutation.error)}
                </AuthNotice>
              )}
              <AuthField
                id="reset-password"
                label="New password"
                description={`Use ${minimumLength}–128 characters.`}
              >
                <PasswordInput
                  required
                  minLength={minimumLength}
                  maxLength={128}
                  autoComplete="new-password"
                  id="reset-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </AuthField>
              <AuthField id="reset-confirm" label="Confirm password">
                <PasswordInput
                  required
                  autoComplete="new-password"
                  id="reset-confirm"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </AuthField>
              <Button type="submit" loading={mutation.isPending}>
                Reset password
              </Button>
            </FieldGroup>
          </form>
        ) : (
          <AuthNotice error>
            This reset link is incomplete. Request a new one.
          </AuthNotice>
        )}
        {!mutation.isSuccess && (
          <Link
            className="text-sm underline underline-offset-4"
            to="/forgot-password"
          >
            Request a new reset link
          </Link>
        )}
      </CardPanel>
    </AuthLayout>
  );
}
