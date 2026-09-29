import "./landing.css";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";
import { CollegesLab } from "./sections/CollegesLab";
import { COLLEGES_PARAM } from "./cards/colleges/variants";
import { Testimonials } from "./sections/Testimonials";
import { Compare } from "./sections/Compare";
import { Pricing } from "./sections/Pricing";
import { Schools } from "./sections/Schools";
import { Faq } from "./sections/Faq";
import { Footer } from "./sections/Footer";
import { useLandingMotion } from "./useLandingMotion";
import { WaitlistDialog } from "./waitlist/WaitlistDialog";
import { useWaitlistDialog } from "./waitlist/useWaitlistDialog";
import "./responsive.css";

export function LandingPage() {
  const landingRef = useLandingMotion();
  const waitlist = useWaitlistDialog();
  return (
    <div className="lp" ref={landingRef}>
      <a className="lp-skip" href="#features">
        Skip to content
      </a>
      <div className="lp-canvas">
        <Hero />
        <main className="lp-main">
          <Features />
          {COLLEGES_PARAM === "compare" && <CollegesLab />}
          <Testimonials />
          <Compare />
          <Pricing />
          <Schools />
          <Faq />
        </main>
        <Footer />
      </div>
      <WaitlistDialog
        open={waitlist.open}
        request={waitlist.request}
        trigger={waitlist.trigger}
        container={landingRef}
        onClose={waitlist.close}
        onSide={waitlist.showSide}
      />
    </div>
  );
}
