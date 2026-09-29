import { useState, type KeyboardEvent, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { EmailField } from "./EmailField";
import { CheckRows } from "./CheckRows";
import { track } from "../analytics";
import { submitWaitlist, type WaitlistEntry } from "./waitlist";
import { CLASS_YEARS, ROLES, type ClassYear, type Role } from "./contract";

const POINTS = [
  "Essay feedback, line by line",
  "A school list built around you",
  "Deadlines, scholarships and SAT practice",
];
const ROLE_LABELS: Record<Role, string> = {
  student: "Student",
  parent: "Parent",
  counselor: "Counselor",
};
const ROLE_OPTIONS = ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));
const CLASS_OPTIONS = CLASS_YEARS.map((value) => ({ value, label: value }));

type ChipsProps<Value extends string> = {
  label: string;
  options: { value: Value; label: string }[];
  value: Value | undefined;
  onChange: (value: Value) => void;
};

function Chips<Value extends string>({
  label,
  options,
  value,
  onChange,
}: ChipsProps<Value>) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const chips = [...event.currentTarget.querySelectorAll("button")];
    const at = chips.indexOf(document.activeElement as HTMLButtonElement);
    const next = chips[(at + step + chips.length) % chips.length];
    next.focus();
    next.click();
  }
  const tabStop = value ?? options[0].value;
  return (
    <div className="lp-wl-question">
      <p className="lp-wl-question-label">{label}</p>
      <div
        className="lp-wl-chips"
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            className="lp-wl-chip"
            aria-checked={option.value === value}
            tabIndex={option.value === tabStop ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type Answers = { role?: Role; classOf?: ClassYear };

type Props = {
  entry: Omit<WaitlistEntry, "email">;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function ForMe({ entry, inputRef }: Props) {
  const [joined, setJoined] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [unsaved, setUnsaved] = useState(false);

  async function answer(next: Answers) {
    if (!joined) return;
    const before = answers;
    setAnswers(next);
    setUnsaved(false);
    try {
      await submitWaitlist({ ...entry, ...next, email: joined });
      track("waitlist_details", { role: next.role, class_of: next.classOf });
    } catch {
      setAnswers(before);
      setUnsaved(true);
    }
  }

  return (
    <>
      <div className="lp-wl-slot">
        <Dialog.Title
          className={joined ? "lp-wl-title lp-wl-swap" : "lp-wl-title"}
          key={joined ? "joined" : "open"}
        >
          {joined ? (
            <>
              You&rsquo;re on the <em>list</em>
            </>
          ) : (
            <>
              Get in <em>early</em>
            </>
          )}
        </Dialog.Title>
        <p
          className={joined ? "lp-wl-lede lp-wl-swap" : "lp-wl-lede"}
          key={joined ? "joined-lede" : "lede"}
        >
          {joined
            ? "We'll email you when we open."
            : "One email, when we open."}
        </p>
        <EmailField
          entry={entry}
          label="Email address"
          action="Join waitlist"
          joined={joined}
          onJoined={setJoined}
          inputRef={inputRef}
        />
        {joined && (
          <button
            type="button"
            className="lp-wl-link lp-wl-undo"
            onClick={() => {
              setJoined(null);
              setAnswers({});
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            Wrong email?
          </button>
        )}
      </div>
      {joined ? (
        <div className="lp-wl-rest lp-wl-swap">
          <Chips
            label="I'm a"
            options={ROLE_OPTIONS}
            value={answers.role}
            onChange={(role) => void answer({ ...answers, role })}
          />
          {answers.role !== "counselor" && (
            <Chips
              label="Class of"
              options={CLASS_OPTIONS}
              value={answers.classOf}
              onChange={(classOf) => void answer({ ...answers, classOf })}
            />
          )}
          <p className="lp-wl-problem" role="alert">
            {unsaved ? "We couldn't save that. Try again." : null}
          </p>
          <Dialog.Close className="lp-wl-done">Done</Dialog.Close>
        </div>
      ) : (
        <div className="lp-wl-rest">
          <CheckRows rows={POINTS} />
        </div>
      )}
    </>
  );
}
