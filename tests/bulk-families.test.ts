import { describe, expect, it } from "vitest"

import {
  bulkOperationInputSchema,
  mergeAttributes,
} from "@/lib/domain/bulk-merge"
import {
  placeActionApplied,
  planPlaceAction,
  type PlaceLink,
} from "@/lib/domain/bulk-place-actions"
import { googleAttributesMatch } from "@/lib/domain/google-attributes"
import {
  hoursPartHashes,
  hoursPartKey,
  normalizeGoogleHours,
} from "@/lib/domain/hours"
import { previewedParts } from "@/lib/server/bulk-families/hours"
import {
  bulkIntentId,
  outcomeOfAnsweredWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"

const placeAction = (value: Record<string, unknown>) => {
  const parsed = bulkOperationInputSchema.parse({
    operation: "place_action",
    placeActionType: "DINING_RESERVATION",
    ...value,
  })
  if (parsed.operation !== "place_action") throw new Error("parse")
  return parsed
}
const link = (overrides: Partial<PlaceLink>): PlaceLink => ({
  name: "locations/1/placeActionLinks/a",
  uri: "https://book.example/a",
  isPreferred: false,
  isEditable: true,
  ...overrides,
})
const SUPPORTED = ["DINING_RESERVATION"]

describe("action links by stable identity (P09-R3)", () => {
  it("updates the type's one editable link by its Google name, whatever its URI", () => {
    const input = placeAction({
      action: "upsert",
      uri: "https://new.example/book",
      isPreferred: true,
    })
    expect(planPlaceAction(input, [link({})], SUPPORTED)).toEqual({
      plan: {
        update: "locations/1/placeActionLinks/a",
        payload: {
          uri: "https://new.example/book",
          placeActionType: "DINING_RESERVATION",
          isPreferred: true,
        },
      },
      updateMask: ["locations/1/placeActionLinks/a"],
    })
    // Google's echo of the same link (case, trailing slash) is applied.
    expect(
      planPlaceAction(
        placeAction({ action: "upsert", uri: "https://BOOK.example/a/" }),
        [link({})],
        SUPPORTED
      )
    ).toEqual({ skip: "already_applied" })
  })

  it("creates when the type has no editable link, and never guesses between several", () => {
    const input = placeAction({ action: "upsert", uri: "https://b.example" })
    expect(
      planPlaceAction(input, [link({ isEditable: false })], SUPPORTED)
    ).toMatchObject({ plan: { create: { uri: "https://b.example" } } })
    expect(
      planPlaceAction(
        input,
        [link({}), link({ name: "locations/1/placeActionLinks/b" })],
        SUPPORTED
      )
    ).toEqual({ skip: "multiple_links_for_type" })
    expect(planPlaceAction(input, [], [])).toEqual({
      skip: "action_type_not_supported",
    })
  })

  it("deletes the type's editable link by name without needing its URI, and never a provider's", () => {
    const input = placeAction({ action: "delete" })
    expect(planPlaceAction(input, [link({})], SUPPORTED)).toEqual({
      plan: { delete: "locations/1/placeActionLinks/a" },
      updateMask: ["locations/1/placeActionLinks/a"],
    })
    expect(
      planPlaceAction(input, [link({ isEditable: false })], SUPPORTED)
    ).toEqual({ skip: "provider_owned" })
    expect(planPlaceAction(input, [], SUPPORTED)).toEqual({
      skip: "link_not_found",
    })
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "place_action",
        action: "upsert",
        placeActionType: "DINING_RESERVATION",
      }).success
    ).toBe(false)
  })

  it("reads a create back as a new link name of the type, and an update or delete by name", () => {
    const create = {
      create: {
        uri: "https://b.example",
        placeActionType: "DINING_RESERVATION",
        isPreferred: false,
      },
    }
    const prior = ["locations/1/placeActionLinks/a"]
    // The link that was already there does not prove the create.
    expect(
      placeActionApplied([link({ uri: "https://b.example" })], create, prior)
    ).toBe(false)
    expect(
      placeActionApplied(
        [
          link({}),
          link({
            name: "locations/1/placeActionLinks/new",
            uri: "https://b.example/",
          }),
        ],
        create,
        prior
      )
    ).toBe(true)
    expect(
      placeActionApplied(
        [link({ uri: "https://moved.example" })],
        { delete: "locations/1/placeActionLinks/a" },
        prior
      )
    ).toBe(false)
    expect(
      placeActionApplied(
        [],
        { delete: "locations/1/placeActionLinks/a" },
        prior
      )
    ).toBe(true)
  })
})

