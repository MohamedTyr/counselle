/**
 * ThinkingShimmer (B5d, the agent review's D1) — the dead-air cover.
 *
 * A subtle animated "Thinking…" line shown while the turn is live but nothing
 * is visibly progressing: from send until the first protocol event, and between
 * a step's end and the next event. It is TRUTHFUL — the model is thinking — and
 * it bounds Gemini's multi-second first-token gap (keepalives keep the pipe
 * alive but paint nothing). It claims no specific activity; just "Thinking…".
 *
 * Motion is compositor-friendly (opacity/transform only) and respects
 * `prefers-reduced-motion` (the keyframes degrade to a static line).
 */
export default function ThinkingShimmer() {
  return (
    <div className="not-prose my-2" aria-live="polite">
      <span className="counselle-thinking text-sm italic text-text-secondary">Thinking…</span>
    </div>
  );
}
