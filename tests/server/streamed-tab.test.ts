import { isValidElement, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }))
const prefetch = vi.hoisted(() => vi.fn(async () => ({ queries: [] })))
vi.mock("@/lib/server/prefetch", () => ({ prefetch }))
vi.mock("@/lib/queries/hydration-boundary", () => ({
  HydrationBoundary: ({ children }: { children: ReactNode }) => children,
}))

import { Prefetched } from "@/components/listings/streamed-tab"
import type { Session } from "@/lib/server/session"

const session = { organisationId: "org", role: "owner" } as Session
const entries = () => []

describe("StreamedTab", () => {
  it("streams the editor's read into a document load", async () => {
    requestHeaders.value = new Headers()
    prefetch.mockClear()
    const out = await Prefetched({ session, entries, children: "editor" })
    expect(prefetch).toHaveBeenCalledWith(session, entries)
    expect(isValidElement(out)).toBe(true)
  })

  it("reads nothing on a client navigation or router prefetch: the editor's hooks and cache answer", async () => {
    for (const init of [
      [["rsc", "1"]],
      [
        ["rsc", "1"],
        ["next-router-prefetch", "1"],
      ],
    ] as [string, string][][]) {
      requestHeaders.value = new Headers(init)
      prefetch.mockClear()
      await Prefetched({ session, entries, children: "editor" })
      expect(prefetch).not.toHaveBeenCalled()
    }
  })
})
