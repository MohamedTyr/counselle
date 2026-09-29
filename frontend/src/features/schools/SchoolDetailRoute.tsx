import { ExternalLink } from "lucide-react";
import * as React from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { isTransportError } from "@/api/http/errors";
import { useSchoolFacts } from "@/api/schools/hooks";
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
import { ErrorCard } from "@/components/ui/error-card";
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
import { SchoolFactsSkeleton } from "@/features/schools/facts/SchoolFactsSkeleton";
import { identityMeta } from "@/features/schools/facts/school-facts-format";
import { SchoolChancesPanel } from "@/features/schools/chances/SchoolChancesPanel";
import type {
  SchoolFactsResponse,
  SchoolIdentity,
} from "@/features/schools/facts/school-facts-types";
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
 * Three tabs, with facts and workspace progress kept distinct:
 *
 *   About shows what the school requires.
 *   Compare places saved academics beside entering-class context.
 *   Your application shows what you have done about it.
 *
 * The same essay prompt appears in both with a different verb — here a
 * published fact with a source, there a draft with a word count. Nothing
 * renders twice meaning the same thing.
 */

type Tab = "about" | "chances" | "application";

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
  const facts = useSchoolFacts(unitid);

  /* A pending query renders the skeleton, never a redirect (plan §5.2) —
   * this branch has to come before anything that could read `facts.data`. */
  if (isLoading || facts.isPending) return <SchoolDetailSkeleton />;

  if (facts.isError) {
    /* An unknown unitid is a 404, and a 404 is not a failure: it renders
     * the "We don't have this school" Empty primitive, never the error
     * card. Only 5xx/network reaches the error card. */
    if (isTransportError(facts.error) && facts.error.status === 404) {
      return <SchoolNotFound />;
    }
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <ErrorCard
          headingLevel="h1"
          message="The workspace could not reach the school data service."
          onRetry={() => void facts.refetch()}
          role="alert"
          title="Could not load this school's facts"
        />
      </div>
    );
  }

  return <SchoolDetailLoaded application={application} data={facts.data} />;
}

function SchoolDetailLoaded({
  application,
  data,
}: {
  application: ApplicationView | null;
  data: SchoolFactsResponse;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  /* Compare stays lazy on an initial About visit, then remains mounted after
   * its first visit. That retains the local explorer and avoids turning a
   * simple tab return into a stale Profile-query remount. */
  const [hasVisitedCompare, setHasVisitedCompare] = React.useState(
    searchParams.get("tab") === "chances",
  );
  const detail = useApplication(application?.id ?? null);
  const tab: Tab =
    searchParams.get("tab") === "application"
      ? "application"
      : searchParams.get("tab") === "chances"
        ? "chances"
        : "about";
  const identity = data.identity;
  const openItems = application
    ? application.progress.total - application.progress.completed
    : 0;

  return (
    <PageContainer
      actions={
        <SchoolActions
          application={application}
          websiteUrl={identity.website_url}
        />
      }
      /*
       * The bar carries the trail, the page carries the school. Both used to
       * name the school — once as the h1 and again as the crumb, 40px apart —
       * which spent the page's most prominent line saying what the line under
       * it already said.
       */
      heading={<SchoolCrumbs name={identity.name} />}
      title={identity.name}
      width="panel"
    >
      <SchoolIdentityBlock identity={identity} />

      <Tabs
        onValueChange={(next) => {
          /* Tab lives in the URL so a link into the facts is shareable and
           * the back button does what the reader expects. */
          if (next === "chances") setHasVisitedCompare(true);
          setSearchParams(
            (current) => {
              const params = new URLSearchParams(current);
              params.set("tab", String(next));
              return params;
            },
            { replace: false },
          );
        }}
        value={tab}
      >
        <TabsList>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="about">
            About
          </TabsTab>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="chances">
            Compare
          </TabsTab>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="application">
            <span>Your application</span>
            {openItems > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {openItems}
              </span>
            ) : null}
          </TabsTab>
        </TabsList>
        <TabsPanel className="pt-4" value="about">
          <SchoolFactsPanel data={data} />
        </TabsPanel>
        <TabsPanel
          className="pt-4"
          keepMounted={hasVisitedCompare}
          value="chances"
        >
          <SchoolChancesPanel
            data={data}
            metricParam={searchParams.get("metric")}
            onMetricChange={(metric) => {
              setSearchParams(
                (current) => {
                  const params = new URLSearchParams(current);
                  params.set("tab", "chances");
                  params.set("metric", metric);
                  return params;
                },
                { replace: true },
              );
            }}
          />
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

function SchoolCrumbs({ name }: { name: string }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/app/schools" />}>
            Schools
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {/* Truncates rather than wraps: the bar is a fixed 64px, and a
           * two-line crumb would push the actions out of its centre. */}
          <BreadcrumbPage className="truncate">{name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** The page's subject, and the page's only `<h1>`. */
function SchoolIdentityBlock({ identity }: { identity: SchoolIdentity }) {
  const meta = identityMeta(identity);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <SchoolAvatar name={identity.name} websiteUrl={identity.website_url} />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-xl leading-none font-semibold tracking-tight">
          {identity.name}
        </h1>
        {meta ? (
          <p className="truncate text-sm text-muted-foreground">{meta}</p>
        ) : null}
      </div>
    </div>
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
      <ErrorCard
        message="The workspace could not reach your application data. This is not shown as an empty catalog, because that would hide a data failure."
        onRetry={onRetry}
        role="alert"
        title="Could not load this application"
      />
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

/** An unknown unitid — the school is not in our database at all. Distinct
 * from `has_collegedata === false` (a real school we just have no crawled
 * facts for), which `SchoolFactsPanel` handles on the About tab instead. */
function SchoolNotFound() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>We don't have this school</EmptyTitle>
          <EmptyDescription>
            Counselle doesn't have a school with that id. Search by name to find
            it.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/app/schools" />}>Browse schools</Button>
        </EmptyContent>
      </Empty>
    </div>
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
      <SchoolFactsSkeleton />
    </section>
  );
}
