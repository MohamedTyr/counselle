import { useState } from "react";
import type React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PLAN_LABELS,
  SOURCE_LABELS,
  type WaitlistRow,
} from "@/features/landing/waitlist/contract";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  CLASS_LABELS,
  classOf,
  isNew,
  WHO_LABELS,
  whoOf,
  type SortDir,
} from "./derive";
import { posthogPersonUrl } from "./links";

export const PAGE_SIZE = 200;
/** Columns hidden on narrow screens, so the table never scrolls sideways. */
const WIDE = "max-md:hidden";
/** The header stays put inside the PageContainer scroll column. */
const HEAD = "sticky top-0 z-[var(--z-sticky)] bg-background";
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

async function copyEmail(email: string) {
  try {
    await navigator.clipboard.writeText(email);
    toast.success(`Copied ${email}`);
  } catch {
    toast.error("Could not copy the email");
  }
}

function RowMenu({
  email,
  onDelete,
}: {
  email: string;
  onDelete: (email: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Actions for ${email}`}
          size="icon-sm"
          variant="ghost"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void copyEmail(email)}>
          <CopyIcon aria-hidden="true" />
          Copy email
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={posthogPersonUrl(email)}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon aria-hidden="true" />
            Open in PostHog
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onDelete(email)}
          variant="destructive"
        >
          <Trash2Icon aria-hidden="true" />
          Delete signup…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ClassCell({ row }: { row: WaitlistRow }) {
  const value = classOf(row);
  if (value === null) return <Muted>Not asked</Muted>;
  if (value === "unanswered") return <Muted>{CLASS_LABELS[value]}</Muted>;
  return <span className="tabular-nums">{value}</span>;
}

function ChannelCell({ row }: { row: WaitlistRow }) {
  const {
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
  } = row;
  if (!source && !medium && !campaign) return <Muted>Untagged</Muted>;
  const detail = [medium, campaign].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate">{source ?? <Muted>No source</Muted>}</span>
      {detail ? (
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  );
}

function SignupRow({
  row,
  lastSeen,
  onDelete,
}: {
  row: WaitlistRow;
  lastSeen: string | null;
  onDelete: (email: string) => void;
}) {
  const who = whoOf(row);
  const fresh = isNew(row, lastSeen);
  return (
    <TableRow>
      <TableCell className="max-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              fresh && "bg-[var(--waitlist-chart-mark)]",
            )}
          />
          {fresh ? <span className="sr-only">New</span> : null}
          <span
            className="font-medium leading-snug max-md:whitespace-normal max-md:[overflow-wrap:anywhere] md:truncate"
            title={row.email}
          >
            {row.email}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <time className="tabular-nums" dateTime={row.created_at}>
              {formatRelativeTime(row.created_at)}
              <span className="sr-only">
                , {DATE_TIME.format(new Date(row.created_at))}
              </span>
            </time>
          </TooltipTrigger>
          <TooltipContent>
            {DATE_TIME.format(new Date(row.created_at))}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="truncate">
        {who === "unanswered" ? (
          <Muted>{WHO_LABELS[who]}</Muted>
        ) : (
          WHO_LABELS[who]
        )}
      </TableCell>
      <TableCell className={WIDE}>
        <ClassCell row={row} />
      </TableCell>
      <TableCell className={WIDE}>
        {row.plan ? PLAN_LABELS[row.plan] : <Muted>Not chosen</Muted>}
      </TableCell>
      <TableCell className={cn(WIDE, "truncate")}>
        {SOURCE_LABELS[row.source]}
      </TableCell>
      <TableCell className={cn(WIDE, "max-w-0")}>
        <ChannelCell row={row} />
      </TableCell>
      <TableCell className="text-right">
        <RowMenu email={row.email} onDelete={onDelete} />
      </TableCell>
    </TableRow>
  );
}

function JoinedHeader({
  dir,
  onDir,
}: {
  dir: SortDir;
  onDir: (dir: SortDir) => void;
}) {
  const Arrow = dir === "desc" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <TableHead
      aria-sort={dir === "desc" ? "descending" : "ascending"}
      className={cn(HEAD, "w-26 md:w-28")}
    >
      <button
        className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 transition-colors duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        onClick={() => onDir(dir === "desc" ? "asc" : "desc")}
        type="button"
      >
        Joined
        <Arrow aria-hidden="true" className="size-3.5" />
      </button>
    </TableHead>
  );
}

export function WaitlistTable({
  rows,
  lastSeen,
  dir,
  onDir,
  onDelete,
}: {
  rows: WaitlistRow[];
  lastSeen: string | null;
  dir: SortDir;
  onDir: (dir: SortDir) => void;
  onDelete: (email: string) => void;
}): React.ReactElement {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [shownFor, setShownFor] = useState(rows);
  // A new filter, search or sort starts again from the first page.
  if (shownFor !== rows) {
    setShownFor(rows);
    setLimit(PAGE_SIZE);
  }
  const visible = rows.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <Table
        className="table-fixed"
        render={<div className="relative w-full" />}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "md:w-[30%]")}>Email</TableHead>
            <JoinedHeader dir={dir} onDir={onDir} />
            <TableHead className={cn(HEAD, "w-22 md:w-24")}>Who</TableHead>
            <TableHead className={cn(HEAD, WIDE, "w-24")}>Class</TableHead>
            <TableHead className={cn(HEAD, WIDE, "w-24")}>Plan</TableHead>
            <TableHead className={cn(HEAD, WIDE, "w-32")}>From</TableHead>
            <TableHead className={cn(HEAD, WIDE)}>Channel</TableHead>
            <TableHead className={cn(HEAD, "w-11 md:w-12")}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <SignupRow
              key={row.email}
              lastSeen={lastSeen}
              onDelete={onDelete}
              row={row}
            />
          ))}
        </TableBody>
      </Table>
      {rows.length > limit ? (
        <Button
          className="self-center"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
          variant="outline"
        >
          Show {Math.min(PAGE_SIZE, rows.length - limit)} more
        </Button>
      ) : null}
    </div>
  );
}
