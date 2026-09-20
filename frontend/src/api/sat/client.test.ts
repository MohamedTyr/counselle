import { getCounts, getSession } from "@/api/sat/client";
import { jsonResponse } from "@/test/render-app";

/** Pins the repeated-key encoding `filterSearchParams` must use for
 * list-valued query params — the backend (`api/routes/sat.py`) declares
 * `bands`/`skills` as `Query(list[...])`, which FastAPI only parses from
 * repeated keys (`bands=2&bands=3`), never a single comma-joined value
 * (`bands=2,3`). That mismatch shipped invisibly: it broke typecheck,
 * build, and every other test, yet 422'd every band/skill-filtered
 * request. Do not conflate this with `features/sat/sat-filters.ts`, which
 * intentionally keeps the *browser URL* comma-joined for a short address
 * bar — that is a different wire format on purpose. */
describe("sat api client list-param encoding", () => {
  it("encodes bands as repeated keys on /sat/counts, never comma-joined", async () => {
    const fetchMock = vi.fn(() => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await getCounts({ bands: [2, 3, 4] });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/v1/sat/counts?bands=2&bands=3&bands=4");
    expect(url).not.toContain("2%2C3");
    expect(url).not.toContain(",");
  });

  it("encodes skills as repeated keys on /sat/session, never comma-joined", async () => {
    const fetchMock = vi.fn(() => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await getSession({ skills: ["CID", "INF"], bands: [6, 7] });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/v1/sat/session?skills=CID&skills=INF&bands=6&bands=7");
    expect(url).not.toContain(",");
  });

  it("drops skills on /sat/counts (counts is band/status/bluebook-only per plan §4.5)", async () => {
    const fetchMock = vi.fn(() => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await getCounts({ skills: ["CID"], bands: [1] });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/v1/sat/counts?bands=1");
  });
});
