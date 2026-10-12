import type { TransactionSql } from "postgres"
import { describe, expect, it, vi } from "vitest"

import { serverEnvSchema, type ServerEnv } from "@/lib/server/env"
import type { LinkedLocation } from "@/lib/server/gbp-write"
import { claimableKinds } from "@/lib/server/jobs"
import type { RecoveryOperation } from "@/lib/server/mutation-operations"
import {
  attemptState,
  createRecoveryRegistry,
  IN_FLIGHT_GRACE_MS,
  MAX_MUTATION_RECOVERY_ATTEMPTS,
  planRecoveryFailure,
  recoverMutationOperation,
  RECOVERY_PARK_LIMIT_MS,
  RECOVERY_PARK_MS,
  settleMutationRecoveryFailure,
  type ConnectionState,
  type RecoveryAdapter,
  type RecoveryAttempt,
  type RecoveryDeps,
  type RecoveryVerdict,
} from "@/lib/server/mutation-recovery"
import { RECOVERY_ADAPTERS } from "@/lib/server/mutation-recovery-registry"
import { ApiError } from "@/lib/server/http"
import { NO_PAUSES, type PauseScope } from "@/lib/server/pause-controls"

const NOW = new Date("2026-10-10T12:00:00.000Z")
const ORG = "00000000-0000-4000-8000-00000000000a"
const OP = "00000000-0000-4000-8000-0000000000b1"
const ATTEMPT = "00000000-0000-4000-8000-0000000000c1"
const ACTOR = "00000000-0000-4000-8000-0000000000d1"
const LOCATION = "00000000-0000-4000-8000-0000000000e1"
const CONNECTION = "00000000-0000-4000-8000-0000000000f1"

const env: ServerEnv = serverEnvSchema.parse({
  DATABASE_URL: "postgresql://localhost/nabapresence",
  NEXTAUTH_SECRET: "n".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  CRON_SECRET: "c".repeat(16),
})

const link: LinkedLocation = {
  organisationId: ORG,
  locationId: LOCATION,
  locationName: "The Bell",
  timezone: "Europe/London",
  externalLocationId: "ext-1",
  googleConnectionId: CONNECTION,
  googleAccountName: "accounts/1",
  googleAccountId: null,
  googleLocationName: "locations/1",
  canPublish: false,
  accessToken: async () => "synthetic-token",
}

function harness(
  options: {
    operation?: Partial<RecoveryOperation>
    attempt?: Partial<RecoveryAttempt> | null
    verdict?: RecoveryVerdict | Error
    connection?: ConnectionState
    /** The connection as re-read after a failed readback. */
    connectionAfterFailure?: ConnectionState
    recheck?: Awaited<ReturnType<RecoveryDeps["recheck"]>>
    enabled?: boolean
    settleWrites?: boolean
  } = {}
) {
  const operation: RecoveryOperation = {
    id: OP,
    organisationId: ORG,
    surface: "hours",
    action: "publish",
    actorUserId: ACTOR,
    locationId: LOCATION,
    targetRef: "locations/1",
    googleConnectionId: CONNECTION,
    attemptTable: "hours_sync_attempt",
    attemptId: ATTEMPT,
    recoveryAttempts: 0,
    createdAt: new Date(NOW.getTime() - 60 * 60_000),
    ...options.operation,
  }
  const attempt: RecoveryAttempt | null =
    options.attempt === null
      ? null
      : {
          id: ATTEMPT,
          rawStatus: "ambiguous",
          startedAt: new Date(NOW.getTime() - 30 * 60_000),
          ...options.attempt,
        }
  const readback = vi.fn(async () => {
    const verdict = options.verdict ?? { kind: "landed", confirmed: true }
    if (verdict instanceof Error) throw verdict
    return verdict
  })
  const adapterSettle = vi.fn(async () => options.settleWrites ?? true)
  const adapterUnverifiable = vi.fn(async () => {})
  const adapter: RecoveryAdapter = {
    surface: "hours",
    attemptTable: "hours_sync_attempt",
    load: vi.fn(async () => attempt),
    readback,
    settle: adapterSettle,
    unverifiable: adapterUnverifiable,
  }
  const ledger = {
    load: vi.fn(async () => operation),
    settle: vi.fn(async () => 1),
    reschedule: vi.fn(async () => {}),
    abandon: vi.fn(async () => true),
  }
  let linkReads = 0
  const recheck = vi.fn(
    async () =>
      options.recheck ??
      ({
        ok: true,
        scope: { userId: ACTOR, role: "owner", canPublish: true },
        grant: { visible: true, canEdit: true, canPublish: true },
      } as const)
  )
  const deps: RecoveryDeps = {
    withTenant: async (_organisationId, callback) =>
      callback({} as TransactionSql),
    registry: createRecoveryRegistry([adapter as RecoveryAdapter<never>]),
    ledger: ledger as unknown as RecoveryDeps["ledger"],
    enabled: async () => options.enabled ?? true,
    recheck,
    loadLink: vi.fn(async () => {
      linkReads += 1
      const connection =
        linkReads > 1 && options.connectionAfterFailure
          ? options.connectionAfterFailure
          : (options.connection ?? "usable")
      return {
        link: connection === "disconnected" ? null : link,
        connection,
      }
    }),
    notify: vi.fn(async () => {}),
    audit: vi.fn(async () => {}),
    now: () => NOW,
    random: () => 0.5,
  }
  const run = () =>
    recoverMutationOperation(
      { organisationId: ORG, operationId: OP, requestId: "req-1" },
      deps
    )
  return {
    run,
    deps,
    ledger,
    readback,
    adapterSettle,
    adapterUnverifiable,
    recheck,
    operation,
  }
}

