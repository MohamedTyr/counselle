import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FILTER_STATE,
  type FilterState,
  filterStateFromSearchParams,
  filterStateToSearchParams,
  loadSavedFilterState,
  saveFilterState,
} from "./sat-filters";

describe("filterStateToSearchParams / filterStateFromSearchParams", () => {
  it("round-trips a fully specified filter", () => {
    const filter: FilterState = {
      skills: ["CID", "INF"],
      bands: [6, 7],
      status: "incorrect",
      excludeBluebook: false,
    };
    const params = filterStateToSearchParams(filter);
    expect(params.get("skills")).toBe("CID,INF");
    expect(params.get("bands")).toBe("6,7");
    expect(params.get("status")).toBe("incorrect");
    expect(params.get("bluebook")).toBe("1");
    expect(filterStateFromSearchParams(params)).toEqual(filter);
  });

  it("a bare URL decodes to the F20 default: all skills, all bands, status all, Bluebook excluded", () => {
    expect(filterStateFromSearchParams(new URLSearchParams())).toEqual(DEFAULT_FILTER_STATE);
  });

  it("omits skills/bands/status when they mean 'all'", () => {
    const params = filterStateToSearchParams(DEFAULT_FILTER_STATE);
    expect(params.has("skills")).toBe(false);
    expect(params.has("bands")).toBe(false);
    expect(params.has("status")).toBe(false);
    expect(params.has("bluebook")).toBe(false);
  });

  it("bluebook=1 means INCLUDE, inverting into excludeBluebook: false", () => {
    const params = new URLSearchParams("bluebook=1");
    expect(filterStateFromSearchParams(params).excludeBluebook).toBe(false);
  });

  it("bluebook absent means excluded (upstream default, F6)", () => {
    expect(filterStateFromSearchParams(new URLSearchParams()).excludeBluebook).toBe(true);
  });

  it("drops an out-of-range band and an unrecognised status rather than trusting them", () => {
    const params = new URLSearchParams("bands=0,3,9&status=bogus");
    const decoded = filterStateFromSearchParams(params);
    expect(decoded.bands).toEqual([3]);
    expect(decoded.status).toBe("all");
  });

  it("trims and drops empty skill codes", () => {
    const params = new URLSearchParams("skills=CID, ,INF,");
    expect(filterStateFromSearchParams(params).skills).toEqual(["CID", "INF"]);
  });
});

describe("localStorage persistence (F10)", () => {
  const VALID_CODES = ["CID", "INF", "WIC"];

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips a saved selection", () => {
    const filter: FilterState = {
      skills: ["CID", "WIC"],
      bands: [1, 2, 3],
      status: "bookmarked",
      excludeBluebook: false,
    };
    saveFilterState(filter);
    expect(loadSavedFilterState(VALID_CODES)).toEqual(filter);
  });

  it("returns the default when nothing is saved", () => {
    expect(loadSavedFilterState(VALID_CODES)).toEqual(DEFAULT_FILTER_STATE);
  });

  it("returns the default on corrupt JSON", () => {
    localStorage.setItem("counselle:sat:filters", "{not json");
    expect(loadSavedFilterState(VALID_CODES)).toEqual(DEFAULT_FILTER_STATE);
  });

  it("drops a saved skill code no longer in the taxonomy (F20 fix)", () => {
    saveFilterState({
      skills: ["CID", "RETIRED"],
      bands: [],
      status: "all",
      excludeBluebook: true,
    });
    expect(loadSavedFilterState(VALID_CODES).skills).toEqual(["CID"]);
  });

  it("drops an out-of-range saved band", () => {
    saveFilterState({ skills: [], bands: [1, 8, -1], status: "all", excludeBluebook: true });
    expect(loadSavedFilterState(VALID_CODES).bands).toEqual([1]);
  });

  it("never throws when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => loadSavedFilterState(VALID_CODES)).not.toThrow();
    expect(loadSavedFilterState(VALID_CODES)).toEqual(DEFAULT_FILTER_STATE);
  });

  it("never throws when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveFilterState(DEFAULT_FILTER_STATE)).not.toThrow();
  });
});
