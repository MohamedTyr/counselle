export const PRIVACY_URL = "/privacy.html";
export const TERMS_URL = "/terms.html";

export function LegalConsent({ className }: { className: string }) {
  return (
    <p className={className}>
      By joining, you agree to our <a href={TERMS_URL}>Terms</a> and{" "}
      <a href={PRIVACY_URL}>Privacy Policy</a>.
    </p>
  );
}
