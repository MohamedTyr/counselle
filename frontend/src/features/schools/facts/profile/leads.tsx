import type React from "react";

import { Soft } from "./atoms";
import type { QuestionId } from "./blocks-types";
import { type Digest, datedRounds, daysUntil, oneIn } from "./digest";

/*
 * The one sentence that opens each question — what the numbers below it
 * add up to, stated with the numbers themselves so it can't drift from
 * them. A question with nothing to say returns null and opens on its
 * blocks instead.
 */

export function lead(question: QuestionId, d: Digest): React.ReactNode | null {
  const a = d.admissions;
  const m = d.money;
  switch (question) {
    case "in":
      return a.admitted && a.applicants ? (
        <>
          {a.admitted.display} of {a.applicants.display} applicants got in.{" "}
          <Soft>That's {oneIn(a.applicants, a.admitted)}.</Soft>
        </>
      ) : null;
    case "cost": {
      const sticker = m.costOut ?? m.costIn;
      if (!sticker) return null;
      const two = m.costIn && m.costOut && m.costIn.value !== m.costOut.value;
      return (
        <>
          {two
            ? `${m.costIn!.display} a year in state, ${m.costOut!.display} out of state.`
            : `${sticker.display} a year before aid.`}{" "}
          {m.avgAward ? (
            <Soft>Freshmen with need got {m.avgAward.display} on average.</Soft>
          ) : null}
        </>
      );
    }
    case "apply": {
      const next = datedRounds(d.applying.deadlines).find(
        (r) => daysUntil(r.date) >= 0,
      );
      return next ? (
        <>
          {next.round} closes {next.display}.{" "}
          <Soft>{daysUntil(next.date)} days from today.</Soft>
        </>
      ) : null;
    }
    case "learn":
      return d.academics.majorsCount ? (
        <>
          {d.academics.majorsCount.display} majors.{" "}
          {d.academics.popular.length ? (
            <Soft>
              Most students study{" "}
              {d.academics.popular.slice(0, 2).join(" or ").toLowerCase()}.
            </Soft>
          ) : null}
        </>
      ) : null;
    case "life":
      return d.campus.undergrads ? (
        <>
          {d.campus.undergrads.display} undergraduates
          {d.campus.nearestMetro
            ? ` near ${d.campus.nearestMetro.display}`
            : ""}
          .{" "}
          {d.campus.inHousingPct ? (
            <Soft>{d.campus.inHousingPct.value}% live on campus.</Soft>
          ) : null}
        </>
      ) : null;
    case "finish":
      return d.outcomes.grad4 ? (
        <>
          {d.outcomes.grad4.display} graduate in four years.{" "}
          {d.outcomes.grad6 ? (
            <Soft>{d.outcomes.grad6.display} within six.</Soft>
          ) : null}
        </>
      ) : null;
  }
}
