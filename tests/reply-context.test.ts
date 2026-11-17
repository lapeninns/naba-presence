import { describe, expect, it } from "vitest"

import { menuItemNames, venueContextFrom } from "@/lib/server/reply-context"

const googleMenus = [
  {
    labels: [{ displayName: "Main menu" }],
    sections: [
      {
        labels: [{ displayName: "Mains" }],
        items: [
          { labels: [{ displayName: "Steak and ale pie" }] },
          { labels: [{ displayName: "  Fish   and chips " }] },
          { labels: [{ displayName: "Steak and ale pie" }] },
          { labels: [] },
        ],
      },
      { items: [{ labels: [{ displayName: "Sticky toffee pudding" }] }] },
    ],
  },
]

describe("venue context for a reply", () => {
  it("reads dish names from a Google food-menus payload, once each", () => {
    expect(menuItemNames(googleMenus)).toEqual([
      "Steak and ale pie",
      "Fish and chips",
      "Sticky toffee pudding",
    ])
  })

  it("gives no menu when there is none, or it is not a menu", () => {
    expect(menuItemNames(null)).toEqual([])
    expect(menuItemNames("menu")).toEqual([])
    expect(menuItemNames({ items: "soup" })).toEqual([])
  })

  it("caps the list", () => {
    const many = [
      {
        sections: [
          {
            items: Array.from({ length: 200 }, (_, index) => ({
              labels: [{ displayName: `Dish ${index}` }],
            })),
          },
        ],
      },
    ]
    expect(menuItemNames(many)).toHaveLength(60)
  })

  it("builds the venue's facts from its own address, profile and menu", () => {
    expect(
      venueContextFrom({
        name: "The Old Crown",
        address: { locality: "Girton", postalCode: "CB3 0QD" },
        googleLocation: {
          categories: { primaryCategory: { displayName: "Pub" } },
          profile: { description: "A village pub.\nCask ales." },
        },
        menuPayload: googleMenus,
      })
    ).toEqual({
      name: "The Old Crown",
      locality: "Girton",
      category: "Pub",
      description: "A village pub. Cask ales.",
      menuItems: [
        "Steak and ale pie",
        "Fish and chips",
        "Sticky toffee pudding",
      ],
    })
  })

  it("leaves a fact that was never read as absent", () => {
    expect(
      venueContextFrom({
        name: "The Railway",
        address: null,
        googleLocation: null,
        menuPayload: null,
      })
    ).toEqual({
      name: "The Railway",
      locality: null,
      category: null,
      description: null,
      menuItems: [],
    })
  })
})
