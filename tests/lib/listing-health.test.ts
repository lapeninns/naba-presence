import { describe, expect, it } from "vitest"

import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import {
  googleChangedCount,
  listingAttentionReason,
  listingHealth,
  listingHealthLabel,
  listingHealthTone,
  noHoursOnGoogle,
  summariseListingHealth,
  syncStatusLabel,
  unpublishedCount,
} from "@/lib/listings/health"

function summary(overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    ...emptyListingSummary({ locationId: "l1", linked: true, verified: true }),
    connection: {
      status: "active",
      reconnectRequired: false,
      googleEmail: "a@b.c",
    },
    profile: { status: "in_sync", dirtyCount: 0, observedAt: new Date().toISOString() },
    hours: { status: "in_sync", dirtyCount: 0, observedAt: new Date().toISOString() },
    menu: {
      status: "in_sync",
      dirtyCount: 0,
      observedAt: new Date().toISOString(),
      eligible: true,
    },
    ...overrides,
  }
}

describe("listingHealth", () => {
  it("is not_linked before any Google link, whatever else is stored", () => {
    expect(listingHealth({ linked: false, summary: summary() })).toBe(
      "not_linked"
    )
  })

  it("is disconnected when the link's login is not active or needs reconnecting", () => {
    expect(
      listingHealth({
        linked: true,
        summary: summary({
          connection: {
            status: "expired",
            reconnectRequired: false,
            googleEmail: null,
          },
        }),
      })
    ).toBe("disconnected")
    expect(
      listingHealth({
        linked: true,
        summary: summary({
          connection: {
            status: "active",
            reconnectRequired: true,
            googleEmail: null,
          },
        }),
      })
    ).toBe("disconnected")
  })

  it("waits on verification before anything about sync", () => {
    expect(
      listingHealth({
        linked: true,
        verified: false,
        summary: summary({
          profile: { status: "core_dirty", dirtyCount: 2, observedAt: null },
        }),
      })
    ).toBe("pending_verification")
  })

  it("needs attention for a failed publish, a conflict or a Google change", () => {
    expect(
      listingHealth({
        linked: true,
        summary: summary({
          lastPublish: {
            at: "2026-09-01T00:00:00Z",
            status: "failed",
            area: "hours",
          },
        }),
      })
    ).toBe("attention")
    expect(
      listingHealth({
        linked: true,
        summary: summary({
          hours: { status: "conflict", dirtyCount: 1, observedAt: null },
        }),
      })
    ).toBe("attention")
    expect(
      listingHealth({
        linked: true,
        summary: summary({ suggestions: { profile: 1, foodMenus: 0 } }),
      })
    ).toBe("attention")
    expect(
      listingHealth({
        linked: true,
        summary: summary({
          posts: { drafts: 0, awaitingApproval: 0, failed: 1, published: 3 },
        }),
      })
    ).toBe("attention")
  })

  describe("no hours on Google", () => {
    const now = new Date().toISOString()
    const empty = (hours: Partial<ListingSummary["hours"]> = {}) =>
      summary({
        hours: {
          status: "in_sync",
          dirtyCount: 0,
          observedAt: now,
          checkStatus: "checked",
          googleEmpty: true,
          ...hours,
        },
      })

    it("needs attention when everything else is healthy", () => {
      expect(listingHealth({ linked: true, summary: empty() })).toBe(
        "attention"
      )
      expect(noHoursOnGoogle(empty())).toBe(true)
      expect(listingAttentionReason(empty())).toBe(
        "Google shows no opening hours for this listing."
      )
    })

    it("outranks unpublished edits", () => {
      const value = summary({
        hours: {
          status: "in_sync",
          dirtyCount: 0,
          observedAt: now,
          googleEmpty: true,
        },
        profile: { status: "core_dirty", dirtyCount: 2, observedAt: null },
      })
      expect(listingHealth({ linked: true, summary: value })).toBe("attention")
      const hoursEdited = empty({ status: "core_dirty", dirtyCount: 1 })
      expect(listingHealth({ linked: true, summary: hoursEdited })).toBe(
        "attention"
      )
    })

    it("leaves a listing with false or absent googleEmpty unchanged", () => {
      expect(
        listingHealth({ linked: true, summary: empty({ googleEmpty: false }) })
      ).toBe("healthy")
      expect(
        listingHealth({
          linked: true,
          summary: empty({ googleEmpty: undefined }),
        })
      ).toBe("healthy")
      expect(noHoursOnGoogle(empty({ googleEmpty: false }))).toBe(false)
      expect(listingAttentionReason(empty({ googleEmpty: false }))).toBeNull()
      expect(noHoursOnGoogle(null)).toBe(false)
    })

    it("is not claimed when the hours check failed or never happened, and never counts twice", () => {
      const failed = empty({ checkStatus: "failed" })
      expect(noHoursOnGoogle(failed)).toBe(false)
      // The failed check already gives attention: one state, one reason.
      expect(listingHealth({ linked: true, summary: failed })).toBe("attention")
      expect(listingAttentionReason(failed)).toBeNull()
      const never = empty({ status: "unknown", observedAt: null })
      expect(noHoursOnGoogle(never)).toBe(false)
      expect(listingHealth({ linked: true, summary: never })).toBe(
        "partially_checked"
      )
    })

    it("keeps the general sentence when something else also needs attention", () => {
      const value = summary({
        hours: {
          status: "in_sync",
          dirtyCount: 0,
          observedAt: now,
          googleEmpty: true,
        },
        posts: { drafts: 0, awaitingApproval: 0, failed: 1, published: 0 },
      })
      expect(listingHealth({ linked: true, summary: value })).toBe("attention")
      expect(listingAttentionReason(value)).toBeNull()
    })

    it("does not override a login or access problem", () => {
      expect(
        listingHealth({
          linked: true,
          summary: {
            ...empty(),
            connection: {
              status: "expired",
              reconnectRequired: true,
              googleEmail: null,
            },
          },
        })
      ).toBe("disconnected")
    })
  })

  it("has changes to publish when local edits are not on Google", () => {
    const value = summary({
      profile: { status: "core_dirty", dirtyCount: 2, observedAt: null },
    })
    expect(listingHealth({ linked: true, summary: value })).toBe("unpublished")
    expect(unpublishedCount(value)).toBe(2)
    expect(
      listingHealth({
        linked: true,
        summary: summary({
          posts: { drafts: 1, awaitingApproval: 1, failed: 0, published: 0 },
        }),
      })
    ).toBe("unpublished")
  })

  it("is healthy only with current comparisons and stays unchecked before the summary arrives", () => {
    expect(
      listingHealth({ linked: true, verified: true, summary: summary() })
    ).toBe("healthy")
    expect(listingHealth({ linked: true, verified: true })).toBe("unchecked")
  })

  it("counts Google-side changes across areas and suggestions", () => {
    expect(
      googleChangedCount(
        summary({
          hours: { status: "google_dirty", dirtyCount: 0, observedAt: null },
          suggestions: { profile: 2, foodMenus: 1 },
        })
      )
    ).toBe(4)
  })

  it("maps every health to a tone and a label from the shared vocabulary", () => {
    expect(listingHealthTone("disconnected")).toBe("at-risk")
    expect(listingHealthTone("unpublished")).toBe("pending")
    expect(listingHealthLabel("unpublished")).toBe("Changes to publish")
    expect(syncStatusLabel("core_dirty")).toBe("Not on Google yet")
    expect(syncStatusLabel("unknown")).toBe("Not checked yet")
  })

  it("summarises a board in one line", () => {
    expect(summariseListingHealth([])).toBe("No listings yet")
    expect(summariseListingHealth(["healthy", "healthy"])).toBe(
      "Every listing is in sync"
    )
    expect(
      summariseListingHealth(["attention", "unpublished", "unpublished"])
    ).toBe("1 needs attention · 2 have changes to publish")
  })
})

describe("listing access loss", () => {
  const lost = summary({
    freshness: {
      state: "action_needed",
      reason: "listing_access_lost",
      lastCheckedAt: null,
    },
  })

  it("says Access lost, not Disconnected, when only this listing is unreachable", () => {
    expect(listingHealth({ linked: true, summary: lost })).toBe("access_lost")
    expect(listingHealthLabel("access_lost")).toBe("Access lost")
    expect(listingHealthTone("access_lost")).toBe("at-risk")
  })

  it("still says Disconnected when the login itself is broken", () => {
    expect(
      listingHealth({
        linked: true,
        summary: {
          ...lost,
          connection: { status: "revoked", reconnectRequired: true, googleEmail: null },
        },
      })
    ).toBe("disconnected")
  })
})
