import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { authErrorMessage, forgotPassword } from "@/api/http/auth";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthField } from "./AuthField";
import { AuthLayout } from "./AuthLayout";
import { AuthNotice } from "./AuthNotice";
import { useAuthConfig } from "./use-auth-config";

export function ForgotPasswordRoute() {
  const [email, setEmail] = useState("");
  const mutation = useMutation({
    mutationFn: () => forgotPassword(email.trim()),
  });
  const config = useAuthConfig();
  return (
    <AuthLayout
      title="Forgot password?"
      description="We’ll email you a link to get back into your account."
    >
      <CardPanel className="flex flex-col gap-4">
        {config.data?.auth?.password_reset_enabled === false ? (
          <AuthNotice>
            Password recovery is currently unavailable. Contact support for
            help.
          </AuthNotice>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!mutation.isPending) mutation.mutate();
            }}
          >
            <FieldGroup>
              {mutation.isSuccess && (
                <AuthNotice>
                  If an account exists for that email, you’ll receive
                  instructions shortly. Check your spam folder too.
                </AuthNotice>
              )}
              {mutation.isError && (
                <AuthNotice error>
                  {authErrorMessage(mutation.error)}
                </AuthNotice>
              )}
              <AuthField id="recovery-email" label="Email">
                <Input
                  required
                  type="email"
                  autoComplete="email"
                  id="recovery-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </AuthField>
              <Button loading={mutation.isPending} type="submit">
                {mutation.isSuccess ? "Send another link" : "Send reset link"}
              </Button>
            </FieldGroup>
          </form>
        )}
        <Link to="/login" className="text-sm underline underline-offset-4">
          Back to login
        </Link>
      </CardPanel>
    </AuthLayout>
  );
}
