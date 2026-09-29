import { useId, useState, type FormEvent, type RefObject } from "react";
import { track } from "../analytics";
import {
  emailProblem,
  failureStatus,
  submitWaitlist,
  type WaitlistEntry,
} from "./waitlist";
import { LegalConsent } from "./LegalConsent";

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

export function EmailField({
  entry,
  label,
  action,
  joined,
  onJoined,
  inputRef,
}: Props) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || joined) return;
    const value = email.trim();
    const invalid = emailProblem(value);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    const trap = new FormData(event.currentTarget).get("website");
    setProblem(null);
    setSending(true);
    try {
      // A filled trap field is a bot; it is told it joined and nothing is sent.
      if (!trap) {
        await submitWaitlist({ ...entry, email: value });
        const { side, source, plan } = entry;
        track("waitlist_joined", { side, source, plan });
      }
      onJoined(value);
    } catch (error) {
      const { side, source } = entry;
      track("waitlist_failed", {
        side,
        source,
        step: "join",
        status: failureStatus(error),
      });
      setProblem("We couldn't reach the list. Try again.");
    } finally {
      setSending(false);
    }
  }

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
        <input
          className="lp-wl-trap"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
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
