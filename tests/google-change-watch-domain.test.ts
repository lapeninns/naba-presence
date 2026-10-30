import { describe, expect, it } from "vitest"

import {
  DEFAULT_PROTECTED_FIELDS,
  WATCHED_FIELDS,
  WATCHED_FIELD_LABELS,
  categoryMovement,
  changedHoursKeys,
  detectGoogleChanges,
  googleChangeSubjectId,
  hoursFieldMovement,
  profileFieldMovement,
  normalisePhone,
  normaliseText,
  normaliseWebsite,
  planLedger,
  sameWatchedValue,
  watchedValueHash,
  type WatchedValue,
} from "@/lib/domain/google-change-watch"
import type { NormalizedHours } from "@/lib/domain/hours-vocabulary"

const GOOGLE_MOVED = { googleMoved: true, oursMoved: false } as const
const BOTH_MOVED = { googleMoved: true, oursMoved: true } as const
const OURS_MOVED = { googleMoved: false, oursMoved: true } as const
const NONE_MOVED = { googleMoved: false, oursMoved: false } as const

type Regular = NormalizedHours["regular"]
type Special = NormalizedHours["special"]

function week(
  periodsFor: (day: number) => Regular[number]["periods"] | null
): Regular {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const periods = periodsFor(dayOfWeek)
    return {
      dayOfWeek,
      isClosed: periods === null,
      periods: periods ?? [],
    }
  })
}

const lunchAndDinner = week((day) =>
  day === 0
    ? null
    : [
        { opensAt: "12:00", closesAt: "15:00" },
        { opensAt: "17:00", closesAt: "23:00" },
      ]
)

function regular(value: Regular): WatchedValue {
  return { field: "regularHours", value }
}

function special(value: Special): WatchedValue {
  return { field: "specialHours", value }
}

const christmasClosed: Special = [
  {
    effectiveDate: "2026-12-25",
    isClosed: true,
    opensAt: null,
    closesAt: null,
  },
]

describe("google change watch vocabulary", () => {
  it("watches the seven profile fields and protects all of them by default", () => {
    expect([...WATCHED_FIELDS]).toEqual([
      "name",
      "description",
      "phone",
      "website",
      "primaryCategory",
      "regularHours",
      "specialHours",
    ])
    expect([...DEFAULT_PROTECTED_FIELDS]).toEqual([...WATCHED_FIELDS])
  })

  it("gives every watched field a sentence-case label", () => {
    for (const field of WATCHED_FIELDS) {
      const label = WATCHED_FIELD_LABELS[field]
      expect(label).toBeTruthy()
      expect(label[0]).toBe(label[0]?.toUpperCase())
      expect(label.slice(1)).toBe(label.slice(1).toLowerCase())
    }
  })
})

describe("google change watch normalisers", () => {
  it("trims and collapses whitespace in text and maps empty values to null", () => {
    expect(normaliseText("  The   Bell \n Inn ")).toBe("The Bell Inn")
    expect(normaliseText("")).toBeNull()
    expect(normaliseText("   ")).toBeNull()
    expect(normaliseText(undefined)).toBeNull()
    expect(normaliseText(42)).toBeNull()
  })

  it("keeps only digits and a leading plus in phone numbers", () => {
    expect(normalisePhone("01223 456-789")).toBe(normalisePhone("01223456789"))
    expect(normalisePhone("+44 (1223) 456 789")).toBe("+441223456789")
    expect(normalisePhone("")).toBeNull()
  })

  it("treats website scheme and host case and a bare trailing slash as no change", () => {
    expect(normaliseWebsite("https://Example.com/")).toBe(
      normaliseWebsite("https://example.com")
    )
    expect(normaliseWebsite("HTTPS://EXAMPLE.COM")).toBe(
      normaliseWebsite("https://example.com")
    )
  })

  it("compares a UK number however it is written", () => {
    const national = normalisePhone("01223 277217")
    expect(national).toBe("+441223277217")
    expect(normalisePhone("+44 1223 277217")).toBe(national)
    expect(normalisePhone("+44 (0)1223 277217")).toBe(national)
    expect(normalisePhone("0044 1223 277217")).toBe(national)
    expect(normalisePhone("+353 1 234 5678")).toBe("+35312345678")
    expect(normalisePhone("01223 277218")).not.toBe(national)
  })

  it("treats a missing scheme, http against https and www. as the same site", () => {
    const site = normaliseWebsite("https://lapeninns.com/")
    expect(normaliseWebsite("lapeninns.com")).toBe(site)
    expect(normaliseWebsite("http://www.lapeninns.com")).toBe(site)
    expect(normaliseWebsite("https://lapeninns.com/?utm_source=gbp")).not.toBe(
      site
    )
  })

  it("treats a different website path as a different website", () => {
    expect(normaliseWebsite("https://example.com/menu")).not.toBe(
      normaliseWebsite("https://example.com")
    )
  })
})

