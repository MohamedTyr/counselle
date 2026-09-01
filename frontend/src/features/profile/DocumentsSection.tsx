import { DownloadIcon, TrashIcon } from "lucide-react";
import type React from "react";
import { useId, useState } from "react";

import {
  useArchiveDocument,
  useDocuments,
  useUploadDocument,
} from "@/api/workspace/hooks";
import type { Document, DocumentType } from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
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
import {
  profileGroupBoxClass,
  profileInlineLabelClass,
} from "@/features/profile/profile-control-styles";
import {
  DOCUMENT_STATUS_BADGE_VARIANT,
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPE_OPTIONS,
  documentStatusMessage,
} from "@/features/profile/document-status";

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

  return (
    <li className={`flex flex-wrap items-center gap-4 ${profileGroupBoxClass}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{document.title}</span>
          <Badge variant="outline">
            {DOCUMENT_TYPE_LABEL[document.doc_type]}
          </Badge>
          <Badge variant={DOCUMENT_STATUS_BADGE_VARIANT[document.text_status]}>
            {DOCUMENT_STATUS_LABEL[document.text_status]}
          </Badge>
        </div>
        <span className="text-xs text-[var(--profile-field-helper)]">
          {documentStatusMessage(document.text_status)}
        </span>
        {document.summary ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {document.summary}
          </p>
        ) : null}
        <span className="text-xs text-[var(--profile-field-helper)]">
          {document.filename} · {formatBytes(document.size_bytes)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-center">
        <Button
          aria-label={`Download ${document.title}`}
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

function UploadDocumentForm() {
  const uploadDocument = useUploadDocument();
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<DocumentType>("other");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputId = useId();

  function upload(file: File) {
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
    if (!file) {
      return;
    }
    setSelectedFile(file);
    upload(file);
  }

  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${profileGroupBoxClass}`}>
      <div className="flex min-w-0 flex-col gap-2">
        <label
          className={profileInlineLabelClass}
          htmlFor={`${fileInputId}-title`}
        >
          Title
        </label>
        <Input
          id={`${fileInputId}-title`}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Fall transcript"
          size="lg"
          value={title}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label
          className={profileInlineLabelClass}
          htmlFor={`${fileInputId}-type`}
        >
          Type
        </label>
        <Select
          items={DOCUMENT_TYPE_OPTIONS}
          onValueChange={(value) => setDocType(value as DocumentType)}
          value={docType}
        >
          <SelectTrigger id={`${fileInputId}-type`} size="lg">
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
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <label className={profileInlineLabelClass} htmlFor={fileInputId}>
          File
        </label>
        <Input
          disabled={uploadDocument.isPending}
          id={fileInputId}
          onChange={handleFileChange}
          size="lg"
          type="file"
        />
      </div>
      {selectedFile ? (
        <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
          <span
            aria-live="polite"
            className="text-[var(--profile-field-helper)]"
          >
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

export function DocumentsSection() {
  const documentsQuery = useDocuments();
  const documents = documentsQuery.data ?? [];

  return (
    <Card className="border-[var(--profile-section-border)] bg-[var(--profile-section-surface)]">
      <CardHeader className="p-5">
        <CardTitle render={<h2 />}>Documents</CardTitle>
        <CardDescription>
          Transcripts, resumes, and anything else worth having on hand — fill
          this in or just upload what you have, Counselle reads everything.
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-5 p-5 pt-0">
        <UploadDocumentForm />
        {documentsQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : documentsQuery.isError ? (
          <Empty>
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
        ) : documents.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No documents yet</EmptyTitle>
              <EmptyDescription>
                Upload a transcript, resume, or anything else — Counselle reads
                everything you give it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <DocumentRow document={document} key={document.id} />
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}
