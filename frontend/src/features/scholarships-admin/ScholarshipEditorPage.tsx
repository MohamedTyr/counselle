import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { isTransportError } from "@/api/http/errors";
import { publishProblems } from "@/api/scholarships/errors";
import {
  useAdminScholarship,
  useAdminScholarships,
  useMarkChecked,
  useSaveScholarship,
  useSetScholarshipStatus,
} from "@/api/scholarships/hooks";
import type { AdminScholarship, PublishCheck, ScholarshipDraft, ScholarshipStatus } from "@/api/scholarships/types";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/workspace/PageContainer";
import { evaluateCriteria, summarizeFit } from "@/features/scholarships/eligibility";
import { ScholarshipDetail } from "@/features/scholarships/ScholarshipDetail";
import {
  EMPTY_FACTS,
  emptyDraft,
  isReady,
  previewRecord,
  publishChecks,
  sameDraft,
  toDraft,
} from "@/features/scholarships-admin/editor-draft";
import { EditorForm } from "@/features/scholarships-admin/EditorForm";
import { EditorPreview, PublishChecklist } from "@/features/scholarships-admin/EditorPreview";
import { HistorySheet } from "@/features/scholarships-admin/HistorySheet";
import { SaveBar } from "@/features/scholarships-admin/SaveBar";
import { STATUS_BADGE } from "@/features/scholarships-admin/status";

const LIST_PATH = "/app/admin/scholarships";
const NOT_READY = "This scholarship isn't ready to publish.";

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

