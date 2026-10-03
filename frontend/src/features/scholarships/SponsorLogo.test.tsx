import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SponsorLogo } from "./SponsorLogo";

vi.mock("@/features/scholarships/sponsor-colours", () => ({
  hasServiceFavicon: (hostname: string) => hostname !== "nofavicon.test",
}));

const scholarship = {
  name: "Scholarship",
  sponsor: "Sponsor Foundation",
  logo_url: "",
  source_url: "https://sponsor.test/scholarships",
  apply_url: "https://apply.test/submit",
};

describe("SponsorLogo", () => {
  it("shows a site's own 16px favicon", () => {
    const { container } = render(<SponsorLogo scholarship={scholarship} />);
    fireEvent.error(container.querySelector("img")!);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "https://sponsor.test/favicon.ico");
    Object.defineProperty(image, "naturalWidth", { value: 16 });
    fireEvent.load(image);
    expect(image).toHaveClass("opacity-100");
    expect(container.firstChild).toHaveClass("text-transparent");
  });

  it("skips the favicon service for a site it has no icon for", () => {
    const { container } = render(
      <SponsorLogo
        scholarship={{ ...scholarship, source_url: "https://nofavicon.test/" }}
      />,
    );
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "https://nofavicon.test/favicon.ico");
    fireEvent.error(image);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://www.google.com/s2/favicons?domain=apply.test&sz=128",
    );
  });

  it("tries the sponsor and application favicons after a custom logo fails", () => {
    const { container } = render(
      <SponsorLogo
        scholarship={{
          ...scholarship,
          logo_url: "https://sponsor.test/logo.png",
        }}
      />,
    );
    const expected = [
      "https://sponsor.test/logo.png",
      "https://www.google.com/s2/favicons?domain=sponsor.test&sz=128",
      "https://sponsor.test/favicon.ico",
      "https://www.google.com/s2/favicons?domain=apply.test&sz=128",
      "https://apply.test/favicon.ico",
    ];
    for (const src of expected) {
      const image = container.querySelector("img")!;
      expect(image).toHaveAttribute("src", src);
      fireEvent.error(image);
    }
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("SF");
  });

  it("stops once a fallback loads successfully", () => {
    const { container } = render(<SponsorLogo scholarship={scholarship} />);
    fireEvent.error(container.querySelector("img")!);
    const image = container.querySelector("img")!;
    fireEvent.load(image);
    expect(image).toHaveAttribute("src", "https://sponsor.test/favicon.ico");
    expect(image).toHaveClass("opacity-100");
  });

  it("does not retry identical sources when the URLs share an origin", () => {
    const { container } = render(
      <SponsorLogo
        scholarship={{ ...scholarship, apply_url: "https://sponsor.test/apply" }}
      />,
    );
    fireEvent.error(container.querySelector("img")!);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
  });

  it("restarts when the editor supplies a new logo after all sources fail", () => {
    const { container, rerender } = render(
      <SponsorLogo
        scholarship={{ ...scholarship, source_url: "", apply_url: "" }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    rerender(
      <SponsorLogo
        scholarship={{
          ...scholarship,
          logo_url: "https://sponsor.test/new.png",
        }}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://sponsor.test/new.png",
    );
    expect(container.querySelector("img")).toHaveClass("opacity-0");
  });
});
