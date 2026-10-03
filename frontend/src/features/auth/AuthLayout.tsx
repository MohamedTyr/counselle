import { XIcon } from "lucide-react";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { Link } from "react-router";

import { useAuthConfig } from "@/features/auth/use-auth-config";
import { useGuestAuthCheck } from "@/app/auth/use-guest-auth-check";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AuthLayoutProps = PropsWithChildren<{
  title: string;
  description: string;
}>;

const DB_RESET_NOTICE_DISMISSED_KEY_PREFIX =
  "counselle:db-reset-notice-dismissed:";

function dbResetNoticeDismissedKey(date: string) {
  return `${DB_RESET_NOTICE_DISMISSED_KEY_PREFIX}${date}`;
}

/** `localStorage` is the only store a signed-out visitor has (plan §5.6);
 * a private window or blocked storage just re-shows the notice next visit
 * rather than failing dismissal. */
function isDbResetNoticeDismissed(date: string) {
  try {
    return window.localStorage.getItem(dbResetNoticeDismissedKey(date)) === "1";
  } catch {
    return false;
  }
}

function formatNoticeDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

/** The reset notice (Q14, plan §5.6). Read-only-history students and
 * never-registered visitors alike see `/login` and `/register` through
 * this one layout, so the copy stays third person and the instruction to
 * sign up again stays conditional — it is never "your account is gone." */
function DbResetNotice({ date }: { date: string }) {
  const [dismissed, setDismissed] = useState(() =>
    isDbResetNoticeDismissed(date),
  );

  if (dismissed) {
    return null;
  }

  function dismiss() {
    try {
      window.localStorage.setItem(dbResetNoticeDismissedKey(date), "1");
    } catch {
      // Same private-storage fallback as the read above.
    }
    setDismissed(true);
  }

  return (
    <div
      className="mx-6 mb-4 flex items-start justify-between gap-2 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground"
      role="status"
    >
      <p>
        Counselle&rsquo;s database was rebuilt on {formatNoticeDate(date)}.
        Nothing from before then was carried over — accounts, chats, college
        lists, essays, tasks, activities, honors, student profiles and uploaded
        documents are all gone. If you had an account before then, please sign
        up again.
      </p>
      <Button
        aria-label="Dismiss"
        className="shrink-0"
        onClick={dismiss}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </div>
  );
}

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  const { hasAuthCheckError, retryAuthCheck } = useGuestAuthCheck();
  // Unauthenticated by design (plan §5.6): this notice's whole audience has
  // no account any more, so it can never ride the authed `/config`.
  const publicConfig = useAuthConfig();
  const dbResetNoticeDate = publicConfig.data?.db_reset_notice_date;

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link
            className="mb-3 text-sm font-semibold text-foreground"
            to="/login"
          >
            Acceptra
          </Link>
          <CardTitle render={<h1 />}>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {dbResetNoticeDate ? <DbResetNotice date={dbResetNoticeDate} /> : null}
        {hasAuthCheckError && (
          <div className="mx-6 mb-4 flex flex-col gap-2 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
            <p role="alert">Could not check your current session.</p>
            <Button
              className="self-start"
              onClick={retryAuthCheck}
              size="xs"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        )}
        {children}
        <p className="px-6 pb-6 text-center text-sm text-muted-foreground">
          Need help?{" "}
          <a
            className="underline underline-offset-4"
            href={`mailto:${publicConfig.data?.auth?.support_email ?? "support@acceptra.ai"}`}
          >
            Contact support
          </a>
        </p>
      </Card>
    </main>
  );
}
