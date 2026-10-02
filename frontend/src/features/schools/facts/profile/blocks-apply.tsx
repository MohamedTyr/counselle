import { Mail, MapPin, Phone } from "lucide-react";

import { Line } from "./atoms";
import type { Block } from "./blocks-types";
import { isYes } from "./reader";
import { CheckList, FigureRow } from "./viz-more";
import { Columns, DeadlineList } from "./viz";

/* Applying (deadlines, how, who to call) and Finishing (staying, graduating,
 * debt, what comes after). */

const deadlines: Block = {
  id: "deadlines",
  question: "apply",
  title: "Deadlines",
  size: "l",
  keys: [
    "deadlines.regular_notification",
    "deadlines.early_action_notification",
    "deadlines.early_decision_notification",
    "deadlines.reply_by",
    "admissions.early_decision_offered",
    "admissions.early_action_offered",
  ],
  present: (r) =>
    r.data.deadlines.rows.some((row) => row.state === "value"),
  render: (r) => {
    const rows = r.data.deadlines.rows.filter((row) => row.state === "value");
    const dated = rows
      .filter((row): row is typeof row & { date: string } => row.date !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const notOffered = rows
      .filter((row) => row.date === null)
      .map((row) => row.round);
    if (rows.length === 0) return null;
    const milestones = [
      ["Early decision results", "deadlines.early_decision_notification"],
      ["Early action results", "deadlines.early_action_notification"],
      ["Regular decision results", "deadlines.regular_notification"],
      ["Reply by", "deadlines.reply_by"],
    ]
      .map(([label, key]) => ({ label: label!, display: r.text(key!) }))
      .filter((m): m is { label: string; display: string } => !!m.display);
    return (
      <div className="flex flex-col gap-5">
        <DeadlineList milestones={milestones} rows={dated} />
        {notOffered.length ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Not offered: {notOffered.join(", ")}
          </p>
        ) : null}
        {r.data.deadlines.foot ? (
          <p className="text-xs text-[var(--ink-muted)]">
            {r.data.deadlines.foot}
          </p>
        ) : null}
      </div>
    );
  },
};

const how: Block = {
  id: "how-to-apply",
  question: "apply",
  title: "How to apply",
  size: "m",
  keys: [
    "applying.accepts_common_app",
    "applying.electronic_application_url",
    "applying.application_fee",
    "applying.application_fee_waiver",
    "applying.deferred_enrollment",
    "applying.transfer_accepted",
    "admissions.need_blind",
    "admissions.test_policy_sat_or_act",
  ],
  render: (r) => {
    const items = [
      ["Common App", "applying.accepts_common_app"],
      ["Apply online", "applying.electronic_application_url"],
      ["Fee waiver", "applying.application_fee_waiver"],
      ["Defer your start", "applying.deferred_enrollment"],
      ["Transfer students", "applying.transfer_accepted"],
    ]
      .map(([label, k]) => ({ label: label!, d: r.text(k!) }))
      .filter((x): x is { label: string; d: string } => x.d !== null)
      .map((x) => ({ label: x.label, yes: isYes(x.d) }));
    const needBlind = r.text("admissions.need_blind");
    return (
      <div className="flex flex-col gap-5">
        {r.text("applying.application_fee") ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl leading-none font-semibold tabular-nums text-[var(--ink)]">
              {r.text("applying.application_fee")}
            </span>
            <span className="text-sm text-[var(--ink-muted)]">to apply</span>
          </div>
        ) : null}
        <CheckList items={items} />
        {needBlind ? (
          <p className="text-sm text-[var(--ink-muted)]">
            {/not a consideration/i.test(needBlind)
              ? "Need-blind: your ability to pay doesn't affect the decision."
              : needBlind}
          </p>
        ) : null}
      </div>
    );
  },
};

const contact: Block = {
  id: "contact",
  question: "apply",
  title: "Admissions office",
  size: "s",
  keys: ["applying.admissions_*"],
  render: (r) => {
    const phone =
      r.text("applying.admissions_phone") ??
      r.text("applying.admissions_phone_direct");
    const email = r.text("applying.admissions_email");
    const address = r.text("applying.admissions_address");
    const fax =
      r.text("applying.admissions_fax") ??
      r.text("applying.admissions_fax_direct");
    if (!phone && !email && !address) return null;
    return (
      <ul className="flex flex-col gap-3 text-sm">
        {email ? (
          <Line icon={<Mail className="size-4" />}>
            <a
              className="text-[var(--ink)] underline decoration-[var(--hairline)] underline-offset-4 hover:decoration-current"
              href={`mailto:${email}`}
            >
              {email}
            </a>
          </Line>
        ) : null}
        {phone ? (
          <Line icon={<Phone className="size-4" />}>
            <span className="tabular-nums text-[var(--ink)]">{phone}</span>
            {fax ? (
              <span className="block text-xs text-[var(--ink-muted)]">
                Fax {fax}
              </span>
            ) : null}
          </Line>
        ) : null}
        {address ? (
          <Line icon={<MapPin className="size-4" />}>{address}</Line>
        ) : null}
      </ul>
    );
  },
};

const finish: Block = {
  id: "finish",
  question: "finish",
  title: "Staying and graduating",
  size: "m",
  keys: ["outcomes.retention_first_year", "outcomes.graduation_rate_*"],
  render: (r) => {
    const items = [
      ["Come back for year 2", "outcomes.retention_first_year"],
      ["Graduate in 4 years", "outcomes.graduation_rate_4y"],
      ["In 5 years", "outcomes.graduation_rate_5y"],
      ["In 6 years", "outcomes.graduation_rate_6y"],
    ].map(([label, k]) => ({
      label: label!,
      value: r.num(k!)?.value ?? null,
      display: r.text(k!) ?? "—",
    }));
    if (items.every((i) => i.value === null)) return null;
    return <Columns items={items} />;
  },
};

const after: Block = {
  id: "after",
  question: "finish",
  title: "Debt and what comes next",
  size: "m",
  keys: [
    "outcomes.graduates_with_loans_pct",
    "outcomes.average_indebtedness",
    "outcomes.advanced_study_pct",
    "outcomes.average_starting_salary",
  ],
  render: (r) => (
    <FigureRow
      items={[
        {
          label: "graduate with loans",
          value: r.text("outcomes.graduates_with_loans_pct"),
        },
        {
          label: "average debt at graduation",
          value: r.text("outcomes.average_indebtedness"),
        },
        {
          label: "go on to graduate school",
          value: r.text("outcomes.advanced_study_pct"),
        },
        {
          label: "average starting salary",
          value: r.text("outcomes.average_starting_salary"),
        },
      ]}
    />
  ),
};

export const APPLY_BLOCKS: Block[] = [deadlines, how, contact];
export const FINISH_BLOCKS: Block[] = [finish, after];
