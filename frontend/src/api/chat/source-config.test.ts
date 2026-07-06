import {
  BUILT_IN_SOURCE_CONFIG,
  FULL_SUBREDDIT_MENU,
  fromWireSourceConfig,
  toWireSourceConfig,
} from "@/api/chat/source-config"

describe("source config adapter", () => {
  it("maps frontend source config to backend wire config", () => {
    expect(
      toWireSourceConfig({
        webSearch: true,
        eduSources: false,
        reddit: true,
        selectedSubreddits: ["r/ApplyingToCollege", "r/premed"],
      }),
    ).toEqual({
      web: true,
      edu: false,
      reddit: true,
      reddit_subreddits: ["ApplyingToCollege", "premed"],
    })
  })

  it("collapses the full visible subreddit menu to null so backend keeps agent-internal search slots", () => {
    expect(
      toWireSourceConfig({
        ...BUILT_IN_SOURCE_CONFIG,
        selectedSubreddits: [...FULL_SUBREDDIT_MENU],
      }).reddit_subreddits,
    ).toBeNull()
  })

  it("reads null subreddit list as the full menu", () => {
    expect(
      fromWireSourceConfig({
        web: false,
        edu: true,
        reddit: false,
        reddit_subreddits: null,
      }),
    ).toEqual({
      webSearch: false,
      eduSources: true,
      reddit: false,
      selectedSubreddits: [...FULL_SUBREDDIT_MENU],
    })
  })

  it("does not expose the backend-internal school subreddit slot in UI state", () => {
    expect(
      fromWireSourceConfig({
        web: true,
        edu: true,
        reddit: true,
        reddit_subreddits: ["ApplyingToCollege", "{school}", "csMajors"],
      }).selectedSubreddits,
    ).toEqual(["r/ApplyingToCollege", "r/csMajors"])
  })

  it("drops unknown subreddit keys from wire data", () => {
    expect(
      fromWireSourceConfig({
        web: true,
        edu: true,
        reddit: true,
        reddit_subreddits: ["ApplyingToCollege", "unknown", "csMajors"],
      }).selectedSubreddits,
    ).toEqual(["r/ApplyingToCollege", "r/csMajors"])
  })

  it("falls back safely for malformed wire data", () => {
    expect(fromWireSourceConfig("bad payload")).toEqual(BUILT_IN_SOURCE_CONFIG)
    expect(
      fromWireSourceConfig({
        web: "yes",
        edu: 1,
        reddit: null,
        reddit_subreddits: "all",
      }),
    ).toEqual(BUILT_IN_SOURCE_CONFIG)
  })
})