describe("mutation recovery runner", () => {
  it("settles a write that landed as confirmed_applied and sends nothing", async () => {
    const h = harness({ verdict: { kind: "landed", confirmed: true } })
    await expect(h.run()).resolves.toBe("confirmed_applied")
    expect(h.readback).toHaveBeenCalledTimes(1)
    expect(h.adapterSettle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        verdict: { kind: "landed", confirmed: true },
        attempt: expect.objectContaining({ rawStatus: "ambiguous" }),
      })
    )
    expect(h.ledger.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptId: ATTEMPT,
        state: "confirmed_applied",
        errorCode: null,
      })
    )
    expect(h.deps.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "mutation.recovered" })
    )
    expect(h.deps.notify).not.toHaveBeenCalled()
  })

  it("settles an identified-but-uncompared write as awaiting_confirmation", async () => {
    const h = harness({ verdict: { kind: "landed", confirmed: false } })
    await expect(h.run()).resolves.toBe("awaiting_confirmation")
  })

  it("settles a write that did not land as failed, so it may be sent again", async () => {
    const h = harness({
      verdict: { kind: "not_landed", errorCode: "google_readback_mismatch" },
    })
    await expect(h.run()).resolves.toBe("failed")
    expect(h.ledger.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: "failed",
        errorCode: "google_readback_mismatch",
      })
    )
    // The runner never re-sends: one readback and nothing else.
    expect(h.readback).toHaveBeenCalledTimes(1)
  })

  it("backs off an unreadable provider and spends one readback", async () => {
    const h = harness({ verdict: new Error("socket hang up") })
    await expect(h.run()).resolves.toBe("rescheduled")
    expect(h.ledger.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operationId: OP, countAttempt: true })
    )
    const [, input] = h.ledger.reschedule.mock.calls[0] as unknown as [
      unknown,
      { at: Date },
    ]
    expect(input.at.getTime()).toBeGreaterThan(NOW.getTime())
    expect(h.ledger.settle).not.toHaveBeenCalled()
  })

  it("parks a reconnect-blocked connection without counting or reading", async () => {
    const h = harness({ connection: "blocked" })
    await expect(h.run()).resolves.toBe("parked")
    expect(h.readback).not.toHaveBeenCalled()
    expect(h.ledger.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        countAttempt: false,
        errorCode: "reconnect_blocked",
        at: new Date(NOW.getTime() + RECOVERY_PARK_MS),
      })
    )
  })

  it("parks without counting when the read fails on a connection that broke", async () => {
    const h = harness({
      verdict: new Error("invalid_grant"),
      connectionAfterFailure: "blocked",
    })
    await expect(h.run()).resolves.toBe("parked")
    expect(h.ledger.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ countAttempt: false })
    )
  })

  it("treats a reconnect-required provider error as blocked", async () => {
    const h = harness({
      verdict: new ApiError(401, "google_reconnect_required", "Reconnect.", {
        reconnectRequired: true,
      }),
    })
    await expect(h.run()).resolves.toBe("parked")
  })

  it("stops at the ceiling, keeps the receipt uncertain and notifies", async () => {
    const h = harness({
      operation: { recoveryAttempts: MAX_MUTATION_RECOVERY_ATTEMPTS - 1 },
      verdict: new Error("still unreadable"),
    })
    await expect(h.run()).resolves.toBe("abandoned")
    expect(h.ledger.abandon).toHaveBeenCalledWith(expect.anything(), {
      operationId: OP,
      errorCode: "recovery_exhausted",
      countAttempt: true,
    })
    expect(h.ledger.settle).not.toHaveBeenCalled()
    expect(h.deps.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "recovery_exhausted",
        locationName: "The Bell",
      })
    )
  })

  it("rechecks the actor's authorisation before reading Google", async () => {
    const h = harness()
    await h.run()
    expect(h.recheck).toHaveBeenCalledWith(expect.anything(), {
      organisationId: ORG,
      actorUserId: ACTOR,
      locationId: LOCATION,
      action: "read",
      connectionId: CONNECTION,
    })
    expect(h.recheck.mock.invocationCallOrder[0]).toBeLessThan(
      h.readback.mock.invocationCallOrder[0]
    )
  })

  it("stops and notifies when the recheck refuses, without reading", async () => {
    const h = harness({ recheck: { ok: false, reason: "actor_not_member" } })
    await expect(h.run()).resolves.toBe("abandoned")
    expect(h.readback).not.toHaveBeenCalled()
    expect(h.ledger.abandon).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: "recovery_refused_actor_not_member",
      })
    )
    expect(h.deps.notify).toHaveBeenCalled()
  })

  it("does nothing at all while the scope is paused", async () => {
    const h = harness({ enabled: false })
    await expect(h.run()).resolves.toBe("skipped")
    expect(h.ledger.load).not.toHaveBeenCalled()
    expect(h.readback).not.toHaveBeenCalled()
  })

  it("adopts the verdict of an attempt something else already settled", async () => {
    const h = harness({ attempt: { rawStatus: "succeeded" } })
    await expect(h.run()).resolves.toBe("confirmed_applied")
    expect(h.readback).not.toHaveBeenCalled()
    expect(h.ledger.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "confirmed_applied" })
    )
  })

  it("carries a settled failure's own code and audits it like a readback", async () => {
    const h = harness({
      attempt: { rawStatus: "failed", errorCode: "google_readback_mismatch" },
    })
    await expect(h.run()).resolves.toBe("failed")
    expect(h.readback).not.toHaveBeenCalled()
    expect(h.ledger.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: "failed",
        errorCode: "google_readback_mismatch",
      })
    )
    expect(h.deps.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "mutation.recovered",
        metadata: expect.objectContaining({
          outcome: "failed",
          errorCode: "google_readback_mismatch",
          source: "attempt_settled",
        }),
      })
    )
  })

  it("falls back to a generic code when the attempt recorded none", async () => {
    const h = harness({ attempt: { rawStatus: "stale" } })
    await expect(h.run()).resolves.toBe("failed")
    expect(h.ledger.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "attempt_failed" })
    )
  })

  it("defers an attempt still inside the in-flight grace window", async () => {
    const startedAt = new Date(NOW.getTime() - 10_000)
    const h = harness({ attempt: { rawStatus: "publishing", startedAt } })
    await expect(h.run()).resolves.toBe("deferred")
    expect(h.readback).not.toHaveBeenCalled()
    expect(h.ledger.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        countAttempt: false,
        at: new Date(startedAt.getTime() + IN_FLIGHT_GRACE_MS),
      })
    )
  })

  it("hands an unverifiable write to a person at once", async () => {
    const h = harness({
      verdict: { kind: "unverifiable", errorCode: "media_create_unverifiable" },
    })
    await expect(h.run()).resolves.toBe("abandoned")
    expect(h.adapterSettle).not.toHaveBeenCalled()
    expect(h.deps.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: "media_create_unverifiable" })
    )
  })

  it("lets the adapter mark an unverifiable attempt before it stops", async () => {
    const h = harness({
      verdict: { kind: "unverifiable", errorCode: "media_needs_resolution" },
    })
    await expect(h.run()).resolves.toBe("abandoned")
    expect(h.adapterUnverifiable).toHaveBeenCalledWith(expect.anything(), {
      attempt: expect.objectContaining({ id: ATTEMPT, rawStatus: "ambiguous" }),
      errorCode: "media_needs_resolution",
    })
    expect(h.ledger.abandon).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "media_needs_resolution" })
    )
  })

  it("defers without counting when another request moved the attempt", async () => {
    const h = harness({ settleWrites: false })
    await expect(h.run()).resolves.toBe("deferred")
    expect(h.ledger.settle).not.toHaveBeenCalled()
    expect(h.ledger.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: "attempt_moved",
        countAttempt: false,
      })
    )
  })

  it("stops a receipt with no adapter, attempt or connection", async () => {
    for (const [options, reason] of [
      [{ operation: { surface: "unknown" } }, "recovery_unsupported"],
      [{ attempt: null }, "attempt_missing"],
      [{ connection: "disconnected" as const }, "connection_disconnected"],
    ] as const) {
      const h = harness(options)
      await expect(h.run()).resolves.toBe("abandoned")
      expect(h.readback).not.toHaveBeenCalled()
      expect(h.ledger.abandon).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ errorCode: reason })
      )
    }
  })

  it("reports a receipt already settled as stale", async () => {
    const h = harness()
    h.ledger.load.mockResolvedValueOnce(null as never)
    await expect(h.run()).resolves.toBe("stale")
  })

  it("spends a readback when recovery itself throws, and stops at the ceiling", async () => {
    const h = harness({
      operation: { recoveryAttempts: MAX_MUTATION_RECOVERY_ATTEMPTS - 1 },
    })
    await settleMutationRecoveryFailure(
      { organisationId: ORG, operationId: OP, requestId: "req-1" },
      new Error("database went away"),
      h.deps
    )
    expect(h.ledger.abandon).toHaveBeenCalledWith(expect.anything(), {
      operationId: OP,
      errorCode: "recovery_exhausted",
      countAttempt: true,
    })
    expect(h.deps.notify).toHaveBeenCalled()
  })
})

