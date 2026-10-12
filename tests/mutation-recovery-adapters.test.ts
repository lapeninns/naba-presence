import { beforeEach, describe, expect, it, vi } from "vitest"

import { hashHours, normalizeGoogleHours } from "@/lib/domain/hours"
import type { LinkedLocation } from "@/lib/server/gbp-write"
import type { RecoveryOperation } from "@/lib/server/mutation-operations"

const google = vi.hoisted(() => ({
  getGoogleLocation: vi.fn(),
  getGoogleLocalPost: vi.fn(),
  googleLocalPosts: vi.fn(),
  getGoogleMediaItem: vi.fn(),
}))
vi.mock("@/lib/server/google", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...google,
}))

import { hoursRecoveryAdapter } from "@/lib/server/hours"
import { ApiError } from "@/lib/server/http"
import { mediaRecoveryAdapter } from "@/lib/server/media"
import { localPostRecoveryAdapter } from "@/lib/server/posts"
import { profileRecoveryAdapter } from "@/lib/server/profile"

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

describe("media recovery adapter", () => {
  it("hands a media create from before the upload checkpoints to a person", async () => {
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: {
          ...base,
          operation: "create",
          requestedPayload: {},
          googleMediaName: null,
          uploadPhase: "none",
          contentSha256: null,
          claimedNames: [],
          contested: false,
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

describe("post recovery adapter", () => {
  const sent = {
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Quiz night every Thursday",
  }
  const post = (name: string, summary = sent.summary) => ({
    name,
    ...sent,
    summary,
    state: "LIVE",
  })
  const attempt = {
    ...base,
    operation: "create" as const,
    intendedPayload: sent,
    postLocationId: "l1",
    googlePostName: null,
    claimedNames: ["accounts/1/locations/1/localPosts/held"],
  }

  it("identifies a create by content, skipping posts other rows claim", async () => {
    google.googleLocalPosts.mockResolvedValue({
      localPosts: [
        post("accounts/1/locations/1/localPosts/held"),
        post("accounts/1/locations/1/localPosts/new"),
      ],
    })
    await expect(
      localPostRecoveryAdapter.readback({ attempt, link, operation })
    ).resolves.toMatchObject({
      kind: "landed",
      confirmed: false,
      response: { name: "accounts/1/locations/1/localPosts/new" },
    })
  })

  it("finds a create not published when no unclaimed post matches", async () => {
    google.googleLocalPosts.mockResolvedValue({
      localPosts: [
        post("accounts/1/locations/1/localPosts/held"),
        post("accounts/1/locations/1/localPosts/other", "Something else"),
      ],
    })
    await expect(
      localPostRecoveryAdapter.readback({ attempt, link, operation })
    ).resolves.toEqual({
      kind: "not_landed",
      errorCode: "google_post_not_published",
    })
  })

  it("compares an update with the content sent", async () => {
    const update = {
      ...attempt,
      operation: "update" as const,
      googlePostName: "accounts/1/locations/1/localPosts/p1",
    }
    google.getGoogleLocalPost.mockResolvedValue(
      post("accounts/1/locations/1/localPosts/p1")
    )
    await expect(
      localPostRecoveryAdapter.readback({ attempt: update, link, operation })
    ).resolves.toMatchObject({ kind: "landed", confirmed: true })
    google.getGoogleLocalPost.mockResolvedValue(
      post("accounts/1/locations/1/localPosts/p1", "Last week's text")
    )
    await expect(
      localPostRecoveryAdapter.readback({ attempt: update, link, operation })
    ).resolves.toEqual({
      kind: "not_landed",
      errorCode: "google_post_update_unconfirmed",
    })
  })

  it("confirms a delete once the post is no longer listed", async () => {
    const remove = {
      ...attempt,
      operation: "delete" as const,
      googlePostName: "accounts/1/locations/1/localPosts/p1",
    }
    google.googleLocalPosts.mockResolvedValue({
      localPosts: [post("accounts/1/locations/1/localPosts/p1")],
    })
    await expect(
      localPostRecoveryAdapter.readback({ attempt: remove, link, operation })
    ).resolves.toEqual({
      kind: "not_landed",
      errorCode: "google_post_not_deleted",
    })
    google.googleLocalPosts.mockResolvedValue({ localPosts: [] })
    await expect(
      localPostRecoveryAdapter.readback({ attempt: remove, link, operation })
    ).resolves.toEqual({ kind: "landed", confirmed: true })
  })

  it("will not read a post that moved to another location", async () => {
    await expect(
      localPostRecoveryAdapter.readback({
        attempt: { ...attempt, postLocationId: "l2" },
        link,
        operation,
      })
    ).resolves.toEqual({ kind: "unverifiable", errorCode: "target_changed" })
    expect(google.googleLocalPosts).not.toHaveBeenCalled()
  })
})

describe("profile recovery adapter", () => {
  const attempt = {
    ...base,
    externalLocationId: "ext-1",
    direction: "to_google",
    selectedFields: ["name", "description"] as ("name" | "description")[],
    updateMask: ["title"],
    intendedPayload: {
      title: "The Bell Inn",
      profile: { description: "A village pub" },
    },
  }

  it("compares only the fields the patch wrote", async () => {
    // The description was selected but not in the mask, so its drift at
    // Google says nothing about this write.
    google.getGoogleLocation.mockResolvedValue({
      title: "The Bell Inn",
      profile: { description: "Changed since" },
    })
    await expect(
      profileRecoveryAdapter.readback({ attempt, link, operation })
    ).resolves.toMatchObject({ kind: "landed", confirmed: true })
    google.getGoogleLocation.mockResolvedValue({
      title: "The Bell",
      profile: { description: "A village pub" },
    })
    await expect(
      profileRecoveryAdapter.readback({ attempt, link, operation })
    ).resolves.toEqual({
      kind: "not_landed",
      errorCode: "google_readback_mismatch",
    })
  })

  it("names an unreadable intent apart from a changed target", async () => {
    for (const changed of [
      { direction: "from_google" },
      { updateMask: ["regularHours"] },
    ]) {
      await expect(
        profileRecoveryAdapter.readback({
          attempt: { ...attempt, ...changed },
          link,
          operation,
        })
      ).resolves.toEqual({
        kind: "unverifiable",
        errorCode: "recovery_unsupported",
      })
    }
    await expect(
      profileRecoveryAdapter.readback({
        attempt: { ...attempt, externalLocationId: "ext-other" },
        link,
        operation,
      })
    ).resolves.toEqual({ kind: "unverifiable", errorCode: "target_changed" })
    expect(google.getGoogleLocation).not.toHaveBeenCalled()
  })
})

describe("media update recovery", () => {
  it("hands an update of an item Google no longer holds to a person", async () => {
    google.getGoogleMediaItem.mockRejectedValue(
      new ApiError(404, "google_not_found", "Not found.")
    )
    await expect(
      mediaRecoveryAdapter.readback({
        attempt: {
          ...base,
          operation: "update",
          requestedPayload: { category: "INTERIOR" },
          googleMediaName: "accounts/1/locations/1/media/m1",
          uploadPhase: "none",
          contentSha256: null,
          claimedNames: [],
          contested: false,
        },
        link,
        operation,
      })
    ).resolves.toEqual({ kind: "unverifiable", errorCode: "target_changed" })
  })
})
