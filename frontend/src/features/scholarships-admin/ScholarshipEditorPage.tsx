import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { useAdminScholarship, useAdminScholarships, useSaveScholarship } from "@/api/scholarships/hooks";
import type { Scholarship, ScholarshipDraft, ScholarshipStatus } from "@/api/scholarships/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/workspace/PageContainer";
import { emptyDraft, previewRecord, publishChecks, sameDraft, toDraft } from "@/features/scholarships-admin/editor-draft";
import { EditorForm } from "@/features/scholarships-admin/EditorForm";
import { EditorPreview, PublishChecklist } from "@/features/scholarships-admin/EditorPreview";
import { SaveBar } from "@/features/scholarships-admin/SaveBar";
import { STATUS_BADGE } from "@/features/scholarships-admin/status";

const LIST_PATH = "/app/admin/scholarships";

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
      <Link className="shrink-0 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]" to={LIST_PATH}>
        Scholarship admin
      </Link>
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[var(--ink-faint)]" />
      <h1 className="truncate text-xl font-semibold tracking-tight text-[var(--ink)]">{name}</h1>
    </nav>
  );
}

function useLeaveGuard(dirty: boolean) {
  const bypass = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  return { blocker, bypass };
}

function Editor({ record, others }: { record: Scholarship | null; others: Scholarship[] }) {
  const navigate = useNavigate();
  const save = useSaveScholarship();
  const [baseline, setBaseline] = useState<ScholarshipDraft>(() => (record ? toDraft(record) : emptyDraft()));
  const [draft, setDraft] = useState<ScholarshipDraft>(baseline);
  const dirty = !sameDraft(draft, baseline);
  const checks = useMemo(() => publishChecks(draft), [draft]);
  const ready = checks.every((check) => check.ok);
  const { blocker, bypass } = useLeaveGuard(dirty);

  const set = useCallback((patch: Partial<ScholarshipDraft>) => setDraft((current) => ({ ...current, ...patch })), []);

  const commit = useCallback(
    (next: ScholarshipDraft, message: string) => {
      if (next.status === "published" && !publishChecks(next).every((check) => check.ok)) {
        toast.error("Fix the checklist before saving a published scholarship");
        return;
      }
      save.mutate(
        { id: record?.id ?? null, draft: next },
        {
          onSuccess: (saved) => {
            const savedDraft = toDraft(saved);
            setBaseline(savedDraft);
            setDraft(savedDraft);
            toast.success(message);
            if (!record) {
              bypass.current = true;
              void navigate(`${LIST_PATH}/${saved.id}`, { replace: true });
            }
          },
          onError: () => toast.error("Could not save. Your changes are still here."),
        },
      );
    },
    [bypass, navigate, record, save],
  );

  const setStatus = (status: ScholarshipStatus, message: string) => commit({ ...draft, status }, message);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty && !save.isPending) commit(draft, "Saved");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit, dirty, draft, save.isPending]);

  const status = STATUS_BADGE[draft.status];
  const blockedSave = draft.status === "published" && !ready;

  const actions = (
    <div className="flex items-center gap-2">
      <Badge variant={status.variant}>{status.label}</Badge>
      {draft.status === "draft" ? (
        <Button
          disabled={!ready}
          loading={save.isPending}
          onClick={() => setStatus("published", "Published. Students can see it now.")}
          size="sm"
          title={ready ? undefined : "Finish the checklist to publish"}
        >
          {dirty ? "Save and publish" : "Publish"}
        </Button>
      ) : null}
      {record ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="More actions" size="icon-sm" variant="outline">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {draft.status === "published" ? (
              <DropdownMenuItem onSelect={() => setStatus("draft", "Unpublished. Students no longer see it.")}>
                Unpublish
              </DropdownMenuItem>
            ) : null}
            {draft.status === "archived" ? (
              <DropdownMenuItem onSelect={() => setStatus("draft", "Restored as a draft")}>Restore as draft</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setStatus("archived", "Archived")}>Archive</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <PageContainer
      actions={actions}
      heading={<Breadcrumb name={draft.name.trim() || (record ? "Untitled scholarship" : "New scholarship")} />}
      overlay={
        <>
          {dirty ? (
            <SaveBar
              blockedReason={blockedSave ? "Fix the checklist to save a published scholarship" : null}
              isSaving={save.isPending}
              onDiscard={() => setDraft(baseline)}
              onSave={() => commit(draft, "Saved")}
            />
          ) : null}
          <Dialog onOpenChange={(open) => (open ? null : blocker.reset?.())} open={blocker.state === "blocked"}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Discard unsaved changes?</DialogTitle>
                <DialogDescription>Your edits to this scholarship haven't been saved.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => blocker.reset?.()} variant="ghost">
                  Keep editing
                </Button>
                <Button onClick={() => blocker.proceed?.()} variant="destructive">
                  Discard changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
      title={draft.name || "Scholarship"}
    >
      <div className="grid items-start gap-6 pb-20 xl:grid-cols-[minmax(0,1fr)_var(--scholarship-detail-width)]">
        <EditorForm draft={draft} others={others.filter((item) => item.id !== record?.id)} set={set} />
        <div className="flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto xl:rounded-xl xl:[scrollbar-width:thin]">
          <PublishChecklist checks={checks} />
          <EditorPreview record={previewRecord(draft, record)} />
        </div>
      </div>
    </PageContainer>
  );
}

export function ScholarshipEditorPage() {
  const { scholarshipId = "new" } = useParams();
  const isNew = scholarshipId === "new";
  const query = useAdminScholarship(isNew ? null : scholarshipId);
  const all = useAdminScholarships();
  const others = all.data ?? [];

  if (!isNew && query.isError) {
    return (
      <PageContainer title="Scholarship">
        <ErrorCard
          headingLevel="h1"
          message="This scholarship doesn't exist or was removed."
          onRetry={() => void query.refetch()}
          title="Could not load scholarship"
        />
      </PageContainer>
    );
  }
  if (!isNew && !query.data) {
    return (
      <PageContainer title="Scholarship">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_var(--scholarship-detail-width)]">
          <Skeleton className="h-[36rem] w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </PageContainer>
    );
  }
  return <Editor key={scholarshipId} others={others} record={isNew ? null : (query.data ?? null)} />;
}
