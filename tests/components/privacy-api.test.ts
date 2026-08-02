import { afterEach, describe, expect, it, vi } from "vitest"

import { exportPrivacyData } from "@/lib/api/privacy"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("exportPrivacyData", () => {
  it("POSTs the subject in the body, never the URL", async () => {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() }
    vi.spyOn(document, "createElement").mockReturnValue(
      anchor as unknown as HTMLAnchorElement
    )
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n as never)
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:x",
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL)
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(new Blob(["{}"]), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    await exportPrivacyData("guest-4821")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/privacy/export")
    expect(url).not.toContain("guest-4821")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(init?.body as string)).toEqual({ subject: "guest-4821" })
  })
})
