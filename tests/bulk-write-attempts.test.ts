import { beforeEach, describe, expect, it, vi } from "vitest"

const google = vi.hoisted(() => ({
  getGoogleLocation: vi.fn(),
  getGoogleLocationAttributes: vi.fn(),
  googleLodgingApi: vi.fn(),
  listGooglePlaceActionLinks: vi.fn(),
}))
const runGbpWrite = vi.hoisted(() => vi.fn())

vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
  jsonColumn: vi.fn(),
}))
vi.mock("@/lib/server/google", () => google)
vi.mock("@/lib/server/gbp-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/gbp-write")>()),
  runGbpWrite,
}))

const {
  BUSINESS_LOCATION_FIELDS,
  bulkBusinessInfoRecoveryAdapter,
  bulkLodgingRecoveryAdapter,
  locationWriteApplied,
  runBulkWrite,
} = await import("@/lib/server/bulk-families/write-attempts")

/**
 * The bulk families without editor receipts (lib/server/bulk-families/
 * write-attempts.ts): what counts as a business-information or category
 * write having landed, how an uncertain write is read back, and the
 * per-child, per-payload idempotency key that lets a later claim find it.
 */

const location = {
  websiteUri: "https://old-crown.example/",
  profile: { description: "A village pub." },
  labels: ["pub", "garden"],
  openInfo: { status: "OPEN" },
  categories: {
    primaryCategory: { name: "categories/gcid:pub" },
    additionalCategories: [
      { name: "categories/gcid:restaurant" },
      { name: "categories/gcid:bar" },
    ],
  },
}

describe("locationWriteApplied", () => {
  it("compares categories by stable ID, in any order", () => {
    expect(
      locationWriteApplied(
        "categories",
        {
          categories: {
            primary: "categories/gcid:pub",
            additional: ["categories/gcid:bar", "categories/gcid:restaurant"],
          },
        },
        location
      )
    ).toBe(true)
    expect(
      locationWriteApplied(
        "categories",
        {
          categories: {
            primary: "categories/gcid:restaurant",
            additional: ["categories/gcid:bar", "categories/gcid:pub"],
          },
        },
        location
      )
    ).toBe(false)
  })

  it("needs every named business-information change, and a clear to be empty", () => {
    const website = {
      field: "websiteUri",
      action: "set",
      value: "https://old-crown.example/",
    } as const
    const description = {
      field: "profile.description",
      action: "set",
      value: "A village pub.",
    } as const
    expect(
      locationWriteApplied(
        "business_info",
        { changes: [website, description] },
        location
      )
    ).toBe(true)
    expect(
      locationWriteApplied(
        "business_info",
        {
          changes: [website, { field: "labels", action: "clear" } as const],
        },
        location
      )
    ).toBe(false)
    expect(
      locationWriteApplied(
        "business_info",
        { changes: [{ field: "labels", action: "clear" } as const] },
        { ...location, labels: [] }
      )
    ).toBe(true)
  })
})

const link = {
  externalLocationId: "external-1",
  googleLocationName: "locations/1",
  googleConnectionId: "connection-1",
  accessToken: async () => "synthetic-token",
}
const attempt = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "attempt-1",
    rawStatus: "ambiguous",
    startedAt: new Date("2026-10-21T12:00:00Z"),
    errorCode: null,
    externalLocationId: "external-1",
    googleLocationName: "locations/1",
    family: "categories",
    intended: {
      categories: {
        primary: "categories/gcid:pub",
        additional: ["categories/gcid:bar", "categories/gcid:restaurant"],
      },
    },
    ...overrides,
  }) as never
const readback = (
  adapter: typeof bulkBusinessInfoRecoveryAdapter,
  overrides: Record<string, unknown> = {},
  target: Partial<typeof link> = {}
) =>
  adapter.readback({
    attempt: attempt(overrides),
    link: { ...link, ...target },
  } as never)

