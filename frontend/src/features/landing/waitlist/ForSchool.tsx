import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CheckRows } from "./CheckRows";
import { DrawnCheck, EmailField } from "./EmailField";
import {
  BOOKING_EMBED_URL,
  BOOKING_PAGE_URL,
  CONTACT_EMAIL,
  type WaitlistEntry,
} from "./waitlist";

const POINTS = [
  "A walkthrough on a real caseload",
  "Pricing for your school",
  "Your questions, answered",
];
const SKELETON_DAYS = 35;

/** Google confirms a booking inside its own frame; the page is not told. */
function Calendar() {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="lp-wl-frame" data-loaded={loaded ? "" : undefined}>
      <div className="lp-wl-skeleton" aria-hidden="true">
        <span className="lp-wl-skeleton-month" />
        <div className="lp-wl-skeleton-grid">
          {Array.from({ length: SKELETON_DAYS }, (_, day) => (
            <span key={day} />
          ))}
        </div>
      </div>
      <iframe
        title="Pick a time for a call"
        src={BOOKING_EMBED_URL}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function Receipt({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="lp-wl-frame lp-wl-receipt lp-wl-swap">
      <span className="lp-wl-receipt-badge">
        <DrawnCheck />
      </span>
      <p className="lp-wl-receipt-title">{title}</p>
      <p className="lp-wl-receipt-detail">{detail}</p>
      <Dialog.Close className="lp-wl-done">Done</Dialog.Close>
    </div>
  );
}

export function ForSchool({ entry }: { entry: Omit<WaitlistEntry, "email"> }) {
  const [emailed, setEmailed] = useState(false);
  const [byEmail, setByEmail] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (byEmail) field.current?.focus();
  }, [byEmail]);

  return (
    <>
      <div className="lp-wl-slot">
        <Dialog.Title className="lp-wl-title">
          Bring it to your <em>school</em>
        </Dialog.Title>
        <CheckRows rows={POINTS} />
        <a className="lp-wl-link lp-wl-mail" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </div>
      <div className="lp-wl-rest">
        <p className="lp-wl-rest-head">Pick a time</p>
        {emailed ? (
          <Receipt
            title="We'll be in touch"
            detail="Expect an email from us with a few times."
          />
        ) : (
          <Calendar />
        )}
        {!emailed && byEmail && (
          <div className="lp-wl-by-email lp-wl-swap">
            <EmailField
              entry={entry}
              label="Work email"
              action="Request a call"
              joined={null}
              onJoined={() => setEmailed(true)}
              inputRef={field}
            />
          </div>
        )}
        {!emailed && (
          <p className="lp-wl-foot">
            {!byEmail && (
              <button
                type="button"
                className="lp-wl-link"
                onClick={() => setByEmail(true)}
              >
                No time that works?
              </button>
            )}
            <a
              className="lp-wl-link"
              href={BOOKING_PAGE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Open in a new tab
            </a>
          </p>
        )}
      </div>
    </>
  );
}
