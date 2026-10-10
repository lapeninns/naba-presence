import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  matchCreatedMedia,
  MEDIA_CREATE_TIME_SKEW_MS,
  mediaItemMatchesIntent,
} from "@/lib/domain/media-reconcile"
import type { LinkedLocation } from "@/lib/server/gbp-write"
import type { RecoveryOperation } from "@/lib/server/mutation-operations"

const google = vi.hoisted(() => ({
  googleMediaItems: vi.fn(),
  getGoogleMediaItem: vi.fn(),
}))
vi.mock("@/lib/server/google", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...google,
}))

import { mediaRecoveryAdapter } from "@/lib/server/media"

/**
 * Media create reconciliation (plan P03-S5). The request path and the
 * checkpoints on the attempt row are exercised end to end in
 * tests/integration/routes/media-checkpoints.test.ts; this file pins the
 * matching rules and the recovery verdicts each checkpoint leads to.
 */

const STARTED = new Date("2026-10-10T12:00:00.000Z")
const intent = {
  mediaFormat: "PHOTO",
  category: "FOOD_AND_DRINK",
  description: "Momo platter",
}
const item = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  mediaFormat: "PHOTO",
  locationAssociation: { category: "FOOD_AND_DRINK" },
  description: "Momo platter",
  createTime: "2026-10-10T12:00:05.000Z",
  ...overrides,
})

describe("matchCreatedMedia", () => {
  it("adopts the one item that holds what the create asked for", () => {
    const match = matchCreatedMedia(
      [
        item("media/old", { createTime: "2026-10-01T00:00:00.000Z" }),
        item("media/other", { locationAssociation: { category: "INTERIOR" } }),
        item("media/new"),
      ],
      intent,
      { startedAt: STARTED }
    )
    expect(match).toEqual({ kind: "match", item: item("media/new") })
  })

  it("finds nothing when no item was created after the attempt started", () => {
    const tooEarly = new Date(
      STARTED.getTime() - MEDIA_CREATE_TIME_SKEW_MS - 1000
    ).toISOString()
    expect(
      matchCreatedMedia(
        [
          item("media/a", { createTime: tooEarly }),
          item("media/b", { createTime: undefined }),
        ],
        intent,
        { startedAt: STARTED }
      )
    ).toEqual({ kind: "none" })
  })

  it("refuses to choose between several candidates", () => {
    expect(
      matchCreatedMedia([item("media/a"), item("media/b")], intent, {
        startedAt: STARTED,
      })
    ).toEqual({ kind: "several", count: 2 })
  })

  it("skips items another create already claimed", () => {
    expect(
      matchCreatedMedia([item("media/a"), item("media/b")], intent, {
        startedAt: STARTED,
        claimedNames: new Set(["media/a"]),
      })
    ).toEqual({ kind: "match", item: item("media/b") })
  })

  it("adopts nothing while another open create could account for the item", () => {
    expect(
      matchCreatedMedia([item("media/a")], intent, {
        startedAt: STARTED,
        contested: true,
      })
    ).toEqual({ kind: "contested", count: 1 })
    expect(
      matchCreatedMedia([], intent, { startedAt: STARTED, contested: true })
    ).toEqual({ kind: "none" })
  })

  it("compares description loosely but format, category and source URL exactly", () => {
    expect(
      mediaItemMatchesIntent(
        item("m", { description: " Momo platter " }),
        intent
      )
    ).toBe(true)
    expect(
      mediaItemMatchesIntent(item("m", { description: undefined }), {
        ...intent,
        description: undefined,
      })
    ).toBe(true)
    expect(
      mediaItemMatchesIntent(item("m", { mediaFormat: "VIDEO" }), intent)
    ).toBe(false)
    expect(
      mediaItemMatchesIntent(
        item("m", { sourceUrl: "https://a.example/1.jpg" }),
        {
          ...intent,
          sourceUrl: "https://a.example/2.jpg",
        }
      )
    ).toBe(false)
  })
})

