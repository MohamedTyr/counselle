import { errorFromResponse } from "@/api/http/errors";
import { jsonResponse } from "@/test/render-app";

/** caa19e8: every route wraps a raised business error as
 * `{"error": {"message", "trace_id"}}` (`api/deps.py::envelope_error_handler`).
 * `errorFromResponse` used to discard that message app-wide in favour of a
 * hardcoded per-status placeholder — so a 409 caused by an admin's own
 * invalid edit showed "A request is already in progress." instead of the
 * server's actual reason. */
describe("errorFromResponse — surfaces the envelope's real message", () => {
  it("uses the envelope's message when present, over the per-status default", async () => {
    const response = jsonResponse(
      {
        error: {
          message:
            "these edits fail 1 validation check(s) -- percent value '150%' is outside the valid 0-100 range",
          trace_id: "trace-1",
        },
      },
      { status: 409 },
    );

    const error = await errorFromResponse(response);

    expect(error.kind).toBe("conflict");
    expect(error.message).toBe(
      "these edits fail 1 validation check(s) -- percent value '150%' is outside the valid 0-100 range",
    );
  });

  it("falls back to the per-status default for fastapi-users' own {detail} shape", async () => {
    const response = jsonResponse(
      { detail: "LOGIN_BAD_CREDENTIALS" },
      { status: 401 },
    );

    const error = await errorFromResponse(response);

    expect(error.kind).toBe("unauthorized");
    expect(error.message).toBe("You are not signed in.");
  });

  it("falls back to the per-status default for an unparseable body", async () => {
    const response = new Response("not json", { status: 500 });

    const error = await errorFromResponse(response);

    expect(error.kind).toBe("server");
    expect(error.message).toBe("The server returned 500.");
  });

  it("falls back to the per-status default when error.message is blank or non-string", async () => {
    const response = jsonResponse(
      { error: { message: "   ", trace_id: "trace-2" } },
      { status: 422 },
    );

    const error = await errorFromResponse(response);

    expect(error.kind).toBe("invalid_edit");
    expect(error.message).toBe("That request is invalid.");
  });
});
