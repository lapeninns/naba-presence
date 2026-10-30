import { describe, expect, it } from "vitest"

import {
  applyCompletenessSkips,
  compareMostToFix,
  COMPLETENESS_CHECK_IDS,
  COMPLETENESS_CONFIG,
  COMPLETENESS_STATUSES,
  type CompletenessCheck,
  type CompletenessCheckId,
  type CompletenessImportance,
  type CompletenessInput,
  type CompletenessStatus,
  evaluateCompleteness,
  failingChecks,
  IMPORTANCE_WEIGHT,
  listingCompleteness,
  scoreCompleteness,
} from "@/lib/listings/completeness"

const NOW = new Date("2026-11-15T12:00:00Z")
const LOC = "loc-1"
/** Five days before NOW. */
const FRESH = "2026-11-10T09:00:00Z"
/** 45 days before NOW: older than snapshotMaxAgeDays (30). */
const STALE = "2026-10-01T09:00:00Z"

const DESCRIPTION =
  "The Bell at Langham is a family-run village pub on the edge of the Norfolk coast, serving seasonal British cooking, local ales and a proper Sunday roast. Dogs are welcome in the bar, the walled garden catches the afternoon sun, and open fires make winter evenings cosy. Book ahead for weekend lunches and summer evenings."

const SIBLING_DESCRIPTION =
  "A lively market-town inn with twelve bedrooms, a sports bar showing live football, quiz nights every Tuesday and a function room for parties of up to eighty guests. Breakfast is served daily from seven until ten."

type ProfileValue = NonNullable<CompletenessInput["profile"]>["value"]
type HoursValue = NonNullable<CompletenessInput["hours"]>["value"]
type DetailsValue = NonNullable<CompletenessInput["details"]>["value"]
type MenuValue = NonNullable<CompletenessInput["menu"]>["value"]

const PROFILE: ProfileValue = {
  primaryCategory: "Pub",
  additionalCategories: 2,
  phone: "+44 1328 830000",
  website: "https://www.thebelllangham.co.uk/?utm_source=gbp",
  description: DESCRIPTION,
}
const HOURS: HoursValue = {
  regularPeriods: 7,
  specialPeriods: [{ start: "2026-12-24", end: "2026-12-26" }],
}
const DETAILS: DetailsValue = { attributes: 12, serviceItems: 0 }
const MENU: MenuValue = { eligible: true, items: 30 }

function profile(
  value: Partial<ProfileValue> = {},
  observedAt = FRESH
): CompletenessInput["profile"] {
  return { value: { ...PROFILE, ...value }, observedAt }
}
function hours(
  value: Partial<HoursValue> = {},
  observedAt = FRESH
): CompletenessInput["hours"] {
  return { value: { ...HOURS, ...value }, observedAt }
}
function details(
  value: Partial<DetailsValue> = {},
  observedAt = FRESH
): CompletenessInput["details"] {
  return { value: { ...DETAILS, ...value }, observedAt }
}
function menu(
  value: Partial<MenuValue> = {},
  observedAt = FRESH
): CompletenessInput["menu"] {
  return { value: { ...MENU, ...value }, observedAt }
}

function fullInput(
  overrides: Partial<CompletenessInput> = {}
): CompletenessInput {
  return {
    locationId: LOC,
    linked: true,
    verified: true,
    profile: profile(),
    hours: hours(),
    details: details(),
    menu: menu(),
    posts: { lastPublishedAt: "2026-11-01T10:00:00Z", observedAt: FRESH },
    photos: {
      newestAt: "2026-10-20T10:00:00Z",
      cover: true,
      logo: true,
      observedAt: FRESH,
    },
    booking: { booking: 1, other: 0, observedAt: FRESH },
    reviews: {
      checkedAt: FRESH,
      overdueUnreplied: 0,
      recent: { count: 10, average: 4.5 },
      previous: { count: 10, average: 4.4 },
    },
    siblings: [
      {
        locationId: "loc-2",
        name: "The Crown at Wells",
        description: SIBLING_DESCRIPTION,
      },
    ],
    ...overrides,
  }
}

function check(
  input: CompletenessInput,
  id: CompletenessCheckId,
  now: Date = NOW
): CompletenessCheck {
  const found = evaluateCompleteness(input, now).find((c) => c.id === id)
  if (!found) throw new Error(`no ${id} check`)
  return found
}

function href(c: CompletenessCheck): string | undefined {
  return c.fix?.href
}

const PROFILE_HREF = `/listings/${LOC}/profile`
const HOURS_HREF = `/listings/${LOC}/hours`
const POSTS_HREF = `/listings/${LOC}/posts`
const PHOTOS_HREF = `/listings/${LOC}/photos`
const BOOKING_HREF = `/listings/${LOC}/booking`
const MENU_HREF = `/listings/${LOC}/menu`
const VERIFICATION_HREF = `/listings/${LOC}/verification`
const INBOX_HREF = `/inbox?locationId=${LOC}`

const NECESSARY: CompletenessCheckId[] = [
  "primary_category",
  "regular_hours",
  "phone",
  "website",
  "verification",
  "description",
]
const IMPORTANT: CompletenessCheckId[] = [
  "special_hours",
  "recent_post",
  "recent_photo",
  "cover_photo",
  "logo_photo",
  "unreplied_reviews",
  "booking_link",
  "services_or_menu",
]
const NICE: CompletenessCheckId[] = [
  "description_quality",
  "additional_categories",
  "attributes",
  "website_utm",
  "rating_trend",
]

