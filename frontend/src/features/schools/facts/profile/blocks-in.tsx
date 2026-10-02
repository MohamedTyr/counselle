import type { Block } from "./blocks-types";
import type { FactReader } from "./reader";
import { KeyFacts, Missing } from "./parts";
import { CheckList, FigureRow, Part, SpreadBar } from "./viz-more";
import { Bars, DotGrid, FactorScale, Funnel, RangeBar } from "./viz";

/* Getting in: the odds, the class's scores and grades, what the school
 * weighs, what it requires, and the waitlist. */

function oneIn(r: FactReader): string | null {
  const applied = r.num("admissions.applicants_total");
  const admitted = r.num("admissions.admitted_total");
  if (!applied || !admitted || admitted.value <= 0) return null;
  return `1 in ${Math.round(applied.value / admitted.value)}`;
}

const odds: Block = {
  id: "odds",
  question: "in",
  title: "The odds",
  size: "m",
  keys: [
    "admissions.entrance_difficulty",
    "admissions.applicants_total",
    "admissions.admitted_total",
    "admissions.enrolled_total",
    "admissions.admit_rate",
    "admissions.yield_rate",
  ],
  render: (r) => {
    const rate = r.num("admissions.admit_rate");
    const applied = r.num("admissions.applicants_total");
    const admitted = r.num("admissions.admitted_total");
    const enrolled = r.num("admissions.enrolled_total");
    if (!rate && !applied) return null;
    return (
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
          {rate ? <DotGrid rate={rate.value} /> : null}
          <div className="flex flex-col gap-2">
            <span className="text-5xl leading-none font-semibold tracking-[-0.03em] tabular-nums text-[var(--ink)]">
              {rate?.display ?? "—"}
            </span>
            <span className="text-sm text-[var(--ink-secondary)]">
              of applicants admitted
              {oneIn(r) ? (
                <span className="block text-[var(--ink-muted)]">
                  About {oneIn(r)}
                </span>
              ) : null}
            </span>
            {r.text("admissions.entrance_difficulty") ? (
              <span className="mt-1 w-fit rounded-full bg-[var(--control-quiet-surface)] px-2.5 py-1 text-xs text-[var(--ink-secondary)]">
                Rated {r.text("admissions.entrance_difficulty")!.toLowerCase()}
              </span>
            ) : null}
          </div>
        </div>
        {applied && admitted && enrolled ? (
          <Funnel
            steps={[
              {
                label: "Applied",
                value: applied.value,
                display: applied.display,
              },
              {
                label: "Admitted",
                value: admitted.value,
                display: admitted.display,
              },
              {
                label: "Enrolled",
                value: enrolled.value,
                display: enrolled.display,
              },
            ]}
          />
        ) : null}
        {r.num("admissions.yield_rate") ? (
          <p className="text-sm text-[var(--ink-muted)]">
            <span className="font-medium text-[var(--ink)] tabular-nums">
              {r.text("admissions.yield_rate")}
            </span>{" "}
            of admitted students enroll.
          </p>
        ) : null}
      </div>
    );
  },
};

