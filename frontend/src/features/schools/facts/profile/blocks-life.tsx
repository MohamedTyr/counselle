import { ArrowUpRight } from "lucide-react";

import { Who } from "./atoms";
import type { Block } from "./blocks-types";
import { KeyFacts } from "./parts";
import { isYes, sentenceCase } from "./reader";
import { CheckList, Chips, FigureRow, Part } from "./viz-more";
import { Bars, Ring, SplitBar } from "./viz";

/* Campus life: who's there, where you live, what you do, the teams, the
 * town, and how you're looked after. */

const people: Block = {
  id: "people",
  question: "life",
  title: "Who's there",
  size: "m",
  keys: [
    "students.*",
    "identity.coeducational",
    "identity.gender_model_reported",
    "identity.control_reported",
  ],
  render: (r) => {
    const women = r.num("students.undergraduate_women_pct");
    const men = r.num("students.undergraduate_men_pct");
    const ethnicity = [...r.buckets("students.ethnicity_distribution")].sort(
      (a, b) => b.pct - a.pct,
    );
    if (!r.has("students.undergraduate_total")) return null;
    return (
      <div className="flex flex-col gap-6">
        <FigureRow
          items={[
            {
              label: "undergraduates",
              value: r.text("students.undergraduate_total"),
            },
            {
              label: "study full time",
              value: r.text("students.undergraduate_full_time"),
            },
            {
              label: "graduate students",
              value: r.text("students.graduate_total"),
            },
            {
              label: "international",
              value: r.text("students.international_pct"),
            },
            {
              label: "countries represented",
              value: r.text("students.countries_represented"),
            },
            { label: "average age", value: r.text("students.average_age") },
          ]}
        />
        {women && men ? (
          <SplitBar
            a={{
              label: `Women · ${r.text("students.undergraduate_women_count") ?? ""}`,
              pct: women.value,
            }}
            b={{
              label: `Men · ${r.text("students.undergraduate_men_count") ?? ""}`,
              pct: men.value,
            }}
          />
        ) : null}
        {ethnicity.length ? (
          <Part title="Race and ethnicity">
            <Bars buckets={ethnicity} />
          </Part>
        ) : null}
        <p className="text-xs text-[var(--ink-muted)]">
          {[
            r.text("identity.control_reported"),
            r.text("identity.gender_model_reported"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    );
  },
};

const housing: Block = {
  id: "housing",
  question: "life",
  title: "Where you live",
  size: "m",
  keys: [
    "campus.housing_*",
    "campus.freshman_housing_guarantee",
    "campus.students_in_housing_pct",
    "campus.students_off_campus_pct",
    "campus.off_campus_housing_assistance",
  ],
  render: (r) => {
    const onCampus = r.leadingPct("campus.students_in_housing_pct");
    const checks = [
      [
        "Freshmen guaranteed housing",
        "campus.freshman_housing_guarantee",
        /guaranteed/i,
      ],
      [
        "Freshmen must live on campus",
        "campus.housing_requirement",
        /required/i,
      ],
      [
        "Help finding off-campus housing",
        "campus.off_campus_housing_assistance",
        /available/i,
      ],
    ]
      .map(([label, k, yes]) => ({
        label: label as string,
        d: r.text(k as string),
        yes: yes as RegExp,
      }))
      .filter(
        (x): x is { label: string; d: string; yes: RegExp } => x.d !== null,
      )
      .map((x) => ({
        label: x.label,
        yes: x.yes.test(x.d) && !/not/i.test(x.d),
      }));
    const types = r.list("campus.housing_types");
    if (onCampus === null && checks.length === 0 && types.length === 0)
      return null;
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-6">
          {onCampus !== null ? (
            <div className="flex items-center gap-3">
              <Ring pct={onCampus} size={76} />
              <span className="max-w-28 text-sm leading-5 text-[var(--ink-secondary)]">
                of students live on campus
              </span>
            </div>
          ) : null}
          <CheckList columns={1} items={checks} />
        </div>
        {types.length ? (
          <Part title="Kinds of housing">
            <Chips
              items={types.map((t) => t.charAt(0).toUpperCase() + t.slice(1))}
            />
          </Part>
        ) : null}
      </div>
    );
  },
};

const doing: Block = {
  id: "doing",
  question: "life",
  title: "Things to do",
  size: "m",
  keys: [
    "campus.activities",
    "campus.rotc",
    "campus.intramural_sports",
    "campus.fraternity_participation_pct",
    "campus.sorority_participation_pct",
  ],
  render: (r) => {
    const activities = r.list("campus.activities");
    const intramural = r.list("campus.intramural_sports");
    const rotc = r
      .list("campus.rotc")
      .map((x) => x.replace(/ is offered.*$/i, ""));
    const frat = r.leadingPct("campus.fraternity_participation_pct");
    const soro = r.leadingPct("campus.sorority_participation_pct");
    if (activities.length === 0 && intramural.length === 0 && frat === null)
      return null;
    return (
      <div className="flex flex-col gap-5">
        {activities.length ? (
          <Part title="Clubs and organizations">
            <Chips
              items={activities.map(
                (a) => a.charAt(0).toUpperCase() + a.slice(1),
              )}
            />
          </Part>
        ) : null}
        {intramural.length ? (
          <Part title="Intramural sports">
            <Chips
              items={intramural.map(
                (a) => a.charAt(0).toUpperCase() + a.slice(1),
              )}
              limit={10}
              tone="outline"
            />
          </Part>
        ) : null}
        {frat !== null || soro !== null ? (
          <Part title="Greek life">
            <Bars
              buckets={[
                ...(frat !== null
                  ? [{ label: "Men in fraternities", pct: frat }]
                  : []),
                ...(soro !== null
                  ? [{ label: "Women in sororities", pct: soro }]
                  : []),
              ]}
            />
          </Part>
        ) : null}
        {rotc.length ? (
          <p className="text-sm text-[var(--ink-muted)]">
            ROTC on campus: {rotc.join(", ")}
          </p>
        ) : null}
      </div>
    );
  },
};

const sports: Block = {
  id: "sports",
  question: "life",
  title: "Athletics",
  size: "m",
  keys: [
    "campus.athletic_conferences",
    "campus.mascot",
    "campus.school_colors",
    "campus.varsity_sports",
    "campus.club_sports",
  ],
  render: (r) => {
    const varsity = r.matrix("campus.varsity_sports");
    if (varsity.length === 0 && !r.has("campus.athletic_conferences"))
      return null;
    return (
      <div className="flex flex-col gap-5">
        <KeyFacts
          dense
          facts={[
            { label: "Division", value: r.text("campus.athletic_conferences") },
            { label: "Mascot", value: r.text("campus.mascot") },
            { label: "Colors", value: r.text("campus.school_colors") },
            { label: "Club sports", value: r.text("campus.club_sports") },
          ]}
        />
        {varsity.length ? (
          <Part title={`${varsity.length} varsity sports`}>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-8 gap-y-2">
              {varsity.map((row) => (
                <li
                  className="flex items-center justify-between gap-2 text-sm"
                  key={row.label}
                >
                  <span className="text-[var(--ink-secondary)]">
                    {sentenceCase(row.label.toLowerCase())}
                  </span>
                  <span className="flex shrink-0 gap-1 text-[10px] font-medium">
                    <Who
                      on={Boolean(row.women_offered)}
                      scholarship={Boolean(row.women_scholarship)}
                    >
                      W
                    </Who>
                    <Who
                      on={Boolean(row.men_offered)}
                      scholarship={Boolean(row.men_scholarship)}
                    >
                      M
                    </Who>
                  </span>
                </li>
              ))}
            </ul>
            {varsity.some(
              (row) => row.men_scholarship || row.women_scholarship,
            ) ? (
              <p className="text-xs text-[var(--ink-muted)]">
                Filled: athletic scholarships offered.
              </p>
            ) : null}
          </Part>
        ) : null}
      </div>
    );
  },
};

const place: Block = {
  id: "place",
  question: "life",
  title: "The town",
  size: "s",
  keys: [
    "campus.city_population",
    "campus.nearest_metro",
    "campus.campus_acres",
    "campus.nearest_bus_station",
    "campus.nearest_train_station",
    "campus.campus_map_url",
  ],
  render: (r) => {
    const map = r.link("campus.campus_map_url");
    return (
      <div className="flex flex-col gap-4">
        <FigureRow
          items={[
            {
              label: "people in the city",
              value: r.text("campus.city_population"),
            },
            { label: "campus", value: r.text("campus.campus_acres") },
          ]}
        />
        <KeyFacts
          dense
          facts={[
            {
              label: "Nearest big city",
              value: r.text("campus.nearest_metro"),
            },
            {
              label: "Train",
              value:
                r
                  .text("campus.nearest_train_station")
                  ?.replace(" from campus", "") ?? null,
            },
            {
              label: "Bus",
              value:
                r
                  .text("campus.nearest_bus_station")
                  ?.replace(" from campus", "") ?? null,
            },
          ]}
        />
        {map ? (
          <a
            className="inline-flex w-fit items-center gap-1 text-sm text-[var(--ink)] underline decoration-[var(--hairline)] underline-offset-4 hover:decoration-current"
            href={map}
            rel="noreferrer"
            target="_blank"
          >
            Campus map <ArrowUpRight className="size-3.5" />
          </a>
        ) : null}
      </div>
    );
  },
};

const care: Block = {
  id: "care",
  question: "life",
  title: "Health and safety",
  size: "s",
  keys: [
    "campus.security_*",
    "campus.health_service",
    "campus.personal_counseling",
    "campus.child_care",
  ],
  render: (r) => {
    const items = [
      ["Health service", "campus.health_service"],
      ["Counseling", "campus.personal_counseling"],
      ["24-hour patrols", "campus.security_patrols_24h"],
      ["Emergency phones", "campus.security_emergency_phones"],
      ["Late-night rides", "campus.security_late_night_transport"],
      ["Keycard entry", "campus.security_electronic_entrances"],
      ["Child care", "campus.child_care"],
    ]
      .map(([label, k]) => ({ label: label!, d: r.text(k!) }))
      .filter((x): x is { label: string; d: string } => x.d !== null)
      .map((x) => ({ label: x.label, yes: isYes(x.d) }));
    return items.length ? <CheckList items={items} /> : null;
  },
};

export const LIFE_BLOCKS: Block[] = [
  people,
  housing,
  doing,
  sports,
  place,
  care,
];
