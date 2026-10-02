import {
  DownloadIcon,
  FileTextIcon,
  TrashIcon,
  UploadIcon,
} from "lucide-react";
import type React from "react";
import { useId, useRef, useState } from "react";

import {
  useArchiveDocument,
  useDocuments,
  useUploadDocument,
} from "@/api/workspace/hooks";
import type { Document, DocumentType } from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { documentFileUrl } from "@/api/workspace/documents";
import { ProfileTabFrame } from "@/features/profile/ProfileTabFrame";
import {
  profileEmptySheetClass,
  profileInlineLabelClass,
  profileRowActionClass,
  profileSheetClass,
} from "@/features/profile/profile-control-styles";
import {
  DOCUMENT_STATUS_BADGE_VARIANT,
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPE_OPTIONS,
  documentStatusMessage,
} from "@/features/profile/document-status";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(0)} KB`;
  }
  return `${(kib / 1024).toFixed(1)} MB`;
}

function DocumentRow({ document }: { document: Document }) {
  const archiveDocument = useArchiveDocument();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isReadable = document.text_status === "extracted";

  return (
    <li className="group flex items-start gap-3.5 px-4 py-4">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--control-quiet-surface)] text-[var(--ink-secondary)]"
      >
        <FileTextIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-[var(--ink)]">
            {document.title}
          </span>
          <Badge
            className="rounded-full px-2"
            variant={DOCUMENT_STATUS_BADGE_VARIANT[document.text_status]}
          >
            {DOCUMENT_STATUS_LABEL[document.text_status]}
          </Badge>
        </div>
        <span className="truncate text-xs text-[var(--ink-faint)]">
          {DOCUMENT_TYPE_LABEL[document.doc_type]} · {document.filename} ·{" "}
          {formatBytes(document.size_bytes)}
        </span>
        {/* "Readable" already says what the extracted message would; the
         * other two states need their sentence, so a file Counselle could
         * not read is never left looking understood. */}
        {isReadable ? null : (
          <span className="text-xs text-[var(--ink-secondary)]">
            {documentStatusMessage(document.text_status)}
          </span>
        )}
        {document.summary ? (
          <p className="mt-1 line-clamp-2 max-w-2xl text-sm leading-6 text-[var(--ink-secondary)]">
            {document.summary}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label={`Download ${document.title}`}
          className={profileRowActionClass}
          render={
            <a
              download={document.filename}
              href={documentFileUrl(document.id)}
            />
          }
          size="icon-sm"
          variant="ghost"
        >
          <DownloadIcon />
        </Button>
        <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
          <DialogTrigger asChild>
            <Button
              aria-label={`Delete ${document.title}`}
              className={profileRowActionClass}
              size="icon-sm"
              variant="ghost"
            >
              <TrashIcon />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {document.title}?</DialogTitle>
              <DialogDescription>
                This removes the file from your workspace, so Counselle will no
                longer be able to use it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                disabled={archiveDocument.isPending}
                onClick={() =>
                  archiveDocument.mutate(document.id, {
                    onSuccess: () => setConfirmOpen(false),
                  })
                }
                variant="destructive"
              >
                Delete document
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </li>
  );
}

/** Title and type first, then the file — choosing or dropping one uploads
 * it straight away, under whatever title and type are set. */
function UploadDocumentForm() {
  const uploadDocument = useUploadDocument();
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<DocumentType>("other");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  function upload(file: File) {
    setSelectedFile(file);
    setUploadError(null);
    uploadDocument.mutate(
      {
        docType,
        file,
        title: title.trim() || file.name,
      },
      {
        onError: () => setUploadError("Couldn’t upload this file. Try again."),
        onSuccess: () => {
          setSelectedFile(null);
          setTitle("");
        },
      },
    );
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      upload(file);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !uploadDocument.isPending) {
      upload(file);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-dashed p-4 transition-[background-color,border-color] duration-150 ease-out sm:p-5",
        isDragging
          ? "border-[var(--accent-solid)] bg-[var(--brand-subtle)]"
          : "border-[var(--edge)] bg-[var(--profile-section-surface)]",
      )}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-subtle)] text-[var(--brand-subtle-ink)]"
        >
          <UploadIcon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-[var(--ink)]">
            Add a document
          </span>
          <span className="text-xs text-[var(--ink-secondary)]">
            Drop a file here, or choose one.
          </span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            className={profileInlineLabelClass}
            htmlFor={`${formId}-title`}
          >
            Title
          </label>
          <Input
            id={`${formId}-title`}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Fall transcript"
            size="lg"
            value={title}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className={profileInlineLabelClass} htmlFor={`${formId}-type`}>
            Type
          </label>
          <Select
            items={DOCUMENT_TYPE_OPTIONS}
            onValueChange={(value) => setDocType(value as DocumentType)}
            value={docType}
          >
            <SelectTrigger id={`${formId}-type`} size="lg">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="start">
              <SelectGroup>
                {DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>
        <input
          aria-label="File"
          className="hidden"
          disabled={uploadDocument.isPending}
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        <Button
          disabled={uploadDocument.isPending}
          onClick={() => fileInputRef.current?.click()}
          size="lg"
          type="button"
        >
          {uploadDocument.isPending ? "Uploading…" : "Choose file"}
        </Button>
      </div>
      {selectedFile ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span aria-live="polite" className="text-[var(--ink-secondary)]">
            {uploadDocument.isPending
              ? `Uploading ${selectedFile.name}…`
              : selectedFile.name}
          </span>
          {uploadError ? (
            <>
              <span aria-live="polite" className="text-destructive-foreground">
                {uploadError}
              </span>
              <Button
                onClick={() => upload(selectedFile)}
                size="sm"
                type="button"
                variant="outline"
              >
                Retry upload
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DocumentList() {
  const documentsQuery = useDocuments();
  const documents = documentsQuery.data ?? [];

  if (documentsQuery.isLoading) {
    return <Skeleton className="h-36 w-full rounded-xl" />;
  }

  if (documentsQuery.isError) {
    return (
      <Empty className={profileEmptySheetClass}>
        <EmptyHeader>
          <EmptyTitle>We couldn’t load your documents</EmptyTitle>
          <EmptyDescription>
            Your files are still safe. Try again to see them.
          </EmptyDescription>
        </EmptyHeader>
        <Button
          onClick={() => void documentsQuery.refetch()}
          size="sm"
          variant="outline"
        >
          Try again
        </Button>
      </Empty>
    );
  }

  // With nothing uploaded, the dashed upload box above is the empty state.
  if (documents.length === 0) {
    return null;
  }

  return (
    <ul
      className={cn(
        "divide-y divide-[var(--profile-section-divider)]",
        profileSheetClass,
      )}
    >
      {documents.map((document) => (
        <DocumentRow document={document} key={document.id} />
      ))}
    </ul>
  );
}

export function DocumentsSection() {
  return (
    <ProfileTabFrame
      description="Transcripts, resumes, and anything else worth having on hand when Counselle advises you."
      title="Documents"
    >
      <UploadDocumentForm />
      <DocumentList />
    </ProfileTabFrame>
  );
}
