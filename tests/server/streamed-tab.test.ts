import {
  isValidElement,
  Suspense,
  type ReactElement,
  type ReactNode,
} from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }))
const prefetch = vi.hoisted(() => vi.fn(async () => ({ queries: [] })))
vi.mock("@/lib/server/prefetch", () => ({ prefetch }))
vi.mock("@/lib/queries/hydration-boundary", () => ({
  HydrationBoundary: ({ children }: { children: ReactNode }) => children,
}))

import { Prefetched, StreamedTab } from "@/components/listings/streamed-tab"
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

describe("StreamedTab's pending state (L16, /profile and /people)", () => {
  // The read behind the boundary never settles here. What a document load
  // paints first is the boundary's fallback: the same pending state the
  // editor's own LocationTab draws (TabLoading, the shared skeleton rows
  // and the "Reading the … from Google…" line), not the editor.
  for (const loadingLabel of ["business profile", "people with access"]) {
    it(`draws the shared pending state for the ${loadingLabel} before the read settles`, () => {
      requestHeaders.value = new Headers()
      prefetch.mockClear()
      prefetch.mockImplementationOnce(() => new Promise(() => {}))
      const boundary = StreamedTab({
        session,
        entries,
        loadingLabel,
        children: "editor",
      }) as ReactElement<{ fallback: ReactNode; children: ReactNode }>
      expect(boundary.type).toBe(Suspense)
      const html = renderToStaticMarkup(boundary.props.fallback as ReactElement)
      expect(html).toContain(`Reading the ${loadingLabel} from Google…`)
      expect(html).toContain('aria-busy="true"')
      expect(html).toContain('data-slot="skeleton"')
      expect(html).not.toContain("editor")
      // Building the boundary starts no read; only rendering it does.
      expect(prefetch).not.toHaveBeenCalled()
    })
  }
})
