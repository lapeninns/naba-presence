import { describe, expect, it } from "vitest"

import { hashFoodMenus } from "@/lib/domain/food-menus"
import {
  hashHours,
  normalizeGoogleHours,
  type NormalizedHours,
} from "@/lib/domain/hours"
import {
  hashProfileValue,
  PROFILE_FIELD_KEYS,
  type NormalizedProfile,
} from "@/lib/domain/profile"
import {
  EMPTY_HOURS_HASH,
  hoursArea,
  menuArea,
  profileArea,
  type CanonicalRow,
  type MenuStateRow,
  type ProfileFieldRow,
} from "@/lib/server/location-summary"

const hours: NormalizedHours = {
  regular: [
    {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "09:00", closesAt: "17:00" }],
    },
  ],
  special: [],
  moreHours: [],
}

function canonical(overrides: Partial<CanonicalRow>): CanonicalRow {
  return {
    locationId: "l1",
    resourceType: "hours",
    revision: 1,
    payload: hours,
    baselineCanonicalHash: null,
    baselineGoogleHash: null,
    lastReconciledAt: null,
    ...overrides,
  }
}

describe("hoursArea", () => {
  it("is unknown before anything is stored", () => {
    expect(hoursArea(undefined)).toEqual({
      status: "unknown",
      dirtyCount: 0,
      observedAt: null,
    })
  })

  it("treats the as-imported copy as unknown and any later revision as not on Google", () => {
    expect(hoursArea(canonical({ revision: 1 })).status).toBe("unknown")
    expect(hoursArea(canonical({ revision: 2 }))).toMatchObject({
      status: "core_dirty",
      dirtyCount: 1,
    })
  })

  it("preserves local dirty evidence but never calls an old publication a new check", () => {
    const pinned = hashHours(hours)
    expect(
      hoursArea(
        canonical({
          revision: 4,
          baselineCanonicalHash: pinned,
          baselineGoogleHash: pinned,
        })
      )
    ).toMatchObject({ status: "unknown", dirtyCount: 0 })
    expect(
      hoursArea(
        canonical({
          revision: 5,
          baselineCanonicalHash: "elsewhere",
          baselineGoogleHash: pinned,
        })
      )
    ).toMatchObject({ status: "core_dirty", dirtyCount: 1 })
  })
  it("classifies persisted Google drift and local edits against the sticky comparison anchor", () => {
    const baseline = hashHours(hours)
    const observation = {
      locationId: "l1",
      googleHash: "google-changed",
      comparisonCanonicalHash: baseline,
      comparisonGoogleHash: baseline,
      observedAt: new Date(),
      attemptedAt: new Date(),
      errorCode: null,
      blocked: false,
    }
    expect(hoursArea(canonical({}), observation).status).toBe("google_dirty")
    const changed = structuredClone(hours)
    changed.regular[0].periods[0].closesAt = "16:00"
    expect(
      hoursArea(canonical({ payload: changed, revision: 2 }), observation)
        .status
    ).toBe("conflict")
    expect(
      hoursArea(canonical({}), { ...observation, errorCode: "failed" })
    ).toMatchObject({
      status: "google_dirty",
      checkStatus: "failed",
      observedAt: observation.observedAt.toISOString(),
    })
  })
})

