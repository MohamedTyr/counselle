import type { PropsWithChildren } from "react";
import { Link } from "react-router";

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

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  const { hasAuthCheckError, retryAuthCheck } = useGuestAuthCheck();

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link
            className="mb-3 text-sm font-semibold text-foreground"
            to="/login"
          >
            Counselle
          </Link>
          <CardTitle render={<h1 />}>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
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
      </Card>
    </main>
  );
}
