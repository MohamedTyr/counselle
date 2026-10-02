// "Go to date" (plan §2.5): the header title is its trigger, and `.` opens it
// too. A typed date is read by the same parser quick-add uses ("jan 1",
// "next friday", "12/3"); the mini-month beneath it is for pointing.
import { useState, type FormEvent, type ReactElement } from "react";
import { CornerDownLeft } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { InputPrimitive } from "@/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { WEEK_STARTS_ON } from "@/features/calendar/calendar-grid";
import { getNowDate } from "@/lib/time";

async function parseDate(text: string): Promise<Date | null> {
  // chrono-node is loaded on first use, as quick-add loads it.
  const chrono = await import("chrono-node");
  return chrono.parseDate(text, getNowDate(), { forwardDate: true }) ?? null;
}

export function GoToDatePopover({
  anchor,
  children,
  onGoTo,
  onOpenChange,
  open,
}: {
  anchor: Date;
  children: ReactElement;
  onGoTo: (day: Date) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [text, setText] = useState("");
  const [notFound, setNotFound] = useState(false);

  function close() {
    onOpenChange(false);
    setText("");
    setNotFound(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      return;
    }
    const day = await parseDate(text.trim());
    if (!day) {
      setNotFound(true);
      return;
    }
    onGoTo(day);
    close();
  }

  return (
    <Popover
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      open={open}
    >
      <PopoverTrigger render={children} />
      <PopoverPopup align="start" className="w-[17.5rem]" sideOffset={6}>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="relative flex items-center rounded-lg border border-[var(--edge-control)] bg-[var(--field-surface)] transition-[box-shadow] duration-150 ease-out focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
            <InputPrimitive
              aria-describedby={notFound ? "calendar-goto-error" : undefined}
              aria-invalid={notFound || undefined}
              aria-label="Go to date"
              autoFocus
              className="h-9 w-full min-w-0 bg-transparent ps-3 pe-8 text-sm outline-none placeholder:text-[var(--ink-placeholder)]"
              onValueChange={(value: string) => {
                setText(value);
                setNotFound(false);
              }}
              placeholder="Go to a date…"
              value={text}
            />
            <CornerDownLeft
              aria-hidden="true"
              className="pointer-events-none absolute end-2.5 size-3.5 text-[var(--ink-faint)]"
            />
          </label>
          {notFound ? (
            <p
              className="-mt-1 text-xs text-[var(--danger-fg)]"
              id="calendar-goto-error"
            >
              Couldn’t read that date.
            </p>
          ) : null}
        </form>
        <div className="mt-3 border-t border-[var(--hairline)] pt-2">
          <Calendar
            className="p-0 [--cell-size:--spacing(8)] sm:[--cell-size:--spacing(8)]"
            defaultMonth={anchor}
            mode="single"
            onSelect={(day: Date | undefined) => {
              if (day) {
                onGoTo(day);
                close();
              }
            }}
            required
            selected={anchor}
            weekStartsOn={WEEK_STARTS_ON}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
