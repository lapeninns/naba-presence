import { afterEach, describe, expect, it, vi } from "vitest"

import { apiFetch, ApiClientError, isAwaitingApproval } from "@/lib/api/client"
import {
  LISTING_CHANGE_AWAITING_APPROVAL,
  LISTING_CHANGE_EDITOR,
  LISTING_CHANGE_KINDS,
  LISTING_CHANGE_LABEL,
  type ListingChangeParkedResponse,
} from "@/lib/contracts/listing-changes"
import { ORG_FEATURES } from "@/lib/contracts/org-features"
import { describeOutcome } from "@/lib/editors/outcome"
import {
  describeActionError,
  errorOutcome,
  isUnconfirmedFailure,
} from "@/lib/errors/action-errors"
import { LISTING_CHANGE_ENTRIES } from "@/lib/server/listing-change-registry"
import { describeListingChange } from "@/lib/domain/listing-change-details"
import {
  LISTING_CHANGE_DECIDER_ROLES,
  LISTING_CHANGE_FEATURE,
} from "@/lib/server/listing-changes"
import { RECOVERY_ADAPTERS } from "@/lib/server/mutation-recovery-registry"

import {
  routeConfigStrings,
  scanRouteFile,
  type RouteHandler,
} from "./helpers/route-scanner"

/** One handler of a location route, read through the shared scanner. */
function locationHandler(method: string, file: string): RouteHandler {
  const path = `app/api/locations/[id]/${file}`
  const handler = scanRouteFile(path).handlers.find(
    (candidate) => candidate.method === method
  )
  if (!handler) throw new Error(`${method} ${path} does not exist`)
  return handler
}

