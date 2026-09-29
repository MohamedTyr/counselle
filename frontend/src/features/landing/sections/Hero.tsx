import wordmark from "../assets/wordmark-hero.svg";
import onDot from "../assets/on-dot.svg";
import attach from "../assets/attach.svg";
import image from "../assets/image.svg";
import send from "../assets/send.svg";
import { useRef } from "react";
import { HeroBackdrop } from "./HeroBackdrop";
import { HeroCards } from "./HeroCards";
import { SchoolsMarquee } from "./SchoolsMarquee";
import { PROMPTS, useComposerTypewriter } from "../useComposerTypewriter";
import { useNavScroll } from "../useNavScroll";
import { useNavGlide } from "../useNavGlide";
import { CONTACT_EMAIL } from "../brand";
import { WAITLIST_HREF } from "../waitlist/useWaitlistDialog";
import "./hero.css";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Contact", href: `mailto:${CONTACT_EMAIL}` },
];

/** An arrow up and to the right, the two wings of its head curving in to
    the point. */
export function CtaArrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(-45 12 12)">
        <path d="M4 12h15.5" />
        <path d="M13 5c.9 3.6 3.1 5.9 6.5 7-3.4 1.1-5.6 3.4-6.5 7" />
      </g>
    </svg>
  );
}

/** The site header: first in the page, fixed over the hero. */
export function HeroNav() {
  const nav = useNavScroll();
  const links = useNavGlide();
  return (
    <header className="lp-nav" ref={nav} data-state="rest">
      <a className="lp-brand" href="/">
        <img src={wordmark} width={122} height={37} alt="Acceptra" />
      </a>
      <nav className="lp-nav-links" ref={links} aria-label="Main navigation">
        <span className="lp-nav-glide" aria-hidden="true" />
        {NAV_LINKS.map(({ label, href }) => (
          <a key={label} href={href}>
            {label}
          </a>
        ))}
        {/* Phones have no room for two buttons, so schools move into the links. */}
        <a className="lp-nav-schools-link" href="#schools">
          For schools
        </a>
      </nav>
      <div className="lp-nav-actions">
        <a className="lp-nav-secondary" href="#schools">
          For schools
        </a>
        <a
          className="lp-nav-cta"
          href={WAITLIST_HREF}
          data-waitlist-source="nav"
        >
          Join waitlist
          <span className="lp-nav-cta-chip" aria-hidden="true">
            <CtaArrow />
          </span>
        </a>
      </div>
    </header>
  );
}

function HeroHeadline() {
  return (
    <h1 className="lp-headline">
      {/* The spaces keep the words apart in raw HTML; flex layout ignores them. */}
      <span className="lp-headline-line lp-headline-line-1">
        <span>AI College</span> <span>counseling</span>
      </span>{" "}
      <span className="lp-headline-line lp-headline-line-2">
        <span>For your next</span>{" "}
        <span className="lp-headline-serif">Chapter</span>
      </span>
    </h1>
  );
}

function HeroComposer() {
  const request = useRef<HTMLSpanElement>(null);
  useComposerTypewriter(request);
  return (
    <div className="lp-composer" aria-hidden="true" data-nosnippet>
      <div className="lp-composer-input">
        <span className="lp-token">/goal</span>
        <span className="lp-token">@user-profile</span>
        <span className="lp-composer-request">
          <span className="lp-composer-text" ref={request}>
            {PROMPTS[0]}
          </span>
        </span>
      </div>
      <div className="lp-composer-toolbar">
        <div className="lp-mode-toggle">
          <div className="lp-mode-knob">
            <img src={onDot} width={6} height={6} alt="" />
            <span>Goal mode</span>
          </div>
        </div>
        <span className="lp-composer-divider" />
        <img src={attach} width={18} height={18} alt="" />
        <span className="lp-composer-spacer" />
        <img src={image} width={18} height={18} alt="" />
        <span className="lp-composer-divider" />
        <span className="lp-send">
          <img src={send} width={15} height={15} alt="" />
        </span>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="lp-hero-section" id="top" aria-label="Acceptra">
      <div className="lp-hero">
        <HeroBackdrop />
        <div className="lp-hero-body">
          <HeroHeadline />
          <HeroComposer />
        </div>
        <div className="lp-hero-grain" aria-hidden="true" />
        <HeroCards />
        <div className="lp-hero-glow" aria-hidden="true" />
      </div>
      <SchoolsMarquee />
    </section>
  );
}