describe("recovery decisions", () => {
  const createdAt = new Date(NOW.getTime() - 60_000)

  it("abandons a reconnect-blocked receipt after the park limit", () => {
    expect(
      planRecoveryFailure({
        connection: "blocked",
        recoveryAttempts: 0,
        createdAt: new Date(NOW.getTime() - RECOVERY_PARK_LIMIT_MS),
        now: NOW,
      })
    ).toEqual({ kind: "abandon", errorCode: "reconnect_abandoned" })
  })

  it("never counts a park, and counts every unreadable read", () => {
    expect(
      planRecoveryFailure({
        connection: "blocked",
        recoveryAttempts: 7,
        createdAt,
        now: NOW,
      }).kind
    ).toBe("park")
    expect(
      planRecoveryFailure({
        connection: "usable",
        recoveryAttempts: 2,
        createdAt,
        now: NOW,
        random: () => 0.5,
      })
    ).toMatchObject({ kind: "reschedule", attempts: 3 })
    expect(
      planRecoveryFailure({
        connection: "usable",
        recoveryAttempts: 7,
        createdAt,
        now: NOW,
      })
    ).toEqual({ kind: "exhausted", attempts: 8 })
  })

  it("classifies attempt rows by their raw status", () => {
    const at = (rawStatus: string, startedAt: Date | null = createdAt) =>
      attemptState({ id: ATTEMPT, rawStatus, startedAt }, NOW)
    expect(at("succeeded")).toEqual({ kind: "settled", outcome: "succeeded" })
    expect(at("stale")).toEqual({ kind: "settled", outcome: "failed" })
    expect(at("ambiguous")).toEqual({ kind: "unknown" })
    expect(at("started", new Date(NOW.getTime() - IN_FLIGHT_GRACE_MS))).toEqual(
      { kind: "in_flight", recoverAt: null }
    )
    expect(at("validated", null)).toEqual({
      kind: "in_flight",
      recoverAt: null,
    })
  })
})