/** The kinds a handler submits: `submitListingChange("kind"` in its own code. */
function submittedKinds(handler: RouteHandler): string[] {
  return [...handler.config.matchAll(/\bsubmitListingChange\(\s*"(\w+)"/g)].map(
    (match) => match[1]!
  )
}

/**
 * Two-person approval for direct listing writes (plan P02-S2b). The parking,
 * approval and dispatch paths run against Postgres in
 * tests/integration/routes/listing-change-approval.test.ts; this file pins
 * the registry and the client's reading of a parked answer.
 */

describe("listing change registry", () => {
  it("covers every kind with an entry of that kind", () => {
    expect(Object.keys(LISTING_CHANGE_ENTRIES).sort()).toEqual(
      [...LISTING_CHANGE_KINDS].sort()
    )
    for (const [key, entry] of Object.entries(LISTING_CHANGE_ENTRIES)) {
      expect(entry.kind).toBe(key)
      expect(LISTING_CHANGE_LABEL[entry.kind].length).toBeGreaterThan(0)
      expect(LISTING_CHANGE_EDITOR[entry.kind]).toBeTruthy()
    }
  })

  it("records each change under a surface the recovery job can read back", () => {
    // An approved request follows its dispatch's attempt, so an uncertain
    // one is recovered through the same (surface, attempt table) adapter.
    const surfaces = new Set(
      (RECOVERY_ADAPTERS as unknown as { surface: string }[]).map(
        (adapter) => adapter.surface
      )
    )
    for (const entry of Object.values(LISTING_CHANGE_ENTRIES)) {
      expect(surfaces, entry.kind).toContain(entry.surface)
    }
  })

  it("is switched by a known, default-off organisation feature", () => {
    expect(ORG_FEATURES).toContain(LISTING_CHANGE_FEATURE)
  })

  it("routes every listing write through submitListingChange", () => {
    // Only the code of the handler that publishes counts: the kind in a
    // comment, in another handler or in a string elsewhere does not park it.
    // The parking itself runs in
    // tests/integration/routes/listing-change-approval.test.ts.
    const handlers: [string, string, string[]][] = [
      ["POST", "hours/route.ts", ["hours_publish"]],
      ["POST", "profile/route.ts", ["profile_publish"]],
      ["POST", "food-menus/route.ts", ["food_menus_publish"]],
      ["POST", "media/route.ts", ["media_create"]],
      ["PATCH", "media/[mediaId]/route.ts", ["media_update"]],
      ["DELETE", "media/[mediaId]/route.ts", ["media_delete"]],
    ]
    for (const [method, file, kinds] of handlers) {
      expect(submittedKinds(locationHandler(method, file)), file).toEqual(kinds)
    }
    expect(locationHandler("POST", "media/route.ts").config).toMatch(
      /\brefuseUploadWhenApprovalRequired\(/
    )
  })

  it("leaves the reviewed change-set writes to their own approval", () => {
    // Business information, attributes and lodging need an approved change
    // set; Place Action links only accept reviews. Neither parks here.
    const routes: Record<string, string> = {
      "business-information/route.ts": "approveGbpChange(",
      "industry/route.ts": "approveLodgingChange(",
      "place-actions/route.ts": "place_action_review_required",
      "place-actions/[linkId]/route.ts": "place_action_review_required",
    }
    for (const [file, needle] of Object.entries(routes)) {
      const route = scanRouteFile(`app/api/locations/[id]/${file}`)
      expect(route.code, file).toContain(needle)
      expect(route.code, file).not.toMatch(/\bsubmitListingChange\(/)
    }
  })
})

describe("deciding a listing change", () => {
  /** The `roles` of the route() block that submits `kind`, if any. */
  function routeRoles(kind: string): string[] | null {
    const handlers: [string, string][] = [
      ["POST", "hours/route.ts"],
      ["POST", "profile/route.ts"],
      ["POST", "food-menus/route.ts"],
      ["POST", "media/route.ts"],
      ["PATCH", "media/[mediaId]/route.ts"],
      ["DELETE", "media/[mediaId]/route.ts"],
    ]
    for (const [method, file] of handlers) {
      const handler = locationHandler(method, file)
      if (!submittedKinds(handler).includes(kind)) continue
      return routeConfigStrings(handler.config, "roles") ?? null
    }
    throw new Error(`no route submits ${kind}`)
  }

  it("requires the authoring route's roles of every decider", () => {
    for (const kind of LISTING_CHANGE_KINDS) {
      const expected = routeRoles(kind)
      const actual = LISTING_CHANGE_DECIDER_ROLES[kind]
      expect(actual ? [...actual].sort() : null, kind).toEqual(
        expected ? expected.sort() : null
      )
    }
  })

  it("shows the approver every content value of the frozen body", () => {
    const details = describeListingChange({
      kind: "media_create",
      target: null,
      body: {
        confirmation: "create_google_media",
        mediaFormat: "PHOTO",
        category: "INTERIOR",
        sourceUrl: "https://phish.example.com/bar.jpg",
        description: "The snug",
      },
    })
    expect(details).toEqual([
      { label: "Media format", value: "PHOTO" },
      { label: "Category", value: "INTERIOR" },
      {
        label: "Source web address",
        value: "https://phish.example.com/bar.jpg",
      },
      { label: "Description", value: "The snug" },
    ])

    const update = describeListingChange({
      kind: "media_update",
      target: null,
      body: {
        confirmation: "update_google_media",
        category: "EXTERIOR",
        expectedGoogleHash: "a".repeat(64),
      },
    })
    expect(update).toContainEqual({ label: "Category", value: "EXTERIOR" })
    // Bookkeeping is not content: masks are shown as fieldMask, hashes are
    // checked at dispatch.
    expect(update.map((row) => row.label).join()).not.toMatch(/mask|hash/i)
  })

  it("names the photo a delete removes and what it is now", () => {
    expect(
      describeListingChange({
        kind: "media_delete",
        target: "66666666-6666-4666-8666-666666666666",
        body: { confirmation: "delete_google_media", expectedGoogleHash: "c" },
        targetNow: { category: "INTERIOR", googleUrl: "https://g/p.jpg" },
      })
    ).toEqual([
      { label: "Photo", value: "66666666-6666-4666-8666-666666666666" },
      { label: "Now: category", value: "INTERIOR" },
      { label: "Now: google url", value: "https://g/p.jpg" },
    ])
  })

  it("says a saved-copy publish sends the editor's saved copy", () => {
    expect(
      describeListingChange({
        kind: "hours_publish",
        target: null,
        body: {
          confirmation: "publish_nabapresence_hours_to_google",
          expectedCanonicalRevision: 4,
          approvedUpdateMask: ["regularHours"],
          confirmOverwriteGoogleChanges: false,
        },
      })
    ).toEqual([
      expect.objectContaining({ label: "Publishes" }),
      { label: "Saved version", value: "4" },
      { label: "Overwrite changes made on Google", value: "No" },
    ])
  })
})

describe("a parked answer on the client", () => {
  afterEach(() => vi.restoreAllMocks())

  const parked: ListingChangeParkedResponse = {
    status: "awaiting_approval",
    changeRequest: {
      id: "11111111-1111-4111-8111-111111111111",
      intentId: "22222222-2222-4222-8222-222222222222",
      kind: "hours_publish",
      label: LISTING_CHANGE_LABEL.hours_publish,
      locationId: "33333333-3333-4333-8333-333333333333",
      target: null,
      fieldMask: ["regularHours"],
      details: [],
      payloadHash: "b".repeat(64),
      outcome: "awaiting_approval",
      errorCode: null,
      author: { id: "44444444-4444-4444-8444-444444444444", name: "Ada" },
      createdAt: "2026-10-10T10:00:00.000Z",
      updatedAt: "2026-10-10T10:00:00.000Z",
      isOwn: false,
      canDecide: false,
    },
    operation: {
      operationId: "11111111-1111-4111-8111-111111111111",
      outcome: "awaiting_approval",
    },
  }

  function respond(status: number, body: unknown) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  }

  it("raises a 202 change request as awaiting approval, never as success or failure", async () => {
    respond(202, parked)
    const error = await apiFetch("/api/locations/x/hours", {
      method: "POST",
      body: {},
      schema: { safeParse: () => ({ success: true, data: "parsed" }) } as never,
    }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(isAwaitingApproval(error)).toBe(true)
    const apiError = error as ApiClientError
    expect(apiError.status).toBe(202)
    expect(apiError.code).toBe(LISTING_CHANGE_AWAITING_APPROVAL)
    expect(apiError.details).toMatchObject({
      operationId: parked.operation.operationId,
      changeRequest: { kind: "hours_publish" },
    })
    expect(errorOutcome(error)).toBe("awaiting_approval")
    // Nothing was sent, so a retry is a new request, not a resend.
    expect(isUnconfirmedFailure(error)).toBe(false)
    expect(describeActionError(error)).toMatch(/^Sent for approval\./)
    expect(describeOutcome("awaiting_approval").live).toBe(false)
  })

  it("leaves any other 202 to the caller's schema", async () => {
    respond(202, { status: "awaiting_approval" })
    await expect(
      apiFetch("/api/locations/x/posts/y/publish", { method: "POST" })
    ).resolves.toEqual({ status: "awaiting_approval" })
  })
})
