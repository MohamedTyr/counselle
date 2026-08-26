import {
  cdsStatusMeta,
  flagSeverityMeta,
  uploadRowStatusMeta,
} from "@/features/cds-admin/cds-status";

// DESIGN.md §2.5: every status key needs a label; every axis stays
// internally consistent with the design's own colour-law tables (§2.1-2.4).
//
// The real invariant is DESIGN.md's colour law (§0, law 1 + law 2): colour
// marks an *urgency family* (green/amber/blue/red/neutral), never a status
// identity, and "colour is never the only signal" — every chip also carries
// a distinct icon and label. A unique-variant-per-status rule was never the
// actual law: §2.3's own upload-row-status table gives `uploading`,
// `detecting`, and `replaces_existing` the same `info` variant, so it only
// ever held for the document-status axis by coincidence (five statuses,
// five families, before `correction_pending` existed). `needs_review` and
// `correction_pending` deliberately share the `warning` family — both mean
// "a human must act" — and stay distinguishable by icon (`Flag` vs.
// `ArrowRightLeft`) and label, per law 2. So the test asserts distinct
// (variant, Icon) pairs, not bare variant uniqueness.
describe("cds-status vocabulary", () => {
  it("gives every document status a label; every status but 'none' a variant and icon", () => {
    for (const [status, meta] of Object.entries(cdsStatusMeta)) {
      expect(meta.label.length).toBeGreaterThan(0);
      if (status === "none") {
        expect(meta.variant).toBeNull();
        expect(meta.Icon).toBeNull();
      } else {
        expect(meta.variant).not.toBeNull();
        expect(meta.Icon).not.toBeNull();
      }
    }
  });

  it("gives every non-'none' document status a visually distinct (variant, icon) pair", () => {
    const entries = Object.entries(cdsStatusMeta).filter(
      ([status]) => status !== "none",
    );
    for (const [statusA, metaA] of entries) {
      for (const [statusB, metaB] of entries) {
        if (statusA >= statusB) continue;
        const sameVariant = metaA.variant === metaB.variant;
        const sameIcon = metaA.Icon === metaB.Icon;
        expect(sameVariant && sameIcon).toBe(false);
      }
    }
  });

  it("gives every upload row status a label, variant, and icon", () => {
    for (const meta of Object.values(uploadRowStatusMeta)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.variant).toBeTruthy();
      expect(meta.Icon).toBeTruthy();
    }
  });

  it("gives every flag severity a label, variant, and icon, each variant distinct", () => {
    const variants = Object.values(flagSeverityMeta).map((meta) => meta.variant);
    for (const meta of Object.values(flagSeverityMeta)) {
      expect(meta.label.length).toBeGreaterThan(0);
    }
    expect(new Set(variants).size).toBe(variants.length);
  });
});
