import type { Block } from "./blocks-types";
import { isYes, sentenceCase } from "./reader";
import { CheckList, Chips, FigureRow, Part } from "./viz-more";
import { Bars } from "./viz";

/* Academics: what you can study, how big classes are, who teaches, how
 * the program runs, and the graduate school next door. */

const majors: Block = {
  id: "majors",
  question: "learn",
  title: "What you can study",
  size: "l",
  keys: [
    "academics.undergraduate_majors_count",
    "academics.undergraduate_majors",
    "academics.popular_disciplines",
    "academics.combined_degree_programs",
  ],
  render: (r) => {
    const all = r.list("academics.undergraduate_majors");
    const popular = r.list("academics.popular_disciplines");
    if (all.length === 0 && popular.length === 0) return null;
    const combined = r.text("academics.combined_degree_programs");
    return (
      <div className="flex flex-col gap-5">
        {popular.length ? (
          <Part title="Where most students end up">
            <ol className="flex flex-col">
              {popular.map((field, i) => (
                <li
                  className="flex items-baseline gap-4 border-b border-[var(--school-fact-divider)] py-2.5 first:pt-0 last:border-b-0"
                  key={field}
                >
                  <span className="w-4 text-sm tabular-nums text-[var(--ink-muted)]">
                    {i + 1}
                  </span>
                  <span className="text-[15px] font-medium text-[var(--ink)]">
                    {sentenceCase(field)}
                  </span>
                </li>
              ))}
            </ol>
          </Part>
        ) : null}
        {all.length ? (
          <Part
            title={`All ${r.text("academics.undergraduate_majors_count") ?? all.length} majors`}
          >
            <Chips
              items={all.map((m) => m.replace(/, General$/, ""))}
              limit={12}
              tone="outline"
            />
          </Part>
        ) : null}
        {combined && combined !== "None" ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Combined degrees: {combined}
          </p>
        ) : null}
      </div>
    );
  },
};

const classes: Block = {
  id: "class-sizes",
  question: "learn",
  title: "How big classes are",
  size: "m",
  keys: ["class_size.*"],
  render: (r) => {
    const regular = r.buckets("class_size.regular_distribution");
    const sub = r.buckets("class_size.subsection_distribution");
    if (regular.length === 0 && sub.length === 0) return null;
    const small = regular
      .filter((b) => /^(2-9|10-19)/.test(b.label.replace("–", "-")))
      .reduce((s, b) => s + b.pct, 0);
    return (
      <div className="flex flex-col gap-5">
        {small > 0 ? (
          <p className="text-sm text-[var(--ink-secondary)]">
            <span className="text-2xl font-semibold tabular-nums text-[var(--ink)]">
              {Math.round(small)}%
            </span>{" "}
            of classes have fewer than 20 students.
          </p>
        ) : null}
        {regular.length ? (
          <Part title="Classes">
            <Bars buckets={regular} highlightTop />
          </Part>
        ) : null}
        {sub.length ? (
          <Part title="Labs, discussions and recitations">
            <Bars buckets={sub} highlightTop />
          </Part>
        ) : null}
      </div>
    );
  },
};

const faculty: Block = {
  id: "faculty",
  question: "learn",
  title: "Who teaches",
  size: "s",
  keys: ["faculty.*"],
  render: (r) => (
    <FigureRow
      items={[
        {
          label: "full-time faculty",
          value: r.text("faculty.full_time_count"),
        },
        {
          label: "part-time faculty",
          value: r.text("faculty.part_time_count"),
        },
        {
          label: "hold a doctorate or top degree",
          value: r.text("faculty.terminal_degree_pct"),
        },
        {
          label: "students per faculty",
          value: r.text("faculty.student_faculty_ratio"),
        },
      ]}
    />
  ),
};

