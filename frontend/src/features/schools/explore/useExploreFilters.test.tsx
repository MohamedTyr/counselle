import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";

import { useExploreFilters } from "@/features/schools/explore/useExploreFilters";

/*
 * The URL codec is the contract (plan §5.3): a link shared before this
 * rewrite must keep resolving, and a value that was retired -- a param
 * name or an enum member -- must fall back to its filter's default rather
 * than erroring or silently misreading a different filter. This earns its
 * place because it is a hard exit-test clause, not a routine render check.
 */

function wrapperFor(initialUrl: string) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
    );
  };
}

describe("useExploreFilters -- the URL codec", () => {
  it("resolves a shared pre-change URL: unchanged param names still parse", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor(
        "/app/schools?q=yale&state=CA,NY&size=lt2k&control=public&policy=required&gender=coed&calendar=semester&home=CA",
      ),
    });

    expect(result.current.filters.query).toBe("yale");
    expect(result.current.filters.states).toEqual(["CA", "NY"]);
    expect(result.current.filters.sizeBucket).toEqual(["lt2k"]);
    expect(result.current.filters.control).toBe("public");
    expect(result.current.filters.testPolicy).toBe("required");
    expect(result.current.filters.gender).toBe("coed");
    expect(result.current.filters.calendar).toBe("semester");
    expect(result.current.assumptions.homeState).toBe("CA");
  });

  it("ignores retired params (testfit, greek, data, noreea, outofstate, a bare sat=) rather than erroring", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor(
        "/app/schools?testfit=middle50&greek=little&data=recent&noreea=1&outofstate=50-&sat=1400",
      ),
    });

    // No crash, and every retired filter falls back to its default.
    expect(result.current.filters.scoreFit).toBe("any");
    expect(result.current.assumptions.satMath).toBeNull();
    expect(result.current.assumptions.satEbrw).toBeNull();
    expect(result.current.assumptions.act).toBeNull();
  });

  it("falls back a URL carrying the retired testfit= param to fit=any", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor("/app/schools?testfit=middle50"),
    });

    expect(result.current.filters.scoreFit).toBe("any");
  });

  it("falls back an unknown/retired enum value to its filter's default, never erroring", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor("/app/schools?policy=optional&fit=above75"),
    });

    // "optional" was the CDS-era testPolicy vocabulary; it is not one of
    // the four real members, so it falls back to "any" rather than being
    // coerced into a neighbour.
    expect(result.current.filters.testPolicy).toBe("any");
    // "above75" was the old testFit preset name; scoreFit's own vocabulary
    // uses "at_or_above_p75", so this also falls back to "any".
    expect(result.current.filters.scoreFit).toBe("any");
  });

  it("reads the new satm/satebrw/act params that replaced the single sat= input", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor("/app/schools?satm=700&satebrw=680&act=32"),
    });

    expect(result.current.assumptions.satMath).toBe(700);
    expect(result.current.assumptions.satEbrw).toBe(680);
    expect(result.current.assumptions.act).toBe(32);
  });

  it("keeps copied URL scores and home state as Explore assumptions only", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor("/app/schools?home=CA&satm=790&satebrw=780&act=35"),
    });

    expect(result.current.assumptions).toEqual({
      act: 35,
      homeState: "CA",
      satEbrw: 780,
      satMath: 790,
    });
    expect("fit" in result.current.assumptions).toBe(false);
  });

  it("preserves existing score-fit filtering alongside copied score assumptions", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor("/app/schools?satm=790&fit=at_or_above_p75"),
    });

    expect(result.current.assumptions.satMath).toBe(790);
    expect(result.current.filters.scoreFit).toBe("at_or_above_p75");
  });

  it("starts at page 1 and grows only via loadMore", () => {
    const { result } = renderHook(() => useExploreFilters(), {
      wrapper: wrapperFor("/app/schools"),
    });

    expect(result.current.page).toBe(1);

    act(() => result.current.loadMore());
    expect(result.current.page).toBe(2);

    // A filter change starts the result set over at one page.
    act(() =>
      result.current.setFilters((current) => ({ ...current, query: "yale" })),
    );
    expect(result.current.page).toBe(1);
  });
});
