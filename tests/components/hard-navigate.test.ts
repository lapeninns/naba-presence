import { afterEach, describe, expect, it, vi } from "vitest"

import { hardNavigate, resolveSameOriginUrl } from "@/lib/client/hard-navigate"

const origin = "https://app.example.test"

describe("resolveSameOriginUrl", () => {
  it("resolves a root-relative path, query and hash to the same origin", () => {
    expect(resolveSameOriginUrl("/sign-in?next=%2Finbox#top", origin)).toBe(
      `${origin}/sign-in?next=%2Finbox#top`
    )
  })

  it.each([
    "https://evil.example/inbox",
    "javascript:alert(1)",
    "//evil.example/inbox",
    "/\\evil.example/inbox",
    "/\t/evil.example/inbox",
    "inbox",
    "",
  ])("refuses %j", (target) => {
    expect(() => resolveSameOriginUrl(target, origin)).toThrow(/hardNavigate/)
  })
})

describe("hardNavigate", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("assigns the absolute same-origin URL", () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    hardNavigate("/inbox")
    expect(assign).toHaveBeenCalledWith(`${window.location.origin}/inbox`)
  })

  it("does not navigate for an off-origin target", () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    expect(() => hardNavigate("//evil.example")).toThrow()
    expect(assign).not.toHaveBeenCalled()
  })
})
