import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { isDbSource } from "../citations";

/**
 * The wire shape a `viz` block carries. Typed loosely (not the exact
 * `RenderSpec` union) on purpose: this component is the last line of
 * defense against a server that ships a `type` this client doesn't know
 * about yet, so `type` is treated as an open string here rather than the
 * two-member literal union the rest of the app assumes.
 */
export type VizRenderSpecLike = {
  v: number;
  type: string;
  title: string;
  schools: ReadonlyArray<{ unitid: number; name: string; domain?: string | null }>;
  rows: ReadonlyArray<{
    label: string;
    cells: ReadonlyArray<
      | {
          v: number;
          field: string;
          label: string;
          display: string;
          raw?: number | boolean | string | null;
          available: boolean;
          unit?: string | null;
          citation: { source: string; tier: string; vintage: string };
        }
      | undefined
    >;
  }>;
};

export type VizBlockProps = {
  spec: VizRenderSpecLike;
};

function CellValue({ cell }: { cell: VizRenderSpecLike["rows"][number]["cells"][number] }) {
  if (cell === undefined || !cell.available) {
    return <span className="text-muted-foreground italic">not available</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-foreground [overflow-wrap:anywhere]">
      {cell.display}
      {isDbSource(cell.citation.source) && (
        <Badge className="text-[10px]" variant="secondary">
          Counselle data
        </Badge>
      )}
    </span>
  );
}

function VizFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-medium text-foreground">{title}</div>
      {children}
    </div>
  );
}

function StatBlockView({ spec }: { spec: VizRenderSpecLike }) {
  return (
    <VizFrame title={spec.title}>
      <dl className="space-y-1.5">
        {spec.rows.map((row, index) => (
          <div className="flex items-baseline justify-between gap-3 text-sm" key={`${row.label}-${index}`}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium">
              <CellValue cell={row.cells[0]} />
            </dd>
          </div>
        ))}
      </dl>
    </VizFrame>
  );
}

function ComparisonTableView({ spec }: { spec: VizRenderSpecLike }) {
  return (
    <VizFrame title={spec.title}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1.5 pr-3 text-left font-medium text-muted-foreground">
                &nbsp;
              </th>
              {spec.schools.map((school) => (
                <th
                  className="py-1.5 pr-3 text-left font-medium text-foreground"
                  key={school.unitid}
                >
                  {school.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, rowIndex) => (
              <tr className="border-b last:border-b-0" key={`${row.label}-${rowIndex}`}>
                <th className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
                  {row.label}
                </th>
                {spec.schools.map((school, schoolIndex) => (
                  <td className="py-1.5 pr-3" key={school.unitid}>
                    <CellValue cell={row.cells[schoolIndex]} />
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

/**
 * UnknownVizFallback — the degrade path (ported from the old app's
 * MarkdownFallbackCard rule): a spec whose `type` this client doesn't
 * recognize (a server-added render kind, or malformed data) never crashes
 * and never renders blank. It falls back to a plain titled card of
 * `label: value` lines, using the exact same availability rule as the known
 * cards, so an unrecognized spec is degraded but never dishonest.
 */
function UnknownVizFallback({ spec }: { spec: VizRenderSpecLike }) {
  return (
    <VizFrame title={spec.title}>
      <div className={cn("space-y-1")}>
        {(spec.rows ?? []).map((row, index) => (
          <div className="text-sm text-foreground [overflow-wrap:anywhere]" key={`${row.label}-${index}`}>
            {row.label}: <CellValue cell={row.cells[0]} />
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

export function VizBlock({ spec }: VizBlockProps) {
  switch (spec.type) {
    case "stat_block":
      return <StatBlockView spec={spec} />;
    case "comparison_table":
      return <ComparisonTableView spec={spec} />;
    default:
      return <UnknownVizFallback spec={spec} />;
  }
}
