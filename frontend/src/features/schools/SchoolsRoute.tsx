import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { PageHeader } from "@/components/workspace/PageHeader";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { useApplications } from "@/api/workspace/hooks";
import { schoolFromApplication } from "@/domain/school";
import { AddSchoolDialog } from "@/features/schools/AddSchoolDialog";
import { ExplorePanel } from "@/features/schools/explore/ExplorePanel";
import { MyListPanel } from "@/features/schools/MyListPanel";
import { WorkspaceScrollIndicator } from "@/features/schools/WorkspaceScrollIndicator";

/*
 * The Schools shell: two tabs over one data model.
 *
 * Explore browses every profiled school; My list is the application
 * tracker. They answer different questions and so get different
 * affordances (cards vs. a table) — see the note at the top of each panel.
 * This file owns only the shell: the header, the tabs, the ⌘K dialog, and
 * the legacy query-param redirect. Everything else moved into the panels.
 */

type TabId = "explore" | "mylist";

/** My list is the default: it is the returning student's workspace, and
 *  Explore is somewhere you go on purpose. Explore is first in the tab
 *  order because it is first in the journey. */
const DEFAULT_TAB: TabId = "mylist";

function SchoolsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

export function SchoolsPage() {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const applications = useApplications();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [addSchoolOpen, setAddSchoolOpen] = useState(false);
  const activeSchoolId = searchParams.get("school");
  const tab: TabId =
    searchParams.get("tab") === "explore" ? "explore" : DEFAULT_TAB;

  const schools = useMemo(
    () => (applications.data ?? []).map(schoolFromApplication),
    [applications.data],
  );

  /*
   * The legacy `?school=<application id>` param resolves to the canonical
   * unitid URL here, in one hop. The detail route can also translate an
   * application id, but going through it would put an intermediate address
   * in the history and make the landing depend on a second query resolving.
   * We already hold the applications list; use it.
   */
  const legacyRedirectUnitid = activeSchoolId
    ? (applications.data?.find((item) => item.id === activeSchoolId)
        ?.school_unitid ?? null)
    : null;

  useEffect(() => {
    if (legacyRedirectUnitid !== null) {
      void navigate(`/app/schools/${legacyRedirectUnitid}`, { replace: true });
    }
  }, [legacyRedirectUnitid, navigate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setAddSchoolOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /**
   * Takes an application id — that is what the table rows and the add dialog
   * hand back — and navigates by school, which is what the page is keyed on.
   * Falls back to the application id, which the detail route translates.
   */
  function openSchool(applicationId: string) {
    const unitid = applications.data?.find(
      (item) => item.id === applicationId,
    )?.school_unitid;
    void navigate(`/app/schools/${unitid ?? applicationId}`);
  }

  /** The tab switch is the one navigation on this page that PUSHES — every
   *  filter change replaces, so Back means "go back to the other tab"
   *  rather than "undo one keystroke". */
  function handleTabChange(value: unknown) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", String(value));
      return next;
    });
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10"
        ref={scrollAreaRef}
      >
        {/* The brand-fill CTA, not `outline`. semantic.css budgets --brand for
         * "the single next action" on a screen, and on the schools workspace
         * that is unambiguously "add a school" — an empty or thin list is the
         * only thing that makes the rest of the page inert. As an outline
         * button it was the quietest mark in the header, which left the page
         * with no marked next action at all. The `default` variant also carries
         * --elevation-cta and the --brand-edge rim, so it reads as an object on
         * the canvas rather than a flat wine rectangle — the deliberate
         * difference from the sidebar's flat "New chat", which sits on a flat
         * panel and has no elevation to earn. */}
        <PageHeader
          actions={
            <Button
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setAddSchoolOpen(true)}
            >
              <Plus data-icon="inline-start" />
              Add school
              {/* aria-hidden: the shortcut is already announced by
               * aria-keyshortcuts, and leaving it in the accessible name
               * would rename the button to "Add school ⌘K". */}
              <Kbd
                aria-hidden="true"
                className="ms-1 bg-[var(--on-brand-quiet)] text-current"
              >
                ⌘K
              </Kbd>
            </Button>
          }
          title="Schools"
        />

        {applications.isLoading ? (
          <SchoolsSkeleton />
        ) : applications.isError ? (
          <div className="rounded-xl border bg-card p-6">
            <div className="max-w-md space-y-3">
              <h2 className="font-heading text-lg font-medium">
                Could not load schools
              </h2>
              <p className="text-sm text-muted-foreground">
                The workspace could not reach your applications list.
              </p>
              <Button onClick={() => void applications.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <Tabs
            aria-label="Schools views"
            className="gap-5"
            onValueChange={handleTabChange}
            value={tab}
          >
            <TabsList className="w-full justify-start" variant="underline">
              <TabsTab className="grow-0 text-base font-medium" value="explore">
                Explore
              </TabsTab>
              <TabsTab className="grow-0 text-base font-medium" value="mylist">
                My list
                <span className="text-xs text-muted-foreground tabular-nums">
                  {schools.length}
                </span>
              </TabsTab>
            </TabsList>

            {/* Rendered conditionally rather than hidden: the Explore panel
             * owns URL params, and a mounted-but-hidden panel would keep
             * writing them while the student is reading My list. */}
            <TabsPanel value="explore">
              {tab === "explore" ? <ExplorePanel /> : null}
            </TabsPanel>
            <TabsPanel value="mylist">
              {tab === "mylist" ? (
                <MyListPanel
                  onAddSchool={() => setAddSchoolOpen(true)}
                  onOpenSchool={openSchool}
                  schools={schools}
                />
              ) : null}
            </TabsPanel>
          </Tabs>
        )}
      </div>
      <WorkspaceScrollIndicator scrollAreaRef={scrollAreaRef} />
      <AddSchoolDialog
        onAdded={openSchool}
        onOpenChange={setAddSchoolOpen}
        open={addSchoolOpen}
      />
    </section>
  );
}
