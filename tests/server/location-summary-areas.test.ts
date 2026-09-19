import { describe, expect, it } from "vitest"

import { hashFoodMenus } from "@/lib/domain/food-menus"
import { hashHours, type NormalizedHours } from "@/lib/domain/hours"
import { hashProfileValue, type NormalizedProfile } from "@/lib/domain/profile"
import {
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

  it("compares against the baseline the last publish pinned", () => {
    const pinned = hashHours(hours)
    expect(
      hoursArea(
        canonical({
          revision: 4,
          baselineCanonicalHash: pinned,
          baselineGoogleHash: pinned,
        })
      )
    ).toMatchObject({ status: "in_sync", dirtyCount: 0 })
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
