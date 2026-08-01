import { describe, expect, it } from "vitest"

import {
  autoSelectId,
  mobilePaneFor,
  parseInboxState,
  queueToStatuses,
  serializeInboxState,
  toReviewsFilters,
  hasActiveFilters,
  type InboxState,
} from "@/lib/inbox/url-state"

describe("inbox url state", () => {
  it("defaults to the all queue and updated_desc sort", () => {
    const state = parseInboxState(new URLSearchParams())
    expect(state.queue).toBe("all")
    expect(state.sort).toBe("updated_desc")
    expect(state.ratings).toEqual([])
    expect(hasActiveFilters(state)).toBe(false)
  })

  it("reads Home's ?locationId= contract as the initial location filter", () => {
    const state = parseInboxState(new URLSearchParams("locationId=loc-9"))
    expect(state.locationId).toBe("loc-9")
    expect(hasActiveFilters(state)).toBe(true)
  })

  it("parses every param including comma lists", () => {
    const state = parseInboxState(
      new URLSearchParams(
        "queue=needs_reply&rating=4,5&search=slow&sort=rating_asc&verification=pass,warn&publishStatus=published&syncStatus=failed&replyState=unreplied&dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-31T00:00:00.000Z&selected=rev-1"
      )
    )
    expect(state.queue).toBe("needs_reply")
    expect(state.ratings).toEqual([4, 5])
    expect(state.search).toBe("slow")
    expect(state.sort).toBe("rating_asc")
    expect(state.verification).toEqual(["pass", "warn"])
    expect(state.publishStatus).toEqual(["published"])
    expect(state.syncStatus).toEqual(["failed"])
    expect(state.replyState).toBe("unreplied")
    expect(state.selected).toBe("rev-1")
  })

  it("ignores an unknown queue and falls back to all", () => {
    const state = parseInboxState(new URLSearchParams("queue=nonsense"))
    expect(state.queue).toBe("all")
  })

  it("round-trips through serialize omitting defaults and empties", () => {
    const state: InboxState = {
      queue: "published",
      locationId: "loc-1",
      ratings: [5],
      search: "",
      sort: "updated_desc",
      verification: [],
      publishStatus: [],
      syncStatus: [],
      selected: "rev-2",
    }
    const params = serializeInboxState(state)
    expect(params.get("queue")).toBe("published")
    expect(params.get("locationId")).toBe("loc-1")
    expect(params.get("rating")).toBe("5")
    expect(params.get("selected")).toBe("rev-2")
    expect(params.has("search")).toBe(false)
    expect(params.has("sort")).toBe(false)
    expect(params.has("verification")).toBe(false)
  })

  it("expands the queue into backend statuses and drops it from filters", () => {
    expect(queueToStatuses("all")).toBeUndefined()
    expect(queueToStatuses("awaiting_approval")).toEqual(["awaiting_approval"])
    expect(queueToStatuses("escalated")).toEqual(["escalated"])
    expect(queueToStatuses("published")).toEqual(["published"])
    expect(queueToStatuses("needs_reply")).toContain("new")

    const filters = toReviewsFilters(
      parseInboxState(new URLSearchParams("queue=escalated&locationId=loc-1"))
    )
    expect(filters.statuses).toEqual(["escalated"])
    expect(filters.locationId).toBe("loc-1")
  })

  it("shows the detail pane on mobile only when a review is selected", () => {
    expect(mobilePaneFor(undefined)).toBe("list")
    expect(mobilePaneFor("rev-1")).toBe("detail")
  })

  it("auto-selects the first row only on desktop, unselected, and clean", () => {
    const reviews = [{ id: "a" }, { id: "b" }]
    expect(
      autoSelectId({ selected: undefined, reviews, isDirty: false, isDesktop: true })
    ).toBe("a")
    // Already selected -> no auto-select.
    expect(
      autoSelectId({ selected: "b", reviews, isDirty: false, isDesktop: true })
    ).toBeNull()
    // Dirty composer -> never steal the selection.
    expect(
      autoSelectId({ selected: undefined, reviews, isDirty: true, isDesktop: true })
    ).toBeNull()
    // Mobile -> the list is shown first; no auto-select.
    expect(
      autoSelectId({ selected: undefined, reviews, isDirty: false, isDesktop: false })
    ).toBeNull()
    // Empty list -> nothing to select.
    expect(
      autoSelectId({ selected: undefined, reviews: [], isDirty: false, isDesktop: true })
    ).toBeNull()
  })
})
