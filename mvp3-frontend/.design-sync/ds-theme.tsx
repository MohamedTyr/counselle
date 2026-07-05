import * as React from "react"

// Preview-only theme wrapper. The Counselle app defaults to the dark theme
// (`.dark` on <html>), so every design-system preview must render dark too.
// The design-sync harness hardcodes a light body; this provider (wired via
// cfg.provider) flips the document to dark and paints the body with the dark
// `--background` token so cards read exactly like the real product.
export function DsDark({ children }: { children?: React.ReactNode }) {
  React.useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.add("dark")
    root.style.colorScheme = "dark"
    document.body.style.background = "var(--background)"
    document.body.style.color = "var(--foreground)"
  }, [])
  return React.createElement(React.Fragment, null, children)
}
