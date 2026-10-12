import { readFileSync } from "node:fs"

import { afterEach, describe, expect, it } from "vitest"

import {
  readinessResponseSchema,
  type ReadinessReason,
} from "@/lib/contracts/operations"
import { tickLiveness, type TickRow } from "@/lib/server/ops-liveness"
import { evaluateReadiness, type ReadinessInputs } from "@/lib/server/readiness"
import {
  recordTelemetryExport,
  resetTelemetryExportStatus,
  telemetryDisabledReason,
  telemetryStatus,
  withExportStatus,
} from "@/lib/server/telemetry-status"

const NOW = new Date("2026-10-10T12:00:00.000Z")
const SHA = "0123456789abcdef0123456789abcdef01234567"

const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000)

const TICK_NAMES = [
  "jobs",
  "reconcile",
  "retention",
  "performance",
  "keywords",
  "presence-resources",
  "sweep",
  "health",
  "billing-reconcile",
]

function row(name: string, overrides: Partial<TickRow> = {}): TickRow {
  return {
    name,
    beatAt: ago(10),
    registeredAt: ago(30 * 86_400),
    lastStartedAt: ago(11),
    lastSkippedAt: null,
    consecutiveSkips: 0,
    lastFailedAt: null,
    lastErrorCode: null,
    lastManualCompletedAt: null,
    lastCycleCompletedAt: name === "retention" ? ago(3_600) : null,
    ...overrides,
  }
}

function ticksWith(
  overrides: Record<string, Partial<TickRow>> = {},
  paused: Map<string, ["notifications"]> = new Map()
) {
  return tickLiveness(
    TICK_NAMES.map((name) => row(name, overrides[name])),
    NOW,
    paused
  )
}

function inputs(overrides: Partial<ReadinessInputs> = {}): ReadinessInputs {
  return {
    database: { reachable: true },
    release: { sha: SHA, source: "naba_release_sha" },
    schema: { compatible: true, requiredCount: 90, missing: [] },
    scheduler: { heartbeatAt: ago(30).toISOString(), stale: false },
    ticks: ticksWith(),
    pause: { scopes: [], readFailed: false },
    email: { provider: "resend", configured: true, opsRecipients: 2 },
    telemetry: {
      state: "exporting",
      reason: null,
      lastExportAt: ago(30).toISOString(),
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastErrorName: null,
    },
    incidents: { open: 0, undelivered: 0, quotaPressure: 0 },
    ...overrides,
  }
}

const codes = (reasons: ReadinessReason[]) =>
  reasons.map((entry) =>
    entry.subject ? `${entry.code}:${entry.subject}` : entry.code
  )

