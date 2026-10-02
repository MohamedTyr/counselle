/** Starts or stops the showcase; it names what pressing it will do. */
export function StagePlayback({
  paused,
  onToggle,
}: {
  paused: boolean;
  onToggle: () => void;
}) {
  const label = paused ? "Play showcase" : "Pause showcase";
  return (
    <button
      type="button"
      className="lp-stage-playback"
      aria-label={label}
      onClick={onToggle}
    >
      <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span> {label}
    </button>
  );
}
