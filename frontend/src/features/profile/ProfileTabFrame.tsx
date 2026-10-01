import type { ReactNode } from "react";

import { PROFILE_LAYOUT_CLASS } from "@/features/profile/profile-control-styles";

/** Documents and Memory in the Profile tab's geometry: what the tab is,
 * where the section rail would be, and the content where the section sheet
 * would be. */
export function ProfileTabFrame({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className={PROFILE_LAYOUT_CLASS}>
      <div className="flex flex-col gap-1.5 md:sticky md:top-6 md:px-3 md:pt-1">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
        <p className="text-xs leading-5 text-pretty text-[var(--ink-secondary)]">
          {description}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}
