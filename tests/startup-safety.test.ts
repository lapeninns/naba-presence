import { describe, expect, it } from "vitest"

import type { ServerEnv } from "@/lib/server/env"
import { collectSafetyViolations } from "@/lib/server/startup"

const safeIdentity = {
  rolSuper: false,
  rolBypassRls: false,
  rowSecurity: "on",
}
const baseEnv = {
  WEBHOOKS_ENABLED: false,
  LOCAL_BOOTSTRAP_ENABLED: false,
  GOOGLE_PUBSUB_AUDIENCE: undefined,
  NEXTAUTH_URL: "https://reviews.example.com",
} as ServerEnv

describe("collectSafetyViolations", () => {
  it("accepts a safe configuration", () => {
    expect(collectSafetyViolations(baseEnv, safeIdentity)).toEqual([])
  })

  it("flags superuser and BYPASSRLS identities", () => {
    expect(
      collectSafetyViolations(baseEnv, {
        ...safeIdentity,
        rolSuper: true,
      })
    ).toHaveLength(1)
    expect(
      collectSafetyViolations(baseEnv, {
        ...safeIdentity,
        rolBypassRls: true,
      })
    ).toHaveLength(1)
  })

  it("requires the Pub/Sub OIDC audience when webhooks are on", () => {
    const violations = collectSafetyViolations(
      { ...baseEnv, WEBHOOKS_ENABLED: true },
      safeIdentity
    )
    expect(violations.join(" ")).toContain("GOOGLE_PUBSUB_AUDIENCE")
  })

  it("accepts webhooks with an audience configured", () => {
    expect(
      collectSafetyViolations(
        {
          ...baseEnv,
          WEBHOOKS_ENABLED: true,
          GOOGLE_PUBSUB_AUDIENCE:
            "https://reviews.example.com/api/webhooks/google/pubsub",
        },
        safeIdentity
      )
    ).toEqual([])
  })

  it("flags LOCAL_BOOTSTRAP_ENABLED off localhost", () => {
    expect(
      collectSafetyViolations(
        { ...baseEnv, LOCAL_BOOTSTRAP_ENABLED: true },
        safeIdentity
      )
    ).toHaveLength(1)
  })
})
