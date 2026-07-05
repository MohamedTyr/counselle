import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  title: string;
};

export function PageHeader({ actions, className, title }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "relative -mx-6 flex items-center px-6 py-4 md:-mx-10 md:px-10",
        className,
      )}
    >
      <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-xl leading-none font-semibold tracking-tight">
            {title}
          </h1>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            {actions}
          </div>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 right-5 border-b"
      />
    </div>
  );
}
