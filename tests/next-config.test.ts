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
