import { Tabs } from "@base-ui/react/tabs";
import { Check, Plus, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { landingExamples, type LandingExample } from "./examples";

function ExamplePlan({
  example,
  replay,
}: {
  example: LandingExample;
  replay: number;
}) {
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const tasksId = useId();
  const [completed, setCompleted] = useState<readonly number[]>([]);
  const scene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !replay ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const elements = scene.current?.querySelectorAll("[data-demo-reveal]");
    const animations = Array.from(elements ?? []).map((element, index) =>
      element.animate(
        [
          { opacity: 0.25, translate: "0 12px" },
          { opacity: 1, translate: "0 0" },
        ],
        {
          duration: 650,
          delay: index * 300,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          fill: "backwards",
        },
      ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [replay]);

  function toggleTask(index: number) {
    setCompleted((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index],
    );
  }

  return (
    <div className="plan-scene" ref={scene}>
      <div className="conversation-slip" data-demo-reveal>
        <span className="conversation-label">It starts with you</span>
        <p>“{example.question}”</p>
      </div>
      <div className="plan-sheet" data-demo-reveal>
        <div className="plan-sheet-heading">
          <span className="plan-brand">counselle</span>
          <span className="example-label">Example plan</span>
        </div>
        <div className="counselor-note">
          <p>{example.response}</p>
        </div>
        <div className="plan-content" data-demo-reveal>
          <h2>{example.title}</h2>
          <div
            id={tasksId}
            data-expanded={expanded || undefined}
            className="plan-task-list"
            aria-label="Try checking off an example task"
          >
            {example.tasks.map((task, index) => (
              <label
                className="plan-task"
                key={task}
                data-extra={index > 0 || undefined}
              >
                <input
                  type="checkbox"
                  checked={completed.includes(index)}
                  onChange={() => toggleTask(index)}
                />
                <span className="task-check" aria-hidden="true">
                  <Check size={13} strokeWidth={2.5} />
                </span>
                <span>{task}</span>
              </label>
            ))}
          </div>
          <button
            className="expand-example"
            aria-expanded={expanded}
            aria-controls={tasksId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "See the next two steps"}
          </button>
          <div className="plan-sheet-footer">
            <span role="status">
              {saved ? example.outcome : "Try checking off your first step."}
            </span>
            <button
              className="save-example"
              onClick={() => setSaved((current) => !current)}
              aria-pressed={saved}
              aria-label={
                saved
                  ? "Added to plan (example). Click to remove"
                  : "Add to plan (example)"
              }
            >
              {saved ? <Check size={16} /> : <Plus size={16} />}
              {saved ? "Added" : "Add to plan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlanDemo() {
  const [hasSwitched, setHasSwitched] = useState(false);
  const [selected, setSelected] = useState<string>("schools");
  const [replay, setReplay] = useState(0);
  const example =
    landingExamples.find((item) => item.id === selected) ?? landingExamples[0];

  return (
    <div
      className="hero-demo"
      id="example"
      tabIndex={-1}
      data-switched={hasSwitched || undefined}
    >
      <Tabs.Root
        className="demo-tabs-root"
        value={selected}
        onValueChange={(value) => {
          setHasSwitched(true);
          setSelected(String(value));
          setReplay(0);
        }}
      >
        <div className="demo-controls">
          <Tabs.List
            className="example-tabs"
            aria-label="Explore what Counselle can do"
          >
            {landingExamples.map((item) => (
              <Tabs.Tab key={item.id} value={item.id} className="example-tab">
                {item.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <button
            className="replay-button"
            aria-label="Replay example"
            onClick={() => setReplay((current) => current + 1)}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>
        <Tabs.Panel value={selected} className="demo-panel">
          <ExamplePlan key={selected} example={example} replay={replay} />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}
