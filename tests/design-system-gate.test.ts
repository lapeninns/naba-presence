import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * /design-system is internal evidence, not a product surface: a production
 * build 404s it unless DESIGN_SYSTEM_EVIDENCE_ENABLED is switched on
 * explicitly (the e2e harness does).
 */

const baseEnv = {
  DATABASE_URL: "postgresql://localhost/nabapresence",
  NEXTAUTH_SECRET: "n".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  CRON_SECRET: "c".repeat(16),
}

async function flagUnder(nodeEnv: string, value?: string) {
  vi.resetModules()
  vi.stubEnv("NODE_ENV", nodeEnv)
  const { serverEnvSchema } = await import("@/lib/server/env")
  return serverEnvSchema.parse({
    ...baseEnv,
    ...(value === undefined ? {} : { DESIGN_SYSTEM_EVIDENCE_ENABLED: value }),
  }).DESIGN_SYSTEM_EVIDENCE_ENABLED
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock("@/lib/server/env")
  vi.resetModules()
})

describe("DESIGN_SYSTEM_EVIDENCE_ENABLED", () => {
  it("is off in production unless set", async () => {
    expect(await flagUnder("production")).toBe(false)
    expect(await flagUnder("production", "")).toBe(false)
    expect(await flagUnder("production", "true")).toBe(true)
  })

  it("is on in development", async () => {
    expect(await flagUnder("development")).toBe(true)
  })
})

describe("/design-system page", () => {
  it("404s when the flag is off", async () => {
    vi.resetModules()
    vi.doMock("@/lib/server/env", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/server/env")>()),
      getServerEnv: () => ({ DESIGN_SYSTEM_EVIDENCE_ENABLED: false }),
    }))
    const { default: Page, dynamic } = await import("@/app/design-system/page")
    expect(dynamic).toBe("force-dynamic")
    expect(() => Page()).toThrow(
      expect.objectContaining({
        digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404"),
      })
    )
  })
})