describe("attributes: false is not unset (P09-R3)", () => {
  const input = (values: Array<boolean | string>) => {
    const parsed = bulkOperationInputSchema.parse({
      operation: "attributes",
      changes: [{ name: "attributes/has_wifi", values }],
    })
    if (parsed.operation !== "attributes") throw new Error("parse")
    return parsed
  }
  const offered = new Set(["attributes/has_wifi"])

  it("sends [false] as an answer and an empty answer as a clear of the masked name", () => {
    const no = mergeAttributes(input([false]), [], offered)
    const clear = mergeAttributes(input([]), [], offered)
    if ("skip" in no || "skip" in clear) throw new Error("skip")
    expect(no.proposed).toEqual([
      { name: "attributes/has_wifi", values: [false] },
    ])
    expect(clear).toMatchObject({
      attributeMask: ["attributes/has_wifi"],
      proposed: [],
    })
    // Readback: an absent attribute is not "No", and "No" is not cleared.
    const absent = { attributes: [] }
    const answeredNo = {
      attributes: [{ name: "attributes/has_wifi", values: [false] }],
    }
    expect(googleAttributesMatch(absent, no.proposed, no.attributeMask)).toBe(
      false
    )
    expect(
      googleAttributesMatch(answeredNo, no.proposed, no.attributeMask)
    ).toBe(true)
    expect(
      googleAttributesMatch(answeredNo, clear.proposed, clear.attributeMask)
    ).toBe(false)
    expect(
      googleAttributesMatch(absent, clear.proposed, clear.attributeMask)
    ).toBe(true)
  })
})

describe("bulk receipts (P09-R3)", () => {
  it("derives one stable UUID intent per child claim", () => {
    const child = "00000000-0000-4000-8000-0000000000c1"
    expect(bulkIntentId(child, 1)).toBe(bulkIntentId(child, 1))
    expect(bulkIntentId(child, 2)).not.toBe(bulkIntentId(child, 1))
    expect(bulkIntentId(child, 1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it("settles an unresolved child only from a settled receipt", () => {
    expect(
      reconcileFromReceipt({ state: "confirmed_applied", errorCode: null })
    ).toEqual({ kind: "succeeded", confirmation: "confirmed" })
    expect(
      reconcileFromReceipt({
        state: "failed",
        errorCode: "google_readback_mismatch",
      })
    ).toEqual({
      kind: "failed",
      code: "recovered_not_applied:google_readback_mismatch",
    })
    expect(
      reconcileFromReceipt({ state: "uncertain", errorCode: null })
    ).toBeNull()
    expect(reconcileFromReceipt({ state: "sent", errorCode: null })).toBeNull()
  })

  it("treats a rejected receipt on a succeeded attempt as landed, in dispatch and in reconcile alike", () => {
    // Google holds the change and does not show it: the write applied.
    expect(
      reconcileFromReceipt({
        state: "rejected",
        errorCode: null,
        attemptStatus: "succeeded",
      })
    ).toEqual({ kind: "succeeded", confirmation: "unrecorded" })
    expect(outcomeOfAnsweredWrite("rejected")).toEqual({
      kind: "succeeded",
      confirmation: "unrecorded",
    })
    // A rejected attempt did not apply.
    expect(
      reconcileFromReceipt({
        state: "rejected",
        errorCode: "google_rejected",
        attemptStatus: "failed",
      })
    ).toEqual({
      kind: "failed",
      code: "recovered_not_applied:google_rejected",
    })
    expect(outcomeOfAnsweredWrite("confirmed_applied")).toEqual({
      kind: "succeeded",
      confirmation: "confirmed",
    })
    expect(outcomeOfAnsweredWrite("awaiting_confirmation")).toEqual({
      kind: "succeeded",
      confirmation: "unrecorded",
    })
    // An answered write still waiting on Google is left to recovery, for
    // hours as for attributes and action links.
    expect(outcomeOfAnsweredWrite("uncertain")).toEqual({
      kind: "ambiguous",
      code: "readback_failed",
    })
    expect(outcomeOfAnsweredWrite("sent")).toEqual({
      kind: "ambiguous",
      code: "readback_failed",
    })
  })

  it("pins only the selected hours parts as previewed, absent ones as null", () => {
    const input = bulkOperationInputSchema.parse({
      operation: "special_hours",
      dates: [
        { action: "closed", date: "2026-12-25" },
        { action: "clear", date: "2027-01-01" },
      ],
    })
    if (input.operation !== "special_hours") throw new Error("parse")
    const current = {
      specialHourPeriods: [
        {
          startDate: { year: 2026, month: 12, day: 25 },
          endDate: { year: 2026, month: 12, day: 25 },
          openTime: { hours: 10 },
          closeTime: { hours: 14 },
        },
        {
          startDate: { year: 2026, month: 12, day: 31 },
          endDate: { year: 2026, month: 12, day: 31 },
          closed: true,
        },
      ],
    }
    const parts = hoursPartHashes(
      normalizeGoogleHours({ specialHours: current })
    )
    expect(previewedParts(input, current)).toEqual({
      [hoursPartKey.special("2026-12-25")]:
        parts[hoursPartKey.special("2026-12-25")],
      [hoursPartKey.special("2027-01-01")]: null,
    })
  })
})