function mk(
  id: CompletenessCheckId,
  importance: CompletenessImportance,
  status: CompletenessStatus
): CompletenessCheck {
  return {
    id,
    title: id,
    importance,
    status,
    detail: "",
    fix:
      status === "fail" || status === "unknown"
        ? { label: "Fix", href: "/x" }
        : null,
  }
}

describe("constants", () => {
  it("weights necessary 3, important 2, nice 1", () => {
    expect(IMPORTANCE_WEIGHT).toEqual({ necessary: 3, important: 2, nice: 1 })
  })

  it("lists 19 checks and the five statuses", () => {
    expect(COMPLETENESS_CHECK_IDS).toHaveLength(19)
    expect([...COMPLETENESS_CHECK_IDS]).toEqual([
      ...NECESSARY,
      ...IMPORTANT,
      ...NICE,
    ])
    expect([...COMPLETENESS_STATUSES]).toEqual([
      "fail",
      "unknown",
      "pass",
      "not_applicable",
      "skipped",
    ])
  })

  it("carries the agreed thresholds", () => {
    expect(COMPLETENESS_CONFIG.snapshotMaxAgeDays).toBe(30)
    expect(COMPLETENESS_CONFIG.specialHoursLookaheadDays).toBe(45)
    expect(COMPLETENESS_CONFIG.recentPostDays).toBe(30)
    expect(COMPLETENESS_CONFIG.recentPhotoDays).toBe(90)
    expect(COMPLETENESS_CONFIG.siblingDescriptionSimilarity).toBe(0.9)
    expect(COMPLETENESS_CONFIG.ratingTrendMaxDrop).toBe(0.3)
  })
})

describe("evaluateCompleteness", () => {
  it("returns one check per id, in order", () => {
    const checks = evaluateCompleteness(fullInput(), NOW)
    expect(checks.map((c) => c.id)).toEqual([...COMPLETENESS_CHECK_IDS])
  })

  it("assigns importance by group", () => {
    const checks = evaluateCompleteness(fullInput(), NOW)
    const byId = new Map(checks.map((c) => [c.id, c.importance]))
    for (const id of NECESSARY) expect(byId.get(id)).toBe("necessary")
    for (const id of IMPORTANT) expect(byId.get(id)).toBe("important")
    for (const id of NICE) expect(byId.get(id)).toBe("nice")
  })

  it("passes every check for a complete, fresh listing, with no fix", () => {
    const checks = evaluateCompleteness(fullInput(), NOW)
    for (const c of checks) {
      expect({ id: c.id, status: c.status }).toEqual({
        id: c.id,
        status: "pass",
      })
      expect(c.fix).toBeNull()
      expect(c.title.length).toBeGreaterThan(0)
      expect(typeof c.detail).toBe("string")
    }
  })

  it("never returns skipped", () => {
    const inputs = [
      fullInput(),
      fullInput({ linked: false }),
      fullInput({ profile: null, hours: null, details: null, menu: null }),
    ]
    for (const input of inputs) {
      for (const c of evaluateCompleteness(input, NOW)) {
        expect(c.status).not.toBe("skipped")
        expect(c.skip).toBeUndefined()
      }
    }
  })

  it("puts a fix on every fail and unknown and none on pass or not_applicable", () => {
    const input = fullInput({
      profile: profile({ phone: null, website: null }),
      hours: null,
      verified: false,
      posts: { lastPublishedAt: null, observedAt: null },
    })
    for (const c of evaluateCompleteness(input, NOW)) {
      if (c.status === "fail" || c.status === "unknown") {
        expect(c.fix, c.id).not.toBeNull()
        expect(c.fix?.href.length, c.id).toBeGreaterThan(0)
        expect(c.fix?.label.length, c.id).toBeGreaterThan(0)
      } else {
        expect(c.fix, c.id).toBeNull()
      }
    }
  })
})

describe("not linked", () => {
  it("marks every check unknown with no fix", () => {
    const checks = evaluateCompleteness(fullInput({ linked: false }), NOW)
    expect(checks.map((c) => c.id)).toEqual([...COMPLETENESS_CHECK_IDS])
    for (const c of checks) {
      expect(c.status).toBe("unknown")
      expect(c.fix).toBeNull()
    }
  })

  it("has a null score and no fix points", () => {
    const result = listingCompleteness(fullInput({ linked: false }), [], NOW)
    expect(result.score).toBeNull()
    expect(result.fixPoints).toBe(0)
    expect(result.counts).toEqual({
      fail: 0,
      unknown: 19,
      pass: 0,
      not_applicable: 0,
      skipped: 0,
    })
  })
})

describe("snapshot freshness", () => {
  it("treats a read exactly 30 days old as fresh", () => {
    const input = fullInput({
      profile: profile({ phone: null }, "2026-10-16T12:00:00Z"),
    })
    expect(check(input, "phone").status).toBe("fail")
  })

  it("treats a read just over 30 days old as stale", () => {
    const input = fullInput({
      profile: profile({ phone: null }, "2026-10-16T11:59:00Z"),
    })
    expect(check(input, "phone").status).toBe("unknown")
  })
})

