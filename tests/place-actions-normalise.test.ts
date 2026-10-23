import { describe, expect, it } from "vitest"

import { normalizeGooglePlaceActionLink } from "@/lib/server/google/place-actions"

/**
 * How a Google place-action link is read (lib/server/google/place-actions.ts):
 * a link without its identity, address or a modelled type is not a link the
 * editor can manage, and every flag defaults to the safe side.
 */

const link = {
  name: "locations/1/placeActionLinks/1",
  providerType: "MERCHANT",
  isEditable: true,
  uri: "https://book.example.co.uk",
  placeActionType: "DINING_RESERVATION",
  isPreferred: true,
  createTime: "2026-10-01T09:00:00Z",
  updateTime: "2026-10-02T09:00:00Z",
}

describe("normalizeGooglePlaceActionLink", () => {
  it("keeps a complete link as Google sent it", () => {
    expect(normalizeGooglePlaceActionLink(link)).toEqual(link)
  })

  it("defaults the provider, the flags and the times to the safe side", () => {
    expect(
      normalizeGooglePlaceActionLink({
        name: link.name,
        uri: link.uri,
        placeActionType: link.placeActionType,
        isEditable: "true",
        isPreferred: 1,
        createTime: 0,
      })
    ).toEqual({
      name: link.name,
      providerType: "PROVIDER_TYPE_UNSPECIFIED",
      isEditable: false,
      uri: link.uri,
      placeActionType: "DINING_RESERVATION",
      isPreferred: false,
      createTime: null,
      updateTime: null,
    })
  })

  it("drops a link without a name, an address or a modelled type", () => {
    for (const value of [
      null,
      "locations/1/placeActionLinks/1",
      [link],
      { ...link, name: 1 },
      { ...link, uri: "" },
      { ...link, uri: undefined },
      { ...link, placeActionType: "FUTURE_ACTION" },
      { ...link, placeActionType: undefined },
    ]) {
      expect(
        normalizeGooglePlaceActionLink(value),
        JSON.stringify(value)
      ).toBeNull()
    }
  })
})
