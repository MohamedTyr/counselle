import { lazy, Suspense } from "react";
import "./landing.css";
import { Hero, HeroNav } from "./sections/Hero";
import { Features } from "./sections/Features";
import { Compare } from "./sections/Compare";
import { Pricing } from "./sections/Pricing";
import { Schools } from "./sections/Schools";
import { Faq } from "./sections/Faq";
import { Footer } from "./sections/Footer";
import { Testimonials } from "./sections/Testimonials";
import { StructuredData } from "./StructuredData";
import { useLandingMotion } from "./useLandingMotion";
import { useWaitlistDialog } from "./waitlist/useWaitlistDialog";

/** Nothing renders until the first open, so the dialog loads on demand. */
const WaitlistDialog = lazy(() =>
  import("./waitlist/WaitlistDialog").then((module) => ({
    default: module.WaitlistDialog,
  })),
);
import "./responsive.css";

export function LandingPage() {
  const landingRef = useLandingMotion();
  const waitlist = useWaitlistDialog();
  return (
    <div className="lp" ref={landingRef}>
      <StructuredData />
      <a className="lp-skip" href="#top">
        Skip to content
      </a>
      <div className="lp-canvas">
        <HeroNav />
        <main className="lp-page">
          <Hero />
          <div className="lp-main">
            <Features />
            <Testimonials />
            <Compare />
            <Pricing />
            <Schools />
            <Faq />
          </div>
        </main>
        <Footer />
      </div>
      {waitlist.request && (
        <Suspense fallback={null}>
          <WaitlistDialog
            open={waitlist.open}
            request={waitlist.request}
            trigger={waitlist.trigger}
            container={landingRef}
            onClose={waitlist.close}
            onSide={waitlist.showSide}
          />
        </Suspense>
      )}
    </div>
  );
}
