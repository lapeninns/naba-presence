import { beforeEach, describe, expect, it, vi } from "vitest"

import { hashHours, normalizeGoogleHours } from "@/lib/domain/hours"
import type { LinkedLocation } from "@/lib/server/gbp-write"
import type { RecoveryOperation } from "@/lib/server/mutation-operations"

const google = vi.hoisted(() => ({
  getGoogleLocation: vi.fn(),
  getGoogleLocationAttributes: vi.fn(),
}))
vi.mock("@/lib/server/google", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getGoogleLocation: google.getGoogleLocation,
  getGoogleLocationAttributes: google.getGoogleLocationAttributes,
}))

import { businessInformationRecoveryAdapter } from "@/lib/server/business-information"
import { hoursRecoveryAdapter } from "@/lib/server/hours"
import { industryRecoveryAdapter } from "@/lib/server/industry-management"
import { mediaRecoveryAdapter } from "@/lib/server/media"

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
const base = { id: "a1", rawStatus: "ambiguous", startedAt: null }

const day = (openDay: string, open: number, close: number) => ({
  openDay,
  openTime: { hours: open },
  closeDay: openDay,
  closeTime: { hours: close },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("hours recovery adapter", () => {
  const before = {
    regularHours: {
      periods: [day("MONDAY", 9, 17), day("TUESDAY", 9, 17)],
    },
  }
  // A selective publish of Monday only: the payload carries the merged
  // week, with Monday changed.
  const selectivePayload = {
    regularHours: {
      periods: [day("MONDAY", 10, 18), day("TUESDAY", 9, 17)],
    },
  }
  const selective = {
    ...base,
    externalLocationId: "ext-1",
    intendedPayload: selectivePayload,
    pinnedCanonicalHash: "unused-for-selective",
    selection: { regularDays: [1] },
  }

  it("confirms a selective publish from its selected parts alone", async () => {
    // Tuesday changed at Google since; the write never touched it.
    google.getGoogleLocation.mockResolvedValue({
      regularHours: {
        periods: [day("MONDAY", 10, 18), day("TUESDAY", 12, 20)],
      },
    })
    await expect(
      hoursRecoveryAdapter.readback({ attempt: selective, link, operation })
    ).resolves.toMatchObject({ kind: "landed", confirmed: true })
  })

  it("finds a selective publish not applied when a selected part differs", async () => {
    google.getGoogleLocation.mockResolvedValue(before)
    await expect(
      hoursRecoveryAdapter.readback({ attempt: selective, link, operation })
    ).resolves.toEqual({
      kind: "not_landed",
      errorCode: "google_readback_mismatch",
    })
  })

  it("compares a whole-schedule publish with the pinned canonical hash", async () => {
    const whole = {
      ...selective,
      selection: null,
      pinnedCanonicalHash: hashHours(normalizeGoogleHours(selectivePayload)),
    }
    google.getGoogleLocation.mockResolvedValue(selectivePayload)
    await expect(
      hoursRecoveryAdapter.readback({ attempt: whole, link, operation })
    ).resolves.toMatchObject({ kind: "landed" })
    google.getGoogleLocation.mockResolvedValue(before)
    await expect(
      hoursRecoveryAdapter.readback({ attempt: whole, link, operation })
    ).resolves.toMatchObject({ kind: "not_landed" })
  })

  it("will not read a location the attempt did not target", async () => {
    await expect(
      hoursRecoveryAdapter.readback({
        attempt: { ...selective, externalLocationId: "ext-other" },
        link,
        operation,
      })
    ).resolves.toEqual({ kind: "unverifiable", errorCode: "target_changed" })
    expect(google.getGoogleLocation).not.toHaveBeenCalled()
  })

  it("lets an unreadable provider throw, for the runner to back off", async () => {
    google.getGoogleLocation.mockRejectedValue(new Error("timeout"))
    await expect(
      hoursRecoveryAdapter.readback({ attempt: selective, link, operation })
    ).rejects.toThrow("timeout")
  })
})

describe("business information recovery adapter", () => {
  const attempt = {
    ...base,
    resourceType: "business_info",
    operation: "patch",
    targetResourceName: "locations/1",
    updateMask: ["title"],
    requestedPayload: { title: "The Bell Inn" },
  }

  it("compares the masked fields with the recorded payload", async () => {
    google.getGoogleLocation.mockResolvedValue({
      name: "locations/1",
      title: "The Bell Inn",
    })
    await expect(
      businessInformationRecoveryAdapter.readback({ attempt, link, operation })
    ).resolves.toMatchObject({ kind: "landed", confirmed: true })
    google.getGoogleLocation.mockResolvedValue({
      name: "locations/1",
      title: "The Bell",
    })
    await expect(
      businessInformationRecoveryAdapter.readback({ attempt, link, operation })
    ).resolves.toEqual({
      kind: "not_landed",
      errorCode: "business_information_readback_mismatch",
    })
  })
})

describe("industry and media recovery adapters", () => {
  it("refuses an industry row recorded for another location", async () => {
    await expect(
      industryRecoveryAdapter.readback({
        attempt: {
          ...base,
          resourceType: "lodging",
          operation: "update_lodging",
          targetResourceName: "locations/2/lodging",
          updateMask: [],
          requestedPayload: {},
        },
        link,
        operation,
      })
    ).resolves.toEqual({ kind: "unverifiable", errorCode: "target_changed" })
  })

  it("hands a media create to a person", async () => {
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: {
          ...base,
          operation: "create",
          requestedPayload: {},
          googleMediaName: null,
        },
        link,
        operation,
      })
    ).resolves.toEqual({
      kind: "unverifiable",
      errorCode: "media_create_unverifiable",
    })
  })
})
