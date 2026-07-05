// Global JSX type augmentations for non-standard HTML attributes used in
// vendored LibreChat components.

declare namespace React {
  interface HTMLAttributes<T> {
    // The HTML `inert` attribute (not yet in React's type defs for older React versions).
    // Used in Root.tsx and UnifiedSidebar.tsx for mobile drawer overlay semantics.
    inert?: '' | undefined;
  }
}
