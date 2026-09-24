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
  it("round-trips the written-review filter and ignores unknown values", () => {
    const state = parseInboxState(new URLSearchParams("written=rating_only"))
    expect(state.written).toBe("rating_only")
    expect(hasActiveFilters(state)).toBe(true)
    expect(serializeInboxState(state).get("written")).toBe("rating_only")
    expect(toReviewsFilters(state).written).toBe("rating_only")
    expect(
      parseInboxState(new URLSearchParams("written=essay")).written
    ).toBeUndefined()
  })

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
      new URLSearchParams("clientId=c1&assignee=me")
    )
    expect(state.clientId).toBe("c1")
    expect(state.assignee).toBe("me")
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
        "queue=needs_reply&rating=4,5&search=slow&sort=rating_asc&replyState=unreplied&dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-31T00:00:00.000Z&selected=rev-1"
      )
    )
    expect(state.queue).toBe("needs_reply")
    expect(state.ratings).toEqual([4, 5])
    expect(state.search).toBe("slow")
    expect(state.sort).toBe("rating_asc")
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
      selected: "rev-2",
    }
    const params = serializeInboxState(state)
    expect(params.get("queue")).toBe("done")
    expect(params.get("locationId")).toBe("loc-1")
    expect(params.get("rating")).toBe("5")
    expect(params.get("selected")).toBe("rev-2")
    expect(params.has("search")).toBe(false)
    expect(params.has("sort")).toBe(false)
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

  it("narrows loose URL values to the contract vocabulary before the wire", () => {
    const filters = toReviewsFilters(
      parseInboxState(new URLSearchParams("sort=bogus&replyState=maybe"))
    )
    expect(filters.sort).toBe("updated_desc")
    expect(filters.replyState).toBeUndefined()
  })

  it("drops the retired pipeline-state params instead of filtering on them", () => {
    // verification / publishStatus / syncStatus filtered on a record's place in
    // the publish pipeline, not on anything an operator asks for. A stale
    // bookmark carrying them must fall back to the unfiltered queue rather
    // than silently narrow the list.
    const state = parseInboxState(
      new URLSearchParams("verification=pass&publishStatus=failed&syncStatus=failed")
    )
    expect(hasActiveFilters(state)).toBe(false)
    const filters = toReviewsFilters(state)
    expect(filters).not.toHaveProperty("verification")
    expect(filters).not.toHaveProperty("publishStatus")
    expect(filters).not.toHaveProperty("syncStatus")
  })

  // "To: 31 July" is stored as 31 July's midnight; the list used to stop
  // there and leave out the whole of the day it names.
  it("sends a day-only To date as the start of the next day", () => {
    const filters = toReviewsFilters(
      parseInboxState(
        new URLSearchParams(
          "dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-31T00:00:00.000Z"
        )
      )
    )
    expect(filters.dateFrom).toBe("2026-07-01T00:00:00.000Z")
    expect(filters.dateTo).toBe("2026-08-01T00:00:00.000Z")
  })

  it("leaves a precise To instant, and the age preset's bound, as they are", () => {
    expect(
      toReviewsFilters(
        parseInboxState(new URLSearchParams("dateTo=2026-07-31T15:30:00.000Z"))
      ).dateTo
    ).toBe("2026-07-31T15:30:00.000Z")
    const now = Date.parse("2026-07-15T00:20:00.000Z")
    expect(
      toReviewsFilters(parseInboxState(new URLSearchParams("age=over7d")), {
        now,
      }).dateTo
    ).toBe("2026-07-08T00:00:00.000Z")
  })

  it("round-trips the age preset through the URL", () => {
    const state = parseInboxState(new URLSearchParams("age=7d"))
    expect(state.age).toBe("7d")
    expect(hasActiveFilters(state)).toBe(true)
    expect(serializeInboxState(state).get("age")).toBe("7d")
  })

  it("drops an unknown age value instead of sending it to the server", () => {
    const state = parseInboxState(new URLSearchParams("age=30d"))
    expect(state.age).toBeUndefined()
    expect(serializeInboxState(state).has("age")).toBe(false)
    expect(hasActiveFilters(state)).toBe(false)
  })

  it("expands an age preset into the date range the wire filters carry", () => {
    // The preset never reaches the server: the reviews query only knows
    // dateFrom/dateTo, so `now` is injected here and quantised in ageRange.
    const filters = toReviewsFilters(
      parseInboxState(new URLSearchParams("age=24h")),
      {
        now: Date.parse("2026-07-15T14:37:12.480Z"),
      }
    )
    expect(filters.dateFrom).toBe("2026-07-14T14:00:00.000Z")
    expect(filters.dateTo).toBeUndefined()
    expect(filters).not.toHaveProperty("age")
  })

  it("lets an explicit date range win over an age preset carried alongside it", () => {
    // A hand-edited link or a bookmark from before the two controls learned to
    // clear each other can carry both. Dates are the more specific claim, and
    // silently widening someone's explicit range is the worse failure.
    const filters = toReviewsFilters(
      parseInboxState(
        new URLSearchParams(
          "age=24h&dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-31T00:00:00.000Z"
        )
      ),
      { now: Date.parse("2026-07-15T14:37:12.480Z") }
    )
    expect(filters.dateFrom).toBe("2026-07-01T00:00:00.000Z")
    // The whole of 31 July: the To day is sent as the next day's start.
    expect(filters.dateTo).toBe("2026-08-01T00:00:00.000Z")
  })

  it("lets a single explicit bound win, without half-expanding the preset", () => {
    // Only one bound is set, so the other must stay open rather than being
    // filled in from the preset — a mix of the two is a range nobody chose.
    const filters = toReviewsFilters(
      parseInboxState(
        new URLSearchParams("age=over7d&dateFrom=2026-07-01T00:00:00.000Z")
      ),
      { now: Date.parse("2026-07-15T14:37:12.480Z") }
    )
    expect(filters.dateFrom).toBe("2026-07-01T00:00:00.000Z")
    expect(filters.dateTo).toBeUndefined()
  })

  it("shows the detail pane on mobile only when a review is selected", () => {
    expect(mobilePaneFor(undefined)).toBe("list")
    expect(mobilePaneFor("rev-1")).toBe("detail")
  })

  it("auto-selects the first row only on desktop, unselected, and clean", () => {
    const reviews = [{ id: "a" }, { id: "b" }]
    expect(
      autoSelectId({
        selected: undefined,
        reviews,
        isDirty: false,
        isDesktop: true,
      })
    ).toBe("a")
    // Already selected -> no auto-select.
    expect(
      autoSelectId({ selected: "b", reviews, isDirty: false, isDesktop: true })
    ).toBeNull()
    // Dirty composer -> never steal the selection.
    expect(
      autoSelectId({
        selected: undefined,
        reviews,
        isDirty: true,
        isDesktop: true,
      })
    ).toBeNull()
    // Mobile -> the list is shown first; no auto-select.
    expect(
      autoSelectId({
        selected: undefined,
        reviews,
        isDirty: false,
        isDesktop: false,
      })
    ).toBeNull()
    // Empty list -> nothing to select.
    expect(
      autoSelectId({
        selected: undefined,
        reviews: [],
        isDirty: false,
        isDesktop: true,
      })
    ).toBeNull()
  })
})
