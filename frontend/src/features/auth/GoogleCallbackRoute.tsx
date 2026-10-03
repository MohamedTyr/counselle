import { Link, Navigate, useSearchParams } from "react-router";
import { useMe } from "@/app/auth";
import { safeAuthPath } from "@/app/auth/redirects";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/ui/card";
import { AuthLayout } from "./AuthLayout";
import { AuthNotice } from "./AuthNotice";
import { GoogleButton } from "./GoogleButton";
const messages: Record<string, string> = {
  email_not_verified: "Verify your Acceptra email before connecting Google.",
  oauth_cancelled:
    "Google sign-in was cancelled. You can try again whenever you’re ready.",
  account_exists:
    "You already have an Acceptra account with this email. Log in with your existing method, then connect Google in account settings.",
  oauth_identity_mismatch:
    "Choose the Google account already connected to your Acceptra account.",
  oauth_invalid_state: "This sign-in attempt expired. Please start again.",
  signup_disabled:
    "New accounts are currently unavailable. Contact support for help.",
  recent_auth_required:
    "Confirm your identity in account settings, then connect Google.",
  oauth_reauth_required:
    "Google could not confirm a recent sign-in. Return to account settings and confirm your identity by email.",
};
export function GoogleCallbackRoute() {
  const [params] = useSearchParams();
  const error = params.get("error");
  const next = safeAuthPath(params.get("next"));
  const me = useMe();
  if (!error && me.data) return <Navigate replace to={next} />;
  return (
    <AuthLayout
      title={error ? "Google sign-in" : "Finishing sign-in"}
      description="Return to your Acceptra account."
    >
      <CardPanel className="flex flex-col gap-4">
        {error ? (
          <AuthNotice error>
            {messages[error] ??
              "Google sign-in could not be completed. Please try again."}
          </AuthNotice>
        ) : me.isPending ? (
          <p role="status">Checking your session…</p>
        ) : (
          <AuthNotice error>We could not confirm your session.</AuthNotice>
        )}
        {!error && (
          <Button
            variant="outline"
            loading={me.isFetching}
            onClick={() => void me.refetch()}
          >
            Check again
          </Button>
        )}
        {error && next !== "/account" && <GoogleButton next={next} />}
        <Link
          className="text-sm underline underline-offset-4"
          to={next === "/account" ? "/account" : "/login"}
          state={{
            from: {
              pathname: next.split(/[?#]/)[0],
              search: new URL(next, window.location.origin).search,
              hash: new URL(next, window.location.origin).hash,
            },
          }}
        >
          {next === "/account"
            ? "Back to account settings"
            : "Log in with email"}
        </Link>
        {error === "email_not_verified" && (
          <Link to="/verify-email">Verify your email</Link>
        )}
        {error === "account_exists" && (
          <Link to="/forgot-password">Forgot password?</Link>
        )}
      </CardPanel>
    </AuthLayout>
  );
}
