import { useEffect, useState } from "react";

import { useSearchSchools } from "@/api/cds-admin/hooks";
import type { SchoolSummary } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";

const SEARCH_DEBOUNCE_MS = 250;

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);
  return debounced;
}

function schoolLocation(school: SchoolSummary): string {
  return [school.city, school.state].filter(Boolean).join(", ");
}

/** DESIGN.md §4.6: school is always directly editable, on every row — not
 * just `needs_input` rows. Same trigger for both states; only its visual
 * treatment changes. */
export function SchoolPicker({
  disabled = false,
  onSelect,
  schoolName,
}: {
  disabled?: boolean;
  onSelect: (school: SchoolSummary) => void;
  schoolName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS).trim();
  const search = useSearchSchools(debouncedQuery);
  const results = search.data ?? [];

  function handleSelect(school: SchoolSummary) {
    onSelect(school);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      open={open}
    >
      {schoolName ? (
        <PopoverTrigger
          aria-label={`Change school, currently ${schoolName}`}
          className="-mx-1 block max-w-full truncate rounded-sm px-1 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          disabled={disabled}
        >
          {schoolName}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger disabled={disabled} render={<Button size="sm" variant="outline" />}>
          Pick a school
        </PopoverTrigger>
      )}
      <PopoverPopup align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search schools…"
            value={query}
          />
          <CommandList>
            <CommandEmpty>
              {debouncedQuery
                ? search.isFetching
                  ? "Searching…"
                  : "No school matches."
                : "Type a school name to search."}
            </CommandEmpty>
            <CommandGroup>
              {results.map((school) => (
                <CommandItem
                  key={school.id}
                  onSelect={() => handleSelect(school)}
                  value={`${school.name} ${schoolLocation(school)}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{school.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {schoolLocation(school)}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverPopup>
    </Popover>
  );
}
