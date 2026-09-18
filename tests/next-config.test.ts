import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function contentSecurityPolicy() {
  const { default: nextConfig } = await import("../next.config")
  const headers = await nextConfig.headers?.()
  const cspHeader = headers?.[0]?.headers.find(
    (header) => header.key === "Content-Security-Policy"
  )
  return cspHeader?.value ?? ""
}

describe("Next security headers", () => {
  it("allows the development bundle to hydrate under the CSP", async () => {
    vi.stubEnv("NODE_ENV", "development")

    await expect(contentSecurityPolicy()).resolves.toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    )
  })

  it("keeps eval out of the production CSP", async () => {
    vi.stubEnv("NODE_ENV", "production")

    await expect(contentSecurityPolicy()).resolves.not.toContain("'unsafe-eval'")
  })
})

describe("retired routes", () => {
  async function redirects() {
    const { default: nextConfig } = await import("../next.config")
    return (await nextConfig.redirects?.()) ?? []
  }

  it("sends the retired Home, Overview and Reviews to the Inbox", async () => {
    const table = await redirects()
    for (const source of ["/home", "/overview", "/reviews"]) {
      expect(table.find((r) => r.source === source)?.destination).toBe("/inbox")
    }
  })

  it("reaches Reports from /analytics in one hop", async () => {
    const table = await redirects()
    expect(table.find((r) => r.source === "/analytics")?.destination).toBe(
      "/reports"
    )
    expect(table.find((r) => r.source === "/performance")?.destination).toBe(
      "/reports"
    )
  })

  it("moves the location workspace to /listings, area by area", async () => {
    const table = await redirects()
    const to = (source: string) =>
      table.find((r) => r.source === source)?.destination
    expect(to("/locations")).toBe("/listings")
    expect(to("/locations/:id")).toBe("/listings/:id")
    expect(to("/locations/:id/:area")).toBe("/listings/:id/:area")
    expect(to("/locations/:id/administration")).toBe("/listings/:id/people")
    expect(to("/locations/:id/access")).toBe("/listings/:id/people")
    expect(to("/locations/:id/business-information")).toBe("/listings/:id/profile")
    expect(to("/locations/:id/industry")).toBe("/listings/:id/profile")
    expect(to("/locations/:id/performance")).toBe("/reports?locationId=:id")
    // Specific hops must be listed before the catch-all, or it wins.
    const index = (source: string) => table.findIndex((r) => r.source === source)
    expect(index("/locations/:id/access")).toBeLessThan(index("/locations/:id/:area"))
    expect(index("/locations/:id/performance")).toBeLessThan(index("/locations/:id/:area"))
  })

  it("marks every hop temporary, so a bookmark can be re-pointed again", async () => {
    const table = await redirects()
    expect(table.length).toBeGreaterThan(0)
    expect(table.every((r) => r.permanent === false)).toBe(true)
  })

  it("leaves the session-dependent flat routes to their server pages", async () => {
    const table = await redirects()
    for (const source of ["/profile", "/photos", "/posts", "/settings/listing"]) {
      expect(table.find((r) => r.source === source)).toBeUndefined()
    }
  })
})
