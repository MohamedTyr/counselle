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

/** The dialog is its own chunk, loaded on intent or idle, never up front. */
const loadDialog = () => import("./waitlist/WaitlistDialog");
import "./responsive.css";

export function LandingPage() {
  const landingRef = useLandingMotion();
  const waitlist = useWaitlistDialog();
  const dialog = useWarmWaitlist(loadDialog, waitlist.request !== null);
  // The dialog portals beside the canvas, so making the page inert leaves
  // only the dialog reachable. Until its chunk has loaded there is no dialog,
  // so the page stays live rather than locking behind nothing. React drops it
  // in the same commit that closes the dialog, before focus goes back to the
  // trigger.
  const behindDialog = waitlist.open && dialog !== null;
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
      {waitlist.request && dialog && (
        <dialog.WaitlistDialog
          open={waitlist.open}
          request={waitlist.request}
          trigger={waitlist.trigger}
          container={landingRef}
          onClose={waitlist.close}
          onSide={waitlist.showSide}
        />
      )}
    </div>
  );
}
