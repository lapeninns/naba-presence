import { describe, expect, it } from "vitest"
import { hoursChangeRows } from "@/lib/locations/hours-diff"
import { emptyHours } from "@/lib/locations/forms/hours"
import { hashHours } from "@/lib/domain/hours"
import {
  formatSpecialDate,
  hoursPublishParts,
  hoursSelectionRequest,
  markHoursConflicts,
} from "@/lib/editors/hours-presentation"

describe("complete hours replacement preview", () => {
  it("ignores closed-day end dates in both the preview and comparison hash", () => {
    const google = emptyHours()
    google.special = [{ effectiveDate: "2026-12-24", endDate: "2026-12-26", isClosed: true, opensAt: null, closesAt: null }]
    const draft = structuredClone(google)
    draft.special[0].endDate = "2026-12-25"
    expect(hoursChangeRows({ google, draft, canonical: google })).toEqual([])
    expect(hashHours(draft)).toBe(hashHours(google))
  })
  it("shows exact service times for a service-only edit", () => {
    const google = emptyHours()
    google.moreHours = [
      {
        hoursTypeId: "BAR",
        periods: [
          {
            dayOfWeek: 0,
            closeDayOfWeek: 1,
            opensAt: "18:00",
            closesAt: "02:00",
          },
        ],
      },
    ]
    const draft = structuredClone(google)
    draft.moreHours[0].periods[0].closesAt = "03:00"
    const rows = hoursChangeRows({ google, draft, canonical: google })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      field: "BAR · Sunday",
      before: "6:00 pm – 2:00 am (Monday)",
      after: "6:00 pm – 3:00 am (Monday)",
    })
  })

  it("shows boundary-only changes and never describes 24:00 as noon", () => {
    const google = emptyHours()
    google.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "00:00", closesAt: "24:00", closeDayOfWeek: 1 }],
    }
    const draft = structuredClone(google)
    draft.regular[1].periods[0].closeDayOfWeek = 2
    const rows = hoursChangeRows({ google, draft, canonical: google })
    expect(rows).toHaveLength(1)
    expect(rows[0].before).toContain("midnight (end of day)")
    expect(rows[0].after).toContain("Tuesday")
  })

  it("shows all same-date special periods even when their count is unchanged", () => {
    const google = emptyHours()
    google.special = [
      {
        effectiveDate: "2026-12-31",
        endDate: "2026-12-31",
        isClosed: false,
        opensAt: "12:00",
        closesAt: "15:00",
      },
      {
        effectiveDate: "2026-12-31",
        endDate: "2027-01-01",
        isClosed: false,
        opensAt: "18:00",
        closesAt: "02:00",
      },
    ]
    const draft = structuredClone(google)
    draft.special[1].closesAt = "03:00"
    const rows = hoursChangeRows({ google, draft, canonical: google })
    expect(rows).toHaveLength(1)
    expect(rows[0].before).toContain("12:00 pm – 3:00 pm")
    expect(rows[0].before).toContain("2:00 am (2027-01-01)")
    expect(rows[0].after).toContain("3:00 am (2027-01-01)")
  })

  it("compares equivalent legacy same-day boundaries equally", () => {
    const google = emptyHours()
    google.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "11:00", closesAt: "23:00", closeDayOfWeek: 1 }],
    }
    const draft = structuredClone(google)
    delete draft.regular[1].periods[0].closeDayOfWeek
    expect(hoursChangeRows({ google, draft, canonical: google })).toEqual([])
  })
})

describe("hours publish parts", () => {
  function changed() {
    const google = emptyHours()
    google.moreHours = [
      {
        hoursTypeId: "BAR",
        periods: [{ dayOfWeek: 5, opensAt: "18:00", closesAt: "23:00" }],
      },
    ]
    const draft = structuredClone(google)
    draft.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "09:00", closesAt: "17:00" }],
    }
    draft.special = [
      {
        effectiveDate: "2026-12-25",
        isClosed: true,
        opensAt: null,
        closesAt: null,
      },
    ]
    draft.moreHours[0].periods.push({
      dayOfWeek: 6,
      opensAt: "18:00",
      closesAt: "23:00",
    })
    return { google, draft }
  }

  it("tags each row with the day, date or service it publishes", () => {
    const { google, draft } = changed()
    const rows = hoursChangeRows({ google, draft, canonical: google })
    expect(rows.map((row) => [row.key, row.part])).toEqual([
      ["regular-1", "regular:1"],
      ["special-2026-12-25", "special:2026-12-25"],
      ["service-BAR-6", "more:BAR"],
    ])
    expect(
      hoursPublishParts(rows, [{ hoursTypeId: "BAR", displayName: "Bar" }])
    ).toEqual([
      { key: "regular:1", label: "Monday", rowCount: 1 },
      {
        key: "special:2026-12-25",
        label: `Special hours · ${formatSpecialDate("2026-12-25")}`,
        rowCount: 1,
      },
      { key: "more:BAR", label: "Bar schedule", rowCount: 1 },
    ])
  })

  it("marks only parts Google changed as overwrites when per-part drift is known", () => {
    const { google, draft } = changed()
    const rows = hoursChangeRows({ google, draft, canonical: google })
    expect(
      markHoursConflicts(rows, {
        status: "conflict",
        partStatus: { "more:BAR": "google_dirty", "regular:1": "core_dirty" },
      }).map((row) => row.state)
    ).toEqual(["changed", "changed", "conflict"])
    expect(
      markHoursConflicts(rows, { status: "google_dirty" }).map(
        (row) => row.state
      )
    ).toEqual(["conflict", "conflict", "conflict"])
  })

  it("pins each chosen part to the Google part hash it was read with", () => {
    expect(hoursSelectionRequest({}, ["regular:1"])).toBeNull()
    expect(
      hoursSelectionRequest({ googlePartHashes: { "regular:1": "h1" } }, [])
    ).toBeNull()
    expect(
      hoursSelectionRequest({ googlePartHashes: { "regular:1": "h1" } }, [
        "special:2026-12-25",
        "regular:1",
      ])
    ).toEqual({
      approvedUpdateMask: ["regularHours", "specialHours"],
      selection: {
        regularDays: [1],
        specialDates: ["2026-12-25"],
        expectedGoogleParts: { "regular:1": "h1", "special:2026-12-25": null },
      },
    })
  })
})
