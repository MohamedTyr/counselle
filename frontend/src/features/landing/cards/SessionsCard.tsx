import { Check } from "lucide-react";
import "./sessions-card.css";

const PICKED = "Thu 4:30";
/** Every day offers the same three rows; a taken time is prefixed with "-". */
const DAYS = [
  { weekday: "Mon", date: 19, times: ["3:30", "-4:30", "5:00"] },
  { weekday: "Tue", date: 20, times: ["-3:30", "4:00", "-5:30"] },
  { weekday: "Wed", date: 21, times: ["3:30", "4:30", "6:00"] },
  { weekday: "Thu", date: 22, times: ["4:00", "4:30", "5:30"] },
  { weekday: "Fri", date: 23, times: ["3:00", "-4:00", "5:00"] },
];

/** Pick a time, and the session is booked. */
export function SessionsSheet() {
  return (
    <div className="lp-sheet lp-sheet-wide lp-book-sheet" aria-hidden="true">
      <div className="lp-book-week">
        <p className="lp-book-heading">Pick a time</p>
        <div className="lp-book-days">
          {DAYS.map(({ weekday, date, times }) => (
            <div
              key={weekday}
              className="lp-book-day"
              data-chosen={PICKED.startsWith(weekday) ? "" : undefined}
            >
              <p>
                {weekday}
                <b>{date}</b>
              </p>
              {times.map((time) => (
                <span
                  key={time}
                  data-taken={time.startsWith("-") ? "" : undefined}
                  data-picked={`${weekday} ${time}` === PICKED ? "" : undefined}
                >
                  {time.replace("-", "")}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="lp-book-card">
        <p className="lp-book-status">
          <span>
            <Check size={13} strokeWidth={2.6} />
          </span>
          Booked
        </p>
        <p className="lp-book-when">
          Thu, Oct 22
          <span>4:30 PM</span>
        </p>
        <p className="lp-book-count">
          <i />
          <i />2 of 2
        </p>
      </div>
    </div>
  );
}
