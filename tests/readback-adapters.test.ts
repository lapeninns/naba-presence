import { describe, expect, it } from "vitest"

import {
  attributeMismatches,
  attributesMatch,
  maskedAttributeBaseline,
} from "@/lib/domain/readback/attributes"
import {
  businessInfoMismatches,
  phonesMatch,
} from "@/lib/domain/readback/business-info"
import {
  containsExpected,
  normalizeText,
  normalizeUri,
} from "@/lib/domain/readback/compare"
import {
  industryMismatches,
  maskedFieldBaseline,
} from "@/lib/domain/readback/industry"
import {
  localPostMatches,
  localPostMismatches,
} from "@/lib/domain/readback/posts"
import { lodgingMutationSchema } from "@/lib/contracts/location-industry"

describe("shared comparison", () => {
  it("normalises text and links the way Google echoes them", () => {
    expect(normalizeText("  Village pub \r\nwith rooms  ")).toBe(
      "Village pub\nwith rooms"
    )
    expect(normalizeUri("HTTPS://Old-Crown.Example:443/")).toBe(
      "https://old-crown.example"
    )
    expect(normalizeUri("https://x.example/menu/")).toBe(
      "https://x.example/menu"
    )
  })

  it("ignores fields Google adds but never treats false as unset", () => {
    expect(
      containsExpected(
        { petsAllowed: true, petsAllowedException: "UNSPECIFIED" },
        { petsAllowed: true }
      )
    ).toBe(true)
    expect(containsExpected({}, { petsAllowed: false })).toBe(false)
    expect(
      containsExpected({ petsAllowed: false }, { petsAllowed: false })
    ).toBe(true)
    expect(containsExpected(undefined, {})).toBe(true)
  })

  it("compares a TimeOfDay with Google's omitted zero parts", () => {
    expect(
      containsExpected(
        { hours: 15 },
        { hours: 15, minutes: 0, seconds: 0, nanos: 0 }
      )
    ).toBe(true)
    expect(containsExpected({ hours: 16 }, { hours: 15, minutes: 0 })).toBe(
      false
    )
  })
})

describe("business information readback", () => {
  const payload = {
    title: "Old Crown ",
    phoneNumbers: { primaryPhone: "01223 000000" },
    websiteUri: "https://old-crown.example/",
    categories: {
      primaryCategory: { name: "categories/gcid:pub" },
      additionalCategories: [
        { name: "categories/gcid:restaurant" },
        { name: "categories/gcid:inn" },
      ],
    },
  }

  it("is equal after normalisation", () => {
    const readback = {
      title: "Old Crown",
      phoneNumbers: { primaryPhone: "+44 1223 000000" },
      websiteUri: "https://old-crown.example",
      categories: {
        primaryCategory: { name: "categories/gcid:pub", displayName: "Pub" },
        additionalCategories: [
          { name: "categories/gcid:inn", displayName: "Inn" },
          { name: "categories/gcid:restaurant", displayName: "Restaurant" },
        ],
      },
    }
    expect(
      businessInfoMismatches(
        ["title", "phoneNumbers", "websiteUri", "categories"],
        readback,
        payload
      )
    ).toEqual([])
  })

  it("reports a real difference on a masked field only", () => {
    const readback = {
      title: "The Old Crown",
      phoneNumbers: { primaryPhone: "+44 1223 999999" },
      // Outside the mask: an unrelated Google change is not compared.
      storeCode: "changed-on-google",
    }
    expect(
      businessInfoMismatches(["title", "phoneNumbers"], readback, payload)
    ).toEqual(["title", "phoneNumbers"])
  })

  it("treats a cleared website as matching an absent one", () => {
    expect(
      businessInfoMismatches(["websiteUri"], {}, { websiteUri: "" })
    ).toEqual([])
  })

  it("matches phone numbers across Google's international rewrite only", () => {
    expect(phonesMatch("+441223000000", "01223 000000")).toBe(true)
    expect(phonesMatch("+44 1223 000001", "01223 000000")).toBe(false)
    expect(phonesMatch("01223 000000", "01224 000000")).toBe(false)
  })

  it("matches an address across postcode and region case", () => {
    const payload = {
      storefrontAddress: {
        regionCode: "gb",
        postalCode: "cb1 2ab",
        addressLines: ["1 High Street"],
      },
    }
    const stored = (postalCode: string, line = "1 High Street") => ({
      storefrontAddress: {
        regionCode: "GB",
        postalCode,
        addressLines: [line],
        languageCode: "en",
      },
    })
    expect(
      businessInfoMismatches(["storefrontAddress"], stored("CB1 2AB"), payload)
    ).toEqual([])
    expect(
      businessInfoMismatches(["storefrontAddress"], stored("CB1 2AC"), payload)
    ).toEqual(["storefrontAddress"])
    expect(
      businessInfoMismatches(
        ["storefrontAddress"],
        stored("CB1 2AB", "2 High Street"),
        payload
      )
    ).toEqual(["storefrontAddress"])
  })

  it("matches service-area places as a set", () => {
    const area = (ids: string[], regionCode = "GB") => ({
      serviceArea: {
        businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
        regionCode,
        places: { placeInfos: ids.map((placeId) => ({ placeId })) },
      },
    })
    expect(
      businessInfoMismatches(
        ["serviceArea"],
        area(["p2", "p1"]),
        area(["p1", "p2"], "gb")
      )
    ).toEqual([])
    expect(
      businessInfoMismatches(["serviceArea"], area(["p1"]), area(["p1", "p2"]))
    ).toEqual(["serviceArea"])
  })
})

