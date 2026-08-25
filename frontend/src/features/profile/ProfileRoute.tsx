import { CompassIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import type { ProfilePatch } from "@/api/workspace/types";
import { useProfile, useUpdateProfile } from "@/api/workspace/hooks";
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
import { PROFILE_SECTIONS } from "@/features/profile/profile-sections-config";
import { buildPatchAtPath, getAtPath } from "@/features/profile/profile-patch";
import { Accordion } from "@/components/ui/accordion";

function ProfileSkeleton() {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

type FailedSave = {
  key: string;
  patch: ProfilePatch;
};

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

  if (!hasSaved) {
    return (
      <span className="text-sm text-muted-foreground">Autosaves as you go</span>
    );
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
      subtitle="Your application context, in your own words. Every field is optional."
      title="Profile"
      width="wide"
    >
      <Tabs defaultValue="profile" className="w-full gap-5">
        <TabsList className="w-full justify-start sm:w-fit">
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="profile">
            Profile
          </TabsTab>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="documents">
            Documents
          </TabsTab>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="memory">
            Memory
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
            <Accordion
              className="w-full overflow-hidden rounded-xl border border-[var(--profile-section-border)] bg-[var(--profile-section-surface)]"
              defaultValue={["basics"]}
              multiple
            >
              {PROFILE_SECTIONS.map((section) => (
                <ProfileSectionCard
                  config={section}
                  key={section.key}
                  onFieldCommit={handleFieldCommit}
                  value={getAtPath(profileQuery.data, [section.key])}
                />
              ))}
            </Accordion>
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
