import { useId } from "react";
import { Check } from "lucide-react";

const W = 520;
const H = 84;
const GPA_MIN = 3.4;
const GPA_MAX = 4.0;
const TICKS = [3.4, 3.6, 3.8, 4.0];
const BAND = [3.8, 4.0];
const YOU = 3.9;
const x = (gpa: number) => ((gpa - GPA_MIN) / (GPA_MAX - GPA_MIN)) * W;

/** Admitted GPAs pile up just under 4.0: a long left tail, a steep right edge. */
function density(gpa: number) {
  const peak = 3.93;
  const spread = gpa < peak ? 0.14 : 0.07;
  return Math.exp(-(((gpa - peak) / spread) ** 2) / 2);
}
const y = (gpa: number) => H - density(gpa) * (H - 8);

const LINE = Array.from({ length: 61 }, (_, index) => {
  const gpa = GPA_MIN + ((GPA_MAX - GPA_MIN) * index) / 60;
  return `${index ? "L" : "M"}${x(gpa).toFixed(1)} ${y(gpa).toFixed(1)}`;
}).join(" ");
const AREA = `${LINE} L${W} ${H} L0 ${H} Z`;

function Verdict() {
  return (
    <span className="lp-cx-fit-check">
      <Check size={10} strokeWidth={3.25} />
    </span>
  );
}

/** Where the student's GPA falls among the school's admits. */
function GradesCurve() {
  const id = useId();
  const clip = `${id}-area`;
  const wash = `${id}-wash`;
  return (
    <div className="lp-cx-grades">
      <p className="lp-cx-fit-label">
        Grades
        <Verdict />
      </p>
      <svg
        className="lp-cx-curve"
        viewBox={`0 -26 ${W} ${H + 46}`}
        width="100%"
      >
        <defs>
          <linearGradient id={wash} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6a5bd6" stopOpacity="0.2" />
            <stop offset="1" stopColor="#6a5bd6" stopOpacity="0.02" />
          </linearGradient>
          <clipPath id={clip}>
            <path d={AREA} />
          </clipPath>
        </defs>
        <path className="lp-cx-curve-area" d={AREA} fill={`url(#${wash})`} />
        <g className="lp-cx-curve-band">
          <rect
            x={x(BAND[0])}
            y={0}
            width={x(BAND[1]) - x(BAND[0])}
            height={H}
            clipPath={`url(#${clip})`}
          />
          <text x={x(BAND[0]) + 8} y={H - 8}>
            Middle 50%
          </text>
        </g>
        <path className="lp-cx-curve-line" d={LINE} pathLength={1} />
        <line className="lp-cx-curve-axis" x1={0} x2={W} y1={H} y2={H} />
        {TICKS.map((tick, index) => (
          <text
            key={tick}
            className="lp-cx-curve-tick"
            x={x(tick)}
            y={H + 16}
            textAnchor={
              index === 0
                ? "start"
                : index === TICKS.length - 1
                  ? "end"
                  : "middle"
            }
          >
            {tick.toFixed(1)}
          </text>
        ))}
        <g className="lp-cx-curve-you">
          <line x1={x(YOU)} x2={x(YOU)} y1={y(YOU)} y2={H} />
          <circle cx={x(YOU)} cy={y(YOU)} r={5} />
          <g transform={`translate(${x(YOU)} ${y(YOU) - 16})`}>
            <rect x={-30} y={-11} width={60} height={20} rx={6} />
            <text y={3.5}>You · 3.9</text>
          </g>
        </g>
      </svg>
    </div>
  );
}

/** The school's fit, drawn: one big curve, then cost and major as plain figures. */
export function FitCharts() {
  return (
    <div className="lp-cx-fit">
      <GradesCurve />
      <div className="lp-cx-stats">
        <div className="lp-cx-stat">
          <p className="lp-cx-fit-label">
            Cost
            <Verdict />
          </p>
          <p className="lp-cx-cost">
            <b>$18k</b>
            <span className="lp-cx-cost-bar">
              <span />
            </span>
            <span className="lp-cx-muted">$25k budget</span>
          </p>
        </div>
        <div className="lp-cx-stat">
          <p className="lp-cx-fit-label">
            Major
            <Verdict />
          </p>
          <p className="lp-cx-rank">
            <b>Top 10</b>
            <span className="lp-cx-muted">in computer science</span>
          </p>
        </div>
      </div>
    </div>
  );
}
