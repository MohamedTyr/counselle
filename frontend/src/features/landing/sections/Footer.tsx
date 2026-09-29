import wordmark from "../assets/wordmark-footer.svg";
import arrow from "../assets/footer-arrow.svg";
import { useId, useState, type FormEvent } from "react";
import { track } from "../analytics";
import {
  emailProblem,
  failureStatus,
  submitWaitlist,
} from "../waitlist/waitlist";
import { LegalConsent, PRIVACY_URL, TERMS_URL } from "../waitlist/LegalConsent";
import "./footer.css";

const PRODUCT_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Compare", href: "#compare" },
  { label: "Pricing", href: "#pricing" },
  { label: "Testimonials", href: "#testimonials-heading" },
];
const COMPANY_LINKS = [
  { label: "FAQ", href: "#faq" },
  { label: "Contact", href: "mailto:hello@acceptra.ai" },
  { label: "Privacy", href: PRIVACY_URL },
  { label: "Terms", href: TERMS_URL },
];

type Signup = "idle" | "sending" | "joined";

function FooterSignup() {
  const problemId = useId();
  const [state, setState] = useState<Signup>("idle");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "idle") return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const invalid = emailProblem(email);
    setProblem(invalid);
    if (invalid) return;
    setState("sending");
    try {
      // A filled trap field is a bot; it is told it joined and nothing is sent.
      if (!form.get("website")) {
        await submitWaitlist({ email, side: "me", source: "footer" });
        track("waitlist_joined", { side: "me", source: "footer" });
      }
      setState("joined");
    } catch (error) {
      track("waitlist_failed", {
        side: "me",
        source: "footer",
        step: "join",
        status: failureStatus(error),
      });
      setState("idle");
      setProblem("We couldn't reach the list. Try again.");
    }
  }

  return (
    <>
      <label
        className="lp-footer-newsletter"
        htmlFor="newsletter-email"
        id="waitlist"
      >
        Join the waitlist
      </label>
      <form
        className="lp-footer-email"
        method="post"
        onSubmit={submit}
        noValidate
      >
        {state === "joined" ? (
          <p className="lp-footer-joined" role="status">
            You&rsquo;re on the list
          </p>
        ) : (
          <input
            id="newsletter-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="Your email address"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
          />
        )}
        <input
          className="lp-wl-trap"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        <button
          type="submit"
          className="lp-footer-submit"
          aria-label="Join the waitlist"
          disabled={state === "joined"}
        >
          <img src={arrow} width={12} height={12} alt="" />
        </button>
      </form>
      <p className="lp-footer-problem" id={problemId} role="alert">
        {problem}
      </p>
      <LegalConsent className="lp-footer-consent" />
    </>
  );
}

export function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <a className="lp-footer-wordmark" href="/">
          <img src={wordmark} width={90} height={28} alt="Acceptra" />
        </a>
        <p className="lp-footer-tagline">
          <span>All-in-one college counseling,</span>{" "}
          <span className="lp-footer-tagline-soft">
            without the $10,000 price tag.
          </span>
        </p>
        <FooterSignup />
        <span
          className="lp-footer-divider lp-footer-divider-1"
          aria-hidden="true"
        />
        <span
          className="lp-footer-divider lp-footer-divider-2"
          aria-hidden="true"
        />
        <nav
          className="lp-footer-links lp-footer-links-product"
          aria-label="Product"
        >
          {PRODUCT_LINKS.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <nav
          className="lp-footer-links lp-footer-links-company"
          aria-label="Company"
        >
          {COMPANY_LINKS.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