describe("sameWatchedValue", () => {
  it("treats a regular period closing at 24:00 as the same as one closing at 00:00", () => {
    const at2400 = week((day) =>
      day === 5 ? [{ opensAt: "18:00", closesAt: "24:00" }] : null
    )
    const at0000 = week((day) =>
      day === 5 ? [{ opensAt: "18:00", closesAt: "00:00" }] : null
    )
    const at0000NextDay = week((day) =>
      day === 5
        ? [{ opensAt: "18:00", closesAt: "00:00", closeDayOfWeek: 6 }]
        : null
    )
    expect(sameWatchedValue(regular(at2400), regular(at0000))).toBe(true)
    expect(sameWatchedValue(regular(at2400), regular(at0000NextDay))).toBe(true)
  })

  it("treats a special date closing at 24:00 as the same as one closing at 00:00", () => {
    const base = {
      effectiveDate: "2026-12-31",
      isClosed: false,
      opensAt: "18:00",
    }
    expect(
      sameWatchedValue(
        special([{ ...base, closesAt: "24:00" }]),
        special([{ ...base, closesAt: "00:00" }])
      )
    ).toBe(true)
  })

  it("treats an overnight period with and without an explicit next close day as the same", () => {
    const implicit = week((day) =>
      day === 6 ? [{ opensAt: "18:00", closesAt: "02:00" }] : null
    )
    const explicit = week((day) =>
      day === 6
        ? [{ opensAt: "18:00", closesAt: "02:00", closeDayOfWeek: 0 }]
        : null
    )
    expect(sameWatchedValue(regular(implicit), regular(explicit))).toBe(true)
  })

  it("ignores the order of periods within a day", () => {
    const reordered = lunchAndDinner.map((day) => ({
      ...day,
      periods: [...day.periods].reverse(),
    }))
    expect(sameWatchedValue(regular(lunchAndDinner), regular(reordered))).toBe(
      true
    )
  })

  it("ignores the provider order of two special periods on the same date", () => {
    const lunch = {
      effectiveDate: "2026-12-24",
      isClosed: false,
      opensAt: "12:00",
      closesAt: "15:00",
    }
    const evening = { ...lunch, opensAt: "18:00", closesAt: "22:00" }
    expect(
      sameWatchedValue(special([lunch, evening]), special([evening, lunch]))
    ).toBe(true)
  })

  it("treats an omitted special end date as ending on the effective date", () => {
    const withEnd: Special = [{ ...christmasClosed[0]!, endDate: "2026-12-25" }]
    expect(sameWatchedValue(special(christmasClosed), special(withEnd))).toBe(
      true
    )
  })

  it("ignores stray times on a closed special date", () => {
    const withTimes: Special = [
      { ...christmasClosed[0]!, opensAt: "10:00", closesAt: "16:00" },
    ]
    expect(sameWatchedValue(special(christmasClosed), special(withTimes))).toBe(
      true
    )
  })

  it("treats a missing weekday as a closed weekday", () => {
    const withoutSunday = lunchAndDinner.filter((day) => day.dayOfWeek !== 0)
    expect(
      sameWatchedValue(regular(lunchAndDinner), regular(withoutSunday))
    ).toBe(true)
  })

  it("treats a closed weekday with stray periods as a closed weekday", () => {
    const strayPeriods = lunchAndDinner.map((day) =>
      day.dayOfWeek === 0
        ? { ...day, periods: [{ opensAt: "12:00", closesAt: "16:00" }] }
        : day
    )
    expect(
      sameWatchedValue(regular(lunchAndDinner), regular(strayPeriods))
    ).toBe(true)
  })

  it("compares text after trimming and treats an empty string as null", () => {
    expect(
      sameWatchedValue(
        { field: "name", value: " The  Bell " },
        { field: "name", value: "The Bell" }
      )
    ).toBe(true)
    expect(
      sameWatchedValue(
        { field: "description", value: "" },
        { field: "description", value: null }
      )
    ).toBe(true)
  })

  it("compares primary categories by name and ignores the display name", () => {
    expect(
      sameWatchedValue(
        {
          field: "primaryCategory",
          value: { name: "categories/gcid:pub", displayName: "Pub" },
        },
        {
          field: "primaryCategory",
          value: { name: "categories/gcid:pub", displayName: null },
        }
      )
    ).toBe(true)
  })

  it("reports real changes as different", () => {
    const laterClose = lunchAndDinner.map((day) =>
      day.dayOfWeek === 5
        ? {
            ...day,
            periods: [
              { opensAt: "12:00", closesAt: "15:00" },
              { opensAt: "17:00", closesAt: "23:30" },
            ],
          }
        : day
    )
    expect(sameWatchedValue(regular(lunchAndDinner), regular(laterClose))).toBe(
      false
    )
    expect(
      sameWatchedValue(
        special(christmasClosed),
        special([{ ...christmasClosed[0]!, effectiveDate: "2026-12-26" }])
      )
    ).toBe(false)
    expect(
      sameWatchedValue(
        { field: "name", value: "The Bell" },
        { field: "name", value: "The Bell Inn" }
      )
    ).toBe(false)
    expect(
      sameWatchedValue(
        {
          field: "primaryCategory",
          value: { name: "categories/gcid:pub", displayName: "Pub" },
        },
        {
          field: "primaryCategory",
          value: { name: "categories/gcid:restaurant", displayName: "Pub" },
        }
      )
    ).toBe(false)
  })
})

