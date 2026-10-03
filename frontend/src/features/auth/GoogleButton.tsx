import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  authErrorMessage,
  isAuthError,
  googleAuthorization,
  type GoogleMode,
} from "@/api/http/auth";
import { handleAccountChanged } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { useAuthConfig } from "@/features/auth/use-auth-config";

export function GoogleButton({
  mode = "login",
  next = "/app/ai",
  onReauthenticationRequired,
  expectedUserId,
}: {
  mode?: GoogleMode;
  expectedUserId?: string;
  next?: string;
  onReauthenticationRequired?: () => void;
}) {
  const config = useAuthConfig();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => googleAuthorization(mode, next, expectedUserId),
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => {
      if (handleAccountChanged(error, client)) return;
      if (
        isAuthError(error) &&
        ["REAUTHENTICATION_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(
          error.code,
        )
      )
        onReauthenticationRequired?.();
    },
  });
  if (!config.data?.auth?.google_enabled) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mode === "login"
          ? "Continue with Google"
          : mode === "associate"
            ? "Connect Google"
            : "Confirm with Google"}
      </Button>
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {authErrorMessage(mutation.error)}
        </p>
      )}
    </div>
  );
}
