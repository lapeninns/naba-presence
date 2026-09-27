import { describe, expect, it } from "vitest"
import { hoursChangeRows } from "@/lib/locations/hours-diff"
import { emptyHours } from "@/lib/locations/forms/hours"

describe("complete hours replacement preview", () => {
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
