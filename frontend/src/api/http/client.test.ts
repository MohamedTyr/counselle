import { requestJson, requestVoid } from "@/api/http/client"
import { TransportError } from "@/api/http/errors"
import { emptyResponse, jsonResponse } from "@/test/render-app"

describe("shared http client", () => {
  it("requests JSON with same-origin credentials and the /v1 prefix", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestJson<{ ok: boolean }>("/workspace")).resolves.toEqual({
      ok: true,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/workspace",
      expect.objectContaining({ credentials: "same-origin" }),
    )
  })

  it("maps 401 responses to the shared unauthorized transport error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({}, { status: 401 })))

    await expect(requestJson("/applications")).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
    })
  })

  it("maps fetch failures to network transport errors", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))))

    await expect(requestJson("/applications")).rejects.toBeInstanceOf(
      TransportError,
    )
    await expect(requestJson("/applications")).rejects.toMatchObject({
      kind: "network",
    })
  })

  it("accepts empty successful responses for void requests", async () => {
    const fetchMock = vi.fn(() => emptyResponse())
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestVoid("/tasks/task-id", { method: "DELETE" }),
    ).resolves.toBeUndefined()
  })
})
