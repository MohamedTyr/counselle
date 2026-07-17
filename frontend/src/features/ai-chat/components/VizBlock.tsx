import type { ReactNode } from "react";

import type {
  CitationEnvelope,
  RenderSpec,
  SourceFocus,
  TabularRenderSpec,
} from "@/api/chat/types";
import { isTabularRenderSpec } from "@/api/chat/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { faviconUrlForDomain } from "../citations";

export type VizBlockProps = {
  spec: RenderSpec;
  onSourceOpen?: (focus: SourceFocus) => void;
};

function markerIndex(marker: string | null | undefined): number | undefined {
  const match = /^\[([1-9]\d*)\]$/.exec(marker ?? "");
  return match === null ? undefined : Number(match[1]);
}

function CellValue({
  cell,
  onSourceOpen,
}: {
  cell: CitationEnvelope;
  onSourceOpen?: (focus: SourceFocus) => void;
}) {
  if (!cell.available || cell.citation === null) {
    return <span className="text-muted-foreground italic">not available</span>;
  }

  const index = markerIndex(cell.marker);
  const focus =
    index === undefined
      ? undefined
      : {
          index,
          ...(cell.citation.source === "cds" && cell.field !== null
            ? { evidenceId: cell.field }
            : {}),
        };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-foreground [overflow-wrap:anywhere]">
      <span>{cell.display}</span>
      {focus === undefined ? (
        <Badge variant={cell.citation.tier === "official" ? "secondary" : "outline"}>
          {cell.citation.tier === "official" ? "Official" : "Community"}
        </Badge>
      ) : (
        <Button
          aria-label={`Open ${cell.citation.tier} source ${focus.index}`}
          className="h-6 px-2 text-[10px]"
          onClick={() => onSourceOpen?.(focus)}
          size="sm"
          type="button"
          variant={cell.citation.tier === "official" ? "secondary" : "outline"}
        >
          {cell.citation.tier === "official" ? "Official" : "Community"}
        </Button>
      )}
    </span>
  );
}

function VizFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="not-prose my-3 max-w-full overflow-hidden rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-medium text-foreground">{title}</div>
      {children}
    </div>
  );
}

function SchoolHeading({ school, index }: { school: TabularRenderSpec["columns"][number]; index: number }) {
  const key = school.unitid === null
    ? `web:${school.name}:${school.domain ?? ""}:${index}`
    : `db:${school.unitid}:${index}`;
  return (
    <th className="py-1.5 pr-3 text-left font-medium text-foreground" key={key}>
      <span className="inline-flex items-center gap-2">
        {school.domain !== null && school.domain !== undefined && (
          <img alt="" className="size-4 rounded-sm" src={faviconUrlForDomain(school.domain)} />
        )}
        {school.name}
      </span>
    </th>
  );
}

function StatBlockView({ spec, onSourceOpen }: { spec: TabularRenderSpec; onSourceOpen?: (focus: SourceFocus) => void }) {
  return (
    <VizFrame title={spec.title}>
      <div className="mb-2 text-xs text-muted-foreground">{spec.columns[0]?.name}</div>
      <dl className="flex flex-col gap-1.5">
        {spec.rows.map((row, index) => (
          <div className="flex items-baseline justify-between gap-3 text-sm" key={`${row.label}-${index}`}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium">
              <CellValue cell={row.cells[0]} onSourceOpen={onSourceOpen} />
            </dd>
          </div>
        ))}
      </dl>
    </VizFrame>
  );
}

function ComparisonTableView({ spec, onSourceOpen }: { spec: TabularRenderSpec; onSourceOpen?: (focus: SourceFocus) => void }) {
  return (
    <VizFrame title={spec.title}>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b">
            <th className="py-1.5 pr-3 text-left font-medium text-muted-foreground">&nbsp;</th>
            {spec.columns.map((school, index) => <SchoolHeading index={index} school={school} key={school.unitid === null ? `web:${school.name}:${school.domain ?? ""}:${index}` : `db:${school.unitid}:${index}`} />)}
          </tr></thead>
          <tbody>
            {spec.rows.map((row, rowIndex) => (
              <tr className="border-b last:border-b-0" key={`${row.label}-${rowIndex}`}>
                <th className="py-1.5 pr-3 text-left font-normal text-muted-foreground">{row.label}</th>
                {row.cells.map((cell, columnIndex) => (
                  <td className="py-1.5 pr-3" key={`${rowIndex}-${columnIndex}`}>
                    <CellValue cell={cell} onSourceOpen={onSourceOpen} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </VizFrame>
  );
}

function UnknownVizFallback({ spec }: { spec: RenderSpec }) {
  return (
    <VizFrame title={spec.title ?? "Visualization"}>
      <p className="text-sm text-muted-foreground">This visualization requires a newer client.</p>
    </VizFrame>
  );
}

export function VizBlock({ spec, onSourceOpen }: VizBlockProps) {
  if (!isTabularRenderSpec(spec)) {
    return <UnknownVizFallback spec={spec} />;
  }
  return spec.type === "stat_block"
    ? <StatBlockView onSourceOpen={onSourceOpen} spec={spec} />
    : <ComparisonTableView onSourceOpen={onSourceOpen} spec={spec} />;
}
