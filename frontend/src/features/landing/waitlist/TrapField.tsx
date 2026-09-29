/**
 * The honeypot's name. It means nothing to a browser or a password manager,
 * so autofill leaves it empty and a value in it means a bot filled the form.
 */
export const TRAP_NAME = "lp_t";

/** The honeypot: hidden from people and from assistive technology. */
export function TrapField() {
  return (
    <input
      className="lp-wl-trap"
      name={TRAP_NAME}
      type="text"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      data-1p-ignore=""
      data-lpignore="true"
    />
  );
}