describe("sameWatchedValue midnight and past-dates edges", () => {
  it("treats a special date closing at 24:00 as the same as 00:00 with the next day as its end date", () => {
    expect(
      sameWatchedValue(
        special([
          {
            effectiveDate: "2026-12-31",
            endDate: "2026-12-31",
            isClosed: false,
            opensAt: "18:00",
            closesAt: "24:00",
          },
        ]),
        special([
          {
            effectiveDate: "2026-12-31",
            endDate: "2027-01-01",
            isClosed: false,
            opensAt: "18:00",
            closesAt: "00:00",
          },
        ])
      )
    ).toBe(true)
  })

  it("keeps 24:00 on an explicit later close day apart from 00:00 on that day", () => {
    const at = (closesAt: string) =>
      regular(
        week((day) =>
          day === 1 ? [{ opensAt: "18:00", closesAt, closeDayOfWeek: 2 }] : null
        )
      )
    expect(sameWatchedValue(at("24:00"), at("00:00"))).toBe(false)
  })

  it("ignores special dates that have already passed", () => {
    const past = {
      effectiveDate: "2026-01-01",
      isClosed: true,
      opensAt: null,
      closesAt: null,
    }
    const changes = detectGoogleChanges({
      protectedFields: WATCHED_FIELDS,
      today: "2026-10-30",
      observations: [
        { ours: special([past]), google: special([]), movement: GOOGLE_MOVED },
      ],
    })
    expect(changes).toEqual([])
  })
})

describe("watchedValueHash", () => {
  it("returns a sha256 hex digest that is equal for equivalent values", () => {
    const hash = watchedValueHash({ field: "name", value: " The  Bell " })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(watchedValueHash({ field: "name", value: "The Bell" }))
    expect(hash).not.toBe(
      watchedValueHash({ field: "name", value: "The Bell Inn" })
    )
  })

  it("hashes representation-only hours differences identically", () => {
    const withoutSunday = lunchAndDinner.filter((day) => day.dayOfWeek !== 0)
    expect(watchedValueHash(regular(lunchAndDinner))).toBe(
      watchedValueHash(regular(withoutSunday))
    )
  })
})

