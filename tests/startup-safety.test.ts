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
  PASSWORD_AUTH_ENABLED: false,
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

  describe("advisory lock connection", () => {
    const transaction =
      "postgresql://naba_runtime.ref:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres"
    const session =
      "postgresql://naba_runtime.ref:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres"

    it("refuses a transaction pooler with no session URL for the locks", () => {
      const violations = collectSafetyViolations(
        { ...baseEnv, DATABASE_URL: transaction },
        safeIdentity
      )
      expect(violations.join(" ")).toContain("DATABASE_SESSION_URL")
    })

    it("refuses a session URL that is itself a transaction pooler", () => {
      const violations = collectSafetyViolations(
        {
          ...baseEnv,
          DATABASE_URL: transaction,
          DATABASE_SESSION_URL: transaction,
        },
        safeIdentity
      )
      expect(violations).toHaveLength(1)
      expect(violations[0]).toContain("DATABASE_SESSION_URL points at")
    })

    it("accepts a transaction pooler paired with the session pooler", () => {
      expect(
        collectSafetyViolations(
          {
            ...baseEnv,
            DATABASE_URL: transaction,
            DATABASE_SESSION_URL: session,
          },
          safeIdentity
        )
      ).toEqual([])
    })

    it("accepts a session-mode DATABASE_URL on its own", () => {
      expect(
        collectSafetyViolations(
          { ...baseEnv, DATABASE_URL: session },
          safeIdentity
        )
      ).toEqual([])
    })
  })

  it("requires the Pub/Sub OIDC audience when webhooks are on", () => {
    const violations = collectSafetyViolations(
      { ...baseEnv, WEBHOOKS_ENABLED: true },
      safeIdentity
    )
    expect(violations.join(" ")).toContain("GOOGLE_PUBSUB_AUDIENCE")
  })

  it("accepts webhooks with an audience and a pinned service account", () => {
    expect(
      collectSafetyViolations(
        {
          ...baseEnv,
          WEBHOOKS_ENABLED: true,
          GOOGLE_PUBSUB_AUDIENCE:
            "https://reviews.example.com/api/webhooks/google/pubsub",
          GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL:
            "pubsub-push@naba.iam.gserviceaccount.com",
        },
        safeIdentity
      )
    ).toEqual([])
  })

  it("rejects an audience without the service-account pin", () => {
    const violations = collectSafetyViolations(
      {
        ...baseEnv,
        WEBHOOKS_ENABLED: true,
        GOOGLE_PUBSUB_AUDIENCE:
          "https://reviews.example.com/api/webhooks/google/pubsub",
      },
      safeIdentity
    )
    expect(violations.join(" ")).toContain(
      "GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL"
    )
  })

  it("accepts webhooks with a strong verification token", () => {
    expect(
      collectSafetyViolations(
        {
          ...baseEnv,
          WEBHOOKS_ENABLED: true,
          GOOGLE_PUBSUB_VERIFICATION_TOKEN:
            "harness-pubsub-token-32-characters!!",
        },
        safeIdentity
      )
    ).toEqual([])
  })

  it("rejects a short verification token without an audience", () => {
    const violations = collectSafetyViolations(
      {
        ...baseEnv,
        WEBHOOKS_ENABLED: true,
        GOOGLE_PUBSUB_VERIFICATION_TOKEN: "sixteen-char-key",
      },
      safeIdentity
    )
    expect(violations.join(" ")).toContain("GOOGLE_PUBSUB_AUDIENCE")
  })

  it("flags LOCAL_BOOTSTRAP_ENABLED off localhost", () => {
    expect(
      collectSafetyViolations(
        { ...baseEnv, LOCAL_BOOTSTRAP_ENABLED: true },
        safeIdentity
      )
    ).toHaveLength(1)
  })

  it("requires the password auth provider when password auth is enabled", () => {
    expect(
      collectSafetyViolations(
        { ...baseEnv, PASSWORD_AUTH_ENABLED: true },
        safeIdentity
      ).join(" ")
    ).toContain("SUPABASE_URL")
  })

  it("accepts a secure password auth provider", () => {
    expect(
      collectSafetyViolations(
        {
          ...baseEnv,
          PASSWORD_AUTH_ENABLED: true,
          SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        },
        safeIdentity
      )
    ).toEqual([])
  })
})
