export const protocolEventTypes = [
  "meta",
  "delta",
  "step",
  "thinking",
  "viz",
  "clarify",
  "sources",
  "usage",
  "done",
  "error",
] as const

export type ProtocolEventType = (typeof protocolEventTypes)[number]

export type ProtocolEvent = {
  v?: number
  type: ProtocolEventType
  data: Record<string, unknown>
}

export type Subreddit =
  | "r/ApplyingToCollege"
  | "r/chanceme"
  | "r/financialaid"
  | "r/premed"
  | "r/csMajors"

export type SourceConfig = {
  webSearch: boolean
  eduSources: boolean
  reddit: boolean
  selectedSubreddits: Subreddit[]
}

export type SourceConfigWire = {
  web: boolean
  edu: boolean
  reddit: boolean
  reddit_subreddits: string[] | null
}

export type ChatConfigWire = {
  greeting: string
  season_note: string | null
  conversation_starters: string[]
  default_source_config: SourceConfigWire | null
}

export type ComposerConfig = {
  greeting: string
  sourceConfig: SourceConfig
}

export type CreatedSession = {
  sessionId: string
  sourceConfig: SourceConfig
}

export type StreamResult = {
  accepted: boolean
}

export type StartTurnResult =
  | {
      ok: true
      sessionId: string
    }
  | {
      ok: false
    }

export type ChatTransport = {
  getChatConfig: () => Promise<ChatConfigWire>
  createSession: (input: {
    sourceConfig: SourceConfig
  }) => Promise<CreatedSession>
  streamFirstMessage: (input: {
    sessionId: string
    text: string
    sourceConfig: SourceConfig
    signal: AbortSignal
    onEvent?: (event: ProtocolEvent) => void
  }) => Promise<StreamResult>
  cancelActiveTurn: (sessionId: string) => Promise<void>
}