describe("attribute readback", () => {
  const mask = [
    "attributes/has_wheelchair_accessible_entrance",
    "attributes/pay_credit_card_types_accepted",
    "attributes/url_menu",
  ]
  const payload = [
    { name: "attributes/has_wheelchair_accessible_entrance", values: [false] },
    {
      name: "attributes/pay_credit_card_types_accepted",
      repeatedEnumValue: {
        setValues: ["visa", "mastercard"],
        unsetValues: ["amex"],
      },
    },
    {
      name: "attributes/url_menu",
      uriValues: [{ uri: "https://x.example/menu/" }],
    },
  ]

  it("is equal after normalisation, ignoring unrelated drift", () => {
    const readback = {
      name: "locations/1/attributes",
      attributes: [
        {
          name: "attributes/has_wheelchair_accessible_entrance",
          valueType: "BOOL",
          values: [false],
        },
        {
          name: "attributes/pay_credit_card_types_accepted",
          valueType: "REPEATED_ENUM",
          repeatedEnumValue: {
            setValues: ["mastercard", "visa"],
            unsetValues: ["amex"],
          },
        },
        {
          name: "attributes/url_menu",
          valueType: "URL",
          uriValues: [{ uri: "https://x.example/menu", uriType: "MENU" }],
        },
        // Not in the mask: changed on Google, never compared.
        { name: "attributes/has_live_music", values: [true] },
      ],
    }
    expect(attributeMismatches(mask, payload, readback)).toEqual([])
  })

  it("keeps false distinct from unset", () => {
    const readback = { attributes: [] }
    expect(attributeMismatches(mask.slice(0, 1), payload, readback)).toEqual([
      "attributes/has_wheelchair_accessible_entrance",
    ])
    // The other way round: a masked attribute absent from the payload is a
    // deletion, and Google still holding `false` is not that.
    expect(
      attributesMatch(mask.slice(0, 1), [], {
        attributes: [
          {
            name: "attributes/has_wheelchair_accessible_entrance",
            values: [false],
          },
        ],
      })
    ).toBe(false)
    expect(attributesMatch(mask.slice(0, 1), [], { attributes: [] })).toBe(true)
  })

  it("compares repeated enum set and unset values", () => {
    const readback = {
      attributes: [
        {
          name: "attributes/pay_credit_card_types_accepted",
          repeatedEnumValue: { setValues: ["visa", "mastercard", "amex"] },
        },
      ],
    }
    expect(attributeMismatches(mask.slice(1, 2), payload, readback)).toEqual([
      "attributes/pay_credit_card_types_accepted",
    ])
  })

  it("compares uriValues", () => {
    const readback = {
      attributes: [
        {
          name: "attributes/url_menu",
          uriValues: [{ uri: "https://y.example/menu" }],
        },
      ],
    }
    expect(attributeMismatches(mask.slice(2), payload, readback)).toEqual([
      "attributes/url_menu",
    ])
  })

  it("baselines only the masked attributes", () => {
    const before = {
      attributes: [
        {
          name: "attributes/url_menu",
          uriValues: [{ uri: "https://x.example" }],
        },
        { name: "attributes/has_live_music", values: [true] },
      ],
    }
    const after = {
      attributes: [
        {
          name: "attributes/url_menu",
          uriValues: [{ uri: "https://x.example" }],
        },
        { name: "attributes/has_live_music", values: [false] },
      ],
    }
    expect(maskedAttributeBaseline(["attributes/url_menu"], before)).toEqual(
      maskedAttributeBaseline(["attributes/url_menu"], after)
    )
    expect(
      maskedAttributeBaseline(["attributes/has_live_music"], before)
    ).not.toEqual(maskedAttributeBaseline(["attributes/has_live_music"], after))
  })
})

