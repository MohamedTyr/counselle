import { useProfile, useUpdateProfile } from "@/api/workspace/hooks"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/workspace/PageHeader"
import { DocumentsSection } from "@/features/profile/DocumentsSection"
import { MemoriesSection } from "@/features/profile/MemoriesSection"
import { ProfileSectionCard } from "@/features/profile/ProfileSectionCard"
import { PROFILE_SECTIONS } from "@/features/profile/profile-sections-config"
import { buildPatchAtPath, getAtPath } from "@/features/profile/profile-patch"

function ProfileSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function ProfileRoute() {
  const profileQuery = useProfile()
  const updateProfile = useUpdateProfile()

  function handleFieldCommit(path: string[], value: unknown) {
    updateProfile.mutate(buildPatchAtPath(path, value))
  }

  return (
    <div className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
      <PageHeader title="Profile" />
      <p className="max-w-2xl text-sm text-muted-foreground">
        Fill this in or just upload what you have — Counselle reads
        everything. Every field autosaves the moment you click away.
      </p>
      {profileQuery.isLoading ? (
        <ProfileSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {PROFILE_SECTIONS.map((section) => (
            <ProfileSectionCard
              config={section}
              key={section.key}
              onFieldCommit={handleFieldCommit}
              value={getAtPath(profileQuery.data, [section.key])}
            />
          ))}
        </div>
      )}
      <DocumentsSection />
      <MemoriesSection />
    </div>
  )
}
