import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import type {
  AbsentTopic,
  SchoolIdentity,
} from "@/features/schools/facts/school-facts-types";

/*
 * The thirteen topics confirmed absent from the entire Common Data Set —
 * need-blind vs need-aware, the meets-full-need pledge, superscoring, EA
 * counts, admit rate by major, the program catalogue, net price by income
 * band, post-graduation outcomes, campus setting, legacy and athlete rates,
 * the application platform, deferral behaviour, religious affiliation.
 *
 * This group never collapses. Omitting it, or folding it behind a
 * disclosure, would make the page look complete — and looking complete
 * while silently dropping the questions a student most wants answered is
 * the exact lie this whole design exists to avoid. Saying "we don't have
 * this, and here is how to get it" costs one group and buys the reader a
 * correct model of what we know.
 */

function askText(topic: AbsentTopic, identity: SchoolIdentity): string {
  return `For ${identity.name}: ${topic.topic.toLowerCase()}? The Common Data Set doesn't publish this — please check the school's official sources.`;
}

export function AbsentGroup({
  identity,
  topics,
}: {
  identity: SchoolIdentity;
  topics: readonly AbsentTopic[];
}) {
  if (topics.length === 0) return null;

  return (
    <section
      aria-labelledby={`absent-${topics[0].section}`}
      className="flex flex-col gap-3 border-t border-[var(--hairline)] pt-5"
    >
      <h3
        className="text-sm font-medium text-[var(--ink)]"
        id={`absent-${topics[0].section}`}
      >
        Not published in the CDS
      </h3>
      <ul className="flex flex-col gap-4">
        {topics.map((topic) => (
          <li className="flex flex-col gap-1" key={topic.id}>
            <p className="text-sm text-[var(--school-fact-label)]">
              {topic.topic}
            </p>
            <p className="text-xs leading-5 text-[var(--ink-muted)]">
              {topic.explanation}
            </p>
            <div>
              <Button
                className="-ml-2"
                render={
                  /*
                   * The existing onboarding handoff: router state prefills
                   * the composer and never submits. Reused rather than
                   * re-invented, so there is one way a surface hands a
                   * question to the agent.
                   */
                  <Link
                    state={{ draftPrompt: askText(topic, identity) }}
                    to="/app/ai"
                  />
                }
                size="sm"
                variant="ghost"
              >
                Ask Counselle to check {identity.domain ?? "the school's site"}
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