describe.each([
  ["primary_category", { primaryCategory: null }, { primaryCategory: "   " }],
  ["phone", { phone: null }, { phone: "  " }],
  ["website", { website: null }, { website: "" }],
  ["description", { description: null }, { description: " \n " }],
] as const)("%s", (id, missing, blank) => {
  it("passes when present", () => {
    expect(check(fullInput(), id).status).toBe("pass")
  })

  it("fails when missing or blank, pointing at the profile", () => {
    for (const value of [missing, blank]) {
      const c = check(fullInput({ profile: profile(value) }), id)
      expect(c.status).toBe("fail")
      expect(href(c)).toBe(PROFILE_HREF)
    }
  })

  it("is unknown when the profile read is stale, still pointing at the profile", () => {
    const c = check(fullInput({ profile: profile(missing, STALE) }), id)
    expect(c.status).toBe("unknown")
    expect(href(c)).toBe(PROFILE_HREF)
  })

  it("is unknown when the profile was never read", () => {
    expect(check(fullInput({ profile: null }), id).status).toBe("unknown")
  })

  it("is necessary", () => {
    expect(check(fullInput(), id).importance).toBe("necessary")
  })
})

describe("additional_categories", () => {
  it("passes with at least one additional category", () => {
    expect(check(fullInput(), "additional_categories").status).toBe("pass")
  })

  it("fails with none", () => {
    const c = check(
      fullInput({ profile: profile({ additionalCategories: 0 }) }),
      "additional_categories"
    )
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("nice")
    expect(href(c)).toBe(PROFILE_HREF)
  })

  it("is unknown when the profile is stale or missing", () => {
    expect(
      check(
        fullInput({ profile: profile({ additionalCategories: 0 }, STALE) }),
        "additional_categories"
      ).status
    ).toBe("unknown")
    expect(
      check(fullInput({ profile: null }), "additional_categories").status
    ).toBe("unknown")
  })
})

describe("regular_hours", () => {
  it("passes with regular periods", () => {
    expect(check(fullInput(), "regular_hours").status).toBe("pass")
  })

  it("fails with none, pointing at hours", () => {
    const c = check(
      fullInput({ hours: hours({ regularPeriods: 0 }) }),
      "regular_hours"
    )
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(HOURS_HREF)
  })

  it("is unknown when hours are stale or never read", () => {
    const stale = check(
      fullInput({ hours: hours({ regularPeriods: 0 }, STALE) }),
      "regular_hours"
    )
    expect(stale.status).toBe("unknown")
    expect(href(stale)).toBe(HOURS_HREF)
    expect(check(fullInput({ hours: null }), "regular_hours").status).toBe(
      "unknown"
    )
  })
})

describe("special_hours", () => {
  it("passes when a special period covers the coming bank holiday", () => {
    const c = check(fullInput(), "special_hours")
    expect(c.status).toBe("pass")
    expect(c.importance).toBe("important")
  })

  it("passes on a single-day period on the holiday (inclusive)", () => {
    const input = fullInput({
      hours: hours({
        specialPeriods: [{ start: "2026-12-25", end: "2026-12-25" }],
      }),
    })
    expect(check(input, "special_hours").status).toBe("pass")
  })

  it("fails when no period covers the holiday, naming it", () => {
    const input = fullInput({
      hours: hours({
        specialPeriods: [
          { start: "2026-12-20", end: "2026-12-24" },
          { start: "2026-12-26", end: "2026-12-31" },
        ],
      }),
    })
    const c = check(input, "special_hours")
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(HOURS_HREF)
    expect(c.detail).toContain("Christmas")
  })

  it("fails with no special periods at all", () => {
    const input = fullInput({ hours: hours({ specialPeriods: [] }) })
    expect(check(input, "special_hours").status).toBe("fail")
  })

  it("is unknown when hours are stale or never read", () => {
    const stale = check(
      fullInput({ hours: hours({ specialPeriods: [] }, STALE) }),
      "special_hours"
    )
    expect(stale.status).toBe("unknown")
    expect(href(stale)).toBe(HOURS_HREF)
    expect(check(fullInput({ hours: null }), "special_hours").status).toBe(
      "unknown"
    )
  })

  it("is not applicable when no bank holiday is within 45 days, even with hours unknown", () => {
    // From 30 Oct 2026, Christmas is 56 days away.
    const now = new Date("2026-10-30T12:00:00Z")
    const input = fullInput({
      hours: null,
      profile: { value: PROFILE, observedAt: "2026-10-29T09:00:00Z" },
    })
    const c = check(input, "special_hours", now)
    expect(c.status).toBe("not_applicable")
    expect(c.fix).toBeNull()
  })
})

describe("verification", () => {
  it("passes when verified", () => {
    expect(check(fullInput(), "verification").status).toBe("pass")
  })

  it("fails when not verified, pointing at verification", () => {
    const c = check(fullInput({ verified: false }), "verification")
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("necessary")
    expect(href(c)).toBe(VERIFICATION_HREF)
  })

  it("is unknown when verification is unknown", () => {
    const c = check(fullInput({ verified: null }), "verification")
    expect(c.status).toBe("unknown")
    expect(c.fix).not.toBeNull()
  })
})

