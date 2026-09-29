import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import logoGeorgiaTech from "../assets/mark-georgia-tech.webp";
import logoHarvard from "../assets/mark-harvard.webp";
import logoPurdue from "../assets/mark-purdue.webp";
import logoStanford from "../assets/mark-stanford.webp";
import logoUmich from "../assets/mark-umich.webp";
import { useRosterMotion } from "../useRosterMotion";
import "./roster-sheet.css";

type Status = "behind" | "nudge" | "track";
type Count = [done: number, total: number];

const STATUS = {
  behind: { label: "Behind", Icon: CircleAlert },
  nudge: { label: "Needs a nudge", Icon: Clock },
  track: { label: "On track", Icon: CircleCheck },
};

const SCHOOLS = {
  gt: { name: "Georgia Tech", logo: logoGeorgiaTech },
  umich: { name: "Michigan", logo: logoUmich },
  stanford: { name: "Stanford", logo: logoStanford },
  purdue: { name: "Purdue", logo: logoPurdue },
  harvard: { name: "Harvard", logo: logoHarvard },
};

/** What the school sends for a student, in the order the pills show them. */
const DOCUMENTS = {
  transcript: "Transcript",
  counselor: "Counselor letter",
  teachers: "Teacher letters",
};
type Document = keyof typeof DOCUMENTS;

type Student = {
  name: string;
  /** Applications submitted, of the schools on the list. */
  applications: Count;
  essays: Count;
  /** The documents still owed; the rest are sent. */
  owed: Document[];
  school: keyof typeof SCHOOLS;
  due: string;
  status: Status;
};

/** The class as a counselor sees it: whoever needs them first is on top. */
const STUDENTS: Student[] = [
  {
    name: "Tomás Herrera",
    applications: [0, 6],
    essays: [0, 4],
    owed: ["transcript", "teachers"],
    school: "gt",
    due: "Nov 1",
    status: "behind",
  },
  {
    name: "Amara Okafor",
    applications: [0, 8],
    essays: [1, 5],
    owed: ["teachers"],
    school: "umich",
    due: "Nov 1",
    status: "behind",
  },
  {
    name: "Jun Watanabe",
    applications: [1, 7],
    essays: [2, 6],
    owed: ["counselor"],
    school: "stanford",
    due: "Nov 1",
    status: "nudge",
  },
  {
    name: "Leila Haddad",
    applications: [0, 5],
    essays: [3, 4],
    owed: ["transcript"],
    school: "purdue",
    due: "Nov 1",
    status: "nudge",
  },
  {
    name: "Caleb Whitfield",
    applications: [2, 9],
    essays: [5, 5],
    owed: [],
    school: "harvard",
    due: "Jan 1",
    status: "track",
  },
  {
    name: "Noor Rahman",
    applications: [1, 6],
    essays: [4, 4],
    owed: [],
    school: "umich",
    due: "Feb 1",
    status: "track",
  },
  {
    name: "Wren Castillo",
    applications: [1, 5],
    essays: [3, 4],
    owed: ["teachers"],
    school: "purdue",
    due: "Jan 15",
    status: "track",
  },
  {
    name: "Isaac Brennan",
    applications: [1, 8],
    essays: [5, 6],
    owed: [],
    school: "stanford",
    due: "Jan 5",
    status: "track",
  },
  {
    name: "Dalia Mansour",
    applications: [2, 7],
    essays: [4, 5],
    owed: [],
    school: "harvard",
    due: "Jan 1",
    status: "track",
  },
];

/** Where each student sat before the class was sorted: by first name. */
const BY_NAME = [...STUDENTS].sort((a, b) => a.name.localeCompare(b.name));

/** The whole class, one dot a student, in the order the roster sorts them. */
const CLASS: { status: Status; count: number; label: string }[] = [
  { status: "behind", count: 9, label: "behind" },
  { status: "nudge", count: 21, label: "need a nudge" },
  { status: "track", count: 112, label: "on track" },
];
const CLASS_SIZE = CLASS.reduce((total, group) => total + group.count, 0);
const DOTS = CLASS.flatMap(({ status, count }) =>
  Array.from({ length: count }, () => status),
);

function Pips({ count: [done, total] }: { count: Count }) {
  return (
    <span className="lp-roster-pips">
      {Array.from({ length: total }, (_, pip) => (
        <i key={pip} data-done={pip < done ? "" : undefined} />
      ))}
    </span>
  );
}

function Row({ student, index }: { student: Student; index: number }) {
  const school = SCHOOLS[student.school];
  const shift = BY_NAME.indexOf(student) - index;
  return (
    <div
      className="lp-roster-row"
      data-shift={shift}
      // Whoever rises furthest passes over the rows it overtakes.
      style={shift > 0 ? { zIndex: shift } : undefined}
    >
      <span className="lp-roster-student">{student.name}</span>
      <span className="lp-roster-applications">
        {student.applications[0]} of {student.applications[1]}
      </span>
      <span className="lp-roster-essays">
        <Pips count={student.essays} />
        {student.essays[0]} of {student.essays[1]}
      </span>
      <span className="lp-roster-documents">
        {(Object.keys(DOCUMENTS) as Document[]).map((document) => {
          const owed = student.owed.includes(document);
          return (
            <span key={document} data-owed={owed ? "" : undefined}>
              {DOCUMENTS[document]}
            </span>
          );
        })}
      </span>
      <span className="lp-roster-due">
        <img src={school.logo} width={22} height={22} alt="" />
        {student.due}
      </span>
      <span className="lp-roster-status" data-status={student.status}>
        {(() => {
          const { label, Icon } = STATUS[student.status];
          return (
            <>
              <Icon size={13} strokeWidth={2} />
              {label}
            </>
          );
        })()}
      </span>
    </div>
  );
}

export function RosterSheet() {
  const figure = useRosterMotion();
  return (
    <div className="lp-roster" ref={figure} aria-hidden="true" data-nosnippet>
      <div className="lp-sheet lp-roster-sheet">
        <div className="lp-roster-header">
          <p className="lp-roster-title">
            Class of 2027 <span>{CLASS_SIZE} students</span>
          </p>
          <p className="lp-roster-legend">
            {CLASS.map(({ status, count, label }) => (
              <span key={status} data-status={status}>
                <b>{count}</b> {label}
              </span>
            ))}
          </p>
        </div>
        <div className="lp-roster-class">
          {DOTS.map((status, dot) => (
            <span key={dot} className="lp-roster-dot">
              <i data-status={status} />
            </span>
          ))}
        </div>
        <div className="lp-roster-columns">
          <span>Student</span>
          <span className="lp-roster-applications">Applications</span>
          <span className="lp-roster-essays">Essays</span>
          <span className="lp-roster-documents">Documents</span>
          <span className="lp-roster-due">Next deadline</span>
          <span>Status</span>
        </div>
        <div className="lp-roster-rows">
          {STUDENTS.map((student, index) => (
            <Row key={student.name} student={student} index={index} />
          ))}
        </div>
        <span className="lp-roster-fade" />
      </div>
    </div>
  );
}
