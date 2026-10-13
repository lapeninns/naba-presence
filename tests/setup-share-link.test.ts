import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SHAREABLE_SETUP_PARAMS,
  setupShareUrl,
  shareLink,
} from "@/lib/setup/share-link"
import { GOOGLE_RETURN_PARAMS } from "@/lib/setup/oauth-status"

describe("setupShareUrl", () => {
  it("keeps only the params a colleague needs to reach the same review", () => {
    const url = setupShareUrl(
      "https://app.example.test/setup?client=c1&step=locations&onboardingAccount=a1&onboardingDraft=d1&onboardingReview=r1&onboardingMatchLinkReview=m1&google=connected&status=ok&rid=req-123&reason=denied&code=secret&state=xyz#token"
    )
    expect(url).toBe(
      "https://app.example.test/setup?client=c1&step=locations&onboardingAccount=a1&onboardingDraft=d1&onboardingReview=r1&onboardingMatchLinkReview=m1"
    )
  })

  it("never shares Google's OAuth return params", () => {
    for (const key of GOOGLE_RETURN_PARAMS) {
      expect(SHAREABLE_SETUP_PARAMS).not.toContain(key)
      const url = new URL(
        setupShareUrl(`https://app.example.test/setup?client=c1&${key}=leak`)
      )
      expect(url.searchParams.has(key)).toBe(false)
    }
  })

  it("always points at this origin's /setup, whatever the current path", () => {
    expect(
      setupShareUrl("https://app.example.test/some/other/path?client=c1")
    ).toBe("https://app.example.test/setup?client=c1")
    expect(setupShareUrl("https://app.example.test/setup")).toBe(
      "https://app.example.test/setup"
    )
  })

  it("drops empty values and drops credentials in the URL", () => {
    expect(
      setupShareUrl("https://user:pw@app.example.test/setup?client=&step=team")
    ).toBe("https://app.example.test/setup?step=team")
  })
})

describe("shareLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const data = { url: "https://app.example.test/setup?client=c1", title: "T" }

  it("uses the share sheet when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { share, canShare: () => true })
    await expect(shareLink(data)).resolves.toBe("shared")
    expect(share).toHaveBeenCalledWith({ url: data.url, title: "T" })
  })

  it("reports a closed share sheet as cancelled, not copied", async () => {
    const writeText = vi.fn()
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new DOMException("x", "AbortError")),
      clipboard: { writeText },
    })
    await expect(shareLink(data)).resolves.toBe("cancelled")
    expect(writeText).not.toHaveBeenCalled()
  })

  it("falls back to the clipboard when sharing is refused or missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new DOMException("x", "NotAllowedError")),
      clipboard: { writeText },
    })
    await expect(shareLink(data)).resolves.toBe("copied")
    expect(writeText).toHaveBeenCalledWith(data.url)

    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await expect(shareLink(data)).resolves.toBe("copied")
  })

  it("skips a share sheet that cannot take this data", async () => {
    const share = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      share,
      canShare: () => false,
      clipboard: { writeText },
    })
    await expect(shareLink(data)).resolves.toBe("copied")
    expect(share).not.toHaveBeenCalled()
  })

  it("fails when neither sharing nor copying works", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    })
    await expect(shareLink(data)).resolves.toBe("failed")
    vi.stubGlobal("navigator", {})
    await expect(shareLink(data)).resolves.toBe("failed")
  })
})
