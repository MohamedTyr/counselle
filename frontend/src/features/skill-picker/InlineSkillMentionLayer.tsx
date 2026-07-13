import { useMemo } from "react";
import type React from "react";

function escapeExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skillMentionExpression(selectedSkills: readonly string[]) {
  const names = [...selectedSkills]
    .sort((left, right) => right.length - left.length)
    .map(escapeExpression);

  return names.length > 0
    ? new RegExp(`(@(?:${names.join("|")}))(?=$|[^A-Za-z0-9-])`, "g")
    : null;
}

export function hasInlineSkillMention(
  value: string,
  selectedSkills: readonly string[],
) {
  const expression = skillMentionExpression(selectedSkills);
  return expression !== null && expression.test(value);
}

export function InlineSkillMentionLayer({
  scrollTop,
  selectedSkills,
  value,
}: {
  scrollTop: number;
  selectedSkills: readonly string[];
  value: string;
}): React.ReactElement | null {
  const parts = useMemo(() => {
    const expression = skillMentionExpression(selectedSkills);
    if (!expression || !value) {
      return [value];
    }

    const result: React.ReactNode[] = [];
    let currentIndex = 0;

    for (const match of value.matchAll(expression)) {
      const [mention] = match;
      const index = match.index ?? 0;
      result.push(value.slice(currentIndex, index));
      result.push(
        <mark
          className="rounded-[var(--workspace-composer-skill-highlight-radius)] bg-[var(--workspace-composer-skill-highlight)] text-transparent shadow-[3px_0_0_var(--workspace-composer-skill-highlight),-3px_0_0_var(--workspace-composer-skill-highlight),inset_0_-1px_0_var(--workspace-composer-control-border)]"
          data-slot="inline-skill-mention"
          key={`${index}-${mention}`}
        >
          {mention}
        </mark>,
      );
      currentIndex = index + mention.length;
    }

    result.push(value.slice(currentIndex));
    return result;
  }, [selectedSkills, value]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden px-[var(--workspace-composer-inset)] pt-[var(--workspace-composer-prompt-inset-block-start)] pb-3 text-base leading-5 text-transparent"
      data-slot="inline-skill-mention-layer"
    >
      <div
        className="wrap-break-word whitespace-pre-wrap"
        style={{ transform: `translateY(-${scrollTop}px)` }}
      >
        {parts}
      </div>
    </div>
  );
}
