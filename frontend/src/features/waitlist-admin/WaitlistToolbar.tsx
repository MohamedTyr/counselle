import { useEffect, useRef, useState } from "react";
import type React from "react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { SOURCES, SOURCE_LABELS } from "@/features/landing/waitlist/contract";
import { PLAN_VALUE_LABELS, PLAN_VALUES, type Filters } from "./derive";

const SEARCH_DEBOUNCE_MS = 250;
const ANY = "any";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function Search({
  value,
  onChange,
}: {
  value: string;
  onChange: (q: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  // The last value this field sent, so its own echo through the URL never
  // overwrites a keystroke typed since.
  const [committed, setCommitted] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // The URL can change from outside a keystroke (back, a shared link).
  // Clear filters remounts this field instead, which also drops a pending
  // debounce.
  if (value !== synced) {
    setSynced(value);
    if (value !== committed) {
      setCommitted(value);
      setDraft(value);
    }
  }

  useEffect(() => {
    if (draft === value) return;
    const timeout = window.setTimeout(() => {
      setCommitted(draft);
      onChange(draft);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target) &&
        !document.querySelector('[role="alertdialog"],[role="menu"]')
      ) {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && event.target === inputRef.current) {
        setDraft("");
        setCommitted("");
        onChange("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChange]);

  return (
    <InputGroup className="w-full sm:max-w-xs">
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search email"
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder="Search email"
        ref={inputRef}
        type="search"
        value={draft}
      />
      <InputGroupAddon align="inline-end" className="max-md:hidden">
        <Kbd>/</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}

function Choice<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value | null;
  options: { value: Value; label: string }[];
  onChange: (value: Value | null) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          {label}: {current?.label ?? "Any"}
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          onValueChange={(next) =>
            onChange(next === ANY ? null : (next as Value))
          }
          value={value ?? ANY}
        >
          <DropdownMenuRadioItem value={ANY}>Any</DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PLAN_OPTIONS = PLAN_VALUES.map((value) => ({
  value,
  label: PLAN_VALUE_LABELS[value],
}));
const SOURCE_OPTIONS = SOURCES.map((value) => ({
  value,
  label: SOURCE_LABELS[value],
}));

export function WaitlistToolbar({
  filters,
  filtered,
  onChange,
  onClearAll,
  searchKey,
  shown,
  total,
}: {
  filters: Filters;
  filtered: boolean;
  onChange: (patch: Partial<Filters>) => void;
  onClearAll: () => void;
  /** Changes whenever the search is cleared from outside the field. */
  searchKey: number;
  shown: number;
  total: number;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Search
        key={searchKey}
        onChange={(q) => onChange({ q })}
        value={filters.q}
      />
      <Choice
        label="Plan"
        onChange={(plan) => onChange({ plan })}
        options={PLAN_OPTIONS}
        value={filters.plan}
      />
      <Choice
        label="From"
        onChange={(from) => onChange({ from })}
        options={SOURCE_OPTIONS}
        value={filters.from}
      />
      {filtered ? (
        <Button onClick={onClearAll} size="sm" variant="ghost">
          Clear filters
        </Button>
      ) : null}
      <p
        aria-live="polite"
        className="ml-auto text-sm text-muted-foreground tabular-nums"
      >
        {shown.toLocaleString()} of {total.toLocaleString()}
      </p>
    </div>
  );
}
