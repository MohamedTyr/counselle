import { ArrowUpRight } from "lucide-react";

import { PriceFigure } from "./atoms";
import type { Block } from "./blocks-types";
import { KeyFacts } from "./parts";
import type { FactReader } from "./reader";
import { CompareTable, Chips, Part, ShareSteps } from "./viz-more";
import { CostStack, Ring } from "./viz";

/* Paying for it: the price, how far aid reaches, what an award is made of,
 * merit money, the programs, and the forms. */

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

const price: Block = {
  id: "price",
  question: "cost",
  title: "The price",
  size: "m",
  keys: ["costs.*"],
  render: (r) => {
    const inState = r.num("costs.attendance_in_state");
    const outState = r.num("costs.attendance_out_of_state");
    const sticker = outState ?? inState;
    if (!sticker) return null;
    const twoPrices = inState && outState && inState.value !== outState.value;
    const parts = (tuitionKey: string) =>
      [
        { label: "Tuition & fees", value: r.num(tuitionKey)?.value },
        { label: "Room & board", value: r.num("costs.room_and_board")?.value },
        { label: "Books", value: r.num("costs.books_and_supplies")?.value },
        { label: "Other", value: r.num("costs.other_expenses")?.value },
      ].filter(
        (p): p is { label: string; value: number } =>
          typeof p.value === "number",
      );
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {twoPrices ? (
            <>
              <PriceFigure caption="a year, in state" value={inState.display} />
              <PriceFigure
                caption="a year, out of state"
                value={outState.display}
              />
            </>
          ) : (
            <PriceFigure caption="a year, before aid" value={sticker.display} />
          )}
        </div>
        <CostStack
          parts={parts(
            outState
              ? "costs.tuition_fees_out_of_state"
              : "costs.tuition_fees_in_state",
          )}
        />
        {twoPrices && r.num("costs.tuition_fees_in_state") ? (
          <p className="text-sm text-[var(--ink-muted)]">
            In-state tuition and fees are{" "}
            <span className="font-medium tabular-nums text-[var(--ink)]">
              {r.text("costs.tuition_fees_in_state")}
            </span>
            .
          </p>
        ) : null}
      </div>
    );
  },
};

