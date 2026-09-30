import { useId, useState, type FormEvent, type RefObject } from "react";
import { track } from "../analytics";
import {
  emailProblem,
  failure,
  joinFailureMessage,
  submitWaitlist,
  type WaitlistEntry,
} from "./waitlist";
import { LegalConsent } from "./LegalConsent";
import { TRAP_NAME, TrapField } from "./TrapField";

type Props = {
  entry: Omit<WaitlistEntry, "email">;
  label: string;
  action: string;
  /** The email once it is on the list; the field then rests as a receipt. */
  joined: string | null;
  onJoined: (email: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function DrawnCheck() {
  return (
    <svg
      className="lp-wl-drawn-check"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 9.5L7.5 12.5L13.5 5.75"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Validate, send unless the trap was filled, and report either outcome. */
function useEmailSubmit({ entry, joined, onJoined }: Props) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || joined) return;
    const value = email.trim();
    const invalid = emailProblem(value);
    setProblem(invalid);
    if (invalid) return;
    const trap = new FormData(event.currentTarget).get(TRAP_NAME);
    const { side, source, plan } = entry;
    setSending(true);
    try {
      // A filled trap field is a bot; it is told it joined and nothing is sent.
      if (!trap) {
        await submitWaitlist({ ...entry, email: value });
        track("waitlist_joined", { side, source, plan, email: value });
      }
      onJoined(value);
    } catch (error) {
      track("waitlist_failed", {
        side,
        source,
        step: "join",
        ...failure(error),
      });
      setProblem(joinFailureMessage(error));
    } finally {
      setSending(false);
    }
  }
  return { email, setEmail, sending, problem, submit };
}

export function EmailField(props: Props) {
  const { label, action, joined, inputRef } = props;
  const id = useId();
  const { email, setEmail, sending, problem, submit } = useEmailSubmit(props);
  return (
    <form className="lp-wl-form" onSubmit={submit} noValidate>
      <div
        className="lp-wl-field"
        data-joined={joined ? "" : undefined}
        data-sending={sending ? "" : undefined}
        data-invalid={problem ? "" : undefined}
      >
        <label className="lp-wl-sr" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          ref={inputRef}
          className="lp-wl-input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@email.com"
          value={joined ?? email}
          readOnly={joined !== null}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TrapField />
        <button
          className="lp-wl-submit"
          type="submit"
          aria-disabled={sending || joined !== null}
          tabIndex={joined ? -1 : undefined}
        >
          <span className="lp-wl-submit-label">{action}</span>
          <span className="lp-wl-spinner" aria-hidden="true" />
        </button>
        <span className="lp-wl-joined-badge" aria-hidden="true">
          {joined && <DrawnCheck />}
        </span>
      </div>
      <p className="lp-wl-problem" id={`${id}-problem`} role="alert">
        {problem}
      </p>
      {!joined && <LegalConsent className="lp-wl-consent" />}
    </form>
  );
}
