import { XIcon } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { parseStringList } from "@/features/profile/profile-patch";
import { useFieldDraft } from "@/features/profile/use-field-draft";

function listFromValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** A string list as tags inside one field: Enter or a comma adds what was
 * typed (a pasted "a, b, c" adds three), Backspace on an empty input removes
 * the last tag, and every change saves the whole list — arrays replace
 * wholesale under the merge-patch contract. */
export function ProfileTagInput({
  describedBy,
  inputId,
  onCommit,
  placeholder,
  value,
}: {
  describedBy?: string;
  inputId: string;
  onCommit: (value: string[] | null) => void;
  placeholder?: string;
  value: unknown;
}) {
  const [tags, setTags] = useFieldDraft(listFromValue(value));
  const [text, setText] = useState("");

  function save(next: string[]) {
    setTags(next);
    onCommit(next.length > 0 ? next : null);
  }

  function addFromText() {
    const known = new Set(tags.map((tag) => tag.toLowerCase()));
    const added = (parseStringList(text) ?? []).filter((tag) => {
      const key = tag.toLowerCase();
      if (known.has(key)) {
        return false;
      }
      known.add(key);
      return true;
    });
    setText("");
    if (added.length > 0) {
      save([...tags, ...added]);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addFromText();
      return;
    }
    if (event.key === "Backspace" && text === "" && tags.length > 0) {
      save(tags.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border text-base sm:text-sm border-input bg-[var(--field-surface)] p-1.5 shadow-xs/5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] hover:not-has-focus-visible:border-[var(--edge-control-strong)] sm:min-h-9 sm:p-1">
      {tags.map((tag, index) => (
        <span
          className="inline-flex h-7 max-w-full items-center gap-0.5 rounded-full bg-[var(--control-quiet-surface)] ps-2.5 pe-0.5 text-sm text-[var(--ink)] sm:h-6"
          dir="auto"
          key={`${tag}-${index}`}
        >
          <span className="truncate">{tag}</span>
          <button
            aria-label={`Remove ${tag}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] transition-colors duration-150 outline-none hover:bg-[var(--control-quiet-hover)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:size-5"
            onClick={() => save(tags.filter((_, i) => i !== index))}
            type="button"
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      <Input
        aria-describedby={describedBy}
        className="min-w-24 flex-1"
        id={inputId}
        onBlur={addFromText}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length > 0 ? "Add another" : placeholder}
        size="sm"
        unstyled
        value={text}
      />
    </div>
  );
}