function ConfirmDialog({
  open,
  title,
  description,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog onOpenChange={(next) => (next ? null : onCancel())} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="ghost">
            {cancel}
          </Button>
          <Button onClick={onConfirm} variant="destructive">
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type MenuProps = {
  record: AdminScholarship;
  dirty: boolean;
  onStatus: (status: ScholarshipStatus, message: string) => void;
  onMarkChecked: () => void;
  onHistory: () => void;
};

/** Status moves and "Mark checked today" never carry unsaved edits, so they wait for a clean draft. */
function MoreMenu({ record, dirty, onStatus, onMarkChecked, onHistory }: MenuProps) {
  const archived = record.status === "archived";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More actions" size="icon-sm" variant="outline">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {dirty && !archived ? <DropdownMenuLabel>Save or discard your changes first</DropdownMenuLabel> : null}
        {record.status === "published" ? (
          <DropdownMenuItem disabled={dirty} onSelect={() => onStatus("draft", "Unpublished. Students no longer see it.")}>
            Unpublish
          </DropdownMenuItem>
        ) : null}
        {archived ? null : (
          <DropdownMenuItem disabled={dirty} onSelect={onMarkChecked}>
            Mark checked today
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onHistory}>History</DropdownMenuItem>
        {archived ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={dirty} onSelect={() => onStatus("archived", "Archived")}>
              Archive
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type EditorProps = {
  record: AdminScholarship | null;
  others: AdminScholarship[];
  onReload: () => Promise<AdminScholarship | undefined>;
};

function useEditorState(record: AdminScholarship | null) {
  const [baseline, setBaseline] = useState<ScholarshipDraft>(() => (record ? toDraft(record) : emptyDraft()));
  const [draft, setDraft] = useState<ScholarshipDraft>(baseline);
  // The version the draft is based on; every write sends it back.
  const [baseVersion, setBaseVersion] = useState<number | null>(record?.version ?? null);
  const [serverProblems, setServerProblems] = useState<PublishCheck[]>([]);
  const [conflict, setConflict] = useState(false);
  const dirty = !sameDraft(draft, baseline);

  /** Adopt `saved` as the baseline. When `submitted` is given (a save), the
   * draft is replaced only if nothing was typed while the save was in flight. */
  const reset = useCallback((saved: AdminScholarship, submitted?: ScholarshipDraft) => {
    const next = toDraft(saved);
    setBaseline(next);
    setDraft((current) => (submitted && !sameDraft(current, submitted) ? current : next));
    setBaseVersion(saved.version);
    setServerProblems([]);
    setConflict(false);
  }, []);

  // A conflict only matters while there is a draft to lose.
  if (conflict && !dirty) setConflict(false);

  // A clean editor follows the stored record when it moves on (a status
  // change, a mark-checked, a refetch); a dirty one never does on its own,
  // and an older copy (a slow refetch) never replaces a newer one.
  if (record && !dirty && !conflict && (baseVersion === null || record.version > baseVersion)) {
    reset(record);
  }

  const set = useCallback((patch: Partial<ScholarshipDraft>) => {
    setServerProblems([]);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  return {
    baseline,
    draft,
    setDraft,
    set,
    baseVersion,
    serverProblems,
    setServerProblems,
    conflict,
    setConflict,
    dirty,
    reset,
  };
}

function Editor({ record, others, onReload }: EditorProps) {
  const navigate = useNavigate();
  const save = useSaveScholarship();
  const setStatusMutation = useSetScholarshipStatus();
  const markChecked = useMarkChecked();
  const state = useEditorState(record);
  const { draft, dirty, conflict, reset, set, serverProblems } = state;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const checks = useMemo(() => publishChecks(draft, serverProblems), [draft, serverProblems]);
  const ready = isReady(checks);
  const { blocker, bypass } = useLeaveGuard(dirty);

  const onSaveError = useCallback(
    (error: unknown) => {
      if (isTransportError(error) && error.kind === "conflict") {
        state.setConflict(true);
        // Fetch their version now, so Discard lands on it rather than a stale baseline.
        void onReload();
        return;
      }
      const problems = publishProblems(error);
      if (problems.length > 0) {
        state.setServerProblems(problems);
        toast.error(NOT_READY);
        return;
      }
      toast.error(
        isTransportError(error) && error.kind === "invalid_edit"
          ? error.message
          : "Could not save. Your changes are still here.",
      );
    },
    [onReload, state],
  );

  const commit = useCallback(
    (next: ScholarshipDraft, message: string) => {
      if (conflict) return;
      if (next.status === "published" && !isReady(publishChecks(next, serverProblems))) {
        toast.error("Fix the checklist before saving a published scholarship");
        return;
      }
      save.mutate(
        { id: record?.id ?? null, draft: next, expected_version: record ? state.baseVersion : null },
        {
          onSuccess: (saved) => {
            reset(saved, next);
            toast.success(message);
            if (!record) {
              bypass.current = true;
              void navigate(`${LIST_PATH}/${saved.id}`, { replace: true });
            }
          },
          onError: onSaveError,
        },
      );
    },
    [bypass, conflict, navigate, onSaveError, record, reset, save, serverProblems, state.baseVersion],
  );

  const changeStatus = (status: ScholarshipStatus, message: string) => {
    if (!record || dirty) return;
    setStatusMutation.mutate(
      { id: record.id, status, expected_version: state.baseVersion ?? undefined },
      {
        onSuccess: (saved) => {
          reset(saved);
          toast.success(message);
        },
      },
    );
  };

  const onMarkChecked = () => {
    if (!record || dirty) return;
    markChecked.mutate(record.id, {
      onSuccess: (saved) => {
        reset(saved);
        toast.success("Marked checked today");
      },
    });
  };

  const reloadTheirs = async () => {
    setConfirmReload(false);
    const fresh = await onReload();
    if (fresh) reset(fresh);
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty && !save.isPending && !conflict) commit(draft, "Saved");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit, conflict, dirty, draft, save.isPending]);

  const archived = record !== null && state.baseline.status === "archived";
  const badge = STATUS_BADGE[draft.status];
  const blockedSave = draft.status === "published" && !ready;

  const actions = (
    <div className="flex items-center gap-2">
      <Badge variant={badge.variant}>{badge.label}</Badge>
      {draft.status === "draft" && !archived ? (
        <Button
          disabled={!ready || conflict}
          loading={save.isPending}
          onClick={() => commit({ ...draft, status: "published" }, "Published. Students can see it now.")}
          size="sm"
          title={ready ? undefined : "Finish the checklist to publish"}
        >
          {dirty ? "Save and publish" : "Publish"}
        </Button>
      ) : null}
      {archived ? (
        <Button
          loading={setStatusMutation.isPending}
          onClick={() => changeStatus("draft", "Restored as a draft")}
          size="sm"
        >
          Restore as draft
        </Button>
      ) : null}
      {record ? (
        <MoreMenu
          dirty={dirty}
          onHistory={() => setHistoryOpen(true)}
          onMarkChecked={onMarkChecked}
          onStatus={changeStatus}
          record={{ ...record, status: state.baseline.status }}
        />
      ) : null}
    </div>
  );

  const overlay = (
    <>
      {dirty ? (
        <SaveBar
          blockedReason={blockedSave ? "Fix the checklist to save a published scholarship" : null}
          conflict={conflict ? { onReload: () => setConfirmReload(true) } : undefined}
          isSaving={save.isPending}
          onDiscard={() => state.setDraft(state.baseline)}
          onSave={() => commit(draft, "Saved")}
        />
      ) : null}
      <ConfirmDialog
        cancel="Keep editing"
        confirm="Discard changes"
        description="Your edits to this scholarship haven't been saved."
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        open={blocker.state === "blocked"}
        title="Discard unsaved changes?"
      />
      <ConfirmDialog
        cancel="Keep my draft on screen"
        confirm="Load their version"
        description="Your unsaved changes will be lost."
        onCancel={() => setConfirmReload(false)}
        onConfirm={() => void reloadTheirs()}
        open={confirmReload}
        title="Load the latest version?"
      />
      {record ? <HistorySheet onOpenChange={setHistoryOpen} open={historyOpen} record={record} /> : null}
    </>
  );

  const name = draft.name.trim() || (record ? "Untitled scholarship" : "New scholarship");

  if (archived && record) {
    const view = previewRecord(state.baseline, record);
    return (
      <PageContainer actions={actions} heading={<Breadcrumb name={name} />} overlay={overlay} title={name}>
        <div className="mx-auto w-full max-w-[var(--scholarship-detail-width)] pb-10">
          <ScholarshipDetail
            criteria={evaluateCriteria(view, EMPTY_FACTS)}
            fit={summarizeFit(view, EMPTY_FACTS)}
            linkProfile={false}
            scholarship={view}
          />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer actions={actions} heading={<Breadcrumb name={name} />} overlay={overlay} title={draft.name || "Scholarship"}>
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
  return (
    <Editor
      key={scholarshipId}
      onReload={() => query.refetch().then((result) => result.data)}
      others={others}
      record={isNew ? null : (query.data ?? null)}
    />
  );
}
