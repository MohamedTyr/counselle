import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import {
  authErrorMessage,
  changeEmail,
  changePassword,
  deleteAccount,
  isAuthError,
  logoutAll,
  updateName,
  type MeData,
} from "@/api/http/auth";
import { isTransportError } from "@/api/http/errors";
import {
  authQueryKey,
  handleAccountChanged,
  discardPrivateQueryData,
  useMe,
  useLogout,
} from "@/app/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardPanel,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AuthField } from "@/features/auth/AuthField";
import { AuthNotice } from "@/features/auth/AuthNotice";
import { GoogleButton } from "@/features/auth/GoogleButton";
import { useAuthConfig } from "@/features/auth/use-auth-config";
import { PasswordInput } from "@/features/auth/PasswordInput";
import { ConfirmIdentity } from "./ConfirmIdentity";

export function AccountRoute() {
  const me = useMe();
  if (!me.data) return null;
  return <AccountSettings key={me.data.id} user={me.data} />;
}

function AccountSettings({ user }: { user: MeData }) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.pending_email ?? "");
  const [password, setPassword] = useState("");
  const config = useAuthConfig();
  const minimumLength = config.data?.auth?.password_min_length ?? 8;
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [notice, setNotice] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [identityRequest, setIdentityRequest] = useState(0);
  const client = useQueryClient();
  const navigate = useNavigate();
  const logout = useLogout();

  async function signedOut(message: string) {
    const currentOwner = client.getQueryData<MeData | null>(authQueryKey)?.id;
    if (currentOwner && currentOwner !== user.id) return;
    await discardPrivateQueryData(client);
    const ownerAfterDiscard = client.getQueryData<MeData | null>(
      authQueryKey,
    )?.id;
    if (ownerAfterDiscard && ownerAfterDiscard !== user.id) return;
    client.setQueryData(authQueryKey, null);
    navigate("/login", { replace: true, state: { notice: message } });
  }
  const action = useMutation({
    mutationFn: async ({
      run,
      success,
      signOut,
    }: {
      run: () => Promise<void>;
      success: string;
      signOut?: boolean;
    }) => {
      await run();
      if (signOut) await signedOut(success);
      else {
        await client.invalidateQueries({ queryKey: authQueryKey });
        setNotice(success);
      }
    },
    onMutate: () => {
      setNotice(undefined);
      setFormError(undefined);
    },
    onError: (error) => {
      if (handleAccountChanged(error, client)) return;
      setFormError(authErrorMessage(error));
      if (isTransportError(error) && error.kind === "unauthorized")
        void client.invalidateQueries({ queryKey: authQueryKey });
      if (
        isAuthError(error) &&
        ["REAUTHENTICATION_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(
          error.code,
        )
      )
        setIdentityRequest((request) => request + 1);
    },
  });
  function submit(run: () => Promise<void>, success: string, signOut = false) {
    if (!action.isPending) action.mutate({ run, success, signOut });
  }

  return (
    <main className="min-h-svh bg-background p-4 sm:p-8">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <Link className="text-sm underline underline-offset-4" to="/app/ai">
          Back to Acceptra
        </Link>
        <Card>
          <CardHeader>
            <CardTitle render={<h1 />}>Account and security</CardTitle>
            <CardDescription>
              Manage your details and how you sign in.
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-6">
            {notice && <AuthNotice>{notice}</AuthNotice>}
            {formError && <AuthNotice error>{formError}</AuthNotice>}
            {(user.reauthentication_required || identityRequest > 0) && (
              <>
                <ConfirmIdentity
                  focusOnRequest={identityRequest}
                  user={user}
                  onConfirmed={() => {
                    setIdentityRequest(0);
                    setFormError(undefined);
                    setNotice("Identity confirmed. You can retry your change.");
                  }}
                />
                <Separator />
              </>
            )}
            <section
              className="flex flex-col gap-4"
              aria-labelledby="account-profile-heading"
            >
              <h2 id="account-profile-heading" className="font-medium">
                Your details
              </h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit(
                    () => updateName(name.trim(), user.id),
                    "Your name was updated.",
                  );
                }}
              >
                <FieldGroup>
                  <AuthField id="account-name" label="Name">
                    <Input
                      required
                      maxLength={80}
                      id="account-name"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </AuthField>
                  <Button
                    type="submit"
                    variant="outline"
                    loading={action.isPending}
                  >
                    Save name
                  </Button>
                </FieldGroup>
              </form>
            </section>
            <Separator />
            <section
              className="flex flex-col gap-4"
              aria-labelledby="account-email-heading"
            >
              <h2 id="account-email-heading" className="font-medium">
                Email
              </h2>
              <p className="break-all text-sm">
                {user.email} · {user.is_verified ? "Verified" : "Not verified"}
              </p>
              {!user.is_verified && (
                <Link
                  to="/verify-email"
                  className="text-sm underline underline-offset-4"
                >
                  Verify your email
                </Link>
              )}
              {user.pending_email && (
                <AuthNotice>
                  Waiting for confirmation at {user.pending_email}. Your current
                  address remains active.
                </AuthNotice>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit(
                    () => changeEmail(email.trim(), user.id),
                    "Check your new inbox to confirm the change. Your current email stays active until then.",
                  );
                }}
              >
                <FieldGroup>
                  <AuthField
                    id="account-email"
                    label="New email"
                    description="Changing your email signs you out on all devices after confirmation."
                  >
                    <Input
                      required
                      id="account-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </AuthField>
                  <Button
                    variant="outline"
                    type="submit"
                    loading={action.isPending}
                  >
                    {user.pending_email
                      ? "Send another confirmation"
                      : "Change email"}
                  </Button>
                </FieldGroup>
              </form>
            </section>
            <Separator />
            <section
              className="flex flex-col gap-4"
              aria-labelledby="account-signin-heading"
            >
              <h2 id="account-signin-heading" className="font-medium">
                Sign-in methods
              </h2>
              <p className="text-sm">
                Google · {user.google_connected ? "Connected" : "Not connected"}
              </p>
              {!user.google_connected && !user.is_verified && (
                <Link
                  to="/verify-email"
                  className="text-sm underline underline-offset-4"
                >
                  Verify your email to connect Google
                </Link>
              )}
              {!user.google_connected && user.is_verified && (
                <GoogleButton
                  mode="associate"
                  expectedUserId={user.id}
                  next="/account"
                  onReauthenticationRequired={() =>
                    setIdentityRequest((request) => request + 1)
                  }
                />
              )}
              <p className="text-sm">
                Password · {user.has_password ? "Set" : "Not set"}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (password !== confirmation) {
                    setFormError("Passwords do not match.");
                    return;
                  }
                  submit(
                    () => changePassword(password, user.id),
                    "Password updated. Log in again with your new password.",
                    true,
                  );
                }}
              >
                <FieldGroup>
                  <AuthField
                    id="account-password"
                    label="New password"
                    description={`Use ${minimumLength}–128 characters. This signs you out on all devices.`}
                  >
                    <PasswordInput
                      required
                      minLength={minimumLength}
                      maxLength={128}
                      id="account-password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </AuthField>
                  <AuthField
                    id="account-confirm-password"
                    label="Confirm password"
                  >
                    <PasswordInput
                      required
                      id="account-confirm-password"
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </AuthField>
                  <Button
                    variant="outline"
                    loading={action.isPending}
                    type="submit"
                  >
                    {user.has_password ? "Change password" : "Add password"}
                  </Button>
                </FieldGroup>
              </form>
            </section>
            <Separator />
            <section
              className="flex flex-col gap-4"
              aria-labelledby="account-sessions-heading"
            >
              <h2 id="account-sessions-heading" className="font-medium">
                Sessions
              </h2>
              <Button
                variant="outline"
                loading={action.isPending || logout.isPending}
                onClick={() =>
                  submit(
                    () => logout.mutateAsync(),
                    "You’ve been signed out.",
                    true,
                  )
                }
              >
                Sign out on this device
              </Button>
              <Button
                variant="outline"
                loading={action.isPending}
                onClick={() =>
                  submit(
                    () => logoutAll(user.id),
                    "You’ve been signed out on all devices.",
                    true,
                  )
                }
              >
                Sign out everywhere
              </Button>
            </section>
            <Separator />
            <section
              className="flex flex-col gap-4"
              aria-labelledby="account-delete-heading"
            >
              <h2 id="account-delete-heading" className="font-medium">
                Delete account
              </h2>
              <p className="text-sm text-muted-foreground">
                Permanently delete your account and its saved chats, essays,
                schools, tasks, activities, and documents. This cannot be
                undone.
              </p>
              {deleting ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (deleteConfirmation === "DELETE")
                      submit(
                        () => deleteAccount(user.id),
                        "Your account has been deleted.",
                        true,
                      );
                  }}
                >
                  <FieldGroup>
                    <AuthField
                      id="delete-confirmation"
                      label="Type DELETE to confirm"
                    >
                      <Input
                        required
                        id="delete-confirmation"
                        autoComplete="off"
                        value={deleteConfirmation}
                        onChange={(event) =>
                          setDeleteConfirmation(event.target.value)
                        }
                      />
                    </AuthField>
                    <Button
                      variant="destructive"
                      loading={action.isPending}
                      disabled={deleteConfirmation !== "DELETE"}
                      type="submit"
                    >
                      Permanently delete account
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setDeleting(false);
                        setDeleteConfirmation("");
                      }}
                    >
                      Cancel
                    </Button>
                  </FieldGroup>
                </form>
              ) : (
                <Button variant="destructive" onClick={() => setDeleting(true)}>
                  Delete account
                </Button>
              )}
            </section>
            <a
              className="text-sm underline underline-offset-4"
              href="mailto:support@acceptra.ai"
            >
              Contact support
            </a>
          </CardPanel>
        </Card>
      </div>
    </main>
  );
}
