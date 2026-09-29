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
import {
  useWaitlistDialog,
  useWarmWaitlist,
} from "./waitlist/useWaitlistDialog";

/** Nothing renders until the first open, so the dialog loads on demand. */
const loadDialog = () => import("./waitlist/WaitlistDialog");
const WaitlistDialog = lazy(() =>
  loadDialog().then((module) => ({ default: module.WaitlistDialog })),
);
import "./responsive.css";

export function LandingPage() {
  const landingRef = useLandingMotion();
  const waitlist = useWaitlistDialog();
  useWarmWaitlist(loadDialog);
  // The dialog portals beside the canvas, so making the page inert leaves
  // only the dialog reachable. React drops it in the same commit that closes
  // the dialog, before focus goes back to the trigger.
  const behindDialog = waitlist.open;
  return (
    <div className="lp" ref={landingRef}>
      <StructuredData />
      <a className="lp-skip" href="#top" inert={behindDialog}>
        Skip to content
      </a>
      <div className="lp-canvas" inert={behindDialog}>
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
