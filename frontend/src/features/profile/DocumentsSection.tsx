import { DownloadIcon, TrashIcon } from "lucide-react"
import type React from "react"
import { useId, useState } from "react"

import {
  useArchiveDocument,
  useDocuments,
  useUploadDocument,
} from "@/api/workspace/hooks"
import type { Document, DocumentType } from "@/api/workspace/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { documentFileUrl } from "@/api/workspace/documents"
import {
  DOCUMENT_STATUS_BADGE_VARIANT,
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPE_OPTIONS,
  documentStatusMessage,
} from "@/features/profile/document-status"

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kib = bytes / 1024
  if (kib < 1024) {
    return `${kib.toFixed(0)} KB`
  }
  return `${(kib / 1024).toFixed(1)} MB`
}

function DocumentRow({ document }: { document: Document }) {
  const archiveDocument = useArchiveDocument()

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {document.title}
          </span>
          <Badge variant="outline">{DOCUMENT_TYPE_LABEL[document.doc_type]}</Badge>
          <Badge variant={DOCUMENT_STATUS_BADGE_VARIANT[document.text_status]}>
            {DOCUMENT_STATUS_LABEL[document.text_status]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {documentStatusMessage(document.text_status)}
        </span>
        {document.summary ? (
          <p className="text-sm text-muted-foreground">{document.summary}</p>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {document.filename} · {formatBytes(document.size_bytes)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
        <Button
          aria-label={`Delete ${document.title}`}
          disabled={archiveDocument.isPending}
          onClick={() => archiveDocument.mutate(document.id)}
          size="icon-sm"
          variant="ghost"
        >
          <TrashIcon />
        </Button>
      </div>
    </li>
  )
}

function UploadDocumentForm() {
  const uploadDocument = useUploadDocument()
  const [title, setTitle] = useState("")
  const [docType, setDocType] = useState<DocumentType>("other")
  const fileInputId = useId()

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) {
      return
    }
    uploadDocument.mutate({
      docType,
      file,
      title: title.trim() || file.name,
    })
    setTitle("")
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${fileInputId}-title`}>
          Title
        </label>
        <Input
          id={`${fileInputId}-title`}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Fall transcript"
          size="sm"
          value={title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${fileInputId}-type`}>
          Type
        </label>
        <Select
          items={DOCUMENT_TYPE_OPTIONS}
          onValueChange={(value) => setDocType(value as DocumentType)}
          value={docType}
        >
          <SelectTrigger id={`${fileInputId}-type`} size="sm">
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
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={fileInputId}>
          File
        </label>
        <Input
          disabled={uploadDocument.isPending}
          id={fileInputId}
          onChange={handleFileChange}
          size="sm"
          type="file"
        />
      </div>
    </div>
  )
}

export function DocumentsSection() {
  const documentsQuery = useDocuments()
  const documents = documentsQuery.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle render={<h2 />}>Documents</CardTitle>
        <CardDescription>
          Transcripts, resumes, and anything else worth having on hand — fill
          this in or just upload what you have, Counselle reads everything.
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        <UploadDocumentForm />
        {documents.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No documents yet</EmptyTitle>
              <EmptyDescription>
                Upload a transcript, resume, or anything else — Counselle
                reads everything you give it.
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
  )
}
