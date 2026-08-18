import {
  formatAcademicYear,
  formatAcademicYearShort,
  formatBytes,
  formatWhen,
} from "@/features/cds-admin/cds-format";

// Pure formatting helpers, shared by all three CDS admin screens — cheap to
// test, and drift here would silently desync every screen (DESIGN.md §1.1).
describe("cds-format", () => {
  it("formats an academic year with an en dash", () => {
    expect(formatAcademicYear(2025)).toBe("2024–25");
    expect(formatAcademicYear(2021)).toBe("2020–21");
  });

  it("formats the short grid-column academic year", () => {
    expect(formatAcademicYearShort(2025)).toBe("’24–25");
  });

  it("formats bytes as B/KB/MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatBytes(4_404_019)).toBe("4.2 MB");
  });

  it("formats recent timestamps relatively, older ones as a short date", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(formatWhen(new Date(now.getTime() - 30_000).toISOString())).toBe(
      "just now",
    );
    expect(formatWhen(new Date(now.getTime() - 2 * 60_000).toISOString())).toBe(
      "2 min ago",
    );
    expect(formatWhen(new Date(now.getTime() - 3 * 3_600_000).toISOString())).toBe(
      "3 hr ago",
    );
    expect(formatWhen(new Date(now.getTime() - 2 * 86_400_000).toISOString())).toBe(
      new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
        new Date(now.getTime() - 2 * 86_400_000),
      ),
    );

    vi.useRealTimers();
  });
});
