import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  COLLEGES_VARIANTS,
  type CollegesVariant,
} from "../cards/colleges/variants";
import {
  playCurrentColleges,
  playDemonstration,
} from "../useIllustrationMotion";
import "./features-stage.css";
import "./colleges-lab.css";

function LabEntry({ variant }: { variant: CollegesVariant }) {
  const [run, setRun] = useState(0);
  const [inView, setInView] = useState(false);
  const figure = useRef<HTMLDivElement>(null);
  const { Sheet } = variant;

  useEffect(() => {
    const node = figure.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setInView(true),
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = figure.current;
    if (!node || !inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations = playDemonstration(
      node,
      variant.play ?? playCurrentColleges,
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [inView, run, variant]);

  return (
    <article className="lp-lab-entry">
      <div className="lp-lab-text">
        <h3>{variant.label}</h3>
        <p>{variant.idea}</p>
        <div className="lp-lab-actions">
          <button type="button" onClick={() => setRun((count) => count + 1)}>
            Replay
          </button>
          <a href={`?colleges=${variant.id}#features`}>Show in showcase</a>
        </div>
      </div>
      <div className="lp-lab-panel">
        <div className="lp-lab-figure" ref={figure}>
          <div
            key={run}
            className={`lp-stage-art lp-stage-art-${variant.size}`}
          >
            <Sheet />
          </div>
        </div>
      </div>
    </article>
  );
}

/** Every candidate school-matching illustration, side by side. */
export function CollegesLab() {
  return (
    <section className="lp-lab" aria-label="School matching variations">
      <h2 className="lp-heading">School matching, five ways</h2>
      {COLLEGES_VARIANTS.map((variant) => (
        <LabEntry key={variant.id} variant={variant} />
      ))}
    </section>
  );
}
