import { ExternalLink } from "lucide-react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import {
  useApplication,
  useApplications,
  useArchiveApplication,
  useRestoreApplication,
} from "@/api/workspace/hooks";
import type { ApplicationDetail, ApplicationView } from "@/api/workspace/types";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { PageContainer } from "@/components/workspace/PageContainer";
import { SchoolFactsPanel } from "@/features/schools/facts/SchoolFactsPanel";
import { schoolFactsFixture } from "@/features/schools/facts/school-facts-fixtures";
import { identityMeta } from "@/features/schools/facts/school-facts-format";
import { SchoolAvatar } from "@/features/schools/school-cells";
import { SchoolWorkspace } from "@/features/schools/SchoolWorkspace";

/*
 * The school page.
 *
 * Keyed by UNITID, not by application id, because a school you have not
 * added to your list is still a school you can read about — and until now it
 * had no page at all (ExplorePanel could only link the ones you had already
 * added, which is exactly backwards for a browsing surface).
 *
 * Application-id URLs still work: every existing link in essays, tasks and
 * the schools table points at one, and they redirect here rather than being
 * rewritten at seven call sites for a change that has nothing to do with
 * them.
 *
 * Two tabs, and the division between them is absolute:
 *
 *   About shows what the school requires.
 *   Your application shows what you have done about it.
 *
 * The same essay prompt appears in both with a different verb — here a
 * published fact with a source, there a draft with a word count. Nothing
 * renders twice meaning the same thing.
 */

type Tab = "about" | "application";

function isUnitid(key: string | undefined): key is string {
  return Boolean(key && /^\d+$/.test(key));
}

export function SchoolDetailRoute() {
  const { schoolKey } = useParams();
  const applications = useApplications();

  if (!isUnitid(schoolKey)) {
    return (
      <LegacyApplicationRedirect
        applicationId={schoolKey ?? ""}
        applications={applications.data}
        isLoading={applications.isLoading}
      />
    );
  }

  const unitid = Number(schoolKey);
  const application = applications.data?.find(
    (item) => item.school_unitid === unitid,
  );

  return (
    <SchoolDetail
      application={application ?? null}
      isLoading={applications.isLoading}
      unitid={unitid}
    />
  );
}

/** An application-id URL: resolve it to the school and rewrite the address. */
function LegacyApplicationRedirect({
  applicationId,
  applications,
  isLoading,
}: {
  applicationId: string;
  applications: ApplicationView[] | undefined;
  isLoading: boolean;
}) {
  if (isLoading) return <SchoolDetailSkeleton />;
  const application = applications?.find((item) => item.id === applicationId);
  if (!application) return <Navigate replace to="/app/schools" />;
  return <Navigate replace to={`/app/schools/${application.school_unitid}`} />;
}

