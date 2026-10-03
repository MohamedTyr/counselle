import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  authErrorMessage,
  reauthenticate,
  requestEmailReauthentication,
  type MeData,
} from "@/api/http/auth";
import { authQueryKey, handleAccountChanged } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { AuthField } from "@/features/auth/AuthField";
import { AuthNotice } from "@/features/auth/AuthNotice";
import { PasswordInput } from "@/features/auth/PasswordInput";
export function ConfirmIdentity({
  user,
  onConfirmed,
  focusOnRequest = false,
}: {
  user: MeData;
  onConfirmed: () => void;
  focusOnRequest?: boolean | number;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusOnRequest) {
      sectionRef.current?.focus();
      sectionRef.current?.scrollIntoView?.({ block: "center" });
    }
  }, [focusOnRequest]);
  const [password, setPassword] = useState("");
  const client = useQueryClient();
  const emailMutation = useMutation({
    mutationFn: () => requestEmailReauthentication(user.id),
    onError: (error) => {
      handleAccountChanged(error, client);
    },
  });
  const mutation = useMutation({
    mutationFn: () => reauthenticate(password, user.id),
    onError: (error) => {
      handleAccountChanged(error, client);
    },
    onSuccess: async () => {
      setPassword("");
      await client.invalidateQueries({
        queryKey: authQueryKey,
      });
      onConfirmed();
    },
  });
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Confirm identity"
      className="flex flex-col gap-4"
    >
      <h2 className="font-medium">Confirm your identity</h2>
      <p className="text-sm text-muted-foreground">
        For account security, confirm your identity before changing sign-in
        details or deleting your account. Then retry your change.
      </p>
      {user.has_password && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending) mutation.mutate();
          }}
        >
          <FieldGroup>
            {mutation.isError && (
              <AuthNotice error>{authErrorMessage(mutation.error)}</AuthNotice>
            )}
            <AuthField id="reauth-password" label="Current password">
              <PasswordInput
                required
                autoComplete="current-password"
                id="reauth-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </AuthField>
            <Button type="submit" loading={mutation.isPending}>
              Confirm identity
            </Button>
            <Link
              to="/forgot-password"
              className="text-sm underline underline-offset-4"
            >
              Forgot password?
            </Link>
          </FieldGroup>
        </form>
      )}
      {user.is_verified && (
        <>
          <Button
            variant={user.has_password ? "outline" : "default"}
            loading={emailMutation.isPending}
            onClick={() => emailMutation.mutate()}
          >
            Confirm identity by email
          </Button>
          {emailMutation.isSuccess && (
            <AuthNotice>
              Check your inbox for a confirmation link. Open it in this browser
              to continue.
            </AuthNotice>
          )}
          {emailMutation.isError && (
            <AuthNotice error>
              {authErrorMessage(emailMutation.error)}
            </AuthNotice>
          )}
        </>
      )}
    </section>
  );
}
