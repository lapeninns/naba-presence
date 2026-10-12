import { afterEach, describe, expect, it, vi } from "vitest"

import type { ServerEnv } from "@/lib/server/env"
import {
  assertProductionSafety,
  collectOperationalWarnings,
  collectSafetyViolations,
} from "@/lib/server/startup"

const database = vi.hoisted(() => ({
  appliedVersions: [] as string[],
  ledgerError: undefined as unknown,
}))

vi.mock("@/lib/server/db", () => ({
  getDatabase: () => (strings: TemplateStringsArray) => {
    const ledger = strings.join("").includes("schema_migration")
    if (ledger && database.ledgerError) {
      return Promise.reject(database.ledgerError)
    }
    return Promise.resolve(
      ledger
        ? database.appliedVersions.map((version) => ({ version }))
        : [{ rolSuper: false, rolBypassRls: false, rowSecurity: "on" }]
    )
  },
}))

vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({
    WEBHOOKS_ENABLED: false,
    LOCAL_BOOTSTRAP_ENABLED: false,
    PASSWORD_AUTH_ENABLED: false,
    DATABASE_URL: "postgresql://runtime@127.0.0.1:5432/naba",
    NEXTAUTH_URL: "https://reviews.example.com",
    EMAIL_PROVIDER: "none",
    OPS_ALERT_EMAILS: [],
  }),
}))

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

describe("assertProductionSafety schema compatibility", () => {
  const required = ["0001_initial", "0002_second"]

  afterEach(() => {
    database.appliedVersions = []
    database.ledgerError = undefined
    vi.restoreAllMocks()
  })

  it("passes when every required migration is applied", async () => {
    database.appliedVersions = [...required, "0003_ahead"]
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    await expect(
      assertProductionSafety({ enforce: true, requiredMigrations: required })
    ).resolves.toBeUndefined()
    expect(info.mock.calls.join(" ")).toContain("startup.schema_ok")
  })

  it("refuses to start when enforced and a migration is missing", async () => {
    database.appliedVersions = ["0001_initial"]
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      assertProductionSafety({ enforce: true, requiredMigrations: required })
    ).rejects.toThrow("0002_second")
  })

  it("only warns when not enforced", async () => {
    database.appliedVersions = ["0001_initial"]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      assertProductionSafety({ enforce: false, requiredMigrations: required })
    ).resolves.toBeUndefined()
    const logged = warn.mock.calls.join(" ")
    expect(logged).toContain("startup.schema_incompatible")
    expect(logged).toContain("startup.safety_violations_ignored")
  })

  it("reports an unreadable ledger as a violation instead of crashing", async () => {
    database.ledgerError = Object.assign(new Error("permission denied"), {
      code: "42501",
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      assertProductionSafety({ enforce: false, requiredMigrations: required })
    ).resolves.toBeUndefined()
    expect(warn.mock.calls.join(" ")).toContain("42501")
    await expect(
      assertProductionSafety({ enforce: true, requiredMigrations: required })
    ).rejects.toThrow("Could not read schema_migration (42501)")
  })
})

describe("collectOperationalWarnings", () => {
  const configured = {
    EMAIL_PROVIDER: "resend" as const,
    EMAIL_API_KEY: "re_test",
    EMAIL_FROM: "alerts@example.com",
    OPS_ALERT_EMAILS: ["ops@example.com"],
  }
  const telemetry = { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com" }

  it("is quiet when alert email and metric export are configured", () => {
    expect(collectOperationalWarnings(configured, telemetry)).toEqual([])
  })

  it("warns when no alert email can be sent or nobody would receive it", () => {
    const none = collectOperationalWarnings(
      { ...configured, EMAIL_PROVIDER: "none", OPS_ALERT_EMAILS: [] },
      telemetry
    )
    expect(none).toHaveLength(2)
    expect(none.join(" ")).toContain("EMAIL_PROVIDER is none")
    expect(none.join(" ")).toContain("OPS_ALERT_EMAILS is empty")
    expect(
      collectOperationalWarnings(
        { ...configured, EMAIL_API_KEY: undefined },
        telemetry
      ).join(" ")
    ).toContain("without EMAIL_API_KEY and EMAIL_FROM")
  })

  it("warns when metrics are not exported", () => {
    expect(collectOperationalWarnings(configured, {}).join(" ")).toContain(
      "Metric export is off (no_endpoint)"
    )
  })

  it("is logged at startup but never refuses to start", async () => {
    database.appliedVersions = ["0001_initial"]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    await expect(
      assertProductionSafety({
        enforce: true,
        requiredMigrations: ["0001_initial"],
      })
    ).resolves.toBeUndefined()
    expect(warn.mock.calls.join(" ")).toContain("startup.operational_warnings")
    database.appliedVersions = []
    vi.restoreAllMocks()
  })
})