describe("changedHoursKeys", () => {
  it("lists the changed weekdays in order", () => {
    const changed = lunchAndDinner.map((day) =>
      day.dayOfWeek === 5 || day.dayOfWeek === 2
        ? { ...day, isClosed: true, periods: [] }
        : day
    )
    expect(changedHoursKeys(regular(lunchAndDinner), regular(changed))).toEqual(
      { regularDays: [2, 5], specialDates: [] }
    )
  })

  it("lists the changed special dates in order", () => {
    const ours: Special = [
      ...christmasClosed,
      {
        effectiveDate: "2026-12-24",
        isClosed: false,
        opensAt: "12:00",
        closesAt: "18:00",
      },
    ]
    const google: Special = [
      {
        effectiveDate: "2026-12-31",
        isClosed: false,
        opensAt: "12:00",
        closesAt: "02:00",
      },
      {
        effectiveDate: "2026-12-24",
        isClosed: false,
        opensAt: "12:00",
        closesAt: "16:00",
      },
    ]
    expect(changedHoursKeys(special(ours), special(google))).toEqual({
      regularDays: [],
      specialDates: ["2026-12-24", "2026-12-25", "2026-12-31"],
    })
  })

  it("does not list representation-only differences", () => {
    const at2400 = week((day) =>
      day === 5 ? [{ opensAt: "18:00", closesAt: "24:00" }] : null
    )
    const at0000 = week((day) =>
      day === 5 ? [{ opensAt: "18:00", closesAt: "00:00" }] : null
    ).filter((day) => day.dayOfWeek !== 3)
    expect(changedHoursKeys(regular(at2400), regular(at0000))).toEqual({
      regularDays: [],
      specialDates: [],
    })
  })

  it("returns empty key lists for text fields", () => {
    expect(
      changedHoursKeys(
        { field: "name", value: "The Bell" },
        { field: "name", value: "The Bell Inn" }
      )
    ).toEqual({ regularDays: [], specialDates: [] })
  })
})