describe("media create recovery by checkpoint", () => {
  const link: LinkedLocation = {
    organisationId: "o1",
    locationId: "l1",
    locationName: "The Bell",
    timezone: "Europe/London",
    externalLocationId: "ext-1",
    googleConnectionId: "c1",
    googleAccountName: "accounts/1",
    googleAccountId: null,
    googleLocationName: "locations/1",
    canPublish: false,
    accessToken: async () => "synthetic-token",
  }
  const operation = {} as RecoveryOperation
  const attempt = (
    uploadPhase:
      "none" | "data_ref_obtained" | "bytes_uploaded" | "create_sent",
    claimedNames: string[] = [],
    overrides: { contentSha256?: string | null; contested?: boolean } = {}
  ) => ({
    id: "a1",
    rawStatus: "ambiguous",
    startedAt: STARTED,
    operation: "create" as const,
    requestedPayload: { ...intent, fileName: "dish.jpg" },
    googleMediaName: null,
    uploadPhase,
    contentSha256: "c".repeat(64),
    claimedNames,
    contested: false,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(["data_ref_obtained", "bytes_uploaded"] as const)(
    "settles a create that stopped at %s as not landed, without reading Google",
    async (phase) => {
      await expect(
        mediaRecoveryAdapter.readback({
          attempt: attempt(phase),
          link,
          operation,
        })
      ).resolves.toEqual({
        kind: "not_landed",
        errorCode: "media_upload_interrupted",
      })
      expect(google.googleMediaItems).not.toHaveBeenCalled()
    }
  )

  it("settles a create from 0074 on that never left phase none as not landed", async () => {
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: attempt("none"),
        link,
        operation,
      })
    ).resolves.toEqual({
      kind: "not_landed",
      errorCode: "media_upload_interrupted",
    })
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: attempt("none", [], { contentSha256: null }),
        link,
        operation,
      })
    ).resolves.toEqual({
      kind: "unverifiable",
      errorCode: "media_create_unverifiable",
    })
    expect(google.googleMediaItems).not.toHaveBeenCalled()
  })

  it("hands a sent create to a person while another open create could own its match", async () => {
    google.googleMediaItems.mockResolvedValue([item("media/a")])
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: attempt("create_sent", [], { contested: true }),
        link,
        operation,
      })
    ).resolves.toEqual({
      kind: "unverifiable",
      errorCode: "media_needs_resolution",
    })
  })

  it("adopts the single live match of a create that was sent", async () => {
    google.googleMediaItems.mockResolvedValue([
      item("media/a"),
      item("media/b"),
    ])
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: attempt("create_sent", ["media/a"]),
        link,
        operation,
      })
    ).resolves.toEqual({
      kind: "landed",
      confirmed: true,
      response: item("media/b"),
    })
    expect(google.googleMediaItems).toHaveBeenCalledWith(
      "synthetic-token",
      {
        accountName: "accounts/1",
        locationName: "locations/1",
        customer: false,
      },
      { connectionKey: "c1" }
    )
  })

  it("hands a sent create with no single match to a person", async () => {
    google.googleMediaItems.mockResolvedValue([])
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: attempt("create_sent"),
        link,
        operation,
      })
    ).resolves.toEqual({
      kind: "unverifiable",
      errorCode: "media_needs_resolution",
    })
  })

  it("lets a list failure reach the runner's back-off", async () => {
    const failure = new Error("list failed")
    google.googleMediaItems.mockRejectedValue(failure)
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: attempt("create_sent"),
        link,
        operation,
      })
    ).rejects.toBe(failure)
  })

  it("marks only a sent create as needs_resolution when recovery stops", async () => {
    const calls: unknown[][] = []
    const sql = ((...args: unknown[]) => {
      calls.push(args)
      return Promise.resolve([])
    }) as unknown as Parameters<
      NonNullable<typeof mediaRecoveryAdapter.unverifiable>
    >[0]
    await mediaRecoveryAdapter.unverifiable!(sql, {
      attempt: attempt("create_sent"),
      errorCode: "media_create_unverifiable",
    })
    expect(calls).toHaveLength(0)
    await mediaRecoveryAdapter.unverifiable!(sql, {
      attempt: attempt("create_sent"),
      errorCode: "media_needs_resolution",
    })
    expect(calls).toHaveLength(1)
    const text = (calls[0][0] as readonly string[]).join("?")
    expect(text).toContain("set status = 'needs_resolution'")
    expect(text).toContain("status in ('ambiguous', 'started')")
  })
})
