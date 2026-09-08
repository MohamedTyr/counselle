import { Check } from "lucide-react";
import type React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  Fact,
  MatrixRow,
  MatrixValue,
} from "@/features/schools/facts/school-facts-types";

/*
 * `matrix` kind facts (plan §5.2) — the one sanctioned DESIGN.md §17.6
 * exception to the two-column FactTable: a boolean matrix (sports x
 * gender) loses its meaning stacked into name/value rows.
 *
 * The wire's `table` kind (as distinct from `matrix`) has no producer --
 * `domain/facts/normalize.py::normalize_table` is never called from the
 * mapper (`school-facts-types.ts`'s `TableValue` says so explicitly) --
 * so this file deliberately renders no generic-table shape for it (Phase 2
 * review, Finding 6): a renderer for a shape nothing produces is debt plus
 * an honesty landmine (its only plausible cell-formatting rule would be a
 * frontend-authored "Not reported" literal, exactly what this page's
 * honesty rule forbids). `fact.kind === "table"` therefore renders nothing
 * here; add a real renderer only once a producer exists to test it against.
 *
 * `overflow-x-auto` with `role="region"` + `tabindex="0"` + `aria-label` so
 * the scroll container is keyboard-reachable (DESIGN §16.1) — the house
 * `Table` primitive already wraps this way.
 *
 * A `false` matrix cell is a real "no", never a missing cell: it renders an
 * `--ink-faint` en-dash WITH an `aria-label` and a `title`, so the honesty
 * rule (an absent value is never a blank cell) also holds for a boolean the
 * source printed as "not offered".
 */

function isMatrixValue(value: unknown): value is MatrixValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as MatrixValue).rows)
  );
}

export function TableBlock({ fact }: { fact: Fact }): React.ReactElement | null {
  if (fact.kind === "matrix" && isMatrixValue(fact.value)) {
    return <MatrixTable fact={fact} rows={fact.value.rows} />;
  }
  return null;
}

function MatrixTable({
  fact,
  rows,
}: {
  fact: Fact;
  rows: MatrixRow[];
}): React.ReactElement | null {
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0]).filter((key) => key !== "label");

  return (
    <Table
      render={
        <div
          aria-label={fact.label}
          className="relative w-full overflow-x-auto"
          role="region"
          tabIndex={0}
        />
      }
    >
      <TableHeader>
        <TableRow>
          <TableCell className="ps-0 text-xs font-medium text-[var(--school-fact-label)]">
            {fact.label}
          </TableCell>
          {columns.map((column) => (
            <TableCell
              className="text-center text-xs font-medium text-[var(--school-fact-label)]"
              key={column}
            >
              {column}
            </TableCell>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="ps-0 text-sm whitespace-normal text-[var(--school-fact-label)]">
              {row.label}
            </TableCell>
            {columns.map((column) => (
              <BoolCell key={column} value={Boolean(row[column])} />
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BoolCell({ value }: { value: boolean }): React.ReactElement {
  if (value) {
    return (
      <TableCell className="text-center">
        <Check
          aria-label="Offered"
          className="mx-auto size-4 text-[var(--school-fact-value)]"
        />
      </TableCell>
    );
  }
  return (
    <TableCell className="text-center">
      <span
        aria-label="Not offered"
        className="text-[var(--school-fact-absent)]"
        title="Not offered"
      >
        &ndash;
      </span>
    </TableCell>
  );
}
