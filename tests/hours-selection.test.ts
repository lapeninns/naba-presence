import { describe, expect, it } from "vitest"

import { hoursSelectionSchema } from "@/lib/contracts/location-hours"
import {
  buildGoogleHoursPatch,
  changedHoursPartKeys,
  classifyHoursDrift,
  classifyHoursPartDrift,
  hoursPartHashes,
  hoursSelectionFromKeys,
  hoursSelectionKeys,
  hoursSelectionMask,
  normalizeGoogleHours,
  selectedHoursMatch,
  unselectedHoursUnchanged,
  type GoogleLocationHours,
  type NormalizedHours,
} from "@/lib/domain/hours"
import { nextComparisonParts } from "@/lib/server/hours-observations"

// Live Google: open Mon-Fri 09-17 and Sat 10-14 (overnight Sat bar into
// Sunday), Christmas closed, New Year's Eve late, a kitchen and a bar.
const live: GoogleLocationHours = {
  regularHours: {
    periods: [1, 2, 3, 4, 5]
      .map((day) => ({
        openDay: [
          "SUNDAY",
          "MONDAY",
          "TUESDAY",
          "WEDNESDAY",
          "THURSDAY",
          "FRIDAY",
        ][day],
        closeDay: [
          "SUNDAY",
          "MONDAY",
          "TUESDAY",
          "WEDNESDAY",
          "THURSDAY",
          "FRIDAY",
        ][day],
        openTime: { hours: 9 },
        closeTime: { hours: 17 },
      }))
      .concat([
        {
          openDay: "SATURDAY",
          closeDay: "SATURDAY",
          openTime: { hours: 10 },
          closeTime: { hours: 14 },
        },
      ]),
  },
  specialHours: {
    specialHourPeriods: [
      {
        startDate: { year: 2026, month: 12, day: 25 },
        endDate: { year: 2026, month: 12, day: 25 },
        closed: true,
      },
      {
        startDate: { year: 2026, month: 12, day: 31 },
        endDate: { year: 2027, month: 1, day: 1 },
        openTime: { hours: 18 },
        closeTime: { hours: 2 },
        closed: false,
      },
    ],
  },
  moreHours: [
    {
      hoursTypeId: "BAR",
      periods: [
        {
          openDay: "SATURDAY",
          closeDay: "SUNDAY",
          openTime: { hours: 18 },
          closeTime: { hours: 1 },
        },
      ],
    },
    {
      hoursTypeId: "KITCHEN",
      periods: [
        {
          openDay: "MONDAY",
          closeDay: "MONDAY",
          openTime: { hours: 12 },
          closeTime: { hours: 15 },
        },
      ],
    },
  ],
  categories: {
    primaryCategory: {
      moreHoursTypes: [
        { hoursTypeId: "BAR" },
        { hoursTypeId: "KITCHEN" },
        { hoursTypeId: "BRUNCH" },
      ],
    },
  },
}

const google = normalizeGoogleHours(live)

/** The saved schedule: every part edited, so only the selection decides. */
function edited(): NormalizedHours {
  const hours = structuredClone(google)
  for (const day of hours.regular) {
    day.isClosed = false
    day.periods = [
      { opensAt: "07:00", closesAt: "23:00", closeDayOfWeek: day.dayOfWeek },
    ]
  }
  hours.special = [
    // Christmas now open briefly; New Year's Eve removed; Boxing Day added.
    {
      effectiveDate: "2026-12-25",
      endDate: "2026-12-25",
      isClosed: false,
      opensAt: "12:00",
      closesAt: "15:00",
    },
    {
      effectiveDate: "2026-12-26",
      endDate: "2026-12-26",
      isClosed: true,
      opensAt: null,
      closesAt: null,
    },
  ]
  hours.moreHours = [
    {
      hoursTypeId: "BRUNCH",
      periods: [
        {
          dayOfWeek: 0,
          closeDayOfWeek: 0,
          opensAt: "10:00",
          closesAt: "13:00",
        },
      ],
    },
    {
      hoursTypeId: "KITCHEN",
      periods: [
        {
          dayOfWeek: 1,
          closeDayOfWeek: 1,
          opensAt: "11:00",
          closesAt: "21:00",
        },
      ],
    },
  ]
  return hours
}

/** The Google schedule a PATCH would leave, given the live one. */
function applyPatch(patch: { payload: Record<string, unknown> }) {
  return normalizeGoogleHours({
    ...live,
    ...(patch.payload as GoogleLocationHours),
  })
}

