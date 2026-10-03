import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import {
  authErrorMessage,
  confirmEmailReauthentication,
} from "@/api/http/auth";
import { authQueryKey, handleAccountChanged, useMe } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/ui/card";
import { AuthLayout } from "./AuthLayout";
import { AuthNotice } from "./AuthNotice";
export function ReauthenticateRoute() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const me = useMe();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => confirmEmailReauthentication(token!, me.data?.id),
    onError: (error) => {
      handleAccountChanged(error, client);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: authQueryKey }),
  });
  return (
    <AuthLayout
      title="Confirm your identity"
      description="Open this link in the browser where you requested it."
    >
      <CardPanel className="flex flex-col gap-4">
        {mutation.isSuccess ? (
          <AuthNotice>
            Your identity is confirmed. Return to account settings to retry your
            change.
          </AuthNotice>
        ) : (
          <>
            {(!token || mutation.isError) && (
              <AuthNotice error>
                {token
                  ? authErrorMessage(mutation.error)
                  : "This link is incomplete. Request a new one from account settings."}
              </AuthNotice>
            )}
            {me.isPending && <p role="status">Checking your session…</p>}
            {me.isError && (
              <>
                <AuthNotice error>
                  Could not check your session. Try again to confirm your
                  identity.
                </AuthNotice>
                <Button
                  loading={me.isFetching}
                  onClick={() => void me.refetch()}
                >
                  Retry
                </Button>
              </>
            )}
            {me.isSuccess && !me.data && (
              <AuthNotice>
                Sign in and request another confirmation link from account
                settings.
              </AuthNotice>
            )}
            {token && me.data && (
              <Button
                loading={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                Confirm identity
              </Button>
            )}
          </>
        )}
        <Link className="text-sm underline underline-offset-4" to="/account">
          Back to account settings
        </Link>
      </CardPanel>
    </AuthLayout>
  );
}
