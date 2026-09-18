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

  it("keeps the location workspace's retired segments inside the location", async () => {
    const table = await redirects()
    const to = (source: string) =>
      table.find((r) => r.source === source)?.destination
    expect(to("/locations/:id/administration")).toBe("/locations/:id/access")
    expect(to("/locations/:id/business-information")).toBe("/locations/:id")
    expect(to("/locations/:id/industry")).toBe("/locations/:id")
    expect(to("/locations/:id/hours")).toBe("/locations/:id#hours")
    expect(to("/locations/:id/booking")).toBe("/locations/:id#booking")
    expect(to("/locations/:id/suggestions")).toBe("/locations/:id#suggestions")
    expect(to("/locations/:id/performance")).toBe("/reports?locationId=:id")
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
