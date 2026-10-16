import { describe, expect, it, vi } from "vitest"

import { emptyListingSummary } from "@/lib/contracts/location-summary"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import {
  bookingTabPrefetch,
  changesTabPrefetch,
  menuTabPrefetch,
  peopleTabPrefetch,
  prefetch,
  PREFETCH_SKIP,
  profileTabPrefetch,
  readImportReview,
  readPlaceActions,
  readVerificationState,
  suggestionsTabPrefetch,
  verificationTabPrefetch,
} from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

// L16: the six listing areas that fetched their main data after hydration
// now stream it like hours, photos and posts. The readers that reach Google
// are the routes' own lib/server functions (mocked here); what this file
// pins is which keys each area hydrates, for whom, and when the summary is
// read again.
vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn() }))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/server/review-reads", () => ({
  readReviewsPage: vi.fn(),
  readReviewDetail: vi.fn(),
}))
vi.mock("@/lib/server/listing-reads", () => ({
  readHoursResponse: vi.fn(),
  readMediaListResponse: vi.fn(),
  readPostsListResponse: vi.fn(),
}))
vi.mock("@/lib/server/location-summary", () => ({
  readListingSummaries: vi.fn(async () => []),
}))
vi.mock("@/lib/server/profile", () => ({ getProfileState: vi.fn() }))
vi.mock("@/lib/server/business-information", () => ({
  loadBusinessInformation: vi.fn(),
}))
vi.mock("@/lib/server/food-menus", () => ({ getFoodMenusState: vi.fn() }))
vi.mock("@/lib/server/place-actions", () => ({ loadPlaceActions: vi.fn() }))
vi.mock("@/lib/server/import-review", () => ({
  listImportProposals: vi.fn(),
}))
vi.mock("@/lib/server/location-administration", () => ({
  loadLocationAdministration: vi.fn(),
}))
vi.mock("@/lib/server/google-verification-state", () => ({
  loadGoogleVerificationState: vi.fn(),
}))
// The profile's wire parse is pinned by the profile route's own tests; here
// a bare `{ source }` stands in for a whole profile.
vi.mock("@/lib/contracts/location-profile", async (original) => ({
  ...(await original<object>()),
  profileResponseSchema: { parse: (value: unknown) => value },
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ IMPORT_REVIEW_ENABLED: true }),
}))

const ORG = "00000000-0000-4000-8000-000000000001"
const LOCATION = "00000000-0000-4000-8000-000000000010"

function sessionAs(role: string): Session {
  return {
    sessionId: "00000000-0000-4000-8000-000000000020",
    userId: "00000000-0000-4000-8000-000000000002",
    organisationId: ORG,
    organisationName: "Org",
    workspaceMode: "business",
    displayName: "Test",
    email: "test@example.test",
    role,
    canPublish: true,
  } as Session
}
const owner = sessionAs("owner")

async function summaryMocks() {
  const { readListingSummaries } = await import("@/lib/server/location-summary")
  const { withTenant } = await import("@/lib/server/db")
  vi.mocked(withTenant).mockImplementation(async (_org, fn) => fn({} as never))
  vi.mocked(readListingSummaries).mockClear()
  return readListingSummaries
}

describe("listing area prefetch keys", () => {
  it("profile: the profile and its business information side by side, then the summary", () => {
    expect(
      profileTabPrefetch(LOCATION)(owner).map((entry) => entry.queryKey)
    ).toEqual([
      queryKeys.locationProfile(LOCATION),
      queryKeys.locationBusinessInformation(LOCATION),
      queryKeys.listingSummary(LOCATION),
    ])
  })

  it("menu: the food menus, then the summary their read refreshes", () => {
    expect(
      menuTabPrefetch(LOCATION)(owner).map((entry) => entry.queryKey)
    ).toEqual([
      queryKeys.locationMenu(LOCATION),
      queryKeys.listingSummary(LOCATION),
    ])
  })

  it("booking: the place actions only", () => {
    expect(
      bookingTabPrefetch(LOCATION)(owner).map((entry) => entry.queryKey)
    ).toEqual([queryKeys.locationBooking(LOCATION)])
  })

  it("suggestions: the profile and both proposal lists, keyed as useImportReview keys them", () => {
    expect(
      suggestionsTabPrefetch(LOCATION)(owner).map((entry) => entry.queryKey)
    ).toEqual([
      queryKeys.locationProfile(LOCATION),
      [...queryKeys.locationImportReview(LOCATION), "profile"],
      [...queryKeys.locationImportReview(LOCATION), "food_menus"],
      queryKeys.listingSummary(LOCATION),
    ])
  })

  it("people and verification: owners and admins only, as their routes answer", () => {
    for (const role of ["owner", "admin"]) {
      expect(
        peopleTabPrefetch(LOCATION)(sessionAs(role)).map(
          (entry) => entry.queryKey
        )
      ).toEqual([queryKeys.locationAdministration(LOCATION)])
      expect(
        verificationTabPrefetch(LOCATION)(sessionAs(role)).map(
          (entry) => entry.queryKey
        )
      ).toEqual([queryKeys.locationVerificationState(LOCATION)])
    }
    for (const role of ["member", "viewer"]) {
      expect(peopleTabPrefetch(LOCATION)(sessionAs(role))).toEqual([])
      expect(verificationTabPrefetch(LOCATION)(sessionAs(role))).toEqual([])
    }
  })

  it("skips every area for an id the routes would never be sent", () => {
    for (const composer of [
      profileTabPrefetch,
      menuTabPrefetch,
      bookingTabPrefetch,
      peopleTabPrefetch,
      verificationTabPrefetch,
      suggestionsTabPrefetch,
    ])
      expect(composer("not-a-uuid")(owner)).toEqual([])
  })
})