describe("bulk recovery readback", () => {
  beforeEach(() => {
    for (const fn of Object.values(google)) fn.mockReset()
    google.getGoogleLocation.mockResolvedValue(structuredClone(location))
  })

  it("reads the listing's business fields back and confirms a landed write", async () => {
    const result = await readback(bulkBusinessInfoRecoveryAdapter)
    expect(result).toMatchObject({ kind: "landed", confirmed: true })
    expect(result).toHaveProperty("responseHash", expect.any(String))
    expect(google.getGoogleLocation).toHaveBeenCalledWith(
      "synthetic-token",
      "locations/1",
      [...BUSINESS_LOCATION_FIELDS],
      { connectionKey: "connection-1" }
    )
  })

  it("reports a write Google does not show as not landed", async () => {
    google.getGoogleLocation.mockResolvedValue({
      ...location,
      categories: { primaryCategory: { name: "categories/gcid:cafe" } },
    })
    expect(await readback(bulkBusinessInfoRecoveryAdapter)).toEqual({
      kind: "not_landed",
      errorCode: "google_readback_mismatch",
    })
  })

  it("never reads a listing the link has since moved away from", async () => {
    for (const target of [
      { externalLocationId: "external-2" },
      { googleLocationName: "locations/2" },
    ]) {
      expect(
        await readback(bulkBusinessInfoRecoveryAdapter, {}, target)
      ).toEqual({ kind: "unverifiable", errorCode: "target_changed" })
    }
    expect(google.getGoogleLocation).not.toHaveBeenCalled()
  })

  it("refuses an attempt of another family without calling Google", async () => {
    expect(
      await readback(bulkBusinessInfoRecoveryAdapter, { family: "lodging" })
    ).toEqual({ kind: "unverifiable", errorCode: "family_mismatch" })
    expect(
      await readback(bulkLodgingRecoveryAdapter, { family: "categories" })
    ).toEqual({ kind: "unverifiable", errorCode: "family_mismatch" })
    expect(google.getGoogleLocation).not.toHaveBeenCalled()
    expect(google.googleLodgingApi).not.toHaveBeenCalled()
  })
})

describe("runBulkWrite", () => {
  const context = (childId: string) =>
    ({
      organisationId: "org-1",
      operationId: "operation-1",
      childId,
      locationId: "location-1",
      requestId: "request-1",
      intentId: `intent-${childId}`,
      approvalRef: null,
      session: { userId: "user-1" },
      linked: {
        externalLocationId: "external-1",
        googleLocationName: "locations/1",
        connectionId: "connection-1",
      },
    }) as never
  const spec = (value: string) => ({
    family: "business_info" as const,
    surface: "business_info" as const,
    action: "update",
    writeSurface: "business_info" as never,
    intended: {
      changes: [{ field: "websiteUri", action: "set", value }] as never,
    },
    mutate: vi.fn(),
    read: vi.fn(),
    verify: () => true,
  })
  const keys = () =>
    runGbpWrite.mock.calls.map(([input]) => (input as { key: string }).key)

  beforeEach(() => {
    runGbpWrite.mockReset()
    runGbpWrite.mockResolvedValue({ outcome: "confirmed_applied" })
  })

  it("keys a write by child and payload, so a later claim finds the earlier one", async () => {
    await runBulkWrite(context("child-1"), spec("https://a.example/"))
    await runBulkWrite(context("child-1"), spec("https://a.example/"))
    await runBulkWrite(context("child-1"), spec("https://b.example/"))
    await runBulkWrite(context("child-2"), spec("https://a.example/"))
    const [first, again, otherPayload, otherChild] = keys()
    expect(again).toBe(first)
    expect(otherPayload).not.toBe(first)
    expect(otherChild).not.toBe(first)
    expect(runGbpWrite.mock.calls[0]![0]).toMatchObject({
      onAmbiguous: "readback",
      intentId: "intent-child-1",
    })
  })

  it("maps the write's outcome, and a thrown write, to the child's result", async () => {
    expect(
      await runBulkWrite(context("child-1"), spec("https://a.example/"))
    ).toEqual({ kind: "succeeded", confirmation: "confirmed" })
    runGbpWrite.mockResolvedValue({ outcome: "failed" })
    expect(
      await runBulkWrite(context("child-1"), spec("https://a.example/"))
    ).toEqual({ kind: "failed", code: "provider_rejected" })
    runGbpWrite.mockResolvedValue({ outcome: "uncertain" })
    expect(
      await runBulkWrite(context("child-1"), spec("https://a.example/"))
    ).toEqual({ kind: "ambiguous", code: "readback_failed" })
  })
})