const program: Block = {
  id: "program",
  question: "learn",
  title: "How the program works",
  size: "m",
  keys: [
    "academics.special_programs",
    "academics.study_abroad",
    "academics.online_degrees",
    "academics.summer_session",
    "academics.calendar",
    "academics.required_coursework_*",
    "academics.ap_policy",
    "academics.ib_policy",
    "academics.sophomore_standing",
    "academics.library_on_campus",
    "academics.computer_ownership",
  ],
  render: (r) => {
    const core = [
      ["General education", "academics.required_coursework_general_education"],
      ["Math and science", "academics.required_coursework_math_science"],
      ["Foreign language", "academics.required_coursework_foreign_language"],
    ]
      .map(([label, k]) => ({ label: label!, d: r.text(k!) }))
      .filter((x): x is { label: string; d: string } => x.d !== null)
      .map((x) => ({ label: x.label, yes: isYes(x.d), detail: x.d }));
    const credit = [
      ["AP credit", "academics.ap_policy"],
      ["IB credit", "academics.ib_policy"],
      ["Sophomore standing", "academics.sophomore_standing"],
      ["Study abroad", "academics.study_abroad"],
      ["Summer session", "academics.summer_session"],
      ["Online degrees", "academics.online_degrees"],
    ]
      .map(([label, k]) => ({ label: label!, d: r.text(k!) }))
      .filter((x): x is { label: string; d: string } => x.d !== null)
      .map((x) => ({
        label: x.label,
        yes: isYes(x.d),
        detail:
          x.d === "Offered" || x.d === "Accepted" || x.d === "Yes" ? null : x.d,
      }));
    const special = r.list("academics.special_programs");
    const computer =
      r.text("academics.computer_ownership") ??
      r.text("academics.required_coursework_computer");
    if (core.length === 0 && credit.length === 0 && special.length === 0)
      return null;
    return (
      <div className="flex flex-col gap-6">
        {r.text("academics.calendar") ? (
          <p className="text-sm text-[var(--ink-secondary)]">
            The year runs on a{" "}
            <span className="font-medium text-[var(--ink)]">
              {r.text("academics.calendar")!.toLowerCase()}
            </span>{" "}
            calendar.
            {computer ? ` ${computer}.` : ""}
          </p>
        ) : null}
        {core.length ? (
          <Part title="Required of everyone">
            <CheckList items={core} />
          </Part>
        ) : null}
        {credit.length ? (
          <Part title="Credit and options">
            <CheckList items={credit} />
          </Part>
        ) : null}
        {special.length ? (
          <Part title="Special programs">
            <Chips items={special} />
          </Part>
        ) : null}
      </div>
    );
  },
};

const support: Block = {
  id: "support",
  question: "learn",
  title: "Academic support",
  size: "s",
  keys: ["academics.support_*"],
  render: (r) => {
    const items = [
      ["Tutoring", "academics.support_tutoring"],
      ["Remedial instruction", "academics.support_remedial_instruction"],
      ["Learning-disability services", "academics.support_learning_disabled"],
      ["Physical-disability services", "academics.support_physically_disabled"],
    ]
      .map(([label, k]) => ({ label: label!, d: r.text(k!) }))
      .filter((x): x is { label: string; d: string } => x.d !== null)
      .map((x) => ({
        label: x.label,
        yes: isYes(x.d),
        detail: x.d.length > 20 ? x.d : null,
      }));
    return items.length ? <CheckList columns={1} items={items} /> : null;
  },
};

const graduate: Block = {
  id: "graduate",
  question: "learn",
  title: "Graduate school",
  size: "m",
  keys: ["academics.masters_*", "academics.doctoral_*"],
  render: (r) => {
    const masters = r.list("academics.masters_programs");
    const doctoral = r.list("academics.doctoral_programs");
    if (
      !r.has("academics.masters_programs_count") &&
      !r.has("academics.doctoral_programs_count") &&
      masters.length === 0
    )
      return null;
    return (
      <div className="flex flex-col gap-5">
        <FigureRow
          items={[
            {
              label: "master's programs",
              value: r.text("academics.masters_programs_count"),
            },
            {
              label: "doctoral programs",
              value: r.text("academics.doctoral_programs_count"),
            },
          ]}
        />
        {r.list("academics.masters_degrees").length ? (
          <Part title="Degrees">
            <Chips
              items={[
                ...r.list("academics.masters_degrees"),
                ...r.list("academics.doctoral_degrees"),
              ]}
              limit={8}
              tone="outline"
            />
          </Part>
        ) : null}
        {masters.length ? (
          <Part title="Master's fields">
            <Chips items={masters} limit={8} />
          </Part>
        ) : null}
        {doctoral.length ? (
          <Part title="Doctoral fields">
            <Chips items={doctoral} limit={8} />
          </Part>
        ) : null}
      </div>
    );
  },
};

export const LEARN_BLOCKS: Block[] = [
  majors,
  classes,
  faculty,
  program,
  support,
  graduate,
];
