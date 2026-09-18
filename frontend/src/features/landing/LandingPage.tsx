import { ArrowUpRight, Play } from "lucide-react";
import { CounselleLogo } from "@/features/shell/CounselleLogo";
import { PlanDemo } from "./PlanDemo";
import "./landing.css";

export function LandingPage() {
  function showExample() {
    const example = document.getElementById("example");
    example?.scrollIntoView({ behavior: "instant", block: "nearest" });
    example?.focus({ preventScroll: true });
  }

  return (
    <div className="landing-page">
      <a className="landing-skip" href="#hero-content">
        Skip to content
      </a>
      <header className="landing-nav">
        <a className="landing-wordmark" href="/" aria-label="Counselle home">
          <CounselleLogo />
          <span>counselle</span>
        </a>
        <nav aria-label="Main navigation">
          <button className="landing-nav-example" onClick={showExample}>
            How it works
          </button>
          <a className="landing-signin" href="/login">
            Sign in <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </nav>
      </header>
      <main className="landing-hero" id="hero-content">
        <div className="hero-title">
          <h1>
            Your college ambitions.
            <br />
            <span>A plan that fits you.</span>
          </h1>
        </div>
        <div className="hero-copy">
          <p>
            Your AI college counselor for choosing schools, strengthening
            essays, and knowing what to do next.
          </p>
          <div className="hero-actions">
            <a className="landing-primary" href="/register">
              Build my plan <ArrowUpRight size={19} aria-hidden="true" />
            </a>
            <button className="landing-secondary" onClick={showExample}>
              <Play size={13} fill="currentColor" aria-hidden="true" />
              See an example
            </button>
          </div>
        </div>
        <PlanDemo />
      </main>
    </div>
  );
}
