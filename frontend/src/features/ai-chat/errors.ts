import { isTransportError } from "@/api/http/errors";

export type TurnError =
  | { kind: "rate_limited"; message: string; retryAfter?: number }
  | {
      kind: "unauthorized" | "network" | "server" | "stream" | "invalid_edit";
      message: string;
    };

export type TranscriptError = {
  kind: "unauthorized" | "network" | "server";
  message: string;
};

export function turnErrorOf(error: unknown): TurnError {
  if (isTransportError(error)) {
    if (error.kind === "rate_limited") {
      const wait =
        error.retryAfter !== undefined
          ? `Try again in ${error.retryAfter} second${error.retryAfter === 1 ? "" : "s"}.`
          : "Try again in a moment.";
      return {
        kind: "rate_limited",
        message: wait,
        retryAfter: error.retryAfter,
      };
    }

    if (error.kind === "unauthorized") {
      return { kind: "unauthorized", message: "Please sign in to continue." };
    }

    if (error.kind === "network") {
      return {
        kind: "network",
        message: "Could not reach the server. Check your connection.",
      };
    }

    if (error.kind === "invalid_edit") {
      return {
        kind: "invalid_edit",
        message: "That message can no longer be edited.",
      };
    }

    return { kind: "server", message: error.message };
  }

  return { kind: "stream", message: "Something went wrong. Please try again." };
}

export function transcriptErrorOf(error: unknown): TranscriptError {
  if (isTransportError(error)) {
    if (error.kind === "unauthorized") {
      return {
        kind: "unauthorized",
        message: "Please sign in to view this conversation.",
      };
    }

    if (error.kind === "network") {
      return {
        kind: "network",
        message: "Couldn't load this conversation. Check your connection.",
      };
    }
  }

  return { kind: "server", message: "Couldn't load this conversation." };
}
