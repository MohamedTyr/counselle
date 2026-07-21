import { XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";

/**
 * Accessible tag entry (plan `01-questions-and-data.md` §9 keyboard
 * contract): Enter/comma commits a token, Backspace on an empty input
 * removes the last tag, each tag has a labelled 44px remove button, and
 * duplicate/limit attempts are announced through a polite live region
 * instead of silently no-op'ing.
 */
interface OnboardingTagInputProps {
  label: string;
  helper?: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder?: string;
  id?: string;
}

export function OnboardingTagInput({
  helper,
  id,
  label,
  max,
  onChange,
  placeholder,
  value,
}: OnboardingTagInputProps) {
  const [text, setText] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = `${inputId}-helper`;
  const liveId = `${inputId}-live`;

  function commit() {
    const candidate = text.trim();
    setText("");
    if (candidate === "") return;
    if (value.some((tag) => tag.toLowerCase() === candidate.toLowerCase())) {
      setAnnouncement(`That ${label.toLowerCase()} entry is already added.`);
      return;
    }
    if (value.length >= max) {
      setAnnouncement(
        `You can add up to ${max} here. Add more later in Profile.`,
      );
      return;
    }
    onChange([...value, candidate]);
    setAnnouncement("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function removeTag(index: number) {
    onChange(value.filter((_, tagIndex) => tagIndex !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[15px] font-medium text-[var(--onboarding-foreground)]" htmlFor={inputId}>
        {label}
      </label>
      {helper ? (
        <p className="-mt-1 text-sm text-[var(--onboarding-foreground-soft)]" id={helperId}>
          {helper}
        </p>
      ) : null}
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((tag, index) => (
            <li
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--onboarding-selected-border)] bg-[var(--onboarding-selected-surface)] py-1 pr-1 pl-3.5 text-sm text-[var(--onboarding-foreground)]"
              key={`${tag}-${index}`}
            >
              {tag}
              <button
                aria-label={`Remove ${tag}`}
                className="flex size-11 shrink-0 items-center justify-center text-[var(--onboarding-muted-foreground)] hover:text-[var(--onboarding-foreground)]"
                onClick={() => removeTag(index)}
                type="button"
              >
                <XIcon aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        aria-describedby={helper ? helperId : undefined}
        id={inputId}
        onBlur={commit}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        value={text}
      />
      <div aria-live="polite" className="sr-only" id={liveId} role="status">
        {announcement}
      </div>
    </div>
  );
}
