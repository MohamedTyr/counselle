import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { authErrorMessage, confirmEmail } from "@/api/http/auth";
import { authQueryKey, discardPrivateQueryData } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/ui/card";
import { AuthLayout } from "./AuthLayout";
import { AuthNotice } from "./AuthNotice";
export function ConfirmEmailRoute() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => confirmEmail(token!),
    onSuccess: async () => {
      await discardPrivateQueryData(client);
      client.setQueryData(authQueryKey, null);
    },
  });
  return (
    <AuthLayout
      title="Confirm your new email"
      description="Your existing address stays active until you confirm this change."
    >
      <CardPanel className="flex flex-col gap-4">
        {mutation.isSuccess ? (
          <>
            <AuthNotice>
              Your email was updated. Log in with your new address.
            </AuthNotice>
            <Link to="/login">Log in</Link>
          </>
        ) : (
          <>
            {(!token || mutation.isError) && (
              <AuthNotice error>
                {token
                  ? authErrorMessage(mutation.error)
                  : "This link is incomplete. Request another from account settings."}
              </AuthNotice>
            )}
            {token && (
              <Button
                loading={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                Confirm new email
              </Button>
            )}
            <Link
              className="text-sm underline underline-offset-4"
              to="/account"
            >
              Request another link in account settings
            </Link>
          </>
        )}
      </CardPanel>
    </AuthLayout>
  );
}