describe("EMPTY_HOURS_HASH and googleEmpty", () => {
  const observation = (googleHash: string | null) => ({
    locationId: "l1",
    googleHash,
    comparisonCanonicalHash: null,
    comparisonGoogleHash: null,
    observedAt: new Date(),
    attemptedAt: new Date(),
    errorCode: null,
    blocked: false,
  })

  it("is what every Google payload without hours hashes to", () => {
    const hashOf = (location: Parameters<typeof normalizeGoogleHours>[0]) =>
      hashHours(normalizeGoogleHours(location))
    // The server hashes `normalizeGoogleHours(googleLocation)` for every
    // observation (lib/server/hours.ts, compareHours).
    expect(hashOf({})).toBe(EMPTY_HOURS_HASH)
    expect(
      hashOf({
        regularHours: { periods: [] },
        specialHours: { specialHourPeriods: [] },
        moreHours: [],
      })
    ).toBe(EMPTY_HOURS_HASH)
    // Periods Google sends that cannot be read are no hours either.
    expect(
      hashOf({
        regularHours: {
          periods: [{ openDay: "MONDAY", openTime: null, closeTime: null }],
        },
      })
    ).toBe(EMPTY_HOURS_HASH)
    // A saved week of closed days is the same semantic value.
    expect(
      hashHours({
        regular: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          isClosed: true,
          periods: [],
        })),
        special: [],
        moreHours: [],
      })
    ).toBe(EMPTY_HOURS_HASH)
  })

  it("is not what any real hours, special hours or more-hours hash to", () => {
    const hashOf = (location: Parameters<typeof normalizeGoogleHours>[0]) =>
      hashHours(normalizeGoogleHours(location))
    expect(
      hashOf({
        regularHours: {
          periods: [
            {
              openDay: "MONDAY",
              closeDay: "MONDAY",
              openTime: { hours: 9 },
              closeTime: { hours: 17 },
            },
          ],
        },
      })
    ).not.toBe(EMPTY_HOURS_HASH)
    expect(
      hashOf({
        specialHours: {
          specialHourPeriods: [
            { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
          ],
        },
      })
    ).not.toBe(EMPTY_HOURS_HASH)
    expect(
      hashOf({ moreHours: [{ hoursTypeId: "KITCHEN", periods: [] }] })
    ).not.toBe(EMPTY_HOURS_HASH)
    expect(hashHours(hours)).not.toBe(EMPTY_HOURS_HASH)
  })

  it("flags empty Google hours, with or without a canonical row", () => {
    expect(
      hoursArea(canonical({}), observation(EMPTY_HOURS_HASH))
    ).toMatchObject({ googleEmpty: true })
    expect(
      hoursArea(undefined, observation(EMPTY_HOURS_HASH)).googleEmpty
    ).toBe(true)
  })

  it("says false for real Google hours and nothing when Google was never observed", () => {
    expect(
      hoursArea(canonical({}), observation(hashHours(hours))).googleEmpty
    ).toBe(false)
    expect(hoursArea(canonical({}), observation(null))).not.toHaveProperty(
      "googleEmpty"
    )
    expect(hoursArea(canonical({}))).not.toHaveProperty("googleEmpty")
  })
})

describe("profileArea", () => {
  const payload: NormalizedProfile = {
    name: "Riverside",
    description: "A pub",
    phone: "01234",
    address: null,
    mapsUrl: null,
    reviewUrl: null,
    website: "https://riverside.example",
  }
  const observedAt = new Date("2026-09-01T10:00:00Z")
  function field(
    key: string,
    google: string | null,
    baseline: { canonical: string | null; google: string | null }
  ): ProfileFieldRow {
    return {
      locationId: "l1",
      fieldKey: key,
      googleHash: hashProfileValue(google),
      baselineCanonicalHash:
        baseline.canonical === null
          ? null
          : hashProfileValue(baseline.canonical),
      baselineGoogleHash:
        baseline.google === null ? null : hashProfileValue(baseline.google),
      observedAt,
    }
  }

  it("is unknown without a canonical copy or any observed field", () => {
    expect(profileArea(undefined, []).status).toBe("unknown")
    expect(
      profileArea(canonical({ resourceType: "profile", payload }), []).status
    ).toBe("unknown")
  })

  it("counts fields edited here since the last publish", () => {
    const row = canonical({ resourceType: "profile", payload })
    const fields = [
      field("name", "Riverside", {
        canonical: "Riverside",
        google: "Riverside",
      }),
      field("phone", "09999", { canonical: "09999", google: "09999" }),
      field("website", "https://old.example", {
        canonical: "https://old.example",
        google: "https://old.example",
      }),
    ]
    const area = profileArea(row, fields)
    expect(area).toMatchObject({ status: "core_dirty", dirtyCount: 2 })
    expect(area.observedAt).toBe(observedAt.toISOString())
  })

  it("reports the worst field: a conflict outranks a Google-side change", () => {
    const row = canonical({ resourceType: "profile", payload })
    const fields = [
      // Google moved, we did not.
      field("name", "Riverside Inn", {
        canonical: "Riverside",
        google: "Riverside",
      }),
      // Both moved.
      field("phone", "07777", { canonical: "05555", google: "05555" }),
    ]
    expect(profileArea(row, fields).status).toBe("conflict")
  })
  it("requires every field and reports the oldest successful observation", () => {
    const row = canonical({ resourceType: "profile", payload })
    const all = PROFILE_FIELD_KEYS.map((key) =>
      field(key, payload[key], {
        canonical: payload[key],
        google: payload[key],
      })
    )
    expect(profileArea(row, all).status).toBe("in_sync")
    expect(profileArea(row, all.slice(1))).toMatchObject({
      status: "unknown",
      checkStatus: "unchecked",
    })
    all[0].observedAt = new Date("2026-08-01T00:00:00Z")
    expect(profileArea(row, all).observedAt).toBe("2026-08-01T00:00:00.000Z")
  })
})