describe("recent_post", () => {
  it("passes with a post in the last 30 days", () => {
    expect(check(fullInput(), "recent_post").status).toBe("pass")
  })

  it("passes on a recent post even when the posts read is stale", () => {
    const input = fullInput({
      posts: { lastPublishedAt: "2026-11-01T10:00:00Z", observedAt: STALE },
    })
    expect(check(input, "recent_post").status).toBe("pass")
  })

  it("fails when the latest post is older than 30 days, pointing at posts", () => {
    const input = fullInput({
      posts: { lastPublishedAt: "2026-09-20T10:00:00Z", observedAt: FRESH },
    })
    const c = check(input, "recent_post")
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("important")
    expect(href(c)).toBe(POSTS_HREF)
  })

  it("fails when there has never been a post (fresh read)", () => {
    const input = fullInput({
      posts: { lastPublishedAt: null, observedAt: FRESH },
    })
    expect(check(input, "recent_post").status).toBe("fail")
  })

  it("is unknown when an old post comes from a stale read", () => {
    const c = check(
      fullInput({
        posts: { lastPublishedAt: "2026-09-20T10:00:00Z", observedAt: STALE },
      }),
      "recent_post"
    )
    expect(c.status).toBe("unknown")
    expect(href(c)).toBe(POSTS_HREF)
  })

  it("is unknown when posts were never read", () => {
    const input = fullInput({
      posts: { lastPublishedAt: null, observedAt: null },
    })
    expect(check(input, "recent_post").status).toBe("unknown")
  })
})

describe("recent_photo", () => {
  const photos = fullInput().photos

  it("passes with a photo in the last 90 days", () => {
    const input = fullInput({
      photos: { ...photos, newestAt: "2026-09-01T10:00:00Z" },
    })
    expect(check(input, "recent_photo").status).toBe("pass")
  })

  it("passes on a recent photo even when the photos read is stale", () => {
    const input = fullInput({ photos: { ...photos, observedAt: STALE } })
    expect(check(input, "recent_photo").status).toBe("pass")
  })

  it("fails when the newest photo is older than 90 days, pointing at photos", () => {
    const c = check(
      fullInput({ photos: { ...photos, newestAt: "2026-07-01T10:00:00Z" } }),
      "recent_photo"
    )
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("important")
    expect(href(c)).toBe(PHOTOS_HREF)
  })

  it("fails when there are no photos (fresh read)", () => {
    const input = fullInput({ photos: { ...photos, newestAt: null } })
    expect(check(input, "recent_photo").status).toBe("fail")
  })

  it("is unknown when an old photo comes from a stale or missing read", () => {
    for (const observedAt of [STALE, null]) {
      const c = check(
        fullInput({
          photos: { ...photos, newestAt: "2026-07-01T10:00:00Z", observedAt },
        }),
        "recent_photo"
      )
      expect(c.status).toBe("unknown")
      expect(href(c)).toBe(PHOTOS_HREF)
    }
  })
})

describe.each([
  ["cover_photo", "cover"],
  ["logo_photo", "logo"],
] as const)("%s", (id, field) => {
  const photos = fullInput().photos

  it("passes when present", () => {
    expect(check(fullInput(), id).status).toBe("pass")
  })

  it("passes when present even on a stale read", () => {
    const input = fullInput({ photos: { ...photos, observedAt: STALE } })
    expect(check(input, id).status).toBe("pass")
  })

  it("fails when absent on a fresh read, pointing at photos", () => {
    const c = check(fullInput({ photos: { ...photos, [field]: false } }), id)
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("important")
    expect(href(c)).toBe(PHOTOS_HREF)
  })

  it("is unknown when absent on a stale or missing read", () => {
    for (const observedAt of [STALE, null]) {
      const c = check(
        fullInput({ photos: { ...photos, [field]: false, observedAt } }),
        id
      )
      expect(c.status).toBe("unknown")
      expect(href(c)).toBe(PHOTOS_HREF)
    }
  })
})

describe("booking_link", () => {
  it("passes with a booking link", () => {
    expect(check(fullInput(), "booking_link").status).toBe("pass")
  })

  it("passes with a booking link even when the read is old or missing", () => {
    for (const observedAt of [STALE, null]) {
      const input = fullInput({ booking: { booking: 2, other: 0, observedAt } })
      expect(check(input, "booking_link").status).toBe("pass")
    }
  })

  it("fails with no booking link on a fresh read, even with other links", () => {
    const c = check(
      fullInput({ booking: { booking: 0, other: 3, observedAt: FRESH } }),
      "booking_link"
    )
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("important")
    expect(href(c)).toBe(BOOKING_HREF)
  })

  it("is unknown with no booking link on a stale or missing read", () => {
    for (const observedAt of [STALE, null]) {
      const c = check(
        fullInput({ booking: { booking: 0, other: 0, observedAt } }),
        "booking_link"
      )
      expect(c.status).toBe("unknown")
      expect(href(c)).toBe(BOOKING_HREF)
    }
  })
})