describe("listing area summary re-read", () => {
  it("profile: no second summary read after a profile served from storage", async () => {
    const readListingSummaries = await summaryMocks()
    const { getProfileState } = await import("@/lib/server/profile")
    vi.mocked(getProfileState).mockResolvedValueOnce({
      source: "stored",
    } as never)
    const [profile, , summary] = profileTabPrefetch(LOCATION)(owner)
    // The profile read is shared: the summary entry waits on the same one.
    await profile.load().catch(() => undefined)
    await expect(summary.load()).resolves.toBe(PREFETCH_SKIP)
    expect(getProfileState).toHaveBeenCalledOnce()
    expect(readListingSummaries).not.toHaveBeenCalled()
  })

  it("profile: reads the summary again after a live profile read, even a failed one", async () => {
    const readListingSummaries = await summaryMocks()
    const { getProfileState } = await import("@/lib/server/profile")
    vi.mocked(getProfileState).mockClear()
    vi.mocked(getProfileState).mockRejectedValueOnce(new Error("google down"))
    const [, , summary] = profileTabPrefetch(LOCATION)(owner)
    await expect(summary.load()).resolves.toBeNull()
    expect(getProfileState).toHaveBeenCalledOnce()
    expect(readListingSummaries).toHaveBeenCalledOnce()
  })

  it("menu: always reads the summary again once the menus settle", async () => {
    const readListingSummaries = await summaryMocks()
    const { getFoodMenusState } = await import("@/lib/server/food-menus")
    let fail!: (error: Error) => void
    vi.mocked(getFoodMenusState).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    const [menus, summary] = menuTabPrefetch(LOCATION)(owner)
    const menusLoad = menus.load()
    const summaryLoad = summary.load()
    await Promise.resolve()
    expect(readListingSummaries).not.toHaveBeenCalled()
    fail(new Error("google down"))
    await expect(menusLoad).rejects.toThrow("google down")
    await expect(summaryLoad).resolves.toBeNull()
    expect(readListingSummaries).toHaveBeenCalledOnce()
  })

  it("a failed Google read leaves the area's key empty for the browser to fetch", async () => {
    await summaryMocks()
    const { loadPlaceActions } = await import("@/lib/server/place-actions")
    vi.mocked(loadPlaceActions).mockRejectedValueOnce(new Error("google down"))
    const client = makeQueryClient()
    await prefetch(owner, bookingTabPrefetch(LOCATION), client)
    expect(
      client.getQueryData(queryKeys.locationBooking(LOCATION))
    ).toBeUndefined()
  })
})

