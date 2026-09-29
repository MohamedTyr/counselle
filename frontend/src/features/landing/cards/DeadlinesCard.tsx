import logoHarvard from "../assets/deadline-logo-harvard.png";
import logoPurdue from "../assets/row-logo-purdue.png";
import "./deadlines-card.css";

/** Drawn inline so the showcase can fill the box and draw the tick. */
function CheckboxDone() {
  return (
    <svg
      className="lp-checkbox-done"
      width={14}
      height={14}
      viewBox="0 0 14 14"
    >
      <rect width={14} height={14} rx={4} />
      <path className="lp-checkbox-tick" d="M3.3 7.3 5.9 9.9 10.7 4.3" />
    </svg>
  );
}

type Task = { text: string; done?: boolean };
type Deadline = { school: string; round: string; logo: string };
type Cell = { day: number; past?: boolean; today?: boolean; due?: boolean };

/* Friday October 30, 2026: two days before the November 1 early deadlines.
   Four weeks, Sunday first, starting with the week today falls in. */
const past = (day: number): Cell => ({ day, past: true });
const MONTH: Cell[] = [
  ...[25, 26, 27, 28, 29].map(past),
  { day: 30, today: true },
  { day: 31 },
  { day: 1, due: true },
  ...Array.from({ length: 20 }, (_, index) => ({ day: index + 2 })),
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DEADLINES: Deadline[] = [
  { school: "Harvard", round: "Restrictive EA", logo: logoHarvard },
  { school: "Purdue", round: "Early Action", logo: logoPurdue },
];
const TODAY: Task[] = [
  { text: "Trim essay to 650", done: true },
  { text: "Finish Why Purdue" },
  { text: "Rank activities list" },
  { text: "Send SAT to Purdue" },
];

function cellClass(cell: Cell) {
  if (cell.today) return "lp-cal-cell lp-cal-cell-today";
  if (cell.due) return "lp-cal-cell lp-cal-cell-due";
  return cell.past ? "lp-cal-cell lp-cal-cell-past" : "lp-cal-cell";
}

function TaskRow({ task }: { task: Task }) {
  return (
    <div className={task.done ? "lp-task lp-task-done" : "lp-task"}>
      <span className="lp-checkbox-holder">
        {task.done ? <CheckboxDone /> : <span className="lp-checkbox" />}
      </span>
      <span className="lp-task-text">
        {task.done ? <s>{task.text}</s> : task.text}
      </span>
    </div>
  );
}

export function DeadlinesSheet() {
  return (
    <div
      className="lp-sheet lp-sheet-wide lp-calendar-sheet"
      aria-hidden="true"
    >
      <div className="lp-cal-month">
        <p className="lp-cal-heading">
          Oct – Nov <span>2026</span>
        </p>
        <div className="lp-cal-cells">
          {WEEKDAYS.map((weekday, index) => (
            <span key={index} className="lp-cal-weekday">
              {weekday}
            </span>
          ))}
          {MONTH.map((cell) => (
            <span key={`${cell.past}-${cell.day}`} className={cellClass(cell)}>
              {cell.day}
            </span>
          ))}
        </div>
      </div>
      <div className="lp-cal-column">
        <p className="lp-cal-heading lp-cal-due-heading">
          Due Sunday <span>Nov 1</span>
          <em>2 days left</em>
        </p>
        {DEADLINES.map((deadline) => (
          <div key={deadline.school} className="lp-deadline">
            <img src={deadline.logo} width={28} height={28} alt="" />
            {deadline.school}
            <span>{deadline.round}</span>
          </div>
        ))}
      </div>
      <div className="lp-cal-column">
        <p className="lp-cal-heading">
          Today <span>Fri, Oct 30</span>
        </p>
        {TODAY.map((task) => (
          <TaskRow key={task.text} task={task} />
        ))}
      </div>
    </div>
  );
}

export function DeadlinesCard() {
  return (
    <article className="lp-card-wide lp-card-deadlines">
      <div className="lp-card-wide-text">
        <h3>Tasks and deadlines, all in one place</h3>
        <p>
          Every school’s dates pulled in for you, next to the work you planned
          for the week.
        </p>
      </div>
      <DeadlinesSheet />
    </article>
  );
}
