import { useState } from "react";
import { BadgeCheck, BadgeMinus, BadgeX } from "lucide-react";
import acceptra from "../assets/counselle.svg";
import chatgpt from "../assets/compare-chatgpt.svg";
import "./compare.css";

type State = "yes" | "partial" | "no";
type Cell = { state: State; note: string } | { price: string };

const OPTIONS = [
  { id: "acceptra", name: "Acceptra", logo: acceptra },
  { id: "chatgpt", name: "ChatGPT", logo: chatgpt },
  { id: "counselor", name: "Private counselor", logo: null },
];
/** The alternatives a narrow screen shows one at a time beside Acceptra. */
const RIVALS = OPTIONS.slice(1);

/** Cells follow OPTIONS order. Counselor rates are the range published by
    IECA and 2026 price guides. */
const ROWS: { label: string; cells: Cell[] }[] = [
  {
    label: "Essay feedback",
    cells: [
      { state: "yes", note: "Line by line, in minutes" },
      { state: "partial", note: "Generic notes" },
      { state: "yes", note: "Days per draft" },
    ],
  },
  {
    label: "College list matched to you",
    cells: [
      { state: "yes", note: "Reach, target, safety" },
      { state: "partial", note: "Generic picks" },
      { state: "yes", note: "From experience" },
    ],
  },
  {
    label: "School facts refreshed daily",
    cells: [
      { state: "yes", note: "Never guessed" },
      { state: "partial", note: "Can be out of date" },
      { state: "partial", note: "From memory" },
    ],
  },
  {
    label: "Scholarships matched to you",
    cells: [
      { state: "yes", note: "Ranked for you" },
      { state: "partial", note: "Web search" },
      { state: "partial", note: "Varies by counselor" },
    ],
  },
  {
    label: "Activities and summer programs",
    cells: [
      { state: "yes", note: "Matched to you" },
      { state: "partial", note: "Generic lists" },
      { state: "partial", note: "Varies by counselor" },
    ],
  },
  {
    label: "SAT practice",
    cells: [
      { state: "yes", note: "Official questions" },
      { state: "partial", note: "Made-up questions" },
      { state: "no", note: "A separate tutor" },
    ],
  },
  {
    label: "Tasks and deadlines",
    cells: [
      { state: "yes", note: "Every school’s dates" },
      { state: "partial", note: "Reminders only" },
      { state: "partial", note: "Checked at meetings" },
    ],
  },
  {
    label: "There when you need it",
    cells: [
      { state: "yes", note: "Any hour" },
      { state: "yes", note: "Any hour" },
      { state: "no", note: "By appointment" },
    ],
  },
  {
    label: "A real person",
    cells: [
      { state: "yes", note: "Mentor calls on paid plans" },
      { state: "no", note: "No" },
      { state: "yes", note: "Every session" },
    ],
  },
  {
    label: "Price",
    cells: [
      { price: "Free, or $20 a month" },
      { price: "Free, or $20 a month" },
      { price: "$140 to $300 an hour" },
    ],
  },
];

const STATE_LABEL: Record<State, string> = {
  yes: "Yes",
  partial: "Partly",
  no: "No",
};

const STATE_ICON = { yes: BadgeCheck, partial: BadgeMinus, no: BadgeX };

function StateIcon({ state }: { state: State }) {
  const Icon = STATE_ICON[state];
  return (
    <Icon
      className="lp-compare-icon"
      size={22}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  );
}

function CompareCell({ cell, option }: { cell: Cell; option: string }) {
  if ("price" in cell)
    return (
      <td role="cell" data-option={option}>
        {cell.price}
      </td>
    );
  const { state, note } = cell;
  const label = STATE_LABEL[state];
  return (
    <td role="cell" data-option={option} data-state={state}>
      <span className="lp-compare-cell">
        <StateIcon state={state} />
        <span>
          {note !== label && (
            <span className="lp-compare-hidden">{label}. </span>
          )}
          {note}
        </span>
      </span>
    </td>
  );
}

/** Below the four-column width, one alternative stands beside Acceptra. */
function RivalPicker({
  rival,
  onPick,
}: {
  rival: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="lp-compare-picker" role="group" aria-label="Compare with">
      <span className="lp-compare-picker-label" aria-hidden="true">
        Compare with
      </span>
      <div className="lp-compare-picker-track">
        {RIVALS.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            aria-pressed={rival === id}
            onClick={() => onPick(id)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Compare() {
  const [rival, setRival] = useState(RIVALS[0].id);
  return (
    <section
      className="lp-compare"
      id="compare"
      aria-labelledby="compare-heading"
    >
      <h2 className="lp-heading" id="compare-heading">
        How Acceptra compares
      </h2>
      <RivalPicker rival={rival} onPick={setRival} />
      <div className="lp-compare-scroll" data-rival={rival}>
        <div className="lp-compare-frame">
          <table className="lp-compare-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">
                  Features
                </th>
                {OPTIONS.map(({ id, name, logo }) => (
                  <th key={id} role="columnheader" scope="col" data-option={id}>
                    {logo && (
                      <span className="lp-compare-logo" data-option={id}>
                        <img src={logo} alt="" />
                      </span>
                    )}
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {ROWS.map(({ label, cells }) => (
                <tr key={label} role="row">
                  <th role="rowheader" scope="row">
                    {label}
                  </th>
                  {cells.map((cell, index) => (
                    <CompareCell
                      key={OPTIONS[index].id}
                      option={OPTIONS[index].id}
                      cell={cell}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
