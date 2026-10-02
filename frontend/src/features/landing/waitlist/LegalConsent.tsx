export const PRIVACY_URL = "/privacy";
export const TERMS_URL = "/terms";

export function LegalConsent({ className }: { className: string }) {
  return (
    <p className={className}>
      By joining, you confirm you&rsquo;re 13 or older and agree to our{" "}
      <a href={TERMS_URL}>Terms</a> and <a href={PRIVACY_URL}>Privacy Policy</a>
      .
    </p>
  );
}
