import { describe, expect, it } from "vitest"

import {
  autoSelectId,
  mobilePaneFor,
  parseInboxState,
  serializeInboxState,
  toReviewsFilters,
  hasActiveFilters,
  type InboxState,
} from "@/lib/inbox/url-state"

describe("inbox url state", () => {
  it("defaults to the needs_reply queue and updated_desc sort", () => {
    const state = parseInboxState(new URLSearchParams())
    expect(state.queue).toBe("needs_reply")
    expect(state.sort).toBe("updated_desc")
    expect(state.ratings).toEqual([])
    expect(hasActiveFilters(state)).toBe(false)
  })

  it("reads Home's ?locationId= contract as the initial location filter", () => {
    // One param, two shapes: a single id from every existing deep link, or a
    // comma list from the multi-select. Decode always yields the array.
    const state = parseInboxState(new URLSearchParams("locationId=loc-9"))
    expect(state.locationIds).toEqual(["loc-9"])
    expect(hasActiveFilters(state)).toBe(true)
    expect(
      parseInboxState(new URLSearchParams("locationId=loc-9,loc-8")).locationIds
    ).toEqual(["loc-9", "loc-8"])
  })

  it("carries the agency filters", () => {
    const state = parseInboxState(
      new URLSearchParams("clientId=c1&assignee=me&view=oldest-first")
    )
    expect(state.clientId).toBe("c1")
    expect(state.assignee).toBe("me")
    expect(state.view).toBe("oldest-first")
    expect(hasActiveFilters(state)).toBe(true)
  })

  it("names the queue on the wire instead of expanding it to statuses", () => {
    // "Awaiting my approval" depends on who requested the approval and who may
    // publish — facts the browser does not have. The server decides, so the
    // rail's counts and its rows answer to one definition.
    const filters = toReviewsFilters(
      parseInboxState(new URLSearchParams("queue=awaiting_my_approval"))
    )
    expect(filters.queue).toBe("awaiting_my_approval")
    expect(filters).not.toHaveProperty("statuses")
  })

  it("treats a non-default sort as an active filter", () => {
    const state = parseInboxState(new URLSearchParams("sort=rating_asc"))
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

  it("ignores an unknown queue and falls back to needs_reply", () => {
    const state = parseInboxState(new URLSearchParams("queue=nonsense"))
    expect(state.queue).toBe("needs_reply")
  })

  it("omits the default needs_reply queue from the URL", () => {
    const params = serializeInboxState({
      queue: "needs_reply",
      locationIds: [],
      ratings: [],
      search: "",
      sort: "updated_desc",
      verification: [],
      publishStatus: [],
      syncStatus: [],
    })
    expect(params.has("queue")).toBe(false)
  })

  it("writes queue=all when the operator leaves the default", () => {
    const params = serializeInboxState({
      queue: "all",
      locationIds: [],
      ratings: [],
      search: "",
      sort: "updated_desc",
      verification: [],
      publishStatus: [],
      syncStatus: [],
    })
    expect(params.get("queue")).toBe("all")
  })

  it("round-trips through serialize omitting defaults and empties", () => {
    const state: InboxState = {
      queue: "done",
      locationIds: ["loc-1"],
      ratings: [5],
      search: "",
      sort: "updated_desc",
      verification: [],
      publishStatus: [],
      syncStatus: [],
      selected: "rev-2",
    }
    const params = serializeInboxState(state)
    expect(params.get("queue")).toBe("done")
    expect(params.get("locationId")).toBe("loc-1")
    expect(params.get("rating")).toBe("5")
    expect(params.get("selected")).toBe("rev-2")
    expect(params.has("search")).toBe(false)
    expect(params.has("sort")).toBe(false)
    expect(params.has("verification")).toBe(false)
  })

  it("passes the queue and locations straight through to the wire filters", () => {
    const filters = toReviewsFilters(
      parseInboxState(
        new URLSearchParams("queue=awaiting_my_approval&locationId=loc-1,loc-2")
      )
    )
    expect(filters.queue).toBe("awaiting_my_approval")
    expect(filters.locationIds).toEqual(["loc-1", "loc-2"])
  })

  it("narrows loose URL lists to the contract vocabulary before the wire", () => {
    const filters = toReviewsFilters(
      parseInboxState(
        new URLSearchParams(
          "verification=pass,bogus&publishStatus=nope&syncStatus=failed,cancelled&sort=bogus&replyState=maybe"
        )
      )
    )
    expect(filters.verification).toEqual(["pass"])
    expect(filters.publishStatus).toBeUndefined()
    expect(filters.syncStatus).toEqual(["failed", "cancelled"])
    expect(filters.sort).toBe("updated_desc")
    expect(filters.replyState).toBeUndefined()
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