describe("unreplied_reviews", () => {
  const reviews = fullInput().reviews

  it("passes with no overdue unreplied reviews", () => {
    expect(check(fullInput(), "unreplied_reviews").status).toBe("pass")
  })

  it("fails with overdue reviews, naming the count and pointing at the inbox", () => {
    const c = check(
      fullInput({ reviews: { ...reviews, overdueUnreplied: 3 } }),
      "unreplied_reviews"
    )
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("important")
    expect(href(c)).toBe(INBOX_HREF)
    expect(c.detail).toContain("3")
  })

  it("is unknown when reviews were last synced long ago or never", () => {
    for (const checkedAt of [STALE, null]) {
      const c = check(
        fullInput({ reviews: { ...reviews, overdueUnreplied: 0, checkedAt } }),
        "unreplied_reviews"
      )
      expect(c.status).toBe("unknown")
      expect(c.fix).not.toBeNull()
    }
  })
})

describe("services_or_menu", () => {
  it("passes with menu items on a fresh menu read", () => {
    const c = check(fullInput(), "services_or_menu")
    expect(c.status).toBe("pass")
    expect(c.importance).toBe("important")
  })

  it("passes with service items when the menu is empty or unread", () => {
    for (const m of [menu({ items: 0 }), null]) {
      const input = fullInput({
        menu: m,
        details: details({ serviceItems: 4 }),
      })
      expect(check(input, "services_or_menu").status).toBe("pass")
    }
  })

  it("does not count menu items from a stale read", () => {
    const input = fullInput({
      menu: menu({ items: 30 }, STALE),
      details: details({ serviceItems: 0 }),
    })
    expect(check(input, "services_or_menu").status).toBe("unknown")
  })

  it("does not count service items from a stale read", () => {
    const input = fullInput({
      menu: null,
      details: details({ serviceItems: 4 }, STALE),
    })
    expect(check(input, "services_or_menu").status).toBe("unknown")
  })

  it("fails toward the menu when the listing can have a menu but has none", () => {
    const c = check(
      fullInput({
        menu: menu({ eligible: true, items: 0 }),
        details: details({ serviceItems: 0 }),
      }),
      "services_or_menu"
    )
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(MENU_HREF)
  })

  it("fails toward the profile when menus are not available and there are no services", () => {
    const c = check(
      fullInput({
        menu: menu({ eligible: false, items: 0 }),
        details: details({ serviceItems: 0 }),
      }),
      "services_or_menu"
    )
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(PROFILE_HREF)
  })

  it("is unknown when menus are not available and services were not read freshly", () => {
    for (const d of [details({ serviceItems: 0 }, STALE), null]) {
      const c = check(
        fullInput({ menu: menu({ eligible: false, items: 0 }), details: d }),
        "services_or_menu"
      )
      expect(c.status).toBe("unknown")
      expect(c.fix).not.toBeNull()
    }
  })

  it("is unknown when menu eligibility is unknown", () => {
    const c = check(
      fullInput({
        menu: menu({ eligible: null, items: 0 }),
        details: details({ serviceItems: 0 }),
      }),
      "services_or_menu"
    )
    expect(c.status).toBe("unknown")
  })

  it("is unknown when neither menu nor details were read", () => {
    const input = fullInput({ menu: null, details: null })
    expect(check(input, "services_or_menu").status).toBe("unknown")
  })
})

describe("description_quality", () => {
  it("passes for a good description unlike any sibling's", () => {
    const c = check(fullInput(), "description_quality")
    expect(c.status).toBe("pass")
    expect(c.importance).toBe("nice")
  })

  it("passes with no siblings", () => {
    expect(
      check(fullInput({ siblings: [] }), "description_quality").status
    ).toBe("pass")
  })

  it("is not applicable with no description", () => {
    const c = check(
      fullInput({ profile: profile({ description: null }) }),
      "description_quality"
    )
    expect(c.status).toBe("not_applicable")
    expect(c.fix).toBeNull()
  })

  it("is unknown when the profile is stale or never read", () => {
    const stale = check(
      fullInput({ profile: profile({ description: "Short." }, STALE) }),
      "description_quality"
    )
    expect(stale.status).toBe("unknown")
    expect(href(stale)).toBe(PROFILE_HREF)
    expect(
      check(fullInput({ profile: null }), "description_quality").status
    ).toBe("unknown")
  })

  it("fails a short description", () => {
    const c = check(
      fullInput({ profile: profile({ description: "Lovely village pub." }) }),
      "description_quality"
    )
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(PROFILE_HREF)
  })

  it("fails a description with a link", () => {
    const c = check(
      fullInput({
        profile: profile({
          description: `${DESCRIPTION} Book at www.thebell.co.uk`,
        }),
      }),
      "description_quality"
    )
    expect(c.status).toBe("fail")
  })

  it("fails a shouting description", () => {
    const c = check(
      fullInput({
        profile: profile({ description: DESCRIPTION.toUpperCase() }),
      }),
      "description_quality"
    )
    expect(c.status).toBe("fail")
  })

  it("fails a description copied from a sibling, naming the sibling", () => {
    const c = check(
      fullInput({
        siblings: [
          {
            locationId: "loc-2",
            name: "The Crown at Wells",
            description: SIBLING_DESCRIPTION,
          },
          {
            locationId: "loc-3",
            name: "The Ship at Blakeney",
            description: DESCRIPTION.replace("Langham", "Blakeney"),
          },
        ],
      }),
      "description_quality"
    )
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(PROFILE_HREF)
    expect(c.detail).toContain("The Ship at Blakeney")
  })

  it("fails an identical sibling description that differs only in case and punctuation", () => {
    const c = check(
      fullInput({
        siblings: [
          {
            locationId: "loc-2",
            name: "The Crown at Wells",
            description: DESCRIPTION.toLowerCase().replace(/[,.]/g, ""),
          },
        ],
      }),
      "description_quality"
    )
    expect(c.status).toBe("fail")
    expect(c.detail).toContain("The Crown at Wells")
  })

  it("ignores siblings with an empty description", () => {
    const input = fullInput({
      siblings: [{ locationId: "loc-2", name: "Empty", description: "" }],
    })
    expect(check(input, "description_quality").status).toBe("pass")
  })
})