describe("recovery registry", () => {
  it("covers every surface that records operation receipts", () => {
    expect(
      RECOVERY_ADAPTERS.map(
        (adapter) => `${adapter.surface}:${adapter.attemptTable}`
      ).sort()
    ).toEqual(
      [
        "attributes:bulk_listing_write_attempt",
        "food_menus:food_menus_sync_attempt",
        "hours:hours_sync_attempt",
        "local_post:gbp_local_post_attempt",
        "media:gbp_media_mutation",
        "place_actions:bulk_listing_write_attempt",
        "profile:profile_sync_attempt",
      ].sort()
    )
  })
})

describe("mutation_recover claim gating", () => {
  const paused = (...scopes: PauseScope[]) => ({
    paused: new Set(scopes),
    readFailed: false,
  })

  it("is claimable when nothing is paused", () => {
    expect(claimableKinds(env, NO_PAUSES)).toContain("mutation_recover")
  })

  it("stops with PUBLISH_ENABLED, the publish pause and its own scope", () => {
    expect(
      claimableKinds({ ...env, PUBLISH_ENABLED: false }, NO_PAUSES)
    ).not.toContain("mutation_recover")
    expect(claimableKinds(env, paused("publish"))).not.toContain(
      "mutation_recover"
    )
    const own = claimableKinds(env, paused("mutation_recover"))
    expect(own).not.toContain("mutation_recover")
    expect(own).toContain("recover")
  })
})
