import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  authErrorMessage,
  requestVerification,
  verifyEmail,
} from "@/api/http/auth";
import { authQueryKey, useLogout, useMe } from "@/app/auth";
import { safeAuthDestination } from "@/app/auth/redirects";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthField } from "./AuthField";
import { AuthLayout } from "./AuthLayout";
import { AuthNotice } from "./AuthNotice";

export function VerifyEmailRoute() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const location = useLocation();
  const me = useMe();
  const client = useQueryClient();
  const logout = useLogout();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const verification = useMutation({
    mutationFn: () => verifyEmail(token!),
    onSuccess: () => client.invalidateQueries({ queryKey: authQueryKey }),
  });
  const resend = useMutation({
    mutationFn: () => requestVerification(me.data?.email ?? email.trim()),
  });
  const verified = token ? verification.isSuccess : me.data?.is_verified;
  const confirmedUser = token ? verification.data : me.data;
  const sameAccount = Boolean(me.data && confirmedUser?.id === me.data.id);
  return (
    <AuthLayout
      title="Verify your email"
      description={
        verified
          ? "You’re ready to continue."
          : "Confirm your email before using Acceptra’s AI."
      }
    >
      <CardPanel className="flex flex-col gap-4">
        {verified ? (
          <>
            <AuthNotice>
              {confirmedUser?.email
                ? `${confirmedUser.email} is verified.`
                : "Your email is verified."}
            </AuthNotice>
            {me.data && !sameAccount ? (
              <>
                <p className="text-sm">
                  You’re currently signed in as {me.data.email}. Switch accounts
                  to use the email you just verified.
                </p>
                {logout.isError && (
                  <AuthNotice error>
                    {authErrorMessage(logout.error)}
                  </AuthNotice>
                )}
                <Button
                  loading={logout.isPending}
                  onClick={() =>
                    logout.mutate(undefined, {
                      onSuccess: () => navigate("/login", { replace: true }),
                    })
                  }
                >
                  Sign out and switch accounts
                </Button>
              </>
            ) : (
              <Button
                render={
                  <Link
                    to={
                      sameAccount
                        ? safeAuthDestination(location.state)
                        : "/login"
                    }
                  />
                }
              >
                {sameAccount ? "Continue" : "Log in"}
              </Button>
            )}
          </>
        ) : (
          <>
            {verification.isError && (
              <AuthNotice error>
                {authErrorMessage(verification.error)}
              </AuthNotice>
            )}
            {token && (
              <Button
                loading={verification.isPending}
                onClick={() => verification.mutate()}
              >
                Verify email
              </Button>
            )}
            <p className="text-sm text-muted-foreground">
              {me.data
                ? `Open the verification email sent to ${me.data.email}.`
                : "Enter your account email to request a verification link."}{" "}
              Check your spam folder if it hasn’t arrived.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!resend.isPending) resend.mutate();
              }}
            >
              <FieldGroup>
                {!me.data && (
                  <AuthField id="verify-email" label="Email">
                    <Input
                      required
                      id="verify-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </AuthField>
                )}
                {resend.isSuccess && (
                  <AuthNotice>
                    If your account needs verification, a link will arrive
                    shortly.
                  </AuthNotice>
                )}
                {resend.isError && (
                  <AuthNotice error>
                    {authErrorMessage(resend.error)}
                  </AuthNotice>
                )}
                <Button
                  variant="outline"
                  type="submit"
                  loading={resend.isPending}
                >
                  Resend verification email
                </Button>
              </FieldGroup>
            </form>
            {me.data ? (
              <Link
                to="/account"
                className="text-sm underline underline-offset-4"
              >
                Wrong email? Update it in account settings
              </Link>
            ) : (
              <Link
                to="/login"
                className="text-sm underline underline-offset-4"
              >
                Back to login
              </Link>
            )}
          </>
        )}
      </CardPanel>
    </AuthLayout>
  );
}
