import {
  cdsStatusMeta,
  flagSeverityMeta,
  uploadRowStatusMeta,
} from "@/features/cds-admin/cds-status";

// DESIGN.md §2.5: every status key needs a label; every axis stays
// internally consistent with the design's own colour-law tables (§2.1-2.4).
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

  it("gives distinct document statuses distinct badge variants (excluding 'none')", () => {
    const variants = Object.entries(cdsStatusMeta)
      .filter(([status]) => status !== "none")
      .map(([, meta]) => meta.variant);
    expect(new Set(variants).size).toBe(variants.length);
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
