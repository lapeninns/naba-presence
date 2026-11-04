import { describe, expect, it } from "vitest"
import type { ReactElement } from "react"

import ShareLayout, { metadata } from "@/app/share/layout"

/**
 * /share/** is public and tokenised: the layout keeps every page under it
 * (not-found included) unindexed, without a referrer, and free of app
 * chrome. The response headers are pinned in next-config.test.ts.
 */
describe("R14 /share layout", () => {
  it("marks every shared page noindex, nofollow, nocache and no-referrer", () => {
    expect(metadata.referrer).toBe("no-referrer")
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    })
  })

  it("wraps the page in one canvas with no navigation into the app", () => {
    const child = "report"
    const tree = ShareLayout({ children: child }) as ReactElement<{
      className: string
      children: unknown
    }>
    expect(tree.type).toBe("div")
    expect(tree.props.children).toBe(child)
    expect(tree.props.className).toContain("min-h-svh")
    expect(tree.props.className).toContain("bg-canvas")
  })
})
