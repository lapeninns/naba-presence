import { afterEach, describe, expect, it, vi } from "vitest"

import { publishBusinessAttributes, publishBusinessInformation } from "@/lib/api/location-business-information"
import { createPlaceAction, deletePlaceAction, updatePlaceAction } from "@/lib/api/location-booking"
import { matchGoogleLocation, runAdministrationOperation } from "@/lib/api/location-administration"
import { publishIndustry } from "@/lib/api/location-industry"
import { publishFoodMenus, saveFoodMenus } from "@/lib/api/location-menu"
import {
  placeActionCreateRequestSchema,
  placeActionDeleteRequestSchema,
  placeActionUpdateRequestSchema,
} from "@/lib/contracts/location-booking"
import { administrationMatchSchema, administrationMutationSchema } from "@/lib/contracts/location-administration"
import { businessInformationPatchSchema } from "@/lib/contracts/location-business-information"
import { publishFoodMenusSchema, saveFoodMenusSchema } from "@/lib/contracts/location-food-menus"
import { industryMutationSchema } from "@/lib/contracts/location-industry"

const HASH = "a".repeat(64)

/** Captures the JSON body a client function sends. */
async function sentBody(run: () => Promise<unknown>) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify({ id: "m1", status: "succeeded", idempotent: false, saved: true, revision: "2", matches: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  )
  vi.stubGlobal("fetch", fetchMock)
  await run()
  return JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as unknown
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("location management contracts: client bodies parse under the route schemas", () => {
  it("business information", async () => {
    expect(
      businessInformationPatchSchema.parse(
        await sentBody(() => publishBusinessInformation("loc", { updateMask: ["title"], payload: { title: "x" }, expectedGoogleHash: HASH }))
      ).operation
    ).toBe("update_location")
    expect(
      businessInformationPatchSchema.parse(
        await sentBody(() =>
          publishBusinessAttributes("loc", { attributeMask: ["attributes/wifi"], attributes: [{ name: "attributes/wifi", values: [true] }], expectedGoogleHash: HASH })
        )
      ).operation
    ).toBe("update_attributes")
  })

  it("industry", async () => {
    const body = await sentBody(() => publishIndustry("loc", { operation: "update_business_calls", updateMask: ["callsState"], payload: { callsState: "ENABLED" } }))
    expect(industryMutationSchema.parse(body).confirmation).toBe("publish_industry_data_to_google")
  })

  it("administration", async () => {
    const mutation = await sentBody(() => runAdministrationOperation("loc", { operation: "transfer_location", payload: { destinationAccount: "accounts/2" } }))
    expect(administrationMutationSchema.parse(mutation).confirmation).toBe("transfer_google_location")
    const match = await sentBody(() => matchGoogleLocation("loc", { title: "Camden" }))
    expect(administrationMatchSchema.parse(match).operation).toBe("match_location")
  })

  it("food menus", async () => {
    const save = await sentBody(() => saveFoodMenus("loc", { expectedCanonicalRevision: "3", menus: [{ labels: [{ displayName: "Dinner" }] }] }))
    expect(saveFoodMenusSchema.parse(save).menus).toHaveLength(1)
    const publish = await sentBody(() => publishFoodMenus("loc", { expectedCanonicalRevision: "3", expectedCanonicalHash: HASH, expectedGoogleHash: HASH }))
    expect(publishFoodMenusSchema.parse(publish).confirmFullReplacement).toBe(true)
  })

  it("booking (place actions)", async () => {
    const link = { uri: "https://book.example.com", placeActionType: "DINING_RESERVATION" as const, isPreferred: true }
    expect(placeActionCreateRequestSchema.parse(await sentBody(() => createPlaceAction("loc", link))).confirmation).toBe("create_google_place_action")
    expect(placeActionUpdateRequestSchema.parse(await sentBody(() => updatePlaceAction("loc", "l1", { ...link, expectedGoogleHash: HASH }))).confirmation).toBe("update_google_place_action")
    expect(placeActionDeleteRequestSchema.parse(await sentBody(() => deletePlaceAction("loc", "l1", { expectedGoogleHash: HASH }))).confirmation).toBe("delete_google_place_action")
  })
})

// Client-safety of every lib/contracts module (no server-only / node:* / lib/server
// reachable through the import graph) is asserted in tests/contracts-client-safe.test.ts.