describe("industry readback", () => {
  const payload = {
    pets: { petsAllowed: false, petsAllowedFree: true },
    policies: { checkinTime: { hours: 15, minutes: 0, seconds: 0, nanos: 0 } },
  }

  it("is equal after normalisation, ignoring Google-added fields", () => {
    const readback = {
      name: "locations/1/lodging",
      metadata: { updateTime: "2026-10-10T00:00:00Z" },
      pets: {
        petsAllowed: false,
        petsAllowedFree: true,
        petsAllowedException: "UNSPECIFIED",
      },
      policies: { checkinTime: { hours: 15 } },
      // Outside the mask.
      pools: { pool: true },
    }
    expect(industryMismatches(["pets", "policies"], payload, readback)).toEqual(
      []
    )
  })

  it("reports a masked difference, including false read back as unset", () => {
    const readback = {
      pets: { petsAllowedFree: true },
      policies: { checkinTime: { hours: 16 } },
    }
    expect(industryMismatches(["pets", "policies"], payload, readback)).toEqual(
      ["pets", "policies"]
    )
  })

  it("compares dotted mask paths", () => {
    expect(
      industryMismatches(["pets.petsAllowed"], payload, {
        pets: { petsAllowed: false, petsAllowedFree: false },
      })
    ).toEqual([])
  })

  describe("lodging groups written whole", () => {
    const whole = { wholeGroups: true }

    it("still ignores Google's own siblings and fields outside the mask", () => {
      const readback = {
        metadata: { updateTime: "2026-10-10T00:00:00Z" },
        pets: {
          petsAllowed: false,
          petsAllowedFree: true,
          petsAllowedException: "UNSPECIFIED",
        },
        policies: { checkinTime: { hours: 15 } },
        pools: { pool: true },
      }
      expect(
        industryMismatches(["pets", "policies"], payload, readback, whole)
      ).toEqual([])
    })

    it("reports a cleared check-in time that Google kept", () => {
      // The editor clears the time as `undefined`, which JSON drops.
      const cleared = JSON.parse(
        JSON.stringify({
          policies: { checkinTime: undefined, checkoutTime: { hours: 11 } },
        })
      ) as Record<string, unknown>
      const readback = {
        policies: {
          checkinTime: { hours: 15 },
          checkoutTime: { hours: 11 },
        },
      }
      expect(industryMismatches(["policies"], cleared, readback)).toEqual([])
      expect(
        industryMismatches(["policies"], cleared, readback, whole)
      ).toEqual(["policies"])
      expect(
        industryMismatches(
          ["policies"],
          cleared,
          { policies: { checkoutTime: { hours: 11 } } },
          whole
        )
      ).toEqual([])
    })

    it("reports a group sent as {} that Google kept", () => {
      const readback = { pets: { petsAllowed: true } }
      expect(
        industryMismatches(["pets"], { pets: {} }, readback, whole)
      ).toEqual(["pets"])
      expect(
        industryMismatches(
          ["pets"],
          { pets: {} },
          { pets: { petsAllowedException: "UNSPECIFIED" } },
          whole
        )
      ).toEqual([])
      expect(industryMismatches(["pets"], { pets: {} }, {}, whole)).toEqual([])
    })
  })

  it("baselines only the masked groups", () => {
    expect(
      maskedFieldBaseline(["pets"], { pets: { a: 1 }, pools: { b: 1 } })
    ).toEqual(
      maskedFieldBaseline(["pets"], { pets: { a: 1 }, pools: { b: 2 } })
    )
  })
})