describe("detectGoogleChanges", () => {
  const ourName: WatchedValue = { field: "name", value: "The Bell" }
  const googleName: WatchedValue = { field: "name", value: "Bell Pub" }
  const ourPhone: WatchedValue = { field: "phone", value: "01223 000000" }
  const googlePhone: WatchedValue = { field: "phone", value: "01223 999999" }

  it("detects a Google-only edit without local edits", () => {
    const [change, ...rest] = detectGoogleChanges({
      protectedFields: WATCHED_FIELDS,
      observations: [
        { ours: ourName, google: googleName, movement: GOOGLE_MOVED },
      ],
    })
    expect(rest).toEqual([])
    expect(change).toMatchObject({
      field: "name",
      localEdits: false,
      oursHash: watchedValueHash(ourName),
      googleHash: watchedValueHash(googleName),
      regularDays: [],
      specialDates: [],
    })
  })

  it("detects a conflict and flags local edits", () => {
    const changes = detectGoogleChanges({
      protectedFields: WATCHED_FIELDS,
      observations: [
        { ours: ourName, google: googleName, movement: BOTH_MOVED },
      ],
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: "name", localEdits: true })
  })

  it("never detects core-dirty or in-sync fields", () => {
    expect(
      detectGoogleChanges({
        protectedFields: WATCHED_FIELDS,
        observations: [
          { ours: ourName, google: googleName, movement: OURS_MOVED },
          { ours: ourPhone, google: googlePhone, movement: NONE_MOVED },
        ],
      })
    ).toEqual([])
  })

  it("only detects protected fields", () => {
    const changes = detectGoogleChanges({
      protectedFields: ["phone"],
      observations: [
        { ours: ourName, google: googleName, movement: GOOGLE_MOVED },
        { ours: ourPhone, google: googlePhone, movement: GOOGLE_MOVED },
      ],
    })
    expect(changes.map((change) => change.field)).toEqual(["phone"])
  })

  it("ignores Google-dirty fields whose values are equal after normalisation", () => {
    const at2400 = week((day) =>
      day === 5 ? [{ opensAt: "18:00", closesAt: "24:00" }] : null
    )
    const at0000 = week((day) =>
      day === 5 ? [{ opensAt: "18:00", closesAt: "00:00" }] : null
    )
    const lunch = {
      effectiveDate: "2026-12-24",
      isClosed: false,
      opensAt: "12:00",
      closesAt: "15:00",
    }
    const evening = { ...lunch, opensAt: "18:00", closesAt: "22:00" }
    expect(
      detectGoogleChanges({
        protectedFields: WATCHED_FIELDS,
        observations: [
          {
            ours: regular(at2400),
            google: regular(at0000),
            movement: GOOGLE_MOVED,
          },
          {
            ours: special([lunch, evening]),
            google: special([
              { ...evening, endDate: "2026-12-24" },
              { ...lunch, endDate: "2026-12-24" },
            ]),
            movement: GOOGLE_MOVED,
          },
          {
            ours: { field: "website", value: "https://example.com" },
            google: { field: "website", value: "https://Example.com/" },
            movement: GOOGLE_MOVED,
          },
        ],
      })
    ).toEqual([])
  })

  it("fills the changed weekdays and dates for hours fields", () => {
    const googleRegular = lunchAndDinner.map((day) =>
      day.dayOfWeek === 1 ? { ...day, isClosed: true, periods: [] } : day
    )
    const googleSpecial: Special = [
      { ...christmasClosed[0]!, effectiveDate: "2026-12-26" },
    ]
    const changes = detectGoogleChanges({
      protectedFields: WATCHED_FIELDS,
      observations: [
        {
          ours: regular(lunchAndDinner),
          google: regular(googleRegular),
          movement: GOOGLE_MOVED,
        },
        {
          ours: special(christmasClosed),
          google: special(googleSpecial),
          movement: BOTH_MOVED,
        },
      ],
    })
    expect(changes).toHaveLength(2)
    expect(changes.find((c) => c.field === "regularHours")).toMatchObject({
      localEdits: false,
      regularDays: [1],
      specialDates: [],
    })
    expect(changes.find((c) => c.field === "specialHours")).toMatchObject({
      localEdits: true,
      regularDays: [],
      specialDates: ["2026-12-25", "2026-12-26"],
    })
  })
})

describe("detectGoogleChanges with moved parts", () => {
  it("reports only the parts Google moved, never our own unpublished ones", () => {
    const ours = week((day) =>
      day === 1 || day === 2 ? [{ opensAt: "12:00", closesAt: "22:00" }] : null
    )
    const google = week((day) =>
      day === 1
        ? [{ opensAt: "12:00", closesAt: "23:00" }]
        : day === 2
          ? [{ opensAt: "11:00", closesAt: "22:00" }]
          : null
    )
    const [change] = detectGoogleChanges({
      protectedFields: WATCHED_FIELDS,
      observations: [
        {
          ours: regular(ours),
          google: regular(google),
          movement: {
            googleMoved: true,
            oursMoved: true,
            googleParts: ["regular:1"],
          },
        },
      ],
    })
    expect(change).toMatchObject({ regularDays: [1], localEdits: true })
  })

  it("raises nothing when the parts Google moved match ours after normalisation", () => {
    const ours = week((day) =>
      day === 5
        ? [{ opensAt: "18:00", closesAt: "24:00" }]
        : day === 6
          ? [{ opensAt: "12:00", closesAt: "15:00" }]
          : null
    )
    const google = week((day) =>
      day === 5 ? [{ opensAt: "18:00", closesAt: "00:00" }] : null
    )
    expect(
      detectGoogleChanges({
        protectedFields: WATCHED_FIELDS,
        observations: [
          {
            ours: regular(ours),
            google: regular(google),
            movement: {
              googleMoved: true,
              oursMoved: true,
              googleParts: ["regular:5"],
            },
          },
        ],
      })
    ).toEqual([])
  })
})