const byGender: Block = {
  id: "by-gender",
  question: "in",
  title: "Women and men",
  size: "s",
  keys: [
    "admissions.applicants_total_women",
    "admissions.admitted_total_women",
    "admissions.admit_rate_women",
    "admissions.enrolled_total_women",
    "admissions.yield_rate_women",
    "admissions.applicants_total_men",
    "admissions.admitted_total_men",
    "admissions.admit_rate_men",
    "admissions.enrolled_total_men",
    "admissions.yield_rate_men",
  ],
  render: (r) => {
    const rows = [
      ["Applied", "applicants_total"],
      ["Admitted", "admitted_total"],
      ["Admit rate", "admit_rate"],
      ["Enrolled", "enrolled_total"],
      ["Yield", "yield_rate"],
    ] as const;
    const women = r.num("admissions.admit_rate_women");
    const men = r.num("admissions.admit_rate_men");
    if (!women && !men) return null;
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            ["Women", women],
            ["Men", men],
          ].map(([label, n]) =>
            n && typeof n !== "string" ? (
              <div className="flex flex-col gap-1.5" key={label as string}>
                <span className="text-2xl leading-none font-semibold tabular-nums text-[var(--ink)]">
                  {n.display}
                </span>
                <span className="h-1 rounded-full bg-[var(--school-viz-track)]">
                  <span
                    className="block h-full rounded-full bg-[var(--school-viz-mark)]"
                    style={{ width: `${Math.max(n.value, 1)}%` }}
                  />
                </span>
                <span className="text-xs text-[var(--ink-muted)]">
                  of {String(label).toLowerCase()} admitted
                </span>
              </div>
            ) : null,
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--ink-muted)]">
              <th />
              <th className="pb-1.5 text-right font-normal">Women</th>
              <th className="pb-1.5 text-right font-normal">Men</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(([, k]) => k !== "admit_rate")
              .map(([label, k]) => (
                <tr
                  className="border-t border-[var(--school-fact-divider)]"
                  key={k}
                >
                  <td className="py-1.5 text-[var(--ink-secondary)]">
                    {label}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--ink)]">
                    {r.text(`admissions.${k}_women`) ?? "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--ink)]">
                    {r.text(`admissions.${k}_men`) ?? "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  },
};

const scores: Block = {
  id: "scores",
  question: "in",
  title: "Test scores",
  size: "m",
  keys: [
    "class_profile.sat_*",
    "class_profile.act_*",
    "admissions.test_policy_sat_or_act",
  ],
  render: (r) => {
    const bands = [
      r.band("class_profile.sat_math", "SAT Math"),
      r.band("class_profile.sat_ebrw", "SAT Reading & Writing"),
      r.band("class_profile.act_composite", "ACT Composite"),
    ].filter((b) => b !== null);
    const spreads = [
      ["SAT Math", "class_profile.sat_math_distribution"],
      ["SAT Reading & Writing", "class_profile.sat_ebrw_distribution"],
      ["ACT Composite", "class_profile.act_composite_distribution"],
      ["ACT Math", "class_profile.act_math_distribution"],
      ["ACT English", "class_profile.act_english_distribution"],
    ] as const;
    const averages = [
      {
        label: "SAT Math average",
        value: r.text("class_profile.sat_math_avg"),
      },
      { label: "SAT R&W average", value: r.text("class_profile.sat_ebrw_avg") },
      {
        label: "ACT average",
        value: r.text("class_profile.act_composite_avg"),
      },
      {
        label: "ACT Math average",
        value: r.text("class_profile.act_math_avg"),
      },
      {
        label: "ACT English average",
        value: r.text("class_profile.act_english_avg"),
      },
    ];
    const hasSpread = spreads.some(([, k]) => r.buckets(k).length > 0);
    if (bands.length === 0 && !hasSpread) {
      const policy = r.text("admissions.test_policy_sat_or_act");
      return (
        <div className="flex flex-col gap-1.5">
          {policy ? (
            <p className="text-xl font-semibold tracking-[-0.01em] text-[var(--ink)]">
              SAT or ACT: {policy.toLowerCase()}
            </p>
          ) : null}
          <Missing>No score ranges are published for admitted students.</Missing>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {r.text("admissions.test_policy_sat_or_act") ? (
          <p className="text-sm text-[var(--ink-secondary)]">
            SAT or ACT:{" "}
            <span className="font-medium text-[var(--ink)]">
              {r.text("admissions.test_policy_sat_or_act")}
            </span>
          </p>
        ) : null}
        {bands.length ? (
          <Part title="Middle 50% of admitted students">
            <div className="flex flex-col gap-4">
              {bands.map((b) => (
                <RangeBar band={b} compact key={b.label} />
              ))}
            </div>
          </Part>
        ) : null}
        <FigureRow items={averages} />
        {hasSpread ? (
          <Part title="How admitted students scored">
            <div className="flex flex-col gap-4">
              {spreads.map(([label, k]) => (
                <SpreadBar buckets={r.buckets(k)} key={k} label={label} />
              ))}
            </div>
          </Part>
        ) : null}
      </div>
    );
  },
};

const grades: Block = {
  id: "grades",
  question: "in",
  title: "Grades and class rank",
  size: "s",
  keys: [
    "class_profile.average_gpa",
    "class_profile.gpa_distribution",
    "class_profile.class_rank_*",
  ],
  render: (r) => {
    const gpa = r.buckets("class_profile.gpa_distribution");
    const ranks = [
      { label: "Top 10%", value: r.num("class_profile.class_rank_top_tenth") },
      {
        label: "Top 25%",
        value: r.num("class_profile.class_rank_top_quarter"),
      },
      { label: "Top 50%", value: r.num("class_profile.class_rank_top_half") },
    ].filter((x) => x.value !== null);
    if (
      !r.has("class_profile.average_gpa") &&
      gpa.length === 0 &&
      ranks.length === 0
    )
      return null;
    return (
      <div className="flex flex-col gap-5">
        {r.text("class_profile.average_gpa") ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl leading-none font-semibold tabular-nums text-[var(--ink)]">
              {r.text("class_profile.average_gpa")}
            </span>
            <span className="text-sm text-[var(--ink-muted)]">average GPA</span>
          </div>
        ) : null}
        {gpa.length ? <Bars buckets={gpa} highlightTop /> : null}
        {ranks.length ? (
          <Part title="Were in their high-school class's">
            <Bars
              buckets={ranks.map((x) => ({
                label: x.label,
                pct: x.value!.value,
              }))}
            />
          </Part>
        ) : null}
      </div>
    );
  },
};

const factors: Block = {
  id: "factors",
  question: "in",
  title: "What they weigh",
  size: "m",
  keys: ["admissions.selection_factor_*"],
  render: (r) => {
    const list = r.factors();
    if (list.length === 0) return null;
    return <FactorScale factors={list} />;
  },
};

const UNIT_SUBJECTS = [
  ["English", "english"],
  ["Math", "mathematics"],
  ["Science", "science"],
  ["Social studies", "social_studies"],
  ["History", "history"],
  ["Foreign language", "foreign_language"],
  ["Electives", "academic_electives"],
] as const;

const requirements: Block = {
  id: "requirements",
  question: "in",
  title: "What they ask for",
  size: "m",
  keys: [
    "admissions.essay_requirement",
    "admissions.interview_requirement",
    "admissions.recommendations_requirement",
    "admissions.hs_graduation_requirement",
    "admissions.hs_program_requirement",
    "admissions.units_*",
  ],
  render: (r) => {
    const checks = [
      ["Essay", "admissions.essay_requirement"],
      ["Interview", "admissions.interview_requirement"],
      ["Recommendations", "admissions.recommendations_requirement"],
      ["High-school diploma", "admissions.hs_graduation_requirement"],
      ["College-prep program", "admissions.hs_program_requirement"],
    ]
      .map(([label, key]) => ({ label: label!, display: r.text(key!) }))
      .filter(
        (c): c is { label: string; display: string } => c.display !== null,
      )
      .map((c) => ({
        label: c.label,
        yes:
          /required|recommended/i.test(c.display) &&
          !/not required/i.test(c.display),
        detail: c.display,
      }));
    const units = UNIT_SUBJECTS.map(([label, k]) => ({
      label,
      req: r.num(`admissions.units_required_${k}`),
      rec: r.num(`admissions.units_recommended_${k}`),
    })).filter((u) => u.req || u.rec);
    if (checks.length === 0 && units.length === 0) return null;
    return (
      <div className="flex flex-col gap-6">
        <CheckList columns={1} items={checks} />
        {units.length ? (
          <Part title="Years of high-school study">
            {/* One dot per year: filled are required, outlined are the extra
             * years recommended on top. */}
            <ul className="flex flex-col gap-2.5">
              {units.map((u) => {
                const required = u.req?.value ?? 0;
                const total = Math.max(required, u.rec?.value ?? 0);
                return (
                  <li
                    className="grid grid-cols-[minmax(0,8.5rem)_5rem_minmax(0,1fr)] items-center gap-4 text-sm"
                    key={u.label}
                  >
                    <span className="text-[var(--ink-secondary)]">
                      {u.label}
                    </span>
                    <span aria-hidden className="flex gap-1">
                      {Array.from({ length: total }, (_, i) => (
                        <span
                          className={
                            i < required
                              ? "size-3 rounded-full bg-[var(--school-viz-mark)]"
                              : "size-3 rounded-full border border-[var(--school-viz-mark-2)]"
                          }
                          key={i}
                        />
                      ))}
                    </span>
                    <span className="text-sm text-[var(--ink-muted)] tabular-nums">
                      {u.req ? `${u.req.display} required` : ""}
                      {u.req && u.rec && u.rec.value > u.req.value
                        ? ` · ${u.rec.display} recommended`
                        : ""}
                      {!u.req && u.rec ? `${u.rec.display} recommended` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Part>
        ) : null}
      </div>
    );
  },
};

const waitlist: Block = {
  id: "waitlist",
  question: "in",
  title: "The waitlist",
  size: "s",
  keys: ["admissions.waitlist_*"],
  render: (r) => {
    const offered = r.num("admissions.waitlist_offered");
    const accepted = r.num("admissions.waitlist_accepted");
    const admitted = r.num("admissions.waitlist_admitted");
    if (!offered) {
      const used = r.text("admissions.waitlist_used");
      return used ? (
        <KeyFacts facts={[{ label: "Uses a waitlist", value: used }]} />
      ) : null;
    }
    return (
      <div className="flex flex-col gap-4">
        <Funnel
          steps={[
            {
              label: "Offered",
              value: offered.value,
              display: offered.display,
            },
            ...(accepted
              ? [
                  {
                    label: "Took a spot",
                    value: accepted.value,
                    display: accepted.display,
                  },
                ]
              : []),
            ...(admitted
              ? [
                  {
                    label: "Admitted",
                    value: admitted.value,
                    display: admitted.display,
                  },
                ]
              : []),
          ]}
        />
        {accepted && admitted && accepted.value > 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">
            <span className="font-medium text-[var(--ink)] tabular-nums">
              {((admitted.value / accepted.value) * 100).toFixed(
                admitted.value / accepted.value < 0.1 ? 1 : 0,
              )}
              %
            </span>{" "}
            of students who took a spot were admitted.
          </p>
        ) : null}
      </div>
    );
  },
};

export const IN_BLOCKS: Block[] = [
  odds,
  scores,
  grades,
  factors,
  requirements,
  byGender,
  waitlist,
];
