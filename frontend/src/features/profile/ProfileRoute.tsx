import { CompassIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import type { ProfilePatch } from "@/api/workspace/types";
import {
  useDocuments,
  useMemories,
  useProfile,
  useUpdateProfile,
} from "@/api/workspace/hooks";
import { parseOnboardingProgressResult } from "@/api/http/onboarding";
import { useAuthUser } from "@/app/auth";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { PageContainer } from "@/components/workspace/PageContainer";
import { DocumentsSection } from "@/features/profile/DocumentsSection";
import { MemoriesSection } from "@/features/profile/MemoriesSection";
import { ProfileSectionCard } from "@/features/profile/ProfileSectionCard";
import { ProfileSectionNav } from "@/features/profile/ProfileSectionNav";
import {
  PROFILE_SECTION_GROUPS,
  PROFILE_SECTIONS,
} from "@/features/profile/profile-sections-config";
import { buildPatchAtPath, getAtPath } from "@/features/profile/profile-patch";

/** The rail and the panel beside it — the one layout this tab has, so the
 * skeleton is shaped like it rather than like three grey bars. */
const PROFILE_LAYOUT_CLASS =
  "grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-8";

function ProfileSkeleton() {
  return (
    <div className={PROFILE_LAYOUT_CLASS}>
      <Skeleton className="hidden h-80 w-full md:block" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

type FailedSave = {
  key: string;
  patch: ProfilePatch;
};

/** How much is behind a tab, in the same grammar as "My list 7" elsewhere.
 * Absent while the count is unknown and at zero — an empty tab says so on
 * the inside, where there is room to say why. */
function TabCount({ value }: { value?: number }) {
  return value ? (
    <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
  ) : null;
}

function SaveStatus({
  failedSaves,
  hasSaved,
  onRetryFailed,
  pendingCount,
}: {
  failedSaves: readonly FailedSave[];
  hasSaved: boolean;
  onRetryFailed: () => void;
  pendingCount: number;
}) {
  if (failedSaves.length > 0) {
    return (
      <div className="flex items-center gap-2" role="status">
        <span className="text-sm text-destructive-foreground">
          Couldn’t save {failedSaves.length === 1 ? "a field" : "some fields"}
        </span>
        <Button onClick={onRetryFailed} size="xs" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <span aria-live="polite" className="text-sm text-muted-foreground">
        Saving…
      </span>
    );
  }

  // At rest the slot stays empty. "Autosaves as you go" was true 100% of the
  // time, so it carried no information while holding the most valuable
  // real estate on the page; the contract now sits beside the fields it
  // describes, in the section panel's footer.
  if (!hasSaved) {
    return null;
  }

  return (
    <span aria-live="polite" className="text-sm text-muted-foreground">
      Saved
    </span>
  );
}

/** Quiet re-entry for grandfathered and deferred users (README §7.3/§7.4,
 * plan §20.6). Never shown for `completed` — the full Profile is already
 * their primary editing surface — and `in_progress`/`not_started` users
 * never reach this page, since `OnboardingGate` redirects them first. */
function GuidedSetupAction() {
  const me = useAuthUser();
  const result = parseOnboardingProgressResult(me?.settings);
  const isEligible =
    result.kind === "grandfathered" ||
    (result.kind === "progress" && result.progress.status === "deferred");

  if (!isEligible) {
    return null;
  }

  return (
    <Button
      render={<Link to="/onboarding" />}
      size="sm"
      type="button"
      variant="ghost"
    >
      <CompassIcon />
      Guided setup
    </Button>
  );
}

export function ProfileRoute() {
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const documentsQuery = useDocuments();
  const memoriesQuery = useMemories();
  const [sectionKey, setSectionKey] = useState(PROFILE_SECTIONS[0].key);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [failedSaves, setFailedSaves] = useState<FailedSave[]>([]);
  const [hasSaved, setHasSaved] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const saveVersion = useRef(0);
  const latestVersionByKey = useRef(new Map<string, number>());

  function savePatch(key: string, patch: ProfilePatch) {
    const version = ++saveVersion.current;
    latestVersionByKey.current.set(key, version);
    setPendingCount((count) => count + 1);
    void updateProfile
      .mutateAsync(patch)
      .then(
        () => {
          if (latestVersionByKey.current.get(key) !== version) {
            return;
          }
          setFailedSaves((saves) => saves.filter((save) => save.key !== key));
          setHasSaved(true);
        },
        () => {
          if (latestVersionByKey.current.get(key) !== version) {
            return;
          }
          setFailedSaves((saves) => [
            ...saves.filter((save) => save.key !== key),
            { key, patch },
          ]);
        },
      )
      .finally(() => setPendingCount((count) => Math.max(0, count - 1)));
  }

  function handleFieldCommit(path: string[], value: unknown) {
    savePatch(path.join("."), buildPatchAtPath(path, value));
  }

  function retryFailedSaves() {
    failedSaves.forEach((save) => savePatch(save.key, save.patch));
  }

  /** The rail is sticky but the panel is not: switching sections while
   * scrolled halfway down the previous one would otherwise land you in the
   * middle of the new one. */
  function selectSection(key: string) {
    setSectionKey(key);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const sectionIndex = Math.max(
    PROFILE_SECTIONS.findIndex((entry) => entry.key === sectionKey),
    0,
  );
  const section = PROFILE_SECTIONS[sectionIndex];
  const groupLabel =
    PROFILE_SECTION_GROUPS.find((group) => group.key === section.group)
      ?.label ?? "";

  return (
    <PageContainer
      actions={
        <>
          <GuidedSetupAction />
          <SaveStatus
            failedSaves={failedSaves}
            hasSaved={hasSaved}
            onRetryFailed={retryFailedSaves}
            pendingCount={pendingCount}
          />
        </>
      }
      scrollRef={scrollRef}
      subtitle="Your application context, in your own words. Every field is optional."
      title="Profile"
      width="full"
    >
      {/* Tabs, rail and panel centre as one block: the page runs full-width
       * so the two columns have room, and the cap keeps the form from
       * stretching across an ultrawide display. */}
      <Tabs
        defaultValue="profile"
        className="mx-auto w-full max-w-[1160px] gap-5"
      >
        <TabsList className="w-full justify-start sm:w-fit">
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="profile">
            Profile
          </TabsTab>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="documents">
            Documents
            <TabCount value={documentsQuery.data?.length} />
          </TabsTab>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="memory">
            Memory
            <TabCount value={memoriesQuery.data?.length} />
          </TabsTab>
        </TabsList>

        <TabsPanel value="profile">
          {profileQuery.isLoading ? (
            <ProfileSkeleton />
          ) : profileQuery.isError ? (
            <Empty className="border border-[var(--profile-section-border)] bg-[var(--profile-section-surface)]">
              <EmptyHeader>
                <EmptyTitle>We couldn’t load your profile</EmptyTitle>
                <EmptyDescription>
                  Your saved information is still safe. Try loading it again.
                </EmptyDescription>
              </EmptyHeader>
              <Button
                onClick={() => void profileQuery.refetch()}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            </Empty>
          ) : (
            <div className={PROFILE_LAYOUT_CLASS}>
              <div className="md:sticky md:top-0">
                <ProfileSectionNav
                  onSelect={selectSection}
                  profile={profileQuery.data}
                  selectedKey={section.key}
                />
              </div>
              {/* Keyed on the section so per-section local state — the note
               * disclosure, every field's in-progress draft — resets with
               * the panel instead of leaking into the next section. */}
              <ProfileSectionCard
                groupLabel={groupLabel}
                key={section.key}
                nextSection={PROFILE_SECTIONS[sectionIndex + 1]}
                onFieldCommit={handleFieldCommit}
                onSelect={selectSection}
                previousSection={PROFILE_SECTIONS[sectionIndex - 1]}
                section={section}
                value={getAtPath(profileQuery.data, [section.key])}
              />
            </div>
          )}
        </TabsPanel>
        <TabsPanel value="documents">
          <DocumentsSection />
        </TabsPanel>
        <TabsPanel value="memory">
          <MemoriesSection />
        </TabsPanel>
      </Tabs>
    </PageContainer>
  );
}
