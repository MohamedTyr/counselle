import type { KeyboardEvent } from "react";
import { FEATURES, stageTabId } from "./featureList";

const STEPS: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** The tab a key moves to from `active`, or null when the key isn't one. */
function keyTarget(key: string, active: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return FEATURES.length - 1;
  const step = STEPS[key];
  return step ? (active + step + FEATURES.length) % FEATURES.length : null;
}

/**
 * Every blurb in one grid cell, only the shown one visible, so the cell is
 * always as tall as the longest and the stage never changes height.
 */
export function Blurbs({ shown }: { shown: number }) {
  return FEATURES.map(({ id, blurb }, index) => {
    const hidden = index !== shown || undefined;
    return (
      <span key={id} aria-hidden={hidden} data-nosnippet={hidden}>
        {blurb}
      </span>
    );
  });
}

type Props = {
  active: number;
  onSelect: (index: number, byKeyboard: boolean) => void;
};

/** The feature chooser: a vertical tablist, arrows, Home and End move and select. */
export function StageTabs({ active, onSelect }: Props) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyTarget(event.key, active);
    if (next === null) return;
    event.preventDefault();
    onSelect(next, true);
    document.getElementById(stageTabId(FEATURES[next]))?.focus();
  };
  return (
    <div
      className="lp-stage-list"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Features"
      onKeyDown={onKeyDown}
    >
      {FEATURES.map(({ id, title, color }, index) => {
        const selected = index === active;
        return (
          <button
            key={id}
            id={stageTabId(FEATURES[index])}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="lp-stage-panel"
            tabIndex={selected ? 0 : -1}
            className={`lp-stage-tab${selected ? " lp-stage-tab-active" : ""}`}
            onClick={(event) => onSelect(index, event.detail === 0)}
          >
            <span
              className="lp-stage-progress"
              style={{ background: color }}
              aria-hidden="true"
            />
            <span className="lp-stage-title">{title}</span>{" "}
            <span className="lp-stage-blurb">
              <span className="lp-stage-blurbs">
                <Blurbs shown={index} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