describe("Review & publish prefetch (LST-14)", () => {
  /** The DB summary the page's own reads see, with the named areas dirty. */
  async function waiting(areas: Array<"profile" | "hours" | "menu">) {
    const readListingSummaries = await summaryMocks()
    const base = emptyListingSummary({
      locationId: LOCATION,
      linked: true,
      verified: true,
    })
    const summary = { ...base } as Record<string, unknown>
    for (const area of areas)
      summary[area] = { ...base[area], status: "core_dirty", eligible: true }
    vi.mocked(readListingSummaries).mockResolvedValue([summary] as never)
    const { getProfileState } = await import("@/lib/server/profile")
    const { getFoodMenusState } = await import("@/lib/server/food-menus")
    const { readHoursResponse } = await import("@/lib/server/listing-reads")
    for (const read of [getProfileState, getFoodMenusState, readHoursResponse])
      vi.mocked(read as () => unknown).mockReset()
    return {
      readListingSummaries,
      getProfileState,
      getFoodMenusState,
      readHoursResponse,
    }
  }

  it("keys the three areas Review & publish reads, then the summary", () => {
    expect(
      changesTabPrefetch(LOCATION)(owner).map((entry) => entry.queryKey)
    ).toEqual([
      queryKeys.locationProfile(LOCATION),
      queryKeys.locationHours(LOCATION),
      queryKeys.locationMenu(LOCATION),
      queryKeys.listingSummary(LOCATION),
    ])
    expect(changesTabPrefetch("not-a-uuid")(owner)).toEqual([])
  })

  it("reads only the areas the summary says have saved edits, and the summary again after", async () => {
    const {
      readListingSummaries,
      getProfileState,
      getFoodMenusState,
      readHoursResponse,
    } = await waiting(["hours"])
    vi.mocked(readHoursResponse).mockRejectedValue(new Error("google down"))
    const [profile, hours, menu, summary] = changesTabPrefetch(LOCATION)(owner)
    await expect(profile.load()).resolves.toBe(PREFETCH_SKIP)
    await expect(menu.load()).resolves.toBe(PREFETCH_SKIP)
    await expect(hours.load()).rejects.toThrow("google down")
    // A failed live read still touched Google, so the summary is re-read.
    await expect(summary.load()).resolves.not.toBe(PREFETCH_SKIP)
    expect(readHoursResponse).toHaveBeenCalledOnce()
    expect(getProfileState).not.toHaveBeenCalled()
    expect(getFoodMenusState).not.toHaveBeenCalled()
    // Once to learn what is waiting (shared by the three), once to refresh.
    expect(readListingSummaries).toHaveBeenCalledTimes(2)
  })

  it("reads nothing from Google when nothing is waiting", async () => {
    const {
      readListingSummaries,
      getProfileState,
      getFoodMenusState,
      readHoursResponse,
    } = await waiting([])
    const entries = changesTabPrefetch(LOCATION)(owner)
    for (const entry of entries)
      await expect(entry.load()).resolves.toBe(PREFETCH_SKIP)
    expect(readHoursResponse).not.toHaveBeenCalled()
    expect(getProfileState).not.toHaveBeenCalled()
    expect(getFoodMenusState).not.toHaveBeenCalled()
    expect(readListingSummaries).toHaveBeenCalledOnce()
  })

  it("leaves every key to the browser, and reads no Google, when the summary can't be read", async () => {
    const {
      readListingSummaries,
      getProfileState,
      getFoodMenusState,
      readHoursResponse,
    } = await waiting(["profile", "hours", "menu"])
    vi.mocked(readListingSummaries).mockRejectedValue(new Error("db down"))
    const entries = changesTabPrefetch(LOCATION)(owner)
    for (const entry of entries)
      await expect(entry.load()).resolves.toBe(PREFETCH_SKIP)
    expect(getProfileState).not.toHaveBeenCalled()
    expect(getFoodMenusState).not.toHaveBeenCalled()
    expect(readHoursResponse).not.toHaveBeenCalled()
  })

  it("leaves the summary alone after a profile served from storage", async () => {
    const { readListingSummaries, getProfileState } = await waiting(["profile"])
    vi.mocked(getProfileState).mockResolvedValue({ source: "stored" } as never)
    const [profile, hours, menu, summary] = changesTabPrefetch(LOCATION)(owner)
    await expect(profile.load()).resolves.toEqual({ source: "stored" })
    await expect(hours.load()).resolves.toBe(PREFETCH_SKIP)
    await expect(menu.load()).resolves.toBe(PREFETCH_SKIP)
    await expect(summary.load()).resolves.toBe(PREFETCH_SKIP)
    expect(readListingSummaries).toHaveBeenCalledOnce()
  })
})

describe("listing area readers", () => {
  it("readImportReview asks for open proposals of one type and adds the route's switch", async () => {
    const { listImportProposals } = await import("@/lib/server/import-review")
    vi.mocked(listImportProposals).mockResolvedValueOnce({
      proposals: [],
      counts: { pending: 0, profile: 0, foodMenus: 0 },
    })
    await expect(
      readImportReview(owner, LOCATION, "food_menus")
    ).resolves.toEqual({
      proposals: [],
      counts: { pending: 0, profile: 0, foodMenus: 0 },
      importReviewEnabled: true,
    })
    expect(listImportProposals).toHaveBeenCalledWith({
      session: owner,
      locationId: LOCATION,
      resourceType: "food_menus",
      includeDecided: false,
    })
  })

  it("readPlaceActions reads as the route does, within the editor's staleness budget", async () => {
    const { loadPlaceActions } = await import("@/lib/server/place-actions")
    vi.mocked(loadPlaceActions).mockClear()
    vi.mocked(loadPlaceActions).mockResolvedValueOnce({} as never)
    await readPlaceActions(owner, LOCATION).catch(() => undefined)
    expect(loadPlaceActions).toHaveBeenCalledWith(ORG, owner, LOCATION)
  })

  it("readVerificationState returns the route's body through the wire", async () => {
    const { loadGoogleVerificationState } =
      await import("@/lib/server/google-verification-state")
    const body = {
      locationId: LOCATION,
      googleLocationName: "locations/1",
      checkedAt: "2026-10-15T10:00:00.000Z",
      verifications: [],
      merchant: null,
      merchantError: null,
    }
    vi.mocked(loadGoogleVerificationState).mockResolvedValueOnce(body)
    await expect(readVerificationState(owner, LOCATION)).resolves.toEqual(body)
  })
})