function SchoolDetail({
  application,
  isLoading,
  unitid,
}: {
  application: ApplicationView | null;
  isLoading: boolean;
  unitid: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const detail = useApplication(application?.id ?? null);
  const facts = schoolFactsFixture(unitid);
  const tab: Tab =
    searchParams.get("tab") === "application" ? "application" : "about";

  if (isLoading) return <SchoolDetailSkeleton />;
  if (!facts && !application) return <Navigate replace to="/app/schools" />;

  const identity = facts?.identity ?? {
    unitid,
    name: application?.school_name ?? "School",
    city: application?.school_city ?? null,
    state: application?.school_state ?? null,
    control: null,
    undergraduates: null,
    websiteUrl: application?.website_url ?? null,
    domain: null,
  };
  const openItems = application
    ? application.progress.total - application.progress.completed
    : 0;

  return (
    <PageContainer
      actions={
        <SchoolActions
          application={application}
          websiteUrl={identity.websiteUrl}
        />
      }
      leading={
        <SchoolAvatar name={identity.name} websiteUrl={identity.websiteUrl} />
      }
      subtitle={identityMeta(identity)}
      title={identity.name}
      width="full"
    >
      <Breadcrumb className="hidden md:block">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/app/schools" />}>
              Schools
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{identity.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Tabs
        onValueChange={(next) => {
          /* Tab lives in the URL so a link into the facts is shareable and
           * the back button does what the reader expects. */
          setSearchParams(
            (current) => {
              const params = new URLSearchParams(current);
              params.set("tab", String(next));
              return params;
            },
            { replace: true },
          );
        }}
        value={tab}
      >
        <TabsList variant="underline">
          <TabsTab value="about">About</TabsTab>
          <TabsTab value="application">
            Your application
            {openItems > 0 ? (
              <span className="ml-1.5 text-xs tabular-nums text-[var(--ink-muted)]">
                {openItems}
              </span>
            ) : null}
          </TabsTab>
        </TabsList>
        <TabsPanel className="pt-4" value="about">
          {facts ? (
            <SchoolFactsPanel data={facts} />
          ) : (
            <NoFactsYet name={identity.name} />
          )}
        </TabsPanel>
        <TabsPanel className="pt-4" value="application">
          <ApplicationTab
            detail={detail.data}
            isError={detail.isError}
            isLoading={Boolean(application) && detail.isLoading}
            onRetry={() => void detail.refetch()}
            schoolName={identity.name}
          />
        </TabsPanel>
      </Tabs>
    </PageContainer>
  );
}

function SchoolActions({
  application,
  websiteUrl,
}: {
  application: ApplicationView | null;
  websiteUrl: string | null;
}) {
  const navigate = useNavigate();
  const archiveApplication = useArchiveApplication();
  const restoreApplication = useRestoreApplication();

  async function archive() {
    if (!application) return;
    await archiveApplication.mutateAsync(application.id);
    void navigate("/app/schools");
    toast.success(`${application.school_name} archived`, {
      action: {
        label: "Undo",
        onClick: () => restoreApplication.mutate(application.id),
      },
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {websiteUrl ? (
        <Button
          render={<a href={websiteUrl} rel="noreferrer" target="_blank" />}
          size="sm"
          variant="outline"
        >
          Website
          <ExternalLink data-icon="inline-end" />
        </Button>
      ) : null}
      {application ? (
        <Button
          disabled={archiveApplication.isPending}
          onClick={() => void archive()}
          size="sm"
          variant="outline"
        >
          Archive
        </Button>
      ) : (
        <Button
          render={<Link to="/app/schools?add=1" />}
          size="sm"
          variant="default"
        >
          Add to list
        </Button>
      )}
    </div>
  );
}

function ApplicationTab({
  detail,
  isError,
  isLoading,
  onRetry,
  schoolName,
}: {
  detail: ApplicationDetail | undefined;
  isError: boolean;
  isLoading: boolean;
  onRetry: () => void;
  schoolName: string;
}) {
  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError) {
    return (
      <div
        className="flex max-w-md flex-col gap-3 rounded-xl border bg-card p-6"
        role="alert"
      >
        <h2 className="text-lg font-medium">Could not load this application</h2>
        <p className="text-sm text-muted-foreground">
          The workspace could not reach your application data. This is not shown
          as an empty catalog, because that would hide a data failure.
        </p>
        <div>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Not on your list yet</EmptyTitle>
          <EmptyDescription>
            Add {schoolName} to track deadlines, essays, and requirements
            alongside your other applications.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {/* The existing add path, which needs a cycle year. There is not a
           * second one. */}
          <Button render={<Link to="/app/schools?add=1" />}>Add to list</Button>
        </EmptyContent>
      </Empty>
    );
  }
  return <SchoolWorkspace detail={detail} onRetry={onRetry} />;
}

function NoFactsYet({ name }: { name: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No Common Data Set on file</EmptyTitle>
        <EmptyDescription>
          We haven't been able to read a Common Data Set for {name}.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          render={
            <Link
              state={{ draftPrompt: `What can you tell me about ${name}?` }}
              to="/app/ai"
            />
          }
        >
          Ask Counselle about {name}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Shaped like the content it replaces, never a generic shimmer. */
export function SchoolDetailSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-6 pb-6 md:px-10">
      <div className="flex min-h-16 items-center gap-4 border-b py-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton className="h-14" key={index} />
        ))}
      </div>
      <Skeleton className="h-8 w-56" />
      <div className="grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    </section>
  );
}
