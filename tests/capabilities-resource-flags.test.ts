import { describe, expect, it } from "vitest"

import { resourceWritesEnabled } from "@/lib/server/capabilities"

// The per-resource write flags handed to buildResources must mirror the
// kill switch each lib/server module checks at its own provider boundary,
// so a paused surface shows the UI's paused-write notice (reasonCode
// "publishing_paused") instead of silently failing at publish time.

const allOn = {
  PUBLISH_ENABLED: true,
  GBP_PROFILE_WRITES_ENABLED: true,
  GBP_POSTS_ENABLED: true,
  GBP_MEDIA_ENABLED: true,
  GBP_PLACE_ACTIONS_ENABLED: true,
  GBP_FOOD_MENUS_ENABLED: true,
  GBP_PERFORMANCE_ENABLED: true,
  GBP_KEYWORDS_ENABLED: true,
}

describe("resourceWritesEnabled", () => {
  it("enables every resource when all switches are on", () => {
    expect(Object.values(resourceWritesEnabled(allOn)).every(Boolean)).toBe(true)
  })

  it("pauses every resource when the global publish control is off", () => {
    const flags = resourceWritesEnabled({ ...allOn, PUBLISH_ENABLED: false })
    expect(Object.values(flags).some(Boolean)).toBe(false)
  })

  it("pauses only the Business Information consoles for GBP_PROFILE_WRITES_ENABLED", () => {
    const flags = resourceWritesEnabled({ ...allOn, GBP_PROFILE_WRITES_ENABLED: false })
    expect(flags).toEqual({
      profile: false,
      hours: false,
      businessInformation: false,
      industry: false,
      administration: false,
      photos: true,
      posts: true,
      menu: true,
      booking: true,
      performance: true,
    })
  })

  it("maps media, posts, menus, booking and performance to their own switches", () => {
    expect(resourceWritesEnabled({ ...allOn, GBP_MEDIA_ENABLED: false })).toMatchObject({
      photos: false,
      posts: true,
    })
    expect(resourceWritesEnabled({ ...allOn, GBP_POSTS_ENABLED: false })).toMatchObject({
      posts: false,
      photos: true,
    })
    expect(resourceWritesEnabled({ ...allOn, GBP_FOOD_MENUS_ENABLED: false })).toMatchObject({
      menu: false,
      profile: true,
    })
    expect(resourceWritesEnabled({ ...allOn, GBP_PLACE_ACTIONS_ENABLED: false })).toMatchObject({
      booking: false,
      profile: true,
    })
    expect(resourceWritesEnabled({ ...allOn, GBP_PERFORMANCE_ENABLED: false })).toMatchObject({
      performance: false,
      profile: true,
    })
  })
})
