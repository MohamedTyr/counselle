/* The shell's beams. Full strength on the home screen, faint everywhere
 * else so content carries the screen. Rendered inside an isolated, relatively
 * positioned parent (`.as-main`, or the SAT practice frame). */
export function BeamsBackground({ quiet }: { quiet: boolean }) {
  return (
    <div aria-hidden="true" className="as-beams" data-quiet={quiet || undefined}>
      <div className="as-beam"><span /></div>
      <div className="as-beam"><span /></div>
      <div className="as-beam"><span /></div>
      <div className="as-beam"><span /></div>
      <div className="as-grain" />
    </div>
  );
}