describe("evaluateReadiness", () => {
  it("is ready when everything is live, configured and quiet", () => {
    const result = evaluateReadiness(inputs(), NOW)
    expect(result.status).toBe("ready")
    expect(result.reasons).toEqual([])
    expect(result.ticks.map((tick) => tick.state)).toEqual(
      TICK_NAMES.map(() => "ok")
    )
  })

  it("is not ready when the health tick has stopped: its own absence cannot alert", () => {
    const result = evaluateReadiness(
      inputs({ ticks: ticksWith({ health: { beatAt: ago(86_400) } }) }),
      NOW
    )
    expect(result.status).toBe("not_ready")
    expect(codes(result.reasons)).toEqual(["tick_stale:health"])
    expect(result.ticks.find((tick) => tick.name === "health")?.state).toBe(
      "stale"
    )
  })

  it("gives a never-completed tick its grace, then fails it", () => {
    const fresh = evaluateReadiness(
      inputs({
        ticks: ticksWith({
          keywords: { beatAt: null, registeredAt: ago(3_600) },
        }),
      }),
      NOW
    )
    expect(fresh.status).toBe("degraded")
    expect(codes(fresh.reasons)).toEqual(["tick_awaiting_first_run:keywords"])

    const overdue = evaluateReadiness(
      inputs({
        ticks: ticksWith({
          health: { beatAt: null, registeredAt: ago(86_400) },
        }),
      }),
      NOW
    )
    expect(overdue.status).toBe("not_ready")
    expect(codes(overdue.reasons)).toEqual(["tick_never_completed:health"])

    // No registration to measure a grace from: never completed outright.
    const unregistered = evaluateReadiness(
      inputs({
        ticks: ticksWith({ jobs: { beatAt: null, registeredAt: null } }),
      }),
      NOW
    )
    expect(codes(unregistered.reasons)).toEqual(["tick_never_completed:jobs"])
  })

  it("reports a wedged lease even on a paused tick", () => {
    const result = evaluateReadiness(
      inputs({
        ticks: ticksWith(
          { health: { beatAt: ago(86_400), consecutiveSkips: 5 } },
          new Map([["health", ["notifications"]]])
        ),
        pause: { scopes: ["notifications"], readFailed: false },
      }),
      NOW
    )
    expect(result.status).toBe("not_ready")
    expect(codes(result.reasons)).toEqual([
      "tick_lock_wedged:health",
      "pause_active:notifications",
      "alerting_paused",
    ])
    expect(result.ticks.find((tick) => tick.name === "health")?.state).toBe(
      "paused"
    )
  })

  it("is degraded, not failed, while a pause holds a stale tick", () => {
    const result = evaluateReadiness(
      inputs({
        ticks: ticksWith(
          { health: { beatAt: ago(86_400) } },
          new Map([["health", ["notifications"]]])
        ),
        pause: { scopes: ["notifications"], readFailed: false },
      }),
      NOW
    )
    expect(result.status).toBe("degraded")
    expect(codes(result.reasons)).toEqual([
      "pause_active:notifications",
      "alerting_paused",
    ])
  })

  it("fails on a silent scheduler, an incompatible schema or no database", () => {
    expect(
      codes(
        evaluateReadiness(
          inputs({ scheduler: { heartbeatAt: null, stale: true } }),
          NOW
        ).reasons
      )
    ).toEqual(["scheduler_silent"])
    const schema = evaluateReadiness(
      inputs({
        schema: {
          compatible: false,
          requiredCount: 90,
          missing: ["0097_next", "0098_after"],
        },
      }),
      NOW
    )
    expect(schema.status).toBe("not_ready")
    expect(codes(schema.reasons)).toEqual([
      "schema_incompatible:0097_next",
      "schema_incompatible:0098_after",
    ])
    expect(
      codes(
        evaluateReadiness(
          inputs({
            schema: { compatible: null, requiredCount: 90, missing: [] },
          }),
          NOW
        ).reasons
      )
    ).toEqual(["schema_unknown"])

    const down = evaluateReadiness(
      inputs({
        database: { reachable: false },
        schema: { compatible: null, requiredCount: 90, missing: [] },
        scheduler: null,
        ticks: [],
        pause: { scopes: [], readFailed: true },
        incidents: null,
      }),
      NOW
    )
    expect(down.status).toBe("not_ready")
    // One cause, not a cascade of unknowns it explains.
    expect(codes(down.reasons)).toEqual(["database_unreachable"])
  })

  it("fails on an open incident no operator was told about", () => {
    const result = evaluateReadiness(
      inputs({ incidents: { open: 2, undelivered: 1, quotaPressure: 0 } }),
      NOW
    )
    expect(result.status).toBe("not_ready")
    expect(codes(result.reasons)).toEqual(["alert_undelivered"])
  })

  it("is degraded when alerting or telemetry is not configured", () => {
    const result = evaluateReadiness(
      inputs({
        release: { sha: "unknown", source: "unknown" },
        email: { provider: "none", configured: false, opsRecipients: 0 },
        telemetry: {
          state: "disabled",
          reason: "no_endpoint",
          lastExportAt: null,
          lastFailureAt: null,
          consecutiveFailures: 0,
          lastErrorName: null,
        },
        pause: { scopes: [], readFailed: true },
        incidents: { open: 1, undelivered: 0, quotaPressure: 1 },
      }),
      NOW
    )
    expect(result.status).toBe("degraded")
    expect(codes(result.reasons)).toEqual([
      "release_unknown",
      "pause_state_unknown",
      "email_not_configured",
      "ops_recipients_missing",
      "telemetry_disabled:no_endpoint",
      "google_quota_pressure",
    ])
  })

  it("is degraded on failing telemetry, an overdue cycle and an unreadable incident table", () => {
    const result = evaluateReadiness(
      inputs({
        ticks: ticksWith({
          retention: { lastCycleCompletedAt: ago(10 * 86_400) },
        }),
        telemetry: {
          state: "failing",
          reason: null,
          lastExportAt: null,
          lastFailureAt: ago(5).toISOString(),
          consecutiveFailures: 3,
          lastErrorName: "OTLPExporterError",
        },
        incidents: null,
      }),
      NOW
    )
    expect(result.status).toBe("degraded")
    expect(codes(result.reasons)).toEqual([
      "tick_cycle_overdue:retention",
      "telemetry_failing",
      "incidents_unknown",
    ])
  })

  it("produces a response the wire contract accepts", () => {
    const evaluation = evaluateReadiness(inputs(), NOW)
    const base = inputs()
    expect(() =>
      readinessResponseSchema.strict().parse({
        status: evaluation.status,
        ok: true,
        generatedAt: NOW.toISOString(),
        reasons: evaluation.reasons,
        release: base.release,
        schema: base.schema,
        database: base.database,
        scheduler: base.scheduler,
        ticks: evaluation.ticks,
        pause: { scopes: [], readFailed: false },
        email: base.email,
        telemetry: base.telemetry,
        incidents: base.incidents,
      })
    ).not.toThrow()
  })

  it("reads no tenant data: no tenant transaction, no organisation walk", () => {
    // Code only: the module's comments explain what it does not do.
    const source = readFileSync("lib/server/readiness.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    expect(source).not.toMatch(/withTenant|organisation_job_route/)
    expect(source).not.toMatch(/from\s+organisation\b/)
  })
})

describe("telemetry status", () => {
  afterEach(() => resetTelemetryExportStatus())

  it("is disabled without an OTLP endpoint, and says why", () => {
    expect(telemetryDisabledReason({})).toBe("no_endpoint")
    expect(telemetryStatus({})).toMatchObject({
      state: "disabled",
      reason: "no_endpoint",
    })
    expect(
      telemetryDisabledReason({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
        OTEL_SDK_DISABLED: "true",
      })
    ).toBe("sdk_disabled")
    expect(
      telemetryDisabledReason({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
        OTEL_METRICS_EXPORTER: "none",
      })
    ).toBe("exporter_none")
    expect(
      telemetryDisabledReason({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://otel.example.com/v1",
      })
    ).toBeNull()
  })

  it("moves from configured to exporting to failing on export results", () => {
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com" }
    expect(telemetryStatus(env).state).toBe("configured")
    recordTelemetryExport({ ok: true }, NOW)
    expect(telemetryStatus(env)).toMatchObject({
      state: "exporting",
      lastExportAt: NOW.toISOString(),
    })
    // One dropped batch is noise.
    recordTelemetryExport({ ok: false, error: new TypeError("fetch failed") })
    expect(telemetryStatus(env).state).toBe("exporting")
    recordTelemetryExport({ ok: false, error: new TypeError("fetch failed") })
    expect(telemetryStatus(env)).toMatchObject({
      state: "failing",
      consecutiveFailures: 2,
      // The class name only, never the message.
      lastErrorName: "TypeError",
    })
    recordTelemetryExport({ ok: true })
    expect(telemetryStatus(env).state).toBe("exporting")
  })

  it("records each export through the wrapper and passes the result on", () => {
    const results: number[] = []
    const exporter = withExportStatus({
      export(
        _metrics: unknown,
        callback: (result: { code: number; error?: Error }) => void
      ) {
        callback({ code: 1, error: new Error("refused") })
      },
    })
    exporter.export({}, (result) => results.push(result.code))
    exporter.export({}, (result) => results.push(result.code))
    expect(results).toEqual([1, 1])
    expect(
      telemetryStatus({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example" })
    ).toMatchObject({ state: "failing", lastErrorName: "Error" })
  })
})
