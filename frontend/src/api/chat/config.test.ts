import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config"
import { resolveComposerConfig } from "@/api/chat/config"

describe("resolveComposerConfig", () => {
  it("uses server greeting and source defaults on success", () => {
    expect(
      resolveComposerConfig({
        status: "success",
        config: {
          greeting: "Ready to compare schools?",
          season_note: "Hidden on this page",
          conversation_starters: ["Compare Harvard and Yale"],
          default_source_config: {
            web: false,
            edu: true,
            reddit: false,
            reddit_subreddits: ["premed"],
          },
        },
      }),
    ).toEqual({
      greeting: "Ready to compare schools?",
      sourceConfig: {
        webSearch: false,
        eduSources: true,
        reddit: false,
        selectedSubreddits: ["r/premed"],
      },
    })
  })

  it("uses fallback copy and built-in defaults after config failure", () => {
    expect(resolveComposerConfig({ status: "error" })).toEqual({
      greeting: "Where should we begin?",
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
    })
  })

  it("uses fallback copy for an empty server greeting", () => {
    expect(
      resolveComposerConfig({
        status: "success",
        config: {
          greeting: "",
          season_note: null,
          conversation_starters: [],
          default_source_config: null,
        },
      }).greeting,
    ).toBe("Where should we begin?")
  })
})
