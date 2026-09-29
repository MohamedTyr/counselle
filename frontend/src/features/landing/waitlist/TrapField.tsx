/**
 * The honeypot: hidden from people and from assistive technology, so a value
 * in it means a bot filled the form. Its name is what the forms check.
 */
export function TrapField() {
  return (
    <input
      className="lp-wl-trap"
      name="website"
      type="text"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
    />
  );
}
