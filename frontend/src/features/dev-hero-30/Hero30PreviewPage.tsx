import { useState, type SVGProps } from "react";
import { motion } from "motion/react";
import { ArrowRight, ChevronDown, Globe, Menu, Play } from "lucide-react";

import { Button } from "@/components/ui/button";

/*
 * Dev-only preview of Watermelon UI's `hero-30` block, kept as close to the
 * upstream source as this repo's dependencies allow: Hugeicons is swapped for
 * lucide-react, and the three brand marks plus the logo are inline SVG because
 * lucide ships no brand icons. The hardcoded palette is upstream's, not ours —
 * this is a look-at-it page, not a design-system surface.
 */

interface Hero30Props {
  title?: string;
  subtitle?: string;
  customersText?: string;
  avatars?: string[];
  primaryActionText?: string;
  secondaryActionText?: string;
  backgroundImage?: string;
}

type IconProps = SVGProps<SVGSVGElement>;

function LogoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden {...props}>
      <path d="M3 12a13 13 0 0 0 26 0Z" />
    </svg>
  );
}

function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78Zm-1.08 16.17h1.7L7.4 4.74H5.58Z" />
    </svg>
  );
}

function YoutubeIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="m10 9 5 3-5 3Z" fill="currentColor" />
    </svg>
  );
}

function InstagramIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.25" cy="6.75" r="0.75" fill="currentColor" />
    </svg>
  );
}

const NAV_ITEMS = ["Journey", "Our Story", "What We Offer", "Connect"];
const SOCIAL_ICONS = [XIcon, YoutubeIcon, InstagramIcon];

function Hero30({
  title = "Minimal Design\nPowerful by Feel",
  subtitle = "Designed to bring calm, clarity, and effortless\nelegance into your everyday digital experience.",
  customersText = "+20K Happy Customers",
  avatars = [
    "https://assets.watermelon.sh/wm_ben.png",
    "https://assets.watermelon.sh/wm_alex.png",
    "https://assets.watermelon.sh/wm_olivia.png",
    "https://assets.watermelon.sh/wm_mia.png",
  ],
  primaryActionText = "Discover More",
  secondaryActionText = "Watch Demo",
  backgroundImage = "https://assets.watermelon.sh/footer-30.avif",
}: Hero30Props) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <section className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-[#8FC5E7]">
      {backgroundImage ? (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${backgroundImage})` }}
        />
      ) : null}
      <div className="absolute inset-0 z-0 bg-white/20 sm:bg-transparent" />

      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-20 flex w-full items-center justify-between px-6 py-6 lg:px-12"
      >
        <div className="flex items-center gap-2 text-[#1C201A]">
          <LogoIcon className="size-8 text-white" />
          <span className="text-2xl font-bold tracking-tight">Watermelon</span>
        </div>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item}
              href="#"
              className="text-[15px] font-medium text-[#1C201A] transition-colors hover:text-black"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-6 md:flex">
          <button className="flex items-center gap-1.5 text-[15px] font-medium text-[#1C201A] transition-colors hover:text-black">
            <Globe className="size-4" />
            <span>EN</span>
            <ChevronDown className="size-4" />
          </button>

          <Button className="h-11 rounded-none bg-[#2B3024] px-6 text-[15px] font-medium text-white transition-all hover:bg-black">
            Log In <ArrowRight className="ml-1.5 size-4" />
          </Button>
        </div>

        <button
          className="p-2 text-[#1C201A] md:hidden"
          aria-label="Toggle menu"
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          <Menu className="size-6" />
        </button>
      </motion.header>

      <div className="relative z-10 container mx-auto flex flex-1 flex-col justify-center px-6 pt-12 md:pt-0 lg:px-12">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
          className="max-w-3xl"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex -space-x-3">
              {avatars.map((url, i) => (
                <img
                  key={url}
                  src={url}
                  alt={`Customer ${i + 1}`}
                  className="size-8 rounded-full border-2 border-[#8FC5E7] object-cover sm:size-10"
                />
              ))}
            </div>
            <span className="text-sm font-medium text-[#1C201A]/90 sm:text-base">
              {customersText}
            </span>
          </div>

          <h1 className="mb-6 text-5xl leading-[1.05] font-medium tracking-tighter whitespace-pre-line text-[#1C201A] sm:text-6xl md:text-7xl lg:text-[84px]">
            {title}
          </h1>

          <p className="mb-10 max-w-xl text-lg leading-relaxed whitespace-pre-line text-[#1C201A]/80 sm:text-xl">
            {subtitle}
          </p>

          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
            <Button
              size="lg"
              className="h-14 rounded-none bg-[#2B3024] px-8 text-base font-medium text-white transition-all hover:bg-black"
            >
              {primaryActionText} <ArrowRight className="ml-2 size-5" />
            </Button>

            <button className="group flex items-center gap-3 text-base font-medium text-[#1C201A] transition-colors hover:text-black">
              {secondaryActionText}
              <div className="flex size-10 items-center justify-center rounded-full bg-[#2B3024] text-white transition-transform group-hover:scale-110">
                <Play className="size-4 fill-current" />
              </div>
            </button>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeOut", delay: 0.4 }}
        className="relative z-10 flex w-full flex-col-reverse items-start justify-between gap-6 px-6 pb-8 md:flex-row md:items-end lg:px-12"
      >
        <div className="flex items-center gap-4">
          {SOCIAL_ICONS.map((Icon) => (
            <a
              key={Icon.name}
              href="#"
              className="flex size-12 items-center justify-center rounded-full border border-[#1C201A]/20 text-[#1C201A] transition-colors hover:bg-[#1C201A]/10"
            >
              <Icon className="size-5" />
            </a>
          ))}
        </div>

        <a
          href="#"
          className="group flex items-center gap-2 text-[15px] font-medium text-[#1C201A] transition-colors hover:text-black"
        >
          Talk to our team
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </a>
      </motion.div>
    </section>
  );
}

/*
 * Upstream's default `backgroundImage` (`footer-30.avif`) is a screenshot of
 * their footer block, not a hero photo, and it buries the text. The preview
 * drops it so the layout reads against the block's own sky-blue fallback.
 */
export function Hero30PreviewPage() {
  return <Hero30 backgroundImage="" />;
}