describe("lodging update contract", () => {
  const base = {
    operation: "update_lodging" as const,
    confirmation: "publish_industry_data_to_google" as const,
    expectedGoogleHash: "a".repeat(64),
  }

  it("accepts allowlisted groups with a matching mask", () => {
    expect(
      lodgingMutationSchema.safeParse({
        ...base,
        updateMask: ["pets", "policies.checkinTime"],
        payload: {
          pets: { petsAllowed: true },
          policies: { checkinTime: { hours: 15 } },
        },
      }).success
    ).toBe(true)
  })

  it.each([
    ["an unknown group in the mask", ["metadata"], { metadata: {} }],
    ["an unknown group in the payload", ["pets"], { pets: {}, name: "x" }],
    [
      "a payload group the mask does not write",
      ["pets"],
      { pets: {}, pools: {} },
    ],
    [
      "a masked group missing from the payload",
      ["pets", "pools"],
      { pets: {} },
    ],
  ])("refuses %s", (_name, updateMask, payload) => {
    expect(
      lodgingMutationSchema.safeParse({ ...base, updateMask, payload }).success
    ).toBe(false)
  })

  it("requires the expected baseline", () => {
    expect(
      lodgingMutationSchema.safeParse({
        operation: "update_lodging",
        confirmation: "publish_industry_data_to_google",
        updateMask: ["pets"],
        payload: { pets: {} },
      }).success
    ).toBe(false)
  })
})

describe("local post readback", () => {
  const intended = {
    topicType: "EVENT",
    languageCode: "en-GB",
    summary: "Quiz night\r\n",
    callToAction: { actionType: "LEARN_MORE", url: "https://x.example/quiz/" },
    event: {
      title: "Quiz",
      schedule: {
        startDate: { year: 2026, month: 11, day: 5 },
        endDate: { year: 2026, month: 11, day: 5 },
        startTime: { hours: 19, minutes: 0 },
        endTime: { hours: 22, minutes: 30 },
      },
    },
  }

  it("is equal after normalisation, ignoring output-only fields", () => {
    const live = {
      name: "accounts/1/locations/2/localPosts/3",
      state: "LIVE",
      searchUrl: "https://posts.example/3",
      topicType: "EVENT",
      languageCode: "en-gb",
      summary: "Quiz night",
      callToAction: { actionType: "LEARN_MORE", url: "https://x.example/quiz" },
      event: {
        title: "Quiz ",
        schedule: {
          startDate: { year: 2026, month: 11, day: 5 },
          endDate: { year: 2026, month: 11, day: 5 },
          startTime: { hours: 19 },
          endTime: { hours: 22, minutes: 30 },
        },
      },
    }
    expect(localPostMismatches(live, intended)).toEqual([])
  })

  it("reports an event schedule mismatch", () => {
    const live = {
      ...intended,
      event: {
        ...intended.event,
        schedule: { ...intended.event.schedule, startTime: { hours: 20 } },
      },
    }
    expect(localPostMismatches(live, intended)).toEqual(["event"])
  })

  it("reports offer field mismatches and an offer Google kept", () => {
    const offer = {
      topicType: "OFFER",
      languageCode: "en-GB",
      summary: "Two for one",
      offer: {
        couponCode: "TWO4ONE",
        redeemOnlineUrl: "https://x.example/redeem",
        termsConditions: "Weekdays only",
      },
    }
    expect(
      localPostMismatches(
        { ...offer, offer: { ...offer.offer, couponCode: "OTHER" } },
        offer
      )
    ).toEqual(["offer"])
    expect(
      localPostMatches(
        { ...offer },
        { topicType: "OFFER", languageCode: "en-GB", summary: "Two for one" }
      )
    ).toBe(false)
  })

  it("reports summary, topic and call-to-action differences", () => {
    expect(
      localPostMismatches(
        {
          ...intended,
          topicType: "STANDARD",
          summary: "Quiz night tonight",
          callToAction: { actionType: "CALL" },
        },
        intended
      )
    ).toEqual(["topicType", "summary", "callToAction"])
  })
})

describe("local post identification in Google's list", () => {
  const intended = {
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Late opening",
    callToAction: { actionType: "LEARN_MORE", url: "https://x.example/menu" },
  }

  it("adopts a listing that omits the call to action", () => {
    const listed = {
      name: "p",
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Late opening",
    }
    expect(localPostMatches(listed, intended, "identify")).toBe(true)
    // An update readback is strict about the same omission.
    expect(localPostMatches(listed, intended)).toBe(false)
  })

  it("never adopts a listing that contradicts the intent", () => {
    expect(
      localPostMatches(
        { ...intended, callToAction: { actionType: "CALL" } },
        intended,
        "identify"
      )
    ).toBe(false)
    expect(
      localPostMatches(
        { ...intended, summary: "Early closing" },
        intended,
        "identify"
      )
    ).toBe(false)
  })
})