const reach: Block = {
  id: "aid-reach",
  question: "cost",
  title: "How far aid goes",
  size: "l",
  keys: [
    "aid.applicants_*",
    "aid.need_found_*",
    "aid.received_*",
    "aid.need_fully_met_*",
    "aid.avg_percent_need_met_*",
    "aid.need_analysis_methodology",
  ],
  render: (r) => {
    const step = (label: string, stem: string, of: string) => ({
      label,
      of,
      pct: r.share(`aid.${stem}_freshman`),
      count: countOf(r.text(`aid.${stem}_freshman`)),
      alt: r.share(`aid.${stem}_all_undergraduates`),
    });
    const steps = [
      step("Applied for aid", "applicants", "of freshmen"),
      step("Were found to have need", "need_found", "of those who applied"),
      step("Received aid", "received", "of those with need"),
      step(
        "Had all their need met",
        "need_fully_met",
        "of those who received aid",
      ),
    ];
    const met = r.num("aid.avg_percent_need_met_freshman");
    const metAll = r.text("aid.avg_percent_need_met_all_undergraduates");
    if (!met && steps.every((s) => s.pct === null)) return null;
    return (
      <div className="flex flex-col gap-5">
        <div className="@container">
          <div className="grid items-center gap-6 @4xl:grid-cols-[auto_minmax(0,1fr)]">
            {met ? (
              <div className="flex items-center gap-4">
                <Ring pct={met.value} size={92} />
                <span className="flex max-w-40 flex-col gap-1 text-sm leading-5 text-[var(--ink-secondary)]">
                  of a freshman's demonstrated need is met, on average
                  {metAll ? (
                    <span className="text-xs text-[var(--ink-muted)]">
                      {metAll} for all undergrads
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
            <ShareSteps steps={steps} />
          </div>
        </div>
        {r.text("aid.need_analysis_methodology") ? (
          <p className="text-xs text-[var(--ink-muted)]">
            Need is calculated with the{" "}
            {r.text("aid.need_analysis_methodology")}.
          </p>
        ) : null}
      </div>
    );
  },
};

/** "4,878 (78.3%) of freshmen" → "4,878". */
function countOf(display: string | null): string | null {
  return display?.match(/^([\d,]+) \(/)?.[1] ?? null;
}

const award: Block = {
  id: "award",
  question: "cost",
  title: "What an award is made of",
  size: "m",
  keys: ["aid.avg_award_*", "aid.need_gift_*", "aid.need_selfhelp_*"],
  render: (r) => {
    const total = r.num("aid.avg_award_freshman");
    const gift = r.num("aid.need_gift_avg_freshman");
    const selfHelp = r.num("aid.need_selfhelp_avg_freshman");
    if (!total && !gift) return null;
    return (
      <div className="flex flex-col gap-6">
        {total ? (
          <PriceFigure
            caption="average award to a freshman with need"
            value={total.display}
          />
        ) : null}
        {gift && selfHelp ? (
          <div className="flex flex-col gap-2">
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
              <span
                className="bg-[var(--school-viz-accent)]"
                style={{ flex: gift.value }}
              />
              <span
                className="bg-[var(--school-viz-mark-3)]"
                style={{ flex: selfHelp.value }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--ink-muted)]">
              <span>
                Grants, free money{" "}
                <span className="font-medium text-[var(--ink)] tabular-nums">
                  {usd(gift.value)}
                </span>
              </span>
              <span>
                Loans and work{" "}
                <span className="font-medium text-[var(--ink)] tabular-nums">
                  {usd(selfHelp.value)}
                </span>
              </span>
            </div>
          </div>
        ) : null}
        <CompareTable
          columns={["Freshmen", "All undergrads"]}
          rows={[
            {
              label: "Average award",
              a: r.text("aid.avg_award_freshman"),
              b: r.text("aid.avg_award_all_undergraduates"),
            },
            {
              label: "Got a grant",
              a: pair(
                r,
                "aid.need_gift_recipients_freshman",
                "aid.need_gift_recipients_pct_freshman",
              ),
              b: pair(
                r,
                "aid.need_gift_recipients_all_undergraduates",
                "aid.need_gift_recipients_pct_all_undergraduates",
              ),
            },
            {
              label: "Average grant",
              a: r.text("aid.need_gift_avg_freshman"),
              b: r.text("aid.need_gift_avg_all_undergraduates"),
            },
            {
              label: "Got loans or work",
              a: pair(
                r,
                "aid.need_selfhelp_recipients_freshman",
                "aid.need_selfhelp_recipients_pct_freshman",
              ),
              b: pair(
                r,
                "aid.need_selfhelp_recipients_all_undergraduates",
                "aid.need_selfhelp_recipients_pct_all_undergraduates",
              ),
            },
            {
              label: "Average loans and work",
              a: r.text("aid.need_selfhelp_avg_freshman"),
              b: r.text("aid.need_selfhelp_avg_all_undergraduates"),
            },
          ]}
        />
      </div>
    );
  },
};

function pair(r: FactReader, countKey: string, pctKey: string): string | null {
  const count = r.text(countKey);
  const pct = r.num(pctKey);
  if (count && pct) return `${count} · ${Math.round(pct.value)}%`;
  return count ?? pct?.display ?? null;
}

const merit: Block = {
  id: "merit",
  question: "cost",
  title: "Merit aid",
  size: "m",
  keys: ["aid.merit_*", "aid.non_need_*"],
  render: (r) => {
    const noNeedAvg = r.num("aid.merit_no_need_avg_freshman");
    const areas = [
      ...r.list("aid.non_need_special_characteristics_areas"),
      ...r.list("aid.non_need_special_achievements_areas"),
      ...r.list("aid.non_need_creative_arts_areas"),
      ...r.list("aid.non_need_academics_areas"),
      ...r.list("aid.non_need_athletics_areas"),
    ];
    const programs = r
      .list("aid.non_need_programs")
      .filter((p) => p !== "None");
    const rows = [
      {
        label: "Merit aid, no need",
        a: pair(
          r,
          "aid.merit_no_need_recipients_freshman",
          "aid.merit_no_need_recipients_pct_freshman",
        ),
        b: pair(
          r,
          "aid.merit_no_need_recipients_all_undergraduates",
          "aid.merit_no_need_recipients_pct_all_undergraduates",
        ),
      },
      {
        label: "Average merit award",
        a: r.text("aid.merit_no_need_avg_freshman"),
        b: r.text("aid.merit_no_need_avg_all_undergraduates"),
      },
      {
        label: "Merit aid on top of need",
        a: pair(
          r,
          "aid.merit_to_need_recipients_freshman",
          "aid.merit_to_need_recipients_pct_freshman",
        ),
        b: pair(
          r,
          "aid.merit_to_need_recipients_all_undergraduates",
          "aid.merit_to_need_recipients_pct_all_undergraduates",
        ),
      },
    ];
    if (
      rows.every((x) => !x.a && !x.b) &&
      areas.length === 0 &&
      programs.length === 0
    ) {
      return r.text("aid.non_need_programs") ? (
        <p className="text-sm text-[var(--ink-muted)]">
          No merit scholarships offered.
        </p>
      ) : null;
    }
    return (
      <div className="flex flex-col gap-5">
        {noNeedAvg ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl leading-none font-semibold tabular-nums text-[var(--ink)]">
              {noNeedAvg.display}
            </span>
            <span className="text-sm text-[var(--ink-muted)]">
              average merit award to a freshman without need
            </span>
          </div>
        ) : null}
        <CompareTable columns={["Freshmen", "All undergrads"]} rows={rows} />
        {areas.length ? (
          <Part title="Awarded for">
            <Chips items={areas} />
          </Part>
        ) : null}
        {programs.length ? (
          <Part title="Scholarships not based on need">
            <Chips items={programs} />
          </Part>
        ) : null}
      </div>
    );
  },
};

const programs: Block = {
  id: "aid-programs",
  question: "cost",
  title: "Grants, loans and work",
  size: "m",
  keys: [
    "aid.need_based_programs",
    "aid.federal_loan_programs",
    "aid.state_loan_programs",
    "aid.other_loan_programs",
    "aid.on_campus_employment_avg",
  ],
  render: (r) => {
    const grants = r.list("aid.need_based_programs");
    const loans = [
      ...r.list("aid.federal_loan_programs"),
      ...r.list("aid.other_loan_programs"),
    ];
    const state = r.text("aid.state_loan_programs");
    if (grants.length === 0 && loans.length === 0) return null;
    return (
      <div className="flex flex-col gap-5">
        {grants.length ? (
          <Part title="Need-based grants">
            <Chips items={grants} />
          </Part>
        ) : null}
        {loans.length ? (
          <Part title="Loans">
            <Chips
              items={
                state && state !== "None"
                  ? [...loans, `State loans ${state.toLowerCase()}`]
                  : loans
              }
              tone="outline"
            />
          </Part>
        ) : null}
        {r.text("aid.on_campus_employment_avg") ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Students with campus jobs earn about{" "}
            <span className="font-medium tabular-nums text-[var(--ink)]">
              {r.text("aid.on_campus_employment_avg")}
            </span>{" "}
            a year.
          </p>
        ) : null}
      </div>
    );
  },
};

const forms: Block = {
  id: "aid-forms",
  question: "cost",
  title: "Forms and contacts",
  size: "s",
  keys: ["money.*", "deadlines.aid_award_notification"],
  render: (r) => {
    const links = [
      ["Net price calculator", r.link("money.net_price_calculator_url")],
      ["Financial aid office", r.link("money.financial_aid_url")],
    ].filter((l): l is [string, string] => l[1] !== null);
    return (
      <div className="flex flex-col gap-4">
        <KeyFacts
          dense
          facts={[
            { label: "FAFSA code", value: r.text("money.fafsa_code") },
            { label: "CSS Profile", value: r.text("money.css_profile_fee") },
            {
              label: "Aid decisions",
              value: r.text("deadlines.aid_award_notification"),
            },
            { label: "Email", value: r.text("money.financial_aid_email") },
          ]}
        />
        {links.length ? (
          <div className="flex flex-wrap gap-2">
            {links.map(([label, href]) => (
              <a
                className="inline-flex items-center gap-1 rounded-full border border-[var(--edge-button)] px-3 py-1.5 text-sm text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-button-hover)]"
                href={href}
                key={label}
                rel="noreferrer"
                target="_blank"
              >
                {label}
                <ArrowUpRight className="size-3.5" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    );
  },
};

export const COST_BLOCKS: Block[] = [
  price,
  reach,
  award,
  merit,
  programs,
  forms,
];