describe("selective hours publication", () => {
  it("publishes selected weekdays and leaves every other day byte-identical to live", () => {
    const canonical = edited()
    const patch = buildGoogleHoursPatch({
      canonical,
      googleLocation: live,
      selection: { regularDays: [1, 3] },
    })
    expect(patch.blockingIssues).toEqual([])
    expect(patch.updateMask).toEqual(["regularHours"])
    expect(Object.keys(patch.payload)).toEqual(["regularHours"])
    const after = applyPatch(patch)
    for (const day of [0, 2, 4, 5, 6])
      expect(after.regular[day]).toEqual(google.regular[day])
    expect(after.regular[1]).toEqual(canonical.regular[1])
    expect(after.regular[3]).toEqual(canonical.regular[3])
    expect(after.special).toEqual(google.special)
    expect(after.moreHours).toEqual(google.moreHours)
    // Live periods of unselected days go back with the same values.
    const sent = (patch.payload.regularHours as { periods: unknown[] }).periods
    expect(sent).toContainEqual({
      openDay: "SATURDAY",
      closeDay: "SATURDAY",
      openTime: { hours: 10, minutes: 0 },
      closeTime: { hours: 14, minutes: 0 },
    })
  })

  it("requires all seven saved days for a whole-week replacement", () => {
    const canonical = edited()
    const all = [0, 1, 2, 3, 4, 5, 6]
    expect(
      buildGoogleHoursPatch({
        canonical,
        googleLocation: live,
        selection: { regularDays: all },
      }).blockingIssues
    ).toEqual([])
    const sixDays = { ...canonical, regular: canonical.regular.slice(0, 6) }
    const missing = buildGoogleHoursPatch({
      canonical: sixDays,
      googleLocation: live,
      selection: { regularDays: all },
    })
    expect(missing.blockingIssues).toEqual([
      "Saturday must appear exactly once in the saved schedule before it can be published.",
    ])
    // Days that are not selected need not be in the saved schedule.
    expect(
      buildGoogleHoursPatch({
        canonical: sixDays,
        googleLocation: live,
        selection: { regularDays: [1] },
      }).blockingIssues
    ).toEqual([])
  })

  it("upserts and removes special dates without touching the others", () => {
    const canonical = edited()
    const upsert = buildGoogleHoursPatch({
      canonical,
      googleLocation: live,
      selection: { specialDates: ["2026-12-25", "2026-12-26"] },
    })
    expect(upsert.updateMask).toEqual(["specialHours"])
    let after = applyPatch(upsert)
    expect(after.special.map((entry) => entry.effectiveDate)).toEqual([
      "2026-12-25",
      "2026-12-26",
      "2026-12-31",
    ])
    expect(after.special[0]).toMatchObject({
      opensAt: "12:00",
      isClosed: false,
    })
    expect(after.special[2]).toEqual(google.special[1])
    expect(after.regular).toEqual(google.regular)
    expect(after.moreHours).toEqual(google.moreHours)

    // New Year's Eve is gone from the saved schedule: selecting it removes it.
    const removal = buildGoogleHoursPatch({
      canonical,
      googleLocation: live,
      selection: { specialDates: ["2026-12-31"] },
    })
    after = applyPatch(removal)
    expect(after.special).toEqual([google.special[0]])
  })

  it("blocks an upserted date that overlaps an unselected Google period", () => {
    const canonical = edited()
    canonical.special.push({
      effectiveDate: "2027-01-01",
      endDate: "2027-01-01",
      isClosed: true,
      opensAt: null,
      closesAt: null,
    })
    const patch = buildGoogleHoursPatch({
      canonical,
      googleLocation: live,
      selection: { specialDates: ["2027-01-01"] },
    })
    expect(patch.blockingIssues).toEqual([
      "Special hours for 2027-01-01 overlap Google’s 2026-12-31 entry, which is not selected. Select both dates to publish them together.",
    ])
  })

  it("publishes selected service types: upsert, create when advertised, remove", () => {
    const canonical = edited()
    const patch = buildGoogleHoursPatch({
      canonical,
      googleLocation: live,
      selection: { moreHoursTypes: ["BAR", "BRUNCH", "KITCHEN"] },
    })
    expect(patch.blockingIssues).toEqual([])
    expect(patch.updateMask).toEqual(["moreHours"])
    const after = applyPatch(patch)
    expect(after.moreHours.map((entry) => entry.hoursTypeId)).toEqual([
      "BRUNCH",
      "KITCHEN",
    ])
    expect(after.regular).toEqual(google.regular)
    expect(after.special).toEqual(google.special)

    const kitchenOnly = applyPatch(
      buildGoogleHoursPatch({
        canonical,
        googleLocation: live,
        selection: { moreHoursTypes: ["KITCHEN"] },
      })
    )
    expect(kitchenOnly.moreHours[0]).toEqual(google.moreHours[0])
    expect(kitchenOnly.moreHours[1]).toEqual(canonical.moreHours[1])

    const unadvertised = edited()
    unadvertised.moreHours[0].hoursTypeId = "SECRET"
    expect(
      buildGoogleHoursPatch({
        canonical: unadvertised,
        googleLocation: live,
        selection: { moreHoursTypes: ["SECRET"] },
      }).blockingIssues
    ).toEqual([
      "Google does not advertise SECRET for this location. Existing schedules are preserved, but unsupported services cannot be created.",
    ])
  })

  it("keeps the whole-schedule patch when no selection is given", () => {
    const canonical = edited()
    const patch = buildGoogleHoursPatch({ canonical, googleLocation: live })
    expect(patch.updateMask).toEqual([
      "regularHours",
      "specialHours",
      "moreHours",
    ])
    expect(patch.intended).toBe(canonical)
  })

  it("verifies the selected parts and that unselected siblings did not change", () => {
    const canonical = edited()
    const selection = { regularDays: [1], specialDates: ["2026-12-26"] }
    const patch = buildGoogleHoursPatch({
      canonical,
      googleLocation: live,
      selection,
    })
    const readback = applyPatch(patch)
    expect(
      selectedHoursMatch({ readback, intended: patch.intended, selection })
    ).toBe(true)
    expect(
      unselectedHoursUnchanged({ readback, before: google, selection })
    ).toBe(true)

    const drifted = structuredClone(readback)
    drifted.regular[2].periods[0].opensAt = "08:00"
    expect(
      selectedHoursMatch({
        readback: drifted,
        intended: patch.intended,
        selection,
      })
    ).toBe(true)
    expect(
      unselectedHoursUnchanged({ readback: drifted, before: google, selection })
    ).toBe(false)

    const missed = structuredClone(readback)
    missed.special = missed.special.filter(
      (entry) => entry.effectiveDate !== "2026-12-26"
    )
    expect(
      selectedHoursMatch({
        readback: missed,
        intended: patch.intended,
        selection,
      })
    ).toBe(false)
  })

  it("round-trips selections through part keys and masks", () => {
    const selection = hoursSelectionFromKeys([
      "special:2026-12-25",
      "regular:3",
      "more:KITCHEN",
      "regular:1",
      "bogus",
    ])
    expect(selection).toEqual({
      regularDays: [1, 3],
      specialDates: ["2026-12-25"],
      moreHoursTypes: ["KITCHEN"],
    })
    expect(hoursSelectionKeys(selection)).toEqual([
      "more:KITCHEN",
      "regular:1",
      "regular:3",
      "special:2026-12-25",
    ])
    expect(
      hoursSelectionMask({ moreHoursTypes: ["BAR"], regularDays: [0] })
    ).toEqual(["regularHours", "moreHours"])
    expect(changedHoursPartKeys(google, edited())).toEqual([
      "more:BAR",
      "more:BRUNCH",
      "more:KITCHEN",
      "regular:0",
      "regular:1",
      "regular:2",
      "regular:3",
      "regular:4",
      "regular:5",
      "regular:6",
      "special:2026-12-25",
      "special:2026-12-26",
      "special:2026-12-31",
    ])
  })

  it("validates the wire selection: unique parts, at least one, pinned exactly", () => {
    const hash = "a".repeat(64)
    expect(
      hoursSelectionSchema.safeParse({
        regularDays: [1],
        specialDates: ["2026-12-25"],
        expectedGoogleParts: { "regular:1": hash, "special:2026-12-25": null },
      }).success
    ).toBe(true)
    expect(
      hoursSelectionSchema.safeParse({
        regularDays: [1, 1],
        expectedGoogleParts: { "regular:1": hash },
      }).success
    ).toBe(false)
    expect(
      hoursSelectionSchema.safeParse({ expectedGoogleParts: {} }).success
    ).toBe(false)
    expect(
      hoursSelectionSchema.safeParse({
        regularDays: [1],
        expectedGoogleParts: {},
      }).success
    ).toBe(false)
    expect(
      hoursSelectionSchema.safeParse({
        regularDays: [1],
        expectedGoogleParts: { "regular:1": hash, "regular:2": hash },
      }).success
    ).toBe(false)
  })
})