describe("profileFieldMovement", () => {
  const hashes = {
    canonicalHash: "c1",
    googleHash: "g2",
    baselineCanonicalHash: "c1",
    baselineGoogleHash: "g1",
  }

  it("says Google moved when its hash left the baseline", () => {
    expect(profileFieldMovement(hashes)).toEqual({
      googleMoved: true,
      oursMoved: false,
    })
  })

  it("knows nothing moved without a baseline", () => {
    expect(
      profileFieldMovement({
        ...hashes,
        baselineCanonicalHash: null,
        baselineGoogleHash: null,
      })
    ).toEqual({ googleMoved: false, oursMoved: false })
  })

  it("flags our own edits alongside Google's", () => {
    expect(profileFieldMovement({ ...hashes, canonicalHash: "c2" })).toEqual({
      googleMoved: true,
      oursMoved: true,
    })
  })
})

describe("hoursFieldMovement", () => {
  const whole = {
    canonicalHash: "c",
    googleHash: "g2",
    baselineCanonicalHash: "c",
    baselineGoogleHash: "g1",
  }

  it("falls back to the whole-schedule hashes without a part baseline", () => {
    expect(
      hoursFieldMovement({
        field: "regularHours",
        canonicalParts: { "regular:1": "a" },
        googleParts: { "regular:1": "b" },
        baseline: null,
        whole,
      })
    ).toEqual({ googleMoved: true, oursMoved: false })
  })

  it("lists only the parts of its own field that Google moved", () => {
    const movement = hoursFieldMovement({
      field: "regularHours",
      canonicalParts: {
        "regular:1": "a",
        "regular:2": "x",
        "special:2026-12-25": "s",
      },
      googleParts: {
        "regular:1": "b",
        "regular:2": "y",
        "special:2026-12-25": "t",
      },
      baseline: {
        complete: true,
        parts: {
          "regular:1": ["a", "a"],
          "regular:2": ["z", "y"],
          "special:2026-12-25": ["s", "s"],
        },
      },
      whole,
    })
    expect(movement).toEqual({
      googleMoved: true,
      oursMoved: true,
      googleParts: ["regular:1"],
    })
  })

  it("skips a differing part an incomplete baseline has no history for", () => {
    expect(
      hoursFieldMovement({
        field: "specialHours",
        canonicalParts: {},
        googleParts: { "special:2026-12-31": "g" },
        baseline: { complete: false, parts: {} },
        whole,
      })
    ).toEqual({ googleMoved: false, oursMoved: false, googleParts: [] })
  })

  it("treats a date Google added as moved under a complete baseline", () => {
    expect(
      hoursFieldMovement({
        field: "specialHours",
        canonicalParts: {},
        googleParts: { "special:2026-12-31": "g" },
        baseline: { complete: true, parts: {} },
        whole,
      })
    ).toEqual({
      googleMoved: true,
      oursMoved: false,
      googleParts: ["special:2026-12-31"],
    })
  })
})

describe("categoryMovement", () => {
  it("seeds the baseline the first time a category is seen", () => {
    expect(
      categoryMovement({ baseline: null, google: "categories/gcid:pub" })
    ).toEqual({ movement: NONE_MOVED, seed: true })
  })

  it("has not moved when Google matches the baseline", () => {
    expect(
      categoryMovement({
        baseline: "categories/gcid:pub",
        google: "categories/gcid:pub",
      })
    ).toEqual({ movement: NONE_MOVED, seed: false })
  })

  it("has moved when Google differs from the baseline", () => {
    expect(
      categoryMovement({
        baseline: "categories/gcid:pub",
        google: "categories/gcid:restaurant",
      })
    ).toEqual({ movement: GOOGLE_MOVED, seed: false })
  })
})