describe("menuArea", () => {
  const menus = [{ labels: [{ displayName: "Mains" }], sections: [] }]
  const other = [{ labels: [{ displayName: "Drinks" }], sections: [] }]
  function state(overrides: Partial<MenuStateRow>): MenuStateRow {
    return {
      locationId: "l1",
      eligible: true,
      canonicalHash: hashFoodMenus(menus),
      googleHash: hashFoodMenus(menus),
      observedAt: new Date("2026-09-01T10:00:00Z"),
      ...overrides,
    }
  }

  it("is unknown until the menu has been observed", () => {
    expect(menuArea(undefined, undefined)).toMatchObject({
      status: "unknown",
      eligible: null,
    })
  })

  it("is in sync when the saved menu hashes like Google's", () => {
    expect(
      menuArea(
        canonical({ resourceType: "food_menus", payload: menus }),
        state({})
      )
    ).toMatchObject({
      status: "in_sync",
      dirtyCount: 0,
      eligible: true,
    })
  })

  it("is not on Google yet once the saved menu differs", () => {
    expect(
      menuArea(
        canonical({ resourceType: "food_menus", payload: other }),
        state({})
      )
    ).toMatchObject({
      status: "core_dirty",
      dirtyCount: 1,
    })
  })

  it("is a conflict when Google moved too since the last publish", () => {
    const row = canonical({
      resourceType: "food_menus",
      payload: other,
      baselineGoogleHash: "the-hash-google-had-when-we-last-published",
    })
    expect(menuArea(row, state({})).status).toBe("conflict")
  })
})

describe("menu summary outbound consistency", () => {
  it("counts the same field rows as review for saved edits", () => {
    const google = [
      {
        labels: [{ displayName: "Menu" }],
        sections: [
          {
            labels: [{ displayName: "Starters" }],
            items: [{ labels: [{ displayName: "Soup", description: "A" }] }],
          },
        ],
      },
    ]
    const local = [
      {
        labels: [{ displayName: "Lunch" }],
        sections: [
          {
            labels: [{ displayName: "Starters" }],
            items: [{ labels: [{ displayName: "Soup", description: "B" }] }],
          },
        ],
      },
    ]
    expect(
      menuArea(canonical({ resourceType: "food_menus", payload: local }), {
        locationId: "l1",
        eligible: true,
        canonicalHash: hashFoodMenus(google),
        googleHash: hashFoodMenus(google),
        googlePayload: google,
        observedAt: new Date("2026-09-01T10:00:00Z"),
      })
    ).toMatchObject({ status: "core_dirty", dirtyCount: 2 })
  })
  it("reports equal menus in sync even when both moved since an old publication", () => {
    const menu = [{ sections: [] }]
    expect(
      menuArea(
        canonical({
          resourceType: "food_menus",
          payload: menu,
          baselineGoogleHash: "old",
        }),
        {
          locationId: "l1",
          eligible: true,
          canonicalHash: hashFoodMenus(menu),
          googleHash: hashFoodMenus(menu),
          googlePayload: menu,
          observedAt: new Date("2026-09-01T10:00:00Z"),
        }
      )
    ).toMatchObject({ status: "in_sync", dirtyCount: 0 })
  })
})