describe("per-part drift after a selective publish", () => {
  const canonical = edited()
  const before = hoursPartHashes(google)

  it("classifies unpublished parts as local, Google edits as Google, and both as conflict", () => {
    // Baseline: everything matched (canonical == Google), then the operator
    // edited the schedule and published only Christmas.
    const matched = nextComparisonParts({
      previous: null,
      canonicalParts: before,
      googleParts: before,
      blocked: false,
    })
    expect(matched?.complete).toBe(true)
    const selection = { specialDates: ["2026-12-25"] }
    const readback = applyPatch(
      buildGoogleHoursPatch({ canonical, googleLocation: live, selection })
    )
    const canonicalParts = hoursPartHashes(canonical)
    const afterPublish = nextComparisonParts({
      previous: matched,
      canonicalParts,
      googleParts: hoursPartHashes(readback),
      blocked: false,
      establish: { keys: hoursSelectionKeys(selection) },
    })
    const parts = classifyHoursPartDrift({
      canonicalParts,
      googleParts: hoursPartHashes(readback),
      baseline: afterPublish,
    })
    expect(parts?.["special:2026-12-25"]).toBeUndefined()
    expect(new Set(Object.values(parts ?? {}))).toEqual(new Set(["core_dirty"]))
    expect(
      classifyHoursDrift({
        canonicalHash: "c",
        googleHash: "g",
        baselineCanonicalHash: "old",
        baselineGoogleHash: "older",
        parts,
      })
    ).toBe("core_dirty")

    // Google then edits Tuesday (unpublished locally too) and Wednesday is
    // only edited on Google after the baseline: conflict vs Google change.
    const googleLater = structuredClone(readback)
    googleLater.regular[2].periods[0].opensAt = "08:30"
    const canonicalLater = structuredClone(canonical)
    canonicalLater.regular[3] = structuredClone(google.regular[3])
    googleLater.regular[3].periods[0].opensAt = "08:00"
    const later = classifyHoursPartDrift({
      canonicalParts: hoursPartHashes(canonicalLater),
      googleParts: hoursPartHashes(googleLater),
      baseline: afterPublish,
    })
    expect(later?.["regular:2"]).toBe("conflict")
    expect(later?.["regular:3"]).toBe("google_dirty")
    expect(later?.["regular:1"]).toBe("core_dirty")
  })

  it("has no part baseline until a match or a publish establishes one", () => {
    const canonicalParts = hoursPartHashes(canonical)
    expect(
      nextComparisonParts({
        previous: null,
        canonicalParts,
        googleParts: before,
        blocked: false,
      })
    ).toBeNull()
    const partial = nextComparisonParts({
      previous: null,
      canonicalParts,
      googleParts: before,
      blocked: false,
      establish: { keys: ["regular:1"] },
    })
    expect(partial?.complete).toBe(false)
    // Unknown parts of an incomplete baseline stay local, never Google.
    const parts = classifyHoursPartDrift({
      canonicalParts,
      googleParts: before,
      baseline: partial,
    })
    expect(parts?.["regular:2"]).toBe("core_dirty")
    expect(
      classifyHoursPartDrift({
        canonicalParts,
        googleParts: before,
        baseline: null,
      })
    ).toBeNull()
  })

  it("does not advance part baselines from a blocked comparison", () => {
    const previous = nextComparisonParts({
      previous: null,
      canonicalParts: before,
      googleParts: before,
      blocked: false,
    })
    const googleChanged = structuredClone(google)
    googleChanged.regular[1].periods[0].opensAt = "06:00"
    const canonicalChanged = structuredClone(googleChanged)
    canonicalChanged.regular[2].periods[0].opensAt = "06:00"
    const next = nextComparisonParts({
      previous,
      canonicalParts: hoursPartHashes(canonicalChanged),
      googleParts: hoursPartHashes(googleChanged),
      blocked: true,
    })
    expect(next).toEqual(previous)
  })
})