describe("attributes", () => {
  it("passes with attributes set", () => {
    expect(check(fullInput(), "attributes").status).toBe("pass")
  })

  it("fails with none, pointing at the profile", () => {
    const c = check(
      fullInput({ details: details({ attributes: 0 }) }),
      "attributes"
    )
    expect(c.status).toBe("fail")
    expect(c.importance).toBe("nice")
    expect(href(c)).toBe(PROFILE_HREF)
  })

  it("is unknown when details are stale or never read", () => {
    expect(
      check(
        fullInput({ details: details({ attributes: 0 }, STALE) }),
        "attributes"
      ).status
    ).toBe("unknown")
    expect(check(fullInput({ details: null }), "attributes").status).toBe(
      "unknown"
    )
  })
})

describe("website_utm", () => {
  it("passes with a utm_ query parameter", () => {
    const c = check(fullInput(), "website_utm")
    expect(c.status).toBe("pass")
    expect(c.importance).toBe("nice")
  })

  it("passes with any utm_ parameter, not only utm_source", () => {
    const input = fullInput({
      profile: profile({
        website:
          "https://www.thebelllangham.co.uk/visit?ref=x&utm_campaign=gbp",
      }),
    })
    expect(check(input, "website_utm").status).toBe("pass")
  })

  it.each([
    "https://www.thebelllangham.co.uk/",
    "https://www.thebelllangham.co.uk/?ref=gbp",
    "https://www.thebelllangham.co.uk/?notutm_source=gbp",
    "https://www.thebelllangham.co.uk/#utm_source=gbp",
    "not a url",
  ])("fails for %j, pointing at the profile", (website) => {
    const c = check(fullInput({ profile: profile({ website }) }), "website_utm")
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(PROFILE_HREF)
  })

  it("is not applicable with no website", () => {
    const c = check(
      fullInput({ profile: profile({ website: null }) }),
      "website_utm"
    )
    expect(c.status).toBe("not_applicable")
    expect(c.fix).toBeNull()
  })

  it("is unknown when the profile is stale or never read", () => {
    expect(
      check(
        fullInput({
          profile: profile(
            { website: "https://www.thebelllangham.co.uk/" },
            STALE
          ),
        }),
        "website_utm"
      ).status
    ).toBe("unknown")
    expect(check(fullInput({ profile: null }), "website_utm").status).toBe(
      "unknown"
    )
  })
})

describe("rating_trend", () => {
  function withRatings(
    recent: { count: number; average: number | null },
    previous: { count: number; average: number | null },
    checkedAt: string | null = FRESH
  ) {
    return fullInput({
      reviews: { checkedAt, overdueUnreplied: 0, recent, previous },
    })
  }

  it("passes for a steady rating", () => {
    const c = check(fullInput(), "rating_trend")
    expect(c.status).toBe("pass")
    expect(c.importance).toBe("nice")
  })

  it("passes for a rising rating or a small drop", () => {
    expect(
      check(
        withRatings({ count: 10, average: 4.8 }, { count: 10, average: 4.2 }),
        "rating_trend"
      ).status
    ).toBe("pass")
    expect(
      check(
        withRatings({ count: 10, average: 4.25 }, { count: 10, average: 4.5 }),
        "rating_trend"
      ).status
    ).toBe("pass")
  })

  it("fails when the average drops by more than 0.3, pointing at the inbox", () => {
    const c = check(
      withRatings({ count: 10, average: 4.125 }, { count: 10, average: 4.5 }),
      "rating_trend"
    )
    expect(c.status).toBe("fail")
    expect(href(c)).toBe(INBOX_HREF)
  })

  it("is not applicable with fewer than 5 reviews in either window", () => {
    for (const [recent, previous] of [
      [4, 10],
      [10, 4],
    ]) {
      const c = check(
        withRatings(
          { count: recent, average: 3.0 },
          { count: previous, average: 4.8 }
        ),
        "rating_trend"
      )
      expect(c.status).toBe("not_applicable")
      expect(c.fix).toBeNull()
    }
  })

  it("is not applicable when an average is missing", () => {
    expect(
      check(
        withRatings({ count: 10, average: null }, { count: 10, average: 4.5 }),
        "rating_trend"
      ).status
    ).toBe("not_applicable")
    expect(
      check(
        withRatings({ count: 10, average: 4.5 }, { count: 10, average: null }),
        "rating_trend"
      ).status
    ).toBe("not_applicable")
  })

  it("is unknown when reviews were last synced long ago or never", () => {
    for (const checkedAt of [STALE, null]) {
      const c = check(
        withRatings(
          { count: 10, average: 3.0 },
          { count: 10, average: 4.8 },
          checkedAt
        ),
        "rating_trend"
      )
      expect(c.status).toBe("unknown")
      expect(c.fix).not.toBeNull()
    }
  })
})

