import { describe, expect, test } from "vitest";

import { crossFieldValidator } from "@/features/profile/profile-validators";

describe("crossFieldValidator", () => {
  test("rejects an SAT total that is not the sum of its sections", () => {
    const validate = crossFieldValidator(["testing", "sat", "total"], {
      sat: { ebrw: 700, math: 700 },
    });

    expect(validate?.(1500)).toBe(
      "Total should be reading & writing plus math (1400).",
    );
    expect(validate?.(1400)).toBeNull();
  });

  test("checks a section score against the committed total", () => {
    const validate = crossFieldValidator(["testing", "sat", "math"], {
      sat: { total: 1480, ebrw: 720 },
    });

    expect(validate?.(700)).not.toBeNull();
    expect(validate?.(760)).toBeNull();
  });

  test("rejects an unweighted GPA above the scale, and a zero scale", () => {
    const gpa = crossFieldValidator(["academics", "gpa_unweighted"], {
      gpa_scale: "4.0",
    });
    const scale = crossFieldValidator(["academics", "gpa_scale"], {});

    expect(gpa?.("4.3")).toBe("Unweighted GPA can’t be higher than the scale.");
    expect(gpa?.("3.9")).toBeNull();
    expect(scale?.("0")).toBe("Enter a scale above 0.");
  });

  test("has no validator for a field without a cross-field rule", () => {
    expect(
      crossFieldValidator(["basics", "preferred_name"], {}),
    ).toBeUndefined();
  });
});