describe("planLedger", () => {
  const everything = {
    observedFields: WATCHED_FIELDS,
    protectedFields: WATCHED_FIELDS,
  }
  function detected(field: WatchedValue["field"], googleValue: string) {
    const [change] = detectGoogleChanges({
      protectedFields: WATCHED_FIELDS,
      observations: [
        {
          ours: { field, value: "ours" } as WatchedValue,
          google: { field, value: googleValue } as WatchedValue,
          movement: GOOGLE_MOVED,
        },
      ],
    })
    return change!
  }

  it("inserts detections that have no live row", () => {
    const name = detected("name", "Bell Pub")
    expect(planLedger({ live: [], detected: [name], ...everything })).toEqual({
      insert: [name],
      keep: [],
      supersede: [],
      resolve: [],
    })
  })

  it("keeps a live row for the same field and value instead of inserting it again", () => {
    const name = detected("name", "Bell Pub")
    expect(
      planLedger({
        live: [
          {
            id: "row-1",
            field: "name",
            googleHash: name.googleHash,
            status: "open",
          },
        ],
        detected: [name],
        ...everything,
      })
    ).toEqual({ insert: [], keep: ["row-1"], supersede: [], resolve: [] })
  })

  it("supersedes a live row when Google changed the field to another value", () => {
    const name = detected("name", "Bell Pub")
    const older = detected("name", "Bell Bar")
    expect(
      planLedger({
        live: [
          {
            id: "row-1",
            field: "name",
            googleHash: older.googleHash,
            status: "reverting",
          },
        ],
        detected: [name],
        ...everything,
      })
    ).toEqual({ insert: [name], keep: [], supersede: ["row-1"], resolve: [] })
  })

  it("resolves live rows whose field is no longer detected", () => {
    const phone = detected("phone", "01223 999999")
    expect(
      planLedger({
        live: [
          {
            id: "row-1",
            field: "name",
            googleHash: "a".repeat(64),
            status: "open",
          },
          {
            id: "row-2",
            field: "website",
            googleHash: "b".repeat(64),
            status: "reverting",
          },
        ],
        detected: [phone],
        ...everything,
      })
    ).toEqual({
      insert: [phone],
      keep: [],
      supersede: [],
      resolve: [
        { id: "row-1", reason: "google_restored" },
        { id: "row-2", reason: "google_restored" },
      ],
    })
  })

  it("ignores rows that are no longer live", () => {
    const name = detected("name", "Bell Pub")
    expect(
      planLedger({
        live: [
          {
            id: "row-1",
            field: "name",
            googleHash: name.googleHash,
            status: "accepted",
          },
          {
            id: "row-2",
            field: "phone",
            googleHash: "c".repeat(64),
            status: "resolved",
          },
          {
            id: "row-3",
            field: "website",
            googleHash: "d".repeat(64),
            status: "superseded",
          },
        ],
        detected: [name],
        ...everything,
      })
    ).toEqual({ insert: [name], keep: [], supersede: [], resolve: [] })
  })
})

describe("planLedger without a full observation", () => {
  const row = {
    id: "row-1",
    field: "regularHours" as const,
    googleHash: "a".repeat(64),
    status: "reverting" as const,
  }

  it("leaves a field this run did not observe as it is", () => {
    expect(
      planLedger({
        live: [row],
        detected: [],
        observedFields: ["name", "phone"],
        protectedFields: WATCHED_FIELDS,
      })
    ).toEqual({ insert: [], keep: ["row-1"], supersede: [], resolve: [] })
  })

  it("resolves a field that is no longer protected as unwatched", () => {
    expect(
      planLedger({
        live: [row],
        detected: [],
        observedFields: WATCHED_FIELDS,
        protectedFields: ["name"],
      })
    ).toEqual({
      insert: [],
      keep: [],
      supersede: [],
      resolve: [{ id: "row-1", reason: "unwatched" }],
    })
  })
})

describe("googleChangeSubjectId", () => {
  const base = {
    organisationId: "org-1",
    locationId: "loc-1",
    changeId: "change-1",
  }

  it("is stable for identical input", () => {
    expect(googleChangeSubjectId(base)).toBe(googleChangeSubjectId({ ...base }))
  })

  it("is a new subject for every detected change", () => {
    expect(googleChangeSubjectId({ ...base, changeId: "change-2" })).not.toBe(
      googleChangeSubjectId(base)
    )
  })
})