describe("scoreCompleteness", () => {
  it("is 100 with no fix points when everything passes", () => {
    const result = scoreCompleteness(evaluateCompleteness(fullInput(), NOW))
    expect(result).toEqual({
      score: 100,
      fixPoints: 0,
      counts: { fail: 0, unknown: 0, pass: 19, not_applicable: 0, skipped: 0 },
    })
  })

  it("weights one necessary failure among passing checks", () => {
    // Total weight 6·3 + 8·2 + 5·1 = 39; one necessary fail → 36/39.
    const result = scoreCompleteness(
      evaluateCompleteness(
        fullInput({ profile: profile({ phone: null }) }),
        NOW
      )
    )
    expect(result.score).toBe(92)
    expect(result.fixPoints).toBe(3)
    expect(result.counts.fail).toBe(1)
    expect(result.counts.pass).toBe(18)
  })

  it("weights one nice failure among passing checks", () => {
    // 38/39 → 97.4
    const result = scoreCompleteness(
      evaluateCompleteness(
        fullInput({ details: details({ attributes: 0 }) }),
        NOW
      )
    )
    expect(result.score).toBe(97)
    expect(result.fixPoints).toBe(1)
  })

  it("leaves unknown, not_applicable and skipped out of the score", () => {
    const result = scoreCompleteness([
      mk("primary_category", "necessary", "pass"),
      mk("phone", "necessary", "unknown"),
      mk("special_hours", "important", "fail"),
      mk("recent_post", "important", "not_applicable"),
      mk("attributes", "nice", "fail"),
      mk("website_utm", "nice", "skipped"),
    ])
    // pass 3, fail 2 + 1 = 3 → 50
    expect(result.score).toBe(50)
    expect(result.fixPoints).toBe(3)
    expect(result.counts).toEqual({
      fail: 2,
      unknown: 1,
      pass: 1,
      not_applicable: 1,
      skipped: 1,
    })
  })

  it("rounds to the nearest whole number", () => {
    expect(
      scoreCompleteness([
        mk("special_hours", "important", "pass"),
        mk("attributes", "nice", "fail"),
      ]).score
    ).toBe(67)
    expect(
      scoreCompleteness([
        mk("phone", "necessary", "pass"),
        mk("attributes", "nice", "fail"),
      ]).score
    ).toBe(75)
  })

  it("is 0 when everything known fails", () => {
    const result = scoreCompleteness([
      mk("phone", "necessary", "fail"),
      mk("recent_post", "important", "fail"),
    ])
    expect(result.score).toBe(0)
    expect(result.fixPoints).toBe(5)
  })

  it("is null when nothing passes or fails", () => {
    expect(
      scoreCompleteness([
        mk("phone", "necessary", "unknown"),
        mk("rating_trend", "nice", "not_applicable"),
        mk("website_utm", "nice", "skipped"),
      ])
    ).toEqual({
      score: null,
      fixPoints: 0,
      counts: { fail: 0, unknown: 1, pass: 0, not_applicable: 1, skipped: 1 },
    })
    expect(scoreCompleteness([])).toEqual({
      score: null,
      fixPoints: 0,
      counts: { fail: 0, unknown: 0, pass: 0, not_applicable: 0, skipped: 0 },
    })
  })
})

describe("applyCompletenessSkips", () => {
  const skippedAt = "2026-11-01T10:00:00Z"

  it("skips a failing check, keeping its detail and dropping its fix", () => {
    const checks = evaluateCompleteness(
      fullInput({ booking: { booking: 0, other: 0, observedAt: FRESH } }),
      NOW
    )
    const before = checks.find((c) => c.id === "booking_link")!
    expect(before.status).toBe("fail")

    const after = applyCompletenessSkips(checks, [
      { checkId: "booking_link", reason: "We take walk-ins only", skippedAt },
    ])
    const c = after.find((x) => x.id === "booking_link")!
    expect(c.status).toBe("skipped")
    expect(c.fix).toBeNull()
    expect(c.detail).toBe(before.detail)
    expect(c.skip).toEqual({ reason: "We take walk-ins only", skippedAt })
    expect(after.map((x) => x.id)).toEqual([...COMPLETENESS_CHECK_IDS])
  })

  it("skips a passing check too", () => {
    const after = applyCompletenessSkips(
      evaluateCompleteness(fullInput(), NOW),
      [{ checkId: "website_utm", reason: "No tracking", skippedAt }]
    )
    expect(after.find((c) => c.id === "website_utm")?.status).toBe("skipped")
  })

  it("leaves other checks unchanged", () => {
    const checks = evaluateCompleteness(fullInput(), NOW)
    const after = applyCompletenessSkips(checks, [
      { checkId: "website_utm", reason: "No tracking", skippedAt },
    ])
    for (const c of after) {
      if (c.id === "website_utm") continue
      expect(c).toEqual(checks.find((x) => x.id === c.id))
    }
  })

  it("does nothing with no skips", () => {
    const checks = evaluateCompleteness(fullInput(), NOW)
    expect(applyCompletenessSkips(checks, [])).toEqual(checks)
  })
})

describe("listingCompleteness", () => {
  it("combines checks, skips and score", () => {
    const input = fullInput({
      profile: profile({ phone: null }),
      booking: { booking: 0, other: 0, observedAt: FRESH },
    })
    const result = listingCompleteness(
      input,
      [
        {
          checkId: "booking_link",
          reason: "Walk-ins only",
          skippedAt: "2026-11-01T10:00:00Z",
        },
      ],
      NOW
    )
    expect(result.locationId).toBe(LOC)
    expect(result.checks.map((c) => c.id)).toEqual([...COMPLETENESS_CHECK_IDS])
    expect(result.checks.find((c) => c.id === "booking_link")?.status).toBe(
      "skipped"
    )
    // booking_link (2) removed: pass 39 - 3 - 2 = 34, fail 3 → 34/37 = 91.9
    expect(result.score).toBe(92)
    expect(result.fixPoints).toBe(3)
    expect(result.counts).toEqual({
      fail: 1,
      unknown: 0,
      pass: 17,
      not_applicable: 0,
      skipped: 1,
    })
  })

  it("removes a skipped failure from the score entirely", () => {
    const result = listingCompleteness(
      fullInput({ profile: profile({ phone: null }) }),
      [
        {
          checkId: "phone",
          reason: "No phone",
          skippedAt: "2026-11-01T10:00:00Z",
        },
      ],
      NOW
    )
    expect(result.score).toBe(100)
    expect(result.fixPoints).toBe(0)
  })
})

describe("failingChecks", () => {
  const input = fullInput({
    profile: profile({ phone: null, website: null }),
    details: details({ attributes: 0 }),
    booking: { booking: 0, other: 0, observedAt: FRESH },
    posts: { lastPublishedAt: null, observedAt: FRESH },
    verified: null,
  })

  it("lists failures necessary first, then important, then nice", () => {
    const checks = evaluateCompleteness(input, NOW)
    expect(failingChecks({ checks }).map((c) => c.id)).toEqual([
      "phone",
      "website",
      "recent_post",
      "booking_link",
      "attributes",
    ])
  })

  it("orders by importance and check order whatever the input order", () => {
    const checks = [...evaluateCompleteness(input, NOW)].reverse()
    expect(failingChecks({ checks }).map((c) => c.id)).toEqual([
      "phone",
      "website",
      "recent_post",
      "booking_link",
      "attributes",
    ])
  })

  it("leaves out skipped and unknown checks", () => {
    const result = listingCompleteness(
      input,
      [
        {
          checkId: "phone",
          reason: "No phone",
          skippedAt: "2026-11-01T10:00:00Z",
        },
      ],
      NOW
    )
    const ids = failingChecks(result).map((c) => c.id)
    expect(ids).not.toContain("phone")
    expect(ids).not.toContain("verification")
    expect(ids).toEqual([
      "website",
      "recent_post",
      "booking_link",
      "attributes",
    ])
  })

  it("is empty when nothing fails", () => {
    expect(
      failingChecks({ checks: evaluateCompleteness(fullInput(), NOW) })
    ).toEqual([])
  })
})

describe("compareMostToFix", () => {
  it("puts more fix points first", () => {
    expect(
      compareMostToFix({ fixPoints: 5, score: 60 }, { fixPoints: 2, score: 40 })
    ).toBeLessThan(0)
    expect(
      compareMostToFix({ fixPoints: 2, score: 40 }, { fixPoints: 5, score: 60 })
    ).toBeGreaterThan(0)
  })

  it("breaks ties by lower score first", () => {
    expect(
      compareMostToFix({ fixPoints: 3, score: 40 }, { fixPoints: 3, score: 80 })
    ).toBeLessThan(0)
  })

  it("puts null scores last among equal fix points", () => {
    expect(
      compareMostToFix(
        { fixPoints: 0, score: null },
        { fixPoints: 0, score: 100 }
      )
    ).toBeGreaterThan(0)
    expect(
      compareMostToFix(
        { fixPoints: 0, score: 100 },
        { fixPoints: 0, score: null }
      )
    ).toBeLessThan(0)
  })

  it("is 0 for equal entries", () => {
    expect(
      compareMostToFix({ fixPoints: 3, score: 70 }, { fixPoints: 3, score: 70 })
    ).toBe(0)
    expect(
      compareMostToFix(
        { fixPoints: 0, score: null },
        { fixPoints: 0, score: null }
      )
    ).toBe(0)
  })

  it("sorts a list into most-to-fix order", () => {
    const list = [
      { name: "a", fixPoints: 2, score: 80 },
      { name: "b", fixPoints: 0, score: null },
      { name: "c", fixPoints: 5, score: 60 },
      { name: "d", fixPoints: 0, score: 100 },
      { name: "e", fixPoints: 5, score: 40 },
    ]
    expect([...list].sort(compareMostToFix).map((x) => x.name)).toEqual([
      "e",
      "c",
      "a",
      "d",
      "b",
    ])
  })
})
